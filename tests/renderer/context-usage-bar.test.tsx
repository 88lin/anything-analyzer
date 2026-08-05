import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ContextUsageBar from "../../src/renderer/components/ContextUsageBar";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("ContextUsageBar", () => {
  it("presents usage against usable capacity and explains the reserved output budget", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider locale="zh">
        <ContextUsageBar
          usedTokens={2_359}
          maxContextTokens={200_000}
          usableTokens={191_808}
          remainingTokens={189_449}
          reserveCompletionTokens={8_192}
          peakRatio={0.85}
          usageRatio={2_359 / 191_808}
        />
      </LocaleProvider>,
    );

    expect(markup).toContain("上下文用量");
    expect(markup).toContain("2,359 / 191,808");
    expect(markup).toContain("1.2%");
    expect(markup).toContain("可用 189,449");
    expect(markup).toContain("达到 85% 自动压缩");
    expect(markup).toContain("模型上限 200,000 · 预留输出 8,192 · 可用 189,449");
  });
});
