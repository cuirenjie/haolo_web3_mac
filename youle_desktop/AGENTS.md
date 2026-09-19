# Haolo 项目持久上下文

## Windows 客户端默认 EV 签名

- 用户于 2026-09-19 明确要求：以后 Windows 客户端打包必须主动完成 EV 签名，不再交付未签名的发布包。使用 `haolo-desktop-release` 技能及 `docs/windows-ev-signing.zh-CN.md`。
- 主程序、安装程序、卸载程序和自有 Chrome native host 使用 `scripts/sign-windows.cjs`；SHA-256、可信时间戳、Windows Authenticode、EV 证书策略及发布者指纹均须通过。保留 OpenAI 等第三方原签名。
- 许可证仅从本机仓库外的 `~/.codex/secrets/haolo-evsign-license.json` 或 CI 的 `HAOLO_EVSIGN_LICENSE_KEY` 读取。禁止提交、输出或打包许可证；禁止用关闭签名的配置绕过缺失许可证、文件未审核或签名校验失败。
- 版本遵循用户明确指定值；本次是重做 0.1.170 签名版。只请求打包不等于上传生产更新系统。

涉及外部大模型、子 Agent、多模型路由、API Key 或 Tool Broker 的工作，开始前必须完整阅读：

- `docs/external-model-agents-roadmap.md`
- `docs/external-model-api-key-setup.zh-CN.md`
- `../docs/haolo-workflow-agent-architecture.md`

固定边界：Codex 继续作为默认且唯一的根编排；现阶段外部模型只做调研、总结、代码审查和建议；未来动手能力必须经独立 Tool Broker、节点级 CapabilityGrant、Agent Host、沙箱或独立 Worktree、预授权与审计逐级开放。Grant 的范围以当前节点的质量目标为导向，但不得超出用户已授权的能力边界。OpenAI API 兼容不等于天然拥有工具或系统权限。不得为省事把真实 Key 写入源码、日志、聊天、Renderer 存储、`auth.json`、`config.toml` 或 MCP env。

## 交易专家实时 AI 盘面分析持久记忆

涉及交易专家的实时 AI 盘面分析、缠论、波浪、威科夫、订单流、概率预测、AI 自动绘图、Drawing Gateway、TradingMarketDataHub 或相关发布工作，开始前必须完整阅读：

- `docs/trading-expert-realtime-ai-execution-plan.zh-CN.md`

本文档是该项目的冻结实施基线和持续进度台账。后续每次相关工作必须使用其中的稳定任务编号；开始时更新“当前工作焦点”和任务状态，结束时登记完成证据、测试结果、阻塞项并在“进度日志”追加记录。没有代码、必要测试和验收证据时不得把任务标记为已完成。架构需要变化时先追加 ADR，不得无记录偏离“确定性量化引擎 + GPT 综合判断 + Drawing Gateway 受控绘图”的固定边界。
