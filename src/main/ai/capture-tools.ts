import type { InteractionEvent, InteractionType, JsHookRecord } from "@shared/types";
import type { MCPToolInfo } from "../mcp/mcp-manager";
import type { ToolCallOutcome } from "./request-tools";

const MAX_RESULTS = 100;
const DEFAULT_RESULTS = 50;
const FIELD_LIMIT = 4_000;

export const BUILTIN_CAPTURE_TOOLS: MCPToolInfo[] = [
  {
    serverName: "_builtin",
    name: "read_session_hooks",
    description:
      "读取当前分析会话的 JS Hooks。支持按 Hook 类型、函数名和关键字过滤，并分页返回参数、结果与调用栈。用于查看未关联到 HTTP 请求的 fetch/XHR/crypto/cookie Hook。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Hook 类型，如 fetch/xhr/crypto/crypto_lib/cookie_set" },
        function_contains: { type: "string", description: "函数名子串，大小写不敏感" },
        query: { type: "string", description: "在函数名、参数、结果、调用栈中搜索" },
        offset: { type: "number", description: "偏移量，从 0 开始" },
        limit: { type: "number", description: "返回条数，默认 50，最大 100" },
        include_details: { type: "boolean", description: "是否返回参数、结果与调用栈，默认 true" },
      },
      required: [],
    },
  },
  {
    serverName: "_builtin",
    name: "read_session_interactions",
    description:
      "读取当前分析会话记录的用户元素操作。返回操作类型、元素文本、CSS selector、XPath、属性、输入值、坐标、页面 URL 与时间，可按类型/页面/关键字过滤和分页。",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "操作类型：click/dblclick/input/scroll/navigate/hover" },
        url_contains: { type: "string", description: "页面 URL 子串，大小写不敏感" },
        query: { type: "string", description: "在元素文本、selector、XPath、属性、输入值中搜索" },
        offset: { type: "number", description: "偏移量，从 0 开始" },
        limit: { type: "number", description: "返回条数，默认 50，最大 100" },
      },
      required: [],
    },
  },
];

function parsePageArgs(args: Record<string, unknown>): { offset: number; limit: number } {
  const rawOffset = typeof args.offset === "number" ? args.offset : Number(args.offset);
  const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit);
  return {
    offset: Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0),
    limit: Math.min(
      MAX_RESULTS,
      Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_RESULTS),
    ),
  };
}

function clip(value: string | null, label: string): string {
  if (!value) return "-";
  return value.length <= FIELD_LIMIT
    ? value
    : `${value.slice(0, FIELD_LIMIT)}\n...[${label} truncated ${value.length - FIELD_LIMIT} chars]`;
}

function contains(value: string | null | undefined, query: string): boolean {
  return Boolean(value?.toLowerCase().includes(query));
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function handleReadSessionHooks(
  args: Record<string, unknown>,
  hooks: JsHookRecord[],
): ToolCallOutcome {
  const type = typeof args.type === "string" ? args.type.trim().toLowerCase() : "";
  const functionQuery = typeof args.function_contains === "string"
    ? args.function_contains.trim().toLowerCase()
    : "";
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const includeDetails = args.include_details !== false;
  const { offset, limit } = parsePageArgs(args);

  const matched = hooks.filter((hook) => {
    if (type && hook.hook_type.toLowerCase() !== type) return false;
    if (functionQuery && !hook.function_name.toLowerCase().includes(functionQuery)) return false;
    if (query && ![
      hook.function_name,
      hook.arguments,
      hook.result,
      hook.call_stack,
    ].some((value) => contains(value, query))) return false;
    return true;
  });
  const selected = matched.slice(offset, offset + limit);
  const lines = selected.map((hook) => {
    const header = `#${hook.id} ${formatTimestamp(hook.timestamp)} [${hook.hook_type}] ${hook.function_name}`;
    if (!includeDetails) return header;
    return [
      header,
      `arguments=${clip(hook.arguments, "hook arguments")}`,
      `result=${clip(hook.result, "hook result")}`,
      `call_stack=${clip(hook.call_stack, "hook call stack")}`,
    ].join("\n");
  });

  return {
    result: lines.length > 0
      ? `Hooks matched=${matched.length}, returned=${selected.length}, offset=${offset}\n\n${lines.join("\n\n---\n\n")}`
      : "当前会话没有匹配的 JS Hooks。",
    fetchedSeqs: [],
    refLine: `[read_session_hooks](matched=${matched.length},returned=${selected.length},offset=${offset})`,
  };
}

function formatInteraction(event: InteractionEvent): string {
  const element = [
    event.tag_name ? `<${event.tag_name}>` : null,
    event.element_text ? `text=${JSON.stringify(event.element_text)}` : null,
    event.selector ? `selector=${event.selector}` : null,
    event.xpath ? `xpath=${event.xpath}` : null,
  ].filter(Boolean).join(" ");
  const details = [
    event.input_value !== null ? `input=${JSON.stringify(event.input_value)}` : null,
    event.attributes ? `attributes=${clip(event.attributes, "interaction attributes")}` : null,
    event.viewport_x !== null && event.viewport_y !== null
      ? `viewport=(${event.viewport_x},${event.viewport_y})`
      : null,
    event.scroll_x !== null || event.scroll_y !== null
      ? `scroll=(${event.scroll_x ?? 0},${event.scroll_y ?? 0})`
      : null,
  ].filter(Boolean).join(" ");
  return [
    `#${event.sequence} ${formatTimestamp(event.timestamp)} [${event.type}] ${event.url}`,
    element || "element=-",
    details || "details=-",
  ].join("\n");
}

export function handleReadSessionInteractions(
  args: Record<string, unknown>,
  interactions: InteractionEvent[],
): ToolCallOutcome {
  const type = typeof args.type === "string" ? args.type.trim().toLowerCase() : "";
  const urlQuery = typeof args.url_contains === "string" ? args.url_contains.trim().toLowerCase() : "";
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  const { offset, limit } = parsePageArgs(args);

  const matched = interactions.filter((event) => {
    if (type && event.type !== type as InteractionType) return false;
    if (urlQuery && !event.url.toLowerCase().includes(urlQuery)) return false;
    if (query && ![
      event.element_text,
      event.selector,
      event.xpath,
      event.attributes,
      event.input_value,
      event.page_title,
    ].some((value) => contains(value, query))) return false;
    return true;
  });
  const selected = matched.slice(offset, offset + limit);

  return {
    result: selected.length > 0
      ? `Interactions matched=${matched.length}, returned=${selected.length}, offset=${offset}\n\n${selected.map(formatInteraction).join("\n\n---\n\n")}`
      : "当前会话没有匹配的 Interactions。",
    fetchedSeqs: [],
    refLine: `[read_session_interactions](matched=${matched.length},returned=${selected.length},offset=${offset})`,
  };
}

export function dispatchBuiltinCaptureTool(
  name: string,
  args: Record<string, unknown>,
  hooks: JsHookRecord[],
  interactions: InteractionEvent[],
): ToolCallOutcome | null {
  switch (name) {
    case "read_session_hooks":
      return handleReadSessionHooks(args, hooks);
    case "read_session_interactions":
      return handleReadSessionInteractions(args, interactions);
    default:
      return null;
  }
}
