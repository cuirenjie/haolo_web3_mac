# Haolo Binance Gateway

当前生产主机为香港 `8.217.125.71`。部署、权限、Redis 主库及旧机缓冲说明见 [香港生产流程](docs/hong-kong-production.zh-CN.md)；不要将旧新加坡记录或 market-only 候选模板当作现行部署清单。

2026-10-21 优化候选的指标口径、持久采集、hmc1 灰度与客户端条件请求见 [本轮实现说明](docs/market-efficiency-20261021.zh-CN.md)。源码状态不代表已部署；线上开关与旧实例需分别核验。

本服务同时提供两个严格分层的入口：

- `8787`：公共行情 REST/WebSocket 网关。公共数据可集中缓存、合并请求和共享上游订阅。
- `8788`：Binance 私有账户 HTTPS CONNECT 出口。只转发到固定 Binance 主机的 `443`，不终止内层 Binance TLS，不读取 API Key、签名或账户响应。

## 公共接口

- `GET /health`、`GET /ready`
- `GET /metrics`：仅接受 `Authorization: Bearer <HAOLO_GATEWAY_METRICS_TOKEN>`。
- `POST /api/market/v1/tickets`：使用 Haolo Bearer JWT 换取 30 秒、单次使用的 WebSocket ticket。
- `POST /api/private/v1/permits`：主进程只提交市场、白名单路径和是否带 `symbol`，由服务端计算权重并返回稳定分片的一次性 CONNECT 许可。
- `POST /api/private/v1/usage`：只回报 permit ID、HTTP 状态、`X-MBX-USED-WEIGHT-1M` 和 `Retry-After`，用于共享权重校准与原分片冷却。
- Binance 公共 REST 兼容路径，例如 `/fapi/v1/klines`、`/api/v3/klines`。
- `WS /ws/futures`、`/ws/spot`：Binance raw 兼容订阅协议。
- `WS /stream/futures`、`/stream/spot`：Binance combined 兼容订阅协议。

生产环境公共 REST 必须使用 `Authorization: Bearer <Haolo JWT>`。Renderer 不接触 JWT、ticket 或外部 WebSocket；主进程换取一次性 ticket，并由主进程 `TradingMarketDataHub` 维护统一行情连接，再通过受限 IPC 分发事件。

## 私有账户出口

客户端使用 HTTPS forward proxy，通过 `CONNECT api.binance.com:443` 或 `CONNECT fapi.binance.com:443` 建立隧道。每项 Binance 请求先经公共控制面申请一次性短期许可，代理认证采用 Basic：

- username：`haolo`
- password：控制面签发的单次 `permitToken`（不是长期 Haolo JWT）

这组 Basic 凭证必须只在 HTTPS 代理连接内传输。服务端建立 TCP 隧道后，桌面端再与 Binance 完成内层 TLS 握手，因此 Haolo 网关无法查看 Binance API Key、Secret、签名或账户数据。

安全边界：

- 目标主机必须在 `HAOLO_PRIVATE_PROXY_ALLOWED_HOSTS`；
- 只允许端口 `443`；
- DNS 解析出现私网、回环或链路本地地址时失败关闭；
- 每用户独立连接配额和连接频率限制；
- 用户按 Haolo user ID 一致性分配到固定分片；每个分片必须有独立 NAT EIP；
- Redis 原子协调同一 EIP 上所有 Pod/用户的 Spot/Futures 分钟权重，并为核心账户/仓位读取保留预算；
- 一次性许可绑定 user、shard、目标主机、市场、权重和过期时间，出口 shard ID 不匹配时失败关闭；
- Binance 429/418 只冷却既定分片，不自动换另一个 EIP 重试；
- 不能配置为任意 forward proxy；
- 桌面端保持 GET-only，且产品只接收关闭交易和提现权限的 Binance 只读 Key；
- 不要求用户填写公网 IP，也不把 Haolo 固定出口 EIP 作为 API Key IP 白名单前置条件。

## 启动

复制 `.env.example` 为 `.env`，填写与 Haolo 主后端一致的 JWT 配置，并分别生成至少 24 字符的监控 Bearer Token 和长期稳定分片哈希 Secret。分片 Secret 不得跟随 JWT Secret 轮换，否则会导致用户批量重映射。基础 Compose 仅将明文容器端口绑定到主机回环，供同机可信 TLS 负载均衡转发：

```powershell
docker compose -f services/haolo-binance-gateway/docker-compose.yml up -d --build
```

若由应用直接终止私有代理 TLS，把证书放入 `secrets/tls.crt`、`secrets/tls.key`，并叠加 TLS override：

```powershell
docker compose `
  -f services/haolo-binance-gateway/docker-compose.yml `
  -f services/haolo-binance-gateway/docker-compose.tls.yml `
  up -d --build
```

若私有入口由可信 TLS 负载均衡终止 HTTPS，可不在容器内挂证书，但必须保证 `8788` 只绑定回环或私网，不能直接暴露公网。长期生产部署、公共控制面模板、双固定 EIP 分片模板和验收步骤见 [生产部署与验收手册](./docs/production-deployment.zh-CN.md)。

## 桌面端配置

```text
HAOLO_BINANCE_MARKET_GATEWAY_URL=https://market.example.com
HAOLO_BINANCE_PRIVATE_PROXY_URL=https://sg-a.private-market.example.com
HAOLO_BINANCE_ROUTING_MODE=auto
HAOLO_BINANCE_REQUIRE_GATEWAY=true
```

两个地址均为 HTTPS origin，不允许用户名、密码、路径、query 或 fragment。`auto` 表示当前系统网络能访问 Binance 时直连，真实目标超时或地域阻断时自动回退 Haolo；它不检测 VPN 进程、虚拟网卡或公网 IP。未配置网关时开发版继续使用官方直连，生产国内版应同时配置两项。

Windows 安装包还会读取打包资源 `resources/binance-gateway.json`。正式国内版应在构建前写入两个实际域名、把 `routingMode` 设为 `auto` 并把 `requireGateway` 设为 `true`；后者只保证两条回退地址齐全，不强制所有流量走网关。环境变量只用于运维覆盖，不要求终端用户手工配置。
# 2026-10-02 公共行情降本接入（M2-026，源码已验证，未发布）

2026-10-03 移动端补齐：网关新增 `X-Haolo-Market-Delegation`，仅公开 REST / `/api/market/v1/tickets` 接受。后端使用每节点独立 `HAOLO_MARKET_DELEGATION_SECRET`（至少 32 字符随机值，不能与业务 / 私有出口签名密钥相同）签发不超过 60 秒的 HS256 委托，限定 issuer `haolo-mobile-market`、目标 HTTPS origin audience 和 `public-market` scope。会员携带权威到期时间；委托不能用于账户权限、私有 permit、CONNECT 或普通 access token。设此密钥必须同时启用 compatible/strict 和明确 paid/free 节点；routing off 时保持空值。客户端只收到 30 秒单次票据，不接触委托或业务后端密钥。

移动历史与实时的开关由业务后端 `HAOLO_MOBILE_MARKET_ROUTING_ENABLED` 控制，默认关闭；节点密钥分别对应后端 FREE / MEMBER_DELEGATION_SECRET，不能互换。自选按 20 个品种 / 40 流分组，两节点上线配置需将 `HAOLO_MARKET_MAX_WS_CLIENTS_PER_USER` 设为 32、订阅上限至少 50，再做 500 自选和多设备压测；原默认 8 连接不能承载满额移动自选。ENS 候选 Compose 已将 market 内存上限降到 4 GiB，环境模板补充连接限额；这不代表模板已经应用生产，已有香港滚动发布 / Redis 持久化 / 排空规程继续有效。

本轮网关 67 项通过、1 项真实 Redis 条件跳过；独立本地免费 / 会员 HTTP/WS 验证节点隔离、私有接口拒绝、单次票据和报价精度保留，Python 后端签发与 Node 验签互通。用户确认 ENS 仍显示申请开通；节点 API 成功但可售节点 / 规格为空，未购买、未部署本轮候选、未启用生产分流。需要企业需求审核和实际报价后再推进独立免费节点，不把两个域名指向同一出口视为完成。

公共行情分流仅使用权威 `/api/auth/me` 的 `is_member` 和 `membership_expires_at`。有效体验版、基础、专业、旗舰均走 `paid`；过期/未开通走 `free`。缺少权威字段为 `unknown`，严格模式拒绝，不从客户端声明、套餐名称或本地 JWT 自定义字段授予会员线路。现有业务后端已提供这些字段，本项无需数据库迁移。

- `HAOLO_MARKET_ROUTING_MODE=off|compatible|strict`：默认 off。compatible 只分流携带新版能力的客户端，旧版仍留原节点，**不是防绕过的权限隔离**；确认旧版升级后才切 strict。strict 在 REST、票据和 WS 握手均检查，直连 IP、Bearer、伪造 tier 头无例外。
- `HAOLO_MARKET_NODE_TIER=paid|free`；两端配置相同的 `HAOLO_MARKET_PAID_ORIGIN` / `HAOLO_MARKET_FREE_ORIGIN`。建议保留 `https://market.youle.pro` 为会员入口，新免费入口 `https://market-free.youle.pro`；后者尚待 DNS/TLS/节点配置，不代表已开通。
- 路由不匹配返回业务 HTTP 409 / `MARKET_ROUTE_REQUIRED`。客户端只接受本地配置的两个 HTTPS origin，只允许一次换路，禁止 HTTP 自动重定向携带身份。不要使用 HTTP 421：真实集成复现底层传输自动重放 POST 导致正文长度错误；409 已通过独立两节点实际 HTTP/WS 验证。票据由目标节点独立签发、30 秒一次性消费，两个节点不共享业务密钥或 Redis。
- 2026-10-21 源码改为 `HAOLO_MARKET_COMPACT_ENABLED=true`，`HAOLO_MARKET_COMPACT_PERCENT=100`，现有环境显式 false 仍生效。只有明确协商 `hmc1` 的票据使用紧凑结构，可按稳定用户队列灰度或设 0 回退。旧版维持 JSON；未知字段/事件原样 JSON 回退，价格数量仍是原字符串，字段存在性、顺序及每条事件保持；小于原 JSON 才采用紧凑格式。WS deflate 保持 0%，不引入采样、批处理等待或精度截断。原有慢客户端背压与断线恢复规则保留；“无损”指编码往返，不承诺网络断线不丢包。
- 已分流会话每 15 分钟重新取得权威身份/票据，遇会员到期则在截止时提前释放订阅并要求重连。取消/升级最迟下个租约重查（认证缓存最多 15 秒），避免永远保留旧线路；更新客户端并不立即搬迁已经打开的连接。`HAOLO_MARKET_SESSION_MAX_MS` 可设 1–60 分钟。

免费 ENS 使用独立 `market` 角色、独立 Redis 和 `HAOLO_PUBLIC_EGRESS_ID=hk-ens-free-a`，自行连接 Binance 上游并共享订阅，不能把免费节点配置为逐用户回源付费 ECS。不得给免费节点配置业务 JWT 签名私钥或私有交易出口。现有 `deploy/hong-kong` 是候选模板，不能直接覆盖现行生产；4 核 8 GiB 候选需把 market 容器内存上限降至 4 GiB，给 Redis（512 MiB 数据上限）、系统与 TLS 留余量，再执行压测。不能将原模板 8 GiB 容器上限直接用在 8 GiB 机器上。

受保护 `/metrics` 新增 `haolo_market_traffic_payload_bytes_total`、`json_bytes_total`、`messages_total`，维度为 node/tier/transport/market/family/codec/legacy。无账号 ID、symbol、JWT 或票据标签。例：

```promql
sum by (tier, transport, family) (increase(haolo_market_traffic_payload_bytes_total[1d]))
1 - sum(increase(haolo_market_traffic_payload_bytes_total{transport="ws"}[1d])) / sum(increase(haolo_market_traffic_json_bytes_total{transport="ws"}[1d]))
```

这是应用正文计数，不包括 WS/TLS/TCP 头、重传、鉴权与错误响应，不是阿里云计费流量。按节点将其与 HAProxy bytes_out、网卡和 CDT/ENS 账单核对；官网、私有账户、模型、其他地域不能按行情 80/20 一并迁走。既有平面 metrics 保留。

验证证据：网关/客户端/实际 TLS、两节点 HTTP/WS、网络路由组合最终 137 通过、1 项真实 Redis 条件跳过；分流安全、兼容/严格、配置与编码边界通过。160 个真实本地 socket × 500 条，JSON/hmc1 各两轮，每轮 80,000 条，零序列或价格精度错误；socket 字节减少约 26.2%，JSON P99 21.49–21.64 ms、hmc1 19.75–22.46 ms。CPU 两组受本机调度影响（3.49–4.63 s / 4.37 s），不声称 CPU 降幅或三网无退化。可复跑 `node services/haolo-binance-gateway/scripts/benchmark-market-codec.mjs 160 json` / `160 hmc1`；两份 wire codec 由字节一致性测试锁定。类型检查与 202 模块 Vite 构建通过，无界面、主题或三语文案变更。

上线顺序：新节点 ready/Binance/认证/订阅/独立出口检查 → 两地同版本网关（routing off）→ 更新客户端 → 开启编码小范围验证 → compatible 灰度并核对 legacy 流量 → 三网对比 P95/P99、CPU、事件序列、断线恢复和 24 小时账单 → strict。至少跑到现有流量峰值的两倍；观察增量延迟、错误和缺口，不以单机回环压测代替 ENS 线路验收。免费节点未通过就保持原线路，不能承诺先采购即无损。回退关闭编码/分流并按现行香港发布规程排空，不切旧新加坡主机、不清 Redis、不强杀旧连接。
