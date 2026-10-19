# Haolo Windows 仓库协作规范

- Windows 客户端代码修改、开发版启动、构建、测试和 Git 提交固定在 `C:/Users/潘艳芳/Documents/ChatGPT/haolo_windows_web3` 根目录执行，操作前核对工作目录与 Git 根目录。客户端具体要求继续遵守 [youle_desktop/AGENTS.md](youle_desktop/AGENTS.md)。业务后端使用独立的 `haolo_front_web3` 规范仓库。

## 多会话提交与发布（2026-10-19 用户要求）

- 各会话提交或部署前必须阅读统一的[多会话提交与部署规范](../haolo_front_web3/docs/multi-session-commit-and-deploy.zh-CN.md)，正文位于 `C:/Users/潘艳芳/Documents/ChatGPT/haolo_front_web3/docs/multi-session-commit-and-deploy.zh-CN.md`。
- 提交前检查工作区、暂存区和实际提交范围，只包含本任务文件／差异块；同文件存在其他会话改动时逐块核对并协调。保留他人的未提交和已暂存内容，不因共用 `dev` 就提交全部工作。
- 部署前核对相关会话进度、完整候选 SHA、功能范围及发布负责人；同一生产目标的完整批次串行执行，包含验收、回退和退役。等待或构建后刷新线上基线，发生漂移重新审查候选，不重放旧发布配置。
- 涉及云端策略时，必须分别核对 API 与独立策略 Worker 的实际运行版本、安装文件、协议和功能结果。只更新一端须说明并验证另一端保持兼容；客户端提交／构建不等于云端部署，API 更新也不等于 Worker 已更新。
- 若其他会话上线版本已经包含本任务修复，独立验收后记录交付归属，不重复发布较旧候选。部署锁只防止同时切换，不能代替包含性检查或两端验收。
- 仅修改规范不触发部署；服务、客户端安装包及独立网关继续各自遵守现有授权和发布流程。
