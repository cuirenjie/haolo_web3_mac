# 开发版威科夫响应延迟排查

任务：M1-422。日期：2026-10-21，时间均为北京时间。

本次为客户端日志、原生会话回放、网关生产只读查询和源码隔离复现；没有修改产品逻辑、重启客户端、调整账号限制或部署服务。

## 结论

截图对应请求的长时间等待发生在根模型首段输出之前。上游 Codex 返回 `turn_rate_limit_exceeded`，消息为 `Codex is at capacity, please try again later`；客户端内核随后等待 198.9985948 秒重试。此次不是 Haolo 网关的用户限额或业务余额拦截，也没有进入威科夫引擎计算。

恢复后图表打开步骤又被原始会话校验拒绝，最终没有调用 `haolo_analysis`。界面把重试等待显示为“等待首个模型事件”，未解释真实原因。

## 真实时间线

| 时间 | 证据 |
| --- | --- |
| 13:49:59.159 | 用户发送策略请求，诊断 ID `H-20261021054959-D4439FA1` |
| 13:49:59.623 | 本地运行内核接受轮次，耗时 464ms |
| 13:49:59.833 | 首个 item 事件；这是运行事件，不等于模型已生成内容 |
| 13:50:00.086 | 网关记录上游账号 14 的 `turn_rate_limit_exceeded` / `rate_limit_err` |
| 13:50:00.087 | 上游未提供可解析的重置时间，网关对该账号采用默认 60 秒冷却 |
| 13:50:00.208 | 网关记录 `upstream_status=429`，连接第18次请求因 `later_turn` 不允许在网关内换账号重放 |
| 13:50:00.417 | 本地内核记录 `retrying sampling request (1/3 in 198.9985948s)` |
| 13:53:24.909 | 首段模型内容出现，距用户发送 205.750 秒 |
| 13:53:50.898 | 调用 `haolo_chart_open` |
| 13:53:51.082 | 返回 `Open the originating conversation before opening its analysis chart.` |
| 13:53:58.130 | 根轮次结束，累计238.969秒；业务结果是未执行分析，不是策略分析成功 |

## 限流来源与边界

生产请求 ID：`3fde511e-e2be-4d0d-92c5-48ff4805ea78`；运维错误记录 #55445。

- 数据库分类为 `error_phase=upstream`、`error_owner=provider`、`is_business_limited=false`。
- 实际网关日志明确记录上游错误码和 `upstream_status=429`，排除了仅凭客户端429推测来源的问题。
- 数据库 `status_code=101` 是 WebSocket 传输升级状态，不是模型成功。该行部分上游字段为空，来源应结合实际转发日志判断。
- 此次上游只披露轮次/容量限制，没有披露具体阈值；不能进一步宣称是固定RPM、并发20、周额度耗尽或上游全局故障。
- 网关的60秒账号冷却用于避免继续向已拒绝请求的账号派单；199秒是客户端内核本次记录的重试等待，不能称作网关设置了199秒，也不能从现存日志还原内核选择该时长的全部依据。
- 连接第18次请求携带 `previous_response_id`，网关 `CanFailoverOpenAIWSTurn` 仅对首请求且无既有响应/工具续接的安全情形允许重放。该次日志为 `eligible=false, reason=later_turn`，所以网关没有直接换账号重放旧连接请求。

## 客户端问题

1. `main.ts` 的 `error/willRetry` 仅更新全局 `statusMeta`；思考状态函数只检查本轮可见 item，因此会持续展示“等待模型响应”，没有单独展示限流/重试状态。
2. `openTradingExpertAnalysisChart` 通过发送时保存的 workspace 对象与当前 `activeWorkspace` 对象做严格比较。隔离执行实际函数证明：同一个会话、同一个市场，仅workspace重建也会返回“原始会话”错误。页面绑定函数确实存在销毁旧workspace并创建新对象的路径。

现有事件日志没有记录失败瞬间workspace身份，因此无法证明本轮具体是同会话重建、切换会话还是工作区不可用。这里只把真实失败与可复现的误判缺陷分别登记，不能归咎于用户切换了会话。

## 验证及后续修复范围

- `gateway-timeout-ui.test.mjs` 与 `trading-chart-navigation.test.mjs` 合计49项通过；不代表此故障已修复。
- 实际图表打开函数隔离回放：原对象成功；同会话重建被拒；其他会话被拒。结果见 `.cache/wyckoff-latency-M1-422/chart-guard-replay.json`。
- 客户端脱敏时间线见 `.cache/wyckoff-latency-M1-422/evidence.json`。
- 独立网关实际仓库为 `C:/Users/潘艳芳/Documents/ChatGPT/youle_llmhub`，由该仓库部署文档确认；生产只读查询及白名单日志见其 `output/wyckoff-latency-20261021/`。未查询或输出凭证、完整请求正文。
- 修复应分别处理重试状态可见性、同会话图表对象重建后的安全重绑定，以及内核/网关在续接失败时的恢复策略。不能为减少等待绕过上游限额或盲目重放工具续接。
