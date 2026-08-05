import type { LLMProviderConfig } from "@shared/types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MODEL_ENDPOINT_SUFFIXES = [
  "/chat/completions",
  "/responses",
  "/messages",
] as const;

function resolveModelsUrl(baseUrl: string): string {
  let root = baseUrl.trim().replace(/\/+$/, "");
  for (const suffix of MODEL_ENDPOINT_SUFFIXES) {
    if (root.toLowerCase().endsWith(suffix)) {
      root = root.slice(0, -suffix.length);
      break;
    }
  }
  return `${root}/models`;
}

function readProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function redactSecret(message: string, secret: string): string {
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("加载模型列表失败: 响应格式不正确");
  }

  const record = payload as Record<string, unknown>;
  const candidates = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : null;

  if (!candidates) {
    throw new Error("加载模型列表失败: 响应中缺少模型数组");
  }

  const models = new Set<string>();
  for (const candidate of candidates) {
    const rawId = typeof candidate === "string"
      ? candidate
      : candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>).id
          ?? (candidate as Record<string, unknown>).name
        : null;
    if (typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (id) models.add(id);
  }

  return [...models].sort((a, b) => a.localeCompare(b));
}

export function applyModelOverride(
  config: LLMProviderConfig,
  model?: string,
): LLMProviderConfig {
  const normalized = model?.trim();
  return normalized ? { ...config, model: normalized } : config;
}

export async function fetchLLMModels(
  config: LLMProviderConfig,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  if (!config.baseUrl.trim()) {
    throw new Error("加载模型列表失败: Base URL 不能为空");
  }
  if (!config.apiKey.trim()) {
    throw new Error("加载模型列表失败: API Key 不能为空");
  }

  const anthropicCompatible = config.name === "anthropic" || config.name === "minimax";
  const headers: Record<string, string> = anthropicCompatible
    ? {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      }
    : {
        Authorization: `Bearer ${config.apiKey}`,
      };

  let response: Response;
  try {
    response = await fetchImpl(resolveModelsUrl(config.baseUrl), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`加载模型列表失败: ${message}`);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The status-based error below remains useful when a provider returns HTML/plain text.
  }

  if (!response.ok) {
    const message = redactSecret(
      readProviderError(payload, response.statusText || "请求失败"),
      config.apiKey,
    );
    throw new Error(`加载模型列表失败 (${response.status}): ${message}`);
  }

  return extractModelIds(payload);
}
