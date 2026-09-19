# Windows → macOS 增量融合记录（2026-09-19）

关联任务：M2-020；纳入 M1-311～M1-318、M2-022～M2-024 的上游实现和记录。历史生产及目标设备验收边界保持。

## 来源与排除

Mac 基线为 `dev@5ef48440f522180ead6cdefe0e33175ae6bf1fdc`；Windows 来源为 `2534b02..7792b545652cf14bc3d70201c17cc3a3202d80ba`。两个仓库无共同祖先，采用 `cherry-pick -x` 移植 7 个提交。结束前只读核对远端，Windows dev 和 Mac origin/dev 均未移动。

| Windows 提交 | Mac 提交 | 内容 |
| --- | --- | --- |
| b674c1c | df9b57d | 定时静默检查更新、网关排查记录 |
| cc5ecdd | 0de8595 | AI 标注字号工具栏拖动 |
| 2cd82ad | cdf8661 | 发送前验证模型提供方、到期恢复 |
| 1455c33 | 54043bb | 行情响应生命周期、历史恢复、网关缓存限额 |
| 44af441 | cd73f23 | 香港线路、行情共享编码、可选差分更新 |
| 21ba840 | 9f1973f | 图表导航、缩放、设置和性能 |
| 7792b54 | 7630f10 | 历史执行计划绑定原消息市场与周期 |

按用户要求完整跳过 `e16b5758596ae59401393fa8276a08be3f1f7c21`。未引入 EV 签名客户端、策略、签名/验签脚本、测试、文档或 AGENTS 规则；Windows CI、原图标处理脚本与融合前逐字节一致。package.json 除原有未提交版本号外与基线完全一致，未引入 `forceCodeSigning`、签名 Hook 或新的 Windows 打包命令。

保护分支：`codex/backup-before-windows-sync-20260919`。原有 package.json、package-lock.json 和 0.1.170 测试包台账先备份并保存专用 stash，完成后恢复为未提交改动；两份版本文件与原文件逐字节一致。本次不改变依赖树。

## 融合处理

- 定时静默更新检查沿用上游；保留 Mac 已有的服务器 `force_update` 决策，可选更新允许关闭，下载与强制更新仍受保护。新增实际函数行为回归。
- 提供方验证同时保留 Mac 图片/视频使用兼容 GPT 根模型、固定推理元数据清理及有限恢复规则；保留认证重置时清理共享 transport 和旧网关缓存。
- 安全存储不可用时继续真实盘面分析和受控绘图、暂停个人风险执行方案；行情新鲜度、日历周期、账户隔离和月线/年线标题兼容保持。
- 图表采用上游缓存尺寸减少布局测量，同时使用主窗格自身高度，避免主图绘图边界侵入指标窗格。保留共享绘图持久化与手工撤销隔离。
- 新图表按钮接入全局字号偏移，补齐个人风险不可读提示的英文。网关背压采用上游共享编码并验证新报价不会被旧缓存覆盖。
- 更新测试注入依赖、WebSocket 模拟接口和重构后的断言；无网络句柄的超时测试显式维持测试事件循环。旧图表 QA 按最终设置契约验证“重置先适配再遵守已保存 Auto 偏好”，不再要求默认关闭 Auto 时永久自动适配。

## 本机验证

| 检查 | 结果 |
| --- | --- |
| 桌面全量 | 3167 项：3161 通过、0 失败、0 取消、6 Windows 平台跳过 |
| 网关全量 | 64 项：63 通过、0 失败、1 外部 Redis 环境跳过 |
| 定向兼容回归 | 74/74；网关背压/压缩 10/10 |
| Mac 捆绑真实内核 | 全量及定向中通过：同任务 Sol/DeepSeek 双向切换、实际发送 IPC、工具仅执行一次、403 止损 |
| 类型检查、Vite 构建 | 0.1.170 通过，194 modules；保留既有大 chunk 提示 |
| JavaScript 语法与差异 | 71 个变更 JS 文件通过，`git diff --check` 通过 |
| 图表 Electron 双主题 | 模式 24、测量 32、对数范围 36、有符号指标 8，共 100 组；Renderer 错误 0 |
| 坐标设置与锁定 | 12 组拖动、4 组设置检查；Renderer 错误 0 |
| 执行计划 Electron 双主题 | 原生点击、历史 1H/4H 卡片、保存/便利贴/预警保留原市场周期；Renderer 错误 0 |

桌面平台跳过包括 Windows 沙箱、Native Host、插件探测、UTF-8 和两个 Windows paginated 历史场景。真实 Redis 并发驱逐验收需要独立测试实例，本轮未配置。图表脚本退出时出现 Electron offscreen GPU mailbox 诊断，进程正常退出，全部行为断言与截图通过。

首轮暴露旧测试依赖/断言、超时模拟、两处字号和英文缺漏，均已处理；一次文件监听测试在并行负载下超时，独立及后续全量通过。最终通过结果来自本机重新运行，不把上游 Windows 日志当作 Mac 验收。

证据位于 `.git/windows-sync-20260919-` 前缀：`desktop-tests.log`、`targeted-tests.log`、`desktop-final.log`、`desktop-accepted.log`、`gateway-final.log`、`gateway-targeted.log`、`typecheck-final.log`、`build-final.log`、`chart-visual-final.log`、`chart-settings.log`、`execution-plan-visual.log`、`syntax.json`、`integrity.json`、`range-diff.txt`、`main-platform.diff`。截图及结构化报告位于 `youle_desktop/.cache/{tradingview-regression,chart-settings-lock,execution-plan-context-qa}/`。

## 交付

融合代码和兼容修正在本地 dev 提交，原有三个未提交文件继续保留。没有推送、重新打包、安装、重启既有客户端或部署服务。现有 0.1.170 DMG 仍是融合前测试制品，不包含本次新增代码。香港真实网络、生产容量、目标用户设备复测及 M2-013 历史验收继续按原边界执行。
