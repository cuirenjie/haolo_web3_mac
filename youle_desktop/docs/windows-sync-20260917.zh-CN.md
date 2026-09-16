# Windows → macOS 增量融合记录（2026-09-17）

关联任务：M2-020；引入 M2-021、M1-304～M1-310 的上游实现。M2-013 原生产验收阻塞保留。

## 来源与保护

- Mac 基线：`dev@5a6e577e54f4e14e316bfaedf271b4f77cbd77be`，开始时工作区干净。
- Windows 来源：`526acbb..2534b02474bc430d3aa91e4104bcd8883906bedd`，13 个提交、121 个文件。
- 两个仓库没有共同祖先，沿用 `cherry-pick -x` 逐提交增量移植；每个来源哈希均写入对应本地提交。
- 保护分支：`codex/backup-before-windows-sync-20260917`。
- 交付前再次核对远端：Windows `dev@2534b02`，Mac `origin/dev@5a6e577`。
- 完整性检查：13 个来源哈希全部可追溯；121 个来源文件中 93 个与 Windows 最终 blob 一致，28 个保留 Mac 差异、历史记录及本轮兼容补修。

| 来源提交 | 本地提交 | 内容 |
| --- | --- | --- |
| `73e2ae3` | `f24337f` | feat(network): route mainland direct traffic through Hong Kong acceleration |
| `40f6275` | `0ca4de2` | fix(desktop): harden analysis fallback and thread history recovery |
| `87d1db5` | `06d8daa` | fix(network): keep account and model traffic on ordinary origins |
| `5f3c9fa` | `6d5c9e6` | chore(desktop): refresh Chrome native host binary |
| `f40c176` | `1bd14a0` | fix(network): reconnect live market streams when proxy routes change |
| `3e27a4e` | `8fab3a5` | fix(network): use ordinary Hong Kong BGP trial endpoints |
| `277632d` | `d126a9b` | fix(desktop): restore task history and fail over analysis to GPT-5.5 |
| `da3e44e` | `571ea2b` | feat(desktop): keep GPT-5.5 recovery active for 24 hours |
| `e2269ad` | `9c812de` | fix(network): route all built-in model transports through Hong Kong policy |
| `b44b4ca` | `7407247` | docs(network): record accepted ordinary Hong Kong model routing |
| `a6b9757` | `db0c418` | fix(desktop): stabilize model recovery and unify Astra display |
| `2bc92db` | `c194dbf` | fix(desktop): shorten global model recovery window to one hour |
| `2534b02` | `26e9259` | chore(desktop): refresh Chrome native host binary |

## 最终集成行为

账户请求使用原站点；内置模型和 Binance 行情按上游固定白名单、实际系统代理和地区策略选择香港普通 BGP 路线，保持逻辑 Host/SNI、TLS 证书验证与请求权限。行情代理或网络变化触发旧连接退订与新票据重连，模型流不按行情策略重放。媒体脚本和 MCP 模型调用接入进程内 loopback 转发，持久化凭据与媒体任务 URL 规则保持。

最终备用模型为 `deepseek-flash` / `deepseek` / `max`；一小时恢复窗口跨任务与重启保留，到期下一次真实任务恢复 Sol，主模型再次失败才重新激活。前几个提交中的 GPT-5.5/24 小时是历史过渡，最终已退役 GPT-5.5 并迁移旧模型选择。上游 UI 将 `deepseek-flash` 显示为 GPT-6 Astra，该显示映射不代表实际请求改成原生 `gpt-6-astra`；请求和诊断保留真实 ID。

新增任务历史索引恢复、压缩后对账与失败诊断，绘图失败保留已验证分析结果。Mac 窗口/Dock/麦克风权限、0.144.1 双架构运行时、Web3 更新渠道和架构回退、账户身份和认证隔离缓存继续保留；现有 R1/R2 探测冷却与迟到连接错误归因、绘图、日历周期及行情快照修复未被覆盖。Mac 应用版本保持 0.1.168，打包和签名配置不变。

## Mac 兼容补修

1. 恢复边界：保留每模型 180 秒硬截止时间、单次原会话尝试与清理语义；原会话的重试耗尽不再使外层只读模型切换误判为永久失败。超时允许交给 Provider，仍最多两次备用尝试；取消、403、鉴权、权限、实际副作用和无法安全清理继续拒绝切换。新增七项执行实际主进程恢复函数、分析入口和 Provider 的回归，修改前 4 失败/3 通过，修改后 7/7。
2. 真实运行时目录：Mac 0.144.1 没有原生 Astra 条目，上游要求该条目导致托管目录整体构建失败，DeepSeek max 元数据也未生效。Mac 仅允许缺少原生 Astra，不伪造该模型元数据，仍严格要求 Sol/Terra/Luna；Windows 继续要求 Astra。DeepSeek 正式 ID/max/工具契约及原始元数据哈希保持。新增跨平台目录回归，并启用原先仅 Windows 运行的两项真实 Mac 原生模型测试。
3. 翻译和测试适配：补齐两条新增本地降级后缀的英文翻译；媒体脚本测试在 macOS 默认使用 python3；退役模型的计划测试去掉 GPT-5.5，继续验证 Sol/Terra/Luna；两处旧源码形状断言纳入 modelId 参数。
4. 历史烟测：按宿主架构选择 Mac 二进制，保留 paginated 索引故障注入路径；Mac legacy 运行时检查原线程、正文、元数据、重启和追问完整性，不伪造其不具备的 paginated 故障。测试子进程清理增加有界 SIGKILL 兜底，仅作用于自身创建的临时进程。

## 验收

| 检查 | 结果 |
| --- | --- |
| 桌面全量最终验收 | 3022 项：3016 通过、0 失败、6 平台跳过 |
| 网关全量 | 54/54 |
| 模型恢复与文案定向 | 38/38；另有兼容批次 29/29 |
| 真实 Mac 模型及目录批次 | 40 项：39 通过、1 Windows 沙箱测试跳过 |
| TypeScript | 通过 |
| Vite 生产构建 | 191 modules，通过；保留既有大 chunk 提示 |
| Mac 运行时 | 0.144.1 arm64/x64、rg、哈希和签名校验通过 |
| Electron 41.10.2 本地网络 | 8/8：DIRECT、HTTP CONNECT、模型 SSE、行情 WS、写请求单发、失效代理拒绝、代理移除恢复、无效证书拒绝 |
| Mac legacy 历史烟测 | 4/4：原线程恢复、历史读取、冷重启、携带原上下文的追问；仅两次本地模型 fixture 请求 |
| 语法与差异 | 95 个变更 JavaScript/Python 文件通过；`git diff --check` 通过 |

原生模型测试实际启动捆绑 Mac 运行时：Sol 过载后在同一任务切换 DeepSeek max，完成合成行情工具往返，并恢复 Sol；403 恰好一次请求且宿主不追加恢复。所有请求使用本机 fixture 和测试凭据，未使用用户真实模型额度、账户或生产写请求。

最终全量的六项跳过分别为 Windows 沙箱、Chrome Native Host、Windows 插件探测、Windows UTF-8 和两个 Windows paginated 历史运行时场景；Mac legacy 历史另外通过上述真实运行时烟测。

首轮桌面 3014 项有 6 项失败，分别为英文缺漏、退役模型 fixture、两项 python 可执行名和两项旧源码断言；修复后全量 3021 项 3013 通过、8 平台跳过、0 失败。进一步启用真实 Mac 模型测试发现目录缺失/effort 为空，已修复并复测。历史烟测首轮揭示 legacy/paginated 差异，已按真实运行时语义兼容；全部失败日志保留，不把初次失败或上游 Windows 验收算作 Mac 成功证据。

证据均在 `.git/windows-sync-20260917-` 前缀：`integrity.json`、`range-diff.txt`、`main-platform.diff`、`install.log`、`handoff-before.log`、`related-tests.log`、`compatibility-tests.log`、`desktop-tests.log`、`desktop-final.log`、`desktop-accepted.log`、`native-model-tests.log`、`native-model-fixed.log`、`typecheck-accepted.log`、`build-final.log`、`gateway-tests.log`、`mac-runtimes.log`、`electron-smoke.log/json`、`history-smoke.log`、`history-final.log` 和 `syntax.json`。

## 交付边界

本轮仅融合源码、补修 Mac 兼容、测试及本地提交；没有推送远端、更新安装包、重启用户正在运行的客户端或修改部署。现存 0.1.168 DMG 仍为此前历史产物，不包含本次源码。香港生产线路、真实登录 Binance REST/WS/CONNECT、Hyperliquid 转发以及 M2-013 多 EIP/三网/72 小时验收保持原外部验收边界。
