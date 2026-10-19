# 客户端策略生产复验（M1-360，2026-10-18）

本轮使用固定 Windows 仓库的真实 YouleApiClient、cloud-runtime 和当前已登录 Haolo 账号，经生产 HTTPS、实时行情及独立策略 Worker 新建 17 个分析任务。市场为 BTCUSDT 永续 1 小时，覆盖简中、英文和繁中。没有 mock 模型、改写行情或复用旧任务结果。窗口自动化因捕获/激活错误及输入冲突未能完成提交，不能将本次 SDK 真实调用描述为逐项 GUI 点击验收。

结果：17 个新任务全部成功，7 个右侧条件计划、10 个无合格候选等待。账号完整偏好在开始、首轮完成、补跑完成时严格深比较一致；服务端只读事务再次核对仍为 auto、revision 1，完整配置 SHA-256 为 d14d2eb32384a67495671911bb979cba1c3b20e358c9081f858b90b05c0bade3。

| 策略 | 请求语言 | 结果 | 依据 |
|---|---|---|---|
| 裸 K | zh-CN | 右侧条件计划 | Inside Bar 突破兜底 |
| 均线 | en | 右侧条件计划 | 保留合格原生条件兜底 |
| MACD | zh-Hant | 等待 | NO_QUALIFIED_CANDIDATE |
| 道氏理论 | zh-CN | 等待 | NO_QUALIFIED_CANDIDATE |
| 布林带 | en | 右侧条件计划 | 保留合格原生条件兜底 |
| RSI | zh-Hant | 等待 | NO_QUALIFIED_CANDIDATE |
| KDJ | zh-CN | 右侧条件计划 | 保留合格原生条件兜底 |
| 图表形态 | en | 右侧条件计划 | 模型等待后保留合格原生计划 |
| 缠论 | zh-Hant | 等待 | NO_QUALIFIED_CANDIDATE |
| 波浪 | zh-CN | 等待 | NO_QUALIFIED_CANDIDATE |
| 威科夫 | en | 右侧条件计划 | 模型等待后保留合格原生计划 |
| 谐波 | zh-Hant | 等待 | NO_QUALIFIED_CANDIDATE |
| ICT / SMC | zh-CN | 等待 | NO_QUALIFIED_CANDIDATE |
| SMT 背离 | en | 等待 | NO_QUALIFIED_CANDIDATE |
| 订单流 | zh-Hant | 等待 | NO_QUALIFIED_CANDIDATE |
| 江恩 | zh-CN | 右侧条件计划 | 保留合格原生条件兜底 |
| VPVR | en | 等待 | NO_QUALIFIED_CANDIDATE |

## 兜底与边界核对

- 裸 K 的原结果为 NO_QUALIFIED_CANDIDATE，最终 RIGHT_CONDITIONAL_FALLBACK，scenarioKind=inside_bar_breakout。真实任务 11af98c8-1f0c-43c8-8a5e-3b74f12868dc。
- 图表形态及威科夫本次原结果为 MODEL_WAIT，保留已通过原策略和风险检查的右侧条件，均有明确 fallback 元数据。
- 7 个计划均通过当前客户端结果契约、服务端计划回读和确认摘要比对；17 个任务的 resume 返回同一结果。只读数据库核对 17 份实际冻结行情和偏好，检查止损/目标方向、有效期及未来条件。图表形态为已确认突破后的等待回踩，独立核对突破原 K 线、前收盘和后续无结构失效；其余 6 个为等待收盘突破。
- 10 个等待样本的 capability=supported、evaluationStatus=completed、reason=NO_QUALIFIED_CANDIDATE。不是传输失败冒充的等待。本轮不保证其他行情下必然相同，也不将缺少条件的策略强行生成计划。
- 所有计划仍为 draft，linkedAlertId 为空；没有激活提醒、下单或修改偏好。计划列表预览使用本地格式化构造器，未将草稿塞入仅接受已激活计划的同步接口。

## 展示与异常记录

7 份真实返回计划通过当前客户端聊天、计划列表格式及便利贴渲染：亮暗两主题，共 14 组、42 个展示面全部通过，无横向溢出。裸 K 亮暗截图已人工查看。此为隔离 Electron 展示验收，不等于在当前主窗口逐一完成操作。

首轮有 5 次 MARKET_UNAVAILABLE / HTTP 503，均发生在行情读取阶段，尚未创建 run ID。对应布林带、RSI、KDJ、波浪、威科夫；服务端日志确认共享行情预算 BudgetDeferred。冷却后各补跑一次全部成功，未重复提交已入队任务。保留原失败回执；本次不能称全链路零瞬时错误。没有改变限流设置或部署服务。

核查脚本首次暴露两项测试假设问题：把突破回踩也当作直接突破进行价位断言；把未激活草稿传入已激活计划列表的合并器。按实际协议修正验收脚本后通过，未改生产逻辑或返回数据，原记录在 verification-initial-errors.json。

## 证据

- [统一回执](../output/client-strategy-recheck-20261018/verification.json)
- [首轮回执](../output/client-strategy-recheck-20261018/live-deployed-sdk-receipt.json)、[补跑回执](../output/client-strategy-recheck-20261018/recovery-receipt.json)
- [42 个展示面](../output/client-strategy-recheck-20261018/rendered/report.json)
- [裸 K 亮色](../output/client-strategy-recheck-20261018/rendered/price-action-light.png)、[暗色](../output/client-strategy-recheck-20261018/rendered/price-action-dark.png)
- 服务端只读验收及行情日志：haolo_front_web3/output/client-strategy-recheck-20261018/。

客户端 HEAD 792500525716764e6d3f58d92eb6436714623b42；当前卡片展示代码另有其他会话的未提交改动，本轮完整保留，渲染代码摘要在 rendered/client-contract-checks.json。API / Worker 源码 cdc7e34e33471265b9a7d37610ef609e913c242e。本轮只添加复验脚本与记录，无业务代码修改、Git 提交、发布或服务重启。
