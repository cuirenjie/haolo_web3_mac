# Web3 客户端香港精品线路验收（2026-09-14）

历史记录：2026-09-16 已收窄加速范围并开始香港普通 BGP 试用；当前入口及 Windows 发版交接见 [普通 BGP 试用](hk-bgp-trial-20260916.zh-CN.md)。下文的旧入口和模型 GA 状态不代表当前配置。

本次完成线路审计、客户端行情/账户查询代理的自动选路实现和线上匿名测速。源码尚未打包为新安装程序、提交、推送或发布。原有账号网络兼容性改动保留，未替换。

同日追加的完整接口审计与故障修复见 [国内网络覆盖审计](domestic-network-audit-20260914.zh-CN.md)。两个行情域名已由用户修改到官网香港 GA，邀请中心也已接入；DNS 切换可惠及已有客户端，新增代码仍待发布。下方初始测速及临时模型试验记录保留为历史证据。

## 入口与实施状态

| 客户端用途 | 入口 | 当前状态 |
| --- | --- | --- |
| 登录、账号业务、更新查询、官网帮助 | `https://haolo.com` | 官网已接入香港 BGP_PRO GA；已安装客户端使用此域名的请求能够受益 |
| Binance 行情 HTTP 和网关 WebSocket | `https://market.youle.pro` | 域名已指向官网香港 GA，既有客户端随 DNS 更新受益；新版自动选路和故障恢复源码待发布 |
| Binance 账户只读查询代理 | `https://sg-a.binance-egress.waduo.com` | 域名已指向官网香港 GA；新版外层 TLS 自动选路源码待发布 |
| 模型请求 | `https://haolo.pro/v1` | 已正式接入独立香港 BGP_PRO GA，入口 `47.57.243.152`、`47.75.126.250`；用户已切换 Cloudflare 根域名 A 记录，2026-09-14 21:36:31 完成正式域名验收，现有客户端可随 DNS 缓存更新受益 |
| 安装包文件 | `assets.haolo.com` | 已正式接入独立阿里云境外 CDN；完整文件校验、正常域名 DNS、客户端默认 TLS 与 Range 缓存验收通过，详见同日国内网络覆盖审计 |
| 外部提供商、交易所直连等 | 各提供商域名 | 保持原有路由；不能把这些服务统一替换成官网域名 |

## 客户端实现

- `resources/binance-gateway.json` 为两个现有网关提供 `haolo.com`、两个固定 GA IP 及原服务器候选，开启 `gatewayRouteSelection`。
- `gateway-route-lookup.mjs` 并行解析候选 IPv4，去重后竞争匿名 `GET /health`，只接受 HTTP 200、`status=ok` 且服务身份匹配的结果。一次选择最多 2.5 秒，结果缓存 30 秒；并发请求共享一次选路，选中后取消其余探测。
- 所有健康探测、行情请求和代理外层连接继续使用原网关域名作为 URL/Host/TLS SNI，严格校验证书。候选地址只改变连接目的 IP。没有代理密钥、账号 JWT、Binance Key、permit 或签名 URL参与竞速或写入配置/报告。
- HTTP/WS 连接失败会清除相应地址的选路缓存，失败地址暂缓 30 秒并优先探测其他地址；下一请求重新探测。未添加业务 POST、一次性 ticket、CONNECT permit 的自动重放。已有直连 Binance 与网关之间的 GET 竞速及私有请求重新签名边界保留。
- 网关 WebSocket 沿用已有 `lookupProvider`，新连接可复用选择结果；已有长连接不强制中断。新增完整握手默认 8 秒截止时间，断线重新选择地址、获取新的一次性 ticket；正常取消订阅不会误清其他连接的选路缓存。
- 私有代理仅对外层 TLS 使用选路；CONNECT 内层仍验证 Binance 原域名证书，允许的账户目标和 GET-only 边界不变。真实账户查询、交易操作与带票据行情订阅没有作为匿名验收执行。
- 生产候选仅对这两个确切生产 origin 启用。自定义网关保留原传输。停用自动选路时应同时将解析候选还原为原入口，避免仍使用 `haolo.com` 的地址：`HAOLO_BINANCE_GATEWAY_ROUTE_SELECTION=false`，`HAOLO_BINANCE_MARKET_GATEWAY_RESOLUTION_CANDIDATES=8.219.93.44`；或恢复原部署 JSON。

## 实测结果

测试在当前 Windows 机器执行，curl 明确使用 `--noproxy '*'`，同一轮交替测试原入口与两个 GA 地址，保持原 Host/SNI 和证书校验；每个网关/地址 4 次。数值为健康请求完整耗时中位数，不是行情业务、登录、真实模型推理或所有国内运营商的 SLA。

| 健康接口 | 原入口 | 香港 GA 47.75.103.197 | 香港 GA 47.75.125.102 |
| --- | ---: | ---: | ---: |
| 行情网关 `/health` | 823 ms | 157 ms | 144 ms |
| 账户代理 `/health` | 1161 ms | 146 ms | 139 ms |
| 东京模型网关 `/health` | 1067 ms | 179 ms | 163 ms |

24 次行情/账户健康检查全部 HTTP 200。模型测试使用现有实例额外的临时 TCP 8443 → 东京源站 443 映射，保留 `haolo.pro` TLS 身份。GA 的 8 次模型健康请求均 200，8 次无凭据 `/v1/models` 均按预期 401；原入口无凭据 API 的 4 次中有 1 次连接超时，其他为 401。未发送模型提示词或消耗推理额度。

真实客户端传输还经过 Node 与 Electron 内置 Node 两次线上校验。Electron 选中香港地址，首次行情健康请求约 154 ms，保持连接的后两次约 51 ms；账号的独立 Electron 网络测试 8 项通过，包括禁用代理的真实 API 和 DNS/TLS 故障后的回退。

## 验证与证据

- 86 项相关 Node 测试通过（选路、故障、并发、证书边界、禁止业务重放、私有代理、自定义入口混用、现有账号网络和更新下载回归）。
- 类型检查、Vite 构建、生产 URL 校验通过。Vite 存在已有的大分包提示，不影响本次构建成功。
- 可重复执行匿名线路测试：`node scripts/smoke-binance-gateway-routes.mjs --live --report=<本机报告路径>`。
- 原始结果保存在本机 `D:/CodexData/tmp/haolo-desktop-premium-20260914/`：`health-routes.json`、`gateway-node-smoke.json`、`gateway-electron-smoke.json`、`account-electron-smoke.json`、`model-route-measurements.json`、`model-route-summary.json`。
- 模型临时测试已于北京时间 21:06:55 完成清理，`model-trial-cleanup.json` 确认原官网 GA 监听和终端节点配置与测试前相同。创建/删除回执及配置核对保存在相同目录。正式模型域名、账号域名、模型后端及官网服务未因本次临时测试切换。

## 正式接入与费用边界

行情和账户代理复用现有网站 GA，免新增实例固定费，但增加按量流量及 CU 消耗，并共享当前 20 Mbps 峰值；不是无限流量，不能保证沿用网站原估算费用不变。

用户随后明确同意继续配置模型入口。独立模型 GA `ga-bp14zzayuc7y0tckkciew` 已正式接入，香港 BGP_PRO 20 Mbps，TCP 80/443 转发到东京 `8.216.43.79`。两个入口 `47.57.243.152`、`47.75.126.250` 已通过匿名协议、证书、源 IP 保留、ACME 验证路径和 30 秒空闲连接保持检查，测试 ACL 已移除。用户已将 Cloudflare 根域名改为这两条 A 记录（仅 DNS / 灰云）；权威 DNS、阿里 DNS、腾讯 DNS 均确认生效。本机与独立新加坡服务器通过正常域名访问健康接口为 200、匿名模型接口为预期 401。切换后约 196 秒观察窗口内，排除部署探测后已有 22 次真实模型请求返回 200，未观察到模型接口 5xx。没有使用真实凭据另行执行模型生成/SSE 测试。模型 URL 保持不变，使用该 URL 的已安装客户端在 DNS 缓存更新后也能受益，无需为这一项单独更改客户端地址；行情自动选路源码仍待客户端版本发布。

按 2026-09-14 官方目录价，单个 GA 实例固定费 `0.137 元/小时`，30 天约 `98.64 元`，另计 CU 和 CDT 流量。香港 BGP_PRO 首档公网单价 `3.00 元/GB`，亚太区内跨地域单价 `0.525 元/GB`，标准型当前处理数据 CU 单价 `0.386`。上下行、跨地域计费口径不同，不能将下载字节数简单视为完整账单，也没有自动的每月硬性费用上限。新增模型实例的持续费用已获用户确认，自北京时间 2026-09-14 21:15:45 开始在阿里云 haolo 账号 `1836487315969791` 按量计费，与官网实例分别计算。

模型正式接入配置和手工 DNS 回退步骤见本机 `D:/zhongzhuan/deploy/ga/README.md`，私有验收证据保存在 `D:/CodexData/tmp/haolo-model-ga-20260914/`。没有 Cloudflare API 凭据，不能自动回退 DNS；已发出切换指引后禁止自动删除仍可能被 DNS 引用的模型 GA。

官方计费依据：[GA 按量付费](https://help.aliyun.com/zh/ga/pay-by-data-transfer-1/)、[CDT 公网流量](https://help.aliyun.com/zh/cdt/internet-data-transfers/)、[CDT 跨地域流量](https://help.aliyun.com/zh/cdt/inter-region-data-transfers)。目录价供估算，最终以购买页和实际账单为准。
