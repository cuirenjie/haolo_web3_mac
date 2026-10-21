# 行情与私有出口：香港现行发布入口

2026-09-19 已从旧新加坡边缘迁移到香港 **`ecs-user@8.217.125.71`**（4 核 16 GiB）。本服务同时提供公共 REST/WS 和私有 HTTPS CONNECT，属于 Windows 仓库中的服务器组件；部署它不构建或发布桌面安装包。

## 当前活动版本（2026-10-21 12:41核验）

行情归因／hmc1优化已切换新连接：`haolo-binance-gateway-efficiency-1fe4546`，公共／私有端口50987／50988，源码 `1fe454602616a45bb46783ddbe3e8c7f9c1065ee`，镜像 `sha256:35a7ed199ca6e84fbf9895a8ca029eb88031e67021037e234416eb5164f114a7`。12:32:58切流、12:35:33 accept，运行配置enabled=true／percent=10。95项真实Redis测试及6项回收测试通过，19个运行源码与package核对、实际REST／WS／CONNECT通过；最终389.7秒15,259请求零5xx／429。用户本次明确允许保留旧连接自然排空，状态仍 `accepted_retirement_pending`，专用守护器active，不能称旧实例已退役。持久采集已覆盖新旧实例。真实混合行情旁路编码仅减少0.18%～0.38%，K线约25.2%；截至12:39尚无实际线上hmc1帧，未声称CDT已下降。Windows／移动源码推送，安装包渠道未发布。见[完整记录](market-efficiency-release-20261021.zh-CN.md)和[机器回执](verification/market-efficiency-release-20261021.json)。后续必须刷新实时活动指针，不重复使用历史候选或把本次例外视为长期许可。

## 2026-10-19 历史活动版本

dev 完整网关源码已部署并正式验收：活动实例 **`haolo-binance-gateway-dev-5bec9dc`**，端口 **51087/51088**，精确镜像 `e8fb1f678739`，来源 `5bec9dc92e89a039d56c38b58dcf6708d4523b6d`，19 个运行文件及 package.json 与提交匹配。**22:17:09 切换、22:19:29 accept**；真实 Redis 回归88／回收6通过，真实 REST/WS/CONNECT、共享连接与恢复、952根分析对账通过。159秒6049请求零429/5xx，1113鉴权全200/P95 178ms/最长660ms。首轮25次鉴权超时503已拒绝并回退，待另一后端发布完成及完整鉴权稳定窗口通过后重试；失败证据保留，不宣称旧长尾根因已根治。环境、Redis、配额、鉴权超时及关闭的委托／分流配置不变。状态 `accepted_retirement_pending`，旧 ticket-bdb7ad5 由双零守护器自然回收，不强杀连接。Windows仅推送dev，无安装包；客户端尚有13项回归失败和本机严格新鲜度失败。详见[本轮发布记录](dev-source-release-20261019.zh-CN.md)及[机器回执](verification/dev-source-release-20261019.json)。

## 2026-10-19 10:02 历史活动版本

WebSocket 401 票据生命周期修复已部署并正式验收：活动实例 **`haolo-binance-gateway-ticket-bdb7ad5`**，端口 **51387/51388**，精确镜像 `19ab17265ad4`，来源 `bdb7ad5a1dd7a24ad7f5a3477d429e2860f703ea`（ws-9c67921 已验收基线仅叠加票据存储及公共入口修复）。**09:59:39 切换、10:02:58 accept**；19 文件匹配，精确网关85/回收6/客户端69通过。约450秒7163请求零429/5xx，仅有两次自有测试票据的预期401；1533鉴权全200、P95 91ms、最长547ms。真实过期/重放拒绝、401换新票据恢复、12消费者共享、REST/WS/CONNECT、952根收盘分析一致性及开发版实际IPC通过。授权有效期仍30秒、每用户WS仍8、配额和超时未放宽。完整证据及历史五次401归因边界见[本轮记录](ws-401-followup-20261019.zh-CN.md)。原四个旧实例和本轮替换的9c67921共五个仍由双零守护器自然回收；按用户新要求，10:14–10:16已提前完成真实行情、限流恢复和952根分析数据一致性复验，不以旧实例退休为前置条件；约998秒16764请求没有非预期WS401、429或5xx，3702鉴权全200/P95 92ms。持续观察401，旧实例回收独立跟进。开发版已恢复auto，客户端未打包发布。

## 2026-10-19 02:19 历史活动版本

WebSocket 连接复用、释放及订阅恢复修复已部署并正式验收：活动实例 `haolo-binance-gateway-ws-9c67921`，端口 **51287/51288**，精确镜像 `edcf22b68e2a`，生产来源 `9c6792147ca3257899e37fcedb6f1e7f37f09f59`（738ae82 已验收基线叠加 public-server 修改）。02:13:53 切换、02:19:53 accept；约 461 秒 4549 次新完成请求零 429/5xx，1000 次鉴权 P95 85 ms。12 消费者单连接、断线后订阅恢复、开发版 IPC 和 952 根收盘数据对账通过，每用户连接上限仍为 8。详情见[本轮发布记录](ws-429-followup-20261019.zh-CN.md)；[上轮用户额度及鉴权记录](quota-auth-tail-followup-20261019.zh-CN.md)保留。用户已明确“不必等到排空，直接切换”，原三个及本次替换的 738ae82 共四个旧实例由各自双零守护器自然回收，全部回收后再做最终复验。当前活动指针及回执始终是依据；不重复发布，不强杀旧连接，不打包客户端。

扩展观察至约 805 秒：WS 429／5xx 仍为 0，但 02:22:57 出现 6 次共享出口预算 REST 429，已分离归因并验证下一窗口恢复；六个原始完整参数在 02:28 全部 200/MISS。1828 个鉴权样本 P95 87 ms、最大 306 ms。不得把最初零错误窗口扩展解释为整个观察期零 REST 429，详见报告中的后续记录。

## 2026-10-18 历史活动版本

M2-027 行情共享刷新与限流恢复修复已部署并完成公网验收：活动实例 `haolo-binance-gateway-m2-027-8935f3a`，受限端口 **50987/50988**。精确镜像、生产基线叠加补丁、备份、实流测试和遗留观测见 [本次发布记录](market-rate-limit-release-20261018.zh-CN.md)。旧 `haolo-binance-gateway-53badfa` 保留存量连接，状态 `accepted_retirement_pending`；下次发布前必须核验自然排空，不能强杀或叠加版本。实时活动指针仍为最终依据。

## 2026-09-21 历史活动版本

自动化计划撤单许可已发布并验收：活动实例 `haolo-binance-gateway-jev-cancel-184b0cf63764`，端口 **48787/48788**，源码提交 `184b0cf63764af895668c80f1d4c088b36eda195`。完整镜像、备份、验收和回退证据见 [本次发布记录](automation-cancellation-release-20260921.zh-CN.md)。下面的迁移日及 9 月 20 日记录是历史状态，实时活动指针仍是最终依据。

上一版 `haolo-binance-gateway-cost-74693cbdee12` 保留存量长连接，退出观察服务为 `haolo-market-jev-cancel-184b0cf63764-drain-watch.service`；状态位于 `/opt/haolo/releases/jev-cancel-184b0cf63764/retirement/retirement-status.json`。下次发布前核验自然排空结果，不能强杀或叠加版本。

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
