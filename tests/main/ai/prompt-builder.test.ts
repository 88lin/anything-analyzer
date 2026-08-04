import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../../../src/main/ai/prompt-builder";
import type { AssembledData } from "../../../src/shared/types";

// Minimal fixture to satisfy PromptBuilder
function createMinimalData(): AssembledData {
  return {
    requests: [
      {
        seq: 1,
        method: "GET",
        url: "https://example.com/api/test",
        headers: { "content-type": "application/json" },
        body: null,
        status: 200,
        responseHeaders: null,
        responseBody: '{"ok":true}',
        hooks: [],
      },
    ],
    storageDiff: {
      cookies: { added: {}, changed: {}, removed: [] },
      localStorage: { added: {}, changed: {}, removed: [] },
      sessionStorage: { added: {}, changed: {}, removed: [] },
    },
    estimatedTokens: 100,
    sceneHints: [],
    streamingRequests: [],
    authChain: [],
    cryptoScripts: [],
  };
}

describe("PromptBuilder", () => {
  const builder = new PromptBuilder();
  const data = createMinimalData();
  const minimalData = data;
  const platform = "example.com";

  describe("purpose=undefined (default)", () => {
    it("should include default 8 analysis requirements", () => {
      const { user } = builder.build(data, platform);
      expect(user).toContain("场景识别");
      expect(user).toContain("交互流程概述");
      expect(user).toContain("API端点清单");
      expect(user).toContain("鉴权机制分析");
      expect(user).toContain("流式通信分析");
      expect(user).toContain("存储使用分析");
      expect(user).toContain("关键依赖关系");
      expect(user).toContain("复现建议");
    });
  });

  describe('purpose="auto"', () => {
    it("should produce identical output to undefined", () => {
      const defaultResult = builder.build(data, platform);
      const autoResult = builder.build(data, platform, "auto");
      expect(autoResult.system).toBe(defaultResult.system);
      expect(autoResult.user).toBe(defaultResult.user);
    });
  });

  describe('purpose="" (empty string)', () => {
    it("should produce identical output to undefined", () => {
      const defaultResult = builder.build(data, platform);
      const emptyResult = builder.build(data, platform, "");
      expect(emptyResult.system).toBe(defaultResult.system);
      expect(emptyResult.user).toBe(defaultResult.user);
    });
  });

  describe('purpose="reverse-api"', () => {
    it("should replace analysis requirements with reverse-api specific ones", () => {
      const { user } = builder.build(data, platform, "reverse-api");
      expect(user).toContain("完整 API 端点清单");
      expect(user).toContain("鉴权流程");
      expect(user).toContain("请求依赖链");
      expect(user).toContain("数据模型推断");
      expect(user).toContain("复现代码");
      // Should NOT contain default requirements
      expect(user).not.toContain("场景识别：判断用户执行了什么操作");
    });
  });

  describe('purpose="security-audit"', () => {
    it("should replace analysis requirements with security-specific ones", () => {
      const { user } = builder.build(data, platform, "security-audit");
      expect(user).toContain("认证安全");
      expect(user).toContain("敏感数据暴露");
      expect(user).toContain("CSRF/XSS 风险");
      expect(user).toContain("权限控制");
      expect(user).toContain("安全建议");
      expect(user).not.toContain("场景识别：判断用户执行了什么操作");
    });
  });

  describe('purpose="performance"', () => {
    it("should replace analysis requirements with performance-specific ones", () => {
      const { user } = builder.build(data, platform, "performance");
      expect(user).toContain("请求时序分析");
      expect(user).toContain("冗余请求");
      expect(user).toContain("资源优化");
      expect(user).toContain("缓存策略");
      expect(user).toContain("性能建议");
      expect(user).not.toContain("场景识别：判断用户执行了什么操作");
    });
  });

  describe("purpose=custom text", () => {
    it("should prepend custom purpose and keep default requirements as baseline", () => {
      const customText = "分析用户注册流程中的所有加密操作";
      const { user } = builder.build(data, platform, customText);
      expect(user).toContain(
        "用户指定的分析重点：分析用户注册流程中的所有加密操作",
      );
      expect(user).toContain("在完成上述重点分析的同时，也请覆盖以下基础分析");
      // Default requirements should still be present
      expect(user).toContain("场景识别");
    });

    it("should not alter the system prompt for custom text", () => {
      const defaultResult = builder.build(data, platform);
      const customResult = builder.build(data, platform, "自定义分析");
      expect(customResult.system).toBe(defaultResult.system);
    });
  });

  it('should return CRYPTO_REVERSE_REQUIREMENTS for crypto-reverse purpose', () => {
    const result = builder.build(minimalData, 'TestPlatform', 'crypto-reverse')
    expect(result.user).toContain('加密算法识别')
    expect(result.user).toContain('加密流程还原')
    expect(result.user).toContain('密钥管理分析')
    expect(result.user).toContain('Python')
  })

  it('should include crypto hooks section in prompt', () => {
    const dataWithCryptoHooks: AssembledData = {
      ...minimalData,
      requests: [{
        seq: 1, method: 'POST', url: 'https://example.com/api/login',
        headers: {}, body: null, status: 200,
        responseHeaders: null, responseBody: null,
        hooks: [{
          id: 1, session_id: 's1', timestamp: Date.now(),
          hook_type: 'crypto_lib', function_name: 'CryptoJS.AES.encrypt',
          arguments: '["data","key"]', result: '"U2FsdGVkX1..."',
          call_stack: 'at encrypt (https://example.com/js/api.js:42:10)', related_request_id: null
        }]
      }],
    }
    const result = builder.build(dataWithCryptoHooks, 'TestPlatform')
    expect(result.user).toContain('加密操作记录')
    expect(result.user).toContain('CryptoJS.AES.encrypt')
  })

  it('should include crypto script snippets in prompt', () => {
    const dataWithSnippets: AssembledData = {
      ...minimalData,
      cryptoScripts: [{
        scriptUrl: 'https://example.com/js/crypto.js',
        lineRange: [10, 40] as [number, number],
        content: 'function encrypt(data) { return CryptoJS.AES.encrypt(data, key); }',
        matchedPatterns: ['CryptoJS'],
        tier: 1,
      }],
    }
    const result = builder.build(dataWithSnippets, 'TestPlatform')
    expect(result.user).toContain('相关加密代码片段')
    expect(result.user).toContain('crypto.js')
    expect(result.user).toContain('CryptoJS.AES.encrypt')
  })

  it('should show empty placeholders when no crypto data', () => {
    const result = builder.build(minimalData, 'TestPlatform')
    expect(result.user).toContain('(无加密操作记录)')
    expect(result.user).toContain('(无相关加密代码)')
  })
});


describe("contextMode=index_first", () => {
  const builder = new PromptBuilder();
  const data = createMinimalData();

  it("does not inline request/response bodies by default", () => {
    const { system, user } = builder.build(data, "example.com", undefined, undefined, undefined, "index_first");
    expect(system).toContain("get_request_detail");
    expect(user).toContain("请求索引");
    expect(user).toContain("#1 GET https://example.com/api/test");
    expect(user).not.toContain('{"ok":true}');
    expect(user).not.toContain("## 请求日志");
    expect(user).toContain("工具使用约定");
  });

  it("legacy_inline still embeds response body", () => {
    const { user } = builder.build(data, "example.com", undefined, undefined, undefined, "legacy_inline");
    expect(user).toContain("## 请求日志");
    expect(user).toContain('{"ok":true}');
  });
});


describe("index pagination", () => {
  it("paginates large request index in index_first mode", () => {
    const builder = new PromptBuilder();
    const base = createMinimalData();
    const requests = Array.from({ length: 150 }, (_, i) => ({
      seq: i + 1,
      method: "GET",
      url: `https://example.com/api/${i + 1}`,
      headers: {},
      body: null,
      status: 200,
      responseHeaders: null,
      responseBody: null,
      hooks: [],
      timestamp: 1_700_000_000_000 + i,
    }));
    const data = { ...base, requests };
    const summaries = requests.map((r) => ({
      seq: r.seq,
      method: r.method,
      url: r.url,
      status: r.status,
      contentType: "application/json",
      timestamp: r.timestamp,
      bodyBytes: 0,
      responseBytes: 0,
    }));
    const { user } = builder.build(data, "example.com", undefined, undefined, summaries, "index_first");
    expect(user).toContain("省略中间");
    expect(user).toContain("list_requests");
    expect(user).toContain("#1 GET");
    expect(user).toContain("#150 GET");
    // middle sample should be omitted
    expect(user).not.toContain("#90 GET https://example.com/api/90");
  });
});
