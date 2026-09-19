import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { GatewayCache } from "../src/cache.mjs";
import { PublicRestCache } from "../src/public-rest-cache.mjs";
import { BinanceRestGateway } from "../src/binance-rest.mjs";
import { baseConfig } from "./helpers.mjs";

test("Redis OOM after a successful upstream read cannot turn a cold chart into HTTP 500", async () => {
  const cache = new GatewayCache();
  const notes = [];
  cache.publicRest.onDiagnostic = (entry) => notes.push(entry);
  cache.redis = { get: async () => null, sendCommand: async () => { throw new Error("OOM command not allowed"); } };
  let calls = 0;
  const gateway = new BinanceRestGateway({ config: baseConfig(), cache, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify([[1, "1", "2", "0.5", "1.5", "10", 2]]));
  } });
  const url = "/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=2";
  const first = await gateway.get(url);
  assert.equal(first.statusCode, 200);
  assert.equal(first.cacheStatus, "MISS");
  assert.equal(first.value.length, 1);
  assert.equal((await gateway.get(url)).cacheStatus, "HIT");
  assert.equal(calls, 1);
  assert.deepEqual(notes, [{ event: "public_rest_cache_unavailable", operation: "write" }]);
});

test("disposable Redis read failures degrade to a miss; security writes still fail closed", async () => {
  const cache = new GatewayCache();
  cache.publicRest.onDiagnostic = () => {};
  cache.redis = { get: async () => { throw new Error("offline"); }, set: async () => { throw new Error("OOM"); } };
  assert.equal(await cache.get("rest:futures:test"), null);
  await assert.rejects(cache.set("ticket:one-use", { userId: "test" }, 30000), /OOM/);
  await assert.rejects(cache.set("permit:one-use", {}, 30000), /OOM/);
});

test("public memory cache is bounded by bytes and entries and drops expired records", async () => {
  const cache = new PublicRestCache({ prefix: "test:", memoryMaxBytes: 4096, maxEntries: 3 });
  for (let index = 0; index < 50; index++) await cache.set(`test:rest:${index}`, "x".repeat(900), 1000, 2000, null);
  assert.ok(cache.memoryBytes <= 4096);
  assert.ok(cache.memory.size <= 3);
  assert.equal(await cache.get("test:rest:0", null), null);
  assert.ok(await cache.get("test:rest:49", null));
  assert.equal(await cache.get("test:rest:49", null, Date.now() + 3000), null);
  await cache.set("test:rest:oversized", "x".repeat(8000), 1000, 2000, null);
  assert.ok(cache.memoryBytes <= 4096);
  cache.clear();
  assert.equal(cache.memoryBytes, 0);
});

test("real Redis concurrent cache eviction preserves ticket/permit/weight keys", { skip: !process.env.REDIS_TEST_URL }, async () => {
  const prefix = `cache-test:${crypto.randomUUID()}:`;
  const cache = new GatewayCache({ redisUrl: process.env.REDIS_TEST_URL, prefix });
  cache.publicRest = new PublicRestCache({ prefix, redisMaxBytes: 12000, maxEntries: 4 });
  await cache.connect();
  try {
    await cache.set("ticket:keep", { userId: "test" }, 60000);
    await cache.set("permit:keep", { value: "once" }, 60000);
    const budget = { shardId: "test", marketType: "futures", windowId: 1, weight: 2, totalLimit: 5,
      backgroundLimit: 5, background: false, userKey: "user", userLimit: 5, ttlMs: 60000 };
    assert.equal((await cache.consumeWeightBudget(budget)).allowed, true);
    await Promise.all(Array.from({ length: 30 }, (_, i) => cache.set(`rest:futures:${i}`, "x".repeat(2500), 5000, 60000)));
    assert.ok(Number(await cache.redis.get(`${prefix}rest:bytes`)) <= 12000);
    assert.ok(Number(await cache.redis.zCard(`${prefix}rest:index`)) <= 4);
    assert.deepEqual(await cache.take("ticket:keep"), { userId: "test" });
    assert.equal(await cache.take("ticket:keep"), null);
    assert.deepEqual(await cache.take("permit:keep"), { value: "once" });
    assert.equal((await cache.consumeWeightBudget(budget)).usedTotal, 4);
    assert.equal((await cache.consumeWeightBudget(budget)).allowed, false);
    const members = await cache.redis.zRange(`${prefix}rest:index`, 0, -1);
    const before = Number(await cache.redis.get(`${prefix}rest:bytes`));
    for (let i = 0; i < 10; i++) await cache.set(members[0].slice(prefix.length), "x".repeat(2500), 5000, 60000);
    assert.equal(Number(await cache.redis.get(`${prefix}rest:bytes`)), before, "replacing a record must not leak byte accounting");
  } finally {
    const keys = await cache.redis.keys(`${prefix}*`);
    if (keys.length) await cache.redis.unlink(keys);
    await cache.close();
  }
});
