import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createSavedExecutionPlan,
  executionPlanBinanceMarketDetails,
  executionPlanCardTitle,
  executionPlanDirectionTone,
  executionPlanDisplayLines,
  executionPlanHasConcreteTradingPlan,
  executionPlanHasStructuredTradingFields,
  executionPlanSignedNumberSegments,
  executionPlanCandidateFromText,
  executionPlanCandidatesFromText,
  executionPlanTextPartition,
  executionPlanTextPartitions,
  loadMessageExecutionPlanFontSize,
  loadExecutionPlans,
  MESSAGE_EXECUTION_PLAN_FONT_SIZES,
  saveMessageExecutionPlanFontSize,
  saveExecutionPlans,
  stepMessageExecutionPlanFontSize,
  transitionExecutionPlan,
} from "../src/renderer/execution-plans.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("in-message execution-plan font sizing is bounded and can persist one synchronized size per card", () => {
  const storage = new MemoryStorage();
  const firstKey = "thread-a\u0000message-a\u00000";
  const secondKey = "thread-a\u0000message-a\u00001";

  assert.equal(loadMessageExecutionPlanFontSize(firstKey, storage), 12);
  assert.equal(loadMessageExecutionPlanFontSize(secondKey, storage), 12);
  assert.equal(saveMessageExecutionPlanFontSize(firstKey, 18, storage), 18);
  assert.equal(saveMessageExecutionPlanFontSize(secondKey, 18, storage), 18);
  assert.equal(loadMessageExecutionPlanFontSize(firstKey, storage), 18);
  assert.equal(loadMessageExecutionPlanFontSize(secondKey, storage), 18);
  assert.equal(stepMessageExecutionPlanFontSize(18, 1), 20);
  assert.equal(stepMessageExecutionPlanFontSize(20, 1), 20);
  assert.equal(stepMessageExecutionPlanFontSize(11, -1), 11);
  assert.deepEqual(MESSAGE_EXECUTION_PLAN_FONT_SIZES, [11, 12, 13, 14, 16, 18, 20]);
});

test("the standard six-field trading proposal is extracted as one execution plan", () => {
  const candidate = executionPlanCandidateFromText(`
分析结论如下。

### 标准执行方案

• 当前动作：不交易（净盈亏比低于最低 1:1.5，保留候选测算）
• 方向判断：偏空
• 空头触发：74.61，候选测算：10 倍杠杆、1853.42 USDT 的空单
• 止损与失效：候选止损 75.68
• 分批止盈：候选止盈 73.005，测算仓位 1853.42 USDT
• 风险收益比：目标 1 为 1:1.19，止损约 -30.28 USDT，止盈约 +36.15 USDT

---

## BINANCE:FUTURES:SOLUSDT · 1小时缠论分析

### 风险控制
后续止损参考 75.68，完整报告中的风险收益比仍需继续观察。
  `);

  assert.ok(candidate);
  assert.equal(candidate.title, "标准执行方案");
  assert.match(candidate.content, /^• 当前动作：/);
  assert.match(candidate.content, /• 风险收益比：/);
  assert.doesNotMatch(candidate.content, /BINANCE:FUTURES/);
  assert.doesNotMatch(candidate.content, /完整报告/);
});

test("assistant execution-plan text is partitioned around both current and legacy headings", () => {
  const current = executionPlanTextPartition(`
盘面结论如下。

## SOL/USDT 币安永续 1H

当前动作：不交易
方向判断：偏空
空头触发：75.12，推荐：10 倍杠杆、2523.22 USDT 的空单
止损与失效：止损 75.68
分批止盈：止盈 74.28，推荐仓位 2523.21 USDT
风险收益比：目标1为 1:0.97，如果止损：约 -23.85 USDT，如果全部止盈：约 +23.16 USDT

---

## 数据范围
后续完整分析。
  `);

  assert.ok(current);
  assert.equal(current.before, "盘面结论如下。");
  assert.equal(current.candidate.title, "SOL/USDT 币安永续 1H");
  assert.match(current.candidate.content, /^当前动作：不交易/);
  assert.match(current.after, /^---[\s\S]*## 数据范围/);

  const legacy = executionPlanTextPartition(`
### 标准执行方案

• 当前动作：等待
• 方向判断：偏多
• 多头触发：100
• 止损与失效：95
• 分批止盈：110
• 风险收益比：1:2
  `);
  assert.ok(legacy);
  assert.equal(legacy.before, "");
  assert.equal(legacy.candidate.title, "标准执行方案");
  assert.equal(legacy.after, "");
});

test("custom CJK market headings keep the full analysis visible beside the plan card", () => {
  const text = `
## 龙虾/USDT 币安永续 1H

当前动作：等待条件触发
方向判断：偏多
多头触发：0.076888
止损与失效：0.061826
分批止盈：第1目标 0.08464966
风险收益比：目标1为 1:0.5

---

## BINANCE:FUTURES:龙虾USDT · 1小时缠论分析

### 数据范围
本次使用 100 根 K 线。

### 缠论结构
当前末端结构为向下笔。
  `;

  const partitions = executionPlanTextPartitions(text);
  assert.ok(partitions);
  assert.equal(partitions.candidates.length, 1);
  assert.equal(partitions.candidates[0].title, "龙虾/USDT 币安永续 1H");
  assert.match(partitions.after, /### 数据范围/);
  assert.match(partitions.after, /### 缠论结构/);
  assert.equal(executionPlanCardTitle({
    fallbackTitle: partitions.candidates[0].title,
    sourceText: text,
  }), "龙虾/USDT 币安永续 1H");
});

test("an unheaded leading plan block cannot swallow the surrounding analysis", () => {
  const partitions = executionPlanTextPartitions(`
盘面摘要。

当前动作：等待条件触发
方向判断：偏多
多头触发：100
止损与失效：95
分批止盈：110
风险收益比：1:2

---

### 综合判断
结构仍然偏多，但需要收盘确认。
  `);

  assert.ok(partitions);
  assert.equal(partitions.before, "盘面摘要。");
  assert.match(partitions.candidates[0].content, /^当前动作：/);
  assert.match(partitions.after, /### 综合判断/);
  assert.match(partitions.after, /需要收盘确认/);
});

test("English execution plans are parsed, titled, and classified without Chinese copy", () => {
  const text = `
Market review complete.

## BTC/USDT Binance Perpetual 1D

Current action: Wait for the trigger
Direction: Bullish
Long trigger: 79000
Stop-loss and invalidation: 76000
Take-profit targets: Target 1: 83000; Target 2: 85000
Risk/reward: Target 1: 1:1.3
  `;
  const partition = executionPlanTextPartition(text);
  assert.ok(partition);
  assert.equal(partition.before, "Market review complete.");
  assert.equal(partition.candidate.title, "BTC/USDT Binance Perpetual 1D");
  assert.equal(executionPlanHasStructuredTradingFields(partition.candidate), true);
  assert.equal(executionPlanHasConcreteTradingPlan(partition.candidate), true);
  assert.equal(executionPlanDirectionTone("Direction:", "Bullish"), "bullish");
  assert.equal(executionPlanCardTitle({
    fallbackTitle: partition.candidate.title,
    sourceText: text,
    language: "en",
  }), "BTC/USDT Binance Perpetual 1D");
  assert.deepEqual(executionPlanBinanceMarketDetails({
    title: partition.candidate.title,
    content: partition.candidate.content,
  }), { symbol: "BTCUSDT", direction: "LONG" });
});

test("bilateral execution-plan markdown is extracted into independent candidates", () => {
  const text = `
盘面结论如下。

## ETH/USDT 币安永续 1H · 多头条件方案

当前动作：等待条件触发
方向判断：偏多
多头触发：1907.89
止损与失效：1891.93
分批止盈：第1目标 1926
风险收益比：目标1为 1:1.02

## ETH/USDT 币安永续 1H · 空头条件方案

当前动作：等待条件触发
方向判断：偏空
空头触发：1891.93
止损与失效：1907.89
分批止盈：第1目标 1886.67
风险收益比：目标1为 1:0.96

---

## 数据范围
完整报告。
  `;
  const candidates = executionPlanCandidatesFromText(text);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].title, "ETH/USDT 币安永续 1H · 多头条件方案");
  assert.equal(candidates[1].title, "ETH/USDT 币安永续 1H · 空头条件方案");
  assert.equal(executionPlanHasConcreteTradingPlan(candidates[0]), true);
  assert.equal(executionPlanHasConcreteTradingPlan(candidates[1]), true);
  const partitions = executionPlanTextPartitions(text);
  assert.ok(partitions);
  assert.equal(partitions.candidates.length, 2);
  assert.equal(partitions.before, "盘面结论如下。");
  assert.match(partitions.after, /^---[\s\S]*## 数据范围/);
});

test("structured generic plans and option candidates are recognized, while ordinary prose is ignored", () => {
  const structured = executionPlanCandidateFromText(`
## 推荐执行计划
- 先备份现有配置。
- 修改主题变量并覆盖 hover、focus 和 disabled 状态。
- 运行测试并检查亮暗主题。
  `);
  const options = executionPlanCandidateFromText(`
方案一：今天先完成本地迁移并运行验证。
方案二：保留旧入口，明天灰度切换。
  `);
  const letteredOptions = executionPlanCandidateFromText(`
## 候选方案
A. 先在本机完成迁移和验证。
B. 先保留旧入口，再进行灰度切换。
  `);

  assert.equal(structured?.title, "推荐执行计划");
  assert.match(structured?.content || "", /先备份现有配置/);
  assert.match(options?.content || "", /方案一/);
  assert.equal(letteredOptions?.title, "候选方案");
  assert.match(letteredOptions?.content || "", /A\. 先在本机/);
  assert.equal(executionPlanCandidateFromText("今天市场偏空，但还需要继续观察。"), null);
  assert.equal(executionPlanCandidateFromText("这里仅提到执行方案，没有给出可选择或可执行的步骤。"), null);
});

test("market-context headings do not fold ordinary trading education into a plan card", () => {
  const text = `
BTC/USDT 币安永续 4H
交易基础：现货、合约、杠杆、限价单、市价单、止损单。
趋势与结构：高点、低点、上涨趋势、下跌趋势、震荡。
支撑与阻力：如何画区域，而不是迷信一条线。
风险管理：R 倍数、止损距离、仓位计算。
策略执行：什么时候买、在哪里止损、何时止盈。
  `;
  const candidate = executionPlanCandidateFromText(text);

  assert.ok(candidate);
  assert.equal(candidate.title, "BTC/USDT 币安永续 4H");
  assert.equal(executionPlanHasConcreteTradingPlan(candidate), false);
});

test("Add to Plan is hidden for neutral trading placeholders without concrete prices", () => {
  const placeholder = executionPlanCandidateFromText(`
当前动作：等待条件触发
方向判断：中性
方向触发：未形成明确单侧方案
止损与失效：未形成
分批止盈：未形成
风险收益比：未形成
  `);
  assert.ok(placeholder);
  assert.equal(executionPlanHasConcreteTradingPlan(placeholder), false);

  const actionable = executionPlanCandidateFromText(`
当前动作：等待
方向判断：偏多
多头触发：1897.34
止损与失效：1876.01
分批止盈：1929.335
风险收益比：1:1.12
  `);
  assert.ok(actionable);
  assert.equal(executionPlanHasConcreteTradingPlan(actionable), true);

  const generic = executionPlanCandidateFromText(`
## 推荐执行计划
- 先备份现有配置。
- 修改主题变量并运行回归测试。
- 发布前检查亮暗主题。
  `);
  assert.equal(executionPlanHasConcreteTradingPlan(generic), true);
  assert.equal(executionPlanHasStructuredTradingFields(generic), false);
});

test("structured trading fields are the compatibility boundary for card rendering", () => {
  const education = executionPlanCandidateFromText(`
## 推荐交易学习路径
- 先理解止损和止盈的区别。
- 再学习如何根据风险计算仓位。
  `);
  const tradingPlan = executionPlanCandidateFromText(`
当前动作：等待
方向判断：偏多
多头触发：100
止损与失效：95
分批止盈：110
风险收益比：1:2
  `);

  assert.equal(executionPlanHasStructuredTradingFields(education), false);
  assert.equal(executionPlanHasStructuredTradingFields(tradingPlan), true);
});

test("saved plans persist per account scope and malformed records are discarded", () => {
  const storage = new MemoryStorage();
  const candidate = executionPlanCandidateFromText(`
• 当前动作：等待
• 方向判断：偏多
• 多头触发：100
• 止损与失效：95
• 分批止盈：110
• 风险收益比：1:2
  `);
  assert.ok(candidate);
  const plan = createSavedExecutionPlan({
    candidate,
    sourceThreadId: "thread-1",
    sourceMessageId: "message-1",
    sourceTitle: "BTC1H 分析",
    createdAt: "2026-08-16T12:00:00.000Z",
  });

  assert.equal(saveExecutionPlans("account-a", [plan], storage), true);
  assert.deepEqual(loadExecutionPlans("account-a", storage), [plan]);
  assert.deepEqual(loadExecutionPlans("account-b", storage), []);
  assert.equal(plan.status, "pending");
  assert.equal(plan.endReason, null);
});

test("legacy plans migrate to pending and lifecycle transitions retain explicit end reasons", () => {
  const storage = new MemoryStorage();
  const legacyPlan = {
    schemaVersion: 1,
    id: "legacy-plan",
    title: "标准执行方案",
    content: `• 当前动作：等待
• 方向判断：偏多
• 多头触发：100
• 止损与失效：95
• 分批止盈：110
• 风险收益比：1:2`,
    sourceThreadId: "thread-legacy-v1",
    sourceMessageId: "message-legacy-v1",
    sourceTitle: "BTC1H 分析",
    createdAt: "2026-08-16T12:00:00.000Z",
  };
  assert.equal(saveExecutionPlans("legacy-lifecycle", [legacyPlan], storage), true);
  const [pending] = loadExecutionPlans("legacy-lifecycle", storage);
  assert.equal(pending.status, "pending");
  assert.equal(pending.schemaVersion, 2);
  const executing = transitionExecutionPlan(pending, "executing", { updatedAt: "2026-08-16T12:05:00.000Z" });
  assert.equal(executing.status, "executing");
  assert.equal(executing.endReason, null);
  const ended = transitionExecutionPlan(executing, "ended", {
    endReason: "take_profit",
    updatedAt: "2026-08-16T12:30:00.000Z",
  });
  assert.equal(ended.status, "ended");
  assert.equal(ended.endReason, "take_profit");
  const reopened = transitionExecutionPlan(ended, "pending", { updatedAt: "2026-08-16T12:40:00.000Z" });
  assert.equal(reopened.status, "pending");
  assert.equal(reopened.endReason, null);
});

test("previously saved plan cards are narrowed when later analysis repeats core labels", () => {
  const storage = new MemoryStorage();
  const plan = createSavedExecutionPlan({
    candidate: {
      title: "标准执行方案",
      content: `• 当前动作：等待
• 方向判断：偏空
• 空头触发：75.12
• 止损与失效：75.68
• 分批止盈：74.28
• 风险收益比：1:1.5

---

BINANCE:FUTURES:SOLUSDT · 1小时缠论分析
完整分析再次提到止损 75.68 和风险收益比 1:1.5。`,
    },
    sourceThreadId: "thread-legacy",
    sourceMessageId: "message-legacy",
    createdAt: "2026-08-16T13:00:00.000Z",
  });

  assert.equal(saveExecutionPlans("account-legacy", [plan], storage), true);
  const [loaded] = loadExecutionPlans("account-legacy", storage);
  assert.ok(loaded);
  assert.match(loaded.content, /• 风险收益比：1:1\.5$/);
  assert.doesNotMatch(loaded.content, /BINANCE:FUTURES|完整分析/);
});

test("plan card display lines remove list markers and separate highlighted labels", () => {
  assert.deepEqual(executionPlanDisplayLines(`
• 当前动作：不交易（净盈亏比低于最低 1:1.5，保留候选测算）
- 方向判断：偏空
3. 空头触发：75.12，候选测算：10 倍杠杆
• 止损与失效：候选止损 75.68
• 分批止盈：候选止盈 74.28，测算仓位 2523.21 USDT
• 风险收益比：1:1.19（已含预估手续费和滑点）
  `), [
    { label: "当前动作：", text: "不交易" },
    { label: "方向判断：", text: "偏空" },
    { label: "空头触发：", text: "75.12，推荐：10 倍杠杆" },
    { label: "止损与失效：", text: "止损 75.68" },
    { label: "分批止盈：", text: "止盈 74.28，推荐仓位 2523.21 USDT" },
    { label: "风险收益比：", text: "1:1.19" },
  ]);
  assert.equal(executionPlanDirectionTone("方向判断：", "偏空"), "bearish");
  assert.equal(executionPlanDirectionTone("方向判断：", "看多"), "bullish");
  assert.equal(executionPlanDirectionTone("当前动作：", "空仓等待"), "");
});

test("trading plan card titles use symbol venue contract and interval format", () => {
  assert.equal(executionPlanCardTitle({
    fallbackTitle: "标准执行方案",
    analysisLabel: "SOL1H",
  }), "SOL/USDT 币安永续 1H");
  assert.equal(executionPlanCardTitle({
    fallbackTitle: "标准执行方案",
    sourceTitle: "BTC1D 帮我分析下",
  }), "BTC/USDT 币安永续 1D");
  assert.equal(executionPlanCardTitle({
    fallbackTitle: "标准执行方案",
    sourceText: "BINANCE:FUTURES:ETHUSDT · 4小时缠论分析",
  }), "ETH/USDT 币安永续 4H");
  assert.equal(executionPlanCardTitle({ fallbackTitle: "推荐执行计划" }), "推荐执行计划");
  assert.equal(executionPlanCardTitle({
    fallbackTitle: "推荐执行计划",
    sourceTitle: "BTC1D market review",
    language: "en",
  }), "BTC/USDT Binance Perpetual 1D");
  assert.equal(executionPlanCardTitle({ fallbackTitle: "推荐执行计划", language: "en" }), "Execution plan");
});

test("Binance position monitoring extracts the perpetual symbol and required direction", () => {
  assert.deepEqual(executionPlanBinanceMarketDetails({
    title: "SOL/USDT 币安永续 1H",
    content: `当前动作：不交易
方向判断：偏多
多头触发：1897.34
止损与失效：1876.01`,
  }), {
    symbol: "SOLUSDT",
    direction: "LONG",
  });
  assert.deepEqual(executionPlanBinanceMarketDetails({
    title: "标准执行方案",
    sourceText: "BINANCE:FUTURES:ETHUSDT · 4小时缠论分析",
    content: "方向判断：看空\n空头触发：2222.08",
  }), {
    symbol: "ETHUSDT",
    direction: "SHORT",
  });
});

test("saved plans retain Binance position observation state across restarts", () => {
  const storage = new MemoryStorage();
  const plan = createSavedExecutionPlan({
    candidate: {
      title: "SOL/USDT 币安永续 1H",
      content: "当前动作：等待\n方向判断：偏多\n多头触发：100\n止损与失效：95\n分批止盈：110\n风险收益比：1:2",
    },
    sourceThreadId: "thread-monitor",
    sourceMessageId: "message-monitor",
    createdAt: "2026-08-17T02:00:00.000Z",
  });
  const executing = transitionExecutionPlan(plan, "executing", {
    updatedAt: "2026-08-17T02:01:00.000Z",
    binanceTracking: {
      positionObserved: true,
      lastPositionAt: "2026-08-17T02:01:15.000Z",
      lastPositionAmount: 2.5,
      lastEntryPrice: 100,
      lastMarkPrice: 101,
      lastUnrealizedPnl: 2.5,
    },
  });
  assert.equal(saveExecutionPlans("monitor-account", [executing], storage), true);
  const [restored] = loadExecutionPlans("monitor-account", storage);
  assert.equal(restored.binanceTracking.positionObserved, true);
  assert.equal(restored.binanceTracking.lastPositionAmount, 2.5);
  assert.equal(restored.binanceTracking.lastUnrealizedPnl, 2.5);
});

test("active plans reconcile against fresh Binance positions and full-close history", async () => {
  const renderer = await rendererSource;
  const monitorStart = renderer.indexOf("function executionPlanBinanceMonitoringNeeded");
  const monitorEnd = renderer.indexOf("async function syncExecutionPlanLinkedAlert", monitorStart);
  const monitor = renderer.slice(monitorStart, monitorEnd);
  const liveRefreshStart = renderer.indexOf("function binanceAccountReadOnlyDataVisible");
  const liveRefreshEnd = renderer.indexOf("function renderBinanceAccountLiveUpdate", liveRefreshStart);
  const liveRefresh = renderer.slice(liveRefreshStart, liveRefreshEnd);

  assert.match(renderer, /const BINANCE_ACCOUNT_EXECUTION_PLAN_LIVE_REFRESH_INTERVAL_MS = 15_000/);
  assert.match(monitor, /position\.symbol\.trim\(\)\.toUpperCase\(\) === identity\.symbol/);
  assert.match(monitor, /position\.direction === identity\.direction/);
  assert.match(monitor, /Math\.abs\(position\.amount\) > 1e-12/);
  assert.match(monitor, /plan\.status === "pending"[\s\S]*updateExecutionPlanLifecycle\(plan\.id, "executing"/);
  assert.match(monitor, /record\.closeType === "FULL"/);
  assert.match(monitor, /record\.direction === identity\.direction/);
  assert.match(monitor, /realizedPnl > 0 \? "take_profit" : "stop_loss"/);
  assert.match(monitor, /getBinanceAccountSnapshot\(\{ force: true, live: false \}\)/);
  assert.match(monitor, /tracking\.missingPolls < 2/);
  assert.match(monitor, /updateExecutionPlanLifecycle\(plan\.id, "ended", endReason/);
  assert.match(liveRefresh, /executionPlanBinanceMonitoringNeeded\(\)/);
  assert.match(liveRefresh, /BINANCE_ACCOUNT_EXECUTION_PLAN_LIVE_REFRESH_INTERVAL_MS/);
  assert.match(renderer, /document\.hidden && !executionPlanBinanceMonitoringNeeded\(\)/);
});

test("signed plan values color losses red and gains green without treating ranges as signed", () => {
  assert.deepEqual(
    executionPlanSignedNumberSegments("止损约 -23.85 USDT，全部止盈约 +23.16 USDT，区间 75.12-75.68"),
    [
      { text: "止损约 ", tone: "" },
      { text: "-23.85", tone: "bearish" },
      { text: " USDT，全部止盈约 ", tone: "" },
      { text: "+23.16", tone: "bullish" },
      { text: " USDT，区间 75.12-75.68", tone: "" },
    ],
  );
});

test("the final assistant bubble, plan empty state, and both themes are wired together", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const autoTaskStart = renderer.indexOf("function renderAutoTasksPage");
  const autoTaskEnd = renderer.indexOf("function renderAutoTaskItem", autoTaskStart);
  const autoTaskBlock = renderer.slice(autoTaskStart, autoTaskEnd);
  const addPlanStart = renderer.indexOf("function addExecutionPlanFromMessageAction");
  const addPlanEnd = renderer.indexOf("function bindMessageContentEvents", addPlanStart);
  const addPlanBlock = renderer.slice(addPlanStart, addPlanEnd);
  const planCardContentStart = renderer.indexOf("function renderExecutionPlanCardContent");
  const planCardStart = renderer.indexOf("function renderExecutionPlanCard(plan");
  const planCardEnd = renderer.indexOf("function renderExecutionPlansPage", planCardStart);
  const planCardContentBlock = renderer.slice(planCardContentStart, planCardStart);
  const messagePlanStart = renderer.indexOf("function renderMessageExecutionPlan");
  const messagePlanEnd = renderer.indexOf("function executionPlanStatusMeta", messagePlanStart);
  const messagePlanBlock = renderer.slice(messagePlanStart, messagePlanEnd);
  const textBubbleStart = renderer.indexOf("function renderTextBubble");
  const textBubbleEnd = renderer.indexOf("function shouldLocalizeAppOwnedMessage", textBubbleStart);
  const textBubbleBlock = renderer.slice(textBubbleStart, textBubbleEnd);
  const planCardBlock = renderer.slice(planCardStart, planCardEnd);
  const planEventStart = renderer.indexOf("function bindExecutionPlanEvents");
  const planEventEnd = renderer.indexOf("function bindEvents", planEventStart);
  const planEventBlock = renderer.slice(planEventStart, planEventEnd);

  assert.match(renderer, /allowPlanAction:[\s\S]*!streaming[\s\S]*hasConclusiveAgentMessagePhase/);
  assert.match(renderer, /function renderAddToPlanAction[\s\S]*executionPlanCandidatesFromText\(text\)/);
  assert.match(renderer, /function renderAddToPlanAction[\s\S]*executionPlanHasConcreteTradingPlan\(candidate\)/);
  assert.match(renderer, /class="message-action-button trading-preference-onboarding-start trading-preference-binance-connect message-add-to-plan"/);
  assert.match(renderer, /data-message-action-destination="execution-plans"/);
  assert.match(renderer, /function renderExecutionPlansPage[\s\S]*execution-plan-list[\s\S]*当前没有计划/);
  assert.match(renderer, /const executionPlanSubfilters = state\.executionPlans\.length\s*\?/);
  assert.match(renderer, /\["pending", "待执行"\][\s\S]*\["executing", "执行中"\][\s\S]*\["ended", "已结束"\]/);
  assert.match(renderer, /data-execution-plan-filter="\$\{status\}"/);
  assert.doesNotMatch(renderer, /data-execution-plan-action="start"|开始执行/);
  assert.match(renderer, /plan\.status === "ended"[\s\S]*data-execution-plan-action="reopen"[\s\S]*data-execution-plan-action="open-end-menu"/);
  assert.match(renderer, /data-execution-plan-action="delete"[\s\S]*删除/);
  assert.match(renderer, /data-execution-plan-end-reason="\$\{reason\}"/);
  assert.match(renderer, /class="execution-plan-end-menu" role="menu"/);
  assert.match(renderer, /updateExecutionPlanLifecycle[\s\S]*transitionExecutionPlan[\s\S]*saveExecutionPlans/);
  assert.match(planEventBlock, /executionPlanEventsBound[\s\S]*root\.addEventListener\("click"/);
  assert.match(planEventBlock, /closest<HTMLButtonElement>\("\[data-execution-plan-action\]"\)/);
  assert.doesNotMatch(planEventBlock, /action === "start"|updateExecutionPlanLifecycle\(planId, "executing"\)/);
  assert.match(planEventBlock, /action === "open-end-menu"[\s\S]*queueMicrotask/);
  assert.match(planEventBlock, /action === "end"[\s\S]*updateExecutionPlanLifecycle\(planId, "ended", endReason\)/);
  assert.match(planEventBlock, /action === "delete"[\s\S]*deleteExecutionPlan\(planId\)/);
  assert.match(renderer, /async function deleteExecutionPlan[\s\S]*confirmInApp[\s\S]*api\.tradingAlertsDelete[\s\S]*saveExecutionPlans/);
  assert.match(planEventBlock, /closest<HTMLButtonElement>\("\[data-execution-plan-filter\]"\)/);
  assert.match(planEventBlock, /root\.addEventListener\("keydown"[\s\S]*event\.key !== "Escape"/);
  assert.doesNotMatch(renderer, /querySelectorAll<HTMLButtonElement>\("\[data-execution-plan-action\]"\)/);
  assert.match(planCardBlock, /renderExecutionPlanCardContent\(plan\.content\)/);
  assert.match(planCardBlock, /executionPlanCardTitle\([\s\S]*tradingLastAnalysisLabelForThread\(plan\.sourceThreadId\)/);
  assert.doesNotMatch(planCardBlock, /execution-plan-card-mark|<svg/);
  assert.match(planCardContentBlock, /<span class="execution-plan-card-label">/);
  assert.match(planCardContentBlock, /executionPlanDirectionTone\(line\.label, line\.text\)/);
  assert.match(planCardContentBlock, /executionPlanSignedNumberSegments\(line\.text\)/);
  assert.match(planCardContentBlock, /execution-plan-card-number-\$\{segment\.tone\}/);
  assert.match(planCardContentBlock, /execution-plan-card-value-\$\{directionTone\}/);
  assert.doesNotMatch(planCardContentBlock, /<strong class="execution-plan-card-label">/);
  assert.match(messagePlanBlock, /executionPlanTextPartitions\(text\)/);
  assert.match(messagePlanBlock, /presentation !== "execution-plan"/);
  assert.match(messagePlanBlock, /executionPlanHasStructuredTradingFields\(candidate\)/);
  assert.match(messagePlanBlock, /executionPlanHasConcreteTradingPlan\(candidate\)/);
  assert.match(renderer, /__youleExecutionPlanPresentation: "plain"/);
  assert.match(renderer, /result\.report, undefined, undefined, "execution-plan"/);
  assert.match(messagePlanBlock, /executionPlanCardTitle\([\s\S]*titleContext/);
  assert.match(messagePlanBlock, /class="message-execution-plan"/);
  assert.match(messagePlanBlock, /partitions\.candidates\.map\([\s\S]*renderExecutionPlanCardContent\(candidate\.content\)/);
  assert.match(messagePlanBlock, /data-message-execution-plan-action="increase"[\s\S]*>放大</);
  assert.match(messagePlanBlock, /data-message-execution-plan-action="decrease"[\s\S]*>缩小</);
  assert.match(messagePlanBlock, /data-message-execution-plan-action="sticky">便利贴</);
  assert.match(messagePlanBlock, /loadMessageExecutionPlanFontSize\(key\)/);
  assert.match(messagePlanBlock, /const fullReportFallback = narrativeContext[\s\S]*?formatMessageText\(text, options\)/);
  assert.match(messagePlanBlock, /bubbleContent: `\$\{before\}\$\{after\}\$\{fullReportFallback\}`/);
  assert.match(renderer, /renderMessageExecutionPlan\(message, content\.text/);
  assert.match(textBubbleBlock, /<\/div>\s*\$\{executionPlanPresentation\?\.cards \|\| ""\}\s*\$\{actionsBelowBubble/s);
  assert.match(renderer, /querySelectorAll<HTMLButtonElement>\("\[data-message-execution-plan-action\]"\)/);
  assert.match(renderer, /function messageExecutionPlanGroupCards[\s\S]*closest<HTMLElement>\("\.message-execution-plan-list"\)[\s\S]*querySelectorAll<HTMLElement>\("\.message-execution-plan"\)/);
  assert.match(renderer, /function applyMessageExecutionPlanGroupFontSize[\s\S]*messageExecutionPlanGroupCards\(card\)\.forEach[\s\S]*applyMessageExecutionPlanFontSize\(groupCard, next\)/);
  assert.match(renderer, /function createExecutionPlanStickyFromMessageGroup[\s\S]*Promise\.allSettled\(cards\.map[\s\S]*createExecutionPlanStickyFromMessageCard\(groupCard\)/);
  assert.match(renderer, /button\.dataset\.messageExecutionPlanActionBound === "true"[\s\S]*button\.dataset\.messageExecutionPlanActionBound = "true"/);
  assert.match(renderer, /api\.createExecutionPlanSticky\([\s\S]*executionPlanDisplayLines\(candidate\.content\)/);
  assert.match(planCardBlock, /<footer>[\s\S]*<time/);
  assert.doesNotMatch(planCardBlock, /sourceLabel|footer span/);
  assert.match(addPlanBlock, /saveExecutionPlans[\s\S]*openExecutionPlansPage\(\)[\s\S]*showToast\("已添加到计划"\)/);
  assert.doesNotMatch(autoTaskBlock, /renderPlanningNavigation|execution-plan|当前没有计划/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect:hover:not\(:disabled\)/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect:focus-visible/);
  assert.match(styles, /\.message-actions \.trading-preference-binance-connect:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-actions \.trading-preference-binance-connect:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.execution-plan-card:hover/);
  assert.match(styles, /\.execution-plan-card-actions[\s\S]*opacity:\s*0[\s\S]*\.execution-plan-card:is\(:hover, :focus-within\)/);
  assert.match(styles, /\.execution-plan-card footer time\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(styles, /\.execution-plan-card-actions\s*\{[^}]*z-index:\s*2/s);
  assert.match(styles, /\.execution-plan-end-menu\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(styles, /\.execution-plan-card-actions button\.danger\s*\{[^}]*color:\s*var\(--danger\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.execution-plan-end-menu/);
  assert.match(styles, /\.execution-plan-card-label\s*\{[^}]*color:\s*var\(--conversation-analysis-context\)/s);
  assert.match(styles, /\.execution-plan-card-label\s*\{[^}]*font-weight:\s*700/s);
  assert.match(styles, /\.execution-plan-card-line\s*\{[^}]*padding:\s*0;[^}]*text-align:\s*left/s);
  assert.match(styles, /\.execution-plan-card-value-bearish\s*\{[^}]*color:\s*var\(--execution-plan-direction-bearish\)/s);
  assert.match(styles, /\.execution-plan-card-value-bullish\s*\{[^}]*color:\s*var\(--execution-plan-direction-bullish\)/s);
  assert.match(styles, /\.execution-plan-card-number-bearish\s*\{[^}]*color:\s*var\(--execution-plan-direction-bearish\)/s);
  assert.match(styles, /\.execution-plan-card-number-bullish\s*\{[^}]*color:\s*var\(--execution-plan-direction-bullish\)/s);
  assert.match(styles, /\.message-execution-plan\s*\{[^}]*text-align:\s*left;[^}]*user-select:\s*text/s);
  assert.match(styles, /\.message-execution-plan\s*\{[^}]*position:\s*relative;[^}]*padding:\s*16px 17px 25px/s);
  assert.match(styles, /\.message-execution-plan h2\s*\{[^}]*color:\s*var\(--text-primary\)[^}]*text-align:\s*left/s);
  assert.match(styles, /\.message-execution-plan-controls\s*\{[^}]*position:\s*absolute;[^}]*justify-content:\s*flex-end[^}]*min-height:\s*20px[^}]*opacity:\s*0;[^}]*pointer-events:\s*none/s);
  assert.match(styles, /\.message-execution-plan:hover \.message-execution-plan-controls,[\s\S]*button:focus-visible\)[\s\S]*button\[aria-busy="true"\][\s\S]*opacity:\s*1;[\s\S]*pointer-events:\s*auto/);
  assert.match(styles, /@media \(hover:\s*none\)\s*\{[\s\S]*\.message-execution-plan-controls\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto/s);
  assert.match(styles, /\.message-execution-plan-controls button:hover:not\(:disabled\)/);
  assert.match(styles, /\.message-execution-plan-controls button:active:not\(:disabled\)/);
  assert.match(styles, /\.message-execution-plan-controls button:focus-visible/);
  assert.match(styles, /\.message-execution-plan-controls button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-execution-plan:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.message-execution-plan-controls\s*\{[^}]*background:\s*color-mix/s);
  assert.match(styles, /html\[data-theme="dark"\] \.message-execution-plan-controls button:hover:not\(:disabled\)/);
  assert.match(styles, /html\[data-theme="dark"\] :is\(\.execution-plans-page, \.message-execution-plan\)\s*\{[^}]*--execution-plan-direction-bullish:\s*#52dc88;[^}]*--execution-plan-direction-bearish:\s*#ff718e/s);
  assert.match(styles, /\.mac-titlebar:has\(\.titlebar-market-favorites-host:not\(\[hidden\]\)\)[\s\S]*?> \.titlebar-drag-region\s*\{[^}]*position:\s*relative;/s);
  assert.match(styles, /\.mac-titlebar \.titlebar-market-favorites-host\s*\{[^}]*position:\s*relative;[^}]*inset:\s*auto;[^}]*flex:\s*1 1 auto;/s);
  assert.doesNotMatch(styles, /\.execution-plan-card-mark/);
  assert.match(styles, /\.execution-plan-empty p\s*\{[^}]*font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\)/s);
});
