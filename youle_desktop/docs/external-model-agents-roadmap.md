# Haolo 外部模型 Agent 长期路线

> 这是本项目关于外部模型接入的持久决策记录。后续对话即使发生上下文压缩，也应先读取本文，再继续实施，不要把外部模型直接替换成 Codex 原生子线程。

> **2026-07-22 补充：** 工作流画布、根 Codex 动态重规划、统一 Executor 协议、CapabilityGrant、Agent Host、跨用户 Agent 和定时工作流的目标架构，统一以 [`../../docs/haolo-workflow-agent-architecture.md`](../../docs/haolo-workflow-agent-architecture.md) 为准。本文继续约束当前外部模型只读阶段、生产集中中转和凭证安全。两者对未来上下文选择、预算、并发、逐次审批或 Agent 行权范围的描述发生冲突时，以新架构文档为后续目标；在相应阶段实现、测试和灰度前，当前只读 Runtime 不得提前扩大权限。
>
> **2026-07-27 执行节点补充：** “外部模型只读”边界保持不变，但集群工作流现已新增独立的 `codex_subagent` 节点类型。它不是外部模型权限升级，也不替换当前用户任务或现有原生子线程；它通过统一 `ExecutorGateway` 启动隔离的临时 Codex Worker，并只在根 Codex 为 workflow/node/task/attempt 签发的 `CapabilityGrant` 与对应 App Server sandbox 内执行。未来远程 Haolo、Claude Code、WorkBuddy 等 Agent 继续新增 Adapter，不修改画布与调度核心。
>
> **2026-07-29 Windows 沙箱兼容：** Haolo 的默认、外部模型和集群独立 Codex Home 统一强制使用 `windows.sandbox = "unelevated"`，同时关闭实验性 `features.network_proxy`。该设置仍保留 Windows 受限令牌与既有 `CapabilityGrant` 边界，但绕开 Codex Desktop 0.144.x 在 UAC 提权助手成功后仍反复判定 setup marker 不兼容、继而弹出“找不到指定的模块”的上游故障；App Server 启动参数与已有配置迁移双重兜底，避免旧会话继续走提权 helper。
>
> **2026-07-29 问答/计划模式终态收敛：** Provider 问答与 GPT 计划模式只有当前主进程和 Renderer 仍共同持有对应 `interactionId` 时才允许显示“运行中/正在思考”。应用重启、开发热重载、连接丢失或用户停止导致执行所有权消失时，恢复历史必须把遗留的运行中回答、计划过程和看板步骤统一收敛为失败，并补充可见的中断终态；如果已持久化的最终回答明确为 completed，则只把迟到的看板状态修复为完成。用户停止还必须通过独立 Provider 取消 IPC 中止请求，不能误走 Codex turn interrupt，也不能让迟到响应覆盖终态。
>
> **2026-07-27 派生媒体补充：** 外部模型的视频输入能力不等于图片文件输出能力。问答语义规划需要真实视频帧交付时，必须生成显式 `derivedMedia.extract_video_frames` 计划，由桌面 Host 只读取被选中的原视频并提取确切时间点，结果以本地 `Artifact` 返回；不得让文本模型编造图片 URL，也不得因此扫描分组文件。普通媒体理解请求使用独立的较长响应窗口，问答与集群继续共用 Provider Adapter 的媒体超时策略。
>
> **2026-08-16 根 Codex 个人上下文补充：** 桌面端新增的全局 `personal_context` MCP 仅供根 Codex 通过短期本地 loopback token 按需读取当前 Haolo 用户的显式长期记忆与 Binance 只读账户上下文。它不是阶段 4 的 External Agent Bridge，也没有把私有账户、记忆、MCP 或写入权限开放给当前外部模型 Runtime；外部模型继续只能消费 Host/根 Codex 显式选取并经既有 `ContextSourcePlan` 或 `CapabilityGrant + ContextPackage` 交付的最小上下文。未来若让外部节点访问此类来源，必须另行实现节点级授权、敏感度分类、审批与审计，不能复用根 Codex 的本地 bearer token。
>
> **2026-08-16 普通串行执行产品覆盖：** Haolo 桌面客户端当前固定为普通串行执行模式。Renderer 不再提供计划/集群任务模式切换，历史 `multi-agent`、`multi-model-cluster` 偏好在边界统一降级为 `execution`；每轮根 Codex 都收到禁止 `spawn_agent`、协作委派、并行任务和后台任务分支的强制策略，App Server 每会话并发线程上限固定为 1，工作流启动 IPC 和旧画布节点语义编译入口均失败关闭。图片和视频仍通过同一个根执行轮串行运行。此覆盖撤销 2026-07-26 的三模型并行临时产品覆盖；历史工作流结构仅保留兼容读取，不得启动新运行。

## 目标与固定边界

Haolo 计划接入 Kimi、DeepSeek、Gemini、Perplexity、Grok、MiMo、Claude 和 ChatGPT/OpenAI。Codex 继续担任默认主编排；外部模型分阶段获得能力：

1. 首先只用于调研、总结、代码审查和建议。
2. 向外部模型发送能让当前角色完成得更出色的高质量上下文；既避免无关噪音，也不以机械最小化为目标。
3. 外部模型第一阶段仍没有 Shell、浏览器、连接器、MCP 工具或写入权限；本地文件读取已分两条只读路径开放：集群外部模型节点使用根 Codex 节点级 `CapabilityGrant + ContextPackage`，问答模式使用桌面 Host 对当前分组目录和本次上传文件的直接 read-through。集群中的 `codex_subagent` 是另一类执行器，可按根 Codex 签发的 `read_only`、`workspace_write` 或 `full_access` 节点授权执行，不得与外部模型通道混淆。
4. 问答模式的 read-through 不是默认倾倒整个分组：Haolo/Codex 先做语义范围决策，显式选择当前分组、指定上传资料或不读取文件；图片和视频原生附件本身不触发分组文件上下文。
5. 集群模式采用同一语义选择原则：根 Codex 在画布计划中为每个节点固化 `contextSelection`，分别决定是否读取当前分组、读取哪些上传文档、把哪些图片/视频作为原生输入交给该节点。Workflow Runtime 只校验并执行该契约，不再通过正则或附件存在重新猜测，也不默认向所有节点广播附件。
6. 媒体传输策略也属于统一 Executor Adapter 的节点执行边界：Doubao 视频若已有阿里云 OSS 区域 URL，优先转换为同桶的 OSS Accelerate URL，避免上游跨区连接超时和重复上传；纯本地视频才通过 Sub2API 的短期输入媒体桥接暂存。两条路径都只产生当前节点显式 `ArtifactRef`，不进入文件 `ContextPackage` 或隐式全局上下文。
7. “兼容 OpenAI API”只表示请求协议相似，不代表模型自动拥有动手能力。
8. 未来的动手能力必须由 Haolo Tool Broker 授予，并经过策略、沙箱、审批和审计；模型本身不得直接持有系统权限。
9. 关闭外部模型功能时，现有 Codex app-server、`haolo_ai` Provider、现有 DeepSeek MCP、联系人聊天和内部子 Agent UI 保持原样。
10. 对模型声明的“输入能力”和系统可验证的“交付能力”分开建模；涉及文件、图片或其他可下载产物时，只接受 Host/Executor 实际生成并登记的 `Artifact`，不能把模型文本中的外部链接当成已完成交付。

## 最新产品决策：生产环境集中中转（2026-07-20）

管理员只在后台配置一次上游厂商凭据，所有 Haolo 用户通过现有中转链路使用外部模型。生产默认链路固定为：

```text
厂商 API Key
  → D:\zhongzhuan（账号/渠道、加密凭据、调度、计费与审计）
  → D:\youle_agent_ms（用户身份、授权与中转访问凭据下发）
  → Haolo 桌面客户端
  → 集群工作流：Codex 主编排调用只读外部模型节点
    或 问答模式：所选模型经桌面 Host 只读文件通道直连回答
```

- 厂商 API Key 只由 `D:\zhongzhuan` 保存和使用，Haolo 客户端与 Renderer 不得接收、读取或保存厂商 Key。
- Sub2API“API 密钥”是客户端访问中转服务的下游凭据，不等于厂商上游 Key；不得在轮换厂商 Key 时批量删除用户 API 密钥。
- 厂商上游凭据应在 Sub2API“账号管理”或“渠道管理”中轮换，并在厂商控制台撤销旧 Key。
- 已实现的桌面端 BYOK Vault、设置页和直连 Runtime 仅保留为默认关闭的开发预览/应急诊断能力，不进入生产用户主路径；正式接入前需要隐藏或受管理员开发开关约束。
- 外部 Agent 的 Provider Adapter 仍保留统一接口，但生产 Transport 改为 Haolo 中转，而不是从桌面直连八家官方 API。

中国区当前部署约束：Claude 不从 Haolo 客户端或中转服务器直连 Anthropic 官方 API；生产上游使用管理员采购的不鸣 AI OpenAI-Compatible 专用 Key。该 Key 当前只授权不鸣公开模型 `sonnet-5` 与 `fable-5`，在中转内部映射为稳定别名 `claude-sonnet-5` 与 `claude-fable-5`。必须新建独立的 `Claude-Buming` 账号和 Claude 分组，不得覆盖或复用现有承担 Codex/媒体业务的“不鸣AI”账号记录。界面和审计应明确标记实际上游为不鸣 AI，不能冒充 Anthropic 官方直连；敏感数据外发策略必须按第三方上游处理。2026-07-20 已完成独立 `Claude-Buming` 账号的连通性测试、账号级模型映射 `claude-sonnet-5 -> sonnet-5`、`claude-fable-5 -> fable-5`，并建立专属 OpenAI 协议分组 `Haolo-Claude`；已通过只读管理接口确认生产分组 ID 为 `5`，分组当前有 1 个可用账号。映射非空时同时构成账号的允许模型集合，因此不再额外使用原始模型名白名单。

2026-07-20 已在 `D:\youle_agent_ms` 增加默认关闭的 Claude 用户 Key 自动开通配置：`SUB2API_CLAUDE_KEY_NAME` 默认 `claude`，只有明确设置 `SUB2API_CLAUDE_GROUP_ID` 后才把 Claude 加入用户级中转 Key 列表。未配置时现有 Codex、DeepSeek、Kimi 流程和登录响应保持不变；正式启用前必须先确认生产分组 ID，并用单一灰度用户验证开通、调用、余额和审计。

2026-07-20 已在 Haolo 桌面客户端完成 Claude 集中中转的默认关闭适配：`claude`/`anthropic` 会归一为独立 Claude Provider，不再复用 Codex Key；默认公开模型别名为 `claude-sonnet-5`；只有当前登录会话的 `modelProviders` 实际包含 Claude 时，Claude 联系人才从“待机”变为“在线”。界面明确披露“不鸣 AI（第三方上游）”。本切片不主动刷新既有会话，因此灰度用户需在后端启用后重新登录，才会领取并使用自己的 Claude 下游中转 Key。Windows 客户端 `0.1.157` 安装包已完成类型检查、生产构建和 726 项完整测试，当前仅保存在本机，尚未上传生产更新系统，等待公开更新说明审批。

2026-07-20 已为 AgentMS 增加 Claude 灰度保护：配置 `SUB2API_CLAUDE_GROUP_ID=5` 本身不代表全量放开；`SUB2API_CLAUDE_ROLLOUT_ALL` 默认 `false`，只有列入 `SUB2API_CLAUDE_ROLLOUT_USER_IDS` 或 `SUB2API_CLAUDE_ROLLOUT_EMAILS` 的用户才领取 Claude Key。生产现已配置 Group ID `5` 和一个邮箱灰度账号，全量开关仍为 `false`。由于 `Haolo-Claude` 是专属分组，AgentMS 会仅在中转明确返回“用户无权绑定该分组”的 403 时，先保留用户原有专属分组并增量授权目标分组，再重试创建 Key；该逻辑已部署生产 release `20260720-225000-claude-auto-group`。灰度账号已生成 Claude 用户 Key，并通过 `claude-sonnet-5` 实际请求验证，HTTP 200、模型映射和完成状态正常。桌面客户端发布及登录取 Key 验证完成前，不得把 `SUB2API_CLAUDE_ROLLOUT_ALL` 改为 `true`。

2026-07-21 排查 Claude 联系人仍显示待机时确认：生产发布目录的 `backend/.env.lab` 会覆盖 systemd 的 `/etc/youle/wechat-login.env` 同名变量，灰度名单变更必须修改实际生效的 `.env.lab`，并同步维护 EnvironmentFile，不能只改 systemd 配置。当前客户端账号 `psmsn2333+233@gmail.com` 已加入 Claude 灰度名单，用户级 Claude Key 已生成并以 `claude-sonnet-5` 实测 HTTP 200；客户端需要在名单生效后重新登录一次以领取新的 Provider Key 快照。

2026-07-21 完成 Claude OpenAI-Compatible 计费兼容修复：不鸣响应会同时返回 Chat Completions 原生字段 `prompt_tokens`/`completion_tokens` 和 Responses 兼容字段 `input_tokens`/`output_tokens`，其中后者的 `output_tokens` 可能固定为 `0`。中转的 raw `/v1/chat/completions` 路径现明确以该协议原生字段为准，Responses/Codex 路径保持原逻辑不变。新增用例和 Raw Chat Completions 回归均通过；生产镜像已切换为 `haolo/sub2api:20260721-claude-usage-fix-443f5bd`。灰度账号实测请求 HTTP 200，新用量记录 ID `230520` 正确落账 `input_tokens=16`、`output_tokens=4`、`actual_cost=0.000108`，修复前同类请求只记录输入费用。生产切换后容器健康且自身重启计数为 `0`。

2026-07-21 完成 Grok 集中中转接入：不鸣 AI OpenAI-Compatible 上游已验证公开模型 `grok-4.5` 与 `grok-4.3`；Sub2API 建立独立账号 `Grok-Buming`（账号 ID `51`）和专属分组 `Haolo-Grok`（分组 ID `7`），两个模型采用同名映射并分别通过下游 Key 实测 HTTP 200。AgentMS 提交 `cb15a27` 增加 `SUB2API_GROK_KEY_NAME` 与默认关闭的 `SUB2API_GROK_GROUP_ID`，生产明确设置 Group ID `7` 后向所有登录用户开通 Grok Key，并沿用专属分组自动增量授权；`joiec@qq.com` 的真实用户 Key 已成功生成并完成 `grok-4.5` 全链路验证。桌面源码已加入 Grok 联系人、独立 Provider 路由以及 `grok-4.5`/`grok-4.3` 模型选择，默认使用 `grok-4.5`；当前改动已通过相关测试、类型检查和生产构建，但尚未单独发布 Windows 安装包。

2026-07-21 完成 MiMo 集中中转接入：不鸣 AI OpenAI-Compatible 上游已验证 `mimo-v2.5-pro`；Sub2API 建立独立账号 `MiMo-Buming`（账号 ID `52`）和专属分组 `Haolo-MiMo`（分组 ID `8`），同名模型映射及临时下游 Key 全链路实测 HTTP 200。AgentMS 提交 `07c6743` 增加 `SUB2API_MIMO_KEY_NAME` 与默认关闭的 `SUB2API_MIMO_GROUP_ID`，生产同时在 systemd EnvironmentFile 和实际覆盖配置 `.env.lab` 启用 Group ID `8`，向所有登录用户自动开通 MiMo Key；`joiec@qq.com` 与 `psmsn2333+233@gmail.com` 已生成真实用户 Key，其中前者完成 `mimo-v2.5-pro` 全链路验证。桌面源码已加入 MiMo 联系人、独立 Provider 路由和 `mimo-v2.5-pro` 模型选择；相关测试 79 项、类型检查和生产构建通过，但尚未单独发布 Windows 安装包。

2026-07-21 完成 Perplexity 集中中转接入：Sub2API 使用用户在后台录入的官方账号 `Perplexity-Official`（账号 ID `53`），建立专属分组 `Haolo-Perplexity`（分组 ID `9`），第一阶段仅开放 `sonar-pro`。临时下游 Key 和真实用户 Key 均全链路实测 HTTP 200，响应中的 citations 与 search results 能穿透中转；`joiec@qq.com` 的真实请求返回 16 条引用。AgentMS 提交 `2bef6ae` 增加 `SUB2API_PERPLEXITY_KEY_NAME` 与默认关闭的 `SUB2API_PERPLEXITY_GROUP_ID`，生产已在 EnvironmentFile 和实际覆盖配置 `.env.lab` 启用 Group ID `9`，所有登录用户自动领取 Perplexity Key。桌面源码已增加 Perplexity 联系人、`sonar-pro` 独立路由，并把引用 URL 追加到可见回复；相关测试 80 项、类型检查和生产构建通过，但尚未单独发布 Windows 安装包。

2026-07-21 完成 Kimi K3 客户端接入：现有官方 Kimi 账号（账号 ID `5`）和 Kimi 分组（分组 ID `4`）已包含 `kimi-k3 -> kimi-k3` 同名映射，无需新建账号或轮换 Key。官方模型列表与 `joiec@qq.com` 真实用户中转 Key 均实测 `kimi-k3` HTTP 200。桌面客户端将 `kimi-k3` 加入 Kimi 联系人的模型列表并设为默认，保留 `moonshot-v1-128k` 作为兼容回退。由于 Kimi K3 当前只接受 `temperature=1`，客户端仅对该模型强制使用 `1`，其他模型继续沿用原有温度参数；相关测试 77 项、类型检查和生产构建通过，但尚未单独发布 Windows 安装包。

2026-07-25 修复 Kimi K2.6 问答模式温度兼容：联系人问答链路原先会为除 K3 外的模型统一补充 `temperature=0.7`，但 K2.5/K2.6 会依据思考模式使用固定温度并拒绝其他值。桌面请求层现对 `kimi-k2.5`/`kimi-k2.6` 省略该字段，让上游采用模型合法默认值；K3 继续强制使用 `1`。新增 K2.6 `question_answer` 模型池回归用例，相关 API 测试、外部模型安全契约、类型检查和生产构建通过；当前登录会话经生产问答模型池与用户中转 Key 实测 `kimi-k2.6` 返回精确响应 `KIMI_K2_6_OK`。

2026-07-27 增加本地文件审查能力。多模型集群的每个正式模型节点都声明 `local.files.review`，但只有根 Codex 在运行时判定需要后才签发当前工作流、当前节点有效且禁止转授权的只读 Grant；Context Broker 使用用户目标和节点职责独立组装材料包，不再共享一份运行级全文上下文。画布显示能力、启用依据、授权编号、只读范围和文件清单，Renderer 与 Run Store 不保存文件正文。截图入口中的 `question_answer` 问答模式保持独立直连，不经过根 Codex 或工作流 Grant；桌面问答运行时按需直接读取当前分组目录和本次上传文件，再把相关内容送给所选模型。两条路径共用只读 Context Broker，但授权语义不得混用。

2026-07-27 修正问答模式的上下文提交策略：生产集中中转当前使用跨厂商无状态 Chat Completions，工具补充轮次必须重放历史 `messages`，在已经提交大体量文件上下文后继续开放工具会造成同一正文被反复传输和计费。当前问答路径因此固定为 `single_complete_context`：桌面 Host 先按语义和任务相关性构建充分的材料包，再只向所选模型提交一次完整上下文并取得最终回答；不在无状态 Transport 上运行多轮文件工具循环。只有某个 Executor Adapter 明确声明并验证支持真实 stateful continuation，且上游计费确认旧上下文不会按全量重复计算时，才能启用增量补充。仅在桌面或中转缓存历史、但向上游仍重放全文，不视为增量能力。

2026-07-27 将问答模式从单一“是否读取文件”判断升级为 `ContextSourcePlan`。桌面向 Haolo 提供带稳定轮次 ID 和附件 ID 的结构化对话元数据，Haolo 分别决定是否复用相关历史轮次、本轮媒体、历史媒体、上传文档或当前分组文件。历史视频的时间片段追问会重新提交原视频 `ArtifactRef` 和相关对话，不再扫描分组目录；纯历史回答追问只携带相关或最近对话。用户通过 `@` 显式选择的其他会话仍由独立 reference-context 通道交付，来源规划器只接收引用元数据，不能把会话引用转换为分组扫描。规划失败或返回失效轮次时退化到最近对话和本轮原生附件，禁止以不确定性为由默认读取当前分组。最终仍遵守无状态 Transport 的 `single_complete_context`，来源选择完成后一次提交，不制造会重复计费的伪增量轮次。

2026-07-27 打通 Doubao 视频输入的生产传输链路：桌面问答与集群模型节点继续复用同一个 `sendProviderChat` 适配器。已有 OSS 上传记录时，适配器把 `*.oss-<region>.aliyuncs.com` 转换为同桶 `oss-accelerate.aliyuncs.com` 后作为显式 `video_url` 发送；仅有本地字节时，才经鉴权 `POST /v1/media/input` 写入 Sub2API 数据目录，并以 128-bit 不透明令牌、两小时 TTL、50MB 上限和 Range GET 暴露短期读取地址。真实 3.6MB 视频以“区域 URL + 本地路径”的桌面实际输入完成 Doubao 全链路验证，模型在 46.6 秒内准确返回五名孩童在稻田水沟用抄网捕鱼的内容描述；原区域 URL 的约 5 秒连接超时未再出现。

2026-07-27 修复 Doubao 历史对话追问兼容：当前不鸣 AI 的 Doubao `/chat/completions` 兼容路由在输入中含历史 `assistant` 消息时，会把它转换为缺少 `input.status` 的 Responses 项并拒绝请求。该差异只在统一 `sendProviderChat` Provider Adapter 边界处理：仅对 Doubao，把 Haolo 已显式选中的历史对话按角色序列化为不受信任的系统上下文，当前用户问题仍保持独立 `user` 消息，历史图片或视频仍以当前节点显式 `ArtifactRef` 重新挂载；不修改 `ContextSourcePlan`、画布、Grant 或根 Codex 决策。相同真实视频的 `user → assistant → user` 时间轴追问已通过生产链路验证，26 秒内正常返回三个带起止秒数的片段。问答模式与集群外部模型节点共享这一适配规则。

2026-07-21 完成豆包与千问集中中转接入：复用管理员采购的不鸣 AI Key，但在 Sub2API 中建立独立账号 `Doubao-Buming`（账号 ID `54`）与 `Qwen-Buming`（账号 ID `55`），并分别绑定专属分组 `Haolo-Doubao`（分组 ID `10`）和 `Haolo-Qwen`（分组 ID `11`）。豆包开放 `doubao-seed-2-1-pro-260628` 与 `doubao-seed-2-1-turbo-260628`，千问开放 `qwen3.7-max` 与 `qwen3.7-plus`；四个模型均完成不鸣上游实测，两个默认模型均使用 `joiec@qq.com` 的真实用户 Key 完成 AgentMS → Sub2API → 不鸣全链路 HTTP 200 验证。AgentMS 提交 `dd03862`，生产发布切换至 `/opt/youle-mas/releases/20260721-194753-doubao-qwen-dd03862`，通过 `SUB2API_DOUBAO_GROUP_ID=10` 与 `SUB2API_QWEN_GROUP_ID=11` 向所有登录用户自动开通独立 Key。桌面源码已增加豆包、千问联系人、独立 Provider 路由和模型选择，并在启动时通过 `/api/sub2api/me/keys` 自动刷新后台集中配置，使已登录老用户无需退出重登即可获得新增模型权限；当前账号缓存已确认包含 `doubao` 和 `qwen`。83 项相关测试、类型检查与生产构建通过，但尚未单独发布 Windows 安装包。

## 当前实现状态（2026-07-20）

- [x] 八家数据驱动 Provider Registry。
- [x] Electron `safeStorage` 加密凭据库；安全存储不可用时拒绝明文降级。
- [x] Renderer 只能看到“是否已配置”等公开状态，不能读取完整 Key 或密文。
- [x] 模型配置 IPC 仅接受主窗口主 Frame；主窗口阻止离开受信任应用来源的导航。
- [x] 官方 API 站点白名单；Kimi 区分中国站/国际站，MiMo 区分按量付费及中国/新加坡/欧洲 Token Plan。
- [x] 八家连接测试；除 Perplexity 外优先使用模型列表接口，Perplexity 使用极小 Sonar 请求。
- [x] 设置 → 模型服务的保存、测试、删除入口。
- [x] 新凭据库不会进入 Haolo 用户数据导出；导入旧备份也不会覆盖或删除本机 Vault。
- [x] 八家非流式只读 Adapter；统一文本、用量、引用、取消和脱敏，遇到工具调用响应时失败关闭。
- [x] 独立 `ext-run_*` 的只读 External Agent Runtime；具备预算、FIFO 队列、Owner 隔离、取消和终态事件。
- [x] 独立 `externalAgents:*` 主进程/Preload 桥；Feature Flag 默认关闭且必须配置供应商白名单。
- [x] 集群工作流模型节点的 `local.files.review` 能力、节点级 Grant 校验、独立 ContextPackage 和画布审计信息。
- [x] `question_answer` 问答模式读取当前分组目录与本次上传文件的桌面 Host read-through；不依赖根 Codex。
- [ ] 主编排的自动路由、预算、并发和降级策略。
- [ ] MCP 薄桥与只读 Tool Broker。
- [ ] 独立 Worktree 中的补丁能力和人工审批。

当前只读 Runtime 是默认关闭的客户端 BYOK 工程预览通道，没有设置页调用入口，也尚未接入 Codex 主编排。它不替换联系人聊天、Codex 对话或 Codex 原生子 Agent，也不是最新产品决策下的生产 Transport。

工程调试时必须同时满足两个环境变量，缺一则请求在解密 Key 和联网前失败：

```powershell
$env:HAOLO_EXTERNAL_AGENT_RUNTIME = "1"
$env:HAOLO_EXTERNAL_AGENT_PROVIDER_ALLOWLIST = "openai"
pnpm start
```

白名单接受规范 ID 或别名，多个供应商用英文逗号分隔。该方式仅用于客户端 BYOK 开发预览，不能作为生产配置教程。首轮只应灰度一家；协议契约测试和真实 Key 手动验证通过后再增加。不要把这些变量写入 Git。

## 规范 Provider ID

| 展示名 | 规范 ID | 首选协议 | 备注 |
|---|---|---|---|
| ChatGPT / OpenAI | `openai` | Responses | `gpt`、`chatgpt`、`codex` 为别名 |
| Claude | `anthropic` | 原生 Messages | 不把 OpenAI 兼容层作为长期主路径 |
| Kimi | `moonshot` | Chat Completions | 中国站和国际站 Key/Base URL 必须配对 |
| DeepSeek | `deepseek` | Chat Completions | 模型名可配置，不依赖旧别名 |
| Gemini | `google` | 先兼容层，后续原生 | 长期优先原生 Gemini API/Interactions |
| Perplexity | `perplexity` | Agent/Responses 或 Sonar | 调研角色优先，验证 Key 需极小计费请求 |
| Grok | `xai` | Responses | 需检查 Key ACL 和模型权限 |
| MiMo | `xiaomi` | Responses | 按量 Key 与 Token Plan Key 的站点不能混用 |

## 分阶段执行

### 阶段 1A：客户端 BYOK 原型（已完成、非生产路径）

组件：

```text
Provider Registry
  → Credential Store (main process + safeStorage)
  → Connection Test Service
  → narrow IPC
  → Settings UI
```

验收条件：磁盘无 Key 明文；IPC/list 不返回 Key；安全存储不可用时失败关闭；401、403、404、429、超时可诊断；不改变现有业务路由。

### 阶段 1B：集中中转接入（当前产品方向）

1. 在 `D:\zhongzhuan` 盘点八家厂商的原生账号类型和 OpenAI-Compatible 账号能力。
2. 在中转后台逐家新建或轮换上游凭据，先停调度、单账号测试，再灰度加入分组。
3. 为八家模型建立稳定的公开模型别名、上游模型映射、价格、额度、并发与健康检查。
4. 由 `D:\youle_agent_ms` 沿用或扩展现有登录会话下发中转 Base URL 与用户访问凭据；不下发厂商 Key。
5. 将桌面 External Agent Runtime 的 Transport 从本机 BYOK Adapter 切换为中转 Adapter，并保留 Feature Flag 和旧链路回退。
6. 上线前完成协议、计费、权限隔离、错误脱敏、取消、超时和并发回归。

### 阶段 2：只读 Provider Adapter

统一接口预定为：

```ts
invoke({ provider, model, role, messages, signal, budget })
  -> { text, usage, finishReason, providerState }
```

按厂商协议拆分 Adapter，统一超时、取消、错误、用量和引用；不把供应商原始响应或隐藏推理返回 Renderer。当前版本每个 Run 只请求一次，不自动重试，也不自动切换供应商，避免重复计费和扩大数据外发范围。

### 阶段 3：只读 External Agent Runtime

引入独立 `runId`、状态机、取消、预算、并发和事件：

```text
run.started → model.delta → run.completed | run.failed | run.cancelled
```

不要伪造 Codex `threadId`，也不要复用 `internalSubagentThreadIds`。外部 Agent 活动与 Codex 原生子线程分开建模。

Renderer 侧请求只允许 `provider`、`role`、`task`、显式纯文本 `context`、经主进程归一化的媒体 `ArtifactRef`/附件引用、收紧型 `budget` 和关联用 `orchestrationId`。主进程固定系统提示、模型、官方站点、认证头、数据分级和能力校验；拒绝任意 `messages`、Key、Base URL、Header、模型覆盖、工具或原始请求体。附件不得携带任意请求片段，文件正文仍由 Host 读取后进入 `ContextPackage`。

主编排路由优先级：

1. 用户明确指定模型或明确禁止外部调用时，遵从用户选择。
2. 用户未指定时，由主编排根据角色、数据敏感度、可用性、成本和延迟自动选择。
3. 高风险、敏感或上下文无法最小化的任务不外发。
4. 同一任务默认最多并行 1 个外部模型；需要交叉验证时最多 2 个，并设总预算。
5. 外部调用失败只降级为主模型处理，不得让 Codex app-server 失败。

推荐初始路由（上线前仍需基准测试）：

- 需要带来源的实时网络调研：Perplexity。
- 长文审查、严谨写作和代码审查：Claude。
- 超长中文材料和中文资料整理：Kimi。
- 数学、逻辑和性价比代码复核：DeepSeek。
- 多模态材料：按统一能力注册表选择；当前图片覆盖多个已实测模型，视频优先 Gemini 或 Doubao。
- 实时社交舆情：Grok，但必须核验来源。
- 中文低延迟通用复核：MiMo。
- 通用复杂推理、结构化输出和最终交叉审查：OpenAI/GPT。

这只是默认路由策略，用户应始终能查看、覆盖或关闭自动路由。

### 阶段 4：MCP 薄桥

新增独立 External Agent Bridge，只暴露只读角色，例如：

```text
external_agent_research
external_agent_review
external_agent_advise
external_agent_wait
external_agent_cancel
```

桥只持有临时本地 endpoint 和会话 token，不持有长期供应商 Key。不要扩展现有自动批准的 DeepSeek `chat_completion` 工具。

### 阶段 5：只读 Tool Broker

初始工具白名单：

```text
workspace.list / workspace.read / workspace.search
git.status / git.diff / git.log
web.search / web.fetch
```

每个工具必须声明 schema、风险级别、幂等性、超时、输出上限和审计字段。访问路径必须限定工作区，不能复用允许任意绝对路径的本地预览接口。

### 阶段 6：受控动手能力

依次开放：生成补丁但不落盘 → 独立 Worktree 落盘 → 自动测试 → 人工审批合并。Shell、网络写操作、发布、删除和生产系统继续使用更高等级审批。每个外部 Agent 使用短期、最小权限 capability token，不直接拿主进程权限。

## 安全不变量

- Key 不进入 Git、日志、聊天、截图、错误遥测、`localStorage`、`auth.json`、`config.toml` 或 MCP env。
- 生产厂商 Key 只在中转后端解密，桌面主进程和 Renderer 均不提供读取接口；客户端 BYOK 原型的本机密钥不得进入生产主路径。
- 中转后台只允许管理员配置并验证受信任的上游 API 站点，避免任意 Base URL 将 Key 发往恶意主机。
- Provider 原始错误必须脱敏，所有超时和取消在主进程收口。
- 第一阶段只接收显式纯文本；疑似 Key、授权头、私钥、本机绝对路径、UNC 路径和敏感分级内容在联网前失败关闭。
- 新凭据库不进入未加密的用户数据导出。
- 外部输出是不可信数据；模型内容不能变成 HTML/脚本，也不能隐式升级权限。
- 所有新链路必须有关闭开关和旧链路回退。

## 本地仓库职责映射（长期约定）

- `D:\zhongzhuan`：模型 API 中转服务代码仓库。桌面端不直接调用该目录，而是访问其部署后的中转 URL。
- `D:\youle_agent_ms`：Haolo/Youle Agent 业务后端代码仓库。
- `D:\youle_desktop\youle_desktop`：Haolo 桌面客户端代码仓库。

讨论或修改模型请求链路时，必须先区分中转层、业务后端和桌面客户端，不得把三个仓库视为同一个服务。最新生产目标是把外部 Agent 接入 `D:\zhongzhuan` 与 `D:\youle_agent_ms`；在专项改造完成前，不得声称当前 BYOK 原型已走集中中转。

## 已知旧链路债务（不在当前切片内）

现有 Haolo 登录/中转链路仍有模型凭据写入 `haolo-session.json`、`default-haolo-ai/auth.json`，以及 DeepSeek MCP Key 写入 managed TOML 的历史行为。为避免影响现有登录和 Codex 业务，本阶段不迁移它们；新增八家 BYOK 与旧链路完全隔离。后续应单独立项迁移并设计兼容回滚。

## 继续开发前的检查清单

1. 先读本文和 `docs/external-model-api-key-setup.zh-CN.md`。
2. 检查工作区未提交修改，避免覆盖用户代码。
3. 运行 `test/external-model-provider.test.mjs`、typecheck 和相关回归。
4. 不在没有用户真实 Key 的情况下声称真实厂商连接已验证；本地只能验证契约和假请求。
5. 每次扩大能力前先新增策略测试，再开放 Feature Flag。
