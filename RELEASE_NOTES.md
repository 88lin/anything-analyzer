# Anything Analyzer v3.6.53

## 新增

- **索引优先 AI 上下文** — 初始分析仅发送请求类型、地址、时间等紧凑索引，模型可通过 `list_requests`、`search_requests`、`get_request_detail` 按需获取正文。
- **可配置上下文预算** — 默认最大上下文 200k、压缩峰值 85%，支持规则压缩与 LLM 混合摘要，压缩结果强制收敛到目标 token 预算。
- **并行子分析器** — 大型请求会话可分块并行提取导航线索，主模型继续使用请求工具验证真实详情。
- **MCP Server 自定义监听 IP** — 支持 IPv4/IPv6 地址，修改监听 IP、端口或鉴权配置后自动重启服务。

## 优化

- **大列表渲染性能** — 请求表改为可见区虚拟化、滚动帧合并和增量索引，降低持续抓包时的渲染阻塞。
- **Token 校准与可观测性** — 校准数据按 provider/model/API 类型隔离并原子持久化；分析、压缩和子分析请求按真实日志 ID 回填 usage。
- **上下文用量展示** — 报告页与状态栏展示当前 token 使用量、峰值和最大上下文配置。

## 修复

- **上下文压缩可靠性** — 修复混合摘要读取已截断历史、错误响应被当成摘要以及压缩后仍可能超预算的问题。
- **Tool Loop 校准污染** — 多轮工具调用的累计 usage 不再用于单轮 prompt 估算校准。
- **更新动态图标溢出** — 将旋转动画限制在 SVG 视口和按钮图标容器内，避免超出父元素边界。

## 下载

| 平台 | 文件 |
|------|------|
| Windows | Anything-Analyzer-Setup-3.6.53.exe |
| macOS (Apple Silicon) | Anything-Analyzer-3.6.53-arm64.dmg |
| macOS (Intel) | Anything-Analyzer-3.6.53-x64.dmg |
| Linux | Anything-Analyzer-3.6.53.AppImage |
