import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { TradingMarketDataHub } from "../src/main/trading-market-data-hub.mjs";

class Socket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];
  constructor() { super(); this.readyState = 0; this.sent = []; Socket.instances.push(this); }
  open() { this.readyState = 1; this.emit("open"); }
  send(value) { this.sent.push(JSON.parse(value)); }
  ack(index = this.sent.length - 1, error = null) {
    this.emit("message", JSON.stringify({ id: this.sent[index].id, ...(error || { result: null }) }));
  }
  ping() { this.emit("pong"); }
  close() { this.readyState = 2; }
  finish() { this.readyState = 3; this.emit("close"); }
  terminate() { this.finish(); }
}
const next = () => new Promise(resolve => setImmediate(resolve));
function setup(t, options = {}) {
  Socket.instances = [];
  const hub = new TradingMarketDataHub({ WebSocketImpl: Socket, idleCloseMs: 40, closeTimeoutMs: 30,
    subscriptionAckTimeoutMs: 50, reconnectBaseMs: 100,
    endpointProvider: async () => ({ url: "wss://market.example/stream/futures?ticket=secret", route: "gateway" }), ...options });
  t.after(() => hub.close());
  return hub;
}
const subscribe = (hub, onHealth = () => {}, stream = "btcusdt@ticker", onEvent = () => {}) =>
  hub.subscribe({ marketType: "futures", streams: [stream] }, onEvent, onHealth);

test("chart replacement reuses a socket while removed listeners stop immediately", async t => {
  const hub = setup(t); let stale = 0, current = 0;
  const first = subscribe(hub, undefined, "btcusdt@ticker", () => stale++);
  await next(); const socket = Socket.instances[0]; socket.open(); socket.ack();
  await first.dispose();
  const replacement = subscribe(hub, undefined, "btcusdt@ticker", () => current++);
  await next();
  assert.equal(Socket.instances.length, 1, "unsubscribe/subscribe must not overlap closing sockets");
  socket.emit("message", JSON.stringify({ stream: "btcusdt@ticker", data: { c: "123.000" } }));
  assert.equal(stale, 0); assert.equal(current, 1);
  await replacement.dispose();
});

test("a subscription arriving during close waits for physical release", async t => {
  const hub = setup(t, { idleCloseMs: 10, closeTimeoutMs: 150 });
  const first = subscribe(hub); await next(); const socket = Socket.instances[0]; socket.open(); socket.ack();
  await first.dispose(); await delay(20); assert.equal(socket.readyState, 2);
  subscribe(hub); await next();
  assert.equal(Socket.instances.length, 1);
  socket.finish(); await next();
  assert.equal(Socket.instances.length, 2);
});

test("connected health requires subscription acknowledgement and command errors recover", async t => {
  const health = []; const hub = setup(t);
  subscribe(hub, event => health.push(event)); await next();
  const socket = Socket.instances[0]; socket.open();
  assert.equal(health.some(e => e.status === "connected"), false);
  socket.ack(0, { code: 2, msg: "subscription limit exceeded" });
  assert(health.some(e => e.reason === "subscription_rejected"));
  assert.equal(socket.readyState, 2);
});

test("a lost subscription acknowledgement cannot leave an apparently healthy stream", async t => {
  const hub = setup(t); const health = [];
  subscribe(hub, e => health.push(e)); await next(); const socket = Socket.instances[0]; socket.open();
  await delay(65);
  assert(health.some(e => e.reason === "subscription_ack_timeout"));
  assert.equal(health.some(e => e.status === "connected"), false);
});

test("new consumers cannot bypass a pending 429 reconnect cooldown or invalidate DNS", async t => {
  const invalidations = [], health = [];
  const lookup = () => {}; lookup.invalidate = (...args) => invalidations.push(args);
  const hub = setup(t, { lookupProvider: () => lookup });
  subscribe(hub, e => health.push(e)); await next(); const socket = Socket.instances[0];
  let destroyed = false;
  socket.emit("unexpected-response", {}, { statusCode: 429, headers: { "retry-after": "1", "x-haolo-error-code": "WS_USER_CONNECTION_LIMIT" }, destroy() { destroyed = true; } });
  socket.finish();
  subscribe(hub, undefined, "ethusdt@ticker"); await next();
  assert.equal(Socket.instances.length, 1);
  assert.deepEqual(invalidations, []);
  assert.equal(destroyed, true);
  assert(health.some(e => e.reason === "WS_USER_CONNECTION_LIMIT"));
});

test("reconnect uses a fresh endpoint, restores current streams only and awaits acknowledgement", async t => {
  let tickets = 0; const health = [], events = [];
  const hub = setup(t, { reconnectBaseMs: 10, endpointProvider: async () => `wss://example.test/stream?ticket=${++tickets}` });
  const btc = subscribe(hub, e => health.push(e), "btcusdt@ticker", e => events.push(e));
  subscribe(hub, e => health.push(e), "ethusdt@ticker", e => events.push(e));
  await next(); const first = Socket.instances[0]; first.open(); first.ack();
  first.finish(); await btc.dispose(); await delay(20);
  const second = Socket.instances[1]; assert.equal(tickets, 2); second.open();
  assert.deepEqual(second.sent[0].params, ["ethusdt@ticker"]);
  const before = health.filter(e => e.status === "connected").length;
  second.ack(); assert(health.filter(e => e.status === "connected").length > before);
  first.emit("message", JSON.stringify({ stream: "ethusdt@ticker", data: { c: "old" } }));
  second.emit("message", JSON.stringify({ stream: "ethusdt@ticker", data: { c: "1.2300" } }));
  assert.deepEqual(events.map(e => e.data.c), ["1.2300"]);
});

test("hub shutdown awaits socket release and does not recreate pending subscriptions", async t => {
  const hub = setup(t); subscribe(hub); await next(); const socket = Socket.instances[0]; socket.open(); socket.ack();
  await hub.close();
  assert.equal(socket.readyState, 3);
  assert.deepEqual(hub.stats(), { channels: 0, subscriptions: 0, streams: 0, sockets: 0 });
  await delay(120); assert.equal(Socket.instances.length, 1);
});
