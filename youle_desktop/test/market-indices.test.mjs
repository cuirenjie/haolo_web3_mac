import assert from "node:assert/strict";
import test from "node:test";
import { MarketIndicesService } from "../src/main/market-indices.mjs";
import { PRIORITY_INDICES } from "../src/shared/market-index-catalog.mjs";
import { YouleApiClient } from "../src/main/youle-api-client.mjs";

const NOW = Date.UTC(2026, 9, 19);
test("desktop adapter requires login and uses only the neutral Haolo route", async () => {
  const client = new YouleApiClient();
  client.loaded = true;
  client.baseUrl = "https://haolo.example";
  client.token = null;
  let request;
  client.requestJson = async (url, options) => { request = { url, options }; return { indices: [] }; };
  await assert.rejects(client.getMarketIndices());
  assert.equal(request, undefined);
  client.token = "test-session";
  await client.getMarketIndices();
  assert.equal(request.url, "https://haolo.example/api/market-data/indices");
  assert.equal(request.options.headers.Authorization, "Bearer test-session");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.timeoutMs, 45_000);
});

function fixture() {
  const state = { now: NOW, calls: 0, fail: false };
  const service = new MarketIndicesService({
    now: () => state.now,
    indicesRequest: async () => {
      state.calls++;
      if (state.fail) throw Error("private transport details");
      return { indices: [...PRIORITY_INDICES, { id: "index:extra", key: "i:extra:test", name: "额外", code: "EXTRA" }].reverse().map(item => ({
        ...item, value: 0, changePercent: 2.88, change24H: 2, updatedAt: null,
        fetchedAt: NOW, status: "ready", intervalMs: 0,
      })) };
    },
    fetch: async () => Response.json({ data: [{ value: 59, timestamp: NOW / 1000 }] }),
    binanceRequest: async () => ({ ok: true, data: [{ timestamp: NOW, longShortRatio: 1.5 }] }),
  });
  return { state, service };
}

test("backend catalogue is complete, priorities are stable and legacy equivalents are deduplicated", async () => {
  const { service } = fixture();
  const result = await service.snapshot();
  assert.equal(result.indices.length, 15);
  assert.deepEqual(result.indices.slice(0, 9).map(item => item.id), PRIORITY_INDICES.map(item => item.id));
  assert.equal(result.indices[9].id, "index:extra");
  assert.equal(result.indices[0].value, 0);
  assert.equal(result.indices[0].changePercent, 2.88);
  assert.equal(result.indices[0].updatedAt, null);
  assert.equal(result.indices[0].fetchedAt, NOW);
  assert.ok(!result.indices.some(item => ["alternative:fng", "binance:btc:accounts"].includes(item.id)));
});

test("polling and simultaneous views share requests and cannot mutate cached values", async () => {
  const { service, state } = fixture();
  const [a, b] = await Promise.all([service.snapshot(), service.snapshot()]);
  a.indices[0].value = 999;
  assert.equal(b.indices[0].value, 0);
  await service.snapshot();
  assert.equal(state.calls, 1);
  state.now += 60_001;
  await service.snapshot();
  assert.equal(state.calls, 2);
});

test("backend outage preserves stale values and correctly attributes available public fallbacks", async () => {
  const { service, state } = fixture();
  await service.snapshot();
  state.fail = true;
  state.now += 60_001;
  const result = await service.snapshot();
  assert.equal(result.indices[0].value, 0);
  assert.equal(result.indices[0].status, "stale");
  assert.equal(result.indices[5].source, "Alternative.me");
  assert.equal(result.indices[5].value, 59);
  assert.equal(result.indices[7].source, "Binance");
  assert.equal(result.indices[7].value, 1.5);
  assert.equal(result.indices[6].status, "stale");
  assert.ok(!JSON.stringify(result).includes("private transport"));
});

test("a missing backend never invents quotes for the priority nine", async () => {
  const { service, state } = fixture();
  state.fail = true;
  const result = await service.snapshot();
  assert.equal(result.indices.length, 14);
  assert.equal(result.indices[0].value, null);
  assert.equal(result.indices[0].status, "error");
  assert.equal(result.indices[5].value, 59);
});
