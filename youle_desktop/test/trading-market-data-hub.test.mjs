import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { TradingMarketDataHub } from "../src/main/trading-market-data-hub.mjs";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];
  constructor(url, options = {}) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  open() { this.readyState = 1; this.emit("open"); }
  send(value) { this.sent.push(JSON.parse(value)); }
  ping() { this.emit("pong"); }
  close() { this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}

test("main-process market hub shares one ticketed socket and reference-counts streams", async () => {
  FakeWebSocket.instances = [];
  const endpoints = [];
  const hub = new TradingMarketDataHub({
    WebSocketImpl: FakeWebSocket,
    endpointProvider: async (params) => {
      endpoints.push(params);
      return "wss://market.haolo.example/stream/futures?ticket=one-use";
    },
  });
  const firstEvents = [];
  const secondEvents = [];
  const first = hub.subscribe(
    { marketType: "futures", streams: ["btcusdt@ticker", "btcusdt@aggTrade"] },
    (event) => firstEvents.push(event),
  );
  const second = hub.subscribe(
    { marketType: "futures", streams: ["btcusdt@ticker"] },
    (event) => secondEvents.push(event),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.deepEqual(endpoints, [{ marketType: "futures", combined: true }]);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.deepEqual(socket.sent[0].params.sort(), ["btcusdt@aggTrade", "btcusdt@ticker"]);
  socket.emit("message", JSON.stringify({ stream: "btcusdt@ticker", data: { e: "24hrTicker" } }));
  assert.equal(firstEvents.length, 1);
  assert.equal(secondEvents.length, 1);
  await second.dispose();
  assert.equal(socket.sent.some((command) => command.method === "UNSUBSCRIBE"), false);
  await first.dispose();
  assert.equal(hub.stats().subscriptions, 0);
  await hub.close();
});

test("main-process market hub validates its read-only public stream boundary", async () => {
  const hub = new TradingMarketDataHub({ endpointProvider: async () => "wss://example.invalid" });
  assert.throws(() => hub.subscribe({ marketType: "futures", streams: ["btcusdt@userData"] }, () => {}), /unsupported/);
  assert.throws(() => hub.subscribe({ marketType: "options", streams: ["btcusdt@ticker"] }, () => {}), /market type/);
  await hub.close();
});

test("main-process market hub reports an early direct socket failure for route fallback", async () => {
  FakeWebSocket.instances = [];
  const outcomes = [];
  const hub = new TradingMarketDataHub({
    WebSocketImpl: FakeWebSocket,
    reconnectBaseMs: 60_000,
    endpointProvider: async () => ({
      url: "wss://fstream.binance.com/stream",
      route: "direct",
      marketType: "futures",
    }),
    endpointFailureReporter: (outcome) => outcomes.push(outcome),
  });
  const subscription = hub.subscribe(
    { marketType: "futures", streams: ["btcusdt@ticker"] },
    () => {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.close();
  assert.equal(outcomes[0].outcome, "connected");
  assert.equal(outcomes[0].route, "direct");
  assert.equal(outcomes[1].outcome, "failed");
  assert.ok(outcomes[1].connectedDurationMs < 30_000);
  await subscription.dispose();
  await hub.close();
});

test("main-process market hub applies trusted DNS resolution only to gateway sockets", async () => {
  FakeWebSocket.instances = [];
  const lookup = () => {};
  const hub = new TradingMarketDataHub({
    WebSocketImpl: FakeWebSocket,
    endpointProvider: async () => ({
      url: "wss://market.dead.example/stream/futures?ticket=short",
      route: "gateway",
      marketType: "futures",
    }),
    lookupProvider: ({ route }) => route === "gateway" ? lookup : null,
  });
  const subscription = hub.subscribe(
    { marketType: "futures", streams: ["btcusdt@ticker"] },
    () => {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeWebSocket.instances[0].options.lookup, lookup);
  assert.equal(FakeWebSocket.instances[0].options.family, 4);
  await subscription.dispose();
  await hub.close();
});
