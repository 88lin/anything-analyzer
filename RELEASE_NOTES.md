# Anything Analyzer v3.7.0

## 新增

- **内置逆向 / 安全方法论技能库** — 应用现在内置 reverse-skill 方法论技能库（72 个文件，约 632 KB），随安装包分发到安装目录的 `resources/skills/reverse-skill/`，开箱即用，无需联网下载或额外安装。
- **AI 可按需查阅技能库** — 新增三个只读工具：`list_skills` 查看技能目录、`search_skills` 全文检索、`read_skill` 按行读取原文。技能内容按需渐进加载，不会挤占首轮上下文。
- **分析与追问两条链路均已接入** — 首轮分析的系统提示会引导模型在遇到请求签名与加密、鉴权与越权、JS 混淆与 Webpack 拆包、协议还原、证据-结论链与报告结构等问题时主动查阅技能库；追问（chat）沿用同一套工具路由，可继续沿用同一套方法论。
- **安全边界** — 技能工具拒绝绝对路径与 `../` 目录穿越，只允许读取白名单文本扩展名，单文件与单次扫描均有限长；技能库缺失时工具静默降级，不影响正常分析。
- **覆盖模块** — `reverse-engineering`、`js-reverse`、`api-security`、`protocol-reverse`、`code-audit`、`browser-extension-reverse`、`docs-generator`、`ops`，以及 `field-journal` 实战案例库。
- **来源与许可** — 内容取自 [zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill) v1.0.1（commit `cab634bd`），MIT 许可，逐字保留；来源、校验与更新方式见 `resources/skills/reverse-skill/INSTALLED.md`。

## 验证

- 新增 `tests/main/ai/skill-tools.test.ts`，26 项全部通过：覆盖 frontmatter 解析、目录列举与过滤、全文检索、分页读取、路径穿越与绝对路径拒绝、技能库缺失降级，以及针对真实技能库的端到端校验。
- Electron 生产构建通过；`electron-builder` 打包产物确认包含 `resources/skills/reverse-skill/`（72 个文件），技能库未被打入 `app.asar`。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.7.0.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.7.0-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.7.0-x64.dmg |
| Linux | Anything-Analyzer-3.7.0.AppImage |
