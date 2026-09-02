import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { TradingAlertMarketDataHub } from "../src/main/trading-alerts/market-data-hub.mjs";
import { createBinanceMarketAdapter, planBinanceInterval } from "../src/main/trading-alerts/binance-market-adapter.mjs";

const subscription = { providerId: "mock", marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1m", fields: ["ohlcv"] };
const candle = (time, close = 100) => ({ time, closeTime: time + 60_000, open: close, high: close + 1, low: close - 1, close, volume: 10 });

test("data hub shares one physical subscription and suppresses duplicate events and duplicate closes", async () => {
  let physicalSubscriptions = 0;
  let publish;
  const hub = new TradingAlertMarketDataHub();
  hub.registerAdapter({
    providerId: "mock",
    async loadHistory() { return [candle(1_700_000_000_000)]; },
    async subscribe(_request, listener) { physicalSubscriptions += 1; publish = listener; return async () => {}; },
  });
  const first = [], second = [];
  const disposeFirst = await hub.subscribe(subscription, (event) => first.push(event));
  const disposeSecond = await hub.subscribe(subscription, (event) => second.push(event));
  assert.equal(physicalSubscriptions, 1);
  const event = { eventId: "same", candle: candle(1_700_000_060_000, 101), closed: true, receivedAt: 1_700_000_120_000 };
  publish(event);
  publish(event);
  publish({ ...event, eventId: "different-close-id" });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(hub.stats().duplicates, 2);
  await disposeFirst();
  assert.equal(hub.stats().subscriptions, 1);
  await disposeSecond();
  assert.equal(hub.stats().subscriptions, 0);
});

test("late and gapped candles are retained for audit but fail closed for evaluation", async () => {
  const hub = new TradingAlertMarketDataHub();
  let publish;
  hub.registerAdapter({
    providerId: "mock",
    async loadHistory() { return [candle(1_700_000_000_000)]; },
    async subscribe(_request, listener) { publish = listener; return async () => {}; },
  });
  await hub.loadHistory(subscription);
  const rows = [];
  await hub.subscribe(subscription, (event) => rows.push(event));
  publish({ eventId: "future-gap", candle: candle(1_700_000_180_000), closed: true, eventTime: 1_700_000_240_000, receivedAt: 1_700_000_240_000 });
  publish({ eventId: "late", candle: candle(1_700_000_060_000), closed: true, eventTime: 1_700_000_120_000, receivedAt: 1_700_000_250_000 });
  assert.equal(rows[0].coverage, "partial");
  assert.equal(rows[1].coverage, "delayed");
  assert.equal(hub.stats().gaps, 1);
  assert.equal(hub.stats().late, 1);
});

test("simulation history can seed the hub and avoids a second provider history request", async () => {
  const hub = new TradingAlertMarketDataHub();
  let historyRequests = 0;
  hub.registerAdapter({
    providerId: "mock",
    async loadHistory() { historyRequests += 1; throw new Error("provider should not be called"); },
    async subscribe() { return async () => {}; },
  });
  hub.seedHistory(subscription, [candle(1_700_000_000_000), candle(1_700_000_060_000, 101)]);
  const rows = await hub.loadHistory(subscription, 500);
  assert.equal(historyRequests, 0);
  assert.deepEqual(rows.map((row) => row.close), [100, 101]);
});

test("concurrent alert history warmups share one physical provider request", async () => {
  const hub = new TradingAlertMarketDataHub();
  let historyRequests = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  hub.registerAdapter({
    providerId: "mock",
    async loadHistory() {
      historyRequests += 1;
      await gate;
      return [candle(1_700_000_000_000), candle(1_700_000_060_000, 101)];
    },
    async subscribe() { return async () => {}; },
  });
  const first = hub.loadHistory(subscription, 500);
  const second = hub.loadHistory(subscription, 500);
  await Promise.resolve();
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(historyRequests, 1);
  assert.deepEqual(left, right);
  assert.equal(hub.stats().historyLoads, 1);
  assert.equal(hub.stats().historyCoalesced, 1);
});

test("Binance adapter plans and aggregates custom intervals instead of requesting an invalid stream", async () => {
  assert.deepEqual(planBinanceInterval("7m"), {
    interval: "7m", sourceInterval: "1m", sourceMs: 60_000, targetMs: 420_000, aggregate: true,
  });
  let requestedUrl = "";
  const start = 1_700_000_100_000;
  const rows = Array.from({ length: 14 }, (_, index) => {
    const open = 100 + index;
    return [start + index * 60_000, String(open), String(open + 2), String(open - 1), String(open + 1), "10", start + (index + 1) * 60_000 - 1];
  });
  const adapter = createBinanceMarketAdapter({
    fetchImpl: async (url) => { requestedUrl = String(url); return { ok: true, async json() { return rows; } }; },
  });
  const history = await adapter.loadHistory({ marketId: "BINANCE:FUTURES:BTCUSDT", interval: "7m" }, 20);
  assert.match(requestedUrl, /interval=1m/);
  assert.equal(history.length, 3);
  assert.ok(history.every((item) => item.closeTime - item.time === 420_000));
});

test("Binance history transport failures are retryable structured errors", async () => {
  const adapter = createBinanceMarketAdapter({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(
    () => adapter.loadHistory({ marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15m" }, 2),
    (error) => error?.code === "TRADING_ALERT_MARKET_HISTORY_FAILED"
      && error?.category === "transport"
      && error?.retryable === true
      && /fetch failed/.test(error.message),
  );
});

test("Binance history treats shared 429 cooldown responses as retryable", async () => {
  const adapter = createBinanceMarketAdapter({
    fetchImpl: async () => new Response("{}", { status: 429, headers: { "retry-after": "45" } }),
  });
  await assert.rejects(
    () => adapter.loadHistory({ marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15m" }, 2),
    (error) => error?.code === "TRADING_ALERT_MARKET_RATE_LIMITED"
      && error?.retryable === true
      && error?.details?.retryAfterMs === 45_000,
  );
});

test("Binance live alerts multiplex futures streams over one WebSocket", async () => {
  class FakeWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static instances = [];
    constructor(url) {
      super();
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      FakeWebSocket.instances.push(this);
    }
    send(value) { this.sent.push(JSON.parse(value)); }
    open() { this.readyState = FakeWebSocket.OPEN; this.emit("open"); }
    message(value) { this.emit("message", JSON.stringify(value)); }
    close() { this.readyState = 3; this.emit("close"); }
  }

  const adapter = createBinanceMarketAdapter({ WebSocketImpl: FakeWebSocket });
  const btcEvents = [];
  const ethEvents = [];
  const disposeBtc = await adapter.subscribe(
    { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1m" },
    (event) => btcEvents.push(event),
  );
  const disposeEth = await adapter.subscribe(
    { marketId: "BINANCE:FUTURES:ETHUSDT", interval: "5m" },
    (event) => ethEvents.push(event),
  );
  assert.equal(FakeWebSocket.instances.length, 1);
  const socket = FakeWebSocket.instances[0];
  assert.equal(socket.url, "wss://fstream.binance.com/ws");
  socket.open();
  assert.deepEqual(socket.sent[0].params.sort(), ["btcusdt@kline_1m", "ethusdt@kline_5m"]);

  socket.message({ E: 1_700_000_060_000, k: { s: "BTCUSDT", i: "1m", t: 1_700_000_000_000, T: 1_700_000_059_999, o: "100", h: "102", l: "99", c: "101", v: "10", x: true } });
  assert.equal(btcEvents.length, 1);
  assert.equal(ethEvents.length, 0);
  assert.equal(btcEvents[0].source, "binance-websocket");

  await disposeBtc();
  assert.equal(socket.readyState, FakeWebSocket.OPEN);
  await disposeEth();
  assert.equal(socket.readyState, 3);
});

test("Binance live alerts reuse the main-process TradingMarketDataHub in gateway mode", async () => {
  let hubSubscription;
  let disposed = false;
  const streamHub = {
    subscribe(params, onEvent, onHealth) {
      hubSubscription = { params, onEvent, onHealth };
      return { dispose: async () => { disposed = true; } };
    },
  };
  const adapter = createBinanceMarketAdapter({ streamHub });
  const events = [];
  const health = [];
  const dispose = await adapter.subscribe(
    { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1m" },
    (event) => events.push(event),
    (event) => health.push(event),
  );
  assert.deepEqual(hubSubscription.params, {
    marketType: "futures",
    streams: ["btcusdt@kline_1m"],
  });
  hubSubscription.onHealth({ status: "connected", at: 1 });
  hubSubscription.onEvent({
    type: "data",
    data: { E: 1_700_000_060_000, k: { s: "BTCUSDT", i: "1m", t: 1_700_000_000_000, T: 1_700_000_059_999, o: "100", h: "102", l: "99", c: "101", v: "10", x: true } },
  });
  assert.equal(health[0].status, "connected");
  assert.equal(events.length, 1);
  assert.equal(events[0].closed, true);
  await dispose();
  assert.equal(disposed, true);
});
