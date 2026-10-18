# M2-027：Binance 行情限流归因、修复与验证

日期：2026-10-18。范围：客户端与公共行情网关源码、回归及只读真实行情核验。用户要求暂不打包发布；本次未部署网关、未切换生产、未重启用户客户端、未提交 Git。

## 1. 核查结论

本次取得的请求日志与活动网关指标指向 **Haolo 公共行情网关自身的请求预算限制**，不能将所有倒计时都归因于 Binance 封禁。

- 本机日志存在 `route=public-gateway`、`origin=gateway_downstream` 的合约 K 线 HTTP 429，以及带旧数据返回的 ticker 请求。一次 ticker 样本的单用户剩余额度仍为 283，提示可能是共享出口预算不足，但旧版未报告具体额度层级，无法据此单独定案。
- 活动容器在 `2026-10-18T15:16:07Z` 的累积计数：`downstreamRateLimited=97,247`、`upstreamAdmissions=1,912,744`、`upstreamRateLimited=0`、`upstreamCooldownHits=0`。相邻观察下游限流由 96,552 增加到 97,247。这个统计范围内没有记录到 Binance 上游限流。
- 生产合约共享预算为 1,440 weight/min，默认用户预算 300 weight/min。分钟早期 Redis 样本为 302/1,440、33 个用户，另一样本为 123/1,440、13 个用户；这些瞬时样本不是额度耗尽的直接证据。
- 截图没有对应的精确请求时间/请求标识，不能把“31 秒”唯一对应到某一个请求。新增 `limitScope` 和三个分类指标后，可直接区分入口次数、单用户权重、共享出口权重。

Binance 限额仍按具体接口权重和出口 IP 约束，本次没有提高配额、换 IP 规避限制或关闭熔断。接口依据见 [Binance USDⓈ-M general information](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info) 和 [market data REST](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)。

## 2. 实际运行版本

核查工作目录和 Git 根目录均为 `C:\Users\潘艳芳\Documents\ChatGPT\haolo_windows_web3`。本次末次记录 HEAD 为 `792500525716764e6d3f58d92eb6436714623b42`；工作区包含多个会话的未提交变更，并非纯净 HEAD 快照。

| 对象 | 实际观察 |
| --- | --- |
| Windows 开发进程 | `haolo_desktop_dev-53803dbe241d.exe`，PID 46072，23:03:44 +08 启动，程序位于本仓库 `youle_desktop/node_modules/electron/dist` |
| 客户端源码版本 | `0.1.181`；Electron `39.8.10`；运行时目录 `C:\ProgramData\haolo_desktop-runtime\0.1.181` |
| 活动公共网关 | `haolo-binance-gateway-53badfa`，2026-10-14T12:33:22Z 启动，restart count 0 |
| 活动镜像 | `sha256:ea633cabeda0310a620c6fa7854300e51ea72994d2f22f52b0586779624cef13` |
| 实际启动入口 | `/workspace/services/haolo-binance-gateway/src/server.mjs`，容器无源码挂载 |

活动容器内 `binance-rest.mjs` SHA-256 为 `fad1c38d04beafa904d1d4589aa682aa22e14038623bbf8227f87a812de5528d`，`cache.mjs` 为 `cfae592e1cfa724338cc5cc4ec700bea6d68ef523980a295e6dcff84242c6158`，与本次修改前相应文件一致；`public-server.mjs` 和 `config.mjs` 与本地版本不同。因此不能用本地 HEAD 或镜像标签替代实际源码核查。

生产已经存在 Redis 共享权重台账与共享上游冷却，旧台账中“尚未部署”的状态不足以描述当前生产。本次补的是跨副本同请求刷新合并等缺口。旧网关容器仍承载既有连接，本次未操作。

## 3. 已完成修复

| 位置 | 修复及效果 |
| --- | --- |
| Renderer 行情请求 | 近实时 K 线及秒级聚合交易使用稳定请求身份，不再用每次变化的 `endTime` 强制制造缓存 miss；分析使用独立 `freshness=live` 要求，历史翻页仍保留真实时间边界。 |
| 增量补线 | 根据缺失根数选择 `limit`，合约上限 499、现货上限 1,000；很小的合约缺口可从原 1,500 条/weight 10 降到不足 100 条/weight 1。合约最多 13 页，覆盖原增量预算；没有通过少取历史改变指标输入。 |
| 主进程缓存 | 参数顺序归一；先读缓存再处理请求冷却；同 URL 的限流结果保留至 `Retry-After`，连续点击不重复打网关，其他已缓存交易对仍可读。 |
| 缓存时间 | 传递/保留数据实际获取时间，重复旧数据不能重置年龄；未结束的长周期 K 线不能因为有 `endTime` 就套用历史 TTL；实时分析拒绝过期数据。 |
| 请求调度 | 权重在真正出队执行时预留，排队预取不能提前占用交互预算；收藏预取有低优先级及取消信号。观察到的 Binance weight 按固定分钟到期，同窗口乱序响应不能降低水位。 |
| 分析完整性 | 校验单调时间、连续历史、已结束 K 线的 closed 状态、当前尾部覆盖，区分自然月与固定 30 天；拿不到新鲜 K 线时，不再用旧历史加一条报价制造当前分析。辅助报价请求同样要求新鲜，WS 备用报价最多 5 秒。 |
| 分钟切换 | 候选尾部尚未覆盖当前时，不再因为“落后不足五分钟”而提前结束重试；重试跨过 1 秒缓存 TTL，最多三次。服务器冷却超过 2 秒时结束当前分析刷新，不做三连重试。 |
| 网关跨副本 | Redis 原子租约、同请求合并、续租、所有权校验释放、过期锁恢复；Redis 协调不可用时停止新增上游请求，可使用期限内旧缓存。 |
| 网关共享缓存 | 失效 L1 及不满足实时年龄要求的 L1 重读 Redis，读取另一副本已经刷新的数据；所有旧缓存返回携带原获取时间。 |
| 可观测性 | `x-haolo-rate-limit-scope=ingress/user-weight/egress-weight`；新增对应分类计数；用户权重配置独立为 `HAOLO_MARKET_USER_WEIGHT_PER_MINUTE`，默认沿用原值；UI 区分网关繁忙、客户端排队、Binance 限流。 |

延续现有 DataHub 的 WebSocket 共享、断线补线和取消机制。没有改变现有策略公式、闭合 K 线价格、成交量或模型参数。缓存与跨请求合并以现有端点身份为边界；本次没有实施完整持久化 K 线数据库、跨不同 `limit` 的序列级复用或全市场预采集服务。

## 4. 验收证据

本地证据目录：`youle_desktop/.cache/binance-rate-limit-20261018/`。

| 验证 | 结果 | 文件 |
| --- | --- | --- |
| 客户端行情、请求调度、路由、账户兼容、DataHub、指标与布局相关回归 | 267/267，通过，无跳过 | `client-regression-final-r2.log` |
| TypeScript | 退出码 0 | `typecheck-final-r2.log` |
| 网关全部 14 个测试文件，真实 Redis | 71/71，通过，无跳过 | `gateway-redis-final-r2.log` |
| 新增客户端核心回归 | 并发合并、重试冷却、缓存年龄、分钟恢复、秒级数据、自然月、缺失历史拒绝、有效数据可分析 | `test/binance-market-budget-recovery.test.mjs`，已含于 267 项 |
| 跨副本故障回归 | 4 个独立缓存/网关、32 请求 → 1 次上游及 1 次额度入账；L1 同步、锁过期恢复、异常释放、长任务续租 | `test/market-refresh-coordination.test.mjs`，已含于 71 项 |
| 真实 BTCUSDT 现货/合约 | 各 12 个消费者 → 1 次网关请求；各返回 20 根连续 OHLCV，未使用 stale | `live-market-r2.json` |
| 真实 K 线流与 REST 收盘对账 | 104 条事件；P95 事件延迟 1,288 ms，最大 3,095 ms；收盘 OHLCV 五个字段逐项一致 | `live-market-r2.json` |
| 差异格式检查 | `git diff --check` 退出码 0 | 终端检查 |

真实行情检查使用现有登录会话，只读取公开行情和一个短时 K 线订阅。没有调用下单或账户变更接口；报告不包含 token、ticket、API Key。可复用脚本为 `scripts/smoke-binance-market-recovery.mjs`，必须显式传入 `--live` 和已有会话文件。

Redis 集成验证运行在独立临时容器中：无外部网络、使用测试 Redis、内存/CPU 有限额、源码只读挂载。没有连接生产 Redis。任务容器已清理。初轮因镜像缺少客户端协议测试依赖导致两项失败，补齐只读测试文件后全部通过；另一次启动因 Docker 权限失败，使用已配置的 sudo 后重跑，未修改主机权限。

首轮真实检查在分钟切换时发现 REST 尾部尚未覆盖新一分钟，未判为通过（`live-market.json`）。之后补充时间证据和分钟恢复回归，复核的完整收盘对账通过。成功样本中合约初次请求耗时 10,025 ms（含路由建立），现货 527 ms；不能用该短样本宣称首屏性能或所有市场实时性已经达标。

## 5. 生效范围与剩余验收

源码和本次验证已完成。运行中的客户端主进程与生产网关尚未切换到这批代码，原进程仍可能出现原限流提示；本次真实行情验证是“新客户端请求模块 + 现有生产网关”，新网关逻辑通过隔离 Redis 集成验证。

后续在获准发布/部署时还需要灰度切换，核对实际构件哈希，再观察 24–72 小时的分类限流、命中率、权重、首屏耗时、事件延迟和分析拒绝原因。当前没有做持续 72 小时压测、全用户并发容量验收或所有交易对逐一对账；截图中的那一次 31 秒响应仍无法唯一关联。数据校验保障分析输入完整与新鲜，不代表模型预测或交易结果准确率承诺。
