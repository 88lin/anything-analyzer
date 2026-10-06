import { app } from "electron";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MCPToolInfo } from "../mcp/mcp-manager";
import type { ToolCallOutcome } from "./request-tools";

/**
 * Anything Analyzer 内置技能库（reverse-skill 精选子集）。
 *
 * 技能库随安装包分发到 `resources/skills/reverse-skill/`（见 electron-builder.yml 的
 * extraResources），开发期位于仓库的 `resources/skills/reverse-skill/`。
 * 本模块只提供**只读**访问：目录列举、全文检索、按行读取。
 */

/** 技能库目录名 */
const SKILL_LIB_DIRNAME = "reverse-skill";
/** list_skills 输出字符上限 */
export const MAX_LIST_CHARS = 12_000;
/** search_skills 单次命中上限 */
export const MAX_SEARCH_HITS = 40;
/** search_skills 输出字符上限 */
export const MAX_SEARCH_CHARS = 8_000;
/** read_skill 默认返回行数 */
export const DEFAULT_READ_LINES = 300;
/** read_skill 单次返回行数上限 */
export const MAX_READ_LINES = 800;
/** read_skill 可读取的单文件字节上限 */
export const MAX_FILE_BYTES = 512 * 1024;
/** search_skills 单文件扫描字节上限 */
const MAX_SCAN_BYTES = 512 * 1024;
/** 目录递归深度上限 */
const MAX_DEPTH = 4;
/** 视为文本、允许读取与检索的扩展名 */
const TEXT_EXTENSIONS = new Set([".md", ".json", ".txt", ".yaml", ".yml", ".csv"]);

/** 仅用于单元测试的根目录覆盖 */
let overrideRoot: string | null = null;
let catalogCache: { root: string; entries: SkillEntry[]; files: string[] } | null = null;

export function setSkillLibraryRootForTest(root: string | null): void {
  overrideRoot = root;
  catalogCache = null;
}

/**
 * 解析技能库根目录。
 * 优先级：测试覆盖 > 环境变量 ANYTHING_SKILL_DIR > 打包路径 > 开发路径。
 */
export function getSkillLibraryRoot(): string {
  if (overrideRoot) return overrideRoot;
  const fromEnv = process.env.ANYTHING_SKILL_DIR;
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return app.isPackaged
    ? join(process.resourcesPath, "skills", SKILL_LIB_DIRNAME)
    : join(app.getAppPath(), "resources", "skills", SKILL_LIB_DIRNAME);
}

/** 技能库目录是否真实存在（用于决定是否向模型暴露这些工具）。 */
export function hasSkillLibrary(): boolean {
  try {
    return existsSync(getSkillLibraryRoot());
  } catch {
    return false;
  }
}

export const BUILTIN_SKILL_TOOLS: MCPToolInfo[] = [
  {
    serverName: "_builtin",
    name: "list_skills",
    description:
      "列出内置技能库（reverse-skill 逆向/安全方法论）的全部条目与文件清单。用于发现「有没有对口的方法论」，再决定读哪个文件。可选 filter 按关键词过滤。",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "关键词过滤（大小写不敏感），匹配技能名、描述与文件路径，如 签名 / 加密 / API / 报告",
        },
      },
      required: [],
    },
  },
  {
    serverName: "_builtin",
    name: "search_skills",
    description:
      "在内置技能库正文里按关键词检索，返回命中文件与行号。定位「某个方法/概念写在哪一篇」时优先用它，比逐个 read_skill 更省上下文。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词（大小写不敏感，按子串匹配）" },
        limit: { type: "number", description: `命中条数上限，默认 20，最大 ${MAX_SEARCH_HITS}` },
        case_sensitive: { type: "boolean", description: "是否区分大小写，默认 false" },
      },
      required: ["query"],
    },
  },
  {
    serverName: "_builtin",
    name: "read_skill",
    description:
      "按相对路径读取技能库中的文本文件（.md/.json/.txt 等）。长文件按行窗口返回，用 offset/limit 续读。路径相对于技能库根目录，例如 js-reverse/SKILL.md。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对技能库根目录的文件路径，如 js-reverse/SKILL.md、ops/evidence-finding-path.md",
        },
        offset: { type: "number", description: "起始行号（从 1 开始），默认 1" },
        limit: { type: "number", description: `返回行数，默认 ${DEFAULT_READ_LINES}，最大 ${MAX_READ_LINES}` },
      },
      required: ["path"],
    },
  },
];

interface SkillEntry {
  /** frontmatter 中的 name，缺省时用目录名 */
  name: string;
  /** 相对技能库根目录的路径，如 js-reverse/SKILL.md */
  relPath: string;
  description: string;
}

interface Frontmatter {
  name?: string;
  description?: string;
}

function isTextFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return true; // LICENSE / VERSION 这类无扩展名文件
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function readTextFile(absPath: string, maxBytes = MAX_SCAN_BYTES): string | null {
  try {
    const stat = statSync(absPath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 解析 SKILL.md 的 YAML frontmatter，只取 name / description。
 * 支持单行值与 `description: |` 块标量（上游多个模块用块标量写长描述）。
 */
export function parseFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result: Frontmatter = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    if (key !== "name" && key !== "description") continue;
    let value = kv[2].trim();

    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      // 块标量：收集后续缩进行
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === "") {
          block.push("");
          continue;
        }
        if (!/^\s+/.test(next)) break;
        block.push(next.replace(/^\s+/, ""));
        i = j;
      }
      value = block.join("\n").trim();
    } else if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    if (value) result[key as "name" | "description"] = value;
  }
  return result;
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) continue;
      const abs = join(dir, dirent.name);
      if (dirent.isDirectory()) {
        visit(abs, depth + 1);
      } else if (dirent.isFile() && isTextFile(dirent.name)) {
        out.push(abs);
      }
    }
  };
  visit(root, 1);
  out.sort();
  return out;
}

function toRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

function buildCatalog(root: string): { entries: SkillEntry[]; files: string[] } {
  if (catalogCache && catalogCache.root === root) return catalogCache;
  const files = walkFiles(root);
  const entries: SkillEntry[] = [];
  for (const abs of files) {
    if (!abs.endsWith(`${sep}SKILL.md`)) continue;
    const rel = toRel(root, abs);
    const fm = parseFrontmatter(readTextFile(abs, 32 * 1024) ?? "");
    const dirName = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")).split("/").pop()! : rel;
    entries.push({
      name: fm.name || dirName,
      relPath: rel,
      description: fm.description || "(无描述)",
    });
  }
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
  catalogCache = { root, entries, files };
  return catalogCache;
}

function clip(text: string, limit: number, label: string): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...[${label} 已截断，共 ${text.length} 字符]`;
}

function skillDirHint(root: string): string {
  return `技能库目录：${root}\n`;
}

function missingRootOutcome(root: string, tool: string): ToolCallOutcome {
  return {
    result: `技能库不可用：未找到目录 ${root}。请忽略该工具继续分析。`,
    fetchedSeqs: [],
    refLine: `[${tool}](error=library_missing)`,
  };
}

export function handleListSkills(args: Record<string, unknown>, root: string): ToolCallOutcome {
  if (!existsSync(root)) return missingRootOutcome(root, "list_skills");
  const { entries, files } = buildCatalog(root);
  const filter = typeof args.filter === "string" ? args.filter.trim().toLowerCase() : "";

  const matchedEntries = filter
    ? entries.filter(
        (e) =>
          e.name.toLowerCase().includes(filter) ||
          e.description.toLowerCase().includes(filter) ||
          e.relPath.toLowerCase().includes(filter),
      )
    : entries;
  const entryPaths = new Set(entries.map((e) => e.relPath));
  const matchedFiles = files
    .map((abs) => toRel(root, abs))
    .filter((rel) => {
      if (entryPaths.has(rel)) return false;
      if (!filter) return true;
      return rel.toLowerCase().includes(filter);
    });

  const lines: string[] = [];
  if (filter) lines.push(`过滤词：${filter}`);
  lines.push(`## 技能条目（${matchedEntries.length}/${entries.length}）`);
  if (matchedEntries.length === 0) {
    lines.push("(无匹配)");
  } else {
    for (const e of matchedEntries) {
      const desc = e.description.replace(/\s+/g, " ").trim();
      lines.push(`- ${e.name}  [${e.relPath}]`);
      lines.push(`  ${desc.length > 300 ? `${desc.slice(0, 300)}…` : desc}`);
    }
  }
  lines.push("");
  lines.push(`## 参考文档（${matchedFiles.length}）`);
  if (matchedFiles.length === 0) {
    lines.push("(无匹配)");
  } else {
    for (const rel of matchedFiles) lines.push(`- ${rel}`);
  }
  lines.push("");
  lines.push("用 read_skill { path } 读取；用 search_skills { query } 在正文里检索。");

  return {
    result: clip(`${skillDirHint(root)}\n${lines.join("\n")}`, MAX_LIST_CHARS, "list_skills"),
    fetchedSeqs: [],
    refLine: `[list_skills](entries=${matchedEntries.length},files=${matchedFiles.length}${filter ? `,filter=${JSON.stringify(filter)}` : ""})`,
  };
}

export function handleSearchSkills(args: Record<string, unknown>, root: string): ToolCallOutcome {
  if (!existsSync(root)) return missingRootOutcome(root, "search_skills");
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return {
      result: "Error: query 不能为空",
      fetchedSeqs: [],
      refLine: "[search_skills](error=empty_query)",
    };
  }
  const caseSensitive = args.case_sensitive === true;
  const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit);
  const limit = Math.min(
    MAX_SEARCH_HITS,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20),
  );

  const needle = caseSensitive ? query : query.toLowerCase();
  const { files } = buildCatalog(root);
  const hits: string[] = [];
  let scanned = 0;
  let truncated = false;

  for (const abs of files) {
    if (hits.length >= limit) {
      truncated = true;
      break;
    }
    const text = readTextFile(abs);
    if (text === null) continue;
    scanned++;
    const rel = toRel(root, abs);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hay = caseSensitive ? line : line.toLowerCase();
      if (!hay.includes(needle)) continue;
      hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 240)}`);
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
    }
  }

  const result = hits.length
    ? `命中 ${hits.length} 条${truncated ? "（已达上限）" : ""}，扫描 ${scanned} 个文件：\n${hits.join("\n")}\n\n用 read_skill { path, offset } 读取命中处上下文。`
    : `未在技能库中找到 “${query}”（已扫描 ${scanned} 个文件）。`;

  return {
    result: clip(result, MAX_SEARCH_CHARS, "search_skills"),
    fetchedSeqs: [],
    refLine: `[search_skills](query=${JSON.stringify(query)},hits=${hits.length})`,
  };
}

export function handleReadSkill(args: Record<string, unknown>, root: string): ToolCallOutcome {
  if (!existsSync(root)) return missingRootOutcome(root, "read_skill");
  const rawPath = typeof args.path === "string" ? args.path.trim() : "";
  if (!rawPath) {
    return {
      result: "Error: 请提供 path，例如 js-reverse/SKILL.md",
      fetchedSeqs: [],
      refLine: "[read_skill](error=missing_path)",
    };
  }

  // 归一化：统一分隔符，剥离技能库根目录前缀，禁止绝对路径与上跳
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const relInput = normalized.startsWith(`${SKILL_LIB_DIRNAME}/`)
    ? normalized.slice(SKILL_LIB_DIRNAME.length + 1)
    : normalized;

  if (isAbsolute(relInput) || /^[A-Za-z]:/.test(relInput)) {
    return {
      result: `Error: path 必须是相对技能库根目录的路径，收到绝对路径 ${rawPath}`,
      fetchedSeqs: [],
      refLine: "[read_skill](error=absolute_path)",
    };
  }
  const abs = resolve(root, relInput);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      result: `Error: path 越界，只允许读取技能库内的文件：${rawPath}`,
      fetchedSeqs: [],
      refLine: "[read_skill](error=path_escape)",
    };
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return {
      result: `Error: 技能库中不存在文件 ${relInput}。可用 list_skills 查看全部文件。`,
      fetchedSeqs: [],
      refLine: `[read_skill](error=not_found,path=${JSON.stringify(relInput)})`,
    };
  }
  if (!isTextFile(abs)) {
    return {
      result: `Error: 仅支持读取文本文件（.md/.json/.txt/.yml/.csv），${relInput} 不是文本文件。`,
      fetchedSeqs: [],
      refLine: `[read_skill](error=not_text,path=${JSON.stringify(relInput)})`,
    };
  }
  const text = readTextFile(abs, MAX_FILE_BYTES);
  if (text === null) {
    return {
      result: `Error: ${relInput} 超过单文件上限（${Math.floor(MAX_FILE_BYTES / 1024)}KB）或无法读取。`,
      fetchedSeqs: [],
      refLine: `[read_skill](error=too_large,path=${JSON.stringify(relInput)})`,
    };
  }

  const allLines = text.split(/\r?\n/);
  const totalLines = allLines.length;
  const rawOffset = typeof args.offset === "number" ? args.offset : Number(args.offset);
  const rawLimit = typeof args.limit === "number" ? args.limit : Number(args.limit);
  const offset = Math.max(
    1,
    Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 1,
  );
  const limit = Math.min(
    MAX_READ_LINES,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_READ_LINES),
  );
  const start = Math.min(offset, totalLines);
  const slice = allLines.slice(start - 1, start - 1 + limit);
  const end = start - 1 + slice.length;

  const header = `# ${relInput}（共 ${totalLines} 行，显示 ${start}-${end}）`;
  const footer =
    end < totalLines
      ? `\n\n...[还有 ${totalLines - end} 行，用 read_skill { path: "${relInput}", offset: ${end + 1}, limit: ${limit} } 续读]`
      : "";

  return {
    result: `${header}\n\n${slice.join("\n")}${footer}`,
    fetchedSeqs: [],
    refLine: `[read_skill](path=${JSON.stringify(relInput)},lines=${start}-${end}/${totalLines})`,
  };
}

/**
 * 分发技能库工具调用；不是技能工具时返回 null，交给后续分发器。
 */
export function dispatchBuiltinSkillTool(
  name: string,
  args: Record<string, unknown>,
  root: string = getSkillLibraryRoot(),
): ToolCallOutcome | null {
  switch (name) {
    case "list_skills":
      return handleListSkills(args, root);
    case "search_skills":
      return handleSearchSkills(args, root);
    case "read_skill":
      return handleReadSkill(args, root);
    default:
      return null;
  }
}
