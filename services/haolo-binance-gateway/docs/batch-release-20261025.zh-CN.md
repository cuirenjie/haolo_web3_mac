# 2026-10-25 行情网关发布验收

来源 `cbfe575a962cd5c3039a367e29edd28dca17f64a` 已推送远端 `dev`。用户明确授权“允许本次保留旧连接并继续发布”，因此在保留旧容器和存量连接的前提下，新流量已切到 `haolo-binance-gateway-batch-cbfe575a`，受限端口 `51187/51188`。此授权仅适用于本次，不授权强断用户或下次叠加发布。

镜像为 `sha256:fce316d4200104f0cb2fc40edc36aa595ea7b3c2974952e7687153455f1c89f3`。实际 24 个运行文件匹配来源，原基线 21 个文件及依赖核对通过；精确镜像在隔离 Redis 上 120 项测试全通过，无跳过。生产环境、Redis 实例、网络、资源约束和既有回源绑定保持原值。

新鲜 Redis RDB：`/opt/haolo/releases/batch-20261025-1732/redis-before.rdb`，SHA-256 `74e60e0fed4bbaf9859d7949abdbd9bace7f7e51cb329d2bbe0a1812ad5f5dc2`。完整配置漂移校验、部署锁、独立 600 秒恢复计时器和三组路由同步切换执行完成；公网验收后解除恢复计时器。

候选真实合约/现货 REST、WS、授权 CONNECT 全通过。公网用本次 Windows 源码网络、票据和解码模块，经物理 WLAN 直连香港验证 XAU 15m/5m/1h、BTC 15m、ETH 1m 共 6 次 REST，均 200、无 STALE、条数及时间连续性正确；XAU WS、CONNECT 与 Binance TLS 通过。该测试不是新 Windows 安装包发布。

139.18 秒 / 7,532 请求零 5xx；404/429 计数保留在回执。切流前一次 REST 429 被保护器阻止，稍后完整候选验证通过；首次公网检查遇到 STALE，保留失败证据，整组复验通过，没有放宽条件。此前失败窗口与正式验收分开记录。

原 Prometheus 实例未重启，10 条规则加载成功，6 个实例端点全部正常。新版两个端点出现 `paid_or_gift_v1`，真实统计验证了 payer/entitlement 以及验证器 WS 的 foreground/background；旧连接仍在旧版本，客户端安装包也未在本次发布，所以不能宣称全用户窗口覆盖或据此估算费用节省。

状态为 `accepted_retirement_pending`。18:39 快照：efficiency 旧实例 28 WS / 30 TCP，XAU 旧实例 299 WS / 299 TCP。原 `haolo-market-xau-20261024-drain-watch.service` 继续运行；新增 `haolo-batch-20261025-1732-drain-watch.service` 管理 XAU 的自然退役，连续两次 WS/TCP 为零才无限宽限优雅停止，6 项隔离退役保护测试通过，未强制断开连接。

18:41 最终核验：两站指针及容器保持、网关活动版本匹配、Redis 实例不变；证书、watchdog、备份与监控目标刷新计时器 active，WireGuard 正常。下一次发布必须重新读取活动指针和两个退役回执，不重放本批次配置。现有统计自动化应据此识别统计已部署，本会话未修改该自动化。

[机器回执](verification/batch-release-20261025.json)；[跨仓库总记录](../../../../haolo_front_web3/docs/release-batch-20261025.md)。本地证据 `.codex-tmp/batch-20261025-1732/`，服务器证据 `/opt/haolo/releases/batch-20261025-1732/`。
