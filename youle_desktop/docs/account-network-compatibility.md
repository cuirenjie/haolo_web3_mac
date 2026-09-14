# 账号网络兼容与直连容错

2026-09-14 个别 Windows 用户的现场现象：浏览器可访问，登录、充值、更新失败；curl 对两个 GA IP 和源站的直连均在 TLS 建连时被重置，PowerShell 默认系统网络路径成功。Clash Verge 仅系统代理＋全局模式无法恢复，开启 TUN 后恢复。

## 实现边界

- 账号、登录、会话刷新、充值、联系人、材料元数据、消费导出、账号事件流，以及 Windows/macOS 更新检查，使用 `haoloServiceFetch`。
- 业务请求进入独立、非持久化的 Electron session，明确使用 `system` 代理模式。系统未设置代理时直连；设置代理/PAC 时由 Chromium 处理。发生可恢复连接错误时重新读取代理状态，GET/HEAD 最多自动重试一次；不关闭整个应用的连接池。
- 保留现有 `appNetworkFetch` 和模型、交易所、行情、外部渠道及签名文件上传路径。`YouleApiClient.serviceFetch` 专门用于业务 API，原 `networkFetch` 继续负责对象存储上传。Node 工具/测试未注入 `serviceFetch` 时仍使用 Node fetch。
- 保留规范服务地址 `https://haolo.com`。冷启动或线路缓存到期时，通过无账号凭据的 `/api/auth/config` GET 验证可达性与响应形状。主入口遇到网络故障时尝试 `https://www.haolo.com`；它们已在现有服务器上指向同一业务后端，证书覆盖两个域名。
- 实际业务请求只替换已确认的备用 origin，保留路径、查询参数、请求体及鉴权。自定义服务地址、非 `/api/` 路径、模型域名、对象存储 URL 不使用该备用入口。
- 单个线路探测上限 3.5 秒；并发请求共享探测；线路缓存 60 秒且不会因持续流量无限延长，过期后重新优先检查主入口。全不可达时短暂抑制重复探测。
- 匿名配置探测的 429/5xx 可以继续验证备用入口，并为失败入口单独冷却；冷却遵守 Retry-After（秒数或 HTTP 日期），至少沿用默认 3 秒退避。备用线路缓存到期不会清除原入口的冷却；401/403/404、证书错误和错误服务身份继续拒绝。该策略不改变实际业务 HTTP 响应或业务写请求的重放规则。
- POST/PATCH/PUT/DELETE 在提交前选择可达线路，提交失败后不自动重放到另一条线路，以免验证码、支付或其他写操作重复。既有基于明确 401 响应的会话刷新逻辑保留。
- 不因业务 HTTP 错误切换线路，不跳过证书验证，不降低 TLS 版本，不篡改系统代理/DNS/hosts，不自动绕过用户已配置的代理。
- 更新检查的超时覆盖响应体读取；响应损坏不会被当作“没有更新”。保留 Chromium 网络错误码及取消/超时分类。
- 网络恢复日志写入已有的 `logs/app-server.log`，只包含事件、origin、HTTP 方法、错误码和尝试次数，不包含查询参数、请求体、凭据或原始错误详情。

## 验证

```powershell
node --test test/system-proxy-fetch.test.mjs test/haolo-service-fetch.test.mjs test/youle-api-service-transport.test.mjs test/youle-api-client.test.mjs test/app-update-downloader.test.mjs test/binance-gateway-main-wiring.test.mjs test/model-request-compression.test.mjs
pnpm run typecheck
pnpm run build
```

真实 Electron 测试（离线部分的所有写请求只发送至本机模拟服务器；不修改 Windows 系统代理）：

```powershell
node_modules/electron/dist/electron.exe scripts/smoke-haolo-service-network.mjs --report=network-smoke.json
```

加 `--live` 会额外对公开配置和更新检查接口发送匿名 GET，验证本机无应用代理的 HTTPS，以及故障主域名到真实备用入口的切换。它不会发送真实验证码、支付或下载更新安装包。

本次验证结果：155 项针对性回归测试通过，类型检查通过，Vite production build 通过（184 modules，保留已有的大 chunk 提示），`git diff --check` 通过。Electron 39.8.10 的 8 项实际请求检查通过：无代理直连、Node 直连失败而 Electron 代理可达、OTP/充值/导出/事件流、运行中代理恢复、写请求不重复提交、公开 API 直连、真实 TLS 备用入口，以及 TLS 握手超时后的备用入口恢复。

## 仍需现场验收的部分

原故障电脑已不可用，不能宣称完成其无代理复测，也不能保证所有国内运营商线路都可达。`www.haolo.com` 与主域名使用相同 GA IP，属于域名入口容错，不是独立网络灾备；两入口同时受阻时仍需要新的可达网络入口。禁止为掩盖这类故障而关闭 TLS 验证、恢复旧服务器或悄悄使用模型/邀请中心域名处理账号凭据。

本次仅修改客户端源码；安装用户需要后续打包发布新版本才能获得修复。
