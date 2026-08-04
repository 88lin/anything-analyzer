import { v4 as uuidv4 } from "uuid";
import type {
  AnalysisReport,
  AssembledData,
  FilteredRequest,
  LLMProviderConfig,
  PromptTemplate,
  AiRequestLogData,
  AiRequestLogType,
  RequestSummary,
} from "@shared/types";
import type {
  SessionsRepo,
  RequestsRepo,
  JsHooksRepo,
  StorageSnapshotsRepo,
  AnalysisReportsRepo,
  AiRequestLogRepo,
  InteractionEventsRepo,
} from "../db/repositories";
import { DataAssembler } from "./data-assembler";
import { PromptBuilder } from "./prompt-builder";
import { LLMRouter } from "./llm-router";
import type { MCPClientManager, MCPToolInfo } from "../mcp/mcp-manager";
import {
  applyUsageCalibration,
  compactMessagesToBudgetAsync,
  normalizeContextBudget,
  type MessageLike,
} from "./context-budget";
import { BUILTIN_REQUEST_TOOLS, dispatchBuiltinRequestTool } from "./request-tools";
import { BUILTIN_CAPTURE_TOOLS, dispatchBuiltinCaptureTool } from "./capture-tools";
import { loadTokenCalibration, saveTokenCalibration } from "./token-calibration-store";
import { SubagentAnalyzer } from "./subagent-analyzer";
import {
  appendToolStateMarker,
  buildToolStateNote,
  getToolSessionState,
  hydrateToolSessionFromHistory,
  recordToolSessionActivity,
} from "./tool-session-state";

/** 请求数低于此值时跳过 Phase 1 预过滤（仅 legacy_inline） */
const PRE_FILTER_THRESHOLD = 20;
/** Phase 1 选出的请求少于此值时回退到全量分析 */
const PRE_FILTER_MIN_SELECTED = 3;
/** Phase 1 响应最大 token 数 */
const PHASE1_MAX_TOKENS = 1024;
/** 需要全量请求的分析目的（不跳过任何请求） */
const SKIP_FILTER_PURPOSES = ["performance"];
/** 预过滤每次发送的请求摘要上限，避免单次上下文膨胀 */
const FILTER_BATCH_SIZE = 100;

/**
 * AiAnalyzer — Orchestrates data assembly, prompt building, LLM calling,
 * and report generation.
 */
export class AiAnalyzer {
  private mcpManager: MCPClientManager | null = null;

  constructor(
    private sessionsRepo: SessionsRepo,
    private requestsRepo: RequestsRepo,
    private jsHooksRepo: JsHooksRepo,
    private storageSnapshotsRepo: StorageSnapshotsRepo,
    private reportsRepo: AnalysisReportsRepo,
    private aiRequestLogRepo: AiRequestLogRepo,
    private interactionEventsRepo: InteractionEventsRepo,
  ) {}

  /**
   * 注入 MCP 客户端管理器（可选）
   */
  setMCPManager(manager: MCPClientManager): void {
    this.mcpManager = manager;
  }

  /**
   * Create a logging callback for LLMRouter that captures context via closure.
   */
  private createLogCallback(
    sessionId: string,
    reportId: string | null,
    type: AiRequestLogType,
    config: LLMProviderConfig,
  ) {
    return (data: AiRequestLogData) => {
      try {
        return this.aiRequestLogRepo.insert({
          session_id: sessionId,
          report_id: reportId,
          type,
          provider: config.name,
          model: config.model,
          ...data,
          prompt_tokens: 0,
          completion_tokens: 0,
          created_at: Date.now(),
        });
      } catch (e) {
        console.warn("[AiRequestLog] Failed to insert log:", e);
        return undefined;
      }
    };
  }

  private readonly updateLogTokens = (
    logId: number,
    promptTokens: number,
    completionTokens: number,
  ): void => {
    try {
      this.aiRequestLogRepo.updateTokensById(logId, promptTokens, completionTokens);
    } catch (error) {
      console.warn("[AiRequestLog] Failed to update tokens:", error);
    }
  };

  private createBuiltinToolRouter(
    sessionId: string,
    reportId: string | null | undefined,
    requestMap: Map<number, FilteredRequest>,
    summaries: RequestSummary[],
  ) {
    return async (name: string, args: Record<string, unknown>): Promise<string> => {
      const builtin = dispatchBuiltinRequestTool(name, args, requestMap, summaries);
      if (builtin) {
        recordToolSessionActivity(sessionId, reportId, builtin.fetchedSeqs, builtin.refLine);
        return builtin.result;
      }
      const captureBuiltin = dispatchBuiltinCaptureTool(
        name,
        args,
        this.jsHooksRepo.findBySession(sessionId),
        this.interactionEventsRepo.findBySession(sessionId, 10_000),
      );
      if (captureBuiltin) {
        recordToolSessionActivity(
          sessionId,
          reportId,
          captureBuiltin.fetchedSeqs,
          captureBuiltin.refLine,
        );
        return captureBuiltin.result;
      }
      if (this.mcpManager) return this.mcpManager.callTool(name, args);
      throw new Error(`Tool not found: ${name}`);
    };
  }

  private collectTools(hasRequests: boolean): MCPToolInfo[] {
    const builtinTools = [
      ...(hasRequests ? BUILTIN_REQUEST_TOOLS : []),
      ...BUILTIN_CAPTURE_TOOLS,
    ];
    const mcpTools = this.mcpManager?.hasConnections() ? this.mcpManager.listAllTools() : [];
    return [...builtinTools, ...mcpTools];
  }

  private async buildSubagentContext(
    sessionId: string,
    config: LLMProviderConfig,
    summaries: RequestSummary[],
    purpose: string | undefined,
    template: PromptTemplate | undefined,
    onProgress?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    loadTokenCalibration(config);
    const budget = normalizeContextBudget(config.contextBudget);
    if (!budget.subagentEnabled || summaries.length < budget.subagentThreshold) return "";

    const workerConfig: LLMProviderConfig = {
      ...config,
      maxTokens: Math.min(config.maxTokens || 1024, 1024),
    };
    const analysisFocus = template?.requirements || purpose || "自动识别协议场景与关键请求链路";
    const analyzer = new SubagentAnalyzer(
      async (input) => {
        signal?.throwIfAborted();
        onProgress?.(
          `> 子分析 ${input.chunkIndex + 1}/${input.totalChunks}：正在扫描 ${input.summaries.length} 条请求摘要...\n\n`,
        );

        const router = new LLMRouter(
          workerConfig,
          this.createLogCallback(sessionId, null, "subagent", workerConfig),
          this.updateLogTokens,
        );
        const messages: MessageLike[] = [
          {
            role: "system",
            content:
              "你是主分析器的并行子任务。只根据请求摘要发现值得主模型验证的线索；不要推断未出现的请求体字段。严格按用户要求返回 JSON。",
          },
          {
            role: "user",
            content: `${input.prompt}\n\n本次总体分析重点：\n${analysisFocus}`,
          },
        ];
        const result = await router.complete(messages, undefined, signal);
        applyUsageCalibration(messages, result.promptTokens);
        saveTokenCalibration(workerConfig);
        return result.content;
      },
      {
        threshold: budget.subagentThreshold - 1,
        chunkSize: budget.subagentChunkSize,
        maxConcurrency: budget.maxSubagents,
      },
    );

    onProgress?.(
      `> 请求数达到 ${summaries.length}，启动最多 ${budget.maxSubagents} 个并行子分析任务。\n\n`,
    );
    const result = await analyzer.analyze(summaries);
    signal?.throwIfAborted();
    if (!result.applied || result.succeededChunks === 0 || result.findings.length === 0) {
      if (result.applied) {
        onProgress?.("> 子分析未产生可用线索，主分析继续按请求工具链执行。\n\n");
      }
      return "";
    }
    onProgress?.(
      `> 子分析完成：${result.succeededChunks}/${result.chunkCount} 个分块成功，聚合 ${result.findings.length} 条导航线索。\n\n`,
    );
    return result.compactSummary;
  }

  private async packMessages(
    messages: MessageLike[],
    config: LLMProviderConfig,
    sessionId: string,
    reportId: string | null | undefined,
    onProgress?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<MessageLike[]> {
    loadTokenCalibration(config);
    const budget = normalizeContextBudget(config.contextBudget);
    const summarize =
      budget.compressionMode === "hybrid"
        ? async (middleText: string) => {
            onProgress?.("> 混合压缩：正在生成中间历史摘要...\n\n");
            const summaryConfig: LLMProviderConfig = {
              ...config,
              maxTokens: Math.min(config.maxTokens || 1024, 1024),
            };
            const router = new LLMRouter(
              summaryConfig,
              this.createLogCallback(sessionId, reportId ?? null, "compress", summaryConfig),
              this.updateLogTokens,
            );
            const summaryMessages: MessageLike[] = [
              {
                role: "system",
                content:
                  "你是上下文压缩器。将多轮协议分析对话压缩为简洁中文要点，保留：已确认的 API/鉴权结论、关键请求序号、未决问题。不要编造未出现的字段。",
              },
              { role: "user", content: middleText },
            ];
            const result = await router.complete(summaryMessages, undefined, signal);
            applyUsageCalibration(summaryMessages, result.promptTokens);
            saveTokenCalibration(summaryConfig);
            return result.content;
          }
        : undefined;

    const packed = await compactMessagesToBudgetAsync(messages, budget, summarize);
    if (packed.compressed) {
      onProgress?.(
        `> 上下文达到峰值（${Math.round(budget.compressionPeak * 100)}%），已${packed.mode === "hybrid" ? "混合" : "规则"}压缩 ${packed.beforeTokens} → ${packed.afterTokens} tokens。\n\n`,
      );
    }
    return packed.messages;
  }

  async analyze(
    sessionId: string,
    config: LLMProviderConfig,
    onProgress?: (chunk: string) => void,
    purpose?: string,
    template?: PromptTemplate,
    selectedSeqs?: number[],
    signal?: AbortSignal,
  ): Promise<AnalysisReport> {
    loadTokenCalibration(config);
    const budget = normalizeContextBudget(config.contextBudget);
    const indexFirst = budget.contextMode === "index_first";

    const session = this.sessionsRepo.findById(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    let platformName = "unknown";
    try {
      platformName = new URL(session.target_url).hostname;
    } catch {
      /* ignore */
    }

    const assembler = new DataAssembler(
      this.requestsRepo,
      this.jsHooksRepo,
      this.storageSnapshotsRepo,
    );
    const fullData = assembler.assemble(sessionId);
    const allSummaries: RequestSummary[] = assembler.extractSummaries(fullData);

    let analysisData: AssembledData = fullData;
    let filterPromptTokens: number | null = null;
    let filterCompletionTokens: number | null = null;
    const manualSelection = selectedSeqs && selectedSeqs.length > 0;
    let filteredApplied = false;

    if (manualSelection) {
      analysisData = assembler.filterBySeqs(fullData, selectedSeqs!);
      filteredApplied = true;
      onProgress?.(`> 使用手动选择的 ${selectedSeqs!.length} 条请求进行分析。\n\n`);
    } else if (indexFirst) {
      analysisData = fullData;
      onProgress?.(
        `> 索引优先模式：向模型提供 ${fullData.requests.length} 条请求索引（不内联正文），可使用 list_requests / search_requests / get_request_detail。\n\n`,
      );
    } else {
      const skipFilter = purpose && SKIP_FILTER_PURPOSES.includes(purpose);
      if (!skipFilter && fullData.requests.length >= PRE_FILTER_THRESHOLD) {
        try {
          onProgress?.(`> 请求数量较多（${fullData.requests.length} 条），正在进行智能预过滤...\n\n`);
          const phase1Config: LLMProviderConfig = { ...config, maxTokens: PHASE1_MAX_TOKENS };
          const phase1Router = new LLMRouter(
            phase1Config,
            this.createLogCallback(sessionId, null, "filter", phase1Config),
            this.updateLogTokens,
          );
          const validSeqs = new Set(fullData.requests.map((r) => r.seq));
          const selected = new Set<number>();

          for (let batchStart = 0; batchStart < allSummaries.length; batchStart += FILTER_BATCH_SIZE) {
            const batchSummaries = allSummaries.slice(batchStart, batchStart + FILTER_BATCH_SIZE);
            const filterPrompt = new PromptBuilder().buildFilterPrompt(
              batchSummaries,
              fullData.sceneHints,
              purpose,
              template,
            );
            const phase1Messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
              { role: "system", content: filterPrompt.system },
              { role: "user", content: filterPrompt.user },
            ];

            const batchNumber = Math.floor(batchStart / FILTER_BATCH_SIZE) + 1;
            const batchCount = Math.ceil(allSummaries.length / FILTER_BATCH_SIZE);
            onProgress?.(`> 正在过滤第 ${batchNumber}/${batchCount} 批请求（${batchSummaries.length} 条）...\n\n`);
            signal?.throwIfAborted();
            const phase1Result = await phase1Router.complete(phase1Messages, undefined, signal);
            filterPromptTokens = (filterPromptTokens ?? 0) + phase1Result.promptTokens;
            filterCompletionTokens = (filterCompletionTokens ?? 0) + phase1Result.completionTokens;
            this.parseFilterResponse(phase1Result.content, validSeqs)?.forEach((seq) => selected.add(seq));
          }

          const filteredSeqs = [...selected];
          if (filteredSeqs.length >= PRE_FILTER_MIN_SELECTED) {
            analysisData = assembler.filterBySeqs(fullData, filteredSeqs);
            filteredApplied = true;
            onProgress?.(
              `> 过滤完成：从 ${fullData.requests.length} 条中选出 ${filteredSeqs.length} 条相关请求进行深度分析。\n\n`,
            );
          } else {
            onProgress?.(`> 过滤结果不足，使用全部 ${fullData.requests.length} 条请求分析。\n\n`);
          }
        } catch {
          onProgress?.(`> 预过滤失败，使用全部 ${fullData.requests.length} 条请求分析。\n\n`);
        }
      }
    }

    const subagentContext = indexFirst && !manualSelection
      ? await this.buildSubagentContext(
          sessionId,
          config,
          allSummaries,
          purpose,
          template,
          onProgress,
          signal,
        )
      : "";

    const promptBuilder = new PromptBuilder();
    const summariesForPrompt = indexFirst || filteredApplied ? allSummaries : undefined;
    const { system, user: baseUser } = promptBuilder.build(
      analysisData,
      platformName,
      purpose,
      template,
      summariesForPrompt,
      budget.contextMode,
    );
    const user = subagentContext
      ? `${baseUser}\n\n## 并行子分析导航（仅作定位线索，正文仍需工具验证）\n${subagentContext}`
      : baseUser;

    const router = new LLMRouter(
      config,
      this.createLogCallback(sessionId, null, "analyze", config),
      this.updateLogTokens,
    );
    let content = "";
    let promptTokens = 0;
    let completionTokens = 0;

    const requestMap = new Map(fullData.requests.map((r) => [r.seq, r]));
    const allTools = this.collectTools(fullData.requests.length > 0);
    const callTool = this.createBuiltinToolRouter(sessionId, null, requestMap, allSummaries);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        signal?.throwIfAborted();
        let messages: MessageLike[] = [
          { role: "system", content: system },
          { role: "user", content: user },
        ];
        messages = await this.packMessages(messages, config, sessionId, null, onProgress, signal);

        let result;
        if (allTools.length > 0) {
          result = await router.completeWithTools(
            messages,
            allTools,
            callTool,
            onProgress,
            undefined,
            signal,
          );
        } else {
          result = await router.complete(messages, onProgress, signal);
        }

        content = result.content;
        promptTokens = result.promptTokens;
        completionTokens = result.completionTokens;
        if (allTools.length === 0) {
          applyUsageCalibration(messages, result.promptTokens);
          saveTokenCalibration(config);
        }
        break;
      } catch (err) {
        if (signal?.aborted) throw err;
        if (attempt === 1) {
          throw new Error(`AI 分析失败（已重试）: ${(err as Error).message}`);
        }
      }
    }

    const report: AnalysisReport = {
      id: uuidv4(),
      session_id: sessionId,
      created_at: Date.now(),
      llm_provider: config.name,
      llm_model: config.model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      report_content: content,
      filter_prompt_tokens: filterPromptTokens,
      filter_completion_tokens: filterCompletionTokens,
    };

    this.reportsRepo.insert(report);
    return report;
  }

  private parseFilterResponse(raw: string, validSeqs: Set<number>): number[] | null {
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

    try {
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) return null;
      const nums = parsed.filter((n): n is number => typeof n === "number" && validSeqs.has(n));
      return nums.length > 0 ? nums : null;
    } catch {
      return null;
    }
  }

  async chat(
    sessionId: string,
    config: LLMProviderConfig,
    history: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    userMessage: string,
    onProgress?: (chunk: string) => void,
    reportId?: string,
  ): Promise<string> {
    // 从历史恢复侧态，并注入紧凑说明（无正文）
    const snapshot = hydrateToolSessionFromHistory(sessionId, reportId, history);
    const stateNote = buildToolStateNote(snapshot);

    const messages: MessageLike[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: stateNote ? `${stateNote}\n\n## 用户追问\n${userMessage}` : userMessage,
      },
    ];

    const compactedMessages = await this.packMessages(
      messages,
      config,
      sessionId,
      reportId,
      onProgress,
    );

    const router = new LLMRouter(
      config,
      this.createLogCallback(sessionId, reportId ?? null, "chat", config),
      this.updateLogTokens,
    );

    const assembler = new DataAssembler(
      this.requestsRepo,
      this.jsHooksRepo,
      this.storageSnapshotsRepo,
    );
    const fullData = assembler.assemble(sessionId);
    const summaries = assembler.extractSummaries(fullData);
    const requestMap = new Map(fullData.requests.map((r) => [r.seq, r]));
    const allTools = this.collectTools(fullData.requests.length > 0);
    const callTool = this.createBuiltinToolRouter(sessionId, reportId, requestMap, summaries);

    let replyContent: string;

    if (allTools.length > 0) {
      try {
        const result = await router.completeWithTools(
          compactedMessages,
          allTools,
          callTool,
          onProgress,
        );
        replyContent = result.content;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`追问工具调用失败：${message}`);
      }
    } else {
      const result = await router.complete(compactedMessages, onProgress);
      applyUsageCalibration(compactedMessages, result.promptTokens);
      saveTokenCalibration(config);
      replyContent = result.content;
    }

    // 仅附加极简 <tool_state>，不再粘贴 tool 正文
    const finalSnap = getToolSessionState(sessionId, reportId);
    return appendToolStateMarker(replyContent, finalSnap);
  }
}
