import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { windowTrafficActivity, watchTrafficWindow, aggregateTrafficActivity, encodeTrafficContext } from "../src/main/market-traffic-activity.mjs";
import { TradingMarketDataHub } from "../src/main/trading-market-data-hub.mjs";
import { BinancePublicMarketService } from "../src/main/binance-public-market-service.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";

test("large UTF-8 subscription sets cannot exceed the inbound socket limit", () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ stream: `${'龙'.repeat(35)}${i}@kline_1m`, activity: "foreground" }));
  const encoded = encodeTrafficContext(rows);
  assert.ok(Buffer.byteLength(encoded) < 48 * 1024);
  assert.ok(JSON.parse(encoded).streams.length < rows.length);
});

test("native visibility does not confuse unfocused, minimized, service and unknown", () => {
  const window = new EventEmitter();
  Object.assign(window, { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, isFocused: () => false });
  assert.equal(windowTrafficActivity(window), "foreground");
  window.isMinimized = () => true;
  assert.equal(windowTrafficActivity(window), "background");
  assert.equal(windowTrafficActivity(null), "unknown");
  assert.equal(aggregateTrafficActivity([null]), "service");
  assert.equal(aggregateTrafficActivity([() => "background", null]), "mixed");
  assert.equal(aggregateTrafficActivity([() => "foreground", () => "background"]), "mixed");
  let calls = 0;
  const stop = watchTrafficWindow(window, () => calls++);
  window.emit("restore"); stop(); window.emit("hide");
  assert.equal(calls, 1);
});

test("many subscriptions share one native listener and dispose independently", () => {
  const window = new EventEmitter();
  let calls = 0;
  const stops = Array.from({ length: 100 }, () => watchTrafficWindow(window, () => calls++));
  assert.equal(window.listenerCount("minimize"), 1);
  stops[0](); window.emit("minimize");
  assert.equal(calls, 99);
  stops.forEach(stop => stop());
  assert.equal(window.listenerCount("minimize"), 0);
});

test("REST tags only gateway requests; initiating consumer and deduplication remain intact", async () => {
  const config = resolveBinanceGatewayConfig({ HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.example" });
  const calls = [];
  const client = createBinanceGatewayClient({ config, apiClient: { getTrustedAccessToken: async () => "fixture" },
    fetchImpl: async (url, init) => { calls.push({ url, headers: new Headers(init.headers) }); return Response.json({ price: "100" }); } });
  const direct = new BinancePublicMarketService({ fetch: async (_url, init) => {
    assert.equal(new Headers(init.headers).has("x-haolo-market-activity"), false);
    return Response.json({ price: "100" });
  } });
  const viaGateway = new BinancePublicMarketService({ fetch: (url, init) => {
    const upstream = new URL(url);
    return client.fetch(new URL(upstream.pathname + upstream.search, config.marketOrigin).href, init);
  } });
  const params = { marketType: "futures", path: "/fapi/v1/ticker/24hr", parameters: { symbol: "BTCUSDT" } };
  const foreground = viaGateway.request(params, { activity: "foreground" });
  const background = viaGateway.request(params, { activity: "background" });
  const response = await foreground;
  assert.equal(response.ok, true);
  assert.deepEqual(response, await background);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get("x-haolo-market-activity"), "foreground");
  assert.equal((await direct.request(params, { activity: "background" })).ok, true);
  await direct.close(); await viaGateway.close();
});

test("telemetry is never sent to direct Binance or non-advertising legacy gateway", async () => {
  for (const route of ["direct", "gateway"]) {
    let socket;
    class WS extends EventEmitter {
      static OPEN = 1;
      constructor() { super(); socket = this; this.readyState = 0; this.sent = []; }
      send(value) { this.sent.push(JSON.parse(value)); }
      close() { this.readyState = 3; this.emit("close"); }
      terminate() { this.close(); }
    }
    const hub = new TradingMarketDataHub({ WebSocketImpl: WS, endpointProvider: async () => ({ route, url: "wss://example.invalid/ws" }) });
    const sub = hub.subscribe({ marketType: "futures", streams: ["btcusdt@aggTrade"], activityProvider: () => "background" }, () => {});
    await new Promise(resolve => setImmediate(resolve));
    if (route === "direct") socket.emit("upgrade", { headers: { "x-haolo-traffic-telemetry": "1" } });
    socket.readyState = 1; socket.emit("open");
    socket.emit("message", JSON.stringify({ id: socket.sent[0].id, result: null }));
    sub.refreshActivity();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(socket.sent.map(x => x.method), ["SUBSCRIBE"]);
    await hub.close();
  }
});
