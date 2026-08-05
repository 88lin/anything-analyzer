# Anything Analyzer v3.6.56

## 修复

- **Anthropic 上下文计数缺失** — `prompt_tokens` 现在包含普通输入、缓存创建输入和缓存命中输入，不再只显示未缓存部分。
- **历史日志统计错误** — 启动时自动、幂等地回填已有 Anthropic 请求日志中的缓存输入 token。
- **失败分析污染当前报告** — 上下文用量限定到当前报告及其追问，后续失败分析的中间成功轮次不再覆盖现有报告统计。
- **可用量语义错误** — 上下文面板改为展示扣除当前占用后的真实剩余 token，而非固定可用上限。
- **低占用显示为 0%** — 百分比保留小数或显示 `<0.1%`，主面板与底部状态栏使用统一口径。

## 优化

- **压缩峰值标记** — 峰值位置按可用上下文计算，与实际压缩触发阈值保持一致。
- **Token 统计回归覆盖** — 新增 Anthropic 非流式、流式、Tool Loop、历史回填和当前报告作用域测试。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.6.56.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.56-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.56-x64.dmg |
| Linux | Anything-Analyzer-3.6.56.AppImage |
