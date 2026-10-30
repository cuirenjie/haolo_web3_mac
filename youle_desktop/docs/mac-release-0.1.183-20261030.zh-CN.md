# Mac 0.1.183 Universal 正式签名包（2026-10-30）

任务 `M6-MAC-183-20261030` 已完成。用户指定版本 183，并要求正式签名 Mac 包；App 和 DMG 已使用公司 Developer ID 签名，Apple 公证 Accepted，附票及正式信任门禁通过，最终包已交付桌面。

## 来源与构建

- 功能基线为已复查、推送 Mac dev 的 `7abf228ea51518f42f1a5eda88dbd181d5e6041d`，包含 Windows `8fa4c681ef09bdd37f593a6051f9eee5e0359e04` 的三方融合及第二轮修复。
- 本次精确更新 package.json／package-lock.json 的版本为 `0.1.183`，构建源码为 `2285d36d652242976f9a51fb5aec8c8ec66fc7bf`；后续交付文档不改变产品源码。
- 独立工作树及证据：`/Users/binanfei/Documents/ChatGPT/haolo_mac_releases/20261030-0.1.183/`。原仓库 release、现有安装及原 7 个未跟踪教程文件保留。
- 依赖按 pnpm 锁文件安装，2,776 个 tracked 构建输入固定。Universal arm64＋x64；Electron `41.10.2`，内置 Codex `0.163.0`，Bundle ID `local.haolo.desktop`，声明最低 macOS `12.0`。
- 签名使用 `Developer ID Application: Shenzhen Haoluo Technology Co., Ltd (78JM58SYA3)`，SHA-1 `B03399411A0BD8F2923434B35E264F542B8C51EC`。主程序开启 Hardened Runtime，代码及最终 DMG 均使用 Apple 安全时间戳。

## 验收证据

| 检查 | 结果 |
| --- | --- |
| 独立构建环境全量测试 | 6,202 项：6,190 通过、0 失败、12 Windows 平台跳过；251.9 秒 |
| Mac／客服／更新专项 | 22/22；类型检查、构建通过 |
| 来源运行时 | 两架构四个官方签名运行时及两个工具的架构、哈希、签名通过 |
| 产品包边界 | 2,038 个包内文件通过，483 个源码／renderer 文件与源构建一致 |
| 签名清单 | 27 个代码对象／bundle；独立检查 18 个 Mach-O 全部 Universal、公司签名、安全时间戳，无禁用库验证或调试权限 |
| 文件权限 | 986 个物理目录／文件可读，无所有用户可写项 |
| 内置工具 | arm64、Rosetta x64 的 Codex／rg 版本执行通过 |
| 完整应用启动 | arm64、Rosetta x64 的 0.1.183 登录页、桌面桥接、二维码／CLI 依赖及 AJV 契约通过；独立资料和测试钥匙串，无 renderer 崩溃 |
| DMG 内容 | 挂载后版本、ASAR、双架构 CDHash 与源签名应用一致 |
| 客服知识 | 205 条 Mac 候选；Node／Python／ASAR 同源一致，版本与源码 SHA 正确 |

原始 Intel CLI 首次通过 Rosetta 执行超过 30 秒，保存失败日志后按原 30 秒限额重跑四项工具检查通过，没有扩大超时或断言；未确认首次超时根因。完整 x64 应用随后通过。签名辅助程序复用并审查此前 Apple Accepted 构建的实际路径去重方案，以锁定的 `@electron/osx-sign` 由内向外签名；独立库存检查没有遗漏任何代码。辅助程序在证据目录，本次没有把它宣称为仓库默认签名入口已改造。

六语言／双主题／缩放等产品行为沿用本会话 [第二轮深度复查](windows-sync-20261030-r1.zh-CN.md) 的证据；本次只变更版本元数据，另执行上述最终包验证。旧的 ad-hoc 0.1.182 记录仍按其历史状态保留。

## 公证与交付状态

Apple submission ID：`45cabf14-cefc-4e7e-a2ee-6d85cf8324ca`，最终 `Accepted`／`Ready for distribution`，服务端日志 `issues: null`。提交输入 SHA-256 为 `13c776af6c927ac59cf15e339932d5f53264427a5eaf94e5f7a870bda0d1ffbc`，与 Apple 回执一致。没有重复提交。

2026-10-30 21:15（北京时间）完成 App／DMG 附票和验证、deep／strict／全部架构验签、App／DMG Gatekeeper `Notarized Developer ID`、正式 `finalize:mac`、最终更新制品挂载审计及 `syspolicy_check distribution`。这些步骤均退出 0；正式门禁未放宽。

- 最终桌面包：`/Users/binanfei/Desktop/好咯-0.1.183-universal.dmg`。
- 大小：501,880,732 字节（约 479 MiB）。
- **最终 SHA-256**：`2a6f9d4524c0f193bac010e9b5c4b73192e7d5ae59b8fc2ca457fd657caede83`。
- 同目录附 `.dmg.sha256`、`.build-info.json`、`.support-bundle.json`。桌面副本与构建原件哈希相同，并再次通过票据和签名验证。
- 原始 builder DMG／blockmap 归档到本次证据目录的 `builder-before-signing/`；公证输入单独保存。签名及附票改变字节，旧 blockmap 不作为最终更新元数据交付。

最终回执见证据目录 `completion-receipt.json`、`delivery.json` 及 `logs/finish-commands.jsonl`。独立工作树保持构建源码不变；原 7 个教程文件和已安装应用 ASAR 摘要均保持。

客服候选合同 `685e63c3f973804acc4b4baf7398dd63df484c1f63e9c19aa0cc74c89bfc7424`，bundle ID `4c98f25cf8e0d903402252e53fc8cb62ada119611254045e43af076a953d2472`。身份为 `macos`／`cuirenjie/haolo_web3_mac`，未登记／激活；服务端未识别 Mac 合同时仍按既有门禁关闭代操作。

本轮不含官网上传、更新渠道启用、生产 API／Worker 部署、真实付费模型或交易测试。Intel 使用 Rosetta 验证，不等于独立 Intel 真机；未覆盖最低系统、干净机器离线首次安装和保留真实用户数据的升级验证。
