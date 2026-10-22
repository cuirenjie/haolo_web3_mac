# macOS 0.1.180 Universal 本地签名包

任务 `M6-MAC-20261023-180`。用户在融合验收完成后指定版本号 180，并明确选择“沿用此前本地签名方式，交付未公证的 180 包”。本机 `security find-identity -v -p codesigning` 返回 0 个有效身份。本轮使用已有 `HAOLO_ALLOW_UNTRUSTED_MAC_DMG=1` 开关，不改动正式发布信任校验，不宣称 Developer ID 或 Apple 公证。

## 输入与范围

- Windows 目标 `dad72819cb6876a669d853f27e6d6d2f54cb1307`；业务增量 `65ca437c88b46e14297083cb4ff2afd23752c7d0`。
- 融合结果见 [专项台账](windows-sync-20261023-fibonacci.zh-CN.md)。保留用户原偏好设置改动；仅把 package.json 与 package-lock.json 的版本设为 0.1.180。
- 已完成业务验证：5362 通过、0 失败、12 Windows 跳过；53 组图表与 130 项标注交互通过。版本重建追加打包相关回归和实际成品验证。
- 先前的 0.1.182 DMG 与 app 已保留；未改变已安装或正在运行的客户端，不上传更新渠道或部署后端。

## 交付状态

构建与验收进行中。证据目录 `.git/release-0.1.180-20261023/`。
