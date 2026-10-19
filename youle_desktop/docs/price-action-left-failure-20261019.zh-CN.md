# M1-383 裸 K 左侧分析失败排查

2026-10-19 22:46 后续更新：用户随后明确授权当前运行中的各种模型失败均可进入 DeepSeek，正常观望和权益拒绝除外；该决定替代下文排查阶段对未知结果的旧保护建议。M1-384 已随后端 `976e4e5c` 部署 API 与独立策略 Worker并通过线上验证，见[任务台账](trading-expert-realtime-ai-execution-plan.zh-CN.md)。下文保留原故障时刻的版本和证据，不代表当前运行状态。

2026-10-19，只读生产核查完成。截图 ETHUSDT 1h 的直接故障是模型网关没有可调度账号；新版 4h 左侧方案未部署是另一个已确认问题，不能把部署新版当成这次限流的修复。

## 原任务证据

- Windows 0.1.181 于北京时间 21:35:55 记录 `price-action / BINANCE:FUTURES:ETHUSDT / 60 / MODEL_OUTCOME_UNKNOWN`，已捕获 100 根 K 线。报告已经正常持久化，非历史正文隐藏或绘图失败。
- 云端原任务 `6c853073-76d1-4859-b3d0-b5512c2444fb` 于 21:35:51.392 创建，21:35:54.263 失败。合同 `windows-v1`，模型 `gpt-5.6-sol`，冻结偏好 revision 2、`requestedEntryMode=left`。
- 原任务只有第 0 次 private review，保留 `started` 状态，没有成功模型结果。Worker 记录关联 `mobile:<runId>` 的唯一 WebSocket 尝试耗时 401ms，`safeToRetry=False`，错误 `MODEL_OUTCOME_UNKNOWN`。
- 同时段网关来自业务机的 GPT-5.6-Sol 请求 `59d3a90c-923e-4e92-93e4-22dbab7c2409` 在 21:35:54.149 的账号选择阶段失败：`no available accounts`，未选定 account，随后关闭 WebSocket。日志里的 HTTP 101 表示协议升级，并不表示模型成功。
- 其前后可调度的账号 67 在 21:35:45、21:35:51 返回 `turn_rate_limit_exceeded / Codex is at capacity`，21:35:58 再次出现 429。检查时该分组四个账号只有 67 为 active 且 schedulable；其他账号为停调度或错误状态。之后同模型有成功记录，故不是永久不支持 GPT-5.6-Sol。
- 原任务 interaction ID 查询没有 usage 记录。本次未重新提交模型请求、激活计划或改变账号偏好。

## 为什么界面只显示“结果未知”

业务后端 `app/mobile/model_transport.py` 的 `websocket_response` 在发送请求后遇到 WebSocket 异常，将其保守转换成 `MODEL_OUTCOME_UNKNOWN`，没有向上保留“未选到账号”的明确原因；Windows 恢复逻辑因此禁止重复付费请求。客户端 `trading-analysis/failure.mjs` 将该错误码转为截图中的中文提示。防重复请求行为符合现有设计，但诊断文案丢失了网关的实际拒绝原因。

## 为什么没有自动切换 DeepSeek

后续提问已核对：本地 `model_recovery.py`／`model_transport.py` 与运行中的 Worker 提交 `202d4845` 无差异。`ModelRecovery.request` 对 Windows 合同的 `MODEL_OUTCOME_UNKNOWN` 在进入 `await self.failed(error)` 和 `self.model = RECOVERY_MODEL` 之前立即抛出。因此本次既没有切换 `deepseek-flash`，也没有因本次失败设置账户一小时降级窗口。显式选择模型只影响新任务是否沿用既有降级窗口，不是此处同一任务未切换的直接原因。

这是“网关明确未分配上游账号”没有被保留为可安全恢复错误的衔接缺口。传输层在发送后只看到 WebSocket 关闭，将其当成可能已经执行／计费的未知结果，恢复层按防重复请求规则停止。修复应由网关传递可验证的提交前拒绝状态，再受控触发 DeepSeek；不能根据任意断线或仅无用量记录就解除未知结果保护。本次只解释现有行为，未实施修复。

## 实际部署状态

| 组件 | 读取到的运行提交 | 新左侧模块 |
| --- | --- | --- |
| API | `23f06c8c5f9ebce62739562e54be253729b56ca3` | 无 `price_action_left.py` |
| 独立策略 Worker | `202d48455774b20f0234720f1babf1de6af9bb08` | 无左侧模块、双路线配置及相关启用环境变量 |
| 模型网关 | `d2b6d5ab0e4520555e8801ca1eb5d59297b79acd` | 独立服务，与策略代码发布分开 |

M1-381／M1-382 已完成的本地方案没有进入线上 API／Worker。旧版本本来就支持 entry-v2 左侧偏好，能进入模型决策，因此本次没有因缺少新版文件而报导入错误；它是在旧链路中遇到了模型容量问题。

## 验证与后续边界

数据库查询在只读事务中进行；核验三处运行版本、原任务状态、私有 review 状态、Worker 传输日志、网关账号选择及上游限流日志，并核对原任务用量记录。后端现有 `test_mobile_model_transport.py` 53 项全部通过，使用回环 WebSocket 和受控 HTTP，不调用收费模型。

本轮仅完成定位，未修改业务实现或线上配置、未部署或重启。后续修复应分别处理模型通道容量、保留明确的网关拒绝原因，以及 M1-382 的 API／Worker 协议配套发布；不能放开所有“结果未知”请求的自动重试，也不能直接重放原付费任务。无需为本次排查改动客户端画线或策略价位算法。
