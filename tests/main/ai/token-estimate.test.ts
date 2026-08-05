import { describe, expect, it, beforeEach } from "vitest";
import {
  buildContextUsageSnapshot,
  calibrateTokenEstimate,
  estimateMessagesTokensByContent,
  estimateTextTokens,
  estimateTextTokensRaw,
  findLatestConversationTokenUsage,
  findLatestConversationPromptTokens,
  formatContextUsagePercent,
  getTokenEstimateCalibration,
  resolveContextUsedTokens,
  resetTokenEstimateCalibration,
} from "../../../src/shared/token-estimate";

describe("token-estimate", () => {
  beforeEach(() => {
    resetTokenEstimateCalibration();
  });

  it("counts CJK heavier than ASCII", () => {
    const ascii = estimateTextTokensRaw("a".repeat(100));
    const cjk = estimateTextTokensRaw("中".repeat(100));
    expect(cjk).toBeGreaterThan(ascii);
  });

  it("calibrates with EMA from real usage", () => {
    const raw = estimateTextTokensRaw("hello world ".repeat(100));
    calibrateTokenEstimate(raw, Math.round(raw * 1.4));
    calibrateTokenEstimate(raw, Math.round(raw * 1.4));
    const cal = getTokenEstimateCalibration();
    expect(cal.samples).toBeGreaterThan(0);
    expect(cal.ratio).toBeGreaterThan(1.05);
    expect(estimateTextTokens("hello world ".repeat(100))).toBeGreaterThan(raw);
  });

  it("builds usage snapshot with peak flags", () => {
    const used = 90_000;
    const snap = buildContextUsageSnapshot(used, {
      maxContextTokens: 100_000,
      reserveCompletionTokens: 10_000,
      compressionPeak: 0.85,
    });
    expect(snap.usableTokens).toBe(90_000);
    expect(snap.remainingTokens).toBe(0);
    expect(snap.usageRatio).toBeCloseTo(1, 5);
    expect(snap.overPeak).toBe(true);
  });

  it("reports remaining usable tokens and preserves sub-percent usage", () => {
    const snap = buildContextUsageSnapshot(351, {
      maxContextTokens: 200_000,
      reserveCompletionTokens: 8_192,
    });

    expect(snap.usableTokens).toBe(191_808);
    expect(snap.remainingTokens).toBe(191_457);
    expect(formatContextUsagePercent(snap.absoluteRatio)).toBe("0.2%");
  });

  it("estimates multi-message content", () => {
    const n = estimateMessagesTokensByContent([
      { content: "system" },
      { content: "用户问题" },
    ]);
    expect(n).toBeGreaterThan(0);
  });

  it("uses the latest analyze/chat prompt tokens instead of output or auxiliary usage", () => {
    const latest = findLatestConversationPromptTokens([
      { id: 10, type: "analyze", prompt_tokens: 12_000, completion_tokens: 900, error: null },
      { id: 11, type: "compress", prompt_tokens: 4_000, completion_tokens: 600, error: null },
      { id: 12, type: "chat", prompt_tokens: 18_000, completion_tokens: 8_000, error: null },
    ]);

    expect(latest).toBe(18_000);
  });

  it("keeps context usage scoped to the current report conversation", () => {
    const latest = findLatestConversationTokenUsage([
      {
        id: 35,
        type: "analyze",
        report_id: null,
        created_at: 1_000,
        provider: "openai",
        model: "grok-4.5",
        prompt_tokens: 250_011,
        completion_tokens: 4_991,
        error: null,
      },
      {
        id: 40,
        type: "chat",
        report_id: "report-1",
        created_at: 2_000,
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        prompt_tokens: 15_555,
        completion_tokens: 1_335,
        error: null,
      },
      {
        id: 44,
        type: "analyze",
        report_id: null,
        created_at: 4_000,
        provider: "anthropic",
        model: "claude-sonnet-4.5",
        prompt_tokens: 57_319,
        completion_tokens: 74,
        error: null,
      },
    ], {
      id: "report-1",
      created_at: 1_100,
    });

    expect(latest).toEqual({
      logId: 40,
      type: "chat",
      provider: "anthropic",
      model: "claude-sonnet-4.5",
      promptTokens: 15_555,
      completionTokens: 1_335,
    });
  });

  it("does not reuse report analysis usage before the first follow-up", () => {
    const latest = findLatestConversationTokenUsage([
      {
        id: 35,
        type: "analyze",
        report_id: null,
        created_at: 1_000,
        provider: "openai",
        model: "grok-4.5",
        prompt_tokens: 250_011,
        completion_tokens: 4_991,
        error: null,
      },
    ], {
      id: "report-1",
      created_at: 1_100,
    });

    expect(latest).toBeNull();
  });

  it("counts latest input and output as the next request base context", () => {
    const used = resolveContextUsedTokens({
      latestUsage: {
        promptTokens: 15_555,
        completionTokens: 1_335,
      },
      fallbackMessages: [{ content: "x".repeat(100_000) }],
    });

    expect(used).toBe(16_890);
  });
});
