import type { RequestSummary } from "@shared/types";

export interface SubagentFinding {
  finding: string;
  relatedSeqs: number[];
  confidence?: "high" | "medium" | "low";
}

export interface SubagentWorkerInput {
  chunkIndex: number;
  totalChunks: number;
  summaries: RequestSummary[];
  prompt: string;
}

export type SubagentWorker = (input: SubagentWorkerInput) => Promise<string>;

export interface SubagentAnalyzerOptions {
  threshold?: number;
  chunkSize?: number;
  maxConcurrency?: number;
  maxFindings?: number;
  maxFindingChars?: number;
}

export interface SubagentAnalysisResult {
  applied: boolean;
  totalRequests: number;
  chunkCount: number;
  succeededChunks: number;
  failedChunks: number;
  findings: SubagentFinding[];
  relatedSeqs: number[];
  compactSummary: string;
}

const DEFAULT_OPTIONS: Required<SubagentAnalyzerOptions> = {
  threshold: 120,
  chunkSize: 40,
  maxConcurrency: 4,
  maxFindings: 12,
  maxFindingChars: 240,
};

export class SubagentAnalyzer {
  private readonly options: Required<SubagentAnalyzerOptions>;

  constructor(
    private readonly worker: SubagentWorker,
    options: SubagentAnalyzerOptions = {},
  ) {
    this.options = {
      threshold: Math.max(0, Math.floor(options.threshold ?? DEFAULT_OPTIONS.threshold)),
      chunkSize: Math.max(1, Math.floor(options.chunkSize ?? DEFAULT_OPTIONS.chunkSize)),
      maxConcurrency: Math.max(1, Math.floor(options.maxConcurrency ?? DEFAULT_OPTIONS.maxConcurrency)),
      maxFindings: Math.max(1, Math.floor(options.maxFindings ?? DEFAULT_OPTIONS.maxFindings)),
      maxFindingChars: Math.max(32, Math.floor(options.maxFindingChars ?? DEFAULT_OPTIONS.maxFindingChars)),
    };
  }

  async analyze(summaries: RequestSummary[]): Promise<SubagentAnalysisResult> {
    if (summaries.length <= this.options.threshold) {
      return {
        applied: false,
        totalRequests: summaries.length,
        chunkCount: 0,
        succeededChunks: 0,
        failedChunks: 0,
        findings: [],
        relatedSeqs: [],
        compactSummary: "",
      };
    }

    const chunks = this.chunk(summaries);
    const outputs = await this.runChunks(chunks);
    const findings = this.aggregateFindings(outputs.flatMap((output) => output.findings))
      .slice(0, this.options.maxFindings);
    const relatedSeqs = [...new Set(findings.flatMap((finding) => finding.relatedSeqs))].sort((a, b) => a - b);

    return {
      applied: true,
      totalRequests: summaries.length,
      chunkCount: chunks.length,
      succeededChunks: outputs.length,
      failedChunks: chunks.length - outputs.length,
      findings,
      relatedSeqs,
      compactSummary: this.formatCompactSummary(findings, relatedSeqs),
    };
  }

  private chunk(summaries: RequestSummary[]): RequestSummary[][] {
    const chunks: RequestSummary[][] = [];
    for (let start = 0; start < summaries.length; start += this.options.chunkSize) {
      chunks.push(summaries.slice(start, start + this.options.chunkSize));
    }
    return chunks;
  }

  private async runChunks(chunks: RequestSummary[][]): Promise<Array<{ findings: SubagentFinding[] }>> {
    const outputs: Array<{ findings: SubagentFinding[] } | undefined> = new Array(chunks.length);
    let nextChunk = 0;
    const runner = async (): Promise<void> => {
      while (nextChunk < chunks.length) {
        const chunkIndex = nextChunk;
        nextChunk += 1;
        const chunk = chunks[chunkIndex];
        try {
          const raw = await this.worker({
            chunkIndex,
            totalChunks: chunks.length,
            summaries: chunk,
            prompt: this.buildPrompt(chunk, chunkIndex, chunks.length),
          });
          outputs[chunkIndex] = this.parseWorkerOutput(raw, new Set(chunk.map((item) => item.seq)));
        } catch {
          outputs[chunkIndex] = undefined;
        }
      }
    };
    const runners = Array.from(
      { length: Math.min(this.options.maxConcurrency, chunks.length) },
      () => runner(),
    );
    await Promise.all(runners);
    return outputs.filter((output): output is { findings: SubagentFinding[] } => output !== undefined);
  }

  private parseWorkerOutput(raw: string, allowedSeqs: Set<number>): { findings: SubagentFinding[] } {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!this.isRecord(parsed) || Object.keys(parsed).some((key) => key !== "findings")) {
      throw new Error("Subagent output must be a JSON object containing only findings");
    }
    if (!Array.isArray(parsed.findings)) {
      throw new Error("Subagent findings must be an array");
    }

    const findings = parsed.findings.map((candidate) => {
      if (!this.isRecord(candidate)) {
        throw new Error("Each subagent finding must be a JSON object");
      }
      const keys = Object.keys(candidate);
      if (keys.some((key) => !["finding", "relatedSeqs", "confidence"].includes(key))) {
        throw new Error("Subagent finding contains unknown fields");
      }
      if (typeof candidate.finding !== "string" || candidate.finding.trim().length === 0) {
        throw new Error("Subagent finding text must be a non-empty string");
      }
      if (!Array.isArray(candidate.relatedSeqs)) {
        throw new Error("Subagent relatedSeqs must be an array");
      }
      if (
        candidate.confidence !== undefined
        && candidate.confidence !== "high"
        && candidate.confidence !== "medium"
        && candidate.confidence !== "low"
      ) {
        throw new Error("Subagent confidence must be high, medium, or low");
      }
      const relatedSeqs = [...new Set(candidate.relatedSeqs
        .filter((seq): seq is number => Number.isInteger(seq) && allowedSeqs.has(seq as number)))]
        .sort((a, b) => a - b);
      return {
        finding: candidate.finding.trim().slice(0, this.options.maxFindingChars),
        relatedSeqs,
        ...(candidate.confidence ? { confidence: candidate.confidence } : {}),
      } satisfies SubagentFinding;
    }).filter((finding) => finding.relatedSeqs.length > 0);

    return { findings };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private buildPrompt(chunk: RequestSummary[], chunkIndex: number, totalChunks: number): string {
    const requestIndex = chunk
      .map((item) => `#${item.seq} ${item.method} ${item.url} -> ${item.status ?? "pending"}`)
      .join("\n");
    return `你是 HTTP 请求会话子分析器。分析第 ${chunkIndex + 1}/${totalChunks} 个摘要块，提取值得主模型深入查看的发现和相关请求序号。\n仅返回严格 JSON，不要 Markdown 或代码围栏。格式：{"findings":[{"finding":"简短发现","relatedSeqs":[1,2],"confidence":"high|medium|low"}]}\n请求摘要：\n${requestIndex}`;
  }

  private aggregateFindings(findings: SubagentFinding[]): SubagentFinding[] {
    const confidenceRank = { high: 3, medium: 2, low: 1 } as const;
    const merged = new Map<string, { finding: SubagentFinding; order: number }>();

    findings.forEach((finding, order) => {
      const key = finding.finding.toLocaleLowerCase();
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { finding: { ...finding, relatedSeqs: [...finding.relatedSeqs] }, order });
        return;
      }
      existing.finding.relatedSeqs = [...new Set([
        ...existing.finding.relatedSeqs,
        ...finding.relatedSeqs,
      ])].sort((a, b) => a - b);
      const existingRank = existing.finding.confidence ? confidenceRank[existing.finding.confidence] : 0;
      const incomingRank = finding.confidence ? confidenceRank[finding.confidence] : 0;
      if (incomingRank > existingRank) {
        existing.finding.confidence = finding.confidence;
      }
    });

    return [...merged.values()]
      .sort((left, right) => {
        const leftRank = left.finding.confidence ? confidenceRank[left.finding.confidence] : 0;
        const rightRank = right.finding.confidence ? confidenceRank[right.finding.confidence] : 0;
        return rightRank - leftRank || left.order - right.order;
      })
      .map((entry) => entry.finding);
  }

  private formatCompactSummary(findings: SubagentFinding[], relatedSeqs: number[]): string {
    const lines = findings.map((finding) => {
      const confidence = finding.confidence ? `[${finding.confidence}] ` : "";
      return `- ${confidence}${finding.finding} (#${finding.relatedSeqs.join(", #")})`;
    });
    return [
      "<subagent_analysis>",
      `相关请求: ${relatedSeqs.map((seq) => `#${seq}`).join(", ") || "无"}`,
      ...lines,
      "</subagent_analysis>",
    ].join("\n");
  }
}
