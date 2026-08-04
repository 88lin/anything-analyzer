import { describe, expect, it } from "vitest";
import {
  appendToolStateMarker,
  buildToolStateNote,
  clearToolSessionState,
  getToolSessionState,
  hydrateToolSessionFromHistory,
  recordToolSessionActivity,
} from "../../../src/main/ai/tool-session-state";
import { stripToolContext } from "../../../src/shared/types";

describe("tool session state", () => {
  it("records fetched seqs without embedding bodies", () => {
    clearToolSessionState("s1", "r1");
    recordToolSessionActivity("s1", "r1", [1, 5], "[get_request_detail](seqs=1,5)");
    recordToolSessionActivity("s1", "r1", [5, 9], "[get_request_detail](seqs=5,9)");
    const snap = getToolSessionState("s1", "r1");
    expect(snap.fetchedSeqs).toEqual([1, 5, 9]);
    const note = buildToolStateNote(snap);
    expect(note).toContain("#1");
    expect(note).toContain("#9");
    expect(note).not.toContain("password");
  });

  it("persists compact tool_state marker and strips for display", () => {
    clearToolSessionState("s2", "r2");
    recordToolSessionActivity("s2", "r2", [3], "[get_request_detail](seqs=3)");
    const content = appendToolStateMarker("分析完成", getToolSessionState("s2", "r2"));
    expect(content).toContain("<tool_state>");
    expect(content).toContain('"fetchedSeqs":[3]');
    expect(stripToolContext(content)).toBe("分析完成");
  });

  it("hydrates from legacy tool_context and tool_state history", () => {
    clearToolSessionState("s3", "r3");
    const snap = hydrateToolSessionFromHistory("s3", "r3", [
      {
        role: "assistant",
        content: "old\n\n<tool_context>\n[get_request_detail](seqs=7)\n#7 POST /login\n</tool_context>",
      },
      {
        role: "assistant",
        content: 'new\n\n<tool_state>{"fetchedSeqs":[8,7],"recentRefs":["[list_requests](matched=2)"]}</tool_state>',
      },
    ]);
    expect(snap.fetchedSeqs).toEqual([7, 8]);
    expect(snap.recentRefs.some((r) => r.includes("list_requests"))).toBe(true);
  });
});
