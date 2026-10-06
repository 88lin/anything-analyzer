# reverse-skill 内置说明（Anything Analyzer）

本目录是随 Anything Analyzer 安装包分发的第三方技能库，供软件内的 AI（分析 / 追问）
按需检索与阅读。

## 来源

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/zhaoxuya520/reverse-skill |
| 上游提交 | `cab634bd855fc287f6e420c1f36fd1a6b9245960` |
| 上游版本 | `VERSION` = 1.0.1 |
| 提交时间 | 2026-09-22 05:18:45 +0000 |
| 许可证 | MIT（`Copyright (c) 2026 zhaoxuya520`），见本目录 `LICENSE` |
| 引入日期 | 2026-10-06 |
| 引入方式 | 上游完整仓库按模块筛选后逐文件复制，未修改任何上游文件内容 |

上游仓库中 `CTF-Sandbox-Orchestrator/` 为 GPLv3、`burp-mcp-full/` 等为独立组件；本包
**未包含**它们，因此本目录整体为 MIT。

## 本目录内容（精选子集）

从上游 `skills/` 复制，保持上游目录层级不变，以保证模块文档里的相对链接
（如 `../field-journal/precedent-reverse.md`）依然有效：

```
js-reverse/                   上游原样
api-security/                 上游原样
protocol-reverse/             上游原样
code-audit/                   上游原样
browser-extension-reverse/    上游原样
docs-generator/               上游原样
reverse-engineering/          上游原样（含 dsl-vm-reverse/、references/）
ops/                          上游原样
field-journal/                仅保留 _index.md、precedent-{reverse,pentest,auth}.md
                              以及 seed-003 / seed-004 / seed-011 三个样板案例
references/                   仅保留 domain-coverage-map.md
LICENSE                       上游根目录 MIT 许可证（署名义务）
SKILL.md                      本项目编写：环境约束 + 模块索引（替换上游 skills/SKILL.md 路由表）
INSTALLED.md                  本文件
```

共 72 个文件（其中 70 个逐字复制自上游，2 个为本项目编写），约 632 KB。

**被有意剔除的模块**见 `SKILL.md` 第四节。剔除的原因有二：与「网页协议 / 前端 JS / API」
场景无关；以及不把武器化的攻击载荷库（`pentest-tools/src-hunter`）随商业软件分发。

## 为什么放在这里

- `resources/` 是 electron-builder 的 `directories.buildResources`，**默认不会被打进
  `app.asar`**（已核实：构建产物 `dist/win-unpacked/resources/app.asar` 里只有 `/out/**`，
  没有 `/resources/**`）。所以技能库必须通过 `electron-builder.yml` 的 `extraResources`
  显式复制到安装目录的 `resources/skills/` 下。
- 放在 asar 之外而不是打进 asar，好处是：文件可被用户直接查看、替换、增量更新，
  不需要重新打包；也便于将来扩展成「用户自定义技能目录」。

## 运行时解析

`src/main/ai/skill-tools.ts` 的 `getSkillLibraryRoot()`：

- 打包后（`app.isPackaged`）：`path.join(process.resourcesPath, "skills", "reverse-skill")`
- 开发时：`path.join(app.getAppPath(), "resources", "skills", "reverse-skill")`
- 环境变量覆盖：`ANYTHING_SKILL_DIR`（用于测试）

## 更新步骤

```powershell
$tmp = "$env:TEMP\reverse-skill-src"
git clone --depth 1 https://github.com/zhaoxuya520/reverse-skill.git $tmp
# 按上面的模块清单重新复制到 resources/skills/reverse-skill/，然后同步更新本文件的提交号
Remove-Item $tmp -Recurse -Force
```

## 已知限制

- 上游模块文档普遍以「ACTION REQUIRED」开头，要求读者去读 `../field-journal/precedent-*.md`、
  `../tool-index.md`，或运行 `../scripts/case-init.ps1`。其中 `tool-index.md`（上游由脚本生成、
  被 gitignore）和 `scripts/` 未随包分发。本目录的 `SKILL.md` 已在开头明确声明这一点，
  要求 AI 忽略无法执行的指令、不要声称已执行。
- 上游 `skills/SKILL.md` 的模块路由表覆盖约 45 个模块，与本子集不一致，因此未收录，
  由本项目编写的 `SKILL.md` 取代。
