import { describe, expect, it, beforeEach } from "vitest";
import {
  buildContextUsageSnapshot,
  calibrateTokenEstimate,
  estimateMessagesTokensByContent,
  estimateTextTokens,
  estimateTextTokensRaw,
  findLatestConversationPromptTokens,
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
    expect(snap.usageRatio).toBeCloseTo(1, 5);
    expect(snap.overPeak).toBe(true);
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

  it("prefers actual prompt usage and never adds completion tokens", () => {
    const used = resolveContextUsedTokens({
      latestPromptTokens: 18_000,
      reportPromptTokens: 12_000,
      fallbackMessages: [{ content: "x".repeat(100_000) }],
    });

    expect(used).toBe(18_000);
  });
});
