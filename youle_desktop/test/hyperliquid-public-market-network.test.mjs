import assert from "node:assert/strict";
import test from "node:test";
import { HyperliquidPublicMarketService } from "../src/main/hyperliquid-public-market-service.mjs";

const request = { coin: "BTC", interval: "1m", startTime: 1, endTime: 2 };

test("concurrent candle readers share one request and receive isolated snapshots", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = new HyperliquidPublicMarketService({ fetch: async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify([{ c: "100" }]));
  } });
  const readers = [service.candles(request), service.candles(request)];
  release();
  const [first, second] = await Promise.all(readers);
  assert.equal(calls, 1);
  first.data[0].c = "modified";
  assert.equal(second.data[0].c, "100");
  assert.equal((await service.candles(request)).data[0].c, "100");
});

test("a stalled candle body reaches its deadline and the next request can recover", async () => {
  let calls = 0;
  let signal;
  const service = new HyperliquidPublicMarketService({ timeoutMs: 1_000, fetch: async (_url, init) => {
    signal = init.signal;
    calls += 1;
    if (calls === 1) return { ok: true, status: 200, json: () => new Promise(() => {}) };
    return new Response("[]");
  } });
  const keepAlive = setTimeout(() => {}, 3_000);
  try {
    await assert.rejects(service.candles(request), { name: "TimeoutError" });
    assert.equal(signal.aborted, true);
    assert.equal(service.cache.size, 0);
    assert.equal((await service.candles(request)).ok, true);
    assert.equal(calls, 2);
  } finally { clearTimeout(keepAlive); }
});

test("failed shared downloads are not cached or automatically replayed", async () => {
  let calls = 0;
  const service = new HyperliquidPublicMarketService({ fetch: async () => {
    calls += 1;
    throw new Error("offline");
  } });
  const outcomes = await Promise.allSettled([service.candles(request), service.candles(request)]);
  assert.ok(outcomes.every((result) => result.status === "rejected"));
  assert.equal(calls, 1);
  await assert.rejects(service.candles(request), /offline/);
  assert.equal(calls, 2);
});
