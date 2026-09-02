import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BinanceRequestGovernor,
  binanceRequestBucket,
  binanceRequestWeight,
  parseBinanceRetryAfterMs,
} from "../src/main/binance-request-governor.mjs";

test("Binance request weights cover expensive account and market endpoints", () => {
  assert.equal(binanceRequestBucket("https://fapi.binance.com/fapi/v3/account"), "futures");
  assert.equal(binanceRequestBucket("https://api.binance.com/api/v3/klines"), "spot");
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v3/account"), 5);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v3/positionRisk"), 5);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v2/positionRisk"), 5);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v1/income"), 30);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v1/openOrders"), 40);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v1/openOrders?symbol=BTCUSDT"), 1);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v1/openAlgoOrders"), 40);
  assert.equal(binanceRequestWeight("https://api.binance.com/sapi/v1/asset/wallet/balance"), 60);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v1/klines?limit=1500"), 10);
  assert.equal(binanceRequestWeight("https://fapi.binance.com/fapi/v1/depth?limit=1000"), 20);
  assert.equal(binanceRequestWeight("https://api.binance.com/api/v3/ticker/24hr"), 80);
});

test("identical public GETs are coalesced and return independently readable responses", async () => {
  const governor = new BinanceRequestGovernor();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => {
    calls += 1;
    await gate;
    return new Response(JSON.stringify({ symbol: "BTCUSDT" }), { status: 200 });
  };
  const url = "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT";
  const first = governor.fetch(fetchImpl, url);
  const second = governor.fetch(fetchImpl, url);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(await left.json(), { symbol: "BTCUSDT" });
  assert.deepEqual(await right.json(), { symbol: "BTCUSDT" });
  assert.equal(governor.snapshot().coalesced, 1);
});

test("a direct Binance 429 creates a market-scoped, restart-persistent cooldown", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "haolo-binance-governor-"));
  const statePath = path.join(directory, "state.json");
  let currentMs = 1_000_000;
  let calls = 0;
  const governor = new BinanceRequestGovernor({ statePath, now: () => currentMs });
  const response = await governor.fetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ code: -1003 }), { status: 429, headers: { "retry-after": "90" } });
  }, "https://fapi.binance.com/fapi/v1/time", {}, { source: "account" });
  assert.equal(response.status, 429);
  assert.equal(governor.snapshot().cooldowns.futures, 90_000);
  assert.equal(governor.snapshot().cooldowns.spot, 0);

  const spot = await governor.fetch(async () => {
    calls += 1;
    return new Response("{}");
  }, "https://api.binance.com/api/v3/time", {}, { source: "alert" });
  assert.equal(spot.status, 200);

  const blocked = await governor.fetch(async () => {
    calls += 1;
    return new Response("unexpected");
  }, "https://fapi.binance.com/fapi/v1/ping", {}, { source: "alert" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("x-haolo-binance-governor"), "upstream");
  assert.equal(blocked.headers.get("x-haolo-rate-limit-source"), "direct-binance");
  assert.equal(calls, 2);

  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.bucketCooldownUntil.futures, currentMs + 90_000);
  const restarted = new BinanceRequestGovernor({ statePath, now: () => currentMs + 1_000 });
  assert.equal(restarted.snapshot().cooldowns.futures, 89_000);
  assert.equal(restarted.snapshot().cooldowns.spot, 0);
});

test("observed gateway weight stays on its egress while the local logical budget remains independent", async () => {
  let calls = 0;
  const currentMs = 2_000_000;
  const governor = new BinanceRequestGovernor({
    now: () => currentMs,
    safetyRatio: 0.5,
    limits: { futures: 10 },
  });
  const fetchImpl = async () => {
    calls += 1;
    return new Response("{}", { status: 200, headers: {
      "x-mbx-used-weight-1m": "5",
      "x-haolo-binance-route": "public-gateway",
      "x-haolo-binance-egress": "haolo-public",
    } });
  };
  assert.equal((await governor.fetch(fetchImpl, "https://fapi.binance.com/fapi/v1/time")).status, 200);
  assert.equal((await governor.fetch(fetchImpl, "https://fapi.binance.com/fapi/v1/ping")).status, 200);
  assert.equal(governor.snapshot().observedWeightByEgress["haolo-public:futures"], 5);
  assert.equal(governor.snapshot().futuresWeight, 0);
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await governor.fetch(fetchImpl, `https://fapi.binance.com/fapi/v1/time?nonce=${index}`)).status, 200);
  }
  const admitted = await governor.fetch(fetchImpl, "https://fapi.binance.com/fapi/v1/time?nonce=admitted");
  assert.equal(admitted.status, 200);
  assert.equal(governor.snapshot().futuresWeight, 0);
  assert.equal(governor.snapshot().observedWeightByEgress["haolo-public:futures"], 5);
  assert.equal(calls, 6);
});

test("observed direct Binance weight protects only the matching local egress bucket", async () => {
  let calls = 0;
  const governor = new BinanceRequestGovernor({ safetyRatio: 0.5, limits: { futures: 10, spot: 10 } });
  const direct = await governor.fetch(async () => {
    calls += 1;
    return new Response("{}", { status: 200, headers: { "x-mbx-used-weight-1m": "5" } });
  }, "https://fapi.binance.com/fapi/v1/time");
  assert.equal(direct.status, 200);
  const blocked = await governor.fetch(async () => {
    calls += 1;
    return new Response("{}");
  }, "https://fapi.binance.com/fapi/v1/ping");
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("x-haolo-rate-limit-source"), "local-budget");
  assert.equal((await governor.fetch(async () => {
    calls += 1;
    return new Response("{}");
  }, "https://api.binance.com/api/v3/time")).status, 200);
  assert.equal(calls, 2);
});

test("a public gateway downstream 429 is diagnosed without cooling the direct Binance bucket", async () => {
  let calls = 0;
  const governor = new BinanceRequestGovernor();
  const first = await governor.fetch(async () => {
    calls += 1;
    return new Response("{}", { status: 429, headers: {
      "retry-after": "30",
      "x-haolo-binance-route": "public-gateway",
      "x-haolo-binance-egress": "haolo-public",
      "x-haolo-rate-limit-source": "gateway-downstream",
    } });
  }, "https://fapi.binance.com/fapi/v1/ping");
  assert.equal(first.status, 429);
  assert.equal(governor.snapshot().cooldowns.futures, 0);
  assert.equal(governor.snapshot().gatewayDownstreamRateLimits, 1);
  const second = await governor.fetch(async () => {
    calls += 1;
    return new Response("{}", { status: 200, headers: {
      "x-haolo-binance-route": "direct",
      "x-haolo-binance-egress": "local",
    } });
  }, "https://fapi.binance.com/fapi/v1/time");
  assert.equal(second.status, 200);
  assert.equal(calls, 2);
  assert.equal(governor.snapshot().recentDiagnostics.at(-2).origin, "gateway_downstream");
});

test("a stale gateway upstream cooldown is attributed even when the cache response is HTTP 200", async () => {
  const governor = new BinanceRequestGovernor();
  const response = await governor.fetch(async () => new Response("{}", { status: 200, headers: {
    "retry-after": "15",
    "x-haolo-cache": "STALE",
    "x-haolo-binance-route": "public-gateway",
    "x-haolo-binance-egress": "haolo-public",
    "x-haolo-rate-limit-source": "gateway-upstream",
  } }), "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=2");
  assert.equal(response.status, 200);
  assert.equal(governor.snapshot().gatewayUpstreamRateLimits, 1);
  assert.equal(governor.snapshot().cooldowns.futures, 0);
  assert.equal(governor.snapshot().futuresWeight, 0);
  assert.equal(governor.snapshot().recentDiagnostics.at(-1).origin, "gateway_upstream");
});

test("the governor enforces concurrency and serves queued higher priorities first", async () => {
  const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
  const started = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const fetchImpl = async (url) => {
    const name = new URL(url).searchParams.get("symbol");
    started.push(name);
    if (name === "FIRST") await firstGate;
    return new Response("{}");
  };
  const first = governor.fetch(fetchImpl, "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=FIRST", {}, { priority: 1 });
  await Promise.resolve();
  const low = governor.fetch(fetchImpl, "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=LOW", {}, { priority: 1 });
  const high = governor.fetch(fetchImpl, "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=HIGH", {}, { priority: 100 });
  releaseFirst();
  await Promise.all([first, low, high]);
  assert.deepEqual(started, ["FIRST", "HIGH", "LOW"]);
});

test("execution deadlines start after queue admission and release hung slots", async () => {
  const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const fetchImpl = async (url) => {
    const symbol = new URL(url).searchParams.get("symbol");
    if (symbol === "FIRST") await firstGate;
    if (symbol === "HUNG") return new Promise(() => {});
    return new Response(JSON.stringify({ symbol }), { status: 200 });
  };
  const first = governor.fetch(
    fetchImpl,
    "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=FIRST",
  );
  await Promise.resolve();
  const queued = governor.fetch(
    fetchImpl,
    "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=QUEUED",
    {},
    { timeoutMs: 25 },
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(governor.snapshot().queued, 1);
  releaseFirst();
  assert.equal((await queued).status, 200);
  await first;

  await assert.rejects(
    governor.fetch(
      fetchImpl,
      "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=HUNG",
      {},
      { timeoutMs: 20 },
    ),
    (error) => error?.name === "TimeoutError" && /20ms/.test(error.message),
  );
  assert.equal(governor.snapshot().running, 0);
});

test("a queued renderer abort removes stale work before it consumes concurrency", async () => {
  const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const started = [];
  const fetchImpl = async (url) => {
    const symbol = new URL(url).searchParams.get("symbol");
    started.push(symbol);
    if (symbol === "FIRST") await firstGate;
    return new Response("{}");
  };
  const first = governor.fetch(fetchImpl, "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=FIRST");
  await Promise.resolve();
  const controller = new AbortController();
  const stale = governor.fetch(
    fetchImpl,
    "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=STALE",
    { signal: controller.signal },
    { timeoutMs: 50 },
  );
  controller.abort(new DOMException("superseded", "AbortError"));
  await assert.rejects(stale, (error) => error?.name === "AbortError");
  releaseFirst();
  await first;
  assert.deepEqual(started, ["FIRST"]);
  assert.equal(governor.snapshot().queued, 0);
  assert.equal(governor.snapshot().futuresWeight, 2, "aborted queued work must release its unused weight reservation");
});

test("Retry-After supports seconds and HTTP dates", () => {
  assert.equal(parseBinanceRetryAfterMs(new Response(null, { headers: { "retry-after": "12" } }), 1_000), 12_000);
  assert.equal(parseBinanceRetryAfterMs(new Response(null, { headers: { "retry-after": new Date(31_000).toUTCString() } }), 1_000), 30_000);
});
