# 2026-09-17 Windows → macOS 融合后代码审查

关联任务：M2-020；模型恢复问题关联 M1-310。

> 后续状态：用户要求“彻底修复”后，R1、R2 已完成源码修复及本机验证，见文末“修复与回归验收”。以下审查结论保留修复前的事实和证据。

## 审查结论

审查本地 `dev@5a41998`，重新 fetch 确认 Windows `dev` 仍为 `2534b02474bc430d3aa91e4104bcd8883906bedd`。没有发现漏合来源提交或无法解释的冲突覆盖，但确认两个需要修复的运行问题。两项均可在 Mac 融合结果及 Windows 上游对应函数中复现，属于本轮引入的上游缺陷，不是漏 cherry-pick；本次仅审查，没有修改业务实现。

## R1 / P1：认证重置后网关保留已关闭的 fetch

- 位置：`src/main/main.mjs:6804` 的 transport 关闭/置空；`src/main/main.mjs:4444` 的网关网络函数缓存；`resetBinanceNetworkRuntimeAfterAuthChange` 未清空该缓存。
- 触发条件：当前应用曾初始化 Binance 网关和 App Server，随后重新登录、退出再登录，或走其他认证变化重置路径。
- 原因：`createBinanceGatewayNetworkFetch` 现在直接返回共享 `network.fetch`。认证重置重新创建 `binanceGatewayClient`，却保留 `binanceGatewayNetworkFetch`；后者闭包仍绑定已被 `close()` 的旧 transport，即使新的 `haoloNetworkTransport` 已创建也不会恢复。
- 影响：网关 REST、获取行情 WS 票据及 Binance 私有接口 permit 都报 `Haolo network transport is closed`。依赖国内网关的功能将持续不可用，普通重试无效，重启应用才能清除旧缓存。
- 复现：执行实际主进程 getter、两个认证重置函数、实际网关客户端和新 transport；认证前请求成功，重置后三条调用路径均失败且没有发出上游请求。仅在验证 harness 清除旧缓存后，请求立即恢复。
- 建议：把网关 fetch 缓存纳入共享 transport 的统一生命周期，并覆盖“使用行情及聊天后重新登录，再请求 REST/WS 票据/private permit”的回归。

## R2 / P2：一小时模型回退覆盖图片和视频创作的 GPT 选择

- 位置：`src/renderer/main.ts:54759` 及 `src/main/main.mjs:18545`。
- 触发条件：Sol 临时故障已启用一小时 DeepSeek 恢复窗口，随后用户进入图片或视频创作。
- 原因：Renderer 的 `mediaCreationExecutionModelOption` 已为媒体选择支持工具的 GPT，紧接着 `withAnalysisModelRecoveryPolicy` 又将 Sol 覆盖为 DeepSeek；Host 对请求重复应用相同策略，随后现有媒体守卫明确拒绝 DeepSeek。即使请求明确指定 Sol，也会被该窗口重新覆盖。
- 影响：恢复窗口内图片和视频创作报“图片和视频创作需要使用支持工具调用的 GPT 执行模型”，无法启动；UI 选择图片/视频生成模型不能解除根执行模型的拦截。
- 复现：执行实际 Renderer 模型选择函数和业务模型池选择器，再执行 Host 原有策略/媒体守卫代码。窗口内图片、视频两类均被覆盖并拒绝；无窗口时同一 Sol 请求通过。
- 建议：将任务模式和输入能力纳入恢复策略，媒体任务保留可用 GPT 执行模型；Renderer、startThread、sendMessage 需使用一致规则，不能只绕过媒体守卫。

## 融合完整性

- `526acbb..2534b02` 的 13 个来源哈希均出现在本地 `cherry-pick -x` 记录中；按实际来源哈希核对二进制提交，未被 range-diff 对同名二进制提交的相似度配对误导。
- 121 个来源文件中 93 个与上游最终 blob 一致，28 个存在有意的 Mac 配置、已有修复、历史记录或本轮兼容差异。
- 逐提交 range-diff 中版本号、pnpm 既有依赖、Mac 平台头/窗口配置、有限恢复和旧测试断言的差异均已对应到本地基线或验收补修；未发现业务提交被遗漏。
- 保留 Mac 0.1.168、0.144.1 双架构运行时、打包配置和更新渠道；新增 socks/undici 依赖已包含。Mac R1/R2 网络修复、账户缓存隔离、绘图和日历代码未被合并覆盖。
- `5a41998` 的 Mac 模型目录兼容和只读分析恢复交接补修继续通过定向验证。本次未发现这两个补修引入的额外可确认回归。

## 验证与边界

- 本次定向回归：179 项通过，0 失败、0 跳过，覆盖选路、真实本地 TLS/代理/WS、模型恢复与策略、历史恢复、上下文压缩、原生 Mac 模型切换/403、媒体选择和模型工具转发。
- R1、R2 的故障验证不属于“179 项通过”的测试集合；复现脚本刻意断言当前错误行为，并分别在 Mac 与上游函数上得到相同结果。现有测试缺少认证重置后的 transport 缓存和活动恢复窗口叠加媒体模式的组合场景。
- 上一轮 3016 项桌面通过/6 平台跳过、网关 54/54、类型及构建结果仍是已有基线，本次没有无差别重跑全量或重新打包。
- 所有故障验证均用本地 fixture、测试凭据和注入传输，没有真实账户、付费模型调用、生产写请求或用户客户端重启。
- 本次仅更新审查文档和任务台账；两项缺陷尚未修复，未提交、推送、打包或部署。

证据位于 `.git/windows-sync-review-20260917-` 前缀：`integrity.json`、`range.diff`、`platform.diff`、`main.diff`、`targeted.log`、`repros.mjs`、`repros.log`、`upstream-repros.log`。

M1-304 原设备根因、M2-020 真实登录与香港转发验收，以及 M2-013 多 EIP/三网/72 小时验收保持原外部依赖状态。

## 修复与回归验收（2026-09-17）

基于 `dev@5a41998` 修复两项根因，并补齐相关调用路径。先增加回归：修复前 26 项中 5 项失败，分别为 4 个认证生命周期场景和 1 个恢复窗口叠加媒体模式场景；修复后定向 71/71 通过。回归直接执行实际主进程/Renderer 函数和网络客户端，不复制待验证的策略实现。

- **R1 已修复：** 新增统一 `resetHaoloNetworkTransport`，先清除网关客户端、网关 fetch、共享 transport、Haolo 服务 fetch 缓存，再关闭旧实例。认证重置在未创建 App Server 时也完整执行；App Server 停止失败不阻止清理。退出应用复用同一入口，但放在最终上报和客户端停止之后，避免收尾请求被提前中断。回归连续重置三次，验证新凭据、新 transport、REST、WS 票据、private permit，旧 transport 必须拒绝请求，写入没有被重放；另覆盖自带 `close` 的网关 fetch。
- **R2 已修复：** 共享模型恢复策略接收媒体模式上下文；Renderer、`startThread` 和 `sendMessage` 在窗口内保持兼容 GPT。旧 DeepSeek 选择/别名恢复为 Sol，同时清除其固定 max 和能力元数据。既有合法 GPT 选择保留，普通文本和只读盘面分析继续遵守一小时 DeepSeek/max 规则，媒体发送守卫仍保留。
- **媒体失败续跑已对齐：** 实际发送时按目标线程保存本轮恢复选择；同线程 `thread/resume` / `turn/start` 使用原 GPT Provider 和推理档位，保留最多三次、取消、去重、鉴权失败和副作用对账约束。新普通任务重新使用默认恢复策略。通知携带真实模型，简体/繁体/英文提示不再错误声称媒体任务切换到 Astra。

最终验证：

| 检查 | 结果 |
| --- | --- |
| 桌面全量（最终源码） | 3038 项，3032 通过、0 失败、6 平台跳过 |
| 网关全量 | 54/54 通过 |
| 定向认证/媒体/恢复回归 | 71/71 通过 |
| 类型检查与生产构建 | 通过；Vite 191 modules，保留既有大 chunk 提示 |
| 原生 Mac 模型切换与 403 行为 | 包含在桌面全量中，实际运行时 + 本地模型 fixture 通过 |
| Electron 41.10.2 网络冒烟 | 8/8：DIRECT/TLS/Host/SNI、HTTP CONNECT、SSE、行情 WS、写请求恰好一次、代理失败不直连、移除代理恢复、拒绝不可信证书 |
| 主进程语法与差异检查 | 通过 |

新测试文件为 `test/network-auth-reset.test.mjs`、`test/media-model-recovery.test.mjs`，并补充媒体模式、恢复 RPC 和恢复协调器测试。证据位于 `.git/windows-sync-fixes-20260917-` 前缀：`before.log`、`focused.log`、`full.log`、`final.log`、`gateway.log`、`typecheck.log`、`build.log`、`electron-smoke.mjs/log/json`。

本轮作为本地修复提交交付，未推送、打包、部署或重启现有客户端；仍为 0.1.168，现存安装包不包含本次源码。所有故障注入使用本地 fixture 和测试凭据，未调用真实付费模型。真实账号及生产网络验收仍按原 M2-020/M2-013 边界保留。
