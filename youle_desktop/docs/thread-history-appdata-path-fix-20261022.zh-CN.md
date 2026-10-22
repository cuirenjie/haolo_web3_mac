# Windows AppData 重定向导致新任务历史恢复失败

日期：2026-10-22。范围：客户端本地历史恢复模块、定向测试及本机核验。

## 现场与原因

- 北京时间 01:39:36–01:40:51，0.1.178 开发版记录 `unverified_empty_rollout_path`；错误发生在首次用户消息持久化的历史预读阶段。
- 当前开发版从带 Windows 包身份的 Codex 环境启动，逻辑 `%APPDATA%/haolo_desktop/...` 被重定向到 `%LOCALAPPDATA%/Packages/OpenAI.Codex_*/LocalCache/Roaming/haolo_desktop/...`。两个路径的文件系统设备号和文件标识完全一致。
- JavaScript `fs.realpathSync` 保留逻辑路径，而运行时 `thread/read` 返回物理缓存路径。原目录包含校验将同一目录误判为越界，阻断空任务索引补建。
- 现场任务哈希 `1aaede76b7eb4166` 的 rollout 只有一条初始化记录，历史模式为 paginated；首次诊断时索引行缺失。已核对实际运行时为 0.163.0。
- 这是带特定环境触发条件的客户端兼容性缺陷，不是用户配置错误，也不代表所有 Windows 安装方式都会触发。

## 修复

Windows 使用 `fs.realpathSync.native` 统一解析运行目录、SQLite 目录、会话文件和恢复日志目录，再执行原有包含关系检查与写前复验。其他平台保留原行为。没有硬编码包路径、放宽外部目录访问，或跳过历史身份／空历史验证。

## 验证

- 95/95 项定向测试通过：历史恢复、真实捆绑运行时、AppServerClient 和逐轮诊断。
- 新增逻辑／物理路径别名回归，覆盖已有索引与空任务；目录 junction 指向外部时仍拒绝恢复。
- 真实运行时新增 Roaming AppData 隔离场景，验证首次持久化、连续对话、冷启动恢复和既有历史保留；模型响应只来自本机模拟服务。
- 在隔离测试中加载 HEAD 原实现，路径别名测试及真实 Roaming 场景均失败；真实场景复现与截图相同的 `unverified_empty_rollout_path`。
- TypeScript、模块语法检查及本任务 `git diff --check` 通过。此次未修改渲染器或发布产物。
- 工作期间开发版重新启动。北京时间 01:44:44 对原任务连续两次 `thread/read(includeTurns: true)` 成功，索引为 paginated。此次现场调用未触发补建写操作；rollout 内容逐字节保持一致，其他线程索引保持一致。未代用户重新提交分析请求。

本地核验证据位于 `.cache/history-path-20261022/`：`live-repair.json` 和两份 `baseline-*.log`。原未提交的语音资源文件保持原状；未提交、推送、打包或部署。

## 后续发布

2026-10-22 本修复已随 M1-435 Windows 0.1.179 正式包发布官网；本轮全量 4888 项回归通过。源码及发布证据见 [0.1.179 发布记录](windows-release-0.1.179-20261022.md)。
