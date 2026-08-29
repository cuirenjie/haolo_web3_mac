# 好咯桌面端“思考后无输出”事件分析与修复建议

- 报告日期：2026-07-12
- 涉及版本：好咯桌面端 0.1.147、Codex CLI 0.144.1
- 建议优先级：P0（静默失败兜底）+ P1（底层触发治理）
- 当前状态：已定位故障边界；生产后端已只读核查，未修改或重启服务

## 1. 结论摘要

客户端需要修复。

本次问题虽然只在个别用户、特定时序下出现，但它发生在核心消息发送链路，并造成最差的用户体验：消息没有得到回复，客户端却把任务表现为正常结束，同时不展示任何错误或重试入口。

目前可以确认：

1. 两次失败 turn 都在本地正常创建，约 85.8～85.9 秒后空结束。
2. rollout 中没有任何 assistant 消息、推理、工具调用或最终回答，`last_agent_message=null`。
3. 第二次失败期间，生产 Nginx、应用日志、`usage_logs` 和 `ops_error_logs` 中都没有对应的 `gpt-5.6-sol` 请求；故障发生在生产网关之前的客户端本地前置链路。
4. 同一账号、Key 和机器在相邻时间能够正常完成 Terra 和 Sol 请求，生产后端没有鉴权、额度、限流或模型路由错误。因此不是账号整体不可用，也不是 Sol 在服务端全局不可用。
5. 两次空 turn 都与同一客户端的另一条长 Agent 任务重叠。该条件高度相关，但现有证据尚不足以断言“app-server 天生只能全局运行一个任务”。Codex root thread 本身支持并行，具体卡点仍可能位于桌面集成调度、连接复用、CLI transport、工具初始化或本机代理/安全软件。
6. 客户端当前忽略或隐藏失败信息，直接造成“思考中消失、页面无任何内容”的表象。

即使最终底层触发点属于 CLI、网络或代理，客户端也必须修复错误处理、诊断日志和用户反馈；这些修复不依赖最终根因，且能消除静默失败。

## 2. 用户影响

### 2.1 直接影响

- 用户消息对应的 turn 没有产生可见回复。
- 用户不知道消息是否发送、是否执行、是否应该重试。
- 重试可能再次撞上相同条件，形成“该账号一直不可用”的感受。
- 客服和研发只能依赖用户手动拷贝 rollout，现有 `app-server.log` 无法还原 turn 状态和前置阶段。

### 2.2 受影响用户特征

该问题不是所有用户必现，需要更窄的触发组合：

- 使用 0.1.147 / CLI 0.144.1；
- 使用 Sol，或触发当前本地前置路径；
- 同时存在长时间运行的 Agent 请求、后台任务或外部渠道任务；
- 在另一个 thread 中继续发送消息；
- 可能叠加本机代理、VPN、安全软件或连接复用差异。

反馈用户的旧 Terra 会话缓存上下文约 216K～218K token，相关请求首 token 分别等待约 108 秒、162 秒和 65 秒；当天最长一次首 token 等待约 568 秒。超大上下文和慢首 token 会显著拉长任务重叠窗口，因此该用户比普通短问答用户更容易稳定触发。

## 3. 事件时间线与证据

### 3.1 第一次失败

- Session：`019f54ed-deb0-7ce0-ac53-617ad8a4ba11`
- Turn：`019f54ed-df18-7f60-9df1-e42d27e0d305`
- 模型：`gpt-5.6-sol / low`
- 时间：14:05:03.133～14:06:28.881
- 时长：85.751 秒
- 结果：`task_complete`，但 `last_agent_message=null`
- rollout 仅 11 行，用户消息之后没有任何模型事件

同一客户端在该时间段存在另一串连续 Sol 调用。后端无法把这些调用精确归属到具体本地 thread，因为 session/turn ID 未透传；但失败 rollout 本身没有模型事件，说明失败的新 turn 没有形成可持久化的模型响应。

### 3.2 中间重启

用户提供的 app-server 日志显示，北京时间 14:41:07 启动了新的 app-server，并使用新端口。因此第二次故障不是 14:05 旧 turn 跨完整重启继续运行。

同时需要注意，客户端右上角 `X` 当前执行的是隐藏到托盘，不是退出；再次双击快捷方式只会唤醒单实例进程。只有托盘“退出”或完整进程终止才会停止 app-server。

### 3.3 第二次失败

- Session：`019f5535-5f20-7f01-829f-7baa79479c3f`
- Turn：`019f5535-5f8d-77f1-9362-1e4acd7f40eb`
- 模型：`gpt-5.6-sol / low`
- 时间：15:23:09.074～15:24:34.988
- 时长：85.917 秒
- 结果：`task_complete`，但 `last_agent_message=null`
- 生产端没有该客户端对应的 Sol HTTP 请求、usage 或 error 记录

同一客户端当时有 Terra Agent 链运行：

- 15:20:53～15:23:42，HTTP 200，首 token 约 162 秒；
- 15:24:18～15:25:26，HTTP 200，首 token 约 65 秒。

因此用户所说的“新任务第一条消息”并不等同于“整个客户端处于空闲状态”。第二次重启后，新的长任务条件已经再次出现。该任务可能由用户手动触发、本地自动任务或外部消息渠道触发；仅靠生产日志无法区分来源。

## 4. 根因分层

### 4.1 已确认的直接故障

新 Sol turn 在客户端本地创建，但在空结束前没有形成到生产网关的对应请求。故障边界位于本地 app-server/CLI 到生产网关之间。

### 4.2 高相关触发条件

两次失败均与另一条长 Agent 任务重叠。超大上下文、慢首 token、自动任务和跨 thread 操作会放大触发概率。

该相关性支持增加客户端并发保护和全局运行状态提示，但在完成无并发 A/B 复现前，不应将根因写成“共享 app-server 全局只能运行一个任务”。

### 4.3 已确认的客户端产品缺陷

1. `turn/completed` 处理没有完整展示 `turn.status` 和 `turn.error`，任务结束时直接清除 busy 状态。
2. hydration 检测到“本轮没有收到模型回复”后，将提示写成 system item。
3. 所有无附件 system item 又被统一隐藏，导致用户看不到失败、空回复和恢复失败提示。
4. `app-server.log` 主要记录启动信息，没有记录每个 turn 的状态、错误、item 数量、首事件耗时和请求阶段；界面提示“详细错误已记录”与实际不符。
5. 右上角关闭按钮仅隐藏到托盘，但界面没有明确提示后台任务仍会继续，容易让用户误以为已经重启。

相关代码位置：

- `youle_desktop/src/renderer/main.ts:14293`：`turn/completed` 终态处理。
- `youle_desktop/src/renderer/main.ts:12729`：空回复 hydration 警告。
- `youle_desktop/src/renderer/main.ts:37579`：`shouldHideChatItem()` 隐藏无附件 system item。
- `youle_desktop/src/main/main.mjs:2270`：app-server 按 workspace 复用。
- `youle_desktop/src/main/main.mjs:8031`：窗口关闭实际转为隐藏到托盘。
- `youle_desktop/src/main/main.mjs:497`：单实例进程只唤醒已有窗口。
- `youle_desktop/src/main/app-server-client.mjs`：RPC 超时和 app-server 生命周期。

### 4.4 尚未确认的内部卡点

现有日志无法进一步区分：

- 桌面集成的跨 thread 调度或状态路由；
- CLI transport 或连接池复用；
- DNS、TCP、TLS、代理/VPN或安全软件；
- MCP/工具初始化等待；
- 自动任务或外部渠道任务与普通聊天的资源竞争；
- turn 被 interrupted、failed 或以 completed-with-no-output 结束。

这些未知项不影响客户端先修复静默失败和诊断能力。

## 5. 修复建议

### 5.1 P0：最近补丁版本必须完成

#### A. 空 turn 必须显示可见错误

当 `turn/completed` 后当前 turn 没有任何 agent message、tool item 或明确结果时：

- 先按 250ms、1s、3s 等有限次数重新读取持久化历史，排除写入延迟；
- 重读后仍为空时，不得按普通成功完成处理；
- 显示可见错误卡片，例如“本轮未收到模型回复，请重试”；
- 提供“重试”和“复制诊断编号”；
- 不使用会被 `shouldHideChatItem()` 过滤的普通 system item。

#### B. 正确处理 turn 状态和错误

- 按 `params.turn.status` 区分 `completed`、`failed`、`interrupted` 和 `inProgress`；
- `failed` 时展示 `turn.error.message`、`codexErrorInfo` 中可安全显示的信息；
- `interrupted` 与失败、用户主动停止分别展示；
- 协议 `error` 通知最终不再重试时必须转成可见错误。

#### C. 增加 turn 级诊断日志

每个 turn 至少落盘以下脱敏字段：

- 客户端提交时即生成的 `client_request_id`；
- app-server instance ID、JSON-RPC request ID，以及可获得时的网关 trace/request ID；
- thread ID/turn ID 的哈希；
- 模型、effort、客户端版本和 CLI 版本；
- `turn/start` 发起及返回时间；
- 第一个 item/agent delta 时间；
- `turn/completed.status`、error 类型、HTTP 状态（如有）；
- duration、item 数量、是否存在 agent message；
- transport/error 通知及 `willRetry`；
- 是否存在其他 active turn、自动任务或外部渠道任务。

#### D. 提供受控的任务重叠保护实验

在内部卡点完全确认前，可先采用可回退的保护：

- 通过灰度开关测试：同一 workspace 已有长任务运行时，新 thread 显示“排队中”，或继续并行但记录完整链路；
- 不应在尚未证明共享 app-server 并发能力有缺陷前，直接对所有用户永久全局串行；
- 达到排队超时时显示可见错误，不得空结束；
- 记录 A/B 指标，确认串行化是否显著降低空 turn。

该方案是风险缓解，不应被描述为最终根因修复。

### 5.2 P1：底层触发治理

- 为桌面端、CLI 与生产网关建立统一关联 ID。
- 对“单任务、两个 root thread 并行、自动任务与前台聊天、外部渠道与前台聊天”做受控故障注入。
- 只有压测证明共享实例会丢失出站请求后，再选择 workspace 排队、每任务隔离 app-server 或修复/升级 CLI transport。
- 增加 provider 生命周期事件：请求构造完成、连接开始、TLS 完成、请求已发送、收到响应头、收到首个 SSE、流结束。
- 提供一键导出脱敏诊断包，包含客户端生命周期日志、app-server 日志、对应 rollout、版本及代理/VPN配置摘要。

### 5.3 P2：体验与性能优化

- 在任务列表中显示所有后台运行中的任务及来源（手动、自动任务、外部渠道）。
- 关闭窗口时若仍有任务运行，明确提示“应用将留在托盘，任务继续执行”。
- 提供“真正退出并停止全部任务”。
- 对 200K token 以上长上下文更早触发压缩或给出性能提示。
- 评估每 thread 独立 app-server 与共享 app-server 的资源、稳定性和并行收益。

## 6. 不建议的处理方式

- 不建议只延长“思考中”时间；请求未出站时，延长时间只会延迟失败。
- 不建议默认自动重试所有空 turn；如果后台实际执行过工具或产生副作用，自动重试可能重复操作。应优先提供用户确认的重试。
- 不建议把问题归因于安装目录、账号额度或生产模型路由；现有证据不支持。
- 不建议通过删除全部 `%APPDATA%` 作为常规修复，这会破坏用户历史和配置且掩盖真正问题。

## 7. 测试与验收标准

### 7.1 必测场景

1. Sol/Terra 单任务正常请求。
2. 一个 thread 模拟 3～10 分钟首 token 延迟，同时在另一个 thread 发送。
3. 自动任务或外部渠道任务运行时发送普通聊天。
4. `turn/completed(status=failed)` 并携带 error。
5. `turn/completed(status=completed)` 但 items 为空。
6. `interrupted`、用户主动停止、连接断开和重试耗尽。
7. DNS失败、TLS失败、代理断连、HTTP 401/403/429/5xx。
8. 点击 `X` 隐藏后重新打开，以及托盘“退出”后重新启动。
9. 200K token 以上长上下文与 compaction。

### 7.2 验收指标

- 任何 turn 都不能以“思考消失且无可见结果”结束。
- 空结果或失败完成后 2 秒内显示可见状态。
- 100% turn 在日志中具有 start、first-event 或 no-first-event、complete/error 闭环。
- 诊断日志不得包含 API Key、完整用户提示词或敏感响应正文。
- 用户确认重试不会产生重复工具副作用。
- 并发/长任务压力测试中，第二条消息要么正常执行，要么明确排队/失败，不能静默丢失。
- 故障注入累计不少于 1,000 次，静默空白率必须为 0。
- 任一失败案例都能依靠 `client_request_id`、turn ID 和 trace ID 还原完整链路。

## 8. 临时客服处置

在补丁发布前，建议客服指导受影响用户：

1. 托盘右键选择“退出”，确认 `haolo_desktop.exe` 和 `haolo_ai.exe` 已结束；不要只点右上角 `X`。
2. 暂停本地自动任务和外部消息渠道。
3. 重开后只创建一个全新任务，分别测试 Terra 和 Sol。
4. 若空闲状态下仅 Sol 失败，关闭代理/VPN或安全软件后复测。
5. 仍失败时收集最新 rollout、`logs/app-server.log`、`auto-tasks.json` 及故障精确时间。

## 9. 发布建议

该问题建议分级处理：P0 先消除静默失败，P1 再定位和治理底层触发。最近补丁版本至少交付：

1. 可见错误；
2. 正确处理 turn status/error；
3. turn 级诊断日志；
4. 长任务重叠时的明确排队或失败状态。

在没有完整定位内部前置卡点前，也不应继续让空 turn 被当作普通完成。上述四项可以立即降低用户损失，并为后续准确修复提供证据。
