import type { FilteredRequest, RequestSummary } from "@shared/types";
import type { MCPToolInfo } from "../mcp/mcp-manager";

/** 单次最多拉取的请求详情数 */
export const MAX_DETAIL_BATCH = 5;
/** list/search 单次返回上限 */
export const MAX_LIST_RESULTS = 50;
/** 默认单字段截断长度；full=true 时放宽 */
export const DEFAULT_FIELD_CHARS = 8_000;
export const FULL_FIELD_CHARS = 40_000;

export const BUILTIN_REQUEST_TOOLS: MCPToolInfo[] = [
  {
    serverName: "_builtin",
    name: "list_requests",
    description:
      "按 method/status/url 关键词/时间范围过滤请求索引，返回轻量摘要列表。适合在索引很长时先缩小范围，再 get_request_detail。",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "HTTP 方法，如 GET/POST（大小写不敏感）" },
        status: { type: "number", description: "精确状态码，如 200/401" },
        url_contains: { type: "string", description: "URL 子串匹配（大小写不敏感）" },
        has_auth: { type: "boolean", description: "是否要求带 Authorization 头" },
        is_streaming: { type: "boolean", description: "是否只要流式/WebSocket 请求" },
        time_from: { type: "number", description: "起始时间戳 ms（含）" },
        time_to: { type: "number", description: "结束时间戳 ms（含）" },
        limit: { type: "number", description: "返回条数上限，默认 50，最大 50" },
        offset: { type: "number", description: "偏移量（从 0 开始），用于超大索引分页" },
        page: { type: "number", description: "页码（从 1 开始，与 offset 二选一；page 优先换算为 offset=(page-1)*limit）" },
      },
      required: [],
    },
  },
  {
    serverName: "_builtin",
    name: "search_requests",
    description:
      "在请求头/请求体/响应头/响应体中关键字搜索，返回命中序号与短片段。用于定位 token、加密参数、错误信息等。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键字（大小写不敏感）" },
        in: {
          type: "array",
          items: { type: "string", enum: ["url", "headers", "body", "responseHeaders", "responseBody", "all"] },
          description: "搜索范围，默认 all",
        },
        limit: { type: "number", description: "返回条数上限，默认 20，最大 50" },
      },
      required: ["query"],
    },
  },
  {
    serverName: "_builtin",
    name: "get_request_detail",
    description:
      "按序号获取 HTTP 请求详情（请求头/体、响应头/体、关联 hooks）。首轮上下文只有索引，需要正文时必须调用本工具。支持单个 seq 或 seqs 数组，单次最多 5 条。",
    inputSchema: {
      type: "object",
      properties: {
        seq: { type: "number", description: "单个请求序号" },
        seqs: {
          type: "array",
          items: { type: "number" },
          description: "多个请求序号（优先于 seq，最多 5 条）",
        },
        full: {
          type: "boolean",
          description: "是否尽量返回完整字段（仍受安全上限约束）。默认 false，长字段会截断。",
        },
      },
      required: [],
    },
  },
];

export interface ToolCallOutcome {
  result: string;
  /** 本次新查看的请求序号（仅 get_request_detail） */
  fetchedSeqs: number[];
  /** 侧态用的一行引用 */
  refLine: string;
}

function clip(value: string | null | undefined, label: string, limit: number): string | null {
  if (!value) return null;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[${label} truncated ${value.length - limit} chars]`;
}

function formatBytes(n?: number): string {
  const value = typeof n === "number" ? n : 0;
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}

export function formatRequestIndexLine(s: RequestSummary): string {
  const ct = s.contentType ? ` [${s.contentType.split(";")[0].trim()}]` : "";
  const flags: string[] = [];
  if (s.hasAuthHeader) flags.push("auth");
  if (s.isStreaming) flags.push("stream");
  if (s.hookCount && s.hookCount > 0) flags.push(`hooks=${s.hookCount}`);
  const flagText = flags.length ? ` {${flags.join(",")}}` : "";
  return `#${s.seq} ${s.method} ${s.url} @ ${formatTimestamp(s.timestamp)} -> ${s.status ?? "pending"}${ct} body=${formatBytes(s.bodyBytes)} resp=${formatBytes(s.responseBytes)}${flagText}`;
}

export function formatRequestDetail(req: FilteredRequest, full = false): string {
  const limit = full ? FULL_FIELD_CHARS : DEFAULT_FIELD_CHARS;
  const lines = [
    `# 请求 #${req.seq}`,
    `${req.method} ${req.url} → ${req.status ?? "pending"}`,
    `Time: ${formatTimestamp(req.timestamp)}`,
    "",
    "## 请求头",
    JSON.stringify(req.headers, null, 2),
  ];
  const body = clip(req.body, "body", limit);
  if (body) lines.push("", "## 请求体", body);
  if (req.responseHeaders) {
    lines.push("", "## 响应头", JSON.stringify(req.responseHeaders, null, 2));
  }
  const responseBody = clip(req.responseBody, "response", limit);
  if (responseBody) lines.push("", "## 响应体", responseBody);
  if (req.hooks.length > 0) {
    lines.push("", "## 关联 JS Hooks");
    for (const h of req.hooks) {
      const args = clip(h.arguments, "hook-args", limit) ?? "";
      const result = h.result ? clip(h.result, "hook-result", limit) : null;
      lines.push(
        `[${h.hook_type}] ${h.function_name}: args=${args}${result ? ` result=${result}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

function parseSeqList(args: Record<string, unknown>): number[] {
  const seqs: number[] = [];
  if (Array.isArray(args.seqs)) {
    for (const item of args.seqs) {
      const n = typeof item === "number" ? item : Number(item);
      if (Number.isFinite(n)) seqs.push(n);
    }
  } else if (args.seq !== undefined) {
    const n = typeof args.seq === "number" ? args.seq : Number(args.seq);
    if (Number.isFinite(n)) seqs.push(n);
  }
  return seqs;
}

export function handleGetRequestDetail(
  args: Record<string, unknown>,
  requestMap: Map<number, FilteredRequest>,
): ToolCallOutcome {
  const full = args.full === true;
  const seqs = parseSeqList(args);
  if (seqs.length === 0) {
    return { result: "Error: 请提供 seq 或 seqs", fetchedSeqs: [], refLine: "[get_request_detail](error=missing_seq)" };
  }
  if (seqs.length > MAX_DETAIL_BATCH) {
    return {
      result: `Error: 单次最多查询 ${MAX_DETAIL_BATCH} 条请求，当前 ${seqs.length} 条`,
      fetchedSeqs: [],
      refLine: `[get_request_detail](error=batch_too_large,count=${seqs.length})`,
    };
  }

  const fetchedSeqs: number[] = [];
  const parts: string[] = [];
  for (const seq of seqs) {
    const req = requestMap.get(seq);
    if (!req) {
      parts.push(`Error: 未找到序号为 ${seq} 的请求`);
    } else {
      fetchedSeqs.push(seq);
      parts.push(formatRequestDetail(req, full));
    }
  }
  return {
    result: parts.join("\n\n---\n\n"),
    fetchedSeqs,
    refLine: `[get_request_detail](seqs=${fetchedSeqs.join(",") || seqs.join(",")})`,
  };
}

export function handleListRequests(
  args: Record<string, unknown>,
  summaries: RequestSummary[],
): ToolCallOutcome {
  const method = typeof args.method === "string" ? args.method.trim().toUpperCase() : null;
  const status = typeof args.status === "number" ? args.status : args.status != null ? Number(args.status) : null;
  const urlContains = typeof args.url_contains === "string" ? args.url_contains.trim().toLowerCase() : null;
  const hasAuth = typeof args.has_auth === "boolean" ? args.has_auth : null;
  const isStreaming = typeof args.is_streaming === "boolean" ? args.is_streaming : null;
  const timeFrom = typeof args.time_from === "number" ? args.time_from : null;
  const timeTo = typeof args.time_to === "number" ? args.time_to : null;
  const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit);
  const limit = Math.min(MAX_LIST_RESULTS, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : MAX_LIST_RESULTS));
  const rawPage = typeof args.page === "number" ? args.page : Number(args.page);
  const rawOffset = typeof args.offset === "number" ? args.offset : Number(args.offset);
  let offset = 0;
  if (Number.isFinite(rawPage) && rawPage >= 1) {
    offset = (Math.floor(rawPage) - 1) * limit;
  } else if (Number.isFinite(rawOffset) && rawOffset > 0) {
    offset = Math.floor(rawOffset);
  }

  const matched = summaries.filter((s) => {
    if (method && s.method.toUpperCase() !== method) return false;
    if (status != null && Number.isFinite(status) && s.status !== status) return false;
    if (urlContains && !s.url.toLowerCase().includes(urlContains)) return false;
    if (hasAuth != null && Boolean(s.hasAuthHeader) !== hasAuth) return false;
    if (isStreaming != null && Boolean(s.isStreaming) !== isStreaming) return false;
    if (timeFrom != null && (s.timestamp ?? 0) < timeFrom) return false;
    if (timeTo != null && (s.timestamp ?? 0) > timeTo) return false;
    return true;
  });

  const sliced = matched.slice(offset, offset + limit);
  const lines = sliced.map(formatRequestIndexLine);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(matched.length / limit));
  const result = [
    `匹配 ${matched.length} 条，返回 ${sliced.length} 条（offset=${offset}, page=${page}/${totalPages}, limit=${limit}）：`,
    ...lines,
    offset + sliced.length < matched.length
      ? `...还有 ${matched.length - offset - sliced.length} 条，可用 list_requests({ offset: ${offset + sliced.length}, limit: ${limit} }) 或 page=${page + 1} 继续`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    result: lines.length ? result : "未匹配到请求",
    fetchedSeqs: [],
    refLine: `[list_requests](matched=${matched.length},returned=${sliced.length})`,
  };
}

function collectSearchHaystacks(
  req: FilteredRequest,
  scopes: Set<string>,
): Array<{ field: string; text: string }> {
  const all = scopes.has("all") || scopes.size === 0;
  const items: Array<{ field: string; text: string }> = [];
  if (all || scopes.has("url")) items.push({ field: "url", text: req.url });
  if (all || scopes.has("headers")) items.push({ field: "headers", text: JSON.stringify(req.headers) });
  if ((all || scopes.has("body")) && req.body) items.push({ field: "body", text: req.body });
  if ((all || scopes.has("responseHeaders")) && req.responseHeaders) {
    items.push({ field: "responseHeaders", text: JSON.stringify(req.responseHeaders) });
  }
  if ((all || scopes.has("responseBody")) && req.responseBody) {
    items.push({ field: "responseBody", text: req.responseBody });
  }
  return items;
}

function excerptAround(text: string, query: string, radius = 60): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`.replace(/\s+/g, " ");
}

export function handleSearchRequests(
  args: Record<string, unknown>,
  requestMap: Map<number, FilteredRequest>,
): ToolCallOutcome {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return { result: "Error: query 不能为空", fetchedSeqs: [], refLine: "[search_requests](error=empty_query)" };
  }
  const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit);
  const limit = Math.min(MAX_LIST_RESULTS, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20));
  const scopes = new Set<string>();
  if (Array.isArray(args.in)) {
    for (const item of args.in) {
      if (typeof item === "string" && item.trim()) scopes.add(item.trim());
    }
  }
  if (scopes.size === 0) scopes.add("all");

  const q = query.toLowerCase();
  const hits: string[] = [];
  const hitSeqs: number[] = [];

  const ordered = [...requestMap.values()].sort((a, b) => a.seq - b.seq);
  for (const req of ordered) {
    if (hits.length >= limit) break;
    const haystacks = collectSearchHaystacks(req, scopes);
    for (const item of haystacks) {
      if (!item.text.toLowerCase().includes(q)) continue;
      hitSeqs.push(req.seq);
      hits.push(
        `#${req.seq} ${req.method} ${req.url} [${item.field}] ${excerptAround(item.text, query)}`,
      );
      break;
    }
  }

  return {
    result: hits.length
      ? `命中 ${hits.length} 条（limit=${limit}）：\n${hits.join("\n")}`
      : `未找到包含 “${query}” 的请求`,
    fetchedSeqs: [],
    refLine: `[search_requests](query=${JSON.stringify(query)},hits=${hits.length})`,
  };
}

export function dispatchBuiltinRequestTool(
  name: string,
  args: Record<string, unknown>,
  requestMap: Map<number, FilteredRequest>,
  summaries: RequestSummary[],
): ToolCallOutcome | null {
  switch (name) {
    case "get_request_detail":
      return handleGetRequestDetail(args, requestMap);
    case "list_requests":
      return handleListRequests(args, summaries);
    case "search_requests":
      return handleSearchRequests(args, requestMap);
    default:
      return null;
  }
}
