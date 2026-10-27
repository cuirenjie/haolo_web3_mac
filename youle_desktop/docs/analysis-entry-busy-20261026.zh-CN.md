# M1-466 分析入口繁忙修复

2026-10-26：本地修复与验证完成。用户明确选择“先保留本地修复，不部署”，本次不提交、推送、部署或重启开发版；线上尚未生效。

本次截图对应 13:55:17 的 `GET /api/mobile/v1/trading-preferences` 429/MOBILE_BUSY。主进程诊断 `H-20261026055517-C64C7E8C` 与线上时间相符，失败发生在云端分析创建之前。后端后台轮询与分析前置请求共用 128 名额，原有恢复仅保护行情和已有任务，导致偏好读取一次繁忙就结束分析。

服务端将同一短请求预算划分为后台 96、分析入口 32，并隔离同步 SSE；Windows 在偏好、能力、账户绑定及提交的明确准入拒绝上等待继续，每阶段最多 120 秒，尊重服务端等待下限、每秒检查停止和账号。已准备的提交保持同一任务正文、ID 与幂等键；未知网络提交、积分或权限错误不自动重放。五语等待提示使用已有组件，诊断补充失败操作名。

验证：Windows 215 项相关回归全部通过，真实本地 HTTP SDK 的拒绝恢复保持正文和幂等头一致，仅受理一次；TypeScript、Vite 隔离构建、差异检查及客服候选生成通过。后端 19 项通过，修复前实际模块在同一 128 后台请求场景下返回 429，修复后返回 200。测试使用合成分析结果，没有生产付费模型调用。

详细证据、边界和发布计划见规范后端 [根因报告](../../../haolo_front_web3/youle_mas-dev/backend/docs/analysis-entry-busy-20261026.md)。本次相关日志保存在 `youle_desktop/output/analysis-admission-*.log`。共享工作区的其他任务修改保留；当前未提交、推送、部署、发布安装包或重启用户窗口。

## 第二轮深度复查（2026-10-26，本地完成）

范围为截图对应的 Windows 客户端全部策略分析提交路径及共享业务 API；不把本轮结果表述为移动客户端或生产端到端验收。

| 入口 | 实际调用链与覆盖 |
| --- | --- |
| 17 个官方策略、左／右侧、聊天策略引用、图表入口、纯分析与绘图／计划请求 | preload → tradingStrategy:run → runTradingStrategyRequest → cloud runtime；对目录中每个策略、每个侧别执行一次 MOBILE_BUSY 后继续，验证冻结正文、ID、幂等键及侧别不变 |
| 缠论／订单流／波浪／威科夫旧 IPC 别名 | 提取并执行真实 IPC 回调，确认均汇入公共策略入口 |
| 通用分析、持仓问题 | tradingAnalysis:runGeneral → 同一 cloud runtime；补齐偏好读取的 signal 和进度回调，真实 host 回调测试证明停止后不提交 |
| 多图、多周期 | 主图与各 pane 共用策略／通用入口；子图使用稳定的 job:pane:index ID；保留原有失败停止、部分结果与停止全部子任务测试 |
| 自动化与业务工具 | executeTradingAutomationAnalysis → 同一 runtime；补齐准备阶段停止与进度；真实工具代理测试验证丢失付费提交回执后禁止另起分析，显式恢复仍取回原 run |
| 断线／重启后的待确认任务 | 原 journal → resume → 查询原 run，必要时同键同正文提交；修复 1500ms 恢复预算被 120s 准入等待覆盖的问题 |
| 云端任务追问 | cloud-task-chat → task GET／assistant-runs POST；补齐历史查询保护、同键繁忙恢复、指数快照 purpose=analysis、发送期间停止、账号围栏和迟到 UI 回执保护 |
| 自定义个人策略 | runPersonalStrategyRequest 本地确定性计算，不调用上述付费分析 POST；未引入模型重试 |

官方目录：price-action、moving-average-analysis、wave、macd-analysis、rsi-analysis、kdj-analysis、bollinger-bands-analysis、chart-patterns、harmonic、dow-theory、gann-theory、chan、vpvr-analysis、wyckoff、order-flow、ict-smc、smt-divergence。

新增防重复计费边界：

- 已落盘任务即使抛出 SDK 的 retryable 网络错误或 CLOUD_RUN_PENDING，也禁止工具层自动新建 analysisJobId；保留 runId，显式恢复只操作原记录。原有忙碌等待仍在 runtime 内继续，不会因此提前失败。
- 显式取消会中断仍在运行的准入等待，同时使用原 runId 的后端取消围栏；取消与提交回执竞争时不能恢复已停止的任务。
- 追问发送中停止会等待当前 POST 确认，再取消原 run；未知回执保留为待确认，不宣称已取消。当前重试收到明确拒绝，也不能据此抹除之前可能已受理的请求，或解锁一个新的付费轮次。
- 未放宽行情有效期、权限、积分及模型响应不确定性校验。等待导致行情过期时仍拒绝；不会为了成功而修改已落盘正文或换 ID 再分析。独立的新用户请求及不同图表本来就是独立分析，不属于同一请求的幂等去重。

最终验证：Windows **279/279**，包括真实 host 回调、工具代理、HTTP SDK、全部 17×2 策略／侧别及取消竞态；TypeScript、Vite 隔离构建通过。后端 **144 项通过**，包含隔离 PostgreSQL 并发 20 次相同策略提交／20 次相同追问提交，均只创建一个 run、一个 job、一个幂等记录；回执丢失重试、取消后重放和取消早于提交均不重新入队；消费记录重复终态更新保持单条用量。上游传输的未知受理／部分输出／扣费未确认不重放测试也通过。

扩展旧助手套件另有 **5 项既存失败**：4 项仍预期旧 GPT 图片／兜底链路，1 项仍预期已受限的助手策略工具。以 HEAD 的修复前准入模块在内存中复跑，5 项同样失败；没有删测、修改期望或将它们计为通过。记录见后端 `.incident/analysis-audit-backend.log`、`analysis-audit-baseline-legacy.log`；本轮新增准入／幂等用例通过。测试行情、模型、用量均为隔离夹具，没有真实付费调用。

最终日志：`output/analysis-audit-regression.log`、`analysis-audit-typecheck.log`、`analysis-audit-build.log`；后端 `.incident/analysis-audit-idempotency.log`、`analysis-audit-backend.log`、`analysis-audit-consumption.log`。客服五语候选补全来源路径；其他会话的偏好保存、界面等修改保留，不混作本任务交付。仍不提交、推送、部署、发布安装包或重启窗口。

## 第三轮：旧测试失败已解决

用户追加要求解决上述5项旧测试失败。已修复过时的 GPT 兜底／high、助手直接完成联合指标分析等测试契约，保留真实 API、PostgreSQL、Gateway 和 Node 引擎。附件流程扩展为图片证据、三语成功／503／未知回执，核对低推理档位、独立计费归属、工具仅执行一次、失败不重发、不入队和私有推理不泄露；RSI 助手工具明确需要专用工作区且不产生计划／绘图。

补充对齐专用指标测试的指令编译、方案搜索、候选对象识别、auto 退役和不可执行参考卡片协议。原5项对应扩展11项通过，全助手及相关回归170项通过；六指标左右侧正常／等待与auto拒绝25项通过，合计 **195/195、零失败、零跳过**，Ruff及差异检查通过。没有改生产业务逻辑或降低门槛；本轮仅两份后端集成测试与文档。完整记录见规范后端根因报告第三轮，日志为后端 `.incident/analysis-legacy-repair-*.log`。历史5项失败记录已关闭，仍不提交、推送、部署或重启客户端。
