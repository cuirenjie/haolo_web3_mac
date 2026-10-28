# Haolo 项目持久上下文

## Haolo Mac 客户端工作目录与发布

- 在当前 `haolo_web3_mac` 仓库及其 `youle_desktop` 子目录执行客户端修改、启动、测试和打包；遵守[仓库级协作规范](../AGENTS.md)。Windows 上游的固定目录、EV 签名工具和旧发布版本不适用于 Mac。
- Mac 交付保留 Universal（arm64 + x64）运行时、原生资源、entitlements、包审计和签名校验。生产发布需要有效 Developer ID 及适用的公证；本地测试包可按既有显式开关采用 ad-hoc 签名，必须明确标注，不得宣称已经公证。
- 版本遵循当前版本配置及用户要求；本地打包不等于上传生产更新系统。

涉及外部大模型、子 Agent、多模型路由、API Key 或 Tool Broker 的工作，开始前必须完整阅读：

- `docs/external-model-agents-roadmap.md`
- `docs/external-model-api-key-setup.zh-CN.md`
- `../docs/haolo-workflow-agent-architecture.md`

固定边界：Codex 继续作为默认且唯一的根编排；现阶段外部模型只做调研、总结、代码审查和建议；未来动手能力必须经独立 Tool Broker、节点级 CapabilityGrant、Agent Host、沙箱或独立 Worktree、预授权与审计逐级开放。Grant 的范围以当前节点的质量目标为导向，但不得超出用户已授权的能力边界。OpenAI API 兼容不等于天然拥有工具或系统权限。不得为省事把真实 Key 写入源码、日志、聊天、Renderer 存储、`auth.json`、`config.toml` 或 MCP env。

## 交易专家实时 AI 盘面分析持久记忆

涉及交易专家的实时 AI 盘面分析、缠论、波浪、威科夫、订单流、概率预测、AI 自动绘图、Drawing Gateway、TradingMarketDataHub 或相关发布工作，开始前必须完整阅读：

- `docs/trading-expert-realtime-ai-execution-plan.zh-CN.md`

本文档是该项目的冻结实施基线和持续进度台账。后续每次相关工作必须使用其中的稳定任务编号；开始时更新“当前工作焦点”和任务状态，结束时登记完成证据、测试结果、阻塞项并在“进度日志”追加记录。没有代码、必要测试和验收证据时不得把任务标记为已完成。架构需要变化时先追加 ADR，不得无记录偏离“确定性量化引擎 + GPT 综合判断 + Drawing Gateway 受控绘图”的固定边界。



## 六语言要求（2026-10-27）

用户新增专业越南语 `vi`／`vi-VN`，与简中、英文、繁中、韩语、日语同时维护。新增界面、主进程提示、模型正文、工具／错误说明、更新说明及客服知识均覆盖六语言。接口键、数值及用户原文保持。见 `docs/vietnamese-localization-20261027.md`。
