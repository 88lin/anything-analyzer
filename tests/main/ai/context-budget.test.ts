import { describe, expect, it } from "vitest";
import {
  compactChatMessages,
  compactMessagesToBudget,
  compactMessagesToBudgetAsync,
  estimateMessagesTokens,
  foldMiddleHistory,
  getCompressionTargetTokens,
  getCompressionTriggerTokens,
  isValidCompressionSummary,
  normalizeContextBudget,
  shouldCompress,
} from "../../../src/main/ai/context-budget";

describe("context budget", () => {
  it("compacts oversized follow-up history without an extra LLM request", () => {
    const history = [
      { role: "system", content: "system" },
      { role: "assistant", content: "report-".repeat(20_000) },
      { role: "user", content: "请检查请求 #1" },
      { role: "assistant", content: "answer-".repeat(5_000) + "\n<tool_context>large detail</tool_context>" },
      { role: "user", content: "继续检查" },
    ];

    const compacted = compactChatMessages(history, 4_000);

    expect(compacted.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(4_000);
    expect(compacted.some((message) => message.content.includes("继续检查"))).toBe(true);
    expect(compacted.map((message) => message.content).join("\n")).not.toContain("<tool_context>large detail</tool_context>");
  });

  it("uses 200k/85% defaults", () => {
    const config = normalizeContextBudget();
    expect(config.maxContextTokens).toBe(200_000);
    expect(config.compressionPeak).toBe(0.85);
    expect(config.compressionTarget).toBe(0.55);
    expect(config.contextMode).toBe("index_first");
    expect(config.subagentEnabled).toBe(true);
    expect(config.subagentThreshold).toBe(400);
    expect(config.maxSubagents).toBe(3);
  });

  it("compresses when estimated tokens hit peak", () => {
    const config = normalizeContextBudget({
      maxContextTokens: 8_000,
      reserveCompletionTokens: 1_000,
      compressionPeak: 0.85,
      compressionTarget: 0.55,
    });
    const trigger = getCompressionTriggerTokens(config);
    const big = "x".repeat(trigger * 4 + 200);
    const messages = [
      { role: "system" as const, content: "system prompt" },
      { role: "user" as const, content: big },
      { role: "assistant" as const, content: "old answer ".repeat(2_000) },
      { role: "user" as const, content: "继续分析登录请求" },
    ];

    expect(shouldCompress(messages, config)).toBe(true);
    const packed = compactMessagesToBudget(messages, config);
    expect(packed.compressed).toBe(true);
    expect(packed.afterTokens).toBeLessThanOrEqual(Math.floor((8_000 - 1_000) * 0.55));
    expect(packed.messages.some((m) => m.content.includes("继续分析登录请求"))).toBe(true);
    expect(estimateMessagesTokens(packed.messages)).toBe(packed.afterTokens);
  });

  it("forces two-message CJK context below the target budget", () => {
    const config = normalizeContextBudget({
      maxContextTokens: 4_096,
      reserveCompletionTokens: 512,
      compressionPeak: 0.5,
      compressionTarget: 0.25,
    });
    const messages = [
      { role: "system" as const, content: "协议分析规则。".repeat(4_000) },
      { role: "user" as const, content: "请继续检查鉴权链" },
    ];

    const packed = compactMessagesToBudget(messages, config);

    expect(packed.afterTokens).toBeLessThanOrEqual(Math.floor((4_096 - 512) * 0.25));
    expect(packed.messages.some((message) => message.content.includes("请继续检查鉴权链"))).toBe(true);
  });

  it("folds middle history into summary bullets", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "看 #1 登录" },
      { role: "assistant" as const, content: "登录依赖 #1" },
      { role: "user" as const, content: "再看 #2" },
      { role: "assistant" as const, content: "#2 是 profile" },
      { role: "user" as const, content: "最新问题" },
      { role: "assistant" as const, content: "最新回答" },
    ];
    const folded = foldMiddleHistory(messages, 1);
    expect(folded.some((m) => m.content.includes("上下文折叠摘要"))).toBe(true);
    expect(folded.some((m) => m.content.includes("最新问题") || m.content.includes("最新回答"))).toBe(true);
  });

  it("hybrid mode can replace middle history via summarizer", async () => {
    const config = normalizeContextBudget({
      maxContextTokens: 4_000,
      reserveCompletionTokens: 500,
      compressionPeak: 0.5,
      compressionTarget: 0.3,
      compressionMode: "hybrid",
    });
    const bulky = "detail-".repeat(3_000);
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: bulky },
      { role: "assistant" as const, content: bulky },
      { role: "user" as const, content: bulky },
      { role: "assistant" as const, content: bulky },
      { role: "user" as const, content: "请继续只关注鉴权链" },
    ];
    let summarizedInput = "";
    const packed = await compactMessagesToBudgetAsync(messages, config, async (middleText) => {
      summarizedInput = middleText;
      return "摘要：已确认鉴权依赖请求 #1/#2，仍需验证刷新令牌链路。";
    });
    expect(packed.compressed).toBe(true);
    expect(packed.mode).toBe("hybrid");
    expect(summarizedInput).toContain("detail-");
    expect(packed.afterTokens).toBeLessThanOrEqual(getCompressionTargetTokens(config));
    expect(packed.messages.some((m) => m.content.includes("请继续只关注鉴权链") || m.content.includes("鉴权"))).toBe(true);
  });

  it("falls back to rules when the hybrid summarizer fails", async () => {
    const config = normalizeContextBudget({
      maxContextTokens: 4_096,
      reserveCompletionTokens: 512,
      compressionPeak: 0.5,
      compressionTarget: 0.3,
      compressionMode: "hybrid",
    });
    const bulky = "历史请求详情".repeat(3_000);
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "assistant" as const, content: bulky },
      { role: "user" as const, content: bulky },
      { role: "assistant" as const, content: bulky },
      { role: "user" as const, content: "继续验证 #9" },
    ];

    const packed = await compactMessagesToBudgetAsync(messages, config, async () => {
      throw new Error("summary unavailable");
    });

    expect(packed.mode).toBe("rules");
    expect(packed.afterTokens).toBeLessThanOrEqual(Math.floor((4_096 - 512) * 0.3));
  });

  it("falls back to rules when the hybrid summarizer returns an API error", async () => {
    const config = normalizeContextBudget({
      maxContextTokens: 4_096,
      reserveCompletionTokens: 512,
      compressionPeak: 0.5,
      compressionTarget: 0.3,
      compressionMode: "hybrid",
    });
    const bulky = "old-history-".repeat(3_000);
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "assistant" as const, content: bulky },
      { role: "user" as const, content: bulky },
      { role: "assistant" as const, content: bulky },
      { role: "user" as const, content: "继续验证 #10" },
    ];

    const packed = await compactMessagesToBudgetAsync(
      messages,
      config,
      async () => "LLM 请求失败: timeout while summarizing",
    );

    expect(packed.mode).toBe("rules");
    expect(packed.afterTokens).toBeLessThanOrEqual(getCompressionTargetTokens(config));
  });

  it("rejects upstream errors as compression summaries", () => {
    expect(isValidCompressionSummary("API 错误: model unavailable")).toBe(false);
    expect(isValidCompressionSummary("LLM 请求失败: timeout")).toBe(false);
    expect(isValidCompressionSummary("Responses API failed: incomplete")).toBe(false);
    expect(isValidCompressionSummary("OpenAI stream error: malformed JSON payload")).toBe(false);
    expect(isValidCompressionSummary('{"error":"rate limited"}')).toBe(false);
    expect(isValidCompressionSummary('{"message":"已确认请求 #12 是登录入口，后续需要验证令牌使用。"}')).toBe(true);
    expect(isValidCompressionSummary("摘要：已确认登录请求 #12 返回 access token，后续 #15 使用该凭据。")).toBe(true);
  });
});
