# Anything Analyzer v3.6.59

## 改进

- **上下文用量文案** — 将“下次请求上下文”等模糊表述统一为“上下文用量”和“追问上下文”，并同步优化中英文界面。
- **容量口径统一** — 用量、进度条和状态栏统一按扣除预留输出后的可用容量计算，避免分母与剩余数量不一致。
- **预算说明** — 悬停时展示模型上限、预留输出和当前可用数量，并明确标注达到 85% 后自动压缩。

## 修复

- **压缩阈值位置** — 自动压缩标记现在按实际可用容量定位，与显示百分比和告警状态保持一致。

## 验证

- 新增上下文用量展示回归测试。
- 全量测试通过：179 passed，4 skipped。
- Electron 生产构建通过。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.6.59.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.59-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.59-x64.dmg |
| Linux | Anything-Analyzer-3.6.59.AppImage |
