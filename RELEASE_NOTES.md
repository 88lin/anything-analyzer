# Anything Analyzer v3.6.58

## 新增

- **模型列表加载** — LLM 设置支持从 OpenAI、Anthropic、MiniMax 及兼容服务的 `/models` 接口加载可用模型，同时保留手动输入模型 ID。
- **AI Report 模型切换** — 报告工具栏新增分析模型下拉框，可选择模型后直接重新分析，无需修改全局默认配置。
- **报告模型连续性** — 使用指定模型生成报告后，后续追问会继续使用该报告对应的模型。

## 修复

- **重新分析显示旧内容** — 重新分析开始时清空旧报告、旧追问、上下文用量和流式状态，不再显示上一轮结果。
- **异步结果污染** — 会话加载或旧追问延迟返回时，不再覆盖正在进行的新分析状态。
- **模型接口错误安全** — 模型列表请求增加超时、响应校验和 API Key 脱敏，避免错误信息泄露凭据。

## 验证

- 新增重新分析状态、模型枚举和 Report 模型选择回归测试。
- 全量测试与 Electron 生产构建通过。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.6.58.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.58-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.58-x64.dmg |
| Linux | Anything-Analyzer-3.6.58.AppImage |
