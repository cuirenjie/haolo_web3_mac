# M2-027 行情网关发布记录

2026-10-18 23:56 +08 在香港 `8.217.125.71` 切换，随后完成公网验证并接受发布。用户授权服务端部署和 Windows 开发版重启，未授权客户端安装包发布，本次没有打包客户端。

## 版本与来源

| 项目 | 值 |
| --- | --- |
| 修复 Git 提交 / 远端 | `8935f3a02c1f3cf6de5ddc8e0e88f88ba83404e9` / `origin/dev` |
| 活动容器 | `haolo-binance-gateway-m2-027-8935f3a` |
| 镜像 | `haolo/binance-gateway:20261018-8935f3a` |
| 不可变 image ID | `sha256:0c40ee03e2a67bb010c39dacc7d0bfa85df6f006798bef434d356f901d17eff9` |
| 源码基线 image ID | `sha256:ea633cabeda0310a620c6fa7854300e51ea72994d2f22f52b0586779624cef13` |
| 源码 manifest SHA-256 | `db8d3b13f9242a742a7e15a865da411c134589e13b333310eb6c7d6ea5fc892e` |
| 补丁 SHA-256 | `bc9a078ea90796dcf8380ab44224b58db4b3088fe1b99b783371cf2309c80729` |
| 公共 / 私有端口 | `50987 / 50988`，绑定原受限地址 `127.0.0.1` 与 `10.240.40.1` |
| 启动时间 / 重启 | `2026-10-18T15:56:03.69828612Z` / `0` |
| 发布目录 | `/opt/haolo/releases/market-m2-027-8935f3a` |
| 活动指针 | `/var/lib/haolo/gateway-active.env` |

从旧镜像提取精确生产源码，仅应用该提交中 `binance-rest.mjs`、`cache.mjs`、`config.mjs`、`public-rest-cache.mjs`、`public-server.mjs` 的差异。生产没有本地 HEAD 中的独立 market-delegation 特性，保留原鉴权行为。镜像并非整个 Git HEAD 的通用构建；完整文件摘要位于发布目录 `candidate/source-manifest.json` 及镜像 `/workspace/haolo-market-source-manifest.json`。

## 切换与回退

持有 `/run/lock/haolo-gateway-deploy.lock`，保留原 Docker 网络、环境、ExtraHosts、重启策略、资源参数和 Redis 主库。发布目录保存 `active.before`、`haproxy.before`、`container-before.private.json`、`runtime-before.json`、新鲜 `redis-before.rdb` 及 `state.json`，私有文件仅 root 可读。

候选双 `/health`、`/ready` 和无凭证 401 检查通过后，使用现有真实会话执行授权 REST、WS、private permit 和 CONNECT 验证。切换前设置独立 600 秒自动回退任务，验证完整 HAProxy 未漂移，成组修改 `public_gateway`、`public_gateway_rest`、`private_gateway`，校验配置并平滑 reload，原子更新活动指针。公网业务通过后执行 accept，撤销回退计时器。

当前状态 `accepted_retirement_pending`。旧活动实例 `haolo-binance-gateway-53badfa` 保留存量连接，最后记录约 212 个，未强制断开；在旧连接归零之前不叠加下一版。更早的 `haolo-binance-gateway-rate-limit-97de46e5` 已在两次零连接检查及确认不被路由引用后正常无限等待 stop，镜像和容器保留。

需要回退时先持同一锁核验当前活动指针和完整配置，按 `active.before` / `haproxy.before` 成组恢复旧后端，配置校验后平滑 reload，并同步活动指针；保留候选存量连接。不得恢复旧 Redis RDB、重建 Redis 或清空票据、许可与权重账本。`deploy_market.py recover` 只自动处理未接受的 switched/observing 阶段，accepted 阶段不能直接调用它声称已回退。

## 验证与剩余观察

- 精确候选镜像在隔离 Redis 中运行 14 个文件、70 项测试，全部通过，无跳过。包含跨副本并发合并、租约故障、权重共享、用户/出口 HTTP 429 的缓存读取和下一窗口恢复。
- 公网现货/合约各 12 个消费者，每轮合并为 1 次网关读取。25 条真实 K 线事件 P95 1,103 ms，最大 1,172 ms，最终收盘 OHLCV 与 REST 一致。公网授权 CONNECT、真实 Binance TLS 和时间接口通过。
- 容器无重启/OOM；Redis 无重启，RDB/AOF 状态正常；HAProxy、watchdog、备份、证书及 WireGuard 服务 active。
- 新实例 2026-10-18T16:02 左右样本：5,466 次 HTTP 请求；缓存 HIT 2,399、MISS 2,657、STALE 10；15 次单用户权重限流；入口、共享出口和 Binance 上游限流均为 0。未调整配额，尚未升级的其他客户端仍可能超过用户预算。
- 切换前 600 秒日志有 675 次 ticker 504；切换后 528 秒记录的 72 次 504 均为切换前接受的请求。另有 12 次 503，开始于切换后约 104–219 秒；缺少历史响应体不能唯一确认原因，后续观测必须保留该项。404、401、429 不应混为 Binance 上游限流。

完整 Windows 真实 IPC、分析适配器 OHLCV 对账及边界说明见 [客户端验收报告](../../../youle_desktop/docs/binance-market-rate-limit-20261018.zh-CN.md)。公开短时检查与隔离故障测试不能替代 24–72 小时长稳、所有交易对或全部用户容量验收。
