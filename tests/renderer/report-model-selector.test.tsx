import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ReportView from "../../src/renderer/components/ReportView";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("ReportView model selector", () => {
  it("renders the loaded model list and keeps the selected analysis model", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider locale="zh">
        <ReportView
          report={{
            id: "report-1",
            session_id: "session-1",
            created_at: 1,
            llm_provider: "openai",
            llm_model: "gpt-5",
            prompt_tokens: 10,
            completion_tokens: 5,
            report_content: "report",
            filter_prompt_tokens: null,
            filter_completion_tokens: null,
          }}
          isAnalyzing={false}
          analysisError={null}
          streamingContent=""
          onReAnalyze={vi.fn()}
          onCancelAnalysis={vi.fn()}
          chatHistory={[]}
          isChatting={false}
          chatError={null}
          onSendFollowUp={vi.fn()}
          availableModels={["gpt-5", "gpt-5-mini"]}
          selectedModel="gpt-5-mini"
          onModelChange={vi.fn()}
          onRefreshModels={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(markup).toContain("分析模型");
    expect(markup).toContain('<option value="gpt-5">gpt-5</option>');
    expect(markup).toContain('<option value="gpt-5-mini" selected="">gpt-5-mini</option>');
    expect(markup).toContain('title="刷新模型列表"');
  });
});
