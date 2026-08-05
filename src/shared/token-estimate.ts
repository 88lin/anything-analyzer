/**
 * 轻量 token 估算：比 chars/4 更贴近中英混合协议分析场景。
 * 支持用真实 usage 做 EMA 校准。
 */

export interface TokenEstimateCalibration {
  /** actual / rawEstimate 的平滑系数，默认 1 */
  ratio: number;
  samples: number;
}

let calibration: TokenEstimateCalibration = { ratio: 1, samples: 0 };

export function getTokenEstimateCalibration(): TokenEstimateCalibration {
  return { ...calibration };
}

export function resetTokenEstimateCalibration(): void {
  calibration = { ratio: 1, samples: 0 };
}

export function setTokenEstimateCalibration(next: TokenEstimateCalibration): void {
  if (!next || !Number.isFinite(next.ratio) || next.ratio <= 0) return;
  calibration = {
    ratio: Math.min(3, Math.max(0.3, next.ratio)),
    samples: Math.max(0, Math.floor(next.samples || 0)),
  };
}

/**
 * 用 API 返回的真实 prompt_tokens 校准本地估算。
 * 仅在样本足够大时更新，避免噪声。
 */
export function calibrateTokenEstimate(estimatedRaw: number, actualPromptTokens: number): void {
  if (!Number.isFinite(estimatedRaw) || !Number.isFinite(actualPromptTokens)) return;
  if (estimatedRaw < 200 || actualPromptTokens <= 0) return;
  const sample = actualPromptTokens / estimatedRaw;
  if (sample < 0.3 || sample > 3) return; // 异常样本丢弃
  const alpha = calibration.samples === 0 ? 1 : 0.25;
  calibration = {
    ratio: calibration.ratio * (1 - alpha) + sample * alpha,
    samples: calibration.samples + 1,
  };
}

/** 未校准原始估算 */
export function estimateTextTokensRaw(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      // ASCII：约 4 字符 1 token
      tokens += 0.25;
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
      (code >= 0xf900 && code <= 0xfaff) // CJK Compatibility
    ) {
      tokens += 1.3;
    } else if (code >= 0x80 && code <= 0x24f) {
      // Latin-1 / Latin Extended
      tokens += 0.5;
    } else {
      tokens += 0.8;
    }
  }
  return Math.max(0, Math.ceil(tokens));
}

/** 校准后的估算 */
export function estimateTextTokens(text: string): number {
  const raw = estimateTextTokensRaw(text);
  return Math.max(0, Math.ceil(raw * calibration.ratio));
}

export function estimateMessagesTokensByContent(
  messages: Array<{ content: string }>,
  perMessageOverhead = 4,
): number {
  return messages.reduce((sum, m) => sum + estimateTextTokens(m.content) + perMessageOverhead, 0);
}

interface PromptUsageLog {
  id: number;
  type: string;
  report_id?: string | null;
  created_at?: number;
  provider?: string;
  model?: string;
  prompt_tokens: number;
  completion_tokens?: number;
  error: string | null;
}

interface PromptUsageReportScope {
  id: string;
  created_at: number;
}

export interface ConversationTokenUsage {
  logId: number;
  type: string;
  provider?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
}

export function findLatestConversationTokenUsage(
  logs: PromptUsageLog[],
  report?: PromptUsageReportScope | null,
): ConversationTokenUsage | null {
  const successful = logs.filter((log) =>
    (log.type === "analyze" || log.type === "chat")
    && !log.error
    && Number.isFinite(log.prompt_tokens)
    && log.prompt_tokens > 0,
  );
  const latestOf = (items: PromptUsageLog[]): PromptUsageLog | undefined =>
    [...items].sort((a, b) => b.id - a.id)[0];

  if (report) {
    const latestChat = latestOf(successful.filter((log) =>
      log.type === "chat" && log.report_id === report.id,
    ));
    if (!latestChat) return null;
    return {
      logId: latestChat.id,
      type: latestChat.type,
      provider: latestChat.provider,
      model: latestChat.model,
      promptTokens: latestChat.prompt_tokens,
      completionTokens: latestChat.completion_tokens ?? 0,
    };
  }

  const latest = latestOf(successful);
  if (!latest) return null;
  return {
    logId: latest.id,
    type: latest.type,
    provider: latest.provider,
    model: latest.model,
    promptTokens: latest.prompt_tokens,
    completionTokens: latest.completion_tokens ?? 0,
  };
}

export function findLatestConversationPromptTokens(
  logs: PromptUsageLog[],
  report?: PromptUsageReportScope | null,
): number | null {
  return findLatestConversationTokenUsage(logs, report)?.promptTokens ?? null;
}

export function resolveContextUsedTokens(input: {
  latestUsage?: Pick<ConversationTokenUsage, "promptTokens" | "completionTokens"> | null;
  fallbackMessages: Array<{ content: string }>;
}): number {
  // 上次请求输入已包含此前历史；加上本次输出，即下一次请求前的基础上下文。
  if (input.latestUsage && input.latestUsage.promptTokens > 0) {
    return input.latestUsage.promptTokens + Math.max(0, input.latestUsage.completionTokens);
  }
  return estimateMessagesTokensByContent(input.fallbackMessages);
}

export interface ContextUsageSnapshot {
  usedTokens: number;
  maxContextTokens: number;
  usableTokens: number;
  remainingTokens: number;
  reserveCompletionTokens: number;
  peakRatio: number;
  /** 0..1+ relative to usable */
  usageRatio: number;
  /** 0..1+ relative to max */
  absoluteRatio: number;
  nearPeak: boolean;
  overPeak: boolean;
}

export function formatContextUsagePercent(ratio: number): string {
  const percentage = Math.max(0, ratio * 100);
  if (!Number.isFinite(percentage) || percentage === 0) return "0%";
  if (percentage < 0.1) return "<0.1%";
  if (percentage < 10) return `${percentage.toFixed(1)}%`;
  return `${Math.round(percentage)}%`;
}

export function buildContextUsageSnapshot(
  usedTokens: number,
  opts: {
    maxContextTokens?: number;
    reserveCompletionTokens?: number;
    compressionPeak?: number;
  } = {},
): ContextUsageSnapshot {
  const maxContextTokens = Math.max(4096, opts.maxContextTokens ?? 200_000);
  const reserveCompletionTokens = Math.max(256, opts.reserveCompletionTokens ?? 8_192);
  const peakRatio = Math.min(0.95, Math.max(0.5, opts.compressionPeak ?? 0.85));
  const usableTokens = Math.max(1024, maxContextTokens - reserveCompletionTokens);
  const usageRatio = usedTokens / usableTokens;
  return {
    usedTokens,
    maxContextTokens,
    usableTokens,
    remainingTokens: Math.max(0, usableTokens - usedTokens),
    reserveCompletionTokens,
    peakRatio,
    usageRatio,
    absoluteRatio: usedTokens / maxContextTokens,
    nearPeak: usageRatio >= peakRatio * 0.85,
    overPeak: usageRatio >= peakRatio,
  };
}
