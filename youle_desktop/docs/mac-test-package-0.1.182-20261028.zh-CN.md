# Mac Universal 测试包 0.1.182（2026-10-28）

任务 `M6-MAC-20261028` 已完成分阶段融合、逐阶段测试／深度 review、整体修复复验及测试包交付。完整范围与例外见 [融合记录](windows-sync-20261028.zh-CN.md)。

## 制品与来源

- 桌面：`/Users/binanfei/Desktop/好咯-0.1.182-universal-20261028-test.dmg`。
- 大小：551597008 字节；SHA-256：`24993c54a2122ff0a67c7883a269a85e2a96ec4a4db8da55640ee4c289fd1f93`。
- 源码：`31f5849bf1053d096281fa6d83f8c54205a37f95`；Windows 上游冻结 `a80ab852bff07a5bcd67c14d3db417f847291956`，5 个提交、102 个路径。后续提交仅补充交付文档。
- Universal arm64 + x64；Electron 41.10.2，Codex 0.163.0。package、ASAR、Info.plist、客服快照和实际启动版本均为 0.1.182。
- 桌面附同名 `.dmg.sha256`、`.build-info.json`、`.support-bundle.json`。仓库内原件位于 `youle_desktop/release/好咯-0.1.182-universal.dmg`。

## 复核与验证

修复了支付后凭据刷新被余额乱序响应丢弃、越南语巨大正则首次翻译卡顿、Mac 独有文案与动态周期、客服语言提示、紧凑标题栏头像挤压、动态策略卡片和主题说明片段翻译。布局驱动改为通过真实设置控件更新主题和字号，避免仅改 DOM 属性后被应用重绘覆盖。图表价格、用户原文、冻结报告、旧服务端回读协议、账户隔离及 Mac 现有行为保留。

- 最终完整桌面回归：6,135 项，6,123 通过、0 失败、12 Windows 专属跳过；类型与构建通过。网关本轮 S1 回归 136 通过、6 环境跳过，之后未修改网关。
- 英越 22 面板 × 3 缩放 × 4 字号 × 2 主题，共 1,056 状态；160 下拉状态、103 滚动状态全部通过。六语言重载保持、30 个双向切换组合通过，2,960 字体样本无裁切。另有 176 状态快速复验，已人工检查放大截图。
- 2,757 个构建输入冻结；482 个包内源码／renderer 文件、279 个附带资源与源文件一致，2,040 个包内文件通过边界审计。
- arm64 与 Rosetta x64 实际应用启动、桌面桥接、二维码及 CLI 依赖、AJV 契约通过；两架构登录页截图 SHA-256 相同。内置 Codex 两架构实际运行均返回 0.163.0。
- deep／strict 签名、DMG 校验和、挂载后版本／ASAR／双架构 CDHash 比对通过。原 11 文件与未提交补丁保持；旧 182 制品、5 个文件及应用目录归档到 `release/archive-before-windows-sync-20261028/`。

## 签名与客服边界

本地测试包采用 ad-hoc 签名，未公证，未上传更新系统或部署生产。首轮默认构建自动选择了本机 Apple Distribution 证书，已中止，随后用 `CSC_IDENTITY_AUTO_DISCOVERY=false`、`--config.mac.identity=- --config.mac.hardenedRuntime=false` 显式打包，再以 `HAOLO_ALLOW_UNTRUSTED_MAC_DMG=1` 执行 `finalize:mac -- --target=universal`；最终审计确认 `Signature=adhoc`。

客服候选 170 项，Python／Node／ASAR 内容一致，使用 `macos` / `cuirenjie/haolo_web3_mac`。bundle `cd3332b7c8af6a7a62c5fc302ae69e98276695526e45cf4ed782a8b63bdc39b0`；contract `b27bd804a68277c8b99e5f86e91f8676e18e7417135ebc1b8c9fa9912b854073`。本地候选未登记、上传或激活；服务端未识别 Mac 合同时保持文字客服，代操作继续按合同门禁关闭。

上游价格轴覆盖层引用了远端不存在的 `trading-price-axis.ts`，且缺少下游宽度消费实现；这项未完整交付的改动明确排除，保留通过回归的 Mac 实现。以后补齐时须显式重放相关 `a80ab85` 差异。其余例外仅为 Windows 安装器配置及按 Mac 合同重生成的客服运行时。

启动使用临时资料目录与测试钥匙串，未接管用户账号。未覆盖付费模型、真实生产账号／实盘、API／独立策略 Worker／行情网关部署验收或独立 Intel 设备。详细证据在 `.git/integration-20261028/` 和桌面 build-info。
