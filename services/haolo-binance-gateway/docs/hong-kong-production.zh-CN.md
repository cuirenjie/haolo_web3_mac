# 行情与私有出口：香港现行发布入口

2026-09-19 已从旧新加坡边缘迁移到香港 **`ecs-user@8.217.125.71`**（4 核 16 GiB）。本服务同时提供公共 REST/WS 和私有 HTTPS CONNECT，属于 Windows 仓库中的服务器组件；部署它不构建或发布桌面安装包。

## 访问与当前布局

- 本机部署私钥 `C:/Users/Joie/Downloads/haolo-prod-sg-key.pem`，`sudo -n`；使用已保存 SSH 配置、严格主机密钥检查和固定管理代理。完整访问预检位于官网仓库 `deploy/verify_hk_access.py`，统一说明 `C:/Users/Joie/Documents/ChatGPT/haolo_front_web3/docs/hk-production-deployment.md`。
- 活动容器、镜像及端口以 `/var/lib/haolo/gateway-active.env` 为准，读取时仅展示非秘密字段。核验时容器为 `haolo-binance-gateway-cache-4e7170bdfe0d`，镜像 `sha256:e59b782bb0bc201ea30d5e823094b212481b225f91485e7e1ed503f1c7677b1e`，公共/私有宿主端口 `28787/28788`；这些是本次证据，不能固定用于以后的发布。
- HAProxy 的 `public_gateway`、`public_gateway_rest` 同时指向活动公共端口，`private_gateway` 指向私有端口。切换和回退必须成组更新，保留其他域名、压缩、真实来源 IP、WebSocket/CONNECT 及运维路由。
- 香港 Redis `haolo-binance-redis-1` 是持久化主库，Docker 网络 `haolo-binance_default`、别名 `redis`、卷 `haolo-binance_redis_data`，配置 `/opt/haolo-redis/redis.conf`；旧新加坡 Redis 只是缓冲期副本。当前容器不由历史 Compose 管理，不能用 Compose 重建或改主从关系。密钥、票据、permit、额度账本必须连续。
- WireGuard `haolo-hk`：香港 `10.240.40.1` 直达业务机 `10.240.40.2 / 10.30.1.103`；旧边缘 `10.240.40.3` 仅用于兼容。新加坡旧机退出不应成为香港鉴权的依赖。
- `market.youle.pro` 和 `sg-a.binance-egress.waduo.com` 均解析香港普通公网，`sg-a` 保留为稳定 shard ID。不要因地理迁移随意更换分片哈希密钥或 ID。

## 后续发布

1. 从指定已提交版本或精确线上基线构建不可变镜像，记录完整来源、文件摘要和差异。不能将本地全部未发布优化覆盖到线上后仍标注旧版本。
2. 持有 `/run/lock/haolo-gateway-deploy.lock`，核验当前活动状态、HAProxy 摘要、环境摘要、网络与挂载；生成当前配置的私有备份和新鲜 Redis RDB。保留原镜像；不要打印完整运行环境。
3. 复用当前生产认证配置、Redis 主库和 Docker 网络，在未占用的受限端口启动候选。保留实际 `/etc/hosts` / `ExtraHosts` 的 `haolo.com` 回源绑定、内外端口、资源限制与重启策略。新候选不能依赖旧新加坡地址。
4. 验证两个 `/ready`、权威身份认证、公共 REST、真实 WS 行情帧及授权 CONNECT。不发起交易或支付，不伪造生产用户凭据。检查双实例内存、Redis、上游连接及配额余量。
5. 先启动独立回退监督，防止验收与回退竞争，再校验完整 HAProxy 配置，原子切换三组 backend 并 graceful reload。同步活动状态，watchdog 继续使用同一部署锁。候选承接成功且版本/启动/重启数稳定、外部业务通过后才能撤销回退监督。
6. 旧 HAProxy workers 和旧应用长连接自然排空；超时记录 `retirement_pending`，保留实例且不叠加后续版本。禁止强杀、`compose down`、清空 Redis或重启整机。回退只恢复本次香港应用/路由，不恢复旧机上的主库和过期代理备份。
7. 核验 `certbot.timer`、`haolo-gateway-watchdog.timer`、`haolo-redis-backup.timer`、WireGuard 和备份结果；香港备份/看门狗当前通过明确容器名访问 Redis，不依赖 Compose 标签。

旧单节点 [发布记录](../deploy/single-node/SEAMLESS_DEPLOYMENT.md) 保留历史证据。`deploy/hong-kong/` 原先的 market-only/GA 候选方案和 Kubernetes 示例均不是当前生产部署清单。`bootstrap-runtime.sh` 只用于独立新环境初始化，不能在当前生产运行。

## 旧机缓冲

用户明确保留旧 `8.219.93.44` 至剩余约两天缓冲，不再续费；到期北京时间 2026-09-21 23:59:59。不得提前停机、恢复旧网关自动启动、再次提升旧 Redis 为主库或将新发布投向旧机。新版客户端发布仍是独立任务；残留旧 IP 客户端须在到期前更新。
