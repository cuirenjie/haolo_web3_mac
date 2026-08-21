# Haolo Binance 双链路生产部署与验收手册

## 1. 交付边界

本服务为 Binance 国内访问提供两条 Haolo 回退链路，并由桌面主进程按真实目标可达性自动选路：

1. 公共行情：当前系统网络可访问 Binance 时，`TradingMarketDataHub` 直接连接 Binance Spot/USDⓈ-M REST/WebSocket；超时或地域阻断时切到 Haolo Market Gateway。Renderer 只接收 IPC 事件，不持有 Haolo JWT 或 WebSocket ticket。
2. 用户数据：桌面主进程从 safeStorage 读取凭证并本地签名，直连可用时直接读取；失败时重新校时、重新签名。每项回退请求先向控制面提交不含 query 的市场/路径元数据，取得绑定用户、稳定分片、目标主机和服务端权重的一次性短期许可，再经该分片的 HTTPS CONNECT 出口访问 Binance `api.binance.com` / `fapi.binance.com`。网关看不见 API Key、signature、完整 query、账户响应或 Secret。

私有出口不终止内层 TLS。允许路径和权重在发许可前由服务端白名单判断，实际请求方法仍由桌面端 GET-only 门禁约束；一次许可只能在指定 shard、指定 Binance host 消费一次，官方客户端一项请求只建立一个隧道。用户的 Binance Key 必须保持只读，禁止开启现货/合约交易和提现权限。

## 2. 推荐拓扑

- 公共行情/许可控制面跨两个境外可用区部署至少两个 Pod，使用 `HAOLO_GATEWAY_ROLE=public`；公共域名走支持 WebSocket 的 HTTPS Ingress/L7 负载均衡。
- 私有账户出口按 EIP 拆成独立 Deployment/节点池，使用 `HAOLO_GATEWAY_ROLE=private`。每个 shard 有唯一 `HAOLO_PRIVATE_EGRESS_SHARD_ID`、入口子域名、L4 TCP 负载均衡和独立 NAT EIP；私有入口不能放在不支持 CONNECT 的普通 CDN/WAF 后面。
- 初始建议两个分片分布在两个可用区，例如 `sg-a`、`sg-b`。同一分片可以有多个 Pod 提高进程可用性，但这些 Pod必须共享该分片的同一个 NAT EIP；不同分片必须使用不同 NAT EIP。两个域名、两台服务器或两个 Pod若最终共用一个 NAT EIP，Binance 仍只会看到一个 IP 预算，不能算容量扩展。
- 用户通过基于 Haolo user ID 的 rendezvous hashing 稳定落到一个分片。不会因为预算耗尽或 Binance 429/418 临时换 EIP；只有明确的 Haolo 基础设施拓扑变更才允许受控重映射。
- Redis 使用同区域托管高可用实例，承担公共缓存、一次性 ticket、一次性私有 permit、按 `shard + Spot/Futures + 分钟` 的全局权重预算、每用户公平预算和共享冷却。生产无 Redis时控制面 `/ready` 返回 503，私有许可失败关闭。
- 桌面端携带现有 Haolo access token，Gateway 通过主后端 `GET /api/auth/me` 做权威认证并只短暂缓存用户身份，不在网关复制主站会话密钥。`HAOLO_GATEWAY_JWT_SECRET` 只用于网关内部签发短期、一次性的私有出口许可，必须与主后端认证密钥完全独立，并由密钥管理系统注入。

参考流向：

```text
Renderer
  │ IPC（无 JWT/ticket）
Desktop Main TradingMarketDataHub
  ├─ Binance 可达 ──> Binance public REST/WSS
  └─ 不可达 ── HTTPS/WSS + Haolo JWT/一次性 ticket
                 Public LB ──> Gateway:8787 ──> Redis ──> Binance public REST/WSS

Desktop Main（safeStorage + 本地 HMAC 签名）
  ├─ Binance 可达 ──> Binance USER_DATA
  └─ 不可达 ── 重新校时/签名
       ├─ POST /api/private/v1/permits（仅 market/path/hasSymbol）
       │    Control Plane ── Redis 原子准入 ──> shard + one-use permit
       └─ HTTPS proxy auth: one-use permit
            shard L4 LB ──> Private Gateway:8788 ── CONNECT ──> shard 固定 NAT EIP ──> Binance USER_DATA
                            └─ 内层 TLS 不解密；响应后只回报 status/weight/Retry-After
```

## 3. 上线前需要准备

运维必须提供：

- 一个公共行情 HTTPS 域名，例如 `market.<实际域名>`；
- 一个私有 CONNECT 域名空间，例如已有域名为 `binance-egress.<实际域名>`，则创建 `sg-a.binance-egress.<实际域名>`、`sg-b.binance-egress.<实际域名>`；这只是同一域名下的 DNS 子域名，不需要再购买新域名；
- 公共域名证书，以及覆盖所有私有 shard 子域名的通配符证书或 SAN 证书；私有证书挂载为 Kubernetes TLS Secret；
- 境外 Kubernetes 集群或两台以上 VM，能够稳定访问 Binance；
- 托管 Redis TLS 连接串；
- Haolo 权威认证地址（生产为 `https://haolo.com/api/auth/me`），以及独立生成的网关内部许可签名密钥；不要把主后端 `JWT_SECRET` 复制到 Gateway；
- 独立、长期稳定的至少 24 字符 `HAOLO_PRIVATE_SHARD_HASH_SECRET`；它只用于一致性分片，不能与 JWT Secret 共用，JWT 轮换时不得同步更换它；
- 独立的至少 24 字符监控 Bearer Token，只注入监控系统和 Gateway；
- 初始两个固定 NAT EIP，且每个 shard 独占一个；扩容时按一个新 shard 对应一个新 EIP增加；
- 镜像仓库地址和不可变镜像 digest。

用户/客服必须完成：

- 为每个 Binance 账户新建专用 API Key；
- 仅保留读取 `USER_DATA` 所需权限，确认现货交易、合约交易和提现全部关闭；
- 不填写 IP 白名单；客户端不会要求、检测或上传用户 IP；
- 不复用任何已有交易机器人 Key。

## 4. Kubernetes 部署

公共控制面模板位于 `deploy/k8s/gateway.yaml`，两个私有出口模板位于 `deploy/k8s/private-egress-shards.example.yaml`。先替换：

- 镜像及 digest；
- `market.example.invalid`，以及两个 `*.binance-egress.example.invalid` shard URL；
- Ingress class、TLS Secret 名称和云厂商 LoadBalancer 注解；
- 公共节点池标签 `haolo.network/egress-pool=public-market`，以及两个私有节点/节点池标签 `haolo.network/egress-shard=sg-a|sg-b`；确认公共行情 NAT 池不与私有账户 shard 共用，两个私有子网又分别指向不同 NAT EIP；
- 两份模板中的 `HAOLO_PRIVATE_EGRESS_SHARDS_JSON`，内容必须逐字保持一致；
- 资源配额与 HPA 阈值。

创建运行 Secret（示例命令中的值必须从密钥管理系统读取，不要写入 shell history）：

```text
kubectl -n haolo-market create secret generic haolo-binance-gateway-runtime \
  --from-literal=jwt-secret='<网关内部许可专用强密钥，不与主后端共用>' \
  --from-literal=shard-hash-secret='<独立且长期稳定的分片哈希密钥>' \
  --from-literal=metrics-token='<独立监控强令牌>' \
  --from-literal=redis-url='<托管 Redis TLS URL>'

kubectl -n haolo-market create secret tls haolo-binance-private-proxy-tls \
  --cert='<private proxy fullchain.pem>' \
  --key='<private proxy privkey.pem>'
```

应用并等待：

```text
kubectl apply -f services/haolo-binance-gateway/deploy/k8s/gateway.yaml
kubectl apply -f services/haolo-binance-gateway/deploy/k8s/private-egress-shards.example.yaml
kubectl -n haolo-market rollout status deployment/haolo-binance-gateway
kubectl -n haolo-market rollout status deployment/haolo-binance-egress-sg-a
kubectl -n haolo-market rollout status deployment/haolo-binance-egress-sg-b
kubectl -n haolo-market get pods,svc,ingress
```

两个私有 `LoadBalancer` 都必须做 TCP 透传，公网 `443` 映射 Pod `8788`，证书由 Node 服务终止。分别把 shard 子域名解析到对应 LB，并从每个私有 Pod执行 `curl https://api.ipify.org` 或云厂商出口诊断，确认 `sg-a`、`sg-b` 显示不同且固定的公网 EIP；再从外部验证证书主机名。公共 Ingress 必须保留 `Authorization` header、支持 Upgrade、关闭响应缓冲，并把长连接 read/send timeout 设置到 24 小时以上。
开启 `HAOLO_GATEWAY_TRUST_PROXY=true` 时，公共 Ingress 还必须覆盖客户端传入的 `X-Real-IP`，不能原样信任终端提供的转发头；网关优先使用受信任入口写入的 `X-Real-IP`，否则只采用 `X-Forwarded-For` 最右侧地址进行限流记账。

## 5. 桌面生产配置

取得两个真实域名后，在 Windows 生产构建前修改：

```json
{
  "routingMode": "auto",
  "marketGatewayUrl": "https://market.<实际域名>",
  "privateProxyUrl": "https://sg-a.binance-egress.<实际域名>",
  "requireGateway": true,
  "directAttemptTimeoutMs": 3000
}
```

文件位置：`youle_desktop/resources/binance-gateway.json`。它会作为 `binance-gateway.json` 写入安装包资源。`routingMode=auto` 表示直连优先、失败回退；`requireGateway=true` 会在任何一条回退地址缺失时失败关闭，但不会强制可直连的用户绕行网关。环境变量 `HAOLO_BINANCE_ROUTING_MODE`、`HAOLO_BINANCE_MARKET_GATEWAY_URL`、`HAOLO_BINANCE_PRIVATE_PROXY_URL`、`HAOLO_BINANCE_REQUIRE_GATEWAY` 和 `HAOLO_BINANCE_DIRECT_ATTEMPT_TIMEOUT_MS` 仅作为受控运维覆盖。

`privateProxyUrl` 是安装包的受信任私有入口基准和旧版兼容值；新版每项请求实际连接哪个 shard，由 `POST /api/private/v1/permits` 返回。建议把该值设为真实可用的 `sg-a` 入口，不能填写 CDN、路径或带账号密码的 URL。

### 5.1 容量模型与扩容触发线

- 配置中的官方分钟上限必须按 Binance 当前 `exchangeInfo/rateLimits` 和官方文档复核；模板示例为 Spot `6000`、USDⓈ-M `2400`。Haolo 默认只开放 60% 总预算，示例合约每 EIP 可准入 `1440 weight/min`，其余用于上游计数偏差、时间窗边界和非预期流量。
- 可降级的收益、钱包、全量委托和历史路由最多使用官方额度的 35%；账户、时间和仓位等核心路由仍可使用剩余总预算。每用户另设 Spot `120`、Futures `240 weight/min` 公平上限，防止单个账号占满整个 shard。
- 以当前客户端一次常规活跃刷新约 `17 futures weight/min` 估算，一个 EIP约承载 `1440 / 17 ≈ 84` 个同时进入 Haolo 回退且每分钟刷新的活跃用户；两个独立 EIP约 `168` 个。直连成功的 VPN/境外用户使用自己的网络出口，不占 Haolo 预算。
- 一次完整冷启动快照按约 `137 futures weight` 估算，一个 EIP每分钟只能接纳约 10 个完整冷启动。登录高峰必须依靠客户端缓存、相同账号请求合并、核心/后台预算隔离和分批启动，不能承诺 1000 人同秒全量冷启动。
- 若目标是 1000 个持续每分钟刷新的 Haolo 回退用户，按 60% 安全预算至少准备约 12 个合约私有 EIP，再加 20%–30% 峰值冗余，生产规划为 15–16 个 shard 更稳妥。上线初期两个 shard 足以验证架构，但不是 1000 活跃回退用户的最终容量。
- 扩容触发线：任一 shard 的一分钟总预算连续 5 分钟超过 50%、后台预算拒绝率超过 1%、核心许可 P95 等待/失败超线，或 429 出现一次，即停止放量并调查；确认是正常业务增长后新增 shard + NAT EIP。禁止在 429/418 后临时轮转现有用户到其他 EIP。

## 6. 分阶段验收

### 6.1 服务与认证

- 公共 `/health` 为 200；Redis 正常时 `/ready` 为 200，断开 Redis 后应为 503。
- 公私两端 `/metrics` 未携带独立监控 Bearer Token 时必须为 401；健康检查不返回连接量和内部指标。
- 未携带 Haolo access token 的公共 REST 和 ticket 请求为 401；伪造、过期或主后端已撤销的 token 同样为 401，认证主站暂时不可用时为 503，不能降级为匿名访问。
- 通过 `/api/auth/me` 验证的有效 access token 可读取 `/fapi/v1/exchangeInfo`、`/fapi/v1/klines`、`/api/v3/exchangeInfo` 和 `/api/v3/klines`。
- ticket 30 秒过期且只能成功升级一次；第二次必须 401。
- 非 allowlist REST 路由、query、stream、私有流和写操作必须失败。

### 6.2 公共实时行情

- 同一 Pod 内 BTC 主图、收藏和告警订阅只建立一个桌面主进程 Hub socket；多个客户端相同 stream 只建立一个 Gateway 上游订阅引用。
- Spot 与 USDⓈ-M 分别验证 ticker、aggTrade、kline、markPrice；切交易对和周期后旧数据不得串入。
- 主动断开 Gateway→Binance、Gateway Pod、Redis和公共 LB，验证指数退避、重新取 ticket、REST fallback 和恢复后去重。
- 24 小时轮换前后 K 线不断档；至少执行 72 小时 soak。

### 6.3 私有账户

- 未认证 CONNECT 返回 407；非 allowlist host、非 443、私网/回环/链路本地/DNS 混合结果全部拒绝。
- 普通 Haolo JWT 直接作为生产代理密码必须返回 407；只有控制面签发、未过期、shard/host 匹配且 Redis nonce 未消费的一次性 permit 才能返回 200。同一 permit 第二次使用必须返回 409。
- 连续为同一用户申请许可，确认 shard ID 始终稳定；调整配置顺序不得改变映射。关闭一个 shard 只能通过受控拓扑发布完成，不得由客户端因 429 自动切换。
- 人工把 Futures 模板额度降到测试值，验证后台预算先拒绝但核心账户许可仍可进入；验证单用户预算耗尽后其他用户仍能使用该 shard；Redis 断开时不得签发新许可。
- 使用只读 Key 验证账户资产、持仓、当前委托、历史成交、资金流水和收益日历。
- 在可直连网络验证账户请求不经过 Haolo；阻断本地 Binance 目标后，应在直连超时后重新取 Binance 时间、生成新签名并经 Haolo 恢复。
- 恢复本地 Binance 可达性并越过熔断冷却后，请求应自动切回直连；鉴权失败、签名错误和 429/418 不得触发换 IP 重试。模拟 Binance 429/418 后，同一 shard 的后续许可必须按 `Retry-After` 共享冷却，其他 EIP不得接管这些重试。
- 抓取 Gateway 日志确认不存在 API Key、signature、完整 query、余额、持仓和响应体。
- 代码、IPC 和网络层均不存在 Binance POST/PUT/PATCH/DELETE。
- 同时压测 permit 控制面、每请求 CONNECT 和 Redis Lua：2 核 4G 单节点先以 100、300、500 并发阶梯测试，记录 CPU、内存、事件循环延迟、TLS 建连 P95/P99 和 Redis P95；容量结论以权重准入和实测中较小者为准。

### 6.4 国内网络

- 中国移动、中国联通、中国电信至少各两个省份，分别执行 DNS、TLS、公共 REST、WSS 30 分钟、私有账户快照；同时覆盖未开 VPN 的 Haolo 回退和已具备可达路径的 Binance 直连。
- 切换系统 VPN/代理时不读取 VPN 状态；以 Binance ping、REST 与 WebSocket 真实结果验证自动选路、短暂熔断、恢复探测和无重复/断档。
- 记录 DNS P95、TCP P95、TLS P95、首包 P95、REST 成功率、WS 重连次数、行情延迟 P95/P99。
- 灰度顺序建议 1% → 5% → 20% → 50% → 100%，每级至少观察一个交易高峰；错误率或延迟越线立即回滚安装包配置或入口权重。

## 7. 告警与 SLO

首期建议：

- 公共 REST 成功率 ≥ 99.95%，Gateway 额外 P95 延迟 < 100ms（不含跨境上游）；
- WSS 在线率 ≥ 99.9%，事件进入 Gateway 到写入客户端 socket 的 P95 < 50ms；
- 私有 CONNECT 建连成功率 ≥ 99.9%，Gateway 额外 P95 < 50ms；
- `private_egress_permitsIssued/permitsRejected/usageReports/upstreamCooldowns`、418、429、Redis not-ready、ticket 失败、WS reconnect、active tunnel、permitRejected 和拒绝量全部告警；
- 每个 shard 的 NAT EIP、入口 LB、TLS、Redis连通、分钟总/后台/单用户预算分别建看板；按 shard ID 观察，禁止只看全集群平均值掩盖热点；
- 固定 EIP 变更、TLS 证书剩余 30/14/7 天、JWT/Redis Secret 轮换失败必须告警。

## 8. 回滚

- 公共链路：Ingress 权重回到上一镜像，旧 Pod 保持至现有 WebSocket 自然迁移；直连可用的客户端不受影响，回退用户继续走上一网关版本。
- 私有链路：单个 shard 的 LoadBalancer/Deployment 回到上一镜像，保持 shard ID、域名和 NAT EIP 不变；若必须移除故障 shard，通过控制面配置发布让一致性哈希受控重映射，先停止新许可、等待 15 秒 permit 过期，再移除入口。不得把 Binance 429/418 当作基础设施故障执行该流程。
- 桌面端：保留上一版 `binance-gateway.json` 和安装包；配置错误时只影响 Binance 回退能力，不放宽到任意代理或 VPN 探测。
- Redis：恢复到同一逻辑实例；可以丢弃公共行情缓存，但不能在生产无 Redis 时继续签发私有许可。ticket 最长 30 秒、private permit 最长 15 秒，均不迁移旧值。

## 9. 官方协议依据

- Binance 官方公共行情说明建议纯行情使用 `data-api.binance.vision`，并要求 429 后退避、418 时遵守 `Retry-After`；限流按 IP 计数：<https://developers.binance.com/en/docs/products/spot/rest-api>
- Binance 官方将 `USER_DATA` 与 `TRADE` 权限分离，API Key 默认不能交易，安全接口需要本地签名和时间窗：<https://developers.binance.com/en/docs/products/spot/rest-api>
- Binance 官方 WebSocket 使用 raw/combined stream、单连接最多 1024 streams、24 小时轮换和 ping/pong：<https://developers.binance.com/zh-CN/docs/products/spot/testnet/web-socket-streams>
- Node.js 官方 TLS/HTTPS API支持在已建立的 socket 上创建内层 TLS，并使用自定义连接执行单次 HTTPS 请求：<https://nodejs.org/api/tls.html>、<https://nodejs.org/api/https.html>
