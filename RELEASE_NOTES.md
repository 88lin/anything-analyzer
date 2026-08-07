# Anything Analyzer v3.6.60

## 修复

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
| Windows | Anything-Analyzer-Setup-3.6.60.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.60-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.60-x64.dmg |
| Linux | Anything-Analyzer-3.6.60.AppImage |
