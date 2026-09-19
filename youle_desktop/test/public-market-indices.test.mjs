import assert from "node:assert/strict";
import test from "node:test";
import { PublicMarketIndicesService, PUBLIC_INDEX_CATALOG, normalizeIndexSeries } from "../src/main/public-market-indices.mjs";
import { normalizeBinancePublicMarketRequest } from "../src/main/binance-public-market-service.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 20);
function fixture() {
  const state = { now: NOW, fetches: 0, requests: [], failFng: false, failBtc: false, stale: false };
  const service = new PublicMarketIndicesService({
    now: () => state.now,
    fetch: async (url, options) => {
      state.fetches++;
      assert.equal(url, "https://api.alternative.me/fng/?limit=31");
      assert.equal(options.credentials, "omit");
      assert.equal(options.headers, undefined);
      if (state.failFng) throw Error("private transport details");
      return Response.json({ data: [
        { timestamp: String(NOW / 1000), value: "0" },
        { timestamp: String((NOW - DAY) / 1000), value: "50" },
      ], metadata: { error: null } });
    },
    binanceRequest: async request => {
      state.requests.push(request);
      normalizeBinancePublicMarketRequest(request);
      if (state.failBtc && request.parameters.symbol === "BTCUSDT") return { ok: false, status: 429, data: null };
      return { ok: true, stale: state.stale, data: Array.from({ length: 25 }, (_, i) => ({
        symbol: request.parameters.symbol, timestamp: NOW - (24 - i) * HOUR,
        longShortRatio: String(1 + i / 24),
      })) };
    },
  });
  return { state, service };
}

test("public sources need no key, return seven honest index quotes and compare timestamp-aligned baselines", async () => {
  const { service, state } = fixture();
  const result = await service.snapshot();
  assert.equal(result.indices.length, 7);
  assert.equal(state.fetches, 1);
  assert.equal(state.requests.length, 6);
  assert.equal(result.indices[0].value, 0);
  assert.equal(result.indices[0].changePercent, -100);
  assert.equal(result.indices[0].status, "ready");
  for (const index of result.indices.slice(1)) {
    assert.equal(index.value, 2);
    assert.equal(index.changePercent, 100);
    assert.equal(index.updatedAt, NOW);
    assert.equal(index.status, "ready");
  }
});

test("simultaneous snapshots share calls and consumers cannot mutate the service cache", async () => {
  const { service, state } = fixture();
  const [a, b] = await Promise.all([service.snapshot(), service.snapshot()]);
  a.indices[0].series[0].value = 999;
  assert.equal(b.indices[0].series[0].value, 50);
  const cached = await service.snapshot();
  assert.equal(cached.indices[0].series[0].value, 50);
  assert.equal(state.fetches, 1);
  assert.equal(state.requests.length, 6);
});

test("one source failing preserves its old values as stale without stopping healthy sources", async () => {
  const { service, state } = fixture();
  await service.snapshot();
  state.now += 11 * 60_000;
  state.failFng = true;
  state.failBtc = true;
  const snapshot = await service.snapshot();
  assert.equal(snapshot.indices[0].value, 0);
  assert.equal(snapshot.indices[0].status, "stale");
  assert.equal(snapshot.indices[0].updatedAt, NOW);
  assert.equal(snapshot.indices[1].status, "stale");
  assert.equal(snapshot.indices.at(-1).status, "ready");
  assert.equal(JSON.stringify(snapshot).includes("private transport"), false);
});

test("a fresh failure stays unavailable rather than becoming zero, and retry recovers", async () => {
  const { service, state } = fixture();
  state.failFng = true;
  let snapshot = await service.snapshot();
  assert.equal(snapshot.indices[0].value, null);
  assert.equal(snapshot.indices[0].status, "error");
  assert.equal(snapshot.indices[1].status, "ready");
  state.now += 31_000;
  state.failFng = false;
  snapshot = await service.snapshot();
  assert.equal(snapshot.indices[0].value, 0);
  assert.equal(snapshot.indices[0].status, "ready");
});

test("stale upstream cache flags and old sample timestamps remain visible to consumers", async () => {
  const { service, state } = fixture();
  state.stale = true;
  const snapshot = await service.snapshot();
  assert.equal(snapshot.indices[1].status, "stale");
  state.now += 40 * HOUR;
  state.stale = false;
  const aged = await service.snapshot();
  assert.ok(aged.indices.every(index => index.status === "stale"));
});

test("normalization rejects null, non-finite, out-of-range and future data without losing valid zero", () => {
  const definition = PUBLIC_INDEX_CATALOG[0];
  const rows = [null, "", "Infinity", -1, 101, 0].map((value, i) => ({ value, timestamp: (NOW - i * DAY) / 1000 }));
  rows.push({ value: 70, timestamp: (NOW + DAY) / 1000 });
  assert.deepEqual(normalizeIndexSeries(definition, { data: rows }, NOW), [{ time: NOW - 5 * DAY, value: 0 }]);
  assert.throws(() => normalizeIndexSeries(definition, { data: [], metadata: { error: "unavailable" } }, NOW));
});

test("24H change is unknown when the exact baseline is missing or zero", async () => {
  for (const baseline of [0, 1]) {
    const service = new PublicMarketIndicesService({ now: () => NOW,
      fetch: async () => Response.json({ data: [{ value: 10, timestamp: NOW / 1000 }] }),
      binanceRequest: async () => ({ ok: true, data: [
        { timestamp: NOW - (baseline ? 30 : 24) * HOUR, longShortRatio: baseline },
        { timestamp: NOW, longShortRatio: 2 },
      ] }),
    });
    assert.ok((await service.snapshot()).indices.every(index => index.changePercent === null));
  }
});

test("ratio endpoints accept only documented periods and bounded limits", () => {
  for (const path of ["globalLongShortAccountRatio", "topLongShortAccountRatio", "topLongShortPositionRatio"]) {
    const request = { marketType: "futures", path: `/futures/data/${path}`, parameters: { symbol: "BTCUSDT", period: "1h", limit: 169 } };
    assert.ok(normalizeBinancePublicMarketRequest(request).url.includes(path));
    assert.throws(() => normalizeBinancePublicMarketRequest({ ...request, parameters: { ...request.parameters, limit: 501 } }));
    assert.throws(() => normalizeBinancePublicMarketRequest({ ...request, parameters: { ...request.parameters, period: "1m" } }));
    assert.throws(() => normalizeBinancePublicMarketRequest({ ...request, parameters: { ...request.parameters, signature: "no" } }));
  }
});
