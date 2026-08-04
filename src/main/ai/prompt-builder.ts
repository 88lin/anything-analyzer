import type {
  AssembledData,
  CryptoScriptSnippet,
  SceneHint,
  AuthChainItem,
  ContextMode,
  FilteredRequest,
  PromptTemplate,
  RequestSummary,
} from "@shared/types";

interface PromptMessages {
  system: string;
  user: string;
}

const REVERSE_API_REQUIREMENTS = `1. 完整 API 端点清单：列出所有 API 的方法、路径、请求参数、响应 JSON 结构
2. 鉴权流程：Token/Cookie 获取、刷新、传递机制的完整链路
3. 请求依赖链：哪些请求的响应是后续请求的必要输入
4. 数据模型推断：从 API 响应结构推断后端数据模型
5. 复现代码：用 Python requests 库写出可直接运行的完整 API 调用流程`;

const SECURITY_AUDIT_REQUIREMENTS = `1. 认证安全：分析认证方式的安全性，是否存在弱口令、明文传输、Token 泄露风险
2. 敏感数据暴露：检查响应中是否包含不必要的敏感信息（密码、密钥、PII）
3. CSRF/XSS 风险：分析请求是否缺少 CSRF Token，响应头是否缺少安全头（CSP, X-Frame-Options 等）
4. 权限控制：分析是否存在越权访问的可能（水平/垂直越权）
5. 安全建议：针对发现的问题给出具体修复建议`;

const PERFORMANCE_REQUIREMENTS = `1. 请求时序分析：分析请求的串行/并行关系，识别阻塞链路
2. 冗余请求：识别重复或不必要的请求
3. 资源优化：分析资源加载顺序，识别可优化的静态资源
4. 缓存策略：分析 Cache-Control、ETag 等缓存头的使用情况
5. 性能建议：给出具体的性能优化建议和预期收益`;

const CRYPTO_REVERSE_REQUIREMENTS = `1. 加密算法识别：识别所有使用的加密/签名/哈希算法（AES、RSA、SHA、HMAC、SM2/3/4 等），标注具体库和方法名
2. 加密流程还原：完整描述每个请求参数的加密 pipeline（明文 → 各步骤 → 密文），画出数据流转图
3. 密钥管理分析：密钥来源（硬编码/动态/协商）、密钥格式（Hex/Base64/PEM）、密钥长度
4. 签名/校验机制：请求签名的生成算法、参与签名的参数排序规则、时间戳/nonce 机制
5. 复现代码：用 Python 写出完整的加密/签名/请求复现代码，确保可直接运行，包含所有必要的密钥和参数`;

const DEFAULT_REQUIREMENTS = `1. 场景识别：判断用户执行了什么操作（注册、登录、AI对话、支付等）
2. 交互流程概述：按时间顺序描述完整交互链路
3. API端点清单：列出所有关键API，标注方法、路径、用途
4. 鉴权机制分析：认证方式、凭据获取流程、凭据传递方式
5. 流式通信分析（如检测到SSE/WebSocket）：协议类型、端点、请求/响应格式
6. 存储使用分析：Cookie/localStorage/sessionStorage 的关键变化
7. 关键依赖关系：请求之间的依赖和时序关系
8. 复现建议：用代码伪逻辑描述如何复现整个流程`;

/** 首轮内联索引上限；超出后头尾抽样 + list_requests 分页 */
const INDEX_INLINE_LIMIT = 120;
const INDEX_HEAD_COUNT = 80;
const INDEX_TAIL_COUNT = 20;

/**
 * PromptBuilder — Builds the analysis prompt from assembled data.
 */
export class PromptBuilder {
  build(
    data: AssembledData,
    platformName: string,
    purpose?: string,
    template?: PromptTemplate,
    allSummaries?: RequestSummary[],
    contextMode: ContextMode = "index_first",
  ): PromptMessages {
    const indexFirst = contextMode !== "legacy_inline";
    const summaries = allSummaries
      ?? data.requests.map((r) => this.toSummary(r, data.streamingRequests.some((s) => s.seq === r.seq)));
    const hasExtraIndex = Boolean(allSummaries && allSummaries.length > data.requests.length);

    const toolHint = indexFirst || hasExtraIndex
      ? "\n你可以使用 list_requests / search_requests / get_request_detail 工具按需缩小范围并查看请求详情。首轮上下文仅提供请求索引，不要假设正文已内联；信息不足时主动调用工具。"
      : "";

    const system = (template?.systemPrompt
      || `你是一位网站协议分析专家。你的任务是分析用户在网站上的操作过程中产生的HTTP请求、JS调用和存储变化，识别其业务场景，并生成结构化的协议分析报告。Be precise and technical. Output in Chinese (Simplified).`) + toolHint;

    const analysisRequirements = template?.requirements
      || this.buildAnalysisRequirements(purpose);
    const storageSection = this.formatStorageDiff(data.storageDiff);
    const sceneSection = this.formatSceneHints(data.sceneHints);
    const authSection = this.formatAuthChain(data.authChain);
    const streamingSection = this.formatStreamingRequests(
      data.streamingRequests,
    );
    const cryptoHooksSection = this.formatCryptoHooks(data.requests);
    const cryptoScriptsSection = this.formatCryptoScripts(data.cryptoScripts);

    if (indexFirst) {
      const requestIndexSection = this.formatRequestIndex(summaries, 0, true);
      const user = `以下是用户在 ${platformName} 上操作时的数据索引（默认不内联 request/response 正文）。

## 场景线索
${sceneSection}

## 鉴权链
${authSection}

## 流式通信
${streamingSection}

${requestIndexSection}
## 加密操作记录
${cryptoHooksSection}

## 相关加密代码片段
${cryptoScriptsSection}

## 存储变化
${storageSection}

## 分析要求
${analysisRequirements}

## 工具使用约定
1. 先根据请求索引定位关键请求（登录/鉴权/业务 API/流式端点）
2. 索引很长时先用 list_requests 过滤，或用 search_requests 按关键字搜索
3. 使用 get_request_detail 按需拉取 1~5 条详情，再继续分析
4. 不要编造未通过工具确认的请求体或响应体字段`;
      return { system, user };
    }

    const requestsSection = this.formatRequests(data.requests);
    const hooksSection = this.formatHooks(data.requests);
    const requestIndexSection = hasExtraIndex
      ? this.formatRequestIndex(allSummaries!, data.requests.length, false)
      : "";

    const user = `以下是用户在 ${platformName} 上操作时的完整数据。

## 场景线索
${sceneSection}

## 鉴权链
${authSection}

## 流式通信
${streamingSection}

## 请求日志
${requestsSection}

## JS Hook 数据
${hooksSection}

## 加密操作记录
${cryptoHooksSection}

## 相关加密代码片段
${cryptoScriptsSection}

## 存储变化
${storageSection}
${requestIndexSection}
## 分析要求
${analysisRequirements}`;

    return { system, user };
  }

  /**
   * Phase 1：构建轻量级预过滤 prompt，用于 AI 判断请求相关性
   */
  buildFilterPrompt(
    summaries: RequestSummary[],
    sceneHints: SceneHint[],
    purpose?: string,
    template?: PromptTemplate,
  ): PromptMessages {
    const system = `你是一个HTTP请求相关性过滤器。给定请求摘要列表和分析目的，判断哪些请求与分析目的相关。
仅返回JSON数组，包含相关请求的序号。例如：[1, 3, 5, 8]
宁可多选也不要遗漏——如果一个请求可能相关，就包含它。
不要返回任何其他内容，只返回JSON数组。`;

    const analysisRequirements = template?.requirements
      || this.buildAnalysisRequirements(purpose);
    const sceneSection = this.formatSceneHints(sceneHints);

    const summaryLines = summaries.map(s => {
      const ct = s.contentType ? ` [${s.contentType.split(';')[0].trim()}]` : '';
      return `#${s.seq} ${s.method} ${s.url} -> ${s.status ?? 'pending'}${ct}`;
    }).join('\n');

    const user = `## 分析目的
${analysisRequirements}

## 场景线索
${sceneSection}

## 请求摘要（共 ${summaries.length} 条）
${summaryLines}

请返回与分析目的相关的请求序号JSON数组。包含直接相关和支撑性请求（如认证请求）。`;

    return { system, user };
  }

  private buildAnalysisRequirements(purpose?: string): string {
    if (!purpose || purpose === "auto") {
      return DEFAULT_REQUIREMENTS;
    }

    const predefinedMap: Record<string, string> = {
      "reverse-api": REVERSE_API_REQUIREMENTS,
      "security-audit": SECURITY_AUDIT_REQUIREMENTS,
      performance: PERFORMANCE_REQUIREMENTS,
      "crypto-reverse": CRYPTO_REVERSE_REQUIREMENTS,
    };

    if (predefinedMap[purpose]) {
      return predefinedMap[purpose];
    }

    return `用户指定的分析重点：${purpose}

在完成上述重点分析的同时，也请覆盖以下基础分析：
${DEFAULT_REQUIREMENTS}`;
  }

  private formatSceneHints(hints: SceneHint[]): string {
    if (hints.length === 0) return "(无场景线索)";
    return hints
      .map((h) => `- **${h.scene}** [${h.confidence}]: ${h.evidence}`)
      .join("\n");
  }

  private formatAuthChain(chain: AuthChainItem[]): string {
    if (chain.length === 0) return "(无鉴权数据)";
    return chain
      .map((a) => {
        const consumers =
          a.consumers.length > 0 ? `\n  使用者: ${a.consumers.join(", ")}` : "";
        return `- **${a.credentialType}** (来源: ${a.source})${consumers}`;
      })
      .join("\n");
  }

  private formatStreamingRequests(requests: FilteredRequest[]): string {
    if (requests.length === 0) return "(无流式通信)";
    return requests.map((r) => `- #${r.seq} ${r.method} ${r.url}`).join("\n");
  }

  private formatRequests(requests: AssembledData["requests"]): string {
    if (requests.length === 0) return "(无请求记录)";
    return requests
      .map((r) => {
        const lines: string[] = [
          `#${r.seq} ${r.method} ${r.url} → ${r.status || "pending"}`,
        ];
        const important = this.filterHeaders(r.headers);
        if (Object.keys(important).length > 0)
          lines.push(`  Headers: ${JSON.stringify(important)}`);
        if (r.body)
          lines.push(
            `  Body: ${this.sanitizeBody(r.body, 2000)}`,
          );
        if (r.responseBody)
          lines.push(
            `  Response: ${this.sanitizeBody(r.responseBody, 2000)}`,
          );
        return lines.join("\n");
      })
      .join("\n\n");
  }

  private formatHooks(requests: AssembledData["requests"]): string {
    const allHooks = requests.flatMap((r) => r.hooks);
    if (allHooks.length === 0) return "(无 JS Hook 记录)";
    return allHooks
      .map(
        (h) =>
          `[${h.hook_type}] ${h.function_name}: args=${this.sanitizeBody(h.arguments, 500)}${h.result ? ` result=${this.sanitizeBody(h.result, 500)}` : ""}`,
      )
      .join("\n");
  }

  private formatStorageDiff(diff: AssembledData["storageDiff"]): string {
    const sections: string[] = [];
    for (const [type, d] of Object.entries(diff)) {
      const parts: string[] = [];
      if (Object.keys(d.added).length > 0)
        parts.push(
          `  新增: ${Object.entries(d.added)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}`,
        );
      if (Object.keys(d.changed).length > 0)
        parts.push(
          `  变更: ${Object.entries(d.changed)
            .map(([k, v]) => `${k}: "${v.old}" → "${v.new}"`)
            .join(", ")}`,
        );
      if (d.removed.length > 0) parts.push(`  删除: ${d.removed.join(", ")}`);
      if (parts.length > 0) sections.push(`${type}:\n${parts.join("\n")}`);
    }
    return sections.length > 0 ? sections.join("\n\n") : "(无存储变化)";
  }

  private formatCryptoHooks(requests: AssembledData['requests']): string {
    const cryptoHooks = requests.flatMap(r => r.hooks).filter(
      h => h.hook_type === 'crypto' || h.hook_type === 'crypto_lib'
    );
    if (cryptoHooks.length === 0) return '(无加密操作记录)';

    // Group by function name
    const groups = new Map<string, typeof cryptoHooks>();
    for (const h of cryptoHooks) {
      const key = h.function_name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(h);
    }

    const lines: string[] = [];
    for (const [funcName, hooks] of groups) {
      lines.push(`- **${funcName}** (${hooks.length}次调用)`);
      // Show up to 3 representative calls
      for (const h of hooks.slice(0, 3)) {
        const args = this.sanitizeBody(h.arguments, 200);
        const result = h.result ? this.sanitizeBody(h.result, 200) : '';
        lines.push(`  args=${args}${result ? ` → ${result}` : ''}`);
        if (h.call_stack) {
          const topFrame = h.call_stack.split('\n')[0]?.trim();
          if (topFrame) lines.push(`  来源: ${topFrame}`);
        }
      }
      if (hooks.length > 3) lines.push(`  ...及其他 ${hooks.length - 3} 次调用`);
    }
    return lines.join('\n');
  }

  private formatCryptoScripts(snippets: CryptoScriptSnippet[]): string {
    if (!snippets || snippets.length === 0) return '(无相关加密代码)';
    return snippets.map(s => {
      const patterns = s.matchedPatterns.join(', ');
      return `### ${s.scriptUrl} (行 ${s.lineRange[0]}-${s.lineRange[1]})\n匹配: ${patterns}\n\`\`\`javascript\n${s.content}\n\`\`\``;
    }).join('\n\n');
  }

  private toSummary(r: FilteredRequest, isStreaming = false): RequestSummary {
    const authHeader = r.headers["authorization"] || r.headers["Authorization"] || "";
    return {
      seq: r.seq,
      method: r.method,
      url: r.url,
      status: r.status,
      contentType: r.responseHeaders?.["content-type"]
        ?? r.responseHeaders?.["Content-Type"]
        ?? r.headers["content-type"]
        ?? r.headers["Content-Type"]
        ?? null,
      timestamp: r.timestamp,
      bodyBytes: r.body ? r.body.length : 0,
      responseBytes: r.responseBody ? r.responseBody.length : 0,
      hasAuthHeader: Boolean(authHeader),
      isStreaming,
      hookCount: r.hooks.length,
    };
  }

  private formatTimestamp(ts?: number): string {
    if (!ts) return "-";
    try {
      return new Date(ts).toISOString();
    } catch {
      return String(ts);
    }
  }

  private formatBytes(n?: number): string {
    const value = typeof n === "number" ? n : 0;
    if (value < 1024) return `${value}B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  }

  private formatIndexLine(s: RequestSummary): string {
    const ct = s.contentType ? ` [${s.contentType.split(";")[0].trim()}]` : "";
    const flags: string[] = [];
    if (s.hasAuthHeader) flags.push("auth");
    if (s.isStreaming) flags.push("stream");
    if (s.hookCount && s.hookCount > 0) flags.push(`hooks=${s.hookCount}`);
    const flagText = flags.length ? ` {${flags.join(",")}}` : "";
    return `#${s.seq} ${s.method} ${s.url} @ ${this.formatTimestamp(s.timestamp)} -> ${s.status ?? "pending"}${ct} body=${this.formatBytes(s.bodyBytes)} resp=${this.formatBytes(s.responseBytes)}${flagText}`;
  }

  private paginateSummaries(summaries: RequestSummary[]): {
    lines: string[];
    truncated: boolean;
    shown: number;
  } {
    if (summaries.length <= INDEX_INLINE_LIMIT) {
      return {
        lines: summaries.map((s) => this.formatIndexLine(s)),
        truncated: false,
        shown: summaries.length,
      };
    }
    const head = summaries.slice(0, INDEX_HEAD_COUNT);
    const tail = summaries.slice(-INDEX_TAIL_COUNT);
    const omitted = summaries.length - head.length - tail.length;
    const lines = [
      ...head.map((s) => this.formatIndexLine(s)),
      `... 省略中间 ${omitted} 条（共 ${summaries.length} 条）。请用 list_requests({ offset, limit, page }) 或 search_requests 翻页/检索 ...`,
      ...tail.map((s) => this.formatIndexLine(s)),
    ];
    return { lines, truncated: true, shown: head.length + tail.length };
  }

  private formatRequestIndex(summaries: RequestSummary[], analysisCount: number, indexFirst: boolean): string {
    const { lines, truncated, shown } = this.paginateSummaries(summaries);

    if (indexFirst) {
      const pageHint = truncated
        ? `\n首轮仅展示头 ${INDEX_HEAD_COUNT} + 尾 ${INDEX_TAIL_COUNT} 条（共展示 ${shown}/${summaries.length}）。超大会话请优先 list_requests / search_requests。`
        : "";
      return `## 请求索引（共 ${summaries.length} 条，正文未内联）
格式: #seq METHOD URL @ time -> status [content-type] body=.. resp=..
可使用 list_requests / search_requests 缩小范围，再用 get_request_detail 查看详情。${pageHint}

${lines.join("\n")}
`;
    }

    return `
## 完整请求索引（包含被过滤的请求）
以下是本次会话中所有 ${summaries.length} 条请求的摘要（当前深度分析仅包含其中 ${analysisCount} 条${truncated ? `，索引已分页展示 ${shown} 条` : ""}）。
如果你认为被过滤的请求可能与分析相关，可以调用 get_request_detail / list_requests 工具获取。

${lines.join("\n")}

`;
  }

  /**
   * Sanitize body content for safe embedding in prompts sent to LLM APIs.
   * Removes control characters and non-printable chars that may break JSON
   * parsing in intermediate proxies (e.g., Go-based API gateways).
   */
  private sanitizeBody(text: string, maxLen: number): string {
    // Remove ASCII control chars (except \n \r \t) and Unicode replacement char
    const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFD]/g, '');
    if (cleaned.length <= maxLen) return cleaned;
    // Unicode-safe truncation: avoid cutting surrogate pairs
    let end = maxLen;
    const code = cleaned.charCodeAt(end - 1);
    if (code >= 0xD800 && code <= 0xDBFF) end--;
    return cleaned.substring(0, end) + '...';
  }

  private filterHeaders(
    headers: Record<string, string>,
  ): Record<string, string> {
    const important = [
      "authorization",
      "x-token",
      "x-csrf-token",
      "x-request-id",
      "x-signature",
      "content-type",
      "cookie",
      "referer",
      "origin",
      "user-agent",
    ];
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (important.includes(key.toLowerCase())) result[key] = value;
    }
    return result;
  }
}
