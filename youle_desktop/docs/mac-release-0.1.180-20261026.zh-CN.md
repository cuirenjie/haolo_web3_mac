# 2026-10-26 Windows 增量融合：macOS 0.1.180 Universal

任务 `M6-MAC-20261026`。已按 S0 总体审查、S1–S5 源码融合、S6 累计深度审查、S7 制品验收推进；每阶段测试及问题修复后再进入下一阶段。完整来源和阶段证据见 [融合台账](windows-sync-20261026.zh-CN.md)。

## 构建输入与交付

- 固定 Windows 来源：`b6e37a27296d5387d414995cb6aaddb3493a7edd`，从 `dad72819cb6876a669d853f27e6d6d2f54cb1307` 开始，共 21 提交、598 路径。
- 制品应用源码：`7f62f82d2f3230194f0b0c37b63e108dbfb1c483`，分支 `codex/windows-sync-20261026`。交付文档在构建验收后另行提交，不改变实际包的源码提交。
- 版本沿用 0.1.180；Electron 41.10.2、Codex 0.163.0；arm64 + x86_64 Universal。
- 原工作区 4 个已修改文件、7 个教程文件逐字节保留，未混入本任务提交。源码包包含原偏好设置注释差异；实际构建工作区补丁与 2658 项输入哈希另存。
- 没有有效 Developer ID；使用仓库既有 `HAOLO_ALLOW_UNTRUSTED_MAC_DMG=1` 本地包流程，ad-hoc 签名、未公证，不上传生产更新渠道。

## 最终验证

- 桌面全量 5803 项：5791 通过、0 失败、12 Windows 专属跳过；网关 142 项：136 通过、0 失败、6 环境相关跳过。类型与构建通过。
- Mac 韩语 96 页面／80 下拉／2960 字体样本；主题四语、预警双主题主图／分屏交互；资讯四语双主题离线交互、自选布局与滚动、hao宝 32 状态、参考计划 192 状态和概率展示 32 状态通过。
- 累计复查修复旧 SSE 迟到写入、模型重试及媒体线程隔离、客服账号／上传生命周期、资讯外部字段／投票正文覆盖、永续错误跳现货、Mac 自选裁切及资讯弹窗显示器变化边界。相关行为回归与最终全量复验通过。
- 首轮成品启动后实际复现 qrcode 命令行依赖遗漏，增加既有 yargs 15.4.1 生产引用，保持其他依赖版本；66 项补充合同及 Mac 兼容回归、二维码 PNG 生成与冻结安装通过。仅交付修正后重新构建的包。
- 启动验收脚本在暂停点改用 Debugger.evaluateOnCallFrame 以设置隔离资料目录；随后样本栈定位到 macOS 钥匙串授权等待。最终两架构使用 Chromium 测试钥匙串与全新临时资料，登录页、Mac bridge、二维码生成／CLI 依赖、AJV 合同验证均通过，renderer 异常为 0。此验收不覆盖真实钥匙串授权；生产安全存储未改动，本地 ad-hoc 包首次打开可能需系统授权。

## 制品回执

| 项目 | 结果 |
|---|---|
| 桌面 DMG | `/Users/binanfei/Desktop/好咯-0.1.180-universal-20261026.dmg` |
| 大小 | 547780867 bytes |
| SHA-256 | `4c016a3bc390fb224811cc4ab95c8f530b9693ddc93a5b6aedb1e94b3da15cac` |
| 校验及构建记录 | 同名 `.dmg.sha256`、`.build-info.json` |
| 包内审计 | 2023 文件云端边界审计通过；467 项源码／渲染资源、277 项附加资源一致 |
| 签名 | 752 code objects 启动签名检查通过；DMG 挂载后版本、ASAR、两架构 CDHash 与源 app 一致 |
| 完整性 | `hdiutil verify` 通过，桌面副本与 release 原件 SHA-256 相同 |
| 知识候选 | 55 features，bundle `9ccb6bf436753c8e01ff3ff92d4917f2fde505b74dbae17fed559fe912e8239e`，未上传／激活 |
| 资料保留 | 2658 构建输入在构建完成时不变，11 个原工作区文件和旧制品哈希通过 |

成品验收另发现原有 `verify-mac-update-artifact.mjs` 引用不存在的模块。已改用现有 Mac 包检查与只读 DMG 挂载身份校验；6 项参数／架构／入口检查及实际 DMG 校验通过，当前交付格式为 DMG。此脚本不在 app.asar 内，修复发生在构建后，补丁／新哈希记录于构建回执，不改变上列应用源码提交、ASAR、签名或 DMG；文档和验收脚本另行提交。

主要证据：`s6-full-tests-final.log`、`s6-gateway-tests.log`、`s7-build-final.log`、`s7-package-audit.json`、`s7-preservation-audit.json`、`s7-signatures.log`、`s7-dmg-architecture-fixed.log`、`s7-dmg-integrity.log`、`packaged-arm64-launch/report.json`、`packaged-x64-launch/report.json` 和 `delivery.json`。

## 验证边界与恢复

新云端能力取决于实际 API／Worker 版本；本次未部署、未宣称生产端验收，也未调用付费模型、真实账户或真实交易。资讯投票／分享使用合成离线夹具。Intel 启动在当前 Apple Silicon Mac 上通过 Rosetta 验证，未覆盖独立 Intel 硬件。

客服知识包为 macos / haolo_web3_mac 本地候选，Python 与 Node 生成结果逐字节一致；未上传或激活。旧服务拒绝新合同仍可文字客服，不能借 Windows 合同执行代操作。

旧 DMG、校验、构建记录和两个旧 app 目录保存在 `youle_desktop/release/archive-before-windows-sync-20261026/`，旧桌面交付文件保持原样。本次不安装或替换用户已有客户端。日志、逐路径审查和验收脚本位于 `.git/integration-20261026/`。

用户已授权在全部交付后正常关机；交付记录保存后发出系统正常关机请求，不强制丢弃其他应用未保存内容。
