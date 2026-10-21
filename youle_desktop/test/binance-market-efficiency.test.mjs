import assert from "node:assert/strict";
import test from "node:test";
import { BinancePublicMarketService } from "../src/main/binance-public-market-service.mjs";

const request = { marketType: "futures", path: "/fapi/v1/ticker/24hr", parameters: { symbol: "BTCUSDT" } };
const body = { price: "0.000000000000000001", quantity: "100.00000000" };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("100 concurrent equivalent requests share one fetch and isolate result mutation", async () => {
  let calls = 0, complete;
  const service = new BinancePublicMarketService({ fetch: async () => { calls++; await new Promise(r => complete = r); return Response.json(body); } });
  const results = Array.from({ length: 100 }, () => service.request(request));
  await tick();
  assert.equal(calls, 1);
  complete();
  const values = await Promise.all(results);
  assert.deepEqual(values[0].data, body);
  values[0].data.price = "mutated";
  assert.equal(values[1].data.price, body.price);
  assert.equal((await service.request(request)).data.price, body.price);
  assert.equal(service.flights.size, 0);
  await service.close();
});

test("one caller cancelling never cancels peers; last caller cancels and immediate retry starts cleanly", async () => {
  const signals = [], completes = [];
  const service = new BinancePublicMarketService({ fetch: async (_url, { signal }) => {
    signals.push(signal); await new Promise(r => completes.push(r)); return Response.json(body);
  } });
  const a = new AbortController(), b = new AbortController();
  const first = service.request(request, { signal: a.signal });
  const second = service.request(request, { signal: b.signal });
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  a.abort(); await firstRejected;
  assert.equal(signals[0].aborted, false);
  completes[0](); assert.deepEqual((await second).data, body);
  service.cache.clear();
  const third = service.request(request, { signal: b.signal });
  const thirdRejected = assert.rejects(third, { name: "AbortError" });
  await tick();
  b.abort(); await thirdRejected;
  assert.equal(signals[1].aborted, true);
  const retry = service.request(request);
  await tick();
  assert.equal(signals.length, 3);
  completes[2](); assert.equal((await retry).ok, true);
  completes[1](); await service.close();
});

test("freshness and request priority do not inherit a background flight; close cancels all flights", async () => {
  const signals = [];
  const service = new BinancePublicMarketService({ fetch: async (_url, { signal }) => {
    signals.push(signal); await new Promise(() => {});
  } });
  const requests = [request, { ...request, freshness: "live" }, { ...request, demand: "prefetch" }].map(r => service.request(r));
  const rejects = requests.map(p => assert.rejects(p, { name: "AbortError" }));
  await tick();
  assert.equal(signals.length, 3);
  await service.close(); await Promise.all(rejects);
  assert.ok(signals.every(s => s.aborted));
  assert.equal(service.flights.size, 0);
});

test("ETag 304 reuses exact strings and origin time without renewing an old snapshot", async () => {
  let now = 1_800_000_000_000, fetchedAt = now, calls = 0;
  const sent = [];
  const service = new BinancePublicMarketService({ now: () => now, fetch: async (_url, init) => {
    sent.push(init.headers); calls++;
    return new Response(calls === 1 ? JSON.stringify(body) : null, { status: calls === 1 ? 200 : 304,
      headers: { etag: '"same"', "x-haolo-data-fetched-at": String(fetchedAt), "x-haolo-cache": "HIT" } });
  } });
  await service.request(request);
  now += 2_001; fetchedAt = now;
  const validated = await service.request(request);
  assert.equal(sent[1]["if-none-match"], '"same"');
  assert.equal(validated.status, 200); assert.equal(validated.revalidated, true);
  assert.deepEqual(validated.data, body); assert.equal(validated.fetchedAt, fetchedAt);
  now += 2_001;
  const old = await service.request({ ...request, freshness: "live" });
  assert.equal(old.stale, true); assert.equal(old.fetchedAt, fetchedAt);
  now += 61_000;
  const expired = await service.request(request);
  assert.equal(sent.at(-1)["if-none-match"], undefined);
  assert.equal(expired.ok, false);
  await service.close();
});

for (const [initialTag, returnedTag] of [['W/"same"', '"same"'], ['"same"', 'W/"same"']]) {
  test(`compressed GET validator ${initialTag} matches equivalent 304 ${returnedTag}`, async () => {
    let now = 1_800_000_000_000, calls = 0;
    const service = new BinancePublicMarketService({ now: () => now, fetch: async (_url, init) => {
      calls++;
      if (calls > 1) assert.equal(init.headers["if-none-match"], initialTag);
      return new Response(calls === 1 ? JSON.stringify(body) : null, {
        status: calls === 1 ? 200 : 304,
        headers: { etag: calls === 1 ? initialTag : returnedTag, "x-haolo-data-fetched-at": String(now) },
      });
    } });
    await service.request(request); now += 2_001;
    const result = await service.request(request);
    assert.equal(result.revalidated, true); assert.notEqual(result.stale, true);
    assert.deepEqual(result.data, body); assert.equal(result.fetchedAt, now);
    await service.close();
  });
}

for (const mode of ["missing-time", "stale", "wrong-tag"]) test(`304 ${mode} cannot manufacture fresh data`, async () => {
  let now = 1_800_000_000_000, calls = 0;
  const original = now;
  const service = new BinancePublicMarketService({ now: () => now, fetch: async () => {
    calls++;
    return new Response(calls === 1 ? JSON.stringify(body) : null, { status: calls === 1 ? 200 : 304,
      headers: { etag: calls > 1 && mode === "wrong-tag" ? '"other"' : '"same"',
        ...(mode !== "missing-time" ? { "x-haolo-data-fetched-at": String(original) } : {}),
        "x-haolo-cache": mode === "stale" ? "STALE" : "HIT" } });
  } });
  await service.request(request); now += 2_001;
  const result = await service.request(request);
  assert.equal(result.stale, true); assert.equal(result.fetchedAt, original);
  await service.close();
});

for (const path of ["/fapi/v1/depth", "/fapi/v1/aggTrades"]) test(`${path} never uses a conditional bootstrap`, async () => {
  let now = 1_800_000_000_000;
  const headers = [];
  const service = new BinancePublicMarketService({ now: () => now, fetch: async (_url, init) => {
    headers.push(init.headers); return Response.json(body, { headers: { etag: '"same"' } });
  } });
  await service.request({ ...request, path }); now += 1_001;
  await service.request({ ...request, path });
  assert.equal(headers.length, 2); assert.equal(headers[1]["if-none-match"], undefined);
  await tick(); await service.close();
});
