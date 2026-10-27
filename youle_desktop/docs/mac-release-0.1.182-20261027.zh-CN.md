# Mac 0.1.182 Universal（2026-10-27）

任务 `M6-MAC-182-20261027`，已完成构建、验收及桌面交付。用户指定版本 182，沿用本会话已确认的无 Developer ID、未公证、保留本地 ad-hoc 签名的流程。

本轮精确更新 package.json 与 package-lock.json 为 0.1.182，功能实现、客服知识和合同不变；重新生成包含新版本与源码 SHA 的知识快照，执行 Mac／客服／更新定向验证及 Universal 构建。此前全量业务与界面验收见 [融合测试记录](mac-test-package-0.1.180-20261027.zh-CN.md)。

历史旧 182 产物、当前 181 应用目录和知识快照归档到 `release/archive-before-mac-182-20261027/`，原桌面文件、已安装应用、用户数据和原有未提交改动保留。证据位于 `.git/mac-182-20261027/`。不上传生产、不部署、不修改正式信任门禁。

## 制品

- 桌面：`/Users/binanfei/Desktop/好咯-0.1.182-universal-20261027-release.dmg`。
- 大小：549814776 字节；SHA-256：`aeb816ff2ea00abc4b99a7a7aaa8b2d3ab851e5a1f29bc590b9766af9e87d3fc`。
- 构建源码：`a1c4e8277fc0601994ae36abc8423061c0ffd175`；后续交付文档不改变构建代码。
- Universal arm64 + x64；Electron 41.10.2，Codex 0.163.0。package.json、package-lock、ASAR、Info.plist、客服快照及实际启动版本均为 0.1.182。
- 桌面附同名 `.dmg.sha256`、`.build-info.json`、`.support-bundle.json`。

## 验收

35 项 Mac／客服／更新定向测试、5 项 Python 客服测试、类型检查与构建通过。1627 个实现／工具／资源／客服文件与今日 181 构建源码一致；本次仅更新版本元数据及交付记录。此前全量业务与界面回归证据沿用上方融合测试记录，未重复计为本轮运行。2735 个构建输入固定，479 个包内源码／renderer 文件、278 个附带资源和 2036 个包内文件边界审计通过。

arm64、Rosetta x64 实际应用启动均为 0.1.182，桌面桥接、二维码／CLI 依赖和 AJV 契约通过；两架构内置 Codex 实际执行均为 0.163.0。隔离登录页截图与此前已人工验收截图一致。ad-hoc 启动兼容性、deep/strict 签名、DMG 校验和、挂载后版本／ASAR／两架构 CDHash 比对通过。原有 11 文件差异、4 个归档文件和旧应用目录保留，已安装应用 ASAR 及原运行进程保持不变。

客服候选 110 features，版本 0.1.182，Python／Node／ASAR 快照一致。bundle `4f19e6820a29a8b4d4eab380b4e3cc3565c77a74bd8f9b214ac95ab78bb5d5ca`；contract `a71352265c05d561b60e5f212766e4d15a94fc59ba9e9fa531af5ecdd4db4a0c`；使用 `macos` / `cuirenjie/haolo_web3_mac`，未上传、登记或激活。

此包按用户要求无 Developer ID、未公证，不代表 Apple 正式信任。未上传更新、部署云端、执行付费模型或实盘测试；未覆盖独立 Intel 设备。启动使用临时资料和测试钥匙串，不接管用户账号。源码及全部检查的详细证据见本轮目录和桌面 build-info。
