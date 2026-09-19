# 国内直连行情 Response.clone 异常排查（2026-09-19）

用户截图为 HYPE/USDT 币安永续 1 小时图，K 线空白并显示 `Response.clone: Body has already been consumed.`。本轮定位并复现了能产生相同错误的客户端响应生命周期缺陷，已完成本地源码修复；没有原始故障时刻的调用栈，因此不把复现等同于已追溯那次请求的全部网络状态。

## 原因

1. 客户端采用自动选路。无代理且 Binance 直连失败或较慢时，公共行情通过 `market.youle.pro`，共享网络传输使用 Undici 6.27.0 获取响应。
2. `binance-network-router.mjs` 的 `decorateRouteResponse` 添加选路诊断头时，原先通过 `new Response(response.body, ...)` 把原始数据流交给新响应，没有保留原始响应对象或取得原始流的读取锁。
3. Undici 对网络响应注册垃圾回收清理器。原响应被回收时，如果流尚未锁定或读取，清理器会取消流，即使另一个响应仍引用它。源码可见 [Undici 6.27.0 body.js](https://github.com/nodejs/undici/blob/v6.27.0/lib/web/fetch/body.js) 的 `streamRegistry` 及 [response.js](https://github.com/nodejs/undici/blob/v6.27.0/lib/web/fetch/response.js) 的 `fromInnerResponse`。
4. `BinanceRequestGovernor` 为请求合并调用 `response.clone()` 时，发现流已经被取消，抛出截图中的错误；公共行情服务随后将错误返回给图表。

这解释了错误为何与国内无代理环境相关：该环境更容易进入网关传输分支。问题的触发还依赖垃圾回收时机，不是每次请求都失败，也不局限于 HYPE。通常使用手工构造 `new Response(...)` 的单元测试没有覆盖真实 Undici 网络响应的回收清理行为。

## 修复

在添加诊断头之前，通过 `response.body.pipeThrough(new TransformStream())` 转交数据。管道立即锁定原始流，直到完成、错误或取消，避免原响应回收误取消仍由调用者使用的流。路由包装仍支持流式读取，空正文、原 HTTP 状态和诊断头均保留。

用户要求复查后，进一步复现并修复以下问题：

| 问题 | 最终处理 |
| --- | --- |
| 管道锁定后，被放弃的旧缓存/429/5xx 网关响应占用连接；单连接池的后续请求超时 | 在直连回退、竞争败方、迟到响应、取消和探测路径显式取消不用的正文；取消不等待其他 tee 读者，避免阻塞选路 |
| 收到响应头后截止时间和取消监听已清除，正文挂起时请求无法结束 | 请求调度器在原执行截止时间内读取完整有限 REST 正文，完成后才释放并发槽；默认 45 秒，主图/元数据现有 50 秒及其他行情 30 秒预算保留，排队不提前计时；设置 16 MiB 正文上限 |
| 自动选路竞争结束就断开父取消信号 | 以组合信号保留获胜线路的取消传播；失败方和迟到响应均清理 |
| 现货公共域名绕过请求调度器 | 将确切的 `data-api.binance.vision` 纳入现货预算、并发、合并和正文截止时间 |
| 同一公开请求的首个调用者取消会影响其他读者 | 合并请求使用独立控制器和读者计数；取消一个读者只结束该调用，全部取消才中止上游并解除合并占用 |
| 正文读取/JSON 解析失败返回成功并缓存 `null` | 将读取、解析和缓存纳入完整错误处理；失败不写入或覆盖缓存；保留可用旧缓存的明确降级标记，401/403 不用旧缓存掩盖；中断的错误正文仍保留 HTTP 状态和 Retry-After |

完整正文缓冲仅用于有限的 Binance REST 响应；模型流和 WebSocket 不经过此逻辑。独立使用公共行情服务时，其自身超时也覆盖正文读取和取消。

本轮只修改主进程响应包装，没有修改 UI、主题、服务器配置、登录信息或系统代理。

## 验证

- 修改前：本机真实 HTTP 服务返回合成 K 线，Undici 下载后经过原路由包装；强制垃圾回收后，未主动读取的 `bodyUsed` 从 `false` 变为 `true`，`clone()` 抛出与截图一致的错误。新增回归测试在修改前失败。
- 修改后：同一场景经历 20 次垃圾回收后仍可读取；两个并发调用只发出一次 HTTP 请求，两个响应各自得到完整 K 线和诊断头。
- Node 24.19.0 回归通过；独立隐藏 Electron 39.8.10 / Node 22.22.1 运行相同检查通过，不启动第二个业务客户端或使用真实账户。
- 第一阶段网络回归 89/89、复查时相关测试 40/40 通过，但没有覆盖上述遗留场景，不能作为链路完整验收。
- 最终新增故障恢复回归 19/19，通过本机真实 HTTP/Undici 单连接池验证被丢弃响应回收、正文超时、队列恢复、现货/合约、直连/网关竞争后的取消、两个共享读者的取消隔离、全部取消后的同 URL 重试、无效正文/旧缓存、401/403/429、响应大小限制、迟到响应释放，以及发起前取消不会发出网络请求或产生未处理的 Promise 拒绝。相关五个文件专项共 59/59 通过。
- Electron 39.8.10 / Node 22.22.1 隐藏进程执行同一组 19 个检查，19/19 通过；该检查使用实际主进程 Response/流实现，不改动运行中的业务客户端。最终 GC 检查也通过，20 次强制回收后两个读者仍可独立读取。
- 最终扩展网络、账户和预警回归为 150/151，无跳过。唯一失败是既有 `trading-alert-security-performance.test.mjs` 的 `tradingAnalysisTurnPolicy` 源码形状断言，已通过 `git show HEAD:youle_desktop/src/main/main.mjs` 验证修改前同样不匹配，涉及的业务代码和原测试均未改动。
- `pnpm run typecheck`、`git diff --check` 通过。

复现/验证命令（在 `youle_desktop` 目录）：

```powershell
node --expose-gc scripts/smoke-binance-response-lifecycle.mjs
node --test test/binance-response-lifecycle.test.mjs test/binance-response-recovery.test.mjs test/binance-network-router.test.mjs test/binance-request-governor.test.mjs test/binance-public-market-service.test.mjs
```

本地临时证据：`.cache/binance-response-final-regression.log`、`.cache/binance-response-electron-qa.stdout.log`、`.cache/binance-response-electron-recovery.stdout.log`。修复尚未提交、推送、打包或发布。运行中的开发客户端需要重启加载主进程源码；安装版需要包含本修复的新安装包。本轮未进行各省运营商实测，也不据此宣称所有国内网络问题均已解决。

## 同日后续状态

上述未提交/未重启状态记录的是本轮调查完成时的情况。后续又确认并修复生产 Redis 缓存 OOM、完整历史恢复及柱宽问题，网关已上线，开发客户端已重新打开；用户随后要求将两轮配套修复一起提交推送至 `dev`。完整后续记录见 [国内直连与历史恢复修复](binance-direct-history-repair-20260919.zh-CN.md)。安装包尚未发布。
