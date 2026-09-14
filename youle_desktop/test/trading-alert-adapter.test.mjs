import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TradingAlertDataAdapterRegistry, createMockExternalDataAdapter, normalizeDataAdapterManifest, validateAdapterSamples } from "../src/main/trading-alerts/data-adapter.mjs";
import { createHyperliquidMarketAdapter } from "../src/main/trading-alerts/hyperliquid-market-adapter.mjs";
import { TradingAlertEvaluator } from "../src/main/trading-alerts/evaluator.mjs";
import { TradingAlertCapabilityRegistry, resolveRuleCapabilities } from "../src/main/trading-alerts/capabilities.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { planRuleSubscriptions } from "../src/main/trading-alerts/subscription-planner.mjs";

const fixture = normalizeAlertRule(JSON.parse(await readFile(new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url), "utf8")));

test("adapter manifests are versioned and discovery is not confused with executable connectivity", () => {
  const mock = createMockExternalDataAdapter();
  const registry = new TradingAlertDataAdapterRegistry();
  const discovered = registry.register({ manifest: { ...mock.manifest, adapterId: "discovered-only", connectionState: "connected" }, discoveredBy: "plugin" });
  const executable = registry.register({ manifest: mock.manifest, adapter: mock, discoveredBy: "builtin" });
  assert.equal(discovered.installed, true);
  assert.equal(discovered.executable, false);
  assert.equal(discovered.connected, false);
  assert.equal(executable.connected, true);
  assert.equal(registry.executable("mock-chain"), mock);
  assert.throws(() => normalizeDataAdapterManifest({ ...mock.manifest, secret: "must-not-be-accepted" }), /unknown field/);
});

test("adapter sample validator fails closed on future timestamps, nulls, duplicates and latency", () => {
  const invalid = validateAdapterSamples([
    { eventId: "same", eventTime: 1_000, receivedAt: 50_000, fields: { flow: null } },
    { eventId: "same", eventTime: 60_000, receivedAt: 50_000, fields: { flow: 1 } },
  ], { now: 50_000, maxLatencyMs: 5_000 });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.duplicateCount, 1);
  assert.equal(invalid.nullCount, 1);
  assert.ok(invalid.errors.length >= 3);
});

test("Hyperliquid public adapter uses the official candle request and subscription contracts", async () => {
  const requests = [];
  class FakeSocket extends EventEmitter {
    static OPEN = 1; static CONNECTING = 0;
    constructor(url) { super(); this.url = url; this.readyState = 1; this.sent = []; queueMicrotask(() => this.emit("open")); FakeSocket.last = this; }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
  }
  const adapter = createHyperliquidMarketAdapter({
    now: () => 2_000_000,
    WebSocketImpl: FakeSocket,
    fetchImpl: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, async json() { return [{ t: 1_000_000, T: 1_059_999, o: "100", h: "102", l: "99", c: "101", v: "5" }]; } }; },
  });
  const subscription = { providerId: "hyperliquid-public", marketId: "HYPERLIQUID:PERPETUAL:BTC", interval: "1m", fields: ["ohlcv"] };
  const history = await adapter.loadHistory(subscription, 100);
  assert.equal(requests[0].url, "https://api.hyperliquid.xyz/info");
  assert.equal(requests[0].body.type, "candleSnapshot");
  assert.equal(requests[0].body.req.coin, "BTC");
  assert.equal(history[0].close, 101);
  const events = [];
  const dispose = await adapter.subscribe(subscription, (event) => events.push(event));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(FakeSocket.last.sent[0], { method: "subscribe", subscription: { type: "candle", coin: "BTC", interval: "1m" } });
  FakeSocket.last.emit("message", JSON.stringify({ channel: "candle", data: { t: 1_000_000, T: 1_059_999, o: "100", h: "102", l: "99", c: "101", v: "5" } }));
  FakeSocket.last.emit("message", JSON.stringify({ channel: "candle", data: { t: 1_060_000, T: 1_119_999, o: "101", h: "103", l: "100", c: "102", v: "6" } }));
  assert.equal(events.some((entry) => entry.closed === true), true);
  await dispose();
  const rule = normalizeAlertRule({ ...fixture, contexts: [{ contextId: "primary", marketSelector: { kind: "fixed", marketIds: ["HYPERLIQUID:PERPETUAL:BTC"] }, intervals: ["1m"] }], ruleHash: undefined });
  assert.equal(planRuleSubscriptions(rule)[0].providerId, "hyperliquid-public");
});

test("missing external data can connect later and the deterministic evaluator consumes validated values", () => {
  const externalRule = normalizeAlertRule({
    ...fixture,
    root: { type: "condition", condition: { conditionId: "flow", contextId: "primary", operator: "gt", left: { type: "external", capability: "chain.whale_flow", field: "net_inflow", params: {}, version: "1" }, right: { type: "constant", value: 1_000 }, confirmation: "intrabar" } },
    evaluationPolicy: { ...fixture.evaluationPolicy, clock: "mixed" },
    dataRequirements: [], ruleHash: undefined,
  });
  const registry = new TradingAlertCapabilityRegistry([{ capabilityId: "chain.whale_flow", providerId: "user-chain-api", displayName: "用户链上接口", fields: ["net_inflow"], markets: ["*"], permission: "public", connectionState: "disconnected", maxHistoryWindow: 10_000 }]);
  assert.equal(resolveRuleCapabilities(externalRule, registry).ready, false);
  assert.equal(registry.setConnection("user-chain-api", "connected"), 1);
  assert.equal(resolveRuleCapabilities(externalRule, registry).ready, true);
  const evaluator = new TradingAlertEvaluator();
  const base = { candles: [{ time: 1_000, closeTime: 2_000, open: 100, high: 101, low: 99, close: 100, volume: 1 }], receivedAt: 2_000, closed: false, coverage: "available" };
  const before = evaluator.evaluate(externalRule, { eventId: "flow-before", time: 2_000, frames: { primary: { ...base, external: { "chain.whale_flow.net_inflow": 900 } } } });
  const after = evaluator.evaluate(externalRule, { eventId: "flow-after", time: 2_001, frames: { primary: { ...base, receivedAt: 2_001, external: { "chain.whale_flow.net_inflow": 1_100 } } } });
  assert.equal(before.value, false);
  assert.equal(after.value, true);
});

test("Hyperliquid history deadline covers a stalled body without replaying its POST", async () => {
  let calls = 0;
  let requestSignal;
  const adapter = createHyperliquidMarketAdapter({
    historyTimeoutMs: 20,
    fetchImpl: async (_url, options) => {
      calls++;
      requestSignal = options.signal;
      return { ok: true, json: () => calls === 1 ? new Promise(() => {}) : Promise.resolve([]) };
    },
  });
  const subscription = { marketId: "HYPERLIQUID:PERPETUAL:BTC", interval: "1m" };
  // Keep the event loop active while the production deadline is unref'ed.
  const alive = setTimeout(() => {}, 1_000);
  try {
    await assert.rejects(adapter.loadHistory(subscription), { name: "AbortError" });
    assert.equal(calls, 1);
    assert.equal(requestSignal.aborted, true);
    assert.deepEqual(await adapter.loadHistory(subscription), []);
    assert.equal(calls, 2);
  } finally { clearTimeout(alive); }
});

test("Hyperliquid stalled handshake reconnects and ignores failed-socket events after replacement or disposal", async () => {
  const sockets = [];
  class FakeSocket extends EventEmitter {
    static OPEN = 1; static CONNECTING = 0;
    constructor(_url, options) { super(); this.options = options; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    terminate() { this.readyState = 3; this.emit("close"); }
  }
  const adapter = createHyperliquidMarketAdapter({ WebSocketImpl: FakeSocket, handshakeTimeoutMs: 30, reconnectBaseMs: 10 });
  const events = [];
  const health = [];
  const dispose = await adapter.subscribe({ marketId: "HYPERLIQUID:PERPETUAL:BTC", interval: "1m" }, e => events.push(e), h => health.push(h));
  try {
    const expires = Date.now() + 500;
    while (sockets.length < 2 && Date.now() < expires) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(sockets.length, 2);
    assert.equal(sockets[0].readyState, 3);
    assert.equal(sockets[1].options.handshakeTimeout, 30);
    sockets[1].readyState = FakeSocket.OPEN;
    sockets[1].emit("open");
    sockets[0].emit("open");
    sockets[0].emit("error", new Error("late old failure"));
    sockets[0].emit("close");
    const candle = JSON.stringify({ channel: "candle", data: { t: 1_000, T: 59_999, o: "1", h: "2", l: "1", c: "2", v: "5" } });
    sockets[0].emit("message", candle);
    assert.equal(events.length, 0);
    sockets[1].emit("message", candle);
    assert.equal(events.length, 1);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(sockets.length, 2, "open cleared the deadline and old close did not create another retry");
    assert.equal(sockets[1].sent.length, 1);
    await dispose();
    sockets[1].emit("open");
    sockets[1].emit("message", candle);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(sockets.length, 2);
    assert.equal(events.length, 1);
    assert.equal(health.filter(h => h.status === "reconnecting").length, 1);
  } finally { await dispose(); }
});
