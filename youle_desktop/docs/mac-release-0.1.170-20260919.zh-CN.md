# Mac 0.1.170 发布候选包（2026-09-19）

用户指定版本 170，用于后续发布。本地包已生成并验证，包含 Windows 非 EV 增量融合及 R1/R2 修复。未上传、写生产发布记录或安装到用户客户端。

| 项目 | 结果 |
| --- | --- |
| 制品 | `release/好咯-0.1.170-universal.dmg` |
| 版本 | `0.1.170`，应用、ASAR 与两个 Bundle 版本字段一致 |
| 架构 | Universal：Apple Silicon arm64 与 Intel x86_64 |
| 大小 | 488797206 bytes，约 466.2 MiB |
| SHA-256 | `cca4137b6b825a1722d1cc01f8b7efc367ce8649647e7a6936e364ee841d8d8f` |
| 校验文件 | `release/好咯-0.1.170-universal.dmg.sha256` |
| 构建信息 | `release/好咯-0.1.170-universal.build-info.json` |
| 源码 | `c58b0e6ebc92ea8dcc4dfc99b29178b5d7a81138` 加当前未提交的版本与 R1/R2 修复 |
| 签名 | ad-hoc；未进行 Apple 公证 |

## 内容与验证

- 包含 7 个 Windows 非 EV 提交，Windows EV 签名代码保持排除；包含历史行情恢复视图、模拟图层重挂与 Mac Option 快捷键修复，以及先前分析安全存储不可用时的恢复修复。
- 沿用同一业务源码刚完成的全量验证：3168 通过、0 失败、6 Windows 平台条件跳过，类型检查与双主题实际图表验收通过。本轮重新构建 194 个前端模块。
- 双架构原始运行时哈希、签名、版本和架构检查通过；Universal 主程序、Electron Framework/Helper、Haolo AI 与 rg 架构检查通过。包内全部 main/renderer 文件与当前源码/构建逐字节一致，244 个附加资源逐字节一致，920 个构建输入未被打包修改。
- 748 个代码对象的 ad-hoc 签名及启动兼容配置检查通过；包内 Electron Node 模式烟测通过，包括安全存储失败恢复、依赖加载和 QR PNG 生成。
- 最终 DMG 的候选与正式路径均完成只读挂载，包内版本和两个架构的 CDHash 与源 App 一致；`hdiutil verify` 磁盘镜像校验通过。DMG 中显示为“好咯.app”，包含 Applications 快捷入口。
- 旧同版本测试包移动到 `release/archive/0.1.170-pre-windows-sync-20260919/`；全部 8 个历史 DMG 哈希保持。旧 170 的 SHA-256 为 `866a04ad1c2d23e84bc3efd01d9f4dab01e4aea01205aae89cb6a5c6c4ba63d4`，发布选包时应使用上表新哈希。

## 签名与发布状态

本机 `security find-identity -v -p codesigning` 返回 0 个有效身份，未配置 Apple 签名/公证环境。已向用户询问签名方案；当前按此前可用的 ad-hoc 路径交付本地候选，并通过 `HAOLO_ALLOW_UNTRUSTED_MAC_DMG=1` 执行现有本地制品收尾流程，未改动正式信任校验。此包不是 Apple 已签名公证的正式信任制品；若发布要求通过项目默认的 `mac-release-trust.mjs`，仍需 Developer ID 签名及 Apple 公证。

未自动安装、重启、推送源码或上传发布服务器。既有 M2-020/M2-013 的真实线路、目标设备和历史生产验收依赖不因本地打包完成而改变。

证据位于 `.git/mac-release-0.1.170-*`：构建、DMG 构建与收尾、包内/运行时/镜像校验日志，源码输入、历史制品、资源匹配与最终制品清单。原全量及界面验收证据见 `docs/windows-sync-review-20260919.zh-CN.md`。
