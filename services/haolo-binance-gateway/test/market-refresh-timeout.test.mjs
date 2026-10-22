import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { GatewayCache } from "../src/cache.mjs";
import { BinanceRestGateway, resolvePublicMarketRequest } from "../src/binance-rest.mjs";
import { MarketRefreshScope } from "../src/market-refresh-scope.mjs";
import { baseConfig } from "./helpers.mjs";

const url = "/fapi/v1/klines?symbol=XAUUSDT&interval=15m&limit=501";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const timeoutAt = stage => error => error.code === "MARKET_REFRESH_TIMEOUT" && error.statusCode === 503 && error.stage === stage;
const waitFor = async predicate => {
  for (let i = 0; i < 200 && !predicate(); i++) await delay(5);
  assert.ok(predicate(), "expected async phase was reached");
};

test("a hung leader and all local followers time out; late completion cannot remove the next flight", async () => {
  const cache = new GatewayCache();
  const old = deferred(), next = deferred();
  let oldCalls = 0, followerCalls = 0;
  const leader = cache.sharedSingleFlight("rest:xau", async () => { oldCalls++; return old.promise; }, { timeoutMs: 40 });
  const follower = cache.sharedSingleFlight("rest:xau", async () => { followerCalls++; }, { timeoutMs: 40 });
  // Keep a real event-loop handle alive while the production deadline is unref'ed.
  const results = await Promise.allSettled([leader, follower, delay(65)]);
  assert.equal(results[0].reason.code, "MARKET_REFRESH_TIMEOUT");
  assert.equal(results[1].reason.code, "MARKET_REFRESH_TIMEOUT");
  assert.equal(oldCalls, 1); assert.equal(followerCalls, 0); assert.equal(cache.inflight.size, 0);
  const retry = cache.sharedSingleFlight("rest:xau", () => next.promise, { timeoutMs: 1000 });
  await delay(5); old.resolve("obsolete"); await delay(5);
  assert.equal(cache.inflight.has("rest:xau"), true);
  next.resolve("fresh"); assert.equal(await retry, "fresh"); assert.equal(cache.inflight.size, 0);
});

test("a fetch that ignores abort times out, releases the key, and discards its late response", async () => {
  const cache = new GatewayCache(), blocked = deferred();
  let calls = 0, cancelled = false;
  const config = baseConfig({ requestTimeoutMs: 100 });
  const gateway = new BinanceRestGateway({ cache, config, fetchImpl: () => {
    calls++; return calls === 1 ? blocked.promise : new Response('["fresh"]');
  } });
  await Promise.all([assert.rejects(gateway.get(url), timeoutAt("upstream_headers")), delay(125)]);
  // The fault gets a short deadline; the healthy retry must not depend on CPU scheduling.
  config.requestTimeoutMs = 1000;
  assert.deepEqual((await gateway.get(url)).value, ["fresh"]);
  blocked.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await waitFor(() => cancelled);
  assert.deepEqual((await gateway.get(url)).value, ["fresh"]);
  assert.equal(calls, 2);
});

test("a hung response body cannot publish stale data after a successful retry", async () => {
  const cache = new GatewayCache(), blocked = deferred();
  let calls = 0, cancelled = false;
  const config = baseConfig({ requestTimeoutMs: 100 });
  const gateway = new BinanceRestGateway({ cache, config, fetchImpl: async () => {
    calls++;
    return calls === 1 ? { ok: true, status: 200, headers: new Headers(), text: () => blocked.promise,
      body: { cancel: async () => { cancelled = true; } } } : new Response('["fresh"]');
  } });
  await Promise.all([assert.rejects(gateway.get(url), timeoutAt("upstream_body")), delay(125)]);
  config.requestTimeoutMs = 1000;
  assert.equal(cancelled, true);
  assert.deepEqual((await gateway.get(url)).value, ["fresh"]);
  blocked.resolve('["obsolete"]'); await delay(10);
  assert.deepEqual((await gateway.get(url)).value, ["fresh"]); assert.equal(calls, 2);
});

test("a hung admission has an overall deadline and cannot start upstream work when it returns late", async () => {
  class ShortScopeCache extends GatewayCache {
    sharedSingleFlight(key, factory, options) { return super.sharedSingleFlight(key, factory, { ...options, timeoutMs: 45 }); }
  }
  const cache = new ShortScopeCache(), blocked = deferred(); let calls = 0;
  const gateway = new BinanceRestGateway({ cache, config: baseConfig(), fetchImpl: async () => { calls++; return new Response('["fresh"]'); } });
  await Promise.all([assert.rejects(gateway.get(url, { beforeUpstream: () => blocked.promise }), timeoutAt("admission")), delay(70)]);
  assert.equal(calls, 0); assert.deepEqual((await gateway.get(url)).value, ["fresh"]);
  blocked.resolve(); await delay(10); assert.equal(calls, 1);
});

test("initial cache reads are bounded before a shared refresh is created", async () => {
  const cache = new GatewayCache(); cache.redis = { get: () => new Promise(() => {}) };
  const gateway = new BinanceRestGateway({ cache, config: baseConfig({ requestTimeoutMs: 1 }), fetchImpl: async () => { assert.fail("must not fetch"); } });
  await Promise.all([assert.rejects(gateway.get(url), timeoutAt("cache_read")), delay(7050)]);
  assert.equal(cache.inflight.size, 0);
});

test("late Redis cache reads cannot replace a newer in-memory value", async () => {
  const cache = new GatewayCache(), blocked = deferred(), scope = new MarketRefreshScope(30);
  cache.redis = { get: () => blocked.promise };
  const key = "rest:futures:late-read";
  const read = scope.run(() => cache.get(key, Date.now(), { signal: scope.signal }), "cache_read");
  await Promise.all([assert.rejects(read, timeoutAt("cache_read")), delay(50)]);
  cache.redis = null; await cache.set(key, "fresh", 1000, 2000);
  blocked.resolve(JSON.stringify({ value: "obsolete", storedAt: Date.now(), freshUntil: Date.now() + 1000, staleUntil: Date.now() + 2000 }));
  await delay(10); assert.equal((await cache.get(key)).value, "fresh"); scope.close();
});

test("real Redis: hung refresh stops renewal, unlocks, and rejects late fenced publication", { skip: !process.env.REDIS_TEST_URL }, async () => {
  const prefix = `deadline-test:${crypto.randomUUID()}:`;
  const cache = new GatewayCache({ redisUrl: process.env.REDIS_TEST_URL, prefix });
  const peer = new GatewayCache({ redisUrl: process.env.REDIS_TEST_URL, prefix });
  await Promise.all([cache.connect(), peer.connect()]);
  const key = resolvePublicMarketRequest(url, baseConfig()).cacheKey;
  const blocked = deferred(); let lease, oldSignal;
  try {
    const old = cache.sharedSingleFlight(key, async (signal, refresh) => {
      lease = refresh.lease; oldSignal = signal; return blocked.promise;
    }, { leaseMs: 100, timeoutMs: 250 });
    const rejection = assert.rejects(old, timeoutAt("refresh"));
    await waitFor(() => lease); await delay(150);
    assert.ok(await cache.redis.pTTL(lease.key) > 0, "renewed while within total deadline");
    await rejection;
    assert.equal(oldSignal.aborted, true); assert.equal(await cache.redis.get(lease.key), null);
    await peer.sharedSingleFlight(key, async (signal, refresh) => {
      await peer.set(key, ["fresh"], 1000, 2000, { signal, lease: refresh.lease });
    }, { leaseMs: 100, timeoutMs: 500 });
    // Even a dependency that lost the abort signal cannot write using an old fence.
    await assert.rejects(cache.set(key, ["obsolete"], 1000, 2000, { lease }), { code: "MARKET_COORDINATION_UNAVAILABLE" });
    assert.deepEqual((await peer.get(key)).value, ["fresh"]);
    assert.equal(cache.publicRest.memory.has(cache.key(key)), false);
    blocked.resolve("late"); await delay(10); assert.equal(cache.inflight.size, 0);
  } finally {
    blocked.resolve();
    const keys = await cache.redis.keys(`${prefix}*`); if (keys.length) await cache.redis.unlink(keys);
    await Promise.all([cache.close(), peer.close()]);
  }
});

test("real Redis: a delayed cache write is fenced atomically after ownership changes", { skip: !process.env.REDIS_TEST_URL }, async () => {
  const prefix = `late-write-test:${crypto.randomUUID()}:`;
  const cache = new GatewayCache({ redisUrl: process.env.REDIS_TEST_URL, prefix });
  const peer = new GatewayCache({ redisUrl: process.env.REDIS_TEST_URL, prefix });
  await Promise.all([cache.connect(), peer.connect()]);
  const key = resolvePublicMarketRequest(url, baseConfig()).cacheKey, gate = deferred();
  const send = cache.redis.sendCommand.bind(cache.redis); let pendingWrite;
  cache.redis.sendCommand = async args => {
    if (args[0] === "EVAL" && args[1].includes('local index, sizes')) {
      pendingWrite = args; await gate.promise;
    }
    return send(args);
  };
  try {
    const old = cache.sharedSingleFlight(key, (signal, refresh) => refresh.run(() => cache.set(key, ["obsolete"], 1000, 2000, {
      signal, lease: refresh.lease,
    }), "cache_write"), { leaseMs: 100, timeoutMs: 150 });
    const rejection = assert.rejects(old, timeoutAt("cache_write"));
    await waitFor(() => pendingWrite); await rejection;
    await peer.sharedSingleFlight(key, (signal, refresh) => peer.set(key, ["fresh"], 1000, 2000, { signal, lease: refresh.lease }), { timeoutMs: 1000 });
    gate.resolve(); await delay(40);
    const record = JSON.parse(await peer.redis.get(peer.key(key)));
    assert.deepEqual(record.value, ["fresh"]);
    assert.equal(cache.publicRest.memory.has(cache.key(key)), false);
  } finally {
    gate.resolve(); cache.redis.sendCommand = send;
    const keys = await peer.redis.keys(`${prefix}*`); if (keys.length) await peer.redis.unlink(keys);
    await Promise.all([cache.close(), peer.close()]);
  }
});

test("real Redis: an indefinitely held legacy lock and late legacy cache cannot poison the upgraded gateway", { skip: !process.env.REDIS_TEST_URL }, async () => {
  const prefix = `legacy-flight-test:${crypto.randomUUID()}:`;
  const cache = new GatewayCache({ redisUrl: process.env.REDIS_TEST_URL, prefix });
  await cache.connect();
  const legacyKey = "rest:futures:/fapi/v1/klines?interval=15m&limit=501&symbol=XAUUSDT";
  const lock = cache.key(`rest-flight:${crypto.createHash("sha256").update(legacyKey).digest("hex")}`);
  let calls = 0;
  const gateway = new BinanceRestGateway({ cache, config: baseConfig(), fetchImpl: async () => {
    calls++; return new Response('["fresh"]');
  } });
  try {
    await cache.redis.set(lock, "legacy-owner", { PX: 60000 });
    await cache.set(legacyKey, ["obsolete"], 60000, 60000);
    assert.deepEqual((await gateway.get(url)).value, ["fresh"]);
    await cache.set(legacyKey, ["late-legacy"], 60000, 60000);
    assert.deepEqual((await gateway.get(url)).value, ["fresh"]);
    assert.equal(calls, 1); assert.equal(await cache.redis.get(lock), "legacy-owner");
  } finally {
    const keys = await cache.redis.keys(`${prefix}*`); if (keys.length) await cache.redis.unlink(keys);
    await cache.close();
  }
});
