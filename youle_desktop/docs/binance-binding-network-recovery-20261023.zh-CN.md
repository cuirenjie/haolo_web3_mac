# 国内直连 Binance 绑定链路修复（2026-10-23）

状态：两处已复现缺陷的源码修复及本地回归完成；物理网卡直连下的真实账户接口可达性验证通过。未制作或发布安装包，未部署服务，未提交 Git，也未重启共用开发进程。

## 缺陷与修复

1. 账户服务原先从进入请求队列起计算 12 秒超时。行情占满 6 个执行槽时，绑定尚未发出账户请求就会超时。旧实现复现约 12,008 ms 后失败，账户直连和私有通道均为 0 次。
   - 同一个 governor 保持总并发上限 6，为账户保留 2 个槽；行情最多占用 4 个槽。保留共享的权重账本、冷却及优先级，不增加交易所额度。
   - 新增账户网络适配器，区分 30 秒排队上限和原有请求执行时限。请求获准执行时重新生成签名时间，避免排队使签名过期。
   - 账户校时请求不再与行情通道的同 URL 请求合并，避免绕过并发隔离后仍等待行情。
2. 自动路由原先收到直连响应头就清除 3 秒尝试期限。响应体卡住后，外层约 12 秒超时，未进入私有通道。旧实现复现约 12,013 ms，直连 1 次、私有通道 0 次。
   - 自动模式中的账户直连必须在尝试期限内读完整个响应体，超时或断流进入既有路由失败恢复流程，重新校时和签名后重试。
   - 418/429 在收到响应头时立即保留冷却信息并取消响应体；用户取消不触发回退；凭据和签名错误不作为网络故障重试。

## 回归证据

最终联合回归 **418 / 418 通过**，无失败、跳过或取消；类型检查、主进程及诊断脚本语法检查通过。覆盖本次网络修复，也包含另一会话的账户盈亏、API 客户端、共享传输和限流测试。

新增 `test/binance-account-network-recovery.test.mjs` 的 17 个用例包括：

- 6 个行情请求阻塞时，完整模拟绑定仍执行校验、`beforeSave` 和一次本地保存。
- 排队时间超过请求执行预算仍可成功，获准执行后签名保持有效，包括冷却切换私有通道。
- 排队取消和到期清理、账户与行情校时隔离、总并发保持 6、行情恢复运行。
- 实际本地 HTTP socket 的校时响应体卡住、签名响应体卡住及断流，均完成私有通道模拟绑定，并释放直连 socket。
- 429 响应体卡住、用户取消、明确 direct/gateway 模式的执行超时、-2015/-1022 不重试或保存。
- 实际 main 工厂函数接入账户适配器、保留槽位及收益日历通道。

另将既有 5 个账户出口恢复用例接入生产适配器。完整模拟绑定使用测试凭据、合成交易所响应及保存钩子，不代表真实邮箱验证码、生产凭据同步或真实账号绑定验收。

## 国内物理出口验证

使用 `scripts/check-binance-binding-network.mjs`，运行实际账户服务、网络 governor、路由器、许可客户端和端到端 TLS 私有通道。仅将外层 socket 显式绑定到 WLAN 的 `192.168.0.108`；保持证书验证，未修改 DNS、代理或系统路由。

Windows `Find-NetRoute -RemoteIPAddress 8.217.125.71 -LocalIPAddress 192.168.0.108` 返回 WLAN（接口 9）、下一跳 `192.168.1.1`。成功连接的来源地址全部为该物理地址。机器上的 TUN 仍在运行，本次只验证这些显式绑定物理出口的请求，没有把它描述为整机关闭 VPN 或另一台故障电脑的实测。

| 场景 | 实测结果 | 耗时 |
| --- | --- | --- |
| Haolo auth/config | HTTP 200 | 138 ms |
| 私有通道 ready | HTTP 200 | 44 ms |
| 自动模式、物理出口 | 直连 ECONNRESET → 私有校时 200 → 账户 401 | 813 ms |
| 6 个慢行情任务同时存在 | 直连 ECONNRESET → 私有校时 200 → 账户 401 | 1,588 ms |
| 直连响应体永不结束 | 3 秒尝试期限后 → 私有校时 200 → 账户 401 | 3,469 ms |

后两个场景分别注入本地慢行情任务和卡住的直连响应体，私有许可、网络和账户 HTTP 响应为真实请求。账户使用明确无效的占位凭据，401 / `BINANCE_AUTH_FAILED` 是预期结果，证明已到达账户接口；没有真实 Binance Secret、没有邮箱验证码发送或校验、没有生产绑定写入。真实账号在故障电脑上的最终绑定成功尚未验收。

结构化证据：`docs/verification/binance-binding-network-20261023.json`。本机详细测试日志：`.cache/binance-binding-network-20261023/regression-coexistence.log`。

## 本机复验

从 `D:/haolo_windows_web3` Git 根执行：

```powershell
$bindingTests = @(rg --files youle_desktop/test |
  Where-Object { $_ -match '(?:^|[\\/])(?:binance-.*|haolo-network-.*|system-proxy-fetch|trading-alert-security-performance|trading-expert-binance-rate-limit|youle-api-client|youle-api-service-transport)\.test\.mjs$' } |
  ForEach-Object { $_ -replace '^youle_desktop[\\/]', '' })
node youle_desktop/scripts/test.mjs @bindingTests
node youle_desktop/scripts/typecheck.mjs
node --check youle_desktop/src/main/main.mjs
```

直连探测使用已有 Haolo 登录态，仅在内存取 token，不刷新或保存会话。先核实物理网卡地址及对应路由，再运行（`--output` 的父目录须存在）：

```powershell
node youle_desktop/scripts/check-binance-binding-network.mjs `
  --physical-ip=192.168.0.108 `
  --session-file=C:/Users/joiec/AppData/Roaming/haolo_desktop/haolo-session.json `
  --output=youle_desktop/.cache/binance-binding-network-20261023/domestic-probe.json
```

## 与并行会话的范围核对

已只读核对“排查账户页今日盈亏显示为—”会话和当前差异。本任务修改账户 `service.mjs`、新增 `network-fetch.mjs`、网络路由器、请求 governor；`main.mjs` 只增加适配器导入、账户保留槽配置及两个 fetch 接线。

同一 `main.mjs` 中另一会话的 `onAccountPnl` 和 6 个收益字段保留。未修改该会话的 `snapshot-components.mjs`、`youle-api-client.mjs`、preload、收益 UI 或服务端预算代码；最终联合回归包含这些本地客户端改动。其他会话的版本、图表、SMT、发布记录及未提交文件也保留，未将它们纳入本任务交付范围。
