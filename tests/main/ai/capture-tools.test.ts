import { describe, expect, it } from "vitest";
import type { InteractionEvent, JsHookRecord } from "../../../src/shared/types";
import {
  dispatchBuiltinCaptureTool,
  handleReadSessionHooks,
  handleReadSessionInteractions,
} from "../../../src/main/ai/capture-tools";

const hooks: JsHookRecord[] = [
  {
    id: 1,
    session_id: "session-1",
    timestamp: 1_700_000_000_000,
    hook_type: "crypto_lib",
    function_name: "CryptoJS.HmacSHA256",
    arguments: '["payload","secret"]',
    result: '"signature"',
    call_stack: "at sign (app.js:10:2)",
    related_request_id: null,
  },
];

const interactions: InteractionEvent[] = [
  {
    id: 10,
    session_id: "session-1",
    sequence: 3,
    type: "input",
    timestamp: 1_700_000_001_000,
    x: null,
    y: null,
    viewport_x: 320,
    viewport_y: 180,
    selector: "#username",
    xpath: "//html[1]/body[1]/form[1]/input[1]",
    tag_name: "input",
    element_text: null,
    attributes: '{"name":"username","placeholder":"账号"}',
    bounding_rect: '{"x":300,"y":160,"width":200,"height":32}',
    input_value: "alice",
    key: null,
    scroll_x: null,
    scroll_y: null,
    scroll_dx: null,
    scroll_dy: null,
    url: "https://example.com/login",
    page_title: "Login",
    path: null,
    created_at: 1_700_000_001_100,
  },
];

describe("capture tools", () => {
  it("returns standalone hook arguments, result, and call stack", () => {
    const outcome = handleReadSessionHooks({ query: "secret" }, hooks);

    expect(outcome.result).toContain("CryptoJS.HmacSHA256");
    expect(outcome.result).toContain("payload");
    expect(outcome.result).toContain("signature");
    expect(outcome.result).toContain("app.js:10:2");
  });

  it("returns concrete element operation details", () => {
    const outcome = handleReadSessionInteractions({ type: "input" }, interactions);

    expect(outcome.result).toContain("[input]");
    expect(outcome.result).toContain("selector=#username");
    expect(outcome.result).toContain("xpath=//html[1]/body[1]/form[1]/input[1]");
    expect(outcome.result).toContain('input="alice"');
    expect(outcome.result).toContain("placeholder");
  });

  it("dispatches both capture tool names", () => {
    expect(dispatchBuiltinCaptureTool("read_session_hooks", {}, hooks, interactions)).not.toBeNull();
    expect(dispatchBuiltinCaptureTool("read_session_interactions", {}, hooks, interactions)).not.toBeNull();
    expect(dispatchBuiltinCaptureTool("unknown", {}, hooks, interactions)).toBeNull();
  });
});
