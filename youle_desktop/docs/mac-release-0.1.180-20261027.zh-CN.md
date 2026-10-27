# 2026-10-27 Mac 0.1.180 Universal 发布用包

任务 `M6-MAC-RELEASE-20261027`，已完成构建、验收及桌面交付。

用户明确要求“不要签名的包，跟之前的一样”。沿用先前本地包：无 Developer ID、未公证，保留 Mac 本地运行所需 ad-hoc 签名；通过 `HAOLO_ALLOW_UNTRUSTED_MAC_DMG=1` 显式构建，不修改正式信任校验。此交付不等于 Apple 信任、公证、服务器发布或知识合同启用。

应用功能代码与今日已完成融合的测试包相同；桌面 6083 项（6071 通过、12 跳过）、网关 142 项（136 通过、6 跳过）的既有证据见 [测试包验收](mac-test-package-0.1.180-20261027.zh-CN.md)。本轮仅重新打包，复验运行时、源码和资源、客服候选一致性、签名／DMG 及双架构隔离启动，不重复执行未变化的业务测试。

旧 release 产物备份在 `release/archive-before-unsigned-release-20261027/`；原桌面测试包、已安装应用、用户数据和原有未提交改动保留。构建证据存放 `.git/mac-release-20261027/`。

## 交付文件

- 桌面 DMG：`/Users/binanfei/Desktop/好咯-0.1.180-universal-20261027-release.dmg`。
- 大小：549336098 字节；SHA-256：`ec824001886531f42a6338b38f24a59d474e0e45e26a8abce7d9d3c0c3844a5b`。
- 构建源码：`961b23dce5c0ab56b791c03521f10b4fdce494e2`；最后的交付文档提交不改变构建代码。
- 同名 `.dmg.sha256`、`.build-info.json`、`.support-bundle.json` 已放桌面；未上传更新系统或登记客服候选。
- 架构 Universal（arm64 + x64）；Electron 41.10.2，内置 Codex 0.163.0。

## 本轮产物验收

2733 个构建输入固定，1627 个功能代码／工具／资源文件与此前测试版本相同；479 个包内应用源码和 renderer 文件比对、278 个额外资源比对、2036 个包内文件云端边界审计通过。两架构 Codex 实际执行均为 0.163.0。新包 arm64、Rosetta x64 的隔离启动、桌面 bridge、二维码／CLI 依赖和 AJV 契约检查通过；两架构登录页截图与此前已人工验收截图逐字节相同。启动使用临时资料及测试钥匙串，不接管用户当前账号。

ad-hoc 签名兼容性和 deep/strict 校验通过；DMG 校验和、挂载后应用版本／ASAR／两架构 CDHash 比对通过。桌面副本哈希与构建原件一致。旧 4 个归档文件和应用目录、原有 11 文件差异完整保留，已安装应用 ASAR 未变且原进程保持运行。

客服候选为 110 features，Python／Node／ASAR 内快照一致；bundle `01e85966579b3e008b7013ca96751edd34b0ecc43d3b4a6011900196d31093cd`，contract `aadc4cd3b9174cb3eeebb6dea046b9ddc627c6504fa1e3b672c205ac059fbc8c`，保持 `macos` / `cuirenjie/haolo_web3_mac`。仅生成本地候选，不代表服务端认可、代操作激活或生产部署。

该包按用户明确选择无 Developer ID、未公证；不能通过项目默认的 Apple 正式信任门禁，本轮未修改门禁。无生产上传、部署或付费模型／实盘测试。Intel 使用本机 Rosetta，其他验收边界及原有非阻塞启动日志见此前测试包记录。
