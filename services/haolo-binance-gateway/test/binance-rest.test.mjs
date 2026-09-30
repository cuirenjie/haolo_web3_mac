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
  await cache.set(route.cacheKey, { symbol: "BTCUSDT" }, 0, 30_000);
  mode = "limited";
  const stale = await gateway.get(url);
  assert.equal(stale.cacheStatus, "STALE");
  assert.equal(stale.headers["x-haolo-upstream-status"], "429");
  assert.ok(gateway.cooldownUntil.get("futures") > Date.now());
});

test("REST gateway shares public upstream cooldown across replicas", async () => {
  const config = baseConfig();
  const cache = new GatewayCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("rate limited", { status: 429, headers: { "retry-after": "30" } });
  };
  const first = new BinanceRestGateway({ config, cache, fetchImpl });
  const second = new BinanceRestGateway({ config, cache, fetchImpl });
  const url = "/fapi/v1/premiumIndex?symbol=BTCUSDT";
  await assert.rejects(first.get(url), (error) => error?.code === "UPSTREAM_RATE_LIMITED");
  await assert.rejects(second.get(url), (error) => error?.code === "UPSTREAM_COOLDOWN" && error?.upstreamStatus === 429);
  assert.equal(calls, 1, "a shared cache must stop another replica from probing Binance");
});

test("a shared 418 cooldown keeps the upstream ban status for a cold request", async () => {
  const config = baseConfig();
  const cache = new GatewayCache();
  const first = new BinanceRestGateway({
    config,
    cache,
    fetchImpl: async () => new Response("banned", { status: 418, headers: { "retry-after": "30" } }),
  });
  const second = new BinanceRestGateway({ config, cache, fetchImpl: async () => new Response("unexpected") });
  const url = "/fapi/v1/premiumIndex?symbol=SOLUSDT";
  await assert.rejects(first.get(url), (error) => error?.code === "UPSTREAM_RATE_LIMITED");
  await assert.rejects(second.get(url), (error) => error?.code === "UPSTREAM_COOLDOWN" && error?.upstreamStatus === 418);
});

test("shared public cooldown never gets shortened by a later smaller Retry-After", async () => {
  const cache = new GatewayCache();
  const gateway = new BinanceRestGateway({ config: baseConfig(), cache, fetchImpl: async () => new Response("[]") });
  const firstUntil = await gateway.rememberCooldown("spot", 418, 30_000);
  const secondUntil = await gateway.rememberCooldown("spot", 429, 1_000);
  const stored = await cache.get("public-cooldown:spot");
  assert.ok(firstUntil <= secondUntil);
  assert.ok(Number(stored.value.until) >= firstUntil);
});

test("a shared cooldown is rechecked after downstream admission and before upstream I/O", async () => {
  const cache = new GatewayCache();
  let calls = 0;
  const gateway = new BinanceRestGateway({
    config: baseConfig(),
    cache,
    fetchImpl: async () => {
      calls += 1;
      return new Response("[]", { status: 200 });
    },
  });
  await assert.rejects(gateway.get("/fapi/v1/premiumIndex?symbol=ETHUSDT", {
    beforeUpstream: async () => { await gateway.rememberCooldown("futures", 418, 30_000); },
  }), (error) => error?.code === "UPSTREAM_COOLDOWN" && error?.upstreamStatus === 418);
  assert.equal(calls, 0, "the late breaker check must stop the upstream request");
});

test("REST gateway rejects unsupported methods through typed errors", () => {
  const error = new MarketGatewayError("method not allowed", { statusCode: 405, code: "METHOD_NOT_ALLOWED" });
  assert.equal(error.statusCode, 405);
  assert.equal(error.code, "METHOD_NOT_ALLOWED");
});

test("public cooldown and observed-weight keys are isolated by the configured public egress", async () => {
  const cache = new GatewayCache();
  const gateway = new BinanceRestGateway({
    config: baseConfig({ publicEgressId: "hk-public-b" }),
    cache,
    fetchImpl: async () => new Response("[]", { status: 200 }),
  });
  assert.equal(gateway.publicCooldownKey("spot"), "public-cooldown:hk-public-b:spot");
  await gateway.rememberCooldown("spot", 429, 30_000);
  assert.ok(await cache.get("public-cooldown:hk-public-b:spot"));
  assert.equal(await cache.get("public-cooldown:spot"), null);
});
