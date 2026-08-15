# Haolo Trading Strategy Skill 接入规范（v1）

本目录保存随客户端发布的官方策略包。策略菜单、统一调度、绘图和执行方案以 `strategy.json` 为机器入口；`SKILL.md` 只承载模型需要理解的策略知识与工作流，不能代替运行时契约。

## 1. 两种实现类型

| 类型 | 用途 | 是否允许任意代码 | 接入要求 |
|---|---|---:|---|
| `builtin-adapter` | 官方复杂策略，复用受信任的确定性引擎、数据 hook 和 Provider | 否；Adapter 必须编译进宿主白名单 | 策略包 + Adapter + 专项测试 |
| `declarative-v1` | 用户自然语言生成或策略广场规则 | 否；只解释受限 JSON DSL | 策略包（Manifest、Rules、Skill）+ 历史回放结果 |

官方 Adapter 的显式白名单是安全边界，不是菜单硬编码。声明式策略不需要新增 Renderer/Main 四选一分支。

## 2. 标准目录

```text
<strategy-id>/
├─ strategy.json
├─ SKILL.md
├─ agents/
│  └─ openai.yaml
├─ references/
│  └─ rules.md
└─ rules.json              # declarative-v1 必需
```

文件名、资源引用和 `strategy-id` 必须使用安全的包内相对路径；禁止 `..`、绝对路径、盘符、反斜杠和动态入口。

## 3. Manifest 最小示例

```json
{
  "schemaVersion": 1,
  "id": "moving-average-demo",
  "version": "1.0.0",
  "minimumHostVersion": "0.1.164",
  "publisher": { "id": "community-user", "type": "community" },
  "display": { "name": "均线趋势", "group": "strategy", "sortOrder": 900 },
  "mentions": { "canonical": "均线趋势", "aliases": [] },
  "implementation": { "kind": "declarative-v1", "rulesAsset": "rules.json" },
  "capabilities": ["conversation", "chart-analysis", "drawing", "execution-plan"],
  "dataRequirements": {
    "candles": { "required": true, "minCount": 30, "minimumCoverage": "available" }
  },
  "drawingPolicyId": "generic-declarative-v1",
  "executionPlanPolicyId": "standard-v1",
  "assets": { "skill": "SKILL.md", "rules": "rules.json" }
}
```

Schema 采用失败关闭：未知字段、未知 capability、重复 mention、重复 ID、超长数组或不安全路径都会使该包隔离，其余策略继续运行。

## 4. declarative-v1 规则范围

- 数据：当前及历史已收盘 OHLCV；`offset` 只能为 `-100..0`，不能读取未来 K 线。
- 指标：`sma`、`ema`。
- 比较：`gt`、`gte`、`lt`、`lte`、`crosses-above`、`crosses-below`。
- 信号：`long`、`short`，每个信号由有界 `all` 条件组成。
- 价位：基于已收盘区间高低点计算突破、失效和风险倍数目标。
- 绘图：只能使用 `primary/support/resistance/entry/stop/target/note` 语义角色，由宿主映射浅色与暗色 Token。
- 图层：固定为 `ai/strategy/<strategy-id>`；不能写入用户手工图层或其他策略图层。
- 权限：不能访问 DOM、Electron、文件系统、任意网络、密钥、账户或下单 IPC。

## 5. 自然语言生成门禁

```text
用户描述 → Strategy Draft → 歧义澄清 → 声明式 Rules
         → 静态校验 → 历史回放 → 用户确认 → 私有保存/申请发布
```

生成器必须为每个关键字段记录 `user-explicit`、`system-suggested` 或 `user-confirmed` 来源。存在开放歧义、未确认的系统默认值、未通过的历史回放时，`compileConfirmedStrategyDraft` 必须拒绝生成可运行包。

## 6. 必须产出的结果

所有策略最终通过同一 `StrategyResultV1`、`DrawingPatch` 和 `ExecutionPlanV1`：

- 当前条件与数据覆盖；
- 多空方向或明确等待；
- 入场区间/触发及收盘确认；
- 止损、失效理由和确定性证据；
- 目标位、风险收益与最大账户风险规则；
- 继续观察、有效期和取消条件。

缺少完整价位时必须输出 `insufficient_data`/`no_trade`；缺少经授权的新鲜账户和合约数据时，具体下单数量必须为 `null`。策略运行时不提供自动下单能力。

## 7. 接入验收

1. 运行 Manifest/Rules/Skill 校验。
2. 用固定历史样本完成正常、数据不足、无信号、未来数据拒绝和边界回放。
3. 验证注册、mention、分析、取消、错误隔离、Drawing Gateway 和 ExecutionPlan。
4. 验证浅色/暗色及 disabled/error/expired 状态。
5. 执行 `pnpm run typecheck`、策略专项、`pnpm test`、`pnpm run build` 和 `git diff --check`。

完整阶段门禁和证据格式见 `docs/trading-strategy-skill-decoupling-plan.zh-CN.md` 与 `docs/trading-strategy-skill-decoupling-progress.zh-CN.md`。
