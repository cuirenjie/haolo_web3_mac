# 行情/私有出口服务：无感发布准备状态

## 2026-09-17 回源与传输降费更新

- 普通香港 GA `ga-bp1n9v1nhuiil4gmkwgiu` 的新加坡目标已从 PublicIp 改为同一边缘 ECS 的私网回源，IP/20 Mbps/真实来源地址保留；普通客户端仍可直连 `8.219.93.44`。
- HAProxy 新增 `public_gateway_rest`，与 `public_gateway` 指向同一活动实例 `127.0.0.1:18787`；仅允许的公共行情 GET 使用 gzip，票据、私有接口、WebSocket/CONNECT 保持原路由。**今后网关换端口时必须同步这两个 backend 的 server 地址，并在回退时一并恢复。** 不得重新生成历史 ingress 模板覆盖当前完整配置。
- 官网静态文件和已有移动行情 GET 的压缩配置由官网仓库 `deploy/ga/market_rest_compression.py` 管理；相关 backend `haolo_portal_compressed` 仍指向官网 `127.0.0.1:8084`。
- 旧 `haolo-binance-gateway-1` 经两次检查均无 8787/8788 下游 ESTABLISHED 连接、WebSocket 客户端为 0 后，以无限等待的正常 stop 退出（exit 0），容器和镜像仍保留。回执 `/opt/haolo/releases/cost-compression-20260917/old-gateway-retirement.json`。活动实例没有重启，不再叠加旧版本驻留。
- 现有 Windows WebSocket 明确禁用 permessage-deflate；本轮未修改/发布客户端，不能把 HTTP gzip 的降幅当作全部行情的降幅。完整现网验证与配置在官网仓库 `docs/cloud-cost-optimization-20260917.md`。

以下为先前发布时的历史记录；旧实例的 `retirement_pending` 已由上面的 2026-09-17 验收取代。

本服务部署于边缘机 `8.219.93.44`，同时提供行情 HTTP/WebSocket 与私有 CONNECT 代理。虽然源码属于桌面仓库，本次改造只涉及服务器，不构建或发布桌面安装包。

2026-09-04 已完成一次生产单节点修复发布：原线上容器仍为
`haolo/binance-gateway:20260822-auth1`，其 Futures 上游仍指向退役的
`wss://fstream.binance.com/stream`；候选实例已使用精确提交 `71758f4fc9a8ddc0f9d7512c7b2587cdf776047d`
构建为不可变镜像 `haolo/binance-gateway:20260904-71758f4`，并通过 HAProxy 切到回环端口
`18787/18788`。旧实例保留约 24 小时宽限，现有 WebSocket/CONNECT 连接自然排空后再退休，不能强制断开。
这次发布只涉及行情/私有出口网关，不构建或发布桌面安装包；多 EIP 与 72 小时长稳验收仍是后续 M2-013 工作。

已改：完整 HTTP handler/response 计数，接受中的升级鉴权计数，关闭时保留已有 WebSocket/CONNECT，待连接自然结束再关闭 upstream/cache。重复 close 调用等待同一完成结果；不会吞掉排空错误后提前关闭 Redis。Compose 的 24h 宽限不是部署方式，也不是允许超时强杀。

本地 28 项测试通过，包括真实本机 WebSocket ping/pong 和 CONNECT 双向字节在排空后继续传输；这些是隔离夹具，不是生产用户会话。

剩余上线要求：

- 制作与生产精确源码匹配的不可变镜像/版本证据，复核双实例 Redis 配额、permit、票据与上游连接容量。不得使用可变 tag 代替 image ID。
- 候选映射到未占用的仅回环端口，保持原 TLS、认证、域名和 Redis；不新增交易请求、不伪造生产用户凭证。
- 独立发布锁/监督与回滚，保留旧镜像和 Redis 一致性备份。HAProxy 完整配置防漂移、语法检查、原子切流及 graceful reload，保留现有 SSH 多路复用规则和其他域名。
- 等旧 HAProxy workers/连接退出才停止旧进程；超时记 retirement_pending，保留实例，阻止继续叠加版本。不能调用 compose restart/down 或清空 Redis。
- **watchdog 已协调**：`gateway-watchdog.sh` 与发布共用 `/run/lock/haolo-gateway-deploy.lock`，读取 root-owned
  `/var/lib/haolo/gateway-active.env`，只重启当前活动实例；活动状态缺失时拒绝回退到旧实例。发布期间 watchdog
  会跳过一个 tick，避免重建候选、覆盖 HAProxy 或误杀正在排空的长连接。
  状态中的 `CONTAINER`、`PUBLIC_PORT`、`PRIVATE_PORT` 必须各有且仅有一项，端口必须为不同的 1–65535
  十进制整数，且容器必须存在；缺失、损坏或重复字段时，在任何探测/重启前退出失败。
  首次初始化或旧部署接入 watchdog 前，也须在确认实际容器与入口端口后登记该状态；watchdog 不自动推断旧实例。
- 新实例完整版本、启动时间/稳定重启次数、两个 ready、实际授权业务路径、覆盖整个切换时间的 HAProxy 5xx/隧道异常都通过才算验收。旧版本没有新排空控制，首次迁移不可冒用新协议。

## 2026-09-04 生产修复记录

- 备份：发布前创建 Redis RDB 和旧 Compose、运行时环境哈希、HAProxy 配置备份，发布收据位于
  `/opt/haolo/releases/gateway-71758f4/receipt.json`，备份目录为
  `/opt/haolo/backups/gateway-20260904T0151Z-71758f4`。
- 版本证据：镜像 ID 为
  `sha256:9a6685066943d3cf4b0cd0f18d6ed9c84cfe7500b6768bf66c8d6ab870062d12`，构建标签包含源码提交和仓库地址；
  容器重启次数为 0。候选容器使用 `unless-stopped`，活动状态文件记录端口、容器、镜像 ID 和提交号。
- 路由验收：候选容器内直连 Binance `market` 的 `aggTrade` 和 `public` 的 `bookTicker` 均收到实时帧；外部
  `market.youle.pro` 与 `sg-a.binance-egress.waduo.com` 的 `/health`、`/ready` 均返回 200。切换观察期内无 5xx；
  仅出现预期的 permit 预算 429，以及无凭证探测产生的 401/407。
- 排空状态：旧实例仍保留少量既有长连接，标记为 `retirement_pending`；新实例持续承接实时 REST 流量和健康检查。
  待旧连接归零后再单独停止旧实例，禁止使用 `compose down`、清空 Redis 或超时强杀。
