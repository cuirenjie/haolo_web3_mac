# Windows 0.1.180 最新正式安装包

2026-10-23，任务 M1-458。按用户要求提交最新客户端代码到 origin/dev，固定 180 重新制作 Windows x64 Web3 EV 签名安装包，并核对最新行情网关源码。

## 源码范围

- 安装包源码提交：`fcdea09ab32eb300c9e3bff1dba4d33aca2c728e`，已推送 origin/dev。
- 包含币安绑定排队／执行超时隔离和私有通道恢复、账户今日盈亏独立刷新、M1-456 SMT 配对源码与诊断、M1-457 副图 AI 标注时间轴隔离。版本为 `0.1.180`，NSIS 支持英文／简体／繁体；重新编译 Chrome native host。
- 行情网关目录 `services/haolo-binance-gateway` 本地与 origin/dev 的树均为 `38801a0680ce7532f33526678718d6b9841a94b5`，已包含最新运行修复 `ef8e8dbd640b60a05a0f98c20d0087ddc55fbee9`、测试 `fb7a3258501c2c79c0b75da7431cacca45bf31fd` 和记录 `a3920810c9cc59e1c1e881cf173ae13253607b3a`，没有遗漏的未提交网关代码。
- 未提交截图与运行 profile 缓存；没有改动其他项目。正式包生产业务地址 `https://haolo.com`，渠道 `haolo_windows_web3`。

## 验收

- 全量 **5210/5210** 通过，失败与跳过均为 0；TypeScript、正式 Vite 构建通过。首轮的 15 项失败来自缺少默认 Python 命令，指定已有 Python 3.12.14 后全量通过，未修改断言。
- 主程序、native host、卸载程序副本和安装器四项 EV 签名通过：Keroro Software Ltd，固定指纹 `EC6346287B2F343CB7BFA4CF4CAB7DB02379A0AD`，SHA-256、EV 策略、可信时间戳和 Windows Authenticode 均有效。
- 1368 项构建输入保持稳定，297 项包内源码／前端资源和 324 项附加资源匹配。内核 0.163.0 的 47 项哈希与所需 OpenAI 原签名通过。
- 实际封装 ASAR 隔离启动、登录页面视觉检查、17 项云端策略目录及未登录鉴权边界通过。
- 最终签名安装器通过实际下载器的本地镜像失败回退、1 MiB 续传、解包 399 文件逐项一致及 1500 项包边界审计。0.1.179 到本包的实际差分重建通过，11 次本地 Range 回放，传输 20130911 字节，重建 SHA-256 一致。
- 构建仅保留现有大 chunk、Node 弃用与重复依赖提示。失败及成功日志分开保存。没有执行真实系统安装、账号绑定或线上付费分析。

## 交付

- 安装器：`haolo_desktop-0.1.180-Setup.exe`
- 大小：247804296 字节（236.32 MiB）
- SHA-256：`0b611834c7355a01c46805d53113432139f9fb37715321c05fdb07546b183323`
- 构建目录：`D:/haolo_windows_web3/youle_desktop/release/build-0.1.180-local-20261023`
- 桌面路径：`C:\Users\joiec\Desktop\好咯最新安装包\haolo_windows_web3\haolo_desktop-0.1.180-Setup.exe`
- 昨日同版本包及附属文件先逐字节备份至 `C:\Users\joiec\Desktop\好咯最新安装包\haolo_windows_web3\archive\0.1.180-20261022-4b9bf325`，原构建目录也保留；本包与 blockmap、SHA-256、签名报告和本记录一同交付。
- [机器验收回执](verification/windows-release-0.1.180-20261023.json)；构建输入和日志位于仓库根 `.cache/release-0.1.180-20261023/`。

## 发布状态

源码已同步远端 dev；安装包已在本地完成。未上传更新系统，未部署后端 API、独立策略 Worker 或行情网关。SMT 云端配对及服务端收益优化须由对应后端发布批次独立验收；本安装包提供客户端兼容和展示能力，不能将打包完成视作云端功能已上线。
