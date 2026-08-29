# Haolo 智能交易预警灰度与发布运行手册

> 日期：2026-08-12  
> 原则：默认关闭、先 shadow、再小范围灰度；未经真实长稳、实机验收和发布授权不得全量开放。

## 1. 开关矩阵

| 阶段 | `HAOLO_TRADING_ALERTS_ENABLED` | `HAOLO_TRADING_ALERTS_SHADOW` | 行为 |
|---|---|---|---|
| 默认/回退 | 未设置或 `false` | 任意 | 不启动 Engine，不改变旧客户端行为；已有 Store 保留 |
| 内部 shadow | `true` | `true` | 真实订阅、求值和落证据，但不弹通知 |
| 小范围灰度 | `true` | `false` | 完整创建、监控、卡片、会话、通知和深链 |
| 全量 | `true` 或后续受控远端开关 | `false` | 仅在所有发布门禁及审批通过后使用 |

环境变量变更后重启 Haolo 才生效。首版开关是本机构建/运行配置，不宣称已有远端百分比分流。

## 2. 发布前顺序

1. 锁定候选提交和测试环境，保存 `git status`、Node/pnpm 版本及构建日志。
2. 运行专项测试、全量 `node --test`、TypeScript 检查和 `vite build`。
3. 运行 100 卡片/洪峰基准，并在候选 Windows 构建进行真实 24 小时 soak。
4. 以 shadow 模式回放已冻结 Fixture，对比 evidence 的 value、condition trace 和 inputHash。
5. 完成亮暗主题、缩放、键盘、异常态、空档、通知点击与 K 线定位实机验收。
6. 选择明确的小范围测试用户，保持默认关闭；记录开始/结束时间、版本、规则数量、Provider、错误和回退演练。
7. 灰度报告通过且用户/发布负责人明确授权后，才提升版本、生成安装包、上传更新系统并开放开关。

## 3. 真实 24 小时 soak 记录模板

```md
- 候选版本/提交：
- Windows/硬件：
- 开始/结束时间（墙钟 >= 24h）：
- 规则数、市场数、周期数、Provider：
- 初始/最终/峰值 CPU、工作集、JS heap：
- 初始/最终/峰值物理订阅：
- 断线/休眠/恢复次数：
- evidence 数、重复 evidence 数：
- MonitoringGap 是否准确且无补触发：
- 结论与附件：
```

## 4. 灰度观察与诊断

必须观察：Engine running/suspended/shadowMode、逻辑规则数、物理订阅数、Provider 健康、最后行情时间、最后求值时间、MonitoringGap、evidenceId、通知结果和错误分类。不得把 API Key、私钥、完整账户响应或无界高频行情写入普通日志。

遇到用户条件无法覆盖时：保留原 draft，生成结构化 DataRequirement；引导用户在安全设置接入合适 Provider/API/Plugin/MCP/文件并验证 Schema、时间、频率、延迟、权限和样本。接入成功后从同一 draftId 继续，不直接拒绝、不编造数据。

## 5. 回退

1. 设置 `HAOLO_TRADING_ALERTS_ENABLED=false` 并重启客户端；这会停止订阅和 Engine。
2. 保留 `trading-alerts` Store、evidence 和 MonitoringGap，禁止为回退删除审计证据。
3. 若候选构建本身异常，使用既有客户端更新系统回退到上一批准版本；不得在本功能回退中修改用户其他数据。
4. 记录回退时间、原因、影响用户、最后健康事件、最后 evidenceId 和恢复版本。
5. 修复后先回到 shadow，不从灰度状态直接恢复全量。

## 6. 发布审批单

```md
- 专项/全量测试：通过 / 未通过
- TypeScript/生产构建：通过 / 未通过
- 真实 24h soak：通过 / 未通过（附件）
- Windows 亮暗主题/缩放/可访问性：通过 / 未通过（附件）
- shadow 对照：通过 / 未通过
- 小范围灰度：通过 / 未通过（报告）
- 回退演练：通过 / 未通过
- 更新说明：
- 发布版本/安装包校验：
- 审批人及时间：
```

任一“未通过”或空缺都不允许标记 TA-M9-008 完成。

