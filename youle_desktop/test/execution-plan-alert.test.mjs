import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildExecutionPlanAlertRule,
  executionPlanAlertIds,
  executionPlanAlertSummaryLines,
  parseExecutionPlanAlertInput,
} from "../src/main/trading-alerts/execution-plan-alert.mjs";
import { TradingAlertService } from "../src/main/trading-alerts/service.mjs";
import { createSavedExecutionPlan } from "../src/renderer/execution-plans.ts";

const NOW = 1_786_464_000_000;
const title = "SOL/USDT 币安永续 1H";
const bilateralTitle = "SOL/USDT 币安永续 1H · 多头条件方案";
const content = `当前动作：不交易
方向判断：偏空
空头触发：75.12，推荐：10 倍杠杆、2523.22 USDT 的空单
止损与失效：止损 75.68
分批止盈：止盈 74.28，推荐仓位 2523.21 USDT
风险收益比：目标1为 1:0.97，如果止损：约 -23.85 USDT，如果全部止盈：约 +23.16 USDT`;

test("execution-plan parser builds one real rule with three phase-labelled conditions", () => {
  const spec = parseExecutionPlanAlertInput({ planId: "plan-sol-1", title, content, status: "pending" });
  assert.equal(spec.marketId, "BINANCE:FUTURES:SOLUSDT");
  assert.equal(spec.interval, "1h");
  assert.equal(spec.direction, "short");
  assert.deepEqual(executionPlanAlertSummaryLines(spec), [
    "待执行｜SOL 价格达到 75.12 时触发开空预警",
    "执行中｜SOL 价格达到 75.68 时触发止损预警",
    "执行中｜SOL 价格达到 74.28 时触发止盈预警",
  ]);
  const pending = buildExecutionPlanAlertRule(spec);
  assert.equal(pending.root.type, "condition");
  assert.equal(pending.root.condition.conditionId, "execution-plan-entry");
  assert.equal(pending.root.condition.operator, "lte");
  const executing = buildExecutionPlanAlertRule(
    parseExecutionPlanAlertInput({ planId: "plan-sol-1", title, content, status: "executing" }),
    { previousRule: pending, now: NOW + 1 },
  );
  assert.equal(executing.revision, pending.revision + 1);
  assert.equal(executing.root.type, "any");
  assert.deepEqual(executing.root.children.map((child) => child.condition.conditionId), [
    "execution-plan-stop-loss",
    "execution-plan-take-profit",
  ]);
});

test("execution-plan parser rejects ambiguous direction and unsafe price relationships", () => {
  assert.throws(
    () => parseExecutionPlanAlertInput({ planId: "bad-plan", title, content: content.replace("方向判断：偏空", "方向判断：观望").replace("空头触发", "价格触发"), status: "pending" }),
    /明确的多空方向/,
  );
  assert.throws(
    () => parseExecutionPlanAlertInput({ planId: "bad-plan", title, content: content.replace("止损 75.68", "止损 74.00"), status: "pending" }),
    /止损价高于触发价/,
  );
});

test("renderer bilateral display titles remain monitorable in Chinese and English", () => {
  const cases = [
    {
      candidate: {
        title: "ETH/USDT 币安永续 1D · 多头条件方案",
        content: `当前动作：等待条件触发
方向判断：偏多
多头触发：2549.4
止损与失效：2381.88
分批止盈：第1目标 2581.7909666666，第2目标 2598.16626666
风险收益比：目标1为 1:0.16`,
      },
      language: "zh-CN",
      expectedTitle: "ETH/USDT 币安永续 1D · 多头条件方案",
      expectedDirection: "long",
      expectedEntry: 2549.4,
      expectedStopLoss: 2381.88,
      expectedTakeProfit: 2581.7909666666,
    },
    {
      candidate: {
        title: "ETH/USDT 币安永续 1D · 空头条件方案",
        content: `当前动作：等待条件触发
方向判断：偏空
空头触发：2381.88
止损与失效：2549.4
分批止盈：第1目标 2329.74697334，第2目标 2301.32541334
风险收益比：目标1为 1:0.27`,
      },
      language: "zh-CN",
      expectedTitle: "ETH/USDT 币安永续 1D · 空头条件方案",
      expectedDirection: "short",
      expectedEntry: 2381.88,
      expectedStopLoss: 2549.4,
      expectedTakeProfit: 2329.74697334,
    },
    {
      candidate: {
        title: "ETH/USDT Binance Perpetual 1D · Long setup",
        content: `Current action: Wait for the trigger
Direction: Bullish
Long trigger: 2549.4
Stop-loss and invalidation: 2381.88
Take-profit targets: Target 1: 2581.7909666666; Target 2: 2598.16626666
Risk/reward: Target 1: 1:0.16`,
      },
      language: "en",
      expectedTitle: "ETH/USDT Binance Perpetual 1D · Long setup",
      expectedDirection: "long",
      expectedEntry: 2549.4,
      expectedStopLoss: 2381.88,
      expectedTakeProfit: 2581.7909666666,
    },
    {
      candidate: {
        title: "ETH/USDT Binance Perpetual 1D · Short setup",
        content: `Current action: Wait for the trigger
Direction: Bearish
Short trigger: 2381.88
Stop-loss and invalidation: 2549.4
Take-profit targets: Target 1: 2329.74697334; Target 2: 2301.32541334
Risk/reward: Target 1: 1:0.27`,
      },
      language: "en",
      expectedTitle: "ETH/USDT Binance Perpetual 1D · Short setup",
      expectedDirection: "short",
      expectedEntry: 2381.88,
      expectedStopLoss: 2549.4,
      expectedTakeProfit: 2329.74697334,
    },
    {
      candidate: {
        title: "龙虾/USDT 币安永续 1D · 多头条件方案",
        content: `当前动作：等待条件触发
方向判断：偏多
多头触发：0.051
止损与失效：0.049
分批止盈：第1目标 0.055，第2目标 0.058
风险收益比：目标1为 1:2`,
      },
      language: "zh-CN",
      analysisLabel: "龙虾1D",
      expectedTitle: "龙虾/USDT 币安永续 1D · 多头条件方案",
      expectedMarketId: "BINANCE:FUTURES:龙虾USDT",
      expectedDirection: "long",
      expectedEntry: 0.051,
      expectedStopLoss: 0.049,
      expectedTakeProfit: 0.055,
    },
  ];

  cases.forEach((fixture, index) => {
    const plan = createSavedExecutionPlan({
      candidate: fixture.candidate,
      sourceThreadId: `thread-bilateral-${index}`,
      sourceMessageId: `message-bilateral-${index}`,
      analysisLabel: fixture.analysisLabel || "ETH1D",
      language: fixture.language,
      createdAt: "2026-08-30T06:00:00.000Z",
    });
    assert.equal(plan.title, fixture.expectedTitle);
    const spec = parseExecutionPlanAlertInput({ ...plan, planId: plan.id });
    assert.equal(spec.marketId, fixture.expectedMarketId || "BINANCE:FUTURES:ETHUSDT");
    assert.equal(spec.interval, "1d");
    assert.equal(spec.direction, fixture.expectedDirection);
    assert.equal(spec.entry, fixture.expectedEntry);
    assert.equal(spec.stopLoss, fixture.expectedStopLoss);
    assert.equal(spec.takeProfit, fixture.expectedTakeProfit);
  });

  assert.throws(
    () => parseExecutionPlanAlertInput({
      planId: "unknown-suffix",
      title: "ETH/USDT 币安永续 1D · 任意说明",
      content,
      status: "pending",
    }),
    /计划标题缺少可监控的交易对、永续合约或周期/,
  );
});

test("syncExecutionPlan creates a real monitored alert, switches phases, triggers evidence, and pauses on end", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-execution-plan-alert-"));
  let now = NOW;
  let listener = null;
  let subscriptions = 0;
  const history = [0, 1].map((index) => {
    const time = NOW - (2 - index) * 3_600_000;
    return { time, closeTime: time + 3_600_000, open: 75.3, high: 75.4, low: 75.2, close: 75.3, volume: 10 };
  });
  const adapter = {
    providerId: "binance-public",
    async loadHistory() { return history; },
    async subscribe(_subscription, onEvent) {
      subscriptions += 1;
      listener = onEvent;
      return async () => { subscriptions -= 1; listener = null; };
    },
  };
  const notifications = [];
  try {
    const service = new TradingAlertService({
      dataDir,
      enabled: true,
      marketAdapter: adapter,
      now: () => now,
      notify: async (payload) => notifications.push(payload),
      invokeIntentModel: async () => { throw new Error("not used"); },
    });
    await service.start();
    const pending = await service.syncExecutionPlan({ planId: "plan-sol-1", title: bilateralTitle, content, status: "pending", originThreadId: "thread-sol-1" });
    const ids = executionPlanAlertIds("plan-sol-1");
    assert.equal(pending.alert.alertId, ids.alertId);
    assert.equal(pending.alert.status, "monitoring");
    assert.equal(pending.monitoringReady, true);
    assert.equal(subscriptions, 1);

    const manuallyPaused = await service.pause(ids.alertId);
    assert.equal(manuallyPaused.status, "paused");
    assert.equal(manuallyPaused.enabled, false);
    assert.equal(subscriptions, 0);
    const manuallyResumed = await service.resume(ids.alertId);
    assert.equal(manuallyResumed.status, "monitoring");
    assert.equal(manuallyResumed.enabled, true);
    assert.equal(subscriptions, 1);
    const revision = await service.revise({ alertId: ids.alertId });
    assert.equal(revision.requiresSimulation, true);
    assert.equal(revision.draft.status, "ready_to_simulate");
    assert.equal((await service.store.getAlert(ids.alertId)).status, "monitoring");

    now += 3_600_000;
    await service.engine.processEvent(ids.alertId, {
      eventId: "entry-hit",
      marketId: "BINANCE:FUTURES:SOLUSDT",
      interval: "1h",
      eventTime: now,
      receivedAt: now,
      candle: { time: now, closeTime: now + 3_600_000, open: 75.3, high: 75.3, low: 75.1, close: 75.1, volume: 10 },
      closed: false,
      source: "test",
      coverage: "available",
    });
    const entryEvidence = await service.store.listEvidence({ alertId: ids.alertId });
    assert.equal(entryEvidence.length, 1);
    assert.equal(entryEvidence[0].conditionResults.some((item) => item.conditionId === "execution-plan-entry" && item.result === true), true);
    assert.equal(notifications.length, 1);

    now += 1;
    const executing = await service.syncExecutionPlan({ planId: "plan-sol-1", alertId: ids.alertId, title: bilateralTitle, content, status: "executing", originThreadId: "thread-sol-1" });
    assert.equal(executing.alert.rule.revision, pending.alert.rule.revision + 1);
    assert.equal(executing.alert.status, "monitoring");
    assert.equal(executing.alert.rule.root.type, "any");

    now += 3_600_000;
    await service.engine.processEvent(ids.alertId, {
      eventId: "stop-hit",
      marketId: "BINANCE:FUTURES:SOLUSDT",
      interval: "1h",
      eventTime: now,
      receivedAt: now,
      candle: { time: now, closeTime: now + 3_600_000, open: 75.3, high: 75.7, low: 75.3, close: 75.7, volume: 10 },
      closed: false,
      source: "test",
      coverage: "available",
    });
    const evidence = await service.store.listEvidence({ alertId: ids.alertId });
    assert.equal(evidence.length, 2);
    assert.equal(evidence[0].conditionResults.some((item) => item.conditionId === "execution-plan-stop-loss" && item.result === true), true, JSON.stringify(evidence[0].conditionResults));

    now += 1;
    const ended = await service.syncExecutionPlan({ planId: "plan-sol-1", alertId: ids.alertId, title: bilateralTitle, content, status: "ended", originThreadId: "thread-sol-1" });
    assert.equal(ended.alert.status, "paused");
    assert.equal(ended.alert.enabled, false);
    assert.equal(service.engine.runtimes.has(ids.alertId), false);
    assert.equal(subscriptions, 0);
    const deleted = await service.delete(ids.alertId);
    assert.equal(deleted.deleted, true);
    assert.equal(await service.store.getAlert(ids.alertId), null);
    await service.shutdown();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
