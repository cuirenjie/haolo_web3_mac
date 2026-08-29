# Haolo Chrome 插件执行计划

> 文档状态：已批准，Phase 8 外部发布依赖阻塞
>
> 计划版本：v1.0
>
> 最后更新：2026-08-07
>
> 当前实施进度：94%

## 1. 目标

为 Haolo 构建自有 Chrome MV3 扩展、Windows Native Messaging Host 和 Codex Tool Adapter，使根 Codex 能够在用户已登录的 Chrome 配置文件中安全、稳定地读取网页上下文并完成浏览器任务。

目标不是复制 OpenAI 的专有二进制，而是以可测试的用户结果对齐官方 Codex Chrome 体验，并在安装修复、任务可观察性、权限透明度、失败恢复和企业治理方面形成 Haolo 自己的优势。

首个正式版本限定：

- Windows 10/11 x64。
- Google Chrome 正式版。
- Haolo 当前用户的本机交互式会话。
- Codex 作为唯一根编排器。
- Chrome 扩展通过 Chrome Web Store 非公开条目分发。
- Computer Use、Edge、其他 Chromium 浏览器、远程无头浏览器暂不纳入本计划。

## 2. 成功标准

### 2.1 官方体验对齐

- 从 Haolo 插件页完成安装、启用、连接检查和试用。
- 支持自然语言自动路由和显式 `@Chrome` 调用。
- 使用用户已登录的 Chrome 标签页，不要求重新登录网站。
- 支持读取当前页、指定标签页、选中文本和可见页面结构。
- 支持从扩展侧边栏发起任务，并在 Haolo 桌面端继续同一任务。
- 支持自动启动 Chrome，并为每个任务创建或复用独立标签组。
- 按站点提供“仅本次”“始终允许此站点”“全部站点”“拒绝”。
- 支持站点允许列表和阻止列表。
- 浏览历史只能按请求临时授权，禁止永久授权。
- 支持导航、点击、输入、选择、滚动、上传、下载和页面截图。
- 支持敏感或不可逆动作的执行前确认。
- 支持多个已安装扩展的 Chrome Profile 实例识别、连接诊断、断线重连和一键修复；不依赖读取 Google 账号身份。

### 2.2 Haolo 增强目标

- DOM、可访问性树和截图三路混合观察，避免只依赖坐标点击。
- 每个动作展示目标站点、目标元素、效果级别和执行结果。
- 写操作支持计划预览；发送、发布、删除、购买等动作必须单独确认。
- 提供任务动作时间线、失败位置、可重试点和人工接管入口。
- 页面内容全部标记为不受信任上下文，阻止网页提示注入修改系统目标或权限。
- 密码框、支付信息、令牌和浏览器敏感字段默认不读取、不记录。
- 扩展不保存 OpenAI、Haolo 或第三方模型长期凭据。
- 提供比“卸载重装”更细的一键诊断和自动修复。
- 个人版与企业版共用协议，企业版额外支持域策略、强制安装和审计导出。

## 3. 总体架构

```text
Root Codex / App Server
        │
        ▼
Haolo Chrome MCP + Skill
        │
        ▼
ExecutorGateway / Tool Broker / CapabilityGrant
        │
        ▼
Haolo Desktop Chrome Broker（Electron Main）
        │  Windows Named Pipe
        ▼
Haolo Chrome Native Host（独立签名 EXE）
        │  Chrome Native Messaging / stdio
        ▼
Haolo Chrome MV3 Extension
        ├─ Service Worker
        ├─ Side Panel
        ├─ Content Scripts
        └─ tabs / scripting / debugger / tabGroups 等受控能力
```

### 3.1 组件责任

| 组件 | 责任 | 明确禁止 |
| --- | --- | --- |
| MV3 扩展 | 标签页观察、DOM/截图操作、侧边栏、Chrome 权限 | 持有模型密钥、绕过 Haolo 审批 |
| Native Host | Chrome stdio 协议、进程桥接、启动/连接 Haolo | 自行决定站点或动作权限 |
| Desktop Broker | 会话绑定、审批、站点策略、任务状态、恢复 | 将未经授权的网页数据发给模型 |
| Chrome MCP | 向 Codex 暴露稳定、最小化的工具契约 | 暴露任意 JavaScript 或任意 CDP 命令 |
| Chrome Skill | 工具选择、观察—行动—验证工作流、安全说明 | 仅靠提示词代替程序权限检查 |
| Tool Broker | CapabilityGrant、效果分级、审批和审计 | 把全局桌面权限交给模型 |

### 3.2 推荐代码边界

- `extensions/haolo-chrome/`：MV3 扩展 TypeScript 工程。
- `native/haolo-chrome-host/`：小型 Windows Native Host，优先使用 Rust 构建独立 EXE。
- `resources/mcp/haolo-chrome/`：本地 MCP server 与工具 schema。
- `resources/default-haolo-ai/plugins/.../chrome/`：Haolo Chrome 插件清单、Skill、图标和说明。
- `src/main/chrome/`：Desktop Broker、策略、注册表、健康检查、会话和审计。
- `src/renderer/`：插件安装页、Chrome 设置页、审批对话框、任务动作卡片。
- `test/chrome-*.test.mjs`：协议、权限、安装、主题和源代码边界回归。

最终目录可在 Phase 0 的 ADR 中调整，但扩展、Native Host、MCP、主进程和 Renderer 必须保持清晰边界。

## 4. 权限与安全模型

### 4.1 授权层级

1. **扩展安装授权**：由 Chrome 展示权限并由用户确认。
2. **Native Host 授权**：`allowed_origins` 只允许正式 Haolo 扩展 ID，不使用通配符。
3. **本地会话授权**：Named Pipe 仅当前 Windows 用户可访问，使用短期 nonce 建立会话。
4. **站点授权**：按规范化的 scheme、host、port 校验；重定向跨站后重新授权。
5. **工具授权**：CapabilityGrant 约束线程、轮次、标签页、站点、工具和有效期。
6. **动作授权**：发送、发布、删除、购买、提交表单等外部副作用在执行前确认。

### 4.2 效果等级

| 等级 | 示例 | 默认策略 |
| --- | --- | --- |
| Observe | 读取可见文本、DOM 摘要、截图 | 需要站点授权 |
| Navigate | 打开页面、切换标签、滚动 | 需要站点授权，跨站重新检查 |
| Edit local form | 输入草稿、选择选项 | 需要站点授权并展示动作状态 |
| External write | 发送消息、发布、提交、删除 | 每次执行前确认 |
| High impact | 支付、安全设置、凭据、账号权限 | 默认拒绝或强制用户接管 |

### 4.3 数据边界

- 扩展和 Native Host 日志默认不记录页面正文、Cookie、密码、令牌或表单值。
- 模型只接收完成当前步骤所需的结构化页面摘要、局部截图或显式选中文本。
- 浏览历史没有“始终允许”；每次请求单独审批并限制返回条数和字段。
- 页面文本携带来源标签，不能作为系统指令、权限变更或任务重定义依据。
- 所有工具参数在主进程再次校验，不能信任模型、MCP 或扩展单方输入。

## 5. 分阶段执行计划

### Phase 0：规格、基线与安全契约

状态：`completed`

目标：在编码前冻结第一版能力边界、协议和验收样例。

步骤：

1. 建立官方体验对照表和 50 个真实浏览器任务基准集。
2. 完成威胁模型：网页提示注入、跨站重定向、恶意 iframe、错误标签页、凭据泄漏、Native Host 冒充、重放和越权。
3. 编写扩展—Host—Broker—MCP 的版本化协议和错误码。
4. 定义 Chrome 工具最小集合，禁止 `eval`、任意 JavaScript 和任意 CDP passthrough。
5. 定义站点授权、效果等级、敏感动作确认和审计事件 schema。
6. 确认 Chrome Web Store 开发者账号、名称、隐私政策和非公开发布策略。
7. 编写 ADR，确定 Native Host 语言、构建与签名方案。
8. 建立 Codex Runtime、App Server、MCP 和插件协议兼容矩阵，决定首个实现基线和升级方式。

阶段验收：

- 协议、威胁模型、工具 schema、基准任务集均通过代码评审。
- 每个写工具都能映射到效果等级和审批规则。
- 未开始任何网页控制前，权限失败必须是 fail-closed。

### Phase 1：扩展骨架、固定 ID 与 Native Host 握手

状态：`completed`

目标：打通不包含网页内容的可靠连接链路。

步骤：

1. 创建 MV3 扩展、Service Worker、Side Panel 和主题基础。
2. 创建 Chrome Web Store 草稿条目，取得稳定扩展 ID。
3. 实现 Native Host 协议、`allowed_origins` 和消息大小/超时限制。
4. 实现 Electron Main Named Pipe Broker、当前用户 ACL 和短期握手 nonce。
5. 扩展显示 Haolo 未安装、未运行、版本不兼容、已连接等状态。
6. 将 Native Host 加入 Haolo 安装包，注册/卸载 HKCU NativeMessagingHosts 项。
7. 实现启动检查、版本协商、心跳、断线重连和一键修复原语。

阶段验收：

- 全新 Windows 用户安装后可在 3 步内完成连接。
- Native Host 不能被其他扩展调用，其他 Windows 用户不能连接 Named Pipe。
- Haolo/Chrome 任一侧重启后能够自动恢复。
- 安装、升级、降级、卸载不会留下错误注册表项。

### Phase 2：只读页面上下文与 Chrome 侧边栏

状态：`completed`

目标：先交付安全、可用的只读 Chrome 助手，不开放网页写操作。

步骤：

1. 枚举窗口、标签页、标签组和已连接的扩展实例；每个 Profile 使用本地随机实例 ID 和用户可选标签，不读取 Google 账号身份。
2. 读取当前页标题、URL、可见文本、结构化 DOM 摘要和局部截图。
3. 支持选中文本、“询问 Haolo”右键菜单和标签页引用。
4. 实现站点首次授权、仅本次、长期允许、拒绝及列表管理。
5. 实现侧边栏中的新建任务、当前 Haolo 任务、最近任务和流式状态。
6. 支持 YouTube 可用字幕的时间戳上下文，但不绕过站点访问策略。
7. 实现上下文裁剪、敏感字段过滤和页面提示注入来源标记。

阶段验收：

- 只读能力无法触发点击、输入、下载、上传或页面状态变更。
- 未授权域名和跨域 iframe 数据不可读取。
- 侧边栏与桌面端能继续同一任务且不会串线程。
- 亮色/暗色的默认、悬停、焦点、选中、加载、断线、错误和禁用状态全部通过回归。

### Phase 3：Codex 插件、MCP 工具与自动路由

状态：`completed`

目标：让根 Codex 能稳定发现、选择并使用只读 Chrome 工具。

步骤：

1. 构建 Haolo Chrome 插件清单、Skill、图标和本地 marketplace 条目。
2. 构建本地 Chrome MCP server，通过 Desktop Broker 调用扩展。
3. 定义 `list_tabs`、`read_page`、`read_selection`、`capture_view`、`get_task_state` 等只读工具。
4. 将 MCP 调用绑定 thread、turn、task、tab 和 CapabilityGrant。
5. 支持自然语言自动选择 Chrome 与显式 `@Chrome`。
6. 在消息流中显示连接、观察、等待、授权和结果卡片。
7. 增加新会话加载、插件启用/禁用和 Host 不可用的恢复逻辑。

阶段验收：

- 基准集中的只读任务能够自动选择正确标签页和工具。
- Codex 不能绕过 MCP 直接调用 Native Host。
- 插件禁用后，新会话中不再出现 Chrome 工具；已有调用安全终止。
- 工具超时、用户取消、切换线程不会产生幽灵任务或串会话。

### Phase 4：受控浏览器操作

状态：`completed`

目标：加入导航、点击、输入和滚动，并保持程序化权限强制。

步骤：

1. 实现 DOM selector、可访问性语义和截图坐标的混合元素定位。
2. 实现导航、点击、输入、选择、滚动、快捷键和等待页面状态。
3. 每个动作采用“观察—定位—执行—验证”闭环并返回可验证结果。
4. 自动创建任务标签组，避免污染用户原有标签页。
5. 实现跨域导航、弹窗、新标签、iframe 和 SPA 路由变化处理。
6. 增加页面变化导致 selector 失效时的重新观察和有限重试。
7. 对表单输入显示目标元素和脱敏预览，不回传密码框内容。

阶段验收：

- 未获站点授权时，任何操作都不能执行。
- 操作目标与当前标签页、当前域和 Grant 不一致时立即拒绝。
- 重试不能重复提交表单或重复产生外部副作用。
- 用户键鼠接管、取消任务或关闭标签页时能在下一动作前停止。

### Phase 5：敏感动作、上传下载与高级能力

状态：`completed`

目标：覆盖官方主要能力，同时把高风险动作纳入可解释审批。

步骤：

1. 增加发送、发布、提交、删除等外部写动作的执行前确认。
2. 高影响动作采用 prepare/commit 两阶段执行和幂等 operation ID。
3. 增加文件上传：只允许用户或当前任务显式授权的文件。
4. 增加下载：记录来源、文件名、目标位置和扫描/打开状态。
5. 增加浏览历史临时授权，禁止持久化为永久允许。
6. 增加书签、下载和标签组等可选权限的按需请求。
7. 增加动作时间线、失败点重试、人工接管和安全恢复。

阶段验收：

- 所有外部写操作都存在可审计的授权记录与结果凭证。
- 模拟超时、崩溃、重复响应时不会重复发送、删除或提交。
- 文件访问不能越过显式选择范围，路径和符号链接检查失败关闭。
- 支付、密码、安全设置等默认拒绝或要求用户完成关键步骤。

### Phase 6：插件安装体验、设置与自助修复

状态：`completed`

目标：让普通用户无需理解扩展、Native Host 或 MCP 即可完成安装和维护。

步骤：

1. 在 Haolo 插件页加入 Chrome 详情、安装、启用、更新和删除状态机。
2. 安装按钮打开 Chrome Web Store 非公开页面，并轮询扩展连接结果。
3. 创建 Chrome 设置页：Profile、站点权限、历史权限说明、版本和诊断。
4. 创建逐层健康检查：扩展、扩展 ID、Profile、Native Host、注册表、Broker、MCP、插件开关。
5. 提供最小修复动作，而不是默认要求全部卸载重装。
6. 完成所有界面的亮色/暗色与完整交互状态实现。
7. 增加隐私说明、权限变更提示和数据清除入口。

阶段验收：

- 全新用户可以从 Haolo 内完成安装、验证并启动测试任务。
- 每个常见故障都能定位到具体层并给出可执行修复。
- 主题、键盘导航、焦点、屏幕阅读器标签和高缩放布局通过回归。
- 检查不存在硬编码浅色控件或暗色模式不可见状态。

### Phase 7：安全、稳定性、性能与 E2E 评测

状态：`waiting_review`

目标：达到可灰度发布门槛。

步骤：

1. 对扩展、Native Host、Named Pipe、MCP 和 IPC 做威胁模型回归和模糊测试。
2. 测试恶意网页指令、隐藏文本、跨域 iframe、下载诱导和错误页面身份。
3. 测试 Chrome/Haolo 升级、崩溃、休眠、网络切换、多 Profile 和多窗口。
4. 执行 50 项基准任务，并与当前官方 Codex Chrome 体验作盲测对比。
5. 优化 DOM 摘要、截图大小、动作响应时间、模型上下文和重试次数。
6. 确认日志脱敏、数据保留、审计导出和用户数据清除。
7. 完成 Windows 干净虚拟机、升级安装和卸载残留测试。
8. 完成 Native Host 与正式安装器的 Authenticode 签名、发布者校验和篡改测试。

发布门槛：

- 只读任务成功率不低于 95%。
- 核心操作任务成功率不低于 90%，且不得存在未授权成功执行。
- 本地工具调用确认延迟 p95 不高于 200ms；典型页面结构快照 p95 不高于 500ms。
- 断线后 3 秒内恢复或明确显示可操作错误。
- 0 个高危安全缺陷，0 个明文凭据日志，0 个跨站越权。
- 亮色/暗色、安装、升级、审批和故障恢复测试全部通过。

### Phase 8：Chrome Web Store、灰度与正式发布

状态：`blocked`

目标：完成非公开商店发布和可回滚灰度。

步骤：

1. 准备商店说明、截图、权限用途、隐私政策和数据披露。
2. 提交非公开条目审核，处理权限或政策反馈。
3. 对内部测试组发布，收集成功率、失败分类和用户接管数据。
4. 按 5% → 20% → 50% → 100% 分组开放 Haolo 功能开关。
5. 扩展和 Native Host 使用独立兼容矩阵，禁止不兼容版本自动启用写操作。
6. 建立紧急停用、回滚、扩展下架和 Host 修复发布流程。
7. 达标后宣布正式可用，并保留 Computer Use 独立后续项目入口。

阶段验收：

- Chrome Web Store 非公开版本审核通过并可自动更新。
- 灰度期间没有权限绕过、重复副作用或不可恢复安装故障。
- 关键指标满足 Phase 7 门槛，回滚演练成功。

## 6. 进度跟踪

| 阶段 | 状态 | 完成度 | 最近结论 |
| --- | --- | ---: | --- |
| 计划审核 | completed | 100% | 用户已批准全部计划 |
| Phase 0 | completed | 100% | 协议、18 个工具契约、威胁模型、策略测试和 50 项评测基线已完成；专项测试 9/9 通过 |
| Phase 1 | completed | 100% | MV3 骨架、固定开发 ID、Native Host/Broker 双向握手、来源校验、安装恢复和扩展 ZIP 已完成；15/15 测试与类型检查通过 |
| Phase 2 | completed | 100% | 站点单次/持续授权、撤销、页面快照、选区、截图、等待条件和侧边栏任务入口已完成；18/18 专项测试及真实 Chrome MV3/明暗主题/敏感字段过滤 smoke 通过 |
| Phase 3 | completed | 100% | `chrome@haolo-bundled`、自动路由技能、18 工具 MCP、令牌化 loopback Bridge、CapabilityGrant 与站点策略执行已完成；56/56 回归及插件官方校验器通过 |
| Phase 4 | completed | 100% | 导航、点击、输入、选择、滚动、按键、混合定位、隔离任务标签组、iframe、幂等、用户接管和动作后校验已完成；18/18 专项测试及真实 Chrome 动作 smoke 通过 |
| Phase 5 | completed | 100% | prepare→桌面批准→commit、幂等重放、目标变更拒绝、artifact 绑定上传、下载及历史记录一次性权限已完成；23/23 专项测试、真实 Chrome smoke、明暗主题和类型检查通过 |
| Phase 6 | completed | 100% | Haolo 插件页入口、扩展安装引导、Host/Broker 诊断修复、自动弹出审批、上传文件选择、内存审计和事件联动已完成；明暗主题及全部交互状态真实 Chromium 截图通过，类型检查与生产构建通过 |
| Phase 7 | waiting_review | 92% | 50/50 基准、83/83 Chrome 专项、真实 Chrome MV3/读写/iframe/审批/上传下载/用户接管、类型检查和生产构建通过；授权 p95 0.034ms、典型快照 p95 8.562ms；正式签名包的干净 Windows 安装/升级/卸载验收待代码签名证书 |
| Phase 8 | blocked | 75% | 最小权限审计、商店文案/隐私与数据披露、1280×800 明暗截图、宣传图、Store ZIP/校验和、确定性 5→20→50→100 灰度、紧急停用、版本兼容矩阵、回滚手册和独立预发布安装包已完成；等待正式商店 ID、发布主体/公开 URL 和 Authenticode 证书后才能送审与真实灰度 |

状态只使用：`pending`、`in_progress`、`blocked`、`completed`、`waiting_review`。

## 7. 每次进度更新格式

完成每个步骤或阶段后，必须同步更新本文件，并向用户报告：

1. 当前阶段与整体完成度。
2. 本次实际完成内容和涉及文件。
3. 已运行的测试、结果和关键指标。
4. 与官方体验对照后新增、持平或仍有差距的项目。
5. 新风险、阻塞和需要用户决定的事项。
6. 下一步以及进入下一阶段的条件。

不以“代码已写完”作为阶段完成标准。只有阶段验收项全部通过，才能将状态改为 `completed`。

## 8. 主要风险与前置决策

| 风险/决策 | 处理原则 |
| --- | --- |
| Chrome Web Store 审核时间不可控 | Phase 1 提前创建草稿和固定 ID，Phase 8 正式送审 |
| `debugger`、history、downloads 权限敏感 | 优先可选权限、按需请求、用途说明和最小数据返回 |
| 官方 App Server 插件安装接口仍在开发 | 不把生产路径绑定实验 API，使用 Haolo 本地 marketplace 与稳定 CLI/MCP 边界 |
| Haolo 当前审批默认过宽 | Chrome 写能力开放前先完成专用策略和 fail-closed 审批链 |
| 网页提示注入 | 页面上下文来源标记、权限不受页面控制、敏感动作程序化审批 |
| Chrome/扩展/Host 版本漂移 | 协议版本协商、兼容矩阵、只读降级和一键修复 |
| 多 Profile 连接错误 | 显式展示 Profile 与标签页归属，任务绑定后禁止静默切换 |
| 用户与 Agent 同时操作 | 检测用户接管，暂停后续动作并要求恢复确认 |

## 9. 参考基线

- [OpenAI Chrome extension](https://learn.chatgpt.com/docs/chrome-extension)
- [OpenAI Plugins](https://learn.chatgpt.com/docs/plugins)
- [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Chrome extension distribution](https://developer.chrome.com/docs/extensions/how-to/distribute)
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Haolo 工作流与 Agent 目标架构](../../docs/haolo-workflow-agent-architecture.md)

## 10. 审核后启动规则

用户批准本计划后：

1. 将文档状态改为“已批准，Phase 0 进行中”。
2. 只启动 Phase 0，不提前实现后续写能力。
3. 每完成一个编号步骤更新进度；每完成一个阶段提交验收报告。
4. 如果范围、权限模型或商店分发方式发生实质变化，先更新计划并再次请求审核。
