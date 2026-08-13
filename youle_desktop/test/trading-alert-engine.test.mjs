import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TradingAlertStore, createInitialAlertInstance } from "../src/main/trading-alerts/store.mjs";
import { TradingAlertMarketDataHub } from "../src/main/trading-alerts/market-data-hub.mjs";
import { TradingAlertEngine } from "../src/main/trading-alerts/engine.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { TradingAlertEvaluator } from "../src/main/trading-alerts/evaluator.mjs";

const fixture = normalizeAlertRule(JSON.parse(await readFile(new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url), "utf8")));
const START = 1_786_464_000_000;

function candle(close, index, values) {
  const open = index ? values[index - 1] : close;
  const time = START + index * 3_600_000;
  return { time, closeTime: time + 3_600_000, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 100 };
}

function priceRule({ id = "price-rule", mode = "once", threshold = 110, operator = "cross_over" } = {}) {
  return normalizeAlertRule({
    ...fixture,
    ruleId: id,
    title: "价格上穿预警",
    root: { type: "condition", condition: {
      conditionId: "price-cross", contextId: "primary", operator,
      left: { type: "field", field: "close" }, right: { type: "constant", value: threshold }, confirmation: "bar_close",
    } },
    triggerPolicy: {
      mode, edge: "false_to_true", rearm: "must_become_false",
      ...(mode === "once" ? { maxTriggersTotal: 1 } : {}), resumePolicy: "baseline_only_no_catch_up",
    },
    dataRequirements: [],
    ruleHash: undefined,
  });
}

class FakeAdapter {
  constructor(values) { this.providerId = "binance-public"; this.values = values; this.listener = null; this.healthListener = null; this.subscribeCalls = 0; }
  async loadHistory() { return this.values.map((value, index, all) => candle(value, index, all)); }
  async subscribe(_subscription, listener, onHealth) { this.subscribeCalls += 1; this.listener = listener; this.healthListener = onHealth; return async () => { this.listener = null; this.healthListener = null; }; }
  health(status) { this.healthListener?.({ status, at: Date.now(), reason: status === "connected" ? "" : "test_disconnect" }); }
  emit(close, index, id = `market-${index}`) {
    const values = [...this.values, close];
    const currentIndex = this.values.length;
    const next = candle(close, currentIndex, values);
    this.values.push(close);
    this.listener?.({ eventId: id, eventTime: next.closeTime, receivedAt: next.closeTime, candle: next, closed: true, source: "fake", coverage: "available" });
  }
}

async function createAlert(store, rule, id = "alert-engine") {
  await store.createAlert(createInitialAlertInstance({ alertId: id, draftId: `draft-${id}`, rule, simulationId: `simulation-${id}`, confirmationId: `confirmation-${id}`, now: START }));
}

test("engine establishes a no-catch-up baseline, then triggers once with evidence and notification", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-engine-"));
  try {
    let now = START + 2 * 3_600_000;
    const store = new TradingAlertStore({ dataDir, now: () => now });
    const rule = priceRule();
    await createAlert(store, rule);
    const adapter = new FakeAdapter([100, 105]);
    const hub = new TradingAlertMarketDataHub(); hub.registerAdapter(adapter);
    const notifications = [];
    const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => now, notify: async (payload) => notifications.push(payload), heartbeatMs: 100_000 });
    await engine.start();
    assert.equal((await store.listEvidence()).length, 0);
    now = START + 3 * 3_600_000;
    adapter.emit(115, 2, "real-cross");
    await engine.queue;
    assert.equal((await store.listEvidence()).length, 1);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].deepLink, /^haolo:\/\/alerts\//);
    assert.equal((await store.getAlert("alert-engine")).status, "completed");
    adapter.emit(116, 3, "real-cross");
    await engine.queue;
    assert.equal((await store.listEvidence()).length, 1);
    assert.equal(notifications.length, 1);
    await engine.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("startup with an already-true condition does not backfill and records a monitoring gap", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-gap-"));
  try {
    let now = START;
    const store = new TradingAlertStore({ dataDir, now: () => now });
    await createAlert(store, priceRule({ threshold: 90, operator: "gt" }), "gap-alert");
    await store.writeShutdown(now);
    now += 600_000;
    const adapter = new FakeAdapter([100, 105]);
    const hub = new TradingAlertMarketDataHub(); hub.registerAdapter(adapter);
    const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => now, heartbeatMs: 10_000 });
    await engine.start();
    assert.equal((await store.listEvidence()).length, 0);
    const gaps = await store.listGaps({ alertId: "gap-alert" });
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].catchUpEvaluated, false);
    assert.equal((await store.getAlert("gap-alert")).rearmState, "waiting_false");
    await engine.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("repeat alerts must become false before a second trigger and subscriptions are shared", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-repeat-"));
  try {
    let now = START + 2 * 3_600_000;
    const store = new TradingAlertStore({ dataDir, now: () => now });
    await createAlert(store, priceRule({ id: "repeat", mode: "repeat" }), "repeat-a");
    await createAlert(store, priceRule({ id: "repeat-2", mode: "repeat" }), "repeat-b");
    const adapter = new FakeAdapter([100, 105]);
    const hub = new TradingAlertMarketDataHub(); hub.registerAdapter(adapter);
    const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => now, heartbeatMs: 100_000 });
    await engine.start();
    assert.equal(adapter.subscribeCalls, 1);
    now += 3_600_000; adapter.emit(115, 2, "up-one"); await engine.queue;
    assert.equal((await store.listEvidence({ alertId: "repeat-a" })).length, 1);
    now += 3_600_000; adapter.emit(116, 3, "still-up"); await engine.queue;
    assert.equal((await store.listEvidence({ alertId: "repeat-a" })).length, 1);
    now += 3_600_000; adapter.emit(100, 4, "rearm-down"); await engine.queue;
    now += 3_600_000; adapter.emit(115, 5, "up-two"); await engine.queue;
    assert.equal((await store.listEvidence({ alertId: "repeat-a" })).length, 2);
    assert.equal((await store.getAlert("repeat-a")).triggerCount, 2);
    await engine.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("network and sleep gaps resume from a fresh baseline without catch-up", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-lifecycle-"));
  try {
    let now = START + 2 * 3_600_000;
    const store = new TradingAlertStore({ dataDir, now: () => now });
    await createAlert(store, priceRule({ id: "gap-repeat", mode: "repeat" }), "gap-repeat");
    const adapter = new FakeAdapter([100, 105]);
    const hub = new TradingAlertMarketDataHub(); hub.registerAdapter(adapter);
    const notifications = [];
    const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => now, notify: async (value) => notifications.push(value), heartbeatMs: 100_000 });
    await engine.start();
    now += 60_000;
    await engine.suspend("network_offline");
    assert.equal(engine.status().suspended, true);
    adapter.values.push(115); // This happened while Haolo had no coverage.
    now += 10 * 60_000;
    await engine.resumeMonitoring("network_offline");
    assert.equal((await store.listEvidence()).length, 0);
    const [gap] = await store.listGaps({ alertId: "gap-repeat" });
    assert.equal(gap.reason, "network_offline");
    assert.equal(gap.catchUpEvaluated, false);
    assert.equal((await store.getAlert("gap-repeat")).rearmState, "waiting_false");
    now += 3_600_000; adapter.emit(116, 3, "still-true-after-gap"); await engine.queue;
    assert.equal((await store.listEvidence()).length, 0);
    now += 3_600_000; adapter.emit(100, 4, "false-after-gap"); await engine.queue;
    now += 3_600_000; adapter.emit(115, 5, "new-edge-after-gap"); await engine.queue;
    assert.equal((await store.listEvidence()).length, 1);
    assert.equal(notifications.length, 1);
    await engine.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("shadow mode records immutable evidence but suppresses user notifications", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-shadow-"));
  try {
    let now = START + 2 * 3_600_000;
    const store = new TradingAlertStore({ dataDir, now: () => now });
    await createAlert(store, priceRule(), "shadow-alert");
    const adapter = new FakeAdapter([100, 105]);
    const hub = new TradingAlertMarketDataHub(); hub.registerAdapter(adapter);
    const notifications = [];
    const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => now, notify: async (value) => notifications.push(value), shadowMode: true, heartbeatMs: 100_000 });
    await engine.start();
    now += 3_600_000; adapter.emit(115, 2, "shadow-cross"); await engine.queue;
    const evidence = (await store.listEvidence())[0];
    assert.ok(evidence);
    assert.equal(notifications.length, 0);
    assert.equal(engine.status().shadowMode, true);
    const runtime = engine.runtimes.get("shadow-alert");
    const replay = new TradingAlertEvaluator().evaluate(runtime.alert.rule, {
      eventId: evidence.triggerEventId,
      time: evidence.triggeredAt,
      frames: structuredClone(runtime.variants[0].frames),
    });
    assert.equal(replay.value, true);
    assert.equal(replay.inputHash, evidence.inputHash);
    await engine.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("provider reconnect is a monitoring gap and refreshes history before rearming", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-provider-gap-"));
  try {
    let now = START + 2 * 3_600_000;
    const store = new TradingAlertStore({ dataDir, now: () => now });
    await createAlert(store, priceRule({ id: "provider-repeat", mode: "repeat" }), "provider-repeat");
    const adapter = new FakeAdapter([100, 105]);
    const hub = new TradingAlertMarketDataHub(); hub.registerAdapter(adapter);
    const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => now, heartbeatMs: 100_000 });
    await engine.start();
    adapter.health("reconnecting"); await engine.queue;
    adapter.values.push(115);
    now += 600_000;
    adapter.health("connected"); await engine.queue;
    assert.equal((await store.listEvidence()).length, 0);
    assert.equal((await store.listGaps({ alertId: "provider-repeat" }))[0].reason, "provider_disconnected");
    assert.equal((await store.getAlert("provider-repeat")).rearmState, "waiting_false");
    await engine.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("persisted drawing geometry is evaluated in the main process and captured as trigger evidence", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-drawing-"));
  try {
    let now = START + 2 * 3_600_000;
    const store = new TradingAlertStore({ dataDir, now: () => now });
    const rule = normalizeAlertRule({
      ...fixture,
      ruleId: "drawing-live",
      contexts: [{ ...fixture.contexts[0], drawingBinding: { drawingId: "line-live", drawingRevision: 1, marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1h", geometryMode: "extended" } }],
      root: { type: "condition", condition: { conditionId: "touch-live", contextId: "primary", operator: "touch", left: { type: "field", field: "close" }, right: { type: "drawing", drawingId: "line-live", output: "price_at_time" }, tolerance: { mode: "absolute", value: 0.01 }, confirmation: "bar_close" } },
      dataRequirements: [], ruleHash: undefined,
    });
    await createAlert(store, rule, "drawing-alert");
    await store.replaceDrawings({ marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1h", drawings: [{ drawingId: "line-live", revision: 1, geometryMode: "extended", points: [{ time: START, price: 110 }, { time: START + 10 * 3_600_000, price: 110 }] }] });
    const adapter = new FakeAdapter([100, 105]);
    const hub = new TradingAlertMarketDataHub(); hub.registerAdapter(adapter);
    const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => now, heartbeatMs: 100_000 });
    engine.syncDrawings(await store.listDrawings());
    await engine.start();
    now += 3_600_000; adapter.emit(110, 2, "drawing-touch"); await engine.queue;
    const [evidence] = await store.listEvidence({ alertId: "drawing-alert" });
    assert.equal(evidence.conditionResults[0].result, true);
    assert.equal(evidence.contexts[0].drawings[0].drawingId, "line-live");
    await engine.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
