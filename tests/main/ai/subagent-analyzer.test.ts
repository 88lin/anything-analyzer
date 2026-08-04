import { describe, expect, it, vi } from "vitest";
import type { RequestSummary } from "../../../src/shared/types";
import { SubagentAnalyzer } from "../../../src/main/ai/subagent-analyzer";

function summaries(count: number): RequestSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    method: index % 2 === 0 ? "GET" : "POST",
    url: `https://api.example.com/items/${index + 1}`,
    status: 200,
    contentType: "application/json",
    timestamp: 1_700_000_000_000 + index * 1_000,
    bodyBytes: 0,
    responseBytes: 100,
    hasAuthHeader: false,
    isStreaming: false,
    hookCount: 0,
  }));
}

describe("SubagentAnalyzer", () => {
  it("skips worker analysis when request count does not exceed the threshold", async () => {
    const worker = vi.fn(async () => '{"findings":[]}');
    const analyzer = new SubagentAnalyzer(worker, { threshold: 5 });

    const result = await analyzer.analyze(summaries(5));

    expect(worker).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      applied: false,
      totalRequests: 5,
      chunkCount: 0,
      succeededChunks: 0,
      failedChunks: 0,
      findings: [],
      relatedSeqs: [],
      compactSummary: "",
    });
  });

  it("chunks oversized sessions and never exceeds the configured concurrency", async () => {
    let activeWorkers = 0;
    let peakWorkers = 0;
    const receivedChunks: number[][] = [];
    const worker = vi.fn(async (input: { summaries: RequestSummary[]; prompt: string }) => {
      activeWorkers += 1;
      peakWorkers = Math.max(peakWorkers, activeWorkers);
      receivedChunks.push(input.summaries.map((item) => item.seq));
      expect(input.prompt).toContain("仅返回严格 JSON");
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeWorkers -= 1;
      return JSON.stringify({
        findings: [{
          finding: `chunk ${input.summaries[0].seq}`,
          relatedSeqs: [input.summaries[0].seq],
          confidence: "medium",
        }],
      });
    });
    const analyzer = new SubagentAnalyzer(worker, {
      threshold: 4,
      chunkSize: 2,
      maxConcurrency: 2,
    });

    const result = await analyzer.analyze(summaries(9));

    expect(receivedChunks).toEqual([[1, 2], [3, 4], [5, 6], [7, 8], [9]]);
    expect(peakWorkers).toBeLessThanOrEqual(2);
    expect(result).toMatchObject({
      applied: true,
      totalRequests: 9,
      chunkCount: 5,
      succeededChunks: 5,
      failedChunks: 0,
    });
  });

  it("keeps valid chunk findings when other workers fail or return non-strict JSON", async () => {
    const worker = vi.fn(async (input: { chunkIndex: number }) => {
      if (input.chunkIndex === 0) {
        return JSON.stringify({
          findings: [{
            finding: "登录响应可能签发访问令牌",
            relatedSeqs: [1, 999],
            confidence: "high",
          }],
        });
      }
      if (input.chunkIndex === 1) {
        return '```json\n{"findings":[]}\n```';
      }
      throw new Error("worker unavailable");
    });
    const analyzer = new SubagentAnalyzer(worker, {
      threshold: 1,
      chunkSize: 2,
      maxConcurrency: 3,
    });

    const result = await analyzer.analyze(summaries(6));

    expect(result.succeededChunks).toBe(1);
    expect(result.failedChunks).toBe(2);
    expect(result.findings).toEqual([{
      finding: "登录响应可能签发访问令牌",
      relatedSeqs: [1],
      confidence: "high",
    }]);
    expect(result.relatedSeqs).toEqual([1]);
    expect(result.compactSummary).toContain("登录响应可能签发访问令牌");
    expect(result.compactSummary).not.toContain("999");
  });

  it("deduplicates findings and bounds the compact prompt payload", async () => {
    const repeated = "认证令牌由登录响应签发，后续请求通过 Authorization 头复用";
    const worker = vi.fn(async (input: { chunkIndex: number }) => JSON.stringify({
      findings: input.chunkIndex === 0
        ? [
            { finding: repeated, relatedSeqs: [1], confidence: "high" },
            { finding: "低价值健康检查", relatedSeqs: [2], confidence: "low" },
          ]
        : [
            { finding: repeated, relatedSeqs: [3], confidence: "medium" },
            { finding: "存在独立的刷新令牌端点", relatedSeqs: [4], confidence: "high" },
          ],
    }));
    const analyzer = new SubagentAnalyzer(worker, {
      threshold: 1,
      chunkSize: 2,
      maxFindings: 2,
      maxFindingChars: 40,
    });

    const result = await analyzer.analyze(summaries(4));

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toMatchObject({
      relatedSeqs: [1, 3],
      confidence: "high",
    });
    expect(result.findings.every((finding) => finding.finding.length <= 40)).toBe(true);
    expect(result.relatedSeqs).toEqual([1, 3, 4]);
    expect(result.compactSummary).toContain("相关请求: #1, #3, #4");
    expect(result.compactSummary).not.toContain("低价值健康检查");
  });
});
