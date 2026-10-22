# Windows 0.1.179 正式发布

日期：2026-10-22。任务 M1-435；用户指定版本 179 并授权打包后发布官网。负责人：会话 `01a15fa6-45fa-75e3-8c09-60c9920eec4e`。

## 范围与源码

- Windows x64 Web3 渠道 `haolo_windows_web3`，版本固定 `0.1.179`，生产业务地址 `https://haolo.com`。
- 基于已推送 `2d867e503e5d00d1a8169dc08a95af788638c76b`，包含指标审阅证据一致性、左右侧条件预案与绘图播放、K 线拖动惯性改进；纳入原开发会话已完成且经本轮复核的 AppData 历史恢复修复。
- 本次修正测试源码切片对 CRLF 的兼容，重新编译自有 Chrome native host。原语音资源本地换行状态保留，47 项内核运行资源原始哈希全部匹配。
- 全量测试 4888/4888、TypeScript、生产构建通过。首次环境失败与修正后回归日志分别保存于 `.cache/release-0.1.179-20261022/`。Vite 保留大 chunk 提示。
- 客户端发布不重启或部署 API、策略 Worker、官网静态页面、邀请中心与模型网关。发布前核验依赖版本与公开更新渠道；使用 SSH 路线提交既有更新管理接口。
- 0.1.178 升级到本版为普通更新；保留此前低于 0.1.178 必须升级的门槛。
- 300 条画线重压性能仍有两项未达到严格 P95 < 50ms 门槛，不宣称全部负载稳定 60fps；详见 `trading-chart-momentum-20261022.zh-CN.md`。

## 公开更新说明

### 简体中文

- 优化 K 线拖动与松手后的惯性滑行，减少起步延迟，改善横向滚动和密集画线场景的响应。
- 左右侧分析在暂无合格机会时展示条件预案、待满足条件与确认步骤；交易偏好保留左侧和右侧，历史自动偏好兼容为右侧。
- 修复减少动态效果设置下 AI 绘图一次性出现的问题，保持逐个对象展示。
- 修复部分 Windows AppData 重定向环境中新任务历史读取失败的问题。
- 统一指标联合审阅的证据名单，减少合法分析结果因证据引用遗漏而失败。

### English

- Improve chart dragging, momentum after release, horizontal scrolling, and responsiveness with dense drawing layers.
- Show conditional watch plans, unmet conditions, and confirmation steps when left-side or right-side analysis has no qualified opportunity. Trading preferences now offer left and right; legacy automatic preferences use right-side behavior.
- Show AI drawings one object at a time when reduced motion is enabled.
- Fix new-task history loading in Windows environments with redirected AppData paths.
- Align evidence lists used in combined indicator review to prevent valid results from failing because of omitted evidence references.

### 繁體中文

- 優化 K 線拖曳與放手後的慣性滑行，減少起步延遲，改善橫向捲動與密集畫線時的反應。
- 左右側分析在暫無合格機會時顯示條件預案、待滿足條件與確認步驟；交易偏好保留左側與右側，歷史自動偏好相容為右側。
- 修復減少動態效果設定下 AI 繪圖一次出現的問題，維持逐個物件顯示。
- 修復部分 Windows AppData 重新導向環境中新任務歷史讀取失敗的問題。
- 統一指標聯合審閱的證據清單，減少合法分析結果因證據引用遺漏而失敗。

## 发布验收

已完成官网发布。发布记录 ID：`84e31841-b7cf-4971-9deb-cfa24c5bb4df`；源码完整 SHA：`0ad3e758da51f5cddda637a65333a79a7efd9f22`，已推送 origin/dev。后续文档提交不改变安装包字节。

- [官网最新版入口](https://haolo.com/api/app-updates/windows/latest/download?arch=x64&client_variant=haolo_windows_web3)；[0.1.179 签名包](https://assets.haolo.com/app-updates/windows/0.1.179/haolo_windows_web3/haolo_desktop-0.1.179-Setup.exe)。大小 **247850488 字节（236.37 MiB）**；SHA-256：`89d0b5cf6ca3da8af5623e3ef338f8adf0dbd4121c4849fe913b99cd8d843594`。
- 主程序、Chrome native host、卸载程序副本和安装程序四项 EV 签名通过：Keroro Software Ltd、固定指纹、SHA-256、可信 DigiCert 时间戳与 Authenticode 均有效。
- 包内 289 项源码／渲染资源、323 项附加资源一致；内核 0.163.0 的 47 文件哈希及所需 OpenAI 签名通过。第三方资源保持原始字节；私有策略与敏感文件边界审计通过。
- 封装 ASAR 在隔离 Electron 中启动通过，登录页已检查，17 项云端目录及未登录鉴权边界正常，无启动错误。
- 真实签名安装器通过生产下载器的本地镜像失败回退与 1 MiB 断点续传；解包后 398 文件逐一匹配，1491 项包边界审计通过。
- 公开官网脚本、最新入口 302、完整下载大小／SHA-256、HTTP Range 206、blockmap 内容与解析验证通过；177 仍需更新，178 普通更新，179 不重复提示，标准版渠道保持。三语公开更新说明在规范化 multipart 换行后逐字匹配。
- API 实际运行 `c6aa46bd8108450825592a57ec3e50e80551ef56`（1038 文件），独立策略 Worker `0b07c81a0d26f4f95d5c0783c44daa8ebd3db0f4`（1036 文件）。双端各 397 个相关运行文件与已验收条件计划版本一致、各 116 项条件计划／偏好检查通过；唯一消费者及协议就绪。两端回执 complete。上传期间另一会话将 API 从 333c4f9 更新到 c6aa46bd，并更新金融 Worker；已在新 API 上重新执行完整运行文件及上述兼容检查，没有恢复或覆盖其他发布。独立策略 Worker、数据库、Redis 和入口代理四个实例保持。
- 发布全程使用 SSH 隧道及既有更新管理接口。迁移来的本地更新凭据首次被 HTTP 401 拒绝，确认未创建发布记录；随后经 SSH 读取当前服务凭据，仅在内存中使用，重试成功。本地旧凭据文件保持，任何凭据均未写入包、源码或日志。
- 桌面副本：`C:/Users/joiec/Desktop/好咯最新安装包/haolo_windows_web3/`。构建、失败日志与详细回执保留于 `release/build-0.1.179-production-20261022/` 和 `.cache/release-0.1.179-20261022/`。
- [机器验收回执](verification/windows-release-0.1.179-20261022.json)。未执行真实系统安装升级、登录后线上分析或消息发送，隔离验收不冒称这些行为。
