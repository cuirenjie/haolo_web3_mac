# 国内网络与香港加速覆盖审计（2026-09-14）

关联任务：`M2-020`。本轮继续优化 Web3 客户端网络，代码位于 `haolo_windows_web3/youle_desktop`。业务后端的代码源仍为 `haolo_front_web3/youle_mas-dev/backend`，未修改旧后端仓库。

## 线上入口与覆盖范围

| 功能 | 当前入口及覆盖 | 验收状态 |
| --- | --- | --- |
| 官网、帮助中心、账号、登录、会员、更新查询 | `haolo.com` → 原官网香港 BGP_PRO GA | 原有线上加速保留；本轮更新查询 HTTP 200，约 206–216 ms |
| 模型 API、流式模型连接 | `haolo.pro/v1` → 独立模型香港 BGP_PRO GA | 前一阶段已完成正式切换；本轮没有改动模型实例或服务 |
| Binance 现货/合约公共 REST | `market.youle.pro` → 官网 GA | 用户已修改 DNS；权威、阿里 DNS、腾讯 DNS 已返回两个 GA IP，正常域名 HTTPS 健康检查 200 |
| Binance K 线、逐笔成交、盘口、ticker 与订单流 WebSocket | 同一行情网关；通过 `TradingMarketDataHub` 复用 | 主图、分屏、预警共用 Hub；无 ticket 的正式域名升级请求返回预期 401。真实带票据收帧等待有效客户端登录 |
| Binance 账户只读 GET | `sg-a.binance-egress.waduo.com` → 官网 GA，CONNECT 内层连接 Binance | 用户已修改 DNS；权威及两家公共解析均确认新 IP；22:06:53 正常域名 HTTPS 健康检查 200、无 permit 的 CONNECT 407 已确认连接香港 GA |
| iFinD / Finnhub 股票行情 | `haolo.com/api/market-data/ifind`、`/finnhub` | 已经由账号业务后端转发，客户端到业务后端走官网 GA |
| 邀请中心 | `invite.haolo.com` → 官网 GA | 本轮完成两条 A 记录切换；正常域名首页、认证配置均 200，内容哈希与源站一致；权威及两家公共 DNS 已确认新地址 |
| 帮助视频 | `video.haolo.com` → 既有阿里云 CDN | 保留已有视频 CDN，不与行情 GA 的 20 Mbps 共用大文件下载链路 |
| 更新安装包 | `assets.haolo.com` → 阿里云境外 CDN → 新加坡 OSS；备用地址直接 OSS | 已正式接入并验收。完整 202,316,435 字节与发布清单 SHA-256 一致，约 173 秒、平均 1.17 MB/s；22:38 权威、两家公共 DNS 及本机正常域名均确认 CDN，Electron 默认 TLS 验证和 Range 206 通过 |
| Hyperliquid 对比 K 线、预警历史和实时 K 线 | `https://api.hyperliquid.xyz/info`、`wss://api.hyperliquid.xyz/ws` | **仍为外部直连**。已补齐对比 K 线正文超时/并发去重，以及独立预警适配器的正文/WS 握手截止时间和旧连接隔离；最新预警实测历史读取约 645 ms、首帧约 1.8 秒 |
| 用户自填模型供应商、Telegram、外部文档和浏览器链接 | 对应第三方域名 | 不属于当前自有 GA 转发范围；不能把第三方主机名直接解析到 HaoLo GA，否则证书和服务身份不匹配 |

官网、行情、账户代理及邀请中心复用 `ga-bp1qpo5ux7is7siw0gh3o`，入口为 `47.75.103.197`、`47.75.125.102`，回源 `8.219.93.44`。模型使用独立 GA，入口为 `47.57.243.152`、`47.75.126.250`，不能混用。此轮没有新增 GA 实例固定费，流量和 CU 仍按既有规则计费。

## 本轮客户端修复

1. 两个行情网关的候选列表加入现有 GA 的两个已验证 IP，同时保留域名发现及原服务器候选。即使域名解析挂起，新版源码仍能独立检查 GA。探测保持原 Host、SNI、HTTPS 证书校验及服务身份校验。
2. HTTP/WS 连接失败后清除对应选路缓存，失败 IP 暂缓 30 秒，优先探测其他地址。如果只有该地址恢复可用，重新健康检查后仍可使用。旧连接迟到的失败不会清除刚选出的另一条线路。HTTP 正文中断也会清除故障地址；调用者主动取消、响应大小限制等本地错误不淘汰健康线路。
3. WebSocket 增加 8 秒完整握手截止时间，覆盖 DNS、TCP、TLS、HTTP Upgrade；断线重新选路并获取新的一次性票据。正常取消订阅不会误淘汰其他订阅使用的线路。
4. 行情 ticket、账户代理 permit 和 usage 上报使用独立的默认 8 秒截止时间，覆盖账号令牌获取、HTTP 和 JSON 正文，不再共用大型行情数据的 45 秒超时。到期后迟到的令牌不会发起新请求；不自动重放这些 POST。
5. Binance 直连探测只将 HTTP 200 视为健康，429/5xx 不会解除网关优先状态。公共行情 GET 的直连 5xx 不会抢先击败健康网关响应；账户签名/GET-only 边界不变。
6. Hyperliquid 相同参数的并发 K 线读取共用一次下载，返回独立的数据副本；保留 15 秒缓存和容量上限。12 秒超时现在覆盖正文读取，失败后解除并发占用，后续用户请求可以重新尝试。
7. Hyperliquid 预警是另一条独立连接，已补齐默认 12 秒历史请求正文截止时间、默认 8 秒完整 WS 握手截止时间、握手失败终止和重连；旧 socket 的迟到 open/message/error/close 不再影响新连接，取消订阅会清理握手、心跳和重连定时器。不重放历史查询 POST。

客户端仍按实际可用性与延迟选路。境外或本地直连确实更快时可保留直连；国内直连失败、缓慢或被拒绝时使用香港网关。没有扩大订单执行权限，也没有向新第三方发送账号凭据。

## 验证结果及限制

- 最终网络与预警专项 **120/120 通过**，覆盖选路、DNS 卡住、连接切换、WS 握手、迟到事件、票据超时、公共 5xx、账户只读代理、更新下载、Hyperliquid 请求并发/超时及预警服务回归。
- 扩展运行原 ICT/SMC 测试时为 107/108；唯一失败是既有 `SMT wiring...` 源码断言将 ICT 英文说明中的 `order-flow` 字样误判为依赖。被断言的 ICT 文件及该测试文件本轮均未改动。随后新增的公共 5xx、正文中断和预警超时用例已纳入最终 120 项专项。此处不宣称全仓测试通过。
- `pnpm run typecheck`、`pnpm run build`、生产默认 URL 校验和 `git diff --check` 通过。Vite 184 modules 构建保留原有大分包提示。
- 新源码在本机无代理传输实测选中两个香港地址；复用 HTTPS 连接后的匿名健康请求约 **58–62 ms**。这是健康接口耗时，不是行情首帧时间、模型推理延迟或各省运营商的服务保证。
- 北京时间 22:06:53，两个行情域名均通过权威 DNS、阿里 DNS、腾讯 DNS、系统正常域名 HTTPS 和匿名 WS/CONNECT 检查；实际连接对端为 GA IP，证书验证开启。邀请中心于 22:05 完成相同入口及内容一致性验收。
- 北京时间 22:38:30，本机上游的 assets 旧解析缓存到期，正常域名解析到 CDN `163.181.35.239`。22:38:33 开始的最终检查确认两个权威服务器、阿里 DNS、腾讯 DNS 均返回 CDN CNAME；独立 Electron 和 Python 正常域名下载 1 MiB 均为 206、命中缓存、哈希相同，分别约 2.37 秒和 2.27 秒。两者均保留各自默认 TLS 验证。
- 带真实账号的公共行情 REST、现货/合约 WS 与授权 CONNECT 验收脚本已准备；现有客户端会话过期，等待用户重新登录。脚本只读取当前有效会话，不创建测试身份、不修改用户会话、不查询账户资产或下单，不输出 token/ticket/permit。
- 对边缘服务器 5 个有关容器核对了镜像、启动时间和重启次数，均与开始前一致。此轮没有部署或重启网关、官网、邀请中心容器。
- **源码未打包、提交、推送或发布为新客户端。** DNS 切换可以惠及使用这些域名的现有客户端；新增选路和超时修复需要后续客户端发布。
- 尚未完成移动/联通/电信不同地区实测及 72 小时运行验收；`M2-013` 不应因此标记完成。
- 测试显式绕过应用代理，但未改动系统网卡、VPN/TUN 或路由设置，因此只代表本机当时的实际网络路径，不能当作三网独立测试结果。

## 剩余接入项

安装包 CDN 已取得用户授予的单域名权限，使用账号 `1836487315969791` 已开通的按流量计费服务，新增境外 `download` 域名 `assets.haolo.com`，回源原新加坡 OSS。开启 HTTPS 回源、Range、HTTP/2；只对 `/app-updates/` 版本目录缓存 30 天，其余路径默认不缓存。复用现有匹配证书，所有配置均下发成功。CNAME 已切换为 `assets.haolo.com.queniuaa.com`，备用 OSS URL 和发布记录保持原样。

切换前用独立 Electron Chromium 进程按原域名/SNI 连接两家公共 DNS 返回的 CDN IP；没有关闭证书校验。1 MiB 首段及 1 KiB 尾段与源站一致；0.1.167 全文件为 202,316,435 字节，SHA-256 `4b62a04bd2b346795b0efb82c03d6e104e44be8dfcbbb5e3a505a6889fbf05b1`，全程约 173.21 秒、1.17 MB/s。热缓存 1 MiB 为 1.63 秒，同轮源站为 12.08 秒，属于本机单次对比，不能外推为各省固定加速倍数。没有运行所下载的安装程序。

Windows curl 在 CDN 域名上曾因 Schannel 无法访问证书吊销服务器返回 `CRYPT_E_REVOCATION_OFFLINE`；Python 默认 CA/主机名验证及客户端实际使用的 Electron Chromium 默认验证通过。保留失败记录，没有使用 `-k`、禁用吊销检查或忽略证书错误。尚未证明所有 Windows 网络的 Schannel 调用均正常；生产更新器使用 Chromium 网络。

该下载线路是独立境外 CDN，不是行情香港 BGP_PRO GA，不占用当前共享 20 Mbps 行情链路。没有购买资源包或新增 GA 实例。按[阿里云 CDN 官方目录价](https://cn.aliyun.com/price/detail/cdn)，AP1 首档下行流量为 0.58 元/GB，另计 HTTPS 请求及 OSS 相关费用；实际按服务区域和账单计费，没有自动月费硬上限。主站与模型 GA 的既有费用不变。

Hyperliquid 若需香港加速，需要在受控后端增加仅允许公开 `candleSnapshot` 和 K 线 WS 订阅的认证转发，限制币种/时间窗口/响应大小/并发并落实限流；不能开放任意目标代理。现有 Binance 网关允许列表不包含该服务，本轮未修改或部署该网关。这里保留为明确的未接入项，不能把本地超时优化记作已完成线路加速。

## 回退与证据

- 邀请中心 DNS 专用变更日志和回退脚本：本机 `D:/CodexData/tmp/haolo-client-network-audit-20260914/invite-dns-journal.json`、`invite_dns.py rollback`。回退只恢复本次 invite A 记录并删除本次新增记录，检查外部修改后执行，不触碰主站、邮箱和模型记录。
- 安装包 DNS 变更及回退：同目录 `assets-dns-journal.json`、`assets_dns.py rollback`，只恢复原 assets CNAME。先恢复 DNS，待缓存过期并确认没有引用后才可停用 CDN；不要立即删除仍被客户端 DNS 缓存引用的资源。验证文件为 `assets-cdn-preflight.json`、`assets-cdn-full-acceptance.json` 和 `assets-cdn-public-acceptance.json`。
- 两个用户管理的行情域名如需回退，恢复 A 为 `8.219.93.44` 并删除本次新增的另一条 A；Cloudflare 保持仅 DNS。当前没有 Cloudflare API 凭据及 waduo.com DNS 修改权限，不能自动回退用户管理的这两处 DNS。
- 如退役官网 GA，还必须同步移除打包配置里的固定 GA IP，不能只改域名后立即删除仍被客户端引用的实例。应先发布替代配置并确认客户端迁移。
- 原始测试及验收：`D:/CodexData/tmp/haolo-client-network-audit-20260914/`。公开文档不保存 AccessKey、用户 JWT、WS ticket、CONNECT permit、签名 URL、真实账户或完整响应数据。
