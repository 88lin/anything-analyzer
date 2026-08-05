import { describe, expect, it, vi } from "vitest";
import {
  applyModelOverride,
  fetchLLMModels,
} from "../../../src/main/ai/model-catalog";
import type { LLMProviderConfig } from "../../../src/shared/types";

const openAIConfig: LLMProviderConfig = {
  name: "openai",
  apiType: "responses",
  baseUrl: "https://api.openai.com/v1/",
  apiKey: "sk-test",
  model: "gpt-5",
  maxTokens: 4096,
};

describe("model catalog", () => {
  it("loads, normalizes, de-duplicates and sorts OpenAI-compatible models", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          { id: "gpt-5-mini" },
          { id: "gpt-5" },
          { id: "gpt-5-mini" },
          { id: "  " },
        ],
      }), { status: 200 }),
    );

    await expect(fetchLLMModels(openAIConfig, fetchImpl)).resolves.toEqual([
      "gpt-5",
      "gpt-5-mini",
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    );
  });

  it("uses Anthropic authentication headers for Anthropic-compatible providers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ id: "claude-sonnet-4-5" }],
      }), { status: 200 }),
    );
    const config: LLMProviderConfig = {
      ...openAIConfig,
      name: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-key",
      model: "claude-sonnet-4-5",
    };

    await fetchLLMModels(config, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "anthropic-key",
          "anthropic-version": "2023-06-01",
        }),
      }),
    );
  });

  it("reports provider errors without leaking the API key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `invalid key ${openAIConfig.apiKey}` } }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    await expect(fetchLLMModels(openAIConfig, fetchImpl)).rejects.toThrow(
      "加载模型列表失败 (401): invalid key [REDACTED]",
    );
    await expect(fetchLLMModels(openAIConfig, fetchImpl)).rejects.not.toThrow(
      openAIConfig.apiKey,
    );
  });

  it("applies a trimmed per-request model without mutating the saved config", () => {
    const overridden = applyModelOverride(openAIConfig, "  gpt-5-mini  ");

    expect(overridden.model).toBe("gpt-5-mini");
    expect(openAIConfig.model).toBe("gpt-5");
    expect(applyModelOverride(openAIConfig, "  ")).toBe(openAIConfig);
  });
});
