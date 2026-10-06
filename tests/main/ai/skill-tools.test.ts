import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => "/nonexistent-app-path"),
    getPath: vi.fn(() => "/nonexistent-user-data"),
  },
}));

import {
  BUILTIN_SKILL_TOOLS,
  dispatchBuiltinSkillTool,
  handleListSkills,
  handleReadSkill,
  handleSearchSkills,
  hasSkillLibrary,
  parseFrontmatter,
  setSkillLibraryRootForTest,
} from "../../../src/main/ai/skill-tools";

let root = "";

function write(relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "anything-skill-"));
  setSkillLibraryRootForTest(root);
  write(
    "SKILL.md",
    ["---", "name: reverse-skill", "description: 逆向与安全方法论总入口", "---", "", "# 总入口", ""].join(
      "\n",
    ),
  );
  write(
    "js-reverse/SKILL.md",
    [
      "---",
      "name: js-reverse",
      "description: |",
      "  JS 逆向：混淆还原、Webpack 拆包、",
      "  Hook 与签名定位。",
      "---",
      "",
      "# JS 逆向",
      "先定位签名函数，再还原算法。",
      "",
    ].join("\n"),
  );
  write(
    "js-reverse/references/hook.md",
    ["# Hook 速查", "hook 常见注入点：XMLHttpRequest / fetch", ""].join("\n"),
  );
  write("ops/evidence-finding-path.md", ["# 证据-结论链", "每条结论必须有证据支撑。", ""].join("\n"));
  write("VERSION", "1.0.1\n");
});

afterEach(() => {
  setSkillLibraryRootForTest(null);
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
  it("解析单行 name/description", () => {
    expect(parseFrontmatter("---\nname: a-b\ndescription: 说明\n---\nbody")).toEqual({
      name: "a-b",
      description: "说明",
    });
  });

  it("解析块标量 description", () => {
    const fm = parseFrontmatter("---\nname: x\ndescription: |\n  第一行\n  第二行\n---\n");
    expect(fm.name).toBe("x");
    expect(fm.description).toBe("第一行\n第二行");
  });

  it("无 frontmatter 时返回空对象", () => {
    expect(parseFrontmatter("# 没有 frontmatter")).toEqual({});
  });
});

describe("list_skills", () => {
  it("列出技能条目与参考文档", () => {
    const outcome = handleListSkills({}, root);
    expect(outcome.result).toContain("reverse-skill  [SKILL.md]");
    expect(outcome.result).toContain("js-reverse  [js-reverse/SKILL.md]");
    expect(outcome.result).toContain("JS 逆向：混淆还原、Webpack 拆包、 Hook 与签名定位。");
    expect(outcome.result).toContain("js-reverse/references/hook.md");
    expect(outcome.result).toContain("ops/evidence-finding-path.md");
    // SKILL.md 本身只出现在「技能条目」，不再重复出现在参考文档
    expect(outcome.result).toContain("## 参考文档（3）");
    expect(outcome.refLine).toContain("entries=2");
  });

  it("按关键词过滤", () => {
    const outcome = handleListSkills({ filter: "hook" }, root);
    expect(outcome.result).toContain("js-reverse/references/hook.md");
    expect(outcome.result).not.toContain("ops/evidence-finding-path.md");
    expect(outcome.refLine).toContain('filter="hook"');
  });

  it("技能库目录不存在时返回可读错误而非抛异常", () => {
    setSkillLibraryRootForTest(join(root, "not-here"));
    const outcome = handleListSkills({}, join(root, "not-here"));
    expect(outcome.result).toContain("技能库不可用");
    expect(outcome.refLine).toContain("library_missing");
  });
});

describe("search_skills", () => {
  it("返回文件路径与行号，默认大小写不敏感", () => {
    const outcome = handleSearchSkills({ query: "HOOK" }, root);
    expect(outcome.result).toContain("js-reverse/references/hook.md:1:");
    expect(outcome.result).toContain("js-reverse/references/hook.md:2:");
    expect(outcome.refLine).toContain("hits=");
  });

  it("区分大小写时命中减少", () => {
    const insensitive = handleSearchSkills({ query: "HOOK" }, root);
    const sensitive = handleSearchSkills({ query: "HOOK", case_sensitive: true }, root);
    expect(insensitive.result).toContain("hook.md:1");
    expect(sensitive.result).toContain("未在技能库中找到");
  });

  it("空 query 返回错误", () => {
    const outcome = handleSearchSkills({ query: "   " }, root);
    expect(outcome.result).toContain("query 不能为空");
  });

  it("遵守 limit 上限", () => {
    const outcome = handleSearchSkills({ query: "hook", limit: 1 }, root);
    expect(outcome.refLine).toContain("hits=1");
  });
});

describe("read_skill", () => {
  it("读取文件并给出总行数", () => {
    const outcome = handleReadSkill({ path: "js-reverse/SKILL.md" }, root);
    expect(outcome.result).toContain("# js-reverse/SKILL.md（共");
    expect(outcome.result).toContain("先定位签名函数，再还原算法。");
    expect(outcome.refLine).toContain('path="js-reverse/SKILL.md"');
  });

  it("支持 offset/limit 续读并给出续读提示", () => {
    const outcome = handleReadSkill({ path: "js-reverse/SKILL.md", offset: 8, limit: 2 }, root);
    expect(outcome.result).toContain("显示 8-9");
    expect(outcome.result).toContain("续读");
  });

  it("接受反斜杠路径与 reverse-skill/ 前缀", () => {
    const outcome = handleReadSkill({ path: "reverse-skill\\js-reverse\\references\\hook.md" }, root);
    expect(outcome.result).toContain("# js-reverse/references/hook.md");
    expect(outcome.refLine).toContain('path="js-reverse/references/hook.md"');
  });

  it("拒绝上跳与绝对路径", () => {
    expect(handleReadSkill({ path: "../secret.md" }, root).result).toContain("越界");
    expect(handleReadSkill({ path: "js-reverse/../../secret.md" }, root).result).toContain("越界");
    expect(handleReadSkill({ path: "C:\\Windows\\win.ini" }, root).result).toContain("绝对路径");
    expect(handleReadSkill({ path: "/etc/passwd" }, root).result).toContain("绝对路径");
  });

  it("文件不存在时给出可用工具提示", () => {
    const outcome = handleReadSkill({ path: "nope/SKILL.md" }, root);
    expect(outcome.result).toContain("不存在文件");
    expect(outcome.result).toContain("list_skills");
  });

  it("空 path 返回错误", () => {
    expect(handleReadSkill({}, root).result).toContain("请提供 path");
  });

  it("无扩展名文本文件可读", () => {
    expect(handleReadSkill({ path: "VERSION" }, root).result).toContain("1.0.1");
  });
});

describe("dispatchBuiltinSkillTool", () => {
  it("分发三个内置技能工具", () => {
    expect(dispatchBuiltinSkillTool("list_skills", {}, root)).not.toBeNull();
    expect(dispatchBuiltinSkillTool("search_skills", { query: "hook" }, root)).not.toBeNull();
    expect(dispatchBuiltinSkillTool("read_skill", { path: "SKILL.md" }, root)).not.toBeNull();
  });

  it("未知工具名返回 null（交给后续分发器）", () => {
    expect(dispatchBuiltinSkillTool("get_request_detail", {}, root)).toBeNull();
    expect(dispatchBuiltinSkillTool("mcp__x__y", {}, root)).toBeNull();
  });

  it("技能工具均为 _builtin server 且带 inputSchema", () => {
    expect(BUILTIN_SKILL_TOOLS.map((t) => t.name)).toEqual([
      "list_skills",
      "search_skills",
      "read_skill",
    ]);
    for (const tool of BUILTIN_SKILL_TOOLS) {
      expect(tool.serverName).toBe("_builtin");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("fetchedSeqs 为空，refLine 可用于会话活动记录", () => {
    const outcome = dispatchBuiltinSkillTool("read_skill", { path: "SKILL.md" }, root)!;
    expect(outcome.fetchedSeqs).toEqual([]);
    expect(outcome.refLine.startsWith("[read_skill]")).toBe(true);
  });
});

describe("hasSkillLibrary", () => {
  it("目录存在时为 true", () => {
    expect(hasSkillLibrary()).toBe(true);
  });

  it("目录缺失时为 false", () => {
    setSkillLibraryRootForTest(join(root, "missing"));
    expect(hasSkillLibrary()).toBe(false);
  });
});

// 针对随包分发的真实语料做一次端到端校验：确保 resources/skills/reverse-skill
// 被 extraResources 打包后仍可被三个工具正常枚举、检索与读取。
describe("随包分发的真实技能库", () => {
  const shipped = join(process.cwd(), "resources", "skills", "reverse-skill");

  it("目录存在且可被 list_skills 完整枚举", () => {
    expect(existsSync(shipped)).toBe(true);
    setSkillLibraryRootForTest(shipped);
    const outcome = handleListSkills({}, shipped);
    expect(outcome.result).not.toContain("技能库不可用");
    const entries = Number(/entries=(\d+)/.exec(outcome.refLine)![1]);
    expect(entries).toBeGreaterThanOrEqual(8);
    expect(outcome.result).toContain("js-reverse/SKILL.md");
    expect(outcome.result).toContain("ops/evidence-finding-path.md");
    expect(outcome.result).toContain("field-journal/seed-004_js-sign-webpack.md");
  });

  it("read_skill 能读取关键文件", () => {
    setSkillLibraryRootForTest(shipped);
    const outcome = handleReadSkill({ path: "js-reverse/SKILL.md" }, shipped);
    expect(outcome.result).toContain("# js-reverse/SKILL.md");
    expect(outcome.result.length).toBeGreaterThan(200);
  });

  it("search_skills 在真实语料上能命中主题", () => {
    setSkillLibraryRootForTest(shipped);
    const outcome = handleSearchSkills({ query: "签名", limit: 10 }, shipped);
    expect(outcome.refLine).toMatch(/hits=[1-9]/);
  });
});
