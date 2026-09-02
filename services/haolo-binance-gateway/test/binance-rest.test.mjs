import assert from "node:assert/strict";
import test from "node:test";
import { BinanceRestGateway, MarketGatewayError, resolvePublicMarketRequest } from "../src/binance-rest.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { baseConfig } from "./helpers.mjs";

test("public market routes are strictly allowlisted and normalized", () => {
  const config = baseConfig();
  const route = resolvePublicMarketRequest("/api/market/v1/binance/futures/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500", config);
  assert.equal(route.marketType, "futures");
  assert.equal(route.upstream.origin, "https://fapi.binance.com");
  assert.equal(route.upstream.pathname, "/fapi/v1/klines");
  assert.equal(route.weight, 5);
  const unicodeRoute = resolvePublicMarketRequest("/fapi/v1/klines?symbol=%E9%BE%99%E8%99%BEUSDT&interval=1m&limit=2", config);
  assert.equal(unicodeRoute.upstream.searchParams.get("symbol"), "龙虾USDT");
  assert.throws(() => resolvePublicMarketRequest("/fapi/v1/order?symbol=BTCUSDT", config), /not allowed/);
  assert.throws(() => resolvePublicMarketRequest("/fapi/v1/klines?symbol=../../etc&interval=1m", config), /invalid symbol/);
  assert.throws(() => resolvePublicMarketRequest("/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=9999", config), /invalid limit/);
});

test("REST gateway coalesces and caches identical requests", async () => {
  const config = baseConfig();
  const cache = new GatewayCache();
  let calls = 0;
  let admissions = 0;
  const gateway = new BinanceRestGateway({
    config,
    cache,
    fetchImpl: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify([[1, "1", "2", "0.5", "1.5", "10", 2]]), { status: 200 });
    },
  });
  const url = "/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=2";
  const options = { beforeUpstream(route) { admissions += 1; assert.equal(route.weight, 1); } };
  const [first, second] = await Promise.all([gateway.get(url, options), gateway.get(url, options)]);
  assert.equal(calls, 1);
  assert.equal(admissions, 1);
  assert.deepEqual(first.value, second.value);
  assert.equal((await gateway.get(url, options)).cacheStatus, "HIT");
  assert.equal(admissions, 1, "fresh cache hits must not consume upstream admission budget");
});

test("REST gateway serves stale data during Binance 429 cooldown", async () => {
  const config = baseConfig();
  const cache = new GatewayCache();
  let mode = "ok";
  const gateway = new BinanceRestGateway({
    config,
    cache,
    fetchImpl: async () => mode === "ok"
      ? new Response(JSON.stringify({ symbol: "BTCUSDT" }), { status: 200 })
      : new Response("rate limited", { status: 429, headers: { "retry-after": "2" } }),
  });
  const url = "/fapi/v1/openInterest?symbol=BTCUSDT";
  await gateway.get(url);
  const route = resolvePublicMarketRequest(url, config);
  const record = cache.memory.get(route.cacheKey);
  record.freshUntil = Date.now() - 1;
  mode = "limited";
  const stale = await gateway.get(url);
  assert.equal(stale.cacheStatus, "STALE");
  assert.ok(gateway.cooldownUntil.get("futures") > Date.now());
});

test("REST gateway rejects unsupported methods through typed errors", () => {
  const error = new MarketGatewayError("method not allowed", { statusCode: 405, code: "METHOD_NOT_ALLOWED" });
  assert.equal(error.statusCode, 405);
  assert.equal(error.code, "METHOD_NOT_ALLOWED");
});
