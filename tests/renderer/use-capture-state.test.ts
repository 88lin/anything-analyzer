import { describe, expect, it } from "vitest";
import {
  INITIAL_CAPTURE_STATE,
  prepareStateForAnalysis,
} from "../../src/renderer/hooks/useCapture";

describe("useCapture analysis state", () => {
  it("drops the previous report and follow-up conversation before re-analysis", () => {
    const previous = {
      ...INITIAL_CAPTURE_STATE,
      reports: [
        {
          id: "report-old",
          session_id: "session-1",
          created_at: 1,
          llm_provider: "openai",
          llm_model: "gpt-old",
          prompt_tokens: 10,
          completion_tokens: 5,
          report_content: "old report",
          filter_prompt_tokens: null,
          filter_completion_tokens: null,
        },
      ],
      chatHistory: [
        { role: "system" as const, content: "system" },
        { role: "assistant" as const, content: "old report" },
        { role: "user" as const, content: "old question" },
        { role: "assistant" as const, content: "old answer" },
      ],
      latestContextUsage: {
        promptTokens: 123,
        provider: "openai",
        model: "gpt-old",
        logId: 9,
        type: "chat" as const,
        createdAt: 2,
      },
      isChatting: true,
      chatError: "old chat error",
      streamingContent: "old stream",
      analysisError: "old analysis error",
    };

    const next = prepareStateForAnalysis(previous);

    expect(next.reports).toEqual([]);
    expect(next.chatHistory).toEqual([]);
    expect(next.latestContextUsage).toBeNull();
    expect(next.isAnalyzing).toBe(true);
    expect(next.isChatting).toBe(false);
    expect(next.streamingContent).toBe("");
    expect(next.analysisError).toBeNull();
    expect(next.chatError).toBeNull();
  });
});
