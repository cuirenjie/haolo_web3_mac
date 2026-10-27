# Windows 0.1.182 与 Android 0.1.13+14 正式发布

Windows 0.1.182 与 Android 0.1.13+14 已正式发布。旧版检查返回强制更新，最低支持版本分别为 0.1.182、build 14；当前版本不重复提示。官网完整下载后的字节数和 SHA-256 与同次签名产物一致。

更新说明：解决了一些已知的bug，优化了盈利概率卡片，使模型推算盈利概率更加准确。

| 项目 | Windows | Android |
| --- | --- | --- |
| 构建源码 | `f7e748f9a79514290eb0e652b974440ec6185975` | `ef4a6f5b3082ea3776986b4dafd6deae2631b026` |
| 版本提交 | 版本已包含在构建提交 | `5a0377e289c1075472b4492832eb3d6cf8c2ef05` |
| 发布记录 | `203844fb-9c83-472e-a6ae-4cf853763e6b` | `44860594-5e94-47e1-8de0-2a0e7993cf1f` |
| 字节 | 251469504 | 98153800 |
| SHA-256 | `eb8fbff6d784612732fb51fea32bc0efe743631f75badb176fa6822a2036c2b9` | `6e4cee1d8a6bb59f14fa58bec0a75c77017771009567b7339bf9b79c4cdeb16d` |
| 客服 contract | `2e6542246f34f8ef1a9ecf46363c6f574ac570b35a94eb92c7168083203445f3` | `55298dfb1f211b62b77ae3d936516fb268e3ab9edf7f120e71705a481802e3e6` |
| 官网入口 | [Windows](https://haolo.com/api/app-updates/windows/latest/download?arch=x64&client_variant=haolo_windows_web3) | [Android](https://haolo.com/api/app-updates/mobile/android/latest/download?channel=direct) |

本会话负责本批客户端发布，保留同步概率回滚及此前已完成修复；移动端并入 UI-PLAN-CARD-PREPARING-001。源码均已推送各自 origin/dev，不包含业务后端、网站或独立网关部署。验收读取生产 API 为 `bddf77eb0b4468b60e78f55eeaf802c088cecb54`。

Windows 主程序、native host、NSIS 安装器和卸载器的 Authenticode 均为 Valid，EV、SHA-256、可信时间戳和固定发布者指纹 `EC6346287B2F343CB7BFA4CF4CAB7DB02379A0AD` 全部通过。两次 DigiCert 时间戳失败后，按官方 EV Sign CLI 支持的 auto 参数恢复；默认配置和证书校验保持，不使用 API 回退、不关闭时间戳。失败及成功日志均保留。47 项功能回归、16 项签名回归、类型检查及正式构建通过，47 个运行时文件核验通过。

Android 正式证书 SHA-256 为 `b577aab50b7a5453c21800678874c74d45303489b45d3ee517833467bc747cf4`，三种 ABI、非 debuggable、16KiB 对齐、717 项资源及包内版本校验通过。标准构建器在源码提交后自动递增 pubspec，故 build-report 的 source_dirty=true 仅对应版本回写；版本随后单独提交，source_stable_during_build=true，完整产品输入清单保留。未从后续提交重生成知识包。

发布核验发现韩语／日语手动更新请求使用生产接口未支持的说明语言会返回500，MOB-UPDATES-003 已按接口既有三语能力回退，与原生更新器一致；五语界面不变。515 项初轮 Flutter 回归、修复后 47 项更新回归（46 项重复、1 项新增，共516个不同用例）、全 lib 静态分析及168项图表测试通过。三种受支持说明语言的线上返回均与本次文字一致。

两端精确版本、contract、源码和七种动作的生产知识包均 active，包内容及摘要匹配，错误 contract 被拒绝。基于实际生产知识向真实上游模型输入合成请求“设置K线红涨绿跌”，返回 set_candle_colors；随后使用正式 ASAR renderer 验证授权显示、拒绝不执行、接受后操作真实控件和持久化，16项通过。此 UI 的 consent HTTP 使用隔离夹具，未创建生产客户会话或消息，不宣称真实客户全链路已验证。

Windows 上传返回 HTTP 504 后，先只读确认现有发布记录，再使用维护中的 verifyPublication / verifyWindowsSupport 校验函数恢复回执；无重复上传。Android 标准发布器正常完成上传、草稿策略校验和发布，回执 activated=true，生产状态 published。所有原包、签名和发布失败日志保留，没有覆盖旧版本。

2026-10-27 13:08 +08:00 经标准 Run-Mobile 链路，保留数据覆盖安装并重启本机 Android 开发签名包 0.1.13+14。PID5385、真实前台焦点、NVIDIA 宿主 OpenGL、1004项输入未变及启动异常0均确认；本地／设备 APK SHA-256 同为 `994a9a32d7fd8dd511dfb920c4cd528245dbd40564b410a1862c0339ed8a828e`。正式证书 APK 单独保留用于渠道发布，没有清数据替换开发证书。移动端未用 Computer Use，观感交用户；iOS共享源码已提交，但未签名构建或原生验收。短时启动不代表长期稳定。

Windows 产物及原封 sidecar 位于 `youle_desktop/release/haolo_desktop-0.1.182-Setup.exe*`；Android 位于规范移动仓库 `release/android/0.1.13+14/`。安装包和配套凭据已另存桌面“好咯最新安装包”。

机器凭据：[签名、摘要、发布与验收记录](verification/windows-release-0.1.182-20261027.json)。原始日志：`youle_desktop/release/build-0.1.182-20261027/`、`.codex-tmp/release-182-20261027/`。
