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

test("route migration drops stale frames, preserves subscriptions and does not penalize a healthy gateway", async (t) => {
  FakeWebSocket.instances = [];
  const invalidated = [], outcomes = [], frames = [], health = [];
  const lookup = () => {};
  lookup.invalidate = (...args) => invalidated.push(args);
  let tickets = 0, resolveTicket;
  const hub = new TradingMarketDataHub({ WebSocketImpl: FakeWebSocket, reconnectBaseMs: 10,
    endpointProvider: async () => {
      const ticket = ++tickets;
      if (ticket === 3) await new Promise((resolve) => { resolveTicket = resolve; });
      return { url: `wss://market.youle.pro/stream?ticket=${ticket}`, route: "gateway" };
    },
    lookupProvider: () => lookup,
    endpointFailureReporter: (outcome) => outcomes.push(outcome),
  });
  t.after(() => hub.close());
  const sub = hub.subscribe({ marketType: "futures", streams: ["btcusdt@ticker"] }, (event) => frames.push(event), (event) => health.push(event));
  await new Promise((resolve) => setImmediate(resolve));
  const old = FakeWebSocket.instances[0]; old.open();
  const frame = JSON.stringify({ stream: "btcusdt@ticker", data: { c: "1" } });
  old.emit("message", frame);
  old.emit("haolo-route-change");
  old.emit("message", frame);
  assert.equal(frames.length, 1, "frames arriving after route invalidation are stale");
  old.close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const replacement = FakeWebSocket.instances[1]; replacement.open();
  assert.match(replacement.url, /ticket=2$/);
  assert.deepEqual(replacement.sent[0].params, ["btcusdt@ticker"]);
  old.emit("message", frame);
  replacement.emit("message", frame);
  assert.equal(frames.length, 2);
  assert.deepEqual(invalidated, []);
  assert.deepEqual(outcomes.map((outcome) => outcome.outcome), ["connected", "connected"]);
  assert.ok(health.some((event) => event.status === "reconnecting" && event.reason === "network_route_changed"));
  replacement.emit("haolo-route-change"); replacement.close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(typeof resolveTicket, "function");
  await sub.dispose(); resolveTicket();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeWebSocket.instances.length, 2, "a late ticket must not recreate a disposed channel");
  assert.equal(hub.stats().subscriptions, 0);
});

test("stalled gateway handshake invalidates its route and reconnects with a fresh ticket", async () => {
  FakeWebSocket.instances = [];
  const invalidated = [];
  let tickets = 0;
  const lookup = (_host, _options, callback) => callback(null, "203.0.113.5", 4);
  lookup.invalidate = (...args) => invalidated.push(args);
  class ResolvingWebSocket extends FakeWebSocket {
    constructor(url, options) {
      super(url, options);
      options.lookup(new URL(url).hostname, { family: 4 }, () => {});
    }
  }
  const hub = new TradingMarketDataHub({ WebSocketImpl: ResolvingWebSocket,
    handshakeTimeoutMs: 250, reconnectBaseMs: 10,
    endpointProvider: async () => ({ url: `wss://market.example/stream/futures?ticket=${++tickets}`, route: "gateway" }),
    lookupProvider: () => lookup,
  });
  const sub = hub.subscribe({ marketType: "futures", streams: ["btcusdt@ticker"] }, () => {});
  try {
    await new Promise((r) => setTimeout(r, 320));
    assert.ok(tickets >= 2);
    assert.equal(FakeWebSocket.instances[0].options.handshakeTimeout, 250);
    assert.deepEqual(invalidated[0], ["market.example", "203.0.113.5"]);
    const last = FakeWebSocket.instances.at(-1);
    assert.notEqual(last.url, FakeWebSocket.instances[0].url);
    last.open();
    const count = invalidated.length;
    await sub.dispose();
    assert.equal(invalidated.length, count, "ordinary disposal must not evict a healthy route");
  } finally { await hub.close(); }
});

test("gateway disconnect passes the actual failed peer to route recovery", async () => {
  FakeWebSocket.instances = [];
  const invalidated = [];
  const lookup = () => {};
  lookup.invalidate = (...args) => invalidated.push(args);
  const hub = new TradingMarketDataHub({ WebSocketImpl: FakeWebSocket,
    endpointProvider: async () => ({ url: "wss://market.example/stream/futures?ticket=one", route: "gateway" }),
    lookupProvider: () => lookup,
  });
  const sub = hub.subscribe({ marketType: "futures", streams: ["btcusdt@ticker"] }, () => {});
  try {
    await new Promise((r) => setImmediate(r));
    const socket = FakeWebSocket.instances[0];
    socket._socket = { remoteAddress: "203.0.113.5" };
    socket.open();socket.close();
    assert.deepEqual(invalidated, [["market.example", "203.0.113.5"]]);
  } finally { await sub.dispose();await hub.close(); }
});

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
  assert.deepEqual(endpoints, [{ marketType: "futures", combined: true, streamClass: "market" }]);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.deepEqual(socket.sent[0].params.sort(), ["btcusdt@aggTrade", "btcusdt@ticker"]);
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(socket.sent.filter((command) => command.method === "SUBSCRIBE").length, 1);
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
  const hanSymbol = hub.subscribe({ marketType: "futures", streams: ["龙虾usdt@ticker"] }, () => {});
  assert.throws(() => hub.subscribe({ marketType: "futures", streams: ["btcusdt@userData"] }, () => {}), /unsupported/);
  assert.throws(() => hub.subscribe({ marketType: "futures", streams: ["龙虾/usdt@ticker"] }, () => {}), /unsupported/);
  assert.throws(() => hub.subscribe({ marketType: "options", streams: ["btcusdt@ticker"] }, () => {}), /market type/);
  await hanSymbol.dispose();
  await hub.close();
});

test("main-process market hub keeps Futures public and market stream classes on separate sockets", async () => {
  FakeWebSocket.instances = [];
  const endpoints = [];
  const hub = new TradingMarketDataHub({
    WebSocketImpl: FakeWebSocket,
    endpointProvider: async (params) => {
      endpoints.push(params);
      return `wss://fstream.binance.com/${params.streamClass}/stream`;
    },
  });
  const subscription = hub.subscribe(
    { marketType: "futures", streams: ["btcusdt@aggTrade", "btcusdt@bookTicker"] },
    () => {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.deepEqual(endpoints.map((entry) => entry.streamClass).sort(), ["market", "public"]);
  assert.deepEqual(
    FakeWebSocket.instances.map((socket) => socket.url).sort(),
    ["wss://fstream.binance.com/market/stream", "wss://fstream.binance.com/public/stream"],
  );
  await subscription.dispose();
  await hub.close();
});

test("main-process market hub reports an early direct socket failure for route fallback", async () => {
  FakeWebSocket.instances = [];
  const outcomes = [];
  const hub = new TradingMarketDataHub({
    WebSocketImpl: FakeWebSocket,
    reconnectBaseMs: 60_000,
    endpointProvider: async () => ({
      url: "wss://fstream.binance.com/market/stream",
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
