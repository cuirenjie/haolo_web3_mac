# Haolo 智能交易预警安全与性能验收报告

> 日期：2026-08-12  
> 适用实现：`src/main/trading-alerts/`、`src/renderer/trading-alerts-ui.ts` 及对应 IPC 装配  
> 结论：自动化专项门禁与 Windows 实机视觉验收通过；真实连续 24 小时长稳和真实灰度仍是发布前外部门槛。

## 1. 触发事实源与信任边界

- 实时触发使用主进程 Data Hub 提供的 OHLCV/行情事件、版本化外部字段及持久化画线坐标，通过 `TradingAlertEvaluator` 的确定性数学公式求值。
- 截图、DOM、主题、缩放和当前页面是否可见均不参与触发；截图只用于用户查看。
- 大模型只把自然语言编译为严格、版本化的 Alert DSL 草稿。Schema Validator、能力解析、模拟器和用户确认通过后才能建立监控；模型不在 Engine 热路径。
- Renderer 只通过经鉴权的窄 IPC 创建、编辑、暂停、恢复、删除、同步画线和订阅展示行情，不能调用原始 Evaluator、写入 TriggerEvidence 或执行任意代码。

## 2. 安全审查结果

| 检查项 | 结果 | 证据 |
|---|---|---|
| Prompt/密钥注入 | 通过 | 输入中的 API Key、token、secret、private key 模式在发给模型及持久化前脱敏；严格模型响应字段拒绝未知属性；返修中的上一轮响应同样脱敏、限长并明确按不可信数据处理 |
| 意图模型旁路 | 通过 | 画线、指标、价格、外部数据及复合条件全部先经只读无工具模型；客户端不再以关键词、正则或本地快速编译代替模型语义判断，本地只校验和确定性执行 |
| 模型协议异常 | 通过 | 最多三次携带精确错误路径返修，再请求模型生成最小澄清；仍异常或 Provider 故障时只保存无规则的可续接草稿，绝不放宽 Schema、猜测意图或创建监控 |
| 任意脚本/命令 | 通过 | 运行时模块无 `eval`、`Function`、shell、浏览器 DOM、截图或 `BrowserWindow` 热路径 |
| Schema/资源滥用 | 通过 | AST 深度/节点、字符串、context、市场、周期、数据需求和证据均有上限；非有限数值失败关闭 |
| IPC 越权 | 通过 | 所有 Trading Alert IPC 使用现有可信 WebContents sender 校验；preload 不暴露原始规则求值和证据写入 |
| Provider 恶意数据 | 通过 | Adapter Manifest 严格版本化；样本检查未来时间、延迟、空值、重复和覆盖状态；异常结果变为 unknown 而非触发 |
| 凭证泄漏 | 通过（当前公共 Provider） | Binance/Hyperliquid 首批 Adapter 均为公共只读行情，无凭证；UI 明示不得在聊天发送 Key/私钥；未来私有 Provider 必须走安全设置 |
| 重放/重复通知 | 通过 | eventId、triggerEventId、Store evidence 幂等和确定性会话消息 ID 联合去重；先原子落证据后通知 |
| 停机补触发 | 通过 | app/休眠/断网/Provider 空档只写 MonitoringGap；恢复清历史缓存、预热并建立新基线，不评估空档事件 |

专项命令：

```powershell
node --test test/trading-alert-*.test.mjs test/alerts-auto-tasks-navigation.test.mjs
```

2026-08-12 最近结果：预警完整专项 102/102 通过；意图编译文件 23/23、意图+Service 30/30 均通过，覆盖模型优先画线、MA 死叉、复合 MA+MACD、未知指标/非法参数精确返修、连续畸形响应、Provider 失败草稿、取消和并发隔离。

初始全仓门禁（单次、受控并发）：1901/1901 通过，`failed/cancelled/skipped/todo` 均为 0，总耗时 38.817 秒。加入长稳、Windows 视觉验收器、机器化 24h 判定、完整意图 DSL、全量模型优先编译、精确协议返修、可续接故障草稿和全链路 E2E 后，最新单次受控全仓门禁为 1964/1964 通过，`failed/cancelled/skipped/todo` 均为 0，总耗时 45.952 秒。TypeScript `tsc --noEmit` 与 Vite production build 均通过；生产构建仅有项目既有的大 chunk 提示，不是本功能构建失败。

端到端验证：`alerts:intent:live-smoke` 使用与客户端相同的只读 `gpt-5.6-sol`、Schema、`TradingAlertService`、模拟器、Store、Engine 和行情订阅，分别验证“当前 BTCUSDT 15m K 线触碰或双向突破唯一趋势线”“当前 BTCUSDT 4h MA5/MA20 死叉”“当前 BTCUSDT 1h MA5/MA20 死叉且 MACD DIF 下穿 0 轴”。三条场景均实际调用模型一次并生成合法 DSL，随后完成未来 K 线模拟、确认绑定、临时 Store 卡片落库、Engine `monitoring`、1 个逻辑订阅和 1 条物理行情订阅，最终均 `passed=true`。冒烟报告不再输出模型原文，只记录 requestId、响应长度和 SHA-256；模型调用继续采用 180 秒无活动超时、活动续期和同线程传输恢复，并可被同会话新指令取消。

实际开发客户端复核：重新启动后，主进程预警 Store 每 10 秒写入 Engine heartbeat，证明开发环境的确认→监控路径已启用；生产构建仍只接受显式功能开关。启动器、意图与 Service 的变更后专项 30/30 通过。

首批真实 Provider 验证：Hyperliquid 公共 Adapter 已成功读取 BTC 1h 的 5 根历史 K 线，并通过 WebSocket 收到一条 BTC 1m 实时更新；时间与 OHLCV 数值通过有限值、市场/周期和事件格式校验。该验证证明公开行情接入路径可用，不替代真实 24 小时长稳。

## 3. 容量与延迟基准

命令：

```powershell
node --expose-gc scripts/trading-alert-benchmark.mjs
```

环境：本地 Windows 开发机、Node.js v24.14.0、强制 GC 前后测量；场景为 100 张规则卡片共享一个市场/周期订阅。

| 指标 | 2026-08-12 结果 | 技术规格目标 | 判定 |
|---|---:|---:|---|
| 24 根已收盘 1h K 线逻辑求值 | 2,400 次 | 可完成 | 通过 |
| 物理 WebSocket 订阅 | 1 | 不随卡片线性增长 | 通过 |
| 历史请求 | 1 | 共享缓存 | 通过 |
| 启动耗时 | 24.27 ms | 无阻塞 Renderer | 通过 |
| 单事件 P50 | 5.48 ms | 参考 | 通过 |
| 单事件 P95 | 7.49 ms | < 100 ms | 通过 |
| 单事件最大值 | 8.37 ms | < 500 ms 收盘求值 | 通过 |
| 洪峰 | 200 事件 / 20,000 求值 / 6.659 s | 无崩溃、无重复 | 通过 |
| 洪峰吞吐 | 30.03 事件/s | 记录基线 | 通过 |
| 强制 GC 后堆增量 | 1.76 MiB | 无明显短测泄漏 | 通过（短测） |
| 重复触发 | 0 | 必须为 0 | 通过 |

本基准把 24 根 1 小时 K 线加速注入，证明了“24 小时等价事件量”的确定性、订阅共享和短测内存行为；它不等同于真实墙钟连续运行 24 小时。真实 24 小时 soak 必须在候选 Windows 构建上完成后才能关闭 TA-M5-009/TA-M9-003。

真实长稳的最终结论由 `pnpm alerts:soak:assess` 从完整逐分钟样本生成，不能只看进程退出码。验收器检查真实 24h 墙钟、95% 采样覆盖、95% 稳态订阅健康率、单一共享订阅、接收/发出一致、迟到率不高于 10%、零重复/缺口/误触发/空档、单核 CPU 不高于 50%、Heap/RSS 峰值不高于 256/512 MiB，以及排除最多 30 分钟预热后的 Heap/RSS 斜率不高于 1/4 MiB 每小时。JSON 和 Markdown 结论随原始报告一起留存，任一检查失败都必须修复并重新执行完整 24h。此前各轮均因 Windows 系统重启、显式关机或 Application API 主动低功耗而中断，checkpoint 与 launcher 以 `.interrupted.json` 留存，不能拼接参与验收；最新中断 run 连续 13 小时 42 分 59 秒后于 2026-08-15 02:42:42 进入睡眠。每 5 分钟重复触发且 `IgnoreNew` 的守护已在 11:35 唤醒后自动归档并从零恢复，证明故障恢复链路有效；应用级执行请求仍不能覆盖主动电源切换。当前 run `2026-08-15T03-41-48-958Z-11072` 于 2026-08-15 11:41:48（Asia/Shanghai）启动，最早只能在 2026-08-16 11:41:48 后运行机器验收。

## 4. 确定性与 shadow 对照

- 黄金向量覆盖 SMA/EMA/MACD/RSI/KDJ/ATR/CCI/ADX/BOLL/MOM/ROC，主进程与 Renderer 结果一致。
- 规则回放对相同输入产生相同 result/trace/inputHash。
- 模拟规划器产生合法 OHLCV 后，必须由生产 `TradingAlertEvaluator` 回放证明目标规则成立；无解和外部不可控字段失败关闭。
- 模拟路径从真实最后一根 K 线的 `closeTime` 开始，按所选周期连续生成；开盘等于上一根收盘，实体、上下影线、成交量和单根最大波动由最近历史 ATR、平均实体、平均成交量与 tick size 共同约束，不允许固定 ±12% 跳价。常见趋势/反转/目标跟随路径先确定性求解，再进入有界 beam；proof 仍只由生产 Evaluator 给出。
- Renderer 在动画前以 whitespace 数据预留全部未来时间点，视窗只覆盖近期真实行情与完整模拟区间，触发标注使用求解器返回的 `triggerBarIndex`。模拟边界为语义色小标签，不再绘制贯穿画布的竖线；显示层的缩放、主题和动画不参与触发计算。
- 主图真实 K 线与模拟 K 线均以 UTC 作为数据事实时间，并在 Lightweight Charts 显示层统一应用 `CHINA_TIME_OFFSET_SECONDS`；不得让任一独立 overlay 漏掉显示偏移。绘制前额外验证第一根模拟 K 线严格位于当前最后一根真实 K 线之后，过期模拟失败关闭并要求按最新行情重新求解，防止视觉错位误导用户。
- shadow Engine 会原子保存证据但不发用户通知；测试用相同 frames 离线重放，要求 `value === true` 且 `inputHash` 与 shadow evidence 完全一致。

## 5. 尚未关闭的发布风险

1. 在候选 Windows 构建上连续运行至少 24 小时，记录 CPU、工作集、堆、连接数、重连次数和重复 evidence；无持续增长才通过。
2. 真实小范围灰度保持默认关闭，验证诊断、回退和支持流程。
3. 灰度完成并获得明确发布授权后，才允许版本提升、安装包上传和公开开关。

## 6. Windows 实机视觉验收

2026-08-12 在 Windows、Electron 39.8.10、Chromium 142.0.7444.265 上对 production build 执行实际渲染截图，覆盖亮暗主题、100%/125%/150%、列表、详情、Revision 编辑器、错误态和加载态，共 14 张。

验收器检查页面存在、横向溢出、状态卡片、Evidence、Dialog、错误/加载状态、无关弹窗遮挡和卡片文字对比度；最终全部通过。亮色卡片对比度 17.74，暗色 16.14。首次截图发现内容较少时页面 flex 收缩，修复后完整重拍。证据见 `docs/qa/trading-alerts/windows-2026-08-12/README.md`。
