# Anything Analyzer v3.6.55

## 优化

- **真实上下文用量来源** — 上下文占用优先读取最后一轮主分析或追问请求返回的真实 `prompt_tokens`，不再依赖输出文本长度推算。
- **旧报告兼容** — 缺少 AI 请求日志的历史报告会回退到报告输入 token，再回退到本地消息估算，保持旧数据可用。

## 修复

- **输出 Token 被计入上下文** — 修复流式 completion 内容推动“已使用上下文”持续增长的问题，`completion_tokens` 不再计入上下文窗口占用。
- **Tool Loop 累计值误差** — 上下文计数只取最后一轮 `analyze/chat` 的输入 token，不再使用多轮工具调用累计值。
- **辅助请求污染计数** — `filter`、`compress`、`subagent` 等辅助 LLM 请求不再覆盖主对话上下文用量。
- **会话恢复计数不一致** — 初次分析、追问完成及重新打开会话时统一刷新真实上下文用量。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.6.55.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.55-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.55-x64.dmg |
| Linux | Anything-Analyzer-3.6.55.AppImage |
