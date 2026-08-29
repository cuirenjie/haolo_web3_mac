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

const NOW = 1_786_464_000_000;
const title = "SOL/USDT 币安永续 1H";
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
    const pending = await service.syncExecutionPlan({ planId: "plan-sol-1", title, content, status: "pending", originThreadId: "thread-sol-1" });
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
    const executing = await service.syncExecutionPlan({ planId: "plan-sol-1", alertId: ids.alertId, title, content, status: "executing", originThreadId: "thread-sol-1" });
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
    const ended = await service.syncExecutionPlan({ planId: "plan-sol-1", alertId: ids.alertId, title, content, status: "ended", originThreadId: "thread-sol-1" });
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
