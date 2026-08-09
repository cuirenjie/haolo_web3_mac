# Haolo 八家外部模型 API Key 配置教程（客户端 BYOK 开发预览）

> **状态说明（2026-07-20）：** 最新生产目标已改为“管理员在 `D:\zhongzhuan` 集中配置一次，所有 Haolo 用户通过中转使用”。本文记录的客户端 BYOK 步骤仅用于默认关闭的开发预览，不再是生产配置流程。生产环境不要让普通用户在 Haolo 客户端填写厂商 Key，也不要据此删除 Sub2API 的用户“API 密钥”。集中中转配置将在完成八家能力盘点后另行编写。

本文对应 Haolo 的第一阶段接入：安全保存 Key、选择官方 API 站点和模型、测试连接。当前不会给外部模型终端、文件系统或写入权限，也不会替换 Codex 主编排。

## 配置前先知道的三件事

1. 不要把真实 Key 发到聊天、邮件、工单、截图或 Git。完整 Key 通常只展示一次，请创建后直接粘贴到 Haolo 本机设置页。
2. API 账户、ChatGPT/Claude/Gemini 等网页会员通常不是同一套计费。多数厂商要求单独开通 API 账单或余额。
3. Haolo 使用 Electron 系统安全存储加密新 Key。若系统安全存储不可用，应用会拒绝保存，不会悄悄改成明文。

## Haolo 内的统一操作

1. 打开 Haolo，点击左下角“设置”。
2. 进入“模型服务”。页面应显示 ChatGPT/OpenAI、Claude、Kimi、DeepSeek、Gemini、Perplexity、Grok 和 MiMo 共八项。
3. 对 Kimi 或 MiMo，先选择与 Key 对应的“API 站点”。其他厂商使用固定的官方站点。
4. 检查“模型名称”。默认值只是首轮推荐，厂商下线模型后可直接在这里改，不需要升级 Haolo。
5. 将 Key 粘贴到密码框，点击“保存”。保存成功后输入框会清空，页面只显示“已加密保存”，不会回显 Key。
6. 点击“测试连接”。OpenAI、Claude、Kimi、DeepSeek、Gemini、Grok、MiMo 使用模型列表接口，并尽量核对所填模型名；Perplexity 因模型列表接口不能验证 Key，会发送一次极小的 Sonar 请求，可能产生少量费用。
7. 要轮换 Key，粘贴新 Key 再点“保存”；只改模型时可把 Key 留空。要彻底移除，点击“删除 Key”。

新的外部模型 Key 不进入 Haolo 的用户数据导出；导入旧备份时也不会覆盖或删除当前 Windows 用户下的本机加密 Key。

## 1. ChatGPT / OpenAI

官方入口：

- [创建 API Key](https://platform.openai.com/api-keys)
- [API 快速开始](https://platform.openai.com/docs/quickstart)
- [Key 安全最佳实践](https://help.openai.com/en/articles/5112595-best-practices-for-api-key)
- [支持的国家和地区](https://help.openai.com/zh-hans-cn/articles/5347006-openai-api-%E6%94%AF%E6%8C%81%E7%9A%84%E5%9B%BD%E5%AE%B6%E5%92%8C%E5%9C%B0%E5%8C%BA)

步骤：

1. 登录 OpenAI Platform，选择或新建 Project。
2. 在 API Keys 中选择“Create new secret key”。生产环境建议按项目创建并使用 Restricted 权限。
3. 确认 API 账单/额度可用。ChatGPT Plus、Pro 或 Team 订阅不等于 API 余额。
4. 在 Haolo 的 ChatGPT/OpenAI 卡片粘贴 Key，保存并测试。

默认官方 Base URL 是 `https://api.openai.com/v1`。如果所在地区不在官方支持列表中，不要尝试绕过地区限制；官方说明从未支持地区访问可能导致账号受限。

## 2. Kimi / Moonshot AI

Kimi 有两套站点，Console、Key 和 Base URL 必须成套使用：

| 站点 | Key 控制台 | Base URL |
|---|---|---|
| 中国站 | [platform.kimi.com](https://platform.kimi.com/console/api-keys) | `https://api.moonshot.cn/v1` |
| 国际站 | [platform.kimi.ai](https://platform.kimi.ai/console/api-keys) | `https://api.moonshot.ai/v1` |

文档：[中国站 API 概览](https://platform.kimi.com/docs/api/overview)、[国际站 API 概览](https://platform.kimi.ai/docs/api/overview)。

步骤：

1. 先确定使用中国站还是国际站，并在对应控制台创建 Key。
2. 确认账户余额和模型权限。
3. 在 Haolo 先选择相同站点，再粘贴 Key。中国站 Key 配国际站 URL（或反过来）会鉴权失败。
4. 首轮可使用官方示例模型 `kimi-k2.6`；如控制台显示其他可用模型，以控制台为准。

## 3. DeepSeek

官方入口：[API Keys](https://platform.deepseek.com/api_keys)、[API 文档](https://api-docs.deepseek.com/)、[模型与价格](https://api-docs.deepseek.com/quick_start/pricing)。

步骤：

1. 登录 DeepSeek 开放平台，在 API Keys 创建新 Key。
2. 充值或确认余额、速率限制。
3. 在 Haolo 粘贴 Key，默认站点保持 `https://api.deepseek.com`。
4. 首轮推荐低成本模型 `deepseek-v4-flash`；高质量档可按官方模型列表改成 `deepseek-v4-pro`。

不要给 Base URL 额外强制补 `/v1`；Haolo 已按官方路径组合请求。

## 4. Gemini / Google AI

官方入口：[Google AI Studio API Keys](https://aistudio.google.com/api-keys)、[Key 指南](https://ai.google.dev/gemini-api/docs/api-key)、[OpenAI 兼容层](https://ai.google.dev/gemini-api/docs/openai)、[支持地区](https://ai.google.dev/gemini-api/docs/available-regions?hl=zh-cn)。

步骤：

1. 打开 Google AI Studio，接受条款，导入或创建 Google Cloud Project。
2. 创建 API Key，并将它限制到 Generative Language API；避免长期使用不受限 Key。
3. 确认项目、账单和地区符合官方要求。
4. 在 Haolo 粘贴并测试。第一阶段通过 Google 的 OpenAI 兼容入口验证，未来长期 Agent Runtime 将优先原生 Gemini 协议。

当前默认使用 `gemini-3.5-flash`。模型名变化较快；默认值不可用时，在 AI Studio/模型列表确认当前 ID 后修改“模型名称”。中国大陆当前不在官方可用地区列表中。

## 5. Perplexity

官方入口：[Perplexity Console](https://console.perplexity.ai/)、[API Groups 与计费](https://docs.perplexity.ai/docs/getting-started/api-groups)、[Key 管理](https://docs.perplexity.ai/docs/admin/api-key-management)、[Quickstart](https://docs.perplexity.ai/docs/getting-started/quickstart)。

步骤：

1. 登录 Console，先创建 API Group。
2. 配置付款方式或 Credits。
3. 在该 Group 下生成 API Key；完整值通常只展示一次。
4. 在 Haolo 粘贴并保存，初始模型可用 `sonar`。
5. 点击测试时会调用一次极小的 `/v1/sonar` 请求。`GET /v1/models` 不需要鉴权，无法证明你的 Key 有效，所以不能用于真正的 Key 测试。

为避免连续点击造成重复计费，同一 Perplexity 连接测试会合并并发请求，并在完成后短暂复用结果；修改或删除配置会清除该结果。

Perplexity 首期最适合需要网络检索和来源的调研角色；生成的来源仍需主编排核验。

## 6. Grok / xAI

官方入口：[xAI API Keys](https://console.x.ai/team/default/api-keys)、[Quickstart](https://docs.x.ai/developers/quickstart)、[Key 与权限](https://docs.x.ai/developers/rest-api-reference/management/auth)。

步骤：

1. 登录 xAI Console，选择 Team 并添加 Credits。
2. 创建 API Key，为它授予所需 inference endpoint 和模型权限。
3. 特别检查 ACL：空 ACL 的 Key 可能没有任何调用权限。
4. 在 Haolo 粘贴并测试。官方 Quickstart 当前示例模型为 `grok-4.5`。

Key 与 Team 绑定；如果 403，除 Key 本身外还要检查 Team、ACL、模型权限和余额。

## 7. Xiaomi MiMo

官方入口：[MiMo 开放平台](https://platform.xiaomimimo.com/)、[首次 API 调用](https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call)、[模型列表](https://mimo.mi.com/docs/zh-CN/api/model/list-models)。

两类 Key 必须选择不同站点：

| Key 类型 | 常见前缀 | Haolo 站点 | Base URL |
|---|---|---|---|
| 按量付费 | `sk-...` | 按量付费 | `https://api.xiaomimimo.com/v1` |
| 中国区 Token Plan | `tp-...` | 中国区 Token Plan | `https://token-plan-cn.xiaomimimo.com/v1` |
| 新加坡区 Token Plan | `tp-...` | 新加坡区 Token Plan | `https://token-plan-sgp.xiaomimimo.com/v1` |
| 欧洲区 Token Plan | `tp-...` | 欧洲区 Token Plan | `https://token-plan-ams.xiaomimimo.com/v1` |

Token Plan Key 必须选择购买套餐时对应的区域；中国、新加坡和欧洲节点不能混用。

步骤：

1. 使用小米个人账号登录开放平台，在 API Keys 创建 Key。
2. 根据 Key 类型在 Haolo 选择对应站点，不能混用。
3. 粘贴并保存，初始可用 `mimo-v2.5`；高质量档可按权限使用 `mimo-v2.5-pro`。
4. 测试失败时先检查 Key 前缀与站点是否配对。

## 8. Claude / Anthropic

官方入口：[Claude API Keys](https://platform.claude.com/settings/keys)、[认证](https://platform.claude.com/docs/en/manage-claude/authentication)、[首次调用](https://platform.claude.com/docs/en/get-started)、[模型列表](https://platform.claude.com/docs/en/api/models/list)。

步骤：

1. 登录 Claude Console，进入 Settings → API keys。
2. 创建 Key，选择 Workspace 和过期时间。
3. 普通模型调用应使用普通 API Key，不要误用 Admin、Compliance 或 Analytics Key。
4. 确认 Workspace 账单和模型权限后，在 Haolo 保存并测试。

当前默认模型为 `claude-sonnet-5`。Haolo 的连接测试使用 Anthropic 原生认证头 `x-api-key` 和 `anthropic-version: 2023-06-01`。Anthropic 官方把 OpenAI SDK 兼容层定位为迁移测试/模型比较用途，因此后续正式 Agent Runtime 优先原生 Messages API。

## 常见错误排查

| 现象 | 常见原因 | 处理方法 |
|---|---|---|
| 系统安全存储不可用 | Windows 凭据/DPAPI 当前不可用、运行环境异常 | 解锁当前 Windows 用户会话并重启 Haolo；不要改用文本文件保存 |
| 401 | Key 错、已撤销、复制不完整、站点不匹配 | 重新创建并粘贴；重点检查 Kimi 中国/国际站 |
| 403 | 地区、Team/Project、ACL 或模型权限不允许 | 查厂商支持地区和权限；xAI 检查 ACL，Claude 检查 Workspace |
| 404 | API 站点或模型名已变化 | 从官方模型列表复制当前模型 ID；检查 MiMo/Kimi 站点 |
| 429 | 余额不足、未开账单或速率限制 | 充值/开账单，稍后重试，检查 API Group/Project 限额 |
| 超时 | 网络、代理、DNS、地区不可用 | 用官方文档确认服务地区和状态；不要把 Key 发给第三方“代测” |
| 保存成功但模型调用失败 | Key 有效但模型没权限或模型已退役 | 修改模型名称，或在控制台为 Key增加模型权限 |

## 轮换与泄露处理

如果怀疑 Key 泄露：立即到厂商控制台撤销旧 Key，不要只在 Haolo 删除；创建最小权限的新 Key，在 Haolo 覆盖保存并测试。删除 Haolo 本机 Key 只会删除本机加密副本，不会撤销厂商服务器上的 Key。

## 能力说明

通过连接测试只证明“Haolo 能用该 Key 访问对应官方 API”。它不会让模型自动获得文件、终端、浏览器或发布能力。后续动手能力会通过独立 Tool Broker、Capability Token、沙箱、Worktree 和审批逐级开放，详见 `docs/external-model-agents-roadmap.md`。
