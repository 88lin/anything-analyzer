# Anything Analyzer v3.6.54

## 新增

- **会话交互读取工具** — AI 分析与追问新增 `read_session_interactions`，可按操作类型、页面和关键字读取点击、输入、滚动及目标元素详情。
- **会话 Hook 读取工具** — AI 分析与追问新增 `read_session_hooks`，可分页查看未关联 HTTP 请求的 Hook 参数、结果和调用栈。

## 优化

- **真实操作元素定位** — 点击嵌套文本、图标或 SVG 时，自动提升到最近的按钮、链接、输入框等可交互控件，记录稳定的 selector、XPath 和元素属性。
- **分析工具引导** — 分析提示会在需要还原用户操作或检查独立 JS 调用时主动使用 Interactions/Hooks 工具。

## 修复

- **Interaction 录制可靠性** — 交互脚本完成注入后再开启录制，避免初始化时序导致页面操作未被记录。
- **CDP 附加失败丢失交互** — Interaction 录制与 CDP 调试器解耦，即使目标页面无法附加 CDP，也能继续记录元素操作。
- **页面导航后停止录制** — 页面完整导航后自动重新注入交互脚本，并清理旧监听器，避免暂停、恢复或多次导航后失效或重复记录。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.6.54.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.54-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.54-x64.dmg |
| Linux | Anything-Analyzer-3.6.54.AppImage |
