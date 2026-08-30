# 桌面客户端更新下载加速操作手册

## 当前问题

Windows 更新接口当前返回约 197 MiB 的完整安装包，文件位于：

```text
https://youlebucket.oss-ap-southeast-1.aliyuncs.com/app-updates/windows/<version>/<installer>.exe
```

`oss-ap-southeast-1` 是阿里云新加坡地域。中国大陆用户下载大文件时会经过跨境公网链路。桌面客户端现已改为使用 Electron Chromium 网络栈，并支持 Range 断点续传、三次自动重试和 60 秒无数据检测；但真正改善所有国内用户速度，仍需把更新接口返回的文件地址切换到加速或境内链路。

## Web3 更新通道隔离

标准版与 Web3 版共用 OSS Bucket，但不能共用发布记录。旧客户端不带客户端类型时固定进入 `haolo_windows` 通道；Web3 客户端、官网 Windows 下载和发布脚本必须显式携带：

```text
client_variant=haolo_windows_web3
```

Web3 对象使用独立路径，避免相同版本号或文件名覆盖标准版：

```text
app-updates/windows/<version>/haolo_windows_web3/<installer>.exe
```

发布脚本会在上传前检查后端响应中的 `client_variant`。如果生产后端尚未支持隔离通道，脚本必须停止，不能退回标准版发布流。

## 方案 A：当天可完成，启用现有 Bucket 的传输加速

适合先快速缓解，不迁移现有对象。传输加速会产生额外流量费用。

> 2026-07-21 实测 `youlebucket.oss-accelerate.aliyuncs.com` 已能对当前安装包返回 `206 Partial Content`，说明该 Bucket 的传输加速已经生效。可以直接从第 4 步开始验证和灰度切换。单次测速会受本机代理和运营商瞬时路由影响，必须以三家国内运营商的多次测试结果决定是否全量切换。

1. 登录阿里云 OSS 控制台，打开 Bucket `youlebucket`。
2. 进入“Bucket 配置”→“传输加速”。
3. 开启传输加速并确认，等待约 30 分钟生效。
4. 用当前发布对象验证加速域名：

   ```text
   https://youlebucket.oss-accelerate.aliyuncs.com/app-updates/windows/0.1.156/haolo_desktop-0.1.156-Setup.exe
   ```

5. 修改更新服务生成 `download.url` 的配置或代码，把下载基础域名从：

   ```text
   https://youlebucket.oss-ap-southeast-1.aliyuncs.com
   ```

   切换为：

   ```text
   https://youlebucket.oss-accelerate.aliyuncs.com
   ```

6. 不要修改对象路径、文件大小和 SHA-256。更新检查接口仍由 `https://haolo.com` 提供。
7. 如果发布服务会把完整 OSS URL 持久化到版本记录，需要同时更新最新版本记录或重新发布该版本元数据，确保接口实际返回新域名。

旧版客户端没有下载域名白名单，只要求 HTTPS 和 Windows 包以 `.exe` 结尾，因此服务端切换下载 URL 后可立即覆盖现有用户。

## 方案 B：长期推荐，迁移到中国大陆 OSS + 下载域名

1. 在深圳或杭州创建专用 Bucket，例如 `haolo-app-updates-cn`。
2. 将 `app-updates/` 前缀下的 Windows 和 macOS 发布对象同步到新 Bucket。
3. 将已完成 ICP 备案的 `download.haolo.com` 绑定到新 Bucket，并配置 HTTPS 证书。
4. 如更新量较大，在自定义域名前接入阿里云 CDN；版本化安装包路径应设置长缓存，更新检查 API 保持 `no-store`。
5. 修改发布上传流程，使新版本优先上传境内 Bucket；建议在过渡期同时上传境内和新加坡 Bucket。
6. 更新服务向国内用户返回：

   ```text
   https://download.haolo.com/app-updates/windows/<version>/<installer>.exe
   ```

7. 新加坡地址作为回退源保留至少两个发布周期。

## 切换前验证

检查更新接口实际返回的域名：

```powershell
curl.exe -sS "https://haolo.com/api/app-updates/windows/check?version=0.1.155&client_variant=haolo_windows_web3"
```

验证服务支持断点续传；预期状态码为 `206`，响应包含 `Content-Range`：

```powershell
curl.exe -sS -D - -o NUL --range 0-1048575 "https://download-host/app-updates/windows/<version>/<installer>.exe"
```

只下载前 20 MiB 进行测速，不必下载完整安装包：

```powershell
curl.exe -L -sS --range 0-20971519 --output NUL --write-out "http=%{http_code}`ntime_starttransfer=%{time_starttransfer}`ntime_total=%{time_total}`nspeed_bytes_per_sec=%{speed_download}`n" "https://download-host/app-updates/windows/<version>/<installer>.exe"
```

至少分别使用中国电信、中国联通和中国移动网络测试。验收时同时确认：

- 文件总大小与发布记录一致；
- SHA-256 与发布记录一致；
- Range 请求返回 `206`；
- 更新中断后重新点击可以从 `.part` 文件继续；
- 下载完成后安装器能够正常拉起。

## 回滚

如果加速域名异常，只需让更新接口重新返回原来的新加坡 OSS URL。客户端的 `.part` 文件会在服务端不接受旧断点时自动从头重下，不会把不完整文件当作安装包执行。
