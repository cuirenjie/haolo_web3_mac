# Haolo 智能交易预警开发进度台账

> 文档状态：持续更新  
> 创建日期：2026-08-12  
> 最近更新：2026-08-12  
> 当前里程碑：TA-M9 安全、长稳、实机、灰度与发布门禁  
> 当前结论：TA-M1～TA-M4、TA-M6～TA-M8 已完成；TA-M5 正在执行真实 24h 长稳；TA-M9 等待长稳、真实灰度与发布授权  
> 技术规格：[trading-alert-agent-technical-spec.zh-CN.md](./trading-alert-agent-technical-spec.zh-CN.md)  
> 安全与性能报告：[trading-alert-agent-security-performance-report.zh-CN.md](./trading-alert-agent-security-performance-report.zh-CN.md)  
> 灰度与发布手册：[trading-alert-agent-release-runbook.zh-CN.md](./trading-alert-agent-release-runbook.zh-CN.md)  
> 上位交易架构：[trading-expert-realtime-ai-execution-plan.zh-CN.md](./trading-expert-realtime-ai-execution-plan.zh-CN.md)

## 1. 台账使用规则

本文件是智能交易预警功能唯一的实施进度台账。后续每次开发、审查、测试和发布都遵守以下流程：

1. 开始工作前完整阅读技术规格和本台账。
2. 只使用本文的稳定任务编号，不用临时口头描述代替状态。
3. 开始一个任务时，先把该任务改为 `进行中`，并更新第 3 节“当前工作焦点”。
4. 只有实现、必要测试和验收证据全部完成后，才能改为 `已完成`。
5. 只有外部条件确实阻止继续推进时才标记 `受阻`，并填写事实、已经尝试的路径和解除条件。
6. 缺数据或工具时先执行技术规格第 14 节的依赖补齐流程；不能因当前无接口直接取消任务。
7. 每个工作回合结束前，在第 16 节追加进度日志。日志只追加，不覆盖历史。
8. 架构或产品语义变化先在技术规格第 22 节追加 ADR，再调整任务。
9. 不记录虚构百分比。进度只以通过验收的任务和里程碑表示。
10. UI 任务必须同时完成亮色、暗色和全部交互状态；只完成一种主题不能标记完成。

状态枚举：`未开始 | 进行中 | 受阻 | 已完成 | 已取消`。

## 2. 总体里程碑

| 里程碑 | 目标 | 状态 | 退出条件 |
|---|---|---|---|
| TA-M0 | 需求、架构、任务与验收基线 | 已完成 | 两份文档互链，已确认需求全部进入规格，稳定任务编号可执行 |
| TA-M1 | 协议、Schema、Store 与功能开关 | 已完成 | 规则/状态/证据可持久化，非法输入失败关闭，关闭开关不改变旧行为 |
| TA-M2 | 自然语言编译、追问、确认与依赖解决 | 已完成 | 模型只输出受控草稿，歧义持续追问，缺数据可接入后续接 |
| TA-M3 | 确定性指标、规则与时间状态机 | 已完成 | 公式、组合、边沿、多周期和画线由黄金向量稳定复算 |
| TA-M4 | 模拟规划、同源验证与画布确认 | 已完成 | 合成 OHLCV 合法且必然触发，模拟图层不污染真实行情 |
| TA-M5 | Data Hub、订阅规划与实时 Alert Engine | 进行中 | Renderer 不可见时仍监控；行情共享、低延迟、幂等 |
| TA-M6 | 预警卡片、编辑器、主题与可访问性 | 已完成 | 卡片完整配置/状态可用，亮暗主题全部通过 |
| TA-M7 | 生命周期、空档、证据、通知与深链 | 已完成 | 不补触发、空档可见、触发有证据且通知只出现一次 |
| TA-M8 | 外部数据与工具接入扩展 | 已完成 | 缺能力可完成诊断、授权、验证、Adapter 接入和草稿续接 |
| TA-M9 | 安全、性能、长稳、灰度与发布 | 进行中 | 全量门禁、实机验收、灰度和发布审批全部通过 |

## 3. 当前工作焦点

- 当前任务：TA-M5-009、TA-M9-003 的真实 24h 长稳继续独立运行，TA-M9-007/008 仍保持外部灰度/发布门禁。
- 最近完成：TA-M4-011 已把 VOLUME 与“前 N 根”等时间窗口纳入模型 DSL、确定性求值、模拟搜索和副图投影，能严格模拟并标注量能触发；TA-M2-010 的模型优先意图链路继续保持不变。
- 下一任务：等待已启动的真实 24h Hyperliquid/100 预警长稳达到墙钟退出条件；之后进入经授权的小范围灰度。
- 当前阻塞：此前两轮长稳分别因后台进程退出和 Windows 系统重启中断，证据均已归档且不计入验收；当前完整重跑于 2026-08-12 16:15:13（Asia/Shanghai）启动，必须等到 2026-08-13 16:15:13 后且 `alerts:soak:assess` 通过才能形成真实结论；灰度需要测试用户范围与授权；发布需要明确审批。
- 持续验收：绑定当前开发会话的自动化 ID 24 会检查计划任务、启动器、checkpoint、最终报告和进程状态，并强制执行机器验收；若压测失败则保留中断证据、修复并重新启动完整 24h，若只剩灰度/发布授权则停止自动修改并等待用户输入。
- 已知工作区状态：存在其他用户改动；后续实现必须小切片工作，不覆盖无关文件。
- 发布状态：开发构建已通过；功能仍默认关闭，未提升版本、未生成发布安装包、未上传、未灰度或公开发布。

## 4. TA-M0：需求、架构与执行基线

| ID | 任务 | 状态 | 依赖 | 完成证据 |
|---|---|---|---|---|
| TA-M0-001 | 盘点现有行情、指标、绘图、自动任务、通知和侧栏入口 | 已完成 | 无 | 技术规格第 9、10、20 节记录现状与迁移边界 |
| TA-M0-002 | 冻结用户已确认的产品默认值、组合能力和停机语义 | 已完成 | TA-M0-001 | 技术规格第 2、4、10 节 |
| TA-M0-003 | 编写完整可执行技术规格 | 已完成 | TA-M0-002 | `docs/trading-alert-agent-technical-spec.zh-CN.md` |
| TA-M0-004 | 建立稳定里程碑、任务编号和持续进度台账 | 已完成 | TA-M0-003 | 本文 |
| TA-M0-005 | 固化测试矩阵、发布定义和首批 ADR | 已完成 | TA-M0-003 | 技术规格第 19、21、22 节 |

TA-M0 退出说明：只代表设计和执行基线完成，不代表任何预警功能已经实现。

## 5. TA-M1：协议、Schema、Store 与功能开关

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M1-001 | 固化 Alert DSL、AlertDraft、AlertRule 的 TypeScript/JSON Schema | 已完成 | TA-M0 | `protocol.mjs`、`protocol.d.ts`、`schema.mjs`；合法/非法契约测试通过 |
| TA-M1-002 | 固化 EvaluationPolicy、TriggerPolicy、MarketContext 和 DataRequirement | 已完成 | TA-M1-001 | 默认确认模式、一次/重复策略、市场上下文、数据要求均有严格归一化和错误用例 |
| TA-M1-003 | 实现规则归一化、稳定哈希和 revision 语义 | 已完成 | TA-M1-001 | SHA-256 语义哈希稳定；修改后 revision/hash 契约测试通过 |
| TA-M1-004 | 实现独立 TradingAlertStore | 已完成 | TA-M1-001,TA-M1-002 | 草稿、实例、状态、空档、证据、幂等键和事件采用锁+临时文件原子持久化 |
| TA-M1-005 | 实现旧版本迁移、损坏数据隔离和恢复 | 已完成 | TA-M1-004 | 兼容缺省旧字段；未来版本失败关闭；损坏 JSON 隔离为 `.corrupt-*` 并恢复空库 |
| TA-M1-006 | 增加 Feature Flag、统一错误分类和审计字段 | 已完成 | TA-M1-001 | `HAOLO_TRADING_ALERTS_ENABLED` 默认关闭；统一错误信封和 trace/audit 字段 |
| TA-M1-007 | 建立测试 Fixture 目录与协议测试基线 | 已完成 | TA-M1-001 | `test/fixtures/trading-alerts` 与 `trading-alert-protocol.test.mjs`，10/10 通过 |

TA-M1 退出条件：规则、状态和证据协议可独立测试与持久化；任何未知字段、非法数值、越界 AST、旧版本或恶意数据都失败关闭。

## 6. TA-M2：自然语言、追问、确认与依赖解决

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M2-001 | 实现模型中立 Alert Intent Provider | 已完成 | TA-M1-001 | `intent-provider.mjs` 固定 JSON；模型能力显式为无工具、无 DOM、无创建权限 |
| TA-M2-002 | 实现 AlertDraft Validator 和歧义检测 | 已完成 | TA-M1-002,TA-M2-001 | `intent-workflow.mjs` 定位市场、周期、同时/先后语义、画线和主观阈值缺口 |
| TA-M2-003 | 实现持续澄清状态机与最小追问生成 | 已完成 | TA-M2-002 | awaiting 状态持久化；Renderer 会话按 draftId 续接，信息不足不进入模拟 |
| TA-M2-004 | 实现人类可读规则摘要和确认绑定 | 已完成 | TA-M1-003,TA-M2-003 | `draftId + ruleHash + simulationId + TTL` 绑定；revision/重算后旧确认失败关闭 |
| TA-M2-005 | 实现 Capability Registry 与 DataRequirement 生成 | 已完成 | TA-M1-002 | `capabilities.mjs` 从叶子表达式生成字段、频率、历史和权限要求 |
| TA-M2-006 | 实现依赖解决器和候选 Provider 排序 | 已完成 | TA-M2-005 | 按兼容性、连接状态、优先级和延迟解析 Provider，并区分 missing/awaiting/available |
| TA-M2-007 | 实现安全接入引导与依赖验证协议 | 已完成 | TA-M2-006 | 明确只读安全设置入口，不在聊天收 Key；缺能力返回 Adapter/API/Plugin/MCP/文件接入路径 |
| TA-M2-008 | 实现 awaiting_* 草稿持久化与依赖补齐后续接 | 已完成 | TA-M1-004,TA-M2-007 | Store 持久化草稿，`resumeDraftAfterCapabilities` 从原 draftId 续接 |
| TA-M2-009 | 完成意图、Prompt 注入、歧义和接入流程测试 | 已完成 | TA-M2-001..008 | `trading-alert-intent.test.mjs` 覆盖完整 DSL、响应兼容、模型优先画线、多画线追问、requestId、复杂 AND、注入/脱敏、缺数据和续接 |
| TA-M2-010 | 全量意图模型优先、精确协议返修与可续接降级 | 已完成 | TA-M2-001..009 | 所有画线/指标/复合条件先调用意图模型；本地层只校验和执行；三次精确协议返修后由模型生成最小澄清，最终异常和 Provider 故障均保留无规则可续接草稿；23/23 意图专项和三类真实模型 E2E 通过 |

TA-M2 退出条件：大模型只能编译和解释；不清楚就追问，缺数据就推动接入，只有无歧义且能力验证通过的规则才能进入模拟。

## 7. TA-M3：确定性指标、规则与时间状态机

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M3-001 | 抽取共享 Indicator Registry 并保持现有图表数值一致 | 已完成 | TA-M1-001 | `indicator-registry.mjs` 覆盖 SMA/EMA/MACD/RSI/KDJ/ATR/CCI/ADX/BOLL/MOM/ROC；Renderer 黄金向量一致 |
| TA-M3-002 | 实现 ValueExpr 和安全 math AST | 已完成 | TA-M3-001 | `evaluator.mjs` 仅接受协议白名单表达式，有限数值与除零传播 unknown |
| TA-M3-003 | 实现比较、范围、触碰、突破和交叉操作符 | 已完成 | TA-M3-002 | 比较、touch、break、cross 严格边沿与 tolerance 由专项测试覆盖 |
| TA-M3-004 | 实现 AND/OR/NOT 与 unknown 三值逻辑 | 已完成 | TA-M3-003 | AND/OR/NOT 的 fail-closed 三值传播测试通过 |
| TA-M3-005 | 实现 sequence/within/sustain/count 有状态节点 | 已完成 | TA-M3-004 | 状态节点具备窗口、重置、事件幂等和 export/import 持久化测试 |
| TA-M3-006 | 实现盘中/收盘、同 closeTime、latest closed 多周期时钟 | 已完成 | TA-M3-004 | 条件级 intrabar/bar_close 与 closeTime join 门控已实现并测试 |
| TA-M3-007 | 实现多市场 Join 和数据新鲜度门控 | 已完成 | TA-M3-006 | 多 context 的 stale/partial/unavailable 一律 unknown、不触发 |
| TA-M3-008 | 实现画线快照、直线求值、容差和 geometry domain | 已完成 | TA-M3-003 | `drawing-geometry.mjs` 覆盖 segment/ray/extended 精确求值和域外 unknown |
| TA-M3-009 | 建立 Evaluator 回放工具与确定性 inputHash | 已完成 | TA-M3-004..008 | 相同事件回放结果、trace 与 inputHash 稳定；`trading-alert-evaluator.test.mjs` 7/7 |

TA-M3 退出条件：所有首发规则只依赖确定性求值；显示舍入、模型叙述、图表可见性和主题均不能改变触发结果。

## 8. TA-M4：模拟规划、同源验证与画布确认

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M4-001 | 实现规则树到数值/离散约束的反推 | 已完成 | TA-M3 | `simulation-planner.mjs` 从目标常数、画线与 Evaluator trace 反推候选路径 |
| TA-M4-002 | 实现 OHLCV 合法性、精度和合理性约束 | 已完成 | TA-M4-001 | 每根合成 candle 从上一根收盘连续开盘；基于历史 ATR、实体、成交量和 tick size 约束实体/影线/量能，并校验正价格、连续未来时间和非负成交量 |
| TA-M4-003 | 实现启发式 + beam/backtracking 有界求解 | 已完成 | TA-M4-002 | 常见趋势/反转/目标跟随种子与有界 beam 组合；默认至少 3 根未来 K 后标注触发、至少展示 6 根，预算耗尽失败关闭 |
| TA-M4-004 | 用生产 Evaluator 回放并验证 SimulationScenario | 已完成 | TA-M3-009,TA-M4-003 | 模拟与 Engine 共用 `TradingAlertEvaluator`，proof/ruleHash/inputHash 可复验 |
| TA-M4-005 | 实现无解/冲突/外部字段诊断 | 已完成 | TA-M4-004 | 无法控制的 external 条件返回 `SIMULATION_NO_VALID_PATH`，会话引导补充口径而非伪图 |
| TA-M4-006 | 实现 Alert Simulation Gateway 和独立画布图层 | 已完成 | TA-M4-004 | 独立 CandlestickSeries、模拟水印和小型未来标签；完整未来时间点先预留，不写入 `this.candles` 或真实行情流 |
| TA-M4-007 | 实现逐根 K 线、子条件和最终触发标注 | 已完成 | TA-M4-006 | 按真实周期逐根填充预留时间轴，触发箭头绑定 `triggerBarIndex`；视窗聚焦近期真实行情+完整未来区间，不再以贯穿竖线或 `fitContent` 压缩显示；亮暗 token 与 reduced-motion 完整 |
| TA-M4-008 | 实现对话确认/修改/取消闭环 | 已完成 | TA-M2-004,TA-M4-007 | `@预警` 独立路由；确认前仅草稿，修改重算，取消持久化，绑定失效测试通过 |
| TA-M4-009 | 完成典型复杂组合模拟 E2E | 已完成 | TA-M4-008 | `trading-alert-simulation.test.mjs` 8/8 覆盖 MA+MACD、画线、sequence、多周期/多 context、无解，以及未来时间、开收盘连续、单根最大波动和至少 6 根展示约束 |
| TA-M4-010 | 指标型模拟自动配置并投影主图/副图未来走势 | 已完成 | TA-M3-001,TA-M4-009 | 从已验证规则 AST 提取指标族与精确参数；MA/SMA、EMA、BOLL 绘制主图，MACD、RSI、KDJ、ATR、CCI、ADX、MOM、ROC 绘制独立副图；真实历史与未来 OHLCV 连续复算，指标与 K 线逐根同步，触发标记绑定 `triggerBarIndex`；切市场/周期、重建副图、退出模拟、持久恢复与亮暗主题生命周期完整；指标/模拟专项 57/57、全量 1965/1966 后唯一无关 Feishu 临时目录竞态单测复跑 1/1、TypeScript 与 Vite production build 通过 |
| TA-M4-011 | VOLUME 时间窗口规则、量能模拟与触发标注 | 已完成 | TA-M2-010,TA-M3-002,TA-M4-010 | DSL 新增受限 `lag` 与 `rolling(min/max/avg/sum)` 值表达式；模型按明确口径把“当前量能大于前 3 根每根的 3 倍”编译为 `volume > 3 × rolling(max, volume, 3, offset=1)`；Capability 推导精确历史深度，Evaluator 逐柱计算，Planner 把成交量作为独立搜索维度并在 verify 时重放 OHLCV；Renderer 自动创建 VOLUME 柱体/量均线副图并在 proof 的 `triggerBarIndex` 标注；专项 69/69 通过 |

TA-M4 退出条件：用户看到的模拟场景与即将创建的实际规则完全同源，模拟数据无法进入真实行情、持久指标、手工撤销栈或真实触发流。

## 9. TA-M5：Data Hub、订阅规划与实时 Alert Engine

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M5-001 | 建立当前 Renderer 行情的临时只读桥 | 已完成 | TA-M1,TA-M3 | 纵向切片完成后按 TA-M5-008 删除；最终不存在 Renderer→Engine 行情写桥 |
| TA-M5-002 | 实现主进程 Trading Market Data Hub | 已完成 | TA-M3 | `market-data-hub.mjs`：Adapter、REST 历史缓存、共享 WebSocket、健康和指标 |
| TA-M5-003 | 实现去重、乱序、迟到、重连和自定义周期聚合 | 已完成 | TA-M5-002 | 唯一 close、重复/迟到/缺口 fail-closed、自定义周期聚合及重连测试通过 |
| TA-M5-004 | 实现 Subscription Planner 和共享增量特征状态 | 已完成 | TA-M5-002,TA-M3-001 | 相同 Provider/市场/周期共享一个物理订阅与历史请求；资源估算在编辑器展示 |
| TA-M5-005 | 实现 TradingAlertEngine 与受影响规则索引 | 已完成 | TA-M1-004,TA-M3-009,TA-M5-004 | `engine.mjs` 在主进程独立运行；无模型/DOM/截图热路径，页面销毁不停止 Engine |
| TA-M5-006 | 实现触发幂等、冷却、计数和原子状态转换 | 已完成 | TA-M5-005 | event/evidence 幂等、once/repeat、三种 rearm、冷却、每日/总次数限制测试通过 |
| TA-M5-007 | 把图表迁移为 Data Hub 只读订阅者 | 已完成 | TA-M5-003,TA-M5-005 | K 线由主进程 Data Hub 推送；Renderer 自有连接仅保留展示用 ticker/mark，不再作为预警事实源 |
| TA-M5-008 | 删除临时桥和长期双数据源 | 已完成 | TA-M5-007 | Renderer ingest IPC/preload/type 已删除；Engine 只接收 Data Hub 行情 |
| TA-M5-009 | 完成 100 卡片、事件洪峰和 24h 长稳基准 | 进行中 | TA-M5-006 | 100 卡片共享 1 订阅、P95 7.49ms、20,000 洪峰求值、堆增 1.76MiB、重复触发 0；真实墙钟 24h 运行中，结束后由 `alerts:soak:assess` 严格判定 |

TA-M5 退出条件：Haolo 运行时，无论当前是否打开预警页或 K 线页，Alert Engine 都以共享原始数据持续确定性监控；退出 Haolo 后停止。

## 10. TA-M6：预警卡片、编辑器、主题与可访问性

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M6-001 | 将左侧“预警”入口接入独立 Alerts 页面 | 已完成 | TA-M1-004 | Alerts 与自动任务独立路由；旧自动任务专项及全仓回归通过 |
| TA-M6-002 | 实现预警列表、空状态和参考自动任务的卡片布局 | 已完成 | TA-M6-001 | 标题、摘要、范围、模式、状态、Provider、动作与空状态完整 |
| TA-M6-003 | 实现卡片详情、证据历史和 MonitoringGap 展示 | 已完成 | TA-M6-002 | 详情显示 gap、最后求值/触发、次数、条件值、inputHash 与 evidenceId |
| TA-M6-004 | 实现通用规则的市场/周期动态配置 | 已完成 | TA-M2-005,TA-M6-002 | 固定/市场集合、逗号多市场/多周期、资源估算；修改必须新模拟 |
| TA-M6-005 | 实现画线绑定配置和限制 | 已完成 | TA-M3-008,TA-M6-004 | 画线锁定 scope；移动实时同步主进程；删除后自动暂停并解释 |
| TA-M6-006 | 实现编辑 revision、重新模拟确认和生命周期操作 | 已完成 | TA-M4-008,TA-M6-003 | 新 revision 确认前旧规则继续监控；暂停/恢复/删除动作完整 |
| TA-M6-007 | 实现 loading/reconnecting/gap/cooldown/triggered/failed 等状态 | 已完成 | TA-M6-003 | 卡片状态来自 Store/Engine snapshot，空档与失败不显示为正常监控 |
| TA-M6-008 | 完成键盘、ARIA、焦点、缩放与 reduced-motion | 已完成 | TA-M6-002..007 | ARIA、focus-visible、disabled、字体缩放 token、reduced-motion 契约测试通过 |
| TA-M6-009 | 完成亮色/暗色所有交互和异常状态 | 已完成 | TA-M6-002..008 | Windows Electron 实机生成 14 张亮暗/100%/125%/150%/列表/详情/编辑/错误/加载截图；逐图复核及机器报告通过，证据见 `docs/qa/trading-alerts/windows-2026-08-12/` |
| TA-M6-010 | 创建成功气泡提供预警页入口，并保证成功响应与 Store/列表卡片一致 | 已完成 | TA-M4-008,TA-M6-001,TA-M6-002 | 待确认绑定随 Store 快照恢复，普通“确认”不再落入模型假成功；Service 与 Renderer 双重读回校验后才显示成功；入口随顶层会话持久化并直达对应预警；亮暗主题与完整回归通过 |
| TA-M6-011 | 确认链路复用模拟行情、容错主进程网络并幂等恢复已持久化预警 | 已完成 | TA-M5-001..008,TA-M6-010 | 模拟真实 K 线预热 Data Hub；Electron `net.fetch` 轮询统一历史/实时网络；失败卡片保留为重连并退避恢复；确认幂等且 Store 对同 Draft 唯一；真实开发客户端原 `arming` 记录已原 ID 恢复到 `monitoring` |
| TA-M6-012 | 移除全部状态预警卡片的装饰图标并统一草稿布局 | 已完成 | TA-M6-002,TA-M6-009 | 实体卡片不再渲染闹钟及 54px 占位，监控/触发/暂停/需处理/完成等状态与草稿统一为单列内容；亮暗主题、缩放与回归通过 |

TA-M6 退出条件：所有预警状态和配置在亮色、暗色、鼠标、键盘和屏幕阅读器语义下可用；不存在只适合白底的硬编码控件。

## 11. TA-M7：生命周期、空档、证据、通知与深链

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M7-001 | 实现一次性、重复、重新武装、冷却和次数限制 | 已完成 | TA-M5-006 | 持续为真不连发；false→true、next_bar、after_cooldown 及次数限制通过 |
| TA-M7-002 | 接入 app/power/network/provider 生命周期与心跳 | 已完成 | TA-M5-002 | main power、Renderer online/offline、Provider health、心跳/关机时间接入 |
| TA-M7-003 | 实现 MonitoringGap 记录和卡片状态 | 已完成 | TA-M7-002,TA-M6-003 | app_stopped/system_sleep/network_offline/provider_disconnected 全字段持久化展示 |
| TA-M7-004 | 实现恢复预热、基线和 no-catch-up | 已完成 | TA-M7-003,TA-M3-009 | 恢复清历史缓存、重新取历史并建立 baseline；空档事件不求值 |
| TA-M7-005 | 实现不可变 TriggerEvidence 和 inputHash | 已完成 | TA-M5-006 | 条件值、K 线、Provider、coverage、画线快照、ruleHash/inputHash 入证据 |
| TA-M7-006 | 实现卡片、会话和桌面通知的同证据更新 | 已完成 | TA-M7-005,TA-M6-003 | originThreadId 持久化；触发原子落库后以同一 evidenceId 更新三处并去重 |
| TA-M7-007 | 复用桌面通知视觉并实现预警通知协议 | 已完成 | TA-M7-006 | Windows 自定义窗/系统 Notification 与现有通知设置开关复用 |
| TA-M7-008 | 实现点击通知到预警详情和 K 线触发位置深链 | 已完成 | TA-M7-007 | alert/evidence/market/interval/time 上下文，详情选择并在真实 K 线上定位标记 |
| TA-M7-009 | 完成空档、重连、重复通知和生命周期 E2E | 已完成 | TA-M7-001..008 | 生命周期/Provider 重连/不补触发/通知幂等专项测试通过 |

TA-M7 退出条件：监控覆盖范围诚实可见，真实触发可追溯、只通知一次，并能从通知精确回到触发盘面。

## 12. TA-M8：外部数据与工具扩展

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M8-001 | 固化 Data Adapter Manifest 和 Capability 协议 | 已完成 | TA-M2-005,TA-M5-002 | `data-adapter.mjs` 严格版本/未知字段；覆盖字段、市场、周期、频率、延迟、历史、权限、限速、健康 |
| TA-M8-002 | 实现 Provider/Plugin/MCP/文件能力盘点 | 已完成 | TA-M8-001 | Registry 区分 installed/discovered、executable、connected；Capability snapshot 统一查询 |
| TA-M8-003 | 实现 Provider 注册/连接/授权引导 UI | 已完成 | TA-M2-007,TA-M6-009 | 设置→数据提供方及 Alerts Provider 面板；公共/最小权限/文档/状态/刷新和安全说明 |
| TA-M8-004 | 实现 Adapter 验证器和健康监控 | 已完成 | TA-M8-001 | 未来时间、延迟、空值、重复、覆盖和连接健康测试通过 |
| TA-M8-005 | 实现至少一个 Mock 外部数据 Adapter 纵向切片 | 已完成 | TA-M8-004 | Mock Manifest/Adapter；缺能力→连接→同一 external DSL 由确定性 Evaluator 回放触发；无样本时模拟失败关闭 |
| TA-M8-006 | 按实际首批需求接入合适 Provider | 已完成 | TA-M8-005 | 接入 Binance 与 Hyperliquid 公共 OHLCV；Hyperliquid REST 5 根历史及 WebSocket 实时报文已真实公网验证 |
| TA-M8-007 | 完成凭证、权限、撤销、错误脱敏和审计测试 | 已完成 | TA-M8-003,TA-M8-006 | 首批 Provider 公共无密钥；密钥模式脱敏且不暴露 Renderer；未来私有接入须安全设置/最小权限/可撤销 |
| TA-M8-008 | 完成缺数据→接入→验证→原草稿续接 E2E | 已完成 | TA-M2-008,TA-M8-006 | `awaiting_*` draft 持久化；Capability 连接后原 draftId 续接并保留已确认规则字段 |

TA-M8 退出条件：能力缺口有可执行的完成路径；只有确实覆盖目标字段且验证通过的数据源才能启用，暂未接入不会被误报为可监控。

## 13. TA-M9：安全、性能、长稳、灰度与发布

| ID | 任务 | 状态 | 依赖 | 交付物与验收 |
|---|---|---|---|---|
| TA-M9-001 | 完成 Prompt/脚本/Schema/IPC/Provider 注入安全审查 | 已完成 | TA-M2,TA-M3,TA-M8 | 安全边界专项通过；报告见 `trading-alert-agent-security-performance-report.zh-CN.md` |
| TA-M9-002 | 完成公式、回放、模拟同源和无未来数据审计 | 已完成 | TA-M3,TA-M4,TA-M5 | 指标黄金向量、三值 fail-closed、同源模拟和稳定 inputHash 测试通过 |
| TA-M9-003 | 完成性能、资源上限、24h 长稳和断线风暴测试 | 进行中 | TA-M5-009,TA-M7 | 容量/洪峰/断线/短测内存通过；真实 Hyperliquid、100 预警、24h 墙钟任务运行中，原始报告和机器验收分别写入 `.tmp/trading-alert-soak-24h/current.json`、`assessment-current.json` |
| TA-M9-004 | 完成亮暗主题、缩放、可访问性和 Windows 实机验收 | 已完成 | TA-M6-009,TA-M7-008 | DOM/CSS/字体/焦点/reduced-motion 自动化与 Windows Electron 14 张实机矩阵均通过；实机发现的主页面 flex 收缩缺陷已修复并重拍通过 |
| TA-M9-005 | 完成专项、全量测试、TypeScript 和生产构建 | 已完成 | TA-M9-001..004 | 加入完整意图 DSL、确定性快速编译、可恢复模型传输和链路 E2E 后，最新单次受控全量 1937/1937、专项、TypeScript 与 Vite production build 全部通过 |
| TA-M9-006 | 内部 shadow 模式只记录不通知 | 已完成 | TA-M9-005 | shadow 落不可变证据且通知数为 0；同 frames 离线回放 value/inputHash 完全一致 |
| TA-M9-007 | 小范围灰度并默认关闭 | 受阻 | TA-M9-006 | 默认关闭、诊断和回退手册完成；缺少真实测试用户范围、持续观察时间及灰度授权 |
| TA-M9-008 | 审批公开开关、更新说明和发布 | 受阻 | TA-M9-007 | 未经灰度与明确发布审批，不提升版本、不打发布安装包、不上传更新系统 |

TA-M9 退出条件：满足技术规格第 21 节全部发布定义；未经灰度和审批不得全量开放。

## 14. 关键路径与可并行工作

主关键路径：

```text
TA-M1 协议/Store
  → TA-M2 意图/追问
  → TA-M3 Evaluator
  → TA-M4 模拟确认
  → TA-M5 Data Hub/Engine
  → TA-M7 触发/通知
  → TA-M9 灰度发布
```

可安全并行：

- TA-M3 指标/规则与 TA-M2 意图/依赖可在 Schema 冻结后并行。
- TA-M6 卡片视觉可在 TA-M1 状态协议完成后用 Fixture 开发，但业务动作必须等真实 Store/Engine 接入。
- TA-M8 Adapter 协议可与 TA-M5 Data Hub 并行，具体 Provider 接入需等需求和授权明确。
- 设计/测试从每个里程碑第一天同时覆盖亮暗主题和异常状态，不留到发布前补做。

禁止并行造成的重复实现：

- 不为模拟器和监控器分别写一套规则判断。
- 不为图表和预警长期维护两套行情连接。
- 不为自动任务和预警共用同一运行时 Store/Worker。
- 不把新业务继续堆进 `src/renderer/main.ts` 或 `src/main/main.mjs`。

## 15. 每次开发回合的回写模板

开始时：

```md
- 当前任务：TA-Mx-xxx
- 目标：
- 预计修改模块：
- 验收命令：
- 已知风险/现有用户改动：
```

结束时：

```md
- 任务状态：已完成 / 进行中 / 受阻
- 实际修改：
- 测试结果：
- 亮色/暗色验收：
- 性能/安全证据：
- 未完成项与下一步：
- 进度日志：YYYY-MM-DD 追加记录
```

受阻记录必须包含：

```md
- 阻塞事实：
- 已尝试路径：
- 缺失的数据/工具/权限：
- 推荐接入方案：
- 用户需要完成的最小动作：
- 解除条件：
- 可用的降级方案：
```

## 16. 进度日志

### 2026-08-12

- 完整整理此前对话中确认的智能交易预警需求：自然语言理解、持续追问、模拟 K 线、用户确认、卡片创建、客户端内监控、真实触发和通知闭环。
- 冻结默认语义：指标/形态默认收盘确认；价格/画线触碰默认盘中实时；一次性默认、可重复；用户明确意图优先。
- 冻结生命周期语义：只在 Haolo 运行时监控；停机、休眠和断网不补触发；恢复只预热和建立基线；卡片显示监控空档。
- 冻结技术方向：原始数据和严谨数学公式是触发事实源，截图只展示；大模型只把自然语言编译为受控 DSL，不进入实时监控热路径。
- 冻结最大兼容策略：布尔嵌套、顺序、窗口、持续、计数、多市场、多周期、混合确认模式、安全数学表达式和版本化扩展注册表。
- 冻结完成优先原则：缺数据或工具时先诊断并引导用户接入合适 Provider、Plugin、MCP、API、Webhook、数据库或文件，验证后从原草稿继续；不得直接拒绝或编造数据。
- 完成现有代码边界盘点：Renderer 已有 Binance 行情、K 线聚合、指标纯函数和 Drawing ID；自动任务 Worker 是约 30 秒 Agent 轮询，不适合实时预警；现有自动任务卡片和任务完成通知可复用视觉语言。
- 创建技术规格 `docs/trading-alert-agent-technical-spec.zh-CN.md`，包含产品契约、DSL、公式、模拟器、Data Hub、Alert Engine、Store、UI、依赖接入、安全、测试、发布定义和 ADR。
- 创建本进度台账，建立 TA-M0 至 TA-M9 的稳定任务编号、依赖、退出条件和回写模板。
- 本回合只新增规划文档，没有实现或声称完成任何预警功能代码，也没有构建、打包或发布。
- 用户授权严格按冻结规划连续实施全部阶段；正式启动 TA-M1-001。实施将逐项先标记 `进行中`，只有代码、必要测试和验收证据齐全后才改为 `已完成`。
- TA-M1-001～TA-M1-007 已完成：新增版本化严格协议、TypeScript/JSON Schema、稳定语义哈希、revision、独立原子 Store、损坏数据隔离、Feature Flag、错误分类、审计事件和 Fixture。
- TA-M1 验证证据：`node --test test/trading-alert-protocol.test.mjs` 10/10 通过；`pnpm typecheck` 通过；未知字段、重复条件、失效哈希、非法绘图泛化、重复证据和损坏持久化均有失败关闭/幂等测试。
- TA-M2-001 已按台账流程标记 `进行中`，开始实现模型中立、无执行权限的意图编译边界。
- TA-M2～TA-M4 已完成：自然语言编译与持续追问、Capability 补齐、严格确认绑定、确定性 Evaluator、复合/顺序/多周期/画线规则、同源模拟规划和独立画布图层均通过专项测试。
- TA-M5-001～008 已完成：建立主进程 Data Hub、Binance/Hyperliquid Adapter、共享订阅/历史、乱序与缺口门控、自定义周期聚合、主进程 Engine、触发幂等和运行时批量持久化；临时 Renderer 行情写桥已删除。
- TA-M5-009 自动化部分完成：100 张规则卡片共享 1 个物理订阅和 1 个历史请求；事件 P50 5.48ms、P95 7.49ms、最大 8.37ms；200 事件/20,000 逻辑求值洪峰无重复触发；强制 GC 后堆增量 1.76MiB。该测试为加速 24 根 1h K 线，不冒充真实墙钟 24h。
- TA-M6-001～008 已完成：Alerts 独立页面、卡片/详情/空档/证据、固定或集合 scope、多市场多周期编辑、画线锁定与删除暂停、revision 重模拟确认、完整状态、键盘/ARIA/焦点/字体缩放/reduced-motion 均已实现。
- 修复全局主题契约回归：Alerts 所有颜色改用语义 token，所有字号纳入 `--app-font-size-offset`；亮/暗、hover/active/focus/disabled/loading/error 契约测试通过。TA-M6-009 只剩候选 Windows 实机截图/人工验收。
- TA-M7 已完成：app/休眠/网络/Provider 生命周期、MonitoringGap、恢复清缓存与 no-catch-up、不可变证据、通知幂等、原会话回写和 K 线深链。规则持久保存 `originThreadId`，卡片/会话/通知共享同一个 `evidenceId`。
- TA-M8 已完成：严格 Data Adapter Manifest、能力盘点、设置页、样本验证、Mock 外部字段回放和缺能力续接；Hyperliquid 公共 Adapter 按官方 REST/WS 契约实现，并于 2026-08-12 真实公网验证 5 根 1h BTC 历史 K 线与一条 1m WebSocket 更新，数值均有限合法。
- TA-M9-001/002/006 已完成：运行时无模型/DOM/截图/任意脚本热路径，IPC sender 鉴权，密钥脱敏；shadow 只落证据不通知，并与离线回放的 value/inputHash 一致。
- 新增 `docs/trading-alert-agent-security-performance-report.zh-CN.md` 和 `docs/trading-alert-agent-release-runbook.zh-CN.md`，固化安全结论、基准、24h 模板、开关矩阵、灰度观察、回退和审批单。
- 验证记录：Trading Alert 专项 60/60；全仓（排除独立慢媒体契约）受控并发 1830/1830；媒体契约 71/71；TypeScript `tsc --noEmit` 通过；Vite 生产构建通过，仅保留项目既有的大 chunk 警告。
- TA-M9-005 最终关闭：`node --test --test-concurrency=4` 单次受控全量复跑 1901/1901 通过，0 failed/cancelled/skipped/todo，耗时 38.817s。
- TA-M5-009/TA-M6-009/TA-M9-003/004 尚需真实墙钟时间和 Windows 人工记录；TA-M9-007/008 缺少真实灰度范围与发布授权。功能保持默认关闭，未提升版本、未打发布安装包、未上传或公开发布。
- 新增 `scripts/trading-alert-soak.mjs` 与 `alerts:soak` 命令：默认以 Hyperliquid BTC 1m、100 张规则真实运行 24h，每分钟原子记录 CPU/Heap/RSS、共享订阅、行情事件、迟到/缺口、Evidence/重复 Evidence 和 MonitoringGap；短程真实公网冒烟 8.694s 通过。
- 正式 24h soak 已于 2026-08-12 02:33（Asia/Shanghai）启动，后台进程 PID 22004；截至 02:46 已运行约 13 分钟，1 个健康共享订阅、接收/发出 1178 个事件、重复行情 0、重复 Evidence 0、错误 0。任务仍在运行，未提前宣称 TA-M5-009/TA-M9-003 完成。
- TA-M6-009/TA-M9-004 完成：新增 Windows Electron 视觉验收器和浏览器 QA Fixture，实机覆盖 14 张亮暗、三档缩放、列表/详情/编辑/错误/加载截图；首次运行发现页面在内容较少时横向收缩，补充 `flex: 1 1 auto` 后完整重拍通过，证据固化在 `docs/qa/trading-alerts/windows-2026-08-12/`。
- 修正上一条未完成汇总：TA-M6-009/TA-M9-004 现已关闭；当前剩余 TA-M5-009/TA-M9-003 的真实 24h 墙钟，以及 TA-M9-007/008 的真实灰度范围与发布授权。功能继续默认关闭，未提升版本、未打发布安装包、未上传或公开发布。
- 新增长稳/视觉验收基础设施后再次执行全仓测试，原 1901 个用例加新增 5 个用例共 1906/1906 通过；TypeScript `tsc --noEmit`、Vite production build 和 `git diff --check` 同步通过。
- 为防止真实墙钟等待中断验收链路，已创建绑定当前会话的每日定时跟进（自动化 ID 24），首个检查窗口为 2026-08-13 02:40（Asia/Shanghai）。截至本次记录，PID 22004 已运行约 21 分钟，Hyperliquid 共享订阅健康，接收/发出 1749 个事件，重复行情 0、缺口 0、重复 Evidence 0、错误为 null；资源斜率仅作早期观测，必须以完整 24h 报告判定。
- 补齐 TA-M5-009/TA-M9-003 的机器验收门禁：新增 `scripts/trading-alert-soak-assess.mjs` 与 `alerts:soak:assess`，从本次已有逐分钟样本严格验证 24h 墙钟、采样覆盖、共享订阅、健康率、数据质量、迟到率、幂等、CPU、资源峰值和排除预热后的内存斜率，并原子输出 JSON/Markdown。新增 3 个验收器回归场景，与原长稳测试合计 6/6 通过；当前报告按预期仅因仍在运行、墙钟不足和早期趋势未收敛而失败关闭，不影响正在运行的 PID 22004。
- 长稳机器门禁接入后完成最新全量回归：`node --test --test-concurrency=4` 1913/1913 通过，0 failed/cancelled/skipped/todo，耗时 40.789s；TypeScript 检查和 Vite production build 同时通过，仅保留既有的大 chunk 提示。自动验收跟进已更新为结束后强制执行 `alerts:soak:assess`，只有 `assessment.passed=true` 才允许关闭长稳任务。
- 修复真实创建预警时报错 `Alert intent response requestId mismatch`：根因是协议要求模型原样返回关联 ID，但模型可见的 `INPUT_JSON` 漏传该字段。现已显式下发精确 `requestId`，首次协议错误自动进行一次同上下文只读修正，第二次仍严格失败关闭；补充错配修正、连续错配、并发隔离、修正提示和 Service E2E。专项 21/21、最新全仓 1925/1925、TypeScript 与 Vite production build 均通过。
- 长稳运行态复核发现首轮 PID 22004 的报告停在 2026-08-12 03:57（Asia/Shanghai），实际只连续运行约 1.4 小时，不能计入 24h 验收；原始证据原样归档至 `.tmp/trading-alert-soak-interrupted-20260812-0357/`。直接由 Windows 计划任务启动 Node 的尝试收到 `0xC000013A`，证据归档至 `.tmp/trading-alert-soak-interrupted-scheduler-direct-20260812-1242/`。
- 新增 `scripts/run-trading-alert-soak-task.ps1` 作为计划任务守护入口，并为逐分钟报告补充 `processId`、`checkpointedAt`；脚本校验 Node、soak 脚本和输出目录必须位于工作区 `.tmp`，同步等待 Node 并记录启动器状态/退出码。新一轮于 2026-08-12 12:44:34（Asia/Shanghai）启动，Windows 计划任务 `Haolo Trading Alert 24h Soak` 为运行中，Node PID 31000；截至 12:47 已连续写入 3 个样本，单一共享订阅健康，接收/发出 87/87，重复 0、缺口 0、错误为 null。自动化 ID 24 已改在 2026-08-13 12:55 首次验收，未提前关闭 TA-M5-009/TA-M9-003。
- 彻底修复截图所示“模型连续两次返回不符合协议结果”的画线预警失败。真实原始响应证明根因不是 `requestId`，而是旧 Prompt 未下发完整 Alert DSL，模型因而自创 `{marketId, interval, triggerMode, condition}` 简化结构并被严格 Validator 正确拒绝。现已下发完整 DSL 与当前画线动态合法示例，本地统一补齐系统托管身份字段；对唯一画线触碰/突破增加不猜测的确定性恢复，多画线则追问。开发客户端允许实际走通确认→监控，打包生产仍保持默认关闭。`alerts:intent:live-smoke` 已用真实 `gpt-5.6-sol` 的原始响应直接贯穿生产 Service，完整通过编译、模拟、确认绑定、临时 Store 卡片、Engine `monitoring` 和单一物理行情订阅；错误结构回归也通过同一链路。最新全仓 1931/1931、TypeScript、Vite production build 全部通过（仅既有大 chunk 提示）。
- 13:16 长稳旁路复核：计划任务仍为 `0x41301`（运行中），PID 31000，33 个逐分钟样本，1 个健康共享订阅，接收/发出 1100/1100，重复 0、缺口 0、error 为 null；本次修复与全仓门禁未中断 24h 任务，TA-M5-009/TA-M9-003 继续保持进行中。
- 13:20 重新启动最新开发客户端后，主进程 `trading-alert-store.json` 已连续写入真实 Engine heartbeat，证明开发启动器的显式 `HAOLO_TRADING_ALERTS_ENABLED=1` 已生效，确认阶段不会再被隐藏开关拦截；该注入仅属于 `pnpm dev`，生产打包仍默认关闭。环境注入后的 `dev-source-update + intent + service` 回归 30/30 通过。
- 13:57 修复“模拟 K 线被压成贯穿画布竖线、没有在后续周期形成真实走势”。根因是规划器允许首根以最高 ±12% 直接跳向目标，Renderer 又只放首根数据就执行全图 `fitContent`，且未来边界使用全高竖线。现改为历史 ATR/实体/成交量/tick-size 驱动的多根连续 OHLCV，动态计算未来画线价格，常见组合使用确定性种子后再有界 beam 求解；触发默认至少位于第 3 根未来 K，画面至少展示 6 根，无法延后时保留数学上真实的较早触发并只补连续后续行情。Renderer 预留全部未来 time，按真实周期逐根填充，固定展示近期真实行情和完整未来区间，箭头绑定实际 `triggerBarIndex`，全高竖线改为亮暗主题语义色小标签。模拟+UI 专项 13/13、全仓 1931/1931、TypeScript 与 Vite production build 均通过；开发客户端已自动重启至最新源码，24h soak 未被中断。
- 16:15 彻底修复截图所示“Haolo 工作流执行在 60000 毫秒后超时”。根因是 `trading_alert_intent_compile` 被错误地与轻量请求路由共用 60 秒绝对上限且禁用恢复；日志同时显示该窗口内模型 WebSocket 断开并重试，外层先于恢复完成把任务判为失败。现在唯一画线的触碰/突破采用本地确定性编译，直接生成固定市场/周期/drawing revision、盘中 `high >= line(t) AND low <= line(t)` 与双向突破规则，模型调用次数为 0；画线与指标、外部数据等复合条件仍由模型编译，但改为 180 秒无活动超时、收到进展即续期、传输失败在同一内部线程自动恢复。新指令会取消同会话旧编译，Renderer 运行令牌阻止旧结果或旧错误覆盖新会话；窗口关闭/导航也会回收模型任务。
- 本次完整链路验收：专项 44/44 与扩展专项 36/36 通过；`alerts:intent:live-smoke` 返回 `compilerPath=local-deterministic`、`simulationTriggered=true`、`alertStatus=monitoring`、Engine 1 个预警/1 个订阅及 1 条物理行情订阅；全仓 1937/1937、TypeScript 与 Vite production build 均通过，构建仅保留项目既有的大 chunk 提示。
- 复核 24h soak 时确认 Windows 于 15:11 发生系统重启，旧 run `2026-08-12T04-44-34-824Z-31000` 在 2 小时 27 分处被操作系统终止，不能参与验收；原 checkpoint 与 launcher 已分别归档为 `.interrupted.json`。完整 24h 已于 16:15:13 重新启动为 run `2026-08-12T08-15-13-636Z-13780`，TA-M5-009/TA-M9-003 继续保持进行中。
- 16:33 修复“模拟触发 K 线落入历史区间”。根因是主图所有真实 K 线在 Lightweight Charts 显示层统一增加 `CHINA_TIME_OFFSET_SECONDS`，模拟 K 线却直接把 UTC 毫秒转成秒，少了同一显示转换，因而在图上整体早 8 小时；底层模拟 UTC 时间和触发公式本身没有错误。现模拟蜡烛、触发箭头、未来边界和可视范围全部使用与主图一致的显示时间，并增加 fail-closed 守卫：第一根模拟 K 线必须严格晚于当前画布最后一根真实 K 线，否则提示按最新行情重新模拟而不绘制错位结果。图表/模拟专项 62/62、主测试套件 1866/1866、独立慢媒体契约 71/71、TypeScript 与 Vite production build 全部通过；开发客户端已自动重启到最新源码，24h soak 新 run 未被中断。
- TA-M6-010 根因与一致性修复：确认路由原先只依赖 Renderer 内存 Map，重绘、任务 ID 迁移或客户端重启后，“确认”可能落到普通模型并生成没有 Store 写入的假成功文案。Service 快照现从持久化 Draft/Simulation 生成最小 `pendingConfirmations`，Renderer 首次发送前加载并按持久任务别名恢复确认状态；重启后仍调用受控 `tradingAlertsConfirm`，不会让模型代替创建。
- TA-M6-010 成功门禁与入口：Service 在 Engine arm 后同时读回 Alert、列表和已确认 Draft，任一不一致即返回 `TRADING_ALERT_PERSISTENCE_NOT_VERIFIED`；Renderer 再取最新快照确认目标 `alertId` 已存在，之后才清除模拟层并显示成功。成功气泡下方新增简约“查看我的预警”，点击进入图 2 所示的独立预警卡片列表；动作元数据进入顶层交易会话协议，关闭客户端后恢复消息仍可点击。
- TA-M6-010 主题与验证：入口亮色/暗色共用语义 Token，并覆盖 default、hover、active、focus 和 disabled；没有新增硬编码浅色控件。预警专项 93/93、定向服务/UI/会话持久化 34/34、全仓 1954/1954、TypeScript、主进程语法检查与 Vite production build 全部通过；构建仅保留项目既有的大 chunk 提示。
- TA-M6-011 真实根因：确认已先将 Alert 和 confirmed Draft 原子写入 Store，随后 Engine 用 Node/Undici 直接访问 Binance 历史行情时 `UND_ERR_CONNECT_TIMEOUT`，异常越过 `confirm` 后被 Renderer 错误描述成“未创建”；Store 证据中的唯一卡片实际停在 `arming`，继续确认还存在重复创建风险。
- TA-M6-011 链路修复：`simulate` 现在把 Renderer 已验证的真实行情帧按 context/market/interval 精确种入 Data Hub，紧随其后的确认无需重复请求历史；桌面 Service 同时为 Binance 注入 Electron `net.fetch`，历史和实时轮询共用 Chromium/系统网络路径。Engine 对 transport/provider 预热失败持久化 `reconnecting` 和失败原因、后台指数退避重试，启动时单卡失败不再阻断整个 Service；Renderer 只有状态真为 `monitoring` 才说明监控已启动，否则明确说明卡片已保存且正在恢复。
- TA-M6-011 幂等与实机验收：Service 对同一确认做 single-flight，并在确认重试时按 `draftId` 复用已有 Alert；Store 额外约束同 Draft 只能有一个 Alert。Electron `net.fetch` 已真实访问 Binance 成功，轮询订阅也在 Electron 实机收到 K 线；重启开发版后，截图对应 `alert-ba4b2b15-b4b5-4c67-b809-36711d76ac48` 从 `arming` 原 ID 恢复到 `monitoring`，该 Draft 卡片数为 1，`armedAt/lastEvaluatedAt` 已写回且 failure 为空。预警专项 97/97、故障注入专项 19/19、全仓 1958/1958、TypeScript、主进程语法、Vite build 和 `git diff --check` 通过；构建仅保留既有大 chunk 提示，独立 PID 13780 的 24h soak 仍在运行。
- TA-M6-012 卡片简化：从实体预警的唯一渲染模板移除 `⏰` 和 `.trading-alert-card-icon`，基础卡片直接采用草稿的 `minmax(0, 1fr)` 单列与零列间距，因此监控、触发、暂停、需处理、完成及后续新增状态都会同步无图标且没有残留空白。亮暗主题/全部 QA 状态/100%、125%、150% 视觉报告无溢出且通过，UI/视觉/暗色专项 20/20、TypeScript、Vite production build 和 `git diff --check` 通过；开发版已自动重启到最新样式。
- TA-M2-010/M1-100 完成模型优先意图链路：删除唯一画线的本地意图快速编译和任何本地语义恢复，画线、MA、MACD、外部数据及嵌套组合都先调用只读无工具模型；本地只执行严格 Schema、能力、身份和数学校验。Prompt 新增版本化指标能力表、金叉/死叉术语、MA/MACD、布尔/顺序/窗口与动态画线合法示例，所以“当 MA5 和 MA20 死叉”不再被误判为方向不清。
- 协议健壮性完成：非法 JSON、未知字段、请求关联错配、空响应或 DSL 路径错误最多三次携带精确 `code/path/message`、受限且脱敏的上一响应进行模型返修；仍失败时再由模型生成仅含缺口和最小问题的澄清响应，最终畸形或 Provider/transport 故障只落无候选规则的可续接草稿，不丢原始指令、不本地猜测、不创建监控。普通日志和冒烟输出只保留响应长度与 SHA-256，不输出模型原文；取消和新指令仍立即中止旧链路且不落过期草稿。
- 真实 `gpt-5.6-sol` 使用生产 Service 分别完成三条 E2E：唯一趋势线触碰/双向突破、BTCUSDT 4h MA5/MA20 死叉、BTCUSDT 1h MA 死叉且 MACD DIF 下穿 0 轴；三者均一次生成合法 DSL，完成同源未来 K 线模拟、确认绑定、Store 卡片、Engine `monitoring`、1 个逻辑订阅和 1 条物理行情订阅。专项预警 102/102、意图文件 23/23、意图+Service 30/30、全仓 1964/1964、TypeScript、Vite production build 与 `git diff --check` 均通过；构建仅保留既有大 chunk 提示。
- 21:08 旁路复核：24h soak PID 13780 自 16:15:13 起仍存活且响应正常，`current.json` 持续更新，本次模型链路修复、三次真实模型冒烟和全仓门禁均未中断长稳；TA-M5-009/TA-M9-003 继续保持进行中，不提前宣称完成。
- 完成 TA-M4-010：此前 Renderer 只接收模拟蜡烛和触发柱，规则指标及参数未进入模拟状态，因此后台虽能证明 MA5/MA20 死叉，画布却不会自动显示 MA，也不能展示未来指标曲线。现在 Renderer 直接从已通过 Schema/Evaluator 的规则 AST 提取指标族、参数、条件 ID 和触发语义，不从聊天文本二次猜测；模拟状态持久保存精确指标规格，并以“真实历史 K 线 + 独立未来 OHLCV”连续复算。
- TA-M4-010 展示闭环：MA/SMA、EMA、BOLL 上/中/下轨在主图自动显示；MACD DIF/DEA/柱体、RSI、KDJ K/D/J、ATR、CCI、ADX/+DI/-DI、MOM、ROC 自动创建副图。蜡烛逐根播放时对应未来指标点同步出现，完成后只在该规则实际 `triggerBarIndex` 标记“模拟触发”；历史行情、用户指标配置、真实行情缓存和监控事件流均不被写入。切换市场/周期会隔离，副图重建会安全恢复，取消/确认/销毁会完整清理，任务恢复可从会话级模拟状态重建。
- TA-M4-010 主题与验证：模拟蜡烛和指标线提供独立浅色/暗色高对比配色，主题热切换同步更新价格轴、图例和触发标记；无新增浅色专用控件或交互缺口。Evaluator 与 Renderer 指标金标一致性、规则参数提取、MA+MACD、BOLL/RSI/KDJ、逐根同步、生命周期和主题专项 57/57 通过；全仓 1965/1966 的唯一失败为无关 Feishu 测试清理临时目录的偶发 `ENOTEMPTY`，同一用例独立复跑 1/1 通过；TypeScript 与 Vite production build 通过，仅保留既有大 chunk 警告。开发版已自动重载，24h soak 未被停止，TA-M5-009/TA-M9-003 状态未提前更改。
- 完成 M1-102/TA-M4-011：VOLUME 不再是模拟蜡烛的附带随机值。模型 DSL 新增有界 `lag` 与 `rolling(min/max/avg/sum)`，并明确“前 N 根”使用 `offset=1` 排除当前柱；例如“当前量能比前 3 根都大于 3 倍”会由模型编译成 `volume > 3 × rolling(max, volume, period=3, offset=1)`，本地只做严格协议校验和执行，不走关键词意图旁路。Capability Registry 会递归推导 `volume` 字段及足够历史窗口，历史不足返回 `unknown`。
- TA-M4-011 模拟闭环：Planner 从生产 Evaluator trace 反推需要达到的成交量，把每个未来柱的 volume 与 close 一起纳入有界搜索、OHLCV proof 和 `verifySimulation` 重放哈希；触发后 Renderer 从同一规则 AST 自动创建 VOLUME 柱体、MA5/MA10 量均线和模拟图例，并在实际 `triggerBarIndex` 的量柱标注“模拟触发”。量柱颜色、量均线、轴、图例和标记继续使用浅色/暗色语义配色，退出/切换/恢复生命周期与其他模拟副图一致。真实 `gpt-5.6-sol` 量能场景经严格协议返修产出精确的“前三柱最大量 × 3”规则，并完成 `compile → simulate → confirm → Store → Engine monitoring → 共享订阅`；专项 69/69、全仓 1970/1970、TypeScript 与 Vite production build 全部通过，构建仅保留既有大 chunk 提示，24h soak 不受影响。
- 2026-08-13 12:55 长稳验收未通过：run `2026-08-12T08-15-13-636Z-13780` 的 checkpoint 停在 2026-08-13 00:54:44（Asia/Shanghai），连续墙钟仅 8 小时 39 分 31 秒；Windows 系统日志确认 00:55:38 由电源 API 发起关机、00:55:43 进入低功耗，进程因此收到 `0x40010004`，不是行情或预警引擎异常。原始 checkpoint/launcher 已保留为同 run ID 的 `.interrupted.json` 与 `.launcher.interrupted.json`，不参与验收；TA-M5-009/TA-M9-003 仍为进行中。
- 长稳守护修复并重启：`run-trading-alert-soak-task.ps1` 现会在启动前校验旧 PID/命令行、原子归档失联的 `running` 报告，并以 `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` 阻止 24h 期间自动休眠，退出后恢复系统策略；计划任务同步设为不因 idle end 停止、唤醒运行、失败后 5 分钟重试 3 次。守护契约回归 7/7 通过。完整新 run `2026-08-13T05-02-46-847Z-8784` 已于 2026-08-13 13:02:46（Asia/Shanghai）从零启动；首两份逐分钟 checkpoint 显示单一共享订阅健康、接收/发出 31/31、重复 0、缺口 0、error 为 null。只有该 run 真实达到至少 24h 且 `pnpm alerts:soak:assess` 生成 `passed=true` 后才允许关闭两项任务。
- 2026-08-14 12:56 再次验收确认上述 run 也未达到门槛：checkpoint 在 2026-08-13 13:41:48（Asia/Shanghai）停止，连续运行仅 39 分 1 秒；系统日志明确记录 13:42:01 由 `StartMenuExperienceHost.exe` 代表当前用户发起关机、13:42:06 进入低功耗。`ES_SYSTEM_REQUIRED` 能阻止空闲自动休眠，但按 Windows 设计不能覆盖用户显式关机。该 run 已归档为 `.interrupted.json`，TA-M5-009/TA-M9-003 继续保持进行中。
- 守护再加固：计划任务现在每 5 分钟重复触发且使用 `IgnoreNew`，运行中的物理进程不会重复，若关机/唤醒导致进程消失则会自动归档中断证据并从零启动新的完整 24h；launcher 同时识别已完成且墙钟不少于 24h 的 `passed` 报告，后续重复触发只保留报告等待 `alerts:soak:assess`，不会覆盖验收证据。守护回归仍为 7/7。当前 run `2026-08-14T04-58-53-107Z-2900` 于 2026-08-14 12:58:53（Asia/Shanghai）启动，第二份 checkpoint 显示单一共享订阅健康、接收/发出 32/32、重复 0、缺口 0、error 为 null；最早只能在 2026-08-15 12:58:53 后验收，期间仍不能手动关机。
- 2026-08-15 12:56 验收再次被低功耗中断：run `2026-08-14T04-58-53-107Z-2900` 最后 checkpoint 为 2026-08-15 02:41:52（Asia/Shanghai），真实连续时长 13 小时 42 分 59 秒、823 个样本，随后系统日志于 02:42:42 记录 `Sleep Reason: Application API`，并持续低功耗至 11:35:47。该报告已自动归档为 `.interrupted.json`；重复守护按设计在唤醒后自动创建新 run，证明归档和自恢复链路有效，但中断窗口仍不能补算或拼接，TA-M5-009/TA-M9-003 不关闭。
- 当前完整重跑为 `2026-08-15T03-41-48-958Z-11072`，于 2026-08-15 11:41:48（Asia/Shanghai）从零启动；截至 12:56 已写入 76 个样本，单一共享订阅健康，接收/发出 2525/2525、重复 0、缺口 0、MonitoringGap 0、error 为 null。最早机器验收时间顺延至 2026-08-16 11:41:48；必须保持 Windows 不进入睡眠、休眠或关机，应用级持续执行请求不能覆盖用户或系统组件主动发起的电源切换。
