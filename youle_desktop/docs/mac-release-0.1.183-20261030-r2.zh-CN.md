# Mac 0.1.183 Universal 正式签名包（2026-10-30，R2）

任务 `MAC-RELEASE-183-20261030-R2` 已完成。最新源码已推送远端 `dev`，按用户指定版本 183 完成正式签名、Apple 公证及桌面交付。本次授权包含源码推送、签名、公证及本地交付；不包含官网上传、更新渠道启用或服务端部署。

## 来源与构建

- 构建源码：`3d00c5f08f6914a8be673b36b74090f22e00a042`，包含 Windows `a61e3cf544a6cc87a16c2fabe4a1f58caaf151df` 的三方融合。2026-10-30 已正常快进推送 `origin/dev`，远端回读一致；构建期间再次刷新仍一致。
- 版本保持 `0.1.183`，不递增。独立工作树固定该提交，2,781 个已跟踪输入逐项 SHA-256 核验；原工作区的 7 个未跟踪教程文件及原安装均保留。
- 构建和证据目录：`/Users/binanfei/Documents/ChatGPT/haolo_mac_releases/20261030-0.1.183-r2/`。旧 `20261030-0.1.183` 构建及桌面旧包保留。
- Universal arm64＋x64；Electron `41.10.2`，Codex `0.163.0`，Bundle ID `local.haolo.desktop`，最低 macOS 声明为 `12.0`。
- 使用 `Developer ID Application: Shenzhen Haoluo Technology Co., Ltd (78JM58SYA3)`，证书 SHA-1 `B03399411A0BD8F2923434B35E264F542B8C51EC`。启用 Hardened Runtime，代码及 DMG 均有 Apple 安全时间戳。
- 复用并完整审查前次 Apple Accepted 构建的实际路径去重签名辅助程序。锁定的 `@electron/osx-sign` 从内到外签名，独立扫描全部 Mach-O 复核无遗漏；辅助程序保留在证据目录，没有修改仓库默认打包入口或放宽正式门禁。

## 验收

- 本次精确源码的全量回归沿用刚完成的 R2 融合证据：6,202 项，6,190 通过、0 失败、12 Windows 平台跳过；类型检查通过。日志副本保存在本次证据目录，没有把此前版本的测试计入本次结果。
- 独立构建环境按 pnpm 锁文件安装；Mac 更新／包边界／客服／平台专项 22/22，Vite 构建通过，保留既有大 chunk 提示。
- 两架构来源运行时的 4 个官方签名二进制和 2 个工具的架构、摘要及签名通过；签名后 arm64／Rosetta x64 的 Codex 与 rg 版本执行通过。
- 2,038 个包内文件通过私有代码／凭据边界审计；483 个源码／renderer 文件与本次构建一致。
- 27 个代码对象／bundle 完成签名；独立检查 18 个 Mach-O 全部 Universal、公司签名、安全时间戳，无调试权限、禁用库验证或 DYLD 环境权限；文件可读且无所有用户可写项。
- arm64 和 Rosetta x64 完整应用在独立资料及测试钥匙串下启动通过：版本、登录页、桌面桥接、二维码／CLI 依赖和 AJV 契约正常，无 renderer 崩溃；未调用真实账户、付费模型或交易接口。
- DMG 签名、完整性及挂载后版本／ASAR／双架构 CDHash 与源签名应用一致。
- 205 条 Mac 客服候选，Node／Python／ASAR 同源一致；源码 SHA 与版本正确。合同 `685e63c3f973804acc4b4baf7398dd63df484c1f63e9c19aa0cc74c89bfc7424`，身份 `macos`／`cuirenjie/haolo_web3_mac`。未登记或激活；服务端不识别 Mac 合同时沿用文字客服及关闭代操作的既有行为。

## 公证与交付

Apple 公证任务 `6848d347-1716-4586-bb63-b7c784eb1e58` 为 `Accepted`／`Ready for distribution`，日志 `issues: null`。公证输入 SHA-256 `2544d6c37cef54ab93d2395c1cd9c269f52be1b768cb37b9a4bf7922c70d4347` 与 Apple 回执一致，输入原件单独封存。本次只有一次提交；上传较慢，第一次 45 秒有界等待到期，下一次等待接受，没有重传或重复提交。

2026-10-30 23:04（北京时间）完成 App／DMG 附票及验证、deep／strict／全部架构验签、App／DMG Gatekeeper `Notarized Developer ID`、正式 `finalize:mac`、更新制品挂载核验和 `syspolicy_check distribution`，均退出 0。正式门禁未放宽。

- 最终桌面包：`/Users/binanfei/Desktop/好咯-0.1.183-发布包-20261030-R2/好咯-0.1.183-universal.dmg`。
- 大小：501,881,297 字节（约 479 MiB）。
- **最终 SHA-256**：`cef7d3f19837522eed66ca603f245bfc3458d845abab27f6a56f1399251f4336`。
- 同目录附 `.dmg.sha256`、`.build-info.json` 和 `.support-bundle.json`；桌面副本与构建原件摘要一致，并独立复核签名、附票与 Gatekeeper。
- 原始 builder DMG／旧 blockmap 留在 `builder-before-signing/`，公证输入留在 `notary-input/`；签名及附票改变字节，旧 blockmap 不作为最终更新元数据交付。
- 最终回执为证据目录的 `completion-receipt.json`、`delivery.json` 和 `logs/finish-commands.jsonl`。构建源码固定 `3d00c5f`，后续远端验收记录提交仅增加本文档，不改变包内产品代码。

Intel 通过 Rosetta 验证，不等于独立 Intel 真机。未覆盖最低系统、干净机器离线首次安装或真实用户数据升级。六语言产品行为沿用本轮融合及此前 UI 验收，本次包验收不声称重新完成所有页面交互测试。
