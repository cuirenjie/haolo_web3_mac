# Windows 0.1.177 正式发布（2026-10-21）

M1-419。用户明确授权将最新 Windows 代码提交远端 `dev`，指定正式版本 **0.1.177**，发布到 `haolo.com`，并在全部完成后关闭电脑。负责人为会话 `01a15a55-4033-7d70-944c-6d00a6654570`。源码固定为 `104945ccbf38685e6e1c162379cecaadcfb34333`；后续发布文档提交不改变安装包内代码。

## 交付与范围

- 官网及更新渠道：`haolo_windows_web3`、Windows x64，非强制更新。公开基线为 0.1.176；工作区原 0.1.178 是开发编号，本次按用户指定值构建 0.1.177。
- 包含远端原有的图表切换、持仓健康最终回答、账户今日盈亏与最终计划画线等修复，以及 M1-418：已处理入口在本轮所有答案顶部，分析与计划卡片在中间，重点直接回答在最后且默认可见，展开／收起仅影响过程消息。
- 安装包：`haolo_desktop-0.1.177-Setup.exe`，**247,922,992 字节**，SHA-256 `2d5a11848778868b61cd225998efa0f97a7e817990be6d2797dd46eb8652be6f`。
- 官网下载：https://haolo.com/api/app-updates/windows/latest/download?arch=x64&client_variant=haolo_windows_web3
- OSS 对象：`app-updates/windows/0.1.177/haolo_windows_web3/haolo_desktop-0.1.177-Setup.exe`；公开地址：https://assets.haolo.com/app-updates/windows/0.1.177/haolo_windows_web3/haolo_desktop-0.1.177-Setup.exe
- 发布记录 ID：`8a84675f-e515-4b8e-a62c-ab3f5a41d44f`。
- 本地构建目录：`release/build-0.1.177-production-20261021/`；桌面副本：`C:/Users/潘艳芳/Desktop/好咯最新安装包/haolo_windows_web3/haolo_desktop-0.1.177-Setup.exe`。旧桌面同版本 EXE 和校验文件保留为 `.before-20261021-production.bak`。

## 验收

- 4670/4670 全量测试、TypeScript 检查、生产 Vite 构建通过。首次测试发现 Windows Python 启动器不可用及一条旧布局源码断言；修正测试环境和对应断言后重跑全量通过。前端构建保留既有大 chunk 提示。
- EV Sign 官方 CLI 签署主程序、Chrome native host、卸载器、安装器，4/4 通过 Authenticode、SHA-256、EV 策略及 DigiCert 时间戳校验。发布者 Keroro Software Ltd，固定证书指纹 `EC6346287B2F343CB7BFA4CF4CAB7DB02379A0AD`。
- 280 个 ASAR 源文件、324 个额外资源与源码逐一匹配；Codex 0.163.0 的 47 个运行文件匹配 manifest。8 个第三方 EXE 原字节保留，其中 7 个 OpenAI 签名有效，原版 ripgrep 保持原始未签名状态。
- 实际封装 ASAR 在 Electron 中通过隔离启动、登录页及云端接口边界检查，截图已检查；未使用真实账户或下单。M1-418 的三语双主题 18 个展开／收起状态证据保留在 `.cache/answer-order-M1-418/`。
- 通过生产更新下载器进行镜像失败回退、1 MiB 断点续传及安装器解包；400 个文件与已验证的 `win-unpacked` 逐一匹配。
- 官网下载脚本、更新元数据、latest/download 跳转、完整下载 SHA-256、HTTP Range 206 和 blockmap 字节校验见最终机器回执。0.1.176 检测到更新，0.1.177 不重复提示，标准 `haolo_windows` 渠道保持原状态。

## 旧撤回记录的处理

2026-10-20 撤回的另一份 0.1.177 仍保留未发布数据库记录，旧 SHA-256 为 `60b5614efa17f3357ea71f78fb411dcff7197679aa6c83560b8200364cd5fa7a`，旧公开对象已删除。此处依据用户 2026-10-21 新的、明确指定 177 的发布指令，重新构建和签名本次完整源码，不恢复旧安装包。

先确认公开 CDN 与 OSS 源站旧对象均为 404，再将原始完整记录持久备份至 `/opt/haolo-backend/desktop-release-archives/0.1.177-withdrawn-20261020-original.json`。持有与发布接口相同的版本事务锁，逐项比较 ID、未发布状态、大小和 SHA 后，仅把该已撤回条目从发布索引移除；所有已发布记录保持，完整审计副本与回执保留。随后由正常管理发布接口写入本次新记录。

先前尝试给未发布记录添加归档后缀，被版本格式约束拒绝，事务完整回滚；未放宽任何数据库约束。最终采用上述完整备份后归档方式。旧记录 ID `48fe5a1a-4da2-4eaa-8cee-a4ce36abc91d` 及原始内容均在新构建目录的 `withdrawn-release-archive.json` 中。

相同版本号的旧开发包或曾短暂下载过旧 177 的客户端，不会因版本比较自动收到同号更新，需要从官网安装本次新包；公开主渠道此前的正式 176 可正常升级。

## 发布过程与生产边界

- 打包器从规范仓库根目录运行，钩子使用绝对路径。GitHub 域名解析失败后，用 HTTPS 从官方 Electron 发布地址重新下载 39.8.10，匹配官方 SHASUMS256 后填充独立缓存，继续原构建流程。
- 安装器首次签名因时间戳服务错误中止；保留失败产物并重试原 CLI 流程，最终四项签名全部通过，没有分发失败产物。
- 大文件上传返回网关 HTTP 504，未盲目重传。只读检查确认原事务继续运行，随后唯一新记录提交成功、版本锁释放，大小和 SHA 与公开元数据一致，再上传 blockmap（HTTP 200）并做完整下载验证。HTTP 504 原始指标与成功恢复回执分开保存。
- 发布前核对相关会话均已完成；分别重新验证 API 与独立策略 Worker 运行源码 `eb9942f6e4e8c3dcbb0bde3e66728234016f42a4`，各 1021 个实际运行文件、镜像、启动戳、健康状态及协议一致。API 镜像 `sha256:ab98818c0d873c7e6a701f61bf1729787e385575430fed6ffa89493620cf1b13`，Worker 镜像 `sha256:339360251e588a7729136fcb1bbde169d49dc2144430507ccd7048aa3bc3940d`。
- 本次仅发布 Windows 安装包与更新元数据，不部署或重启业务后端、策略 Worker、官网静态文件、邀请中心或模型网关。未提交预先存在的 `youle_desktop/output/`，未向他人发送消息。凭据未写入源码、日志或安装包。

最终机器回执：[windows-release-0.1.177-20261021.json](verification/windows-release-0.1.177-20261021.json)。完整本地证据保存在构建目录及 `.cache/release-0.1.177-20261021/`。关机安排在公开下载验证、记录落盘和最终远端 `dev` 核对之后执行。
