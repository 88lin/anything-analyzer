# Anything Analyzer v3.6.62

## 修复

- **Windows 开始抓包无状态变化** — 抓包会话现在在 CDP/脚本注入等可选初始化之前立即切换为“运行中”。即使 Windows 的 debugger attach 被浏览器、杀毒软件或其他调试器拖慢，暂停和停止按钮也会立即可用，不再表现为“开始无反应”。
- **抓包控制错误可见** — 开始、暂停、恢复、停止 IPC 失败时在界面显示错误提示，不再只写到隐藏的开发者控制台。

- **Windows 抓包控制按钮失效** — 修复原生 `WebContentsView` 在会话创建后未重新同步实际占位区域的问题。旧版可能保留过大的原生浏览器边界，覆盖 React 工具栏并吞掉鼠标事件，导致“开始抓包 / 暂停 / 停止”无反应。现在会在会话或视图切换时重新测量并同步边界，并在主进程中限制边界不越过窗口内容区。
- **控制按钮可点击性回归保护** — 新增原生浏览器边界钳制测试，防止越界的原生视图再次覆盖界面控件。

- **Claude 工具上下文溢出** — 工具调用结果现在按上下文 token 预算统一限长，避免详情、Interactions 或第三方 MCP 返回大段数据后撑满模型窗口。
- **工具链上下文预留** — 进入工具循环前主动压缩初始消息，为后续工具结果和模型输出保留稳定空间。
- **工具轮次执行** — 默认安全上限由 10 轮提升至 64 轮，复杂分析可以持续调用工具；达到上限后要求模型基于已有结果生成最终回答。
- **多协议一致性** — OpenAI Chat Completions、Anthropic Messages 和 OpenAI Responses API 统一应用工具结果预算与轮次保护。

## 验证

- 新增超大 Claude 工具结果截断回归测试。
- 新增工具轮次达到上限后生成最终回答的回归测试。
- 新增 Claude 默认连续 12 轮工具调用回归测试。
- 全量测试通过：182 passed，4 skipped。
- Electron 生产构建通过。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.6.62.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.62-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.62-x64.dmg |
| Linux | Anything-Analyzer-3.6.62.AppImage |
