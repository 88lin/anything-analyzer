import type { ContextBudgetConfig, ContextMode, CompressionMode } from "@shared/types";
import {
  estimateTextTokens,
  estimateTextTokensRaw,
  calibrateTokenEstimate,
} from "@shared/token-estimate";

export const DEFAULT_CHAT_CONTEXT_CHARS = 60_000;
export const KEEP_RECENT_TOOL_CONTEXTS = 2;
export const CHARS_PER_TOKEN = 4;

export const DEFAULT_CONTEXT_BUDGET: ContextBudgetConfig = {
  maxContextTokens: 200_000,
  compressionPeak: 0.85,
  compressionTarget: 0.55,
  reserveCompletionTokens: 8_192,
  contextMode: "index_first",
  compressionMode: "rules",
  subagentEnabled: true,
  subagentThreshold: 400,
  subagentChunkSize: 120,
  maxSubagents: 3,
};

export interface MessageLike {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface CompactResult {
  messages: MessageLike[];
  compressed: boolean;
  beforeTokens: number;
  afterTokens: number;
  mode: "none" | "rules" | "hybrid";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeContextBudget(
  partial?: Partial<ContextBudgetConfig> | null,
): ContextBudgetConfig {
  const merged: ContextBudgetConfig = {
    ...DEFAULT_CONTEXT_BUDGET,
    ...(partial ?? {}),
  };

  const contextMode: ContextMode =
    merged.contextMode === "legacy_inline" ? "legacy_inline" : "index_first";
  const compressionMode: CompressionMode =
    merged.compressionMode === "hybrid" ? "hybrid" : "rules";

  return {
    maxContextTokens: Math.max(4_096, Math.floor(merged.maxContextTokens || DEFAULT_CONTEXT_BUDGET.maxContextTokens)),
    compressionPeak: clamp(merged.compressionPeak || DEFAULT_CONTEXT_BUDGET.compressionPeak, 0.5, 0.95),
    compressionTarget: clamp(merged.compressionTarget || DEFAULT_CONTEXT_BUDGET.compressionTarget, 0.2, 0.8),
    reserveCompletionTokens: Math.max(256, Math.floor(merged.reserveCompletionTokens || DEFAULT_CONTEXT_BUDGET.reserveCompletionTokens)),
    contextMode,
    compressionMode,
    subagentEnabled: merged.subagentEnabled !== false,
    subagentThreshold: Math.max(100, Math.floor(merged.subagentThreshold || DEFAULT_CONTEXT_BUDGET.subagentThreshold)),
    subagentChunkSize: Math.max(40, Math.min(250, Math.floor(merged.subagentChunkSize || DEFAULT_CONTEXT_BUDGET.subagentChunkSize))),
    maxSubagents: Math.max(1, Math.min(8, Math.floor(merged.maxSubagents || DEFAULT_CONTEXT_BUDGET.maxSubagents))),
  };
}

export function estimateTokens(text: string): number {
  return estimateTextTokens(text);
}

/** 未校准原始估算，供 usage 回写校准 */
export function estimateTokensRaw(text: string): number {
  return estimateTextTokensRaw(text);
}

export function estimateMessagesTokens(messages: MessageLike[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
}

export function estimateMessagesTokensRaw(messages: MessageLike[]): number {
  return messages.reduce((sum, message) => sum + estimateTokensRaw(message.content) + 4, 0);
}

export function applyUsageCalibration(messages: MessageLike[], actualPromptTokens: number): void {
  if (!actualPromptTokens || actualPromptTokens <= 0) return;
  calibrateTokenEstimate(estimateMessagesTokensRaw(messages), actualPromptTokens);
}

export function getUsableTokens(config: ContextBudgetConfig): number {
  return Math.max(1_024, config.maxContextTokens - config.reserveCompletionTokens);
}

export function getCompressionTriggerTokens(config: ContextBudgetConfig): number {
  return Math.floor(getUsableTokens(config) * config.compressionPeak);
}

export function getCompressionTargetTokens(config: ContextBudgetConfig): number {
  const usable = getUsableTokens(config);
  const target = Math.floor(usable * config.compressionTarget);
  const trigger = getCompressionTriggerTokens(config);
  return Math.max(512, Math.min(target, trigger - 1));
}

export function shouldCompress(messages: MessageLike[], config: ContextBudgetConfig): boolean {
  return estimateMessagesTokens(messages) >= getCompressionTriggerTokens(config);
}

function compactText(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const headChars = Math.ceil(maxChars * 0.7);
  const tailChars = Math.max(0, maxChars - headChars);
  const compacted = `${content.slice(0, headChars)}\n...(上下文已压缩，共 ${content.length} 字符)\n${content.slice(-tailChars)}`;
  return compacted.slice(0, maxChars);
}

export function stripToolContext(content: string): string {
  return content
    .replace(/\n*<tool_context>[\s\S]*?<\/tool_context>\s*$/g, "")
    .replace(/\n*<tool_state>[\s\S]*?<\/tool_state>\s*$/g, "");
}

/**
 * Legacy char-budget compaction. Kept for compatibility with existing callers/tests.
 */
export function compactChatMessages(
  input: MessageLike[],
  maxChars = DEFAULT_CHAT_CONTEXT_CHARS,
): MessageLike[] {
  const messages = input.map((message) => ({ ...message }));
  let assistantCount = 0;
  for (let index = messages.length - 1; index >= 2; index -= 1) {
    if (messages[index].role !== "assistant") continue;
    assistantCount += 1;
    if (assistantCount > KEEP_RECENT_TOOL_CONTEXTS) {
      messages[index].content = stripToolContext(messages[index].content);
    }
  }

  const contentLength = () => messages.reduce((sum, message) => sum + message.content.length, 0);
  if (contentLength() <= maxChars) return messages;

  if (messages[0]) messages[0].content = compactText(messages[0].content, 8_000);
  if (messages[1]) messages[1].content = compactText(messages[1].content, 28_000);
  for (let index = 2; index < messages.length; index += 1) {
    messages[index].content = compactText(messages[index].content, index >= messages.length - 4 ? 8_000 : 2_000);
  }

  while (contentLength() > maxChars && messages.length > 2) {
    const oldestIndex = messages.length > 3 ? 2 : 1;
    const message = messages[oldestIndex];
    if (!message) break;
    const overflow = contentLength() - maxChars;
    const nextLength = Math.max(100, message.content.length - overflow);
    const compacted = compactText(message.content, nextLength);
    if (compacted.length >= message.content.length) {
      messages.splice(oldestIndex, 1);
    } else {
      message.content = compacted;
    }
  }
  return messages;
}

/** 把中间历史折叠成结构化要点（无 LLM） */
export function foldMiddleHistory(messages: MessageLike[], keepRecentPairs = 2): MessageLike[] {
  if (messages.length <= 3) return messages.map((m) => ({ ...m }));

  const system = messages[0]?.role === "system" ? messages[0] : null;
  const body = system ? messages.slice(1) : messages.slice();
  if (body.length <= keepRecentPairs * 2 + 1) return messages.map((m) => ({ ...m }));

  const recentCount = Math.min(body.length, keepRecentPairs * 2);
  const recent = body.slice(-recentCount);
  const middle = body.slice(0, body.length - recentCount);

  const bullets: string[] = [];
  for (const message of middle) {
    const plain = stripToolContext(message.content).replace(/\s+/g, " ").trim();
    if (!plain) continue;
    const seqs = [...plain.matchAll(/#(\d+)/g)].map((m) => m[1]);
    const seqNote = seqs.length ? ` [seqs=#${[...new Set(seqs)].slice(0, 8).join(",#")}]` : "";
    bullets.push(`- (${message.role}) ${plain.slice(0, 160)}${plain.length > 160 ? "..." : ""}${seqNote}`);
    if (bullets.length >= 24) break;
  }

  const summary: MessageLike = {
    role: "assistant",
    content: `【上下文折叠摘要】以下为较早对话的压缩要点，完整正文已省略：\n${bullets.join("\n") || "- (无)"}`,
  };

  const result: MessageLike[] = [];
  if (system) result.push({ ...system, content: stripToolContext(system.content) });
  result.push(summary);
  for (const message of recent) {
    result.push({ ...message, content: stripToolContext(message.content) });
  }
  return result;
}

function applyRulesCompression(input: MessageLike[], targetChars: number): MessageLike[] {
  let messages = input.map((message) => ({ ...message }));
  let assistantCount = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") continue;
    assistantCount += 1;
    if (assistantCount > KEEP_RECENT_TOOL_CONTEXTS) {
      messages[index].content = stripToolContext(messages[index].content);
    }
  }

  messages = foldMiddleHistory(messages, 2);
  messages = compactChatMessages(messages, targetChars);

  const lastUser = [...input].reverse().find((m) => m.role === "user");
  if (lastUser && !messages.some((m) => m.role === "user" && m.content.includes(lastUser.content.slice(0, 80)))) {
    messages.push({ role: "user", content: compactText(lastUser.content, 4_000) });
    messages = compactChatMessages(messages, targetChars);
  }
  return messages;
}

function forceFitMessagesToTokenBudget(
  input: MessageLike[],
  targetTokens: number,
): MessageLike[] {
  const messages = input.map((message) => ({ ...message }));

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const currentTokens = estimateMessagesTokens(messages);
    if (currentTokens <= targetTokens) return messages;

    const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
    let candidateIndex = -1;
    let candidateLength = -1;

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const minimumLength = index === lastUserIndex || message.role === "system" ? 32 : 16;
      if (message.content.length > minimumLength && message.content.length > candidateLength) {
        candidateIndex = index;
        candidateLength = message.content.length;
      }
    }

    if (candidateIndex < 0) {
      const removableIndex = messages.findIndex(
        (message, index) => message.role !== "system" && index !== lastUserIndex,
      );
      if (removableIndex >= 0) {
        messages.splice(removableIndex, 1);
        continue;
      }
      break;
    }

    const message = messages[candidateIndex];
    const minimumLength = candidateIndex === lastUserIndex || message.role === "system" ? 32 : 16;
    const proportionalLength = Math.floor(
      message.content.length * Math.max(0.1, Math.min(0.85, (targetTokens / currentTokens) * 0.9)),
    );
    const overflowLength = message.content.length - Math.max(32, (currentTokens - targetTokens) * 2);
    const nextLength = Math.max(
      minimumLength,
      Math.min(message.content.length - 1, proportionalLength, overflowLength),
    );
    message.content = compactText(message.content, nextLength);
  }

  const afterTokens = estimateMessagesTokens(messages);
  if (afterTokens > targetTokens) {
    throw new Error(`上下文压缩失败：${afterTokens} tokens 仍超过目标预算 ${targetTokens} tokens`);
  }
  return messages;
}

/**
 * Token-aware compaction driven by maxContextTokens + compressionPeak/Target.
 * rules: 折叠 + 截断；hybrid 在仍超标时可再走 summarize 回调。
 */
export function compactMessagesToBudget(
  input: MessageLike[],
  configInput?: Partial<ContextBudgetConfig> | null,
): CompactResult {
  const config = normalizeContextBudget(configInput);
  const beforeTokens = estimateMessagesTokens(input);
  const trigger = getCompressionTriggerTokens(config);
  if (beforeTokens < trigger) {
    return {
      messages: input.map((m) => ({ ...m })),
      compressed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      mode: "none",
    };
  }

  const targetTokens = getCompressionTargetTokens(config);
  const targetChars = Math.max(1_000, targetTokens * 3);
  const messages = forceFitMessagesToTokenBudget(
    applyRulesCompression(input, targetChars),
    targetTokens,
  );
  const afterTokens = estimateMessagesTokens(messages);
  return { messages, compressed: true, beforeTokens, afterTokens, mode: "rules" };
}

export type HybridSummarizer = (middleText: string) => Promise<string>;

export function isValidCompressionSummary(content: string): boolean {
  const cleaned = stripToolContext(content).trim();
  if (cleaned.length < 20) return false;
  if (
    /^(?:API 错误|LLM API 错误|LLM 请求失败|Responses API failed|Non-stream request failed|(?:OpenAI|Anthropic|MiniMax|Responses?) stream error|Error|错误)\s*[:：-]/i.test(
      cleaned,
    )
  ) return false;
  try {
    const parsed = JSON.parse(cleaned) as { error?: unknown; status?: unknown; success?: unknown };
    if (
      parsed
      && typeof parsed === "object"
      && (parsed.error || parsed.status === "failed" || parsed.status === "error" || parsed.success === false)
    ) return false;
  } catch {
    // Plain-text summary is expected.
  }
  return true;
}

/**
 * hybrid：从原始历史提取中间段做摘要；失败时回退 rules。
 */
export async function compactMessagesToBudgetAsync(
  input: MessageLike[],
  configInput?: Partial<ContextBudgetConfig> | null,
  summarize?: HybridSummarizer,
): Promise<CompactResult> {
  const config = normalizeContextBudget(configInput);
  const beforeTokens = estimateMessagesTokens(input);
  if (beforeTokens < getCompressionTriggerTokens(config)) {
    return {
      messages: input.map((message) => ({ ...message })),
      compressed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      mode: "none",
    };
  }
  if (config.compressionMode !== "hybrid" || !summarize) {
    return compactMessagesToBudget(input, config);
  }

  const system = input[0]?.role === "system" ? { ...input[0] } : null;
  const bodyStart = system ? 1 : 0;
  const lastUserIndex = input.findLastIndex((message) => message.role === "user");
  const recentStart = lastUserIndex >= bodyStart
    ? Math.max(bodyStart, lastUserIndex - (input.length - bodyStart >= 5 ? 2 : 0))
    : Math.max(bodyStart, input.length - 2);
  const middle = input.slice(bodyStart, recentStart);
  const recent = input.slice(recentStart).map((message) => ({
    ...message,
    content: stripToolContext(message.content),
  }));
  if (middle.length === 0) return compactMessagesToBudget(input, config);

  const middleText = middle
    .map((m) => `${m.role}: ${compactText(stripToolContext(m.content), 8_000)}`)
    .join("\n\n")
    .slice(0, 48_000);

  try {
    const summaryText = await summarize(middleText);
    const cleaned = stripToolContext(summaryText).trim();
    if (!isValidCompressionSummary(cleaned)) {
      return compactMessagesToBudget(input, config);
    }
    const summaryMessage: MessageLike = {
      role: "assistant",
      content: `【LLM 上下文摘要】\n${cleaned.slice(0, 6_000)}`,
    };
    const merged: MessageLike[] = [];
    if (system) merged.push(system);
    merged.push(summaryMessage);
    merged.push(...recent);
    const targetTokens = getCompressionTargetTokens(config);
    const finalMessages = forceFitMessagesToTokenBudget(merged, targetTokens);
    return {
      messages: finalMessages,
      compressed: true,
      beforeTokens,
      afterTokens: estimateMessagesTokens(finalMessages),
      mode: "hybrid",
    };
  } catch {
    return compactMessagesToBudget(input, config);
  }
}
