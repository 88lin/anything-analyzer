import { describe, expect, it } from "vitest";
import type { FilteredRequest, RequestSummary } from "../../../src/shared/types";
import {
  dispatchBuiltinRequestTool,
  handleGetRequestDetail,
  handleListRequests,
  handleSearchRequests,
} from "../../../src/main/ai/request-tools";

function req(partial: Partial<FilteredRequest> & Pick<FilteredRequest, "seq" | "method" | "url">): FilteredRequest {
  return {
    headers: {},
    body: null,
    status: 200,
    responseHeaders: { "content-type": "application/json" },
    responseBody: null,
    hooks: [],
    timestamp: 1_700_000_000_000 + partial.seq * 1000,
    ...partial,
  };
}

function summary(partial: Partial<RequestSummary> & Pick<RequestSummary, "seq" | "method" | "url">): RequestSummary {
  return {
    status: 200,
    contentType: "application/json",
    timestamp: 1_700_000_000_000 + partial.seq * 1000,
    bodyBytes: 0,
    responseBytes: 0,
    hasAuthHeader: false,
    isStreaming: false,
    hookCount: 0,
    ...partial,
  };
}

describe("request tools", () => {
  const requests = [
    req({
      seq: 1,
      method: "POST",
      url: "https://api.example.com/login",
      headers: { Authorization: "Bearer abc" },
      body: '{"user":"a","password":"secret-token-xyz"}',
      responseBody: '{"access_token":"tok_123"}',
    }),
    req({
      seq: 2,
      method: "GET",
      url: "https://api.example.com/me",
      headers: { Authorization: "Bearer abc" },
      responseBody: '{"id":1}',
    }),
    req({
      seq: 3,
      method: "GET",
      url: "https://cdn.example.com/app.js",
      status: 304,
      responseBody: "console.log(1)",
    }),
  ];
  const map = new Map(requests.map((r) => [r.seq, r]));
  const summaries = [
    summary({ seq: 1, method: "POST", url: "https://api.example.com/login", hasAuthHeader: true, bodyBytes: 40, responseBytes: 30 }),
    summary({ seq: 2, method: "GET", url: "https://api.example.com/me", hasAuthHeader: true, responseBytes: 8 }),
    summary({ seq: 3, method: "GET", url: "https://cdn.example.com/app.js", status: 304 }),
  ];

  it("lists requests by method and url keyword", () => {
    const result = handleListRequests({ method: "get", url_contains: "api.example" }, summaries);
    expect(result.result).toContain("#2 GET");
    expect(result.result).not.toContain("#1 POST");
    expect(result.result).not.toContain("#3 GET https://cdn");
  });

  it("searches request bodies for keywords", () => {
    const result = handleSearchRequests({ query: "secret-token", in: ["body"] }, map);
    expect(result.result).toContain("#1");
    expect(result.result).toContain("[body]");
    expect(result.result).not.toContain("#2");
  });

  it("returns request details for batch seqs with truncation controls", () => {
    const longBody = "x".repeat(20_000);
    map.set(9, req({ seq: 9, method: "POST", url: "https://api.example.com/big", body: longBody }));
    const clipped = handleGetRequestDetail({ seq: 9 }, map);
    expect(clipped.result).toContain("truncated");
    const full = handleGetRequestDetail({ seqs: [1, 2], full: true }, map);
    expect(full.fetchedSeqs).toEqual([1, 2]);
    expect(full.result).toContain("access_token");
    expect(full.result).toContain("---");
  });

  it("dispatches builtin tool names", () => {
    expect(dispatchBuiltinRequestTool("list_requests", { method: "POST" }, map, summaries)?.refLine).toContain("list_requests");
    expect(dispatchBuiltinRequestTool("nope", {}, map, summaries)).toBeNull();
  });
});

  it("supports offset/page pagination for list_requests", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      summary({ seq: i + 1, method: "GET", url: `https://api.example.com/item/${i + 1}` }),
    );
    const page1 = handleListRequests({ limit: 10, page: 1 }, many);
    const page2 = handleListRequests({ limit: 10, offset: 10 }, many);
    expect(page1.result).toContain("page=1/");
    expect(page1.result).toContain("#1 GET");
    expect(page1.result).not.toContain("#11 GET");
    expect(page2.result).toContain("#11 GET");
    expect(page2.result).toContain("offset=10");
  });
