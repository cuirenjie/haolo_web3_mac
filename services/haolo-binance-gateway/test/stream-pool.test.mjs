import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { BinanceStreamPool, streamClassForName, validateStreamName } from "../src/stream-pool.mjs";
import { baseConfig } from "./helpers.mjs";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  open() { this.readyState = 1; this.emit("open"); }
  send(payload) { this.sent.push(JSON.parse(String(payload))); }
  close() { this.readyState = 3; this.emit("close"); }
  pong() {}
}

test("stream pool multiplexes listeners over one Binance socket and unwraps combined events", async () => {
  FakeWebSocket.instances.length = 0;
  const config = baseConfig();
  const pool = new BinanceStreamPool({ config, WebSocketImpl: FakeWebSocket });
  const events = [];
  const disposeA = pool.subscribe("futures", "btcusdt@kline_1m", (event) => events.push(event));
  const disposeB = pool.subscribe("futures", "ethusdt@ticker", (event) => events.push(event));
  assert.equal(FakeWebSocket.instances.length, 1);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.deepEqual(socket.sent[0].params.sort(), ["btcusdt@kline_1m", "ethusdt@ticker"]);
  socket.emit("message", JSON.stringify({ stream: "btcusdt@kline_1m", data: { e: "kline" } }));
  assert.equal(events.length, 1);
  assert.equal(events[0].stream, "btcusdt@kline_1m");
  disposeA();
  disposeB();
  assert.deepEqual(pool.stats(), { messages: 1, reconnects: 0, upstreamSockets: 0, subscriptions: 0, markets: 0 });
  await pool.close();
});

test("stream pool rejects private, malformed and unsupported stream names", () => {
  assert.equal(validateStreamName("btcusdt@aggTrade"), "btcusdt@aggTrade");
  assert.throws(() => validateStreamName("btcusdt@userData"), /unsupported/);
  assert.throws(() => validateStreamName("../../etc@ticker"), /unsupported/);
});

test("stream pool routes Futures bookTicker to the public base separately from market streams", () => {
  FakeWebSocket.instances.length = 0;
  const pool = new BinanceStreamPool({ config: baseConfig(), WebSocketImpl: FakeWebSocket });
  assert.equal(streamClassForName("btcusdt@bookTicker"), "public");
  const disposeMarket = pool.subscribe("futures", "btcusdt@aggTrade", () => {});
  const disposePublic = pool.subscribe("futures", "btcusdt@bookTicker", () => {});
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.equal(pool.stats().markets, 1);
  assert.equal(FakeWebSocket.instances[0].url, "wss://fstream.binance.com/market/stream");
  assert.equal(FakeWebSocket.instances[1].url, "wss://fstream.binance.com/public/stream");
  disposeMarket();
  disposePublic();
});
