# Mac 0.1.181 Universal（2026-10-27）

任务 `M6-MAC-181-20261027`，已完成构建、验收及桌面交付。用户指定版本 181，沿用本会话已确认的无 Developer ID、未公证、保留本地 ad-hoc 签名的流程。

精确设置 package.json 与 package-lock.json 为 0.1.181；不从 Windows 安装包目录推导版本。业务实现沿用今日已融合验收的版本；客服五语历史绘图说明改为“修复前的旧安装包”，避免把旧 181 的缺陷描述误用于新 181，同步生成合同。没有新增功能、代操作或服务端激活。

历史旧 181 DMG 和当前 180 应用目录等备份到 `release/archive-before-mac-181-20261027/`，原桌面包、已安装应用和原有未提交改动保留。证据目录 `.git/mac-181-20261027/`。本轮运行版本／Mac／客服定向回归，重新构建并验证两架构、实际包内版本、知识快照、资源、签名、DMG 和隔离启动；完整业务回归沿用 [今日融合验收](mac-test-package-0.1.180-20261027.zh-CN.md) 的既有证据。

## 制品

- 桌面：`/Users/binanfei/Desktop/好咯-0.1.181-universal-20261027-release.dmg`。
- 大小：549372869 字节；SHA-256：`fbabd9c5d750378cf6a5a583db8820fdc59733b005176a85e702906638f9a4d6`。
- 构建源码：`2d942d802c3c7061f2e7490149b3842042490538`；后续交付文档不改变构建代码。
- Universal arm64 + x64；Electron 41.10.2，Codex 0.163.0。package.json、package-lock、ASAR、Info.plist、客服快照及实际启动版本均为 0.1.181。
- 桌面附同名 `.dmg.sha256`、`.build-info.json`、`.support-bundle.json`。

## 验收

35 项 Mac／客服／更新定向测试、5 项 Python 客服测试、类型检查与构建通过。1625 个业务实现／工具／资源文件与此前已验收版本一致；本次更新仅涉及版本、历史客服说明及生成合同。2734 个构建输入固定，479 个包内源码／renderer 文件、278 个附带资源和 2036 个包内文件边界审计通过。

arm64、Rosetta x64 实际应用启动均为 0.1.181，桌面桥接、二维码／CLI 依赖和 AJV 契约通过；两架构内置 Codex 实际执行均为 0.163.0。隔离登录页截图与此前已人工验收截图一致。ad-hoc 启动兼容性、deep/strict 签名、DMG 校验和、挂载后版本／ASAR／两架构 CDHash 比对通过。原有 11 文件差异、2 个归档文件和旧应用目录保留，已安装应用 ASAR 及原运行进程保持不变。

客服候选 110 features，版本 0.1.181，Python／Node／ASAR 快照一致。bundle `04909c65e7b895f3ebf74967cc23619a29d6aba92b4c57b7f2b2ca279b49e90e`；contract `a71352265c05d561b60e5f212766e4d15a94fc59ba9e9fa531af5ecdd4db4a0c`；使用 `macos` / `cuirenjie/haolo_web3_mac`，未上传、登记或激活。

此包按用户要求无 Developer ID、未公证，不代表 Apple 正式信任。未上传更新、部署云端、执行付费模型或实盘测试；未覆盖独立 Intel 设备。启动使用临时资料和测试钥匙串，不接管用户账号。源码及全部检查的详细证据见本轮目录和桌面 build-info。
