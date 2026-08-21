# Haolo Binance Gateway

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
