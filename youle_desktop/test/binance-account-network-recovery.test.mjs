import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { Agent, fetch as transportFetch } from "undici";
import { BinanceAccountService } from "../src/main/binance-account/service.mjs";
import { createBinanceAccountFetch } from "../src/main/binance-account/network-fetch.mjs";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";

const credentials = { apiKey: "test-key", apiSecret: "test-secret" };
const config = resolveBinanceGatewayConfig({}, { routingMode: "auto",
  marketGatewayUrl: "https://market.example.invalid", privateProxyUrl: "https://private.example.invalid" });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const tick = () => new Promise(resolve => setImmediate(resolve));
const accountUrl = "https://fapi.binance.com/fapi/v3/account";

function signedPayload(input, init) {
  const url = new URL(input);
  if (url.pathname.endsWith("/time")) return Response.json({ serverTime: Date.now() });
  assert.equal(new Headers(init.headers).get("x-mbx-apikey"), credentials.apiKey);
  const signature = url.searchParams.get("signature");
  url.searchParams.delete("signature");
  assert.equal(signature, crypto.createHmac("sha256", credentials.apiSecret).update(url.search.slice(1)).digest("hex"));
  if (url.pathname.endsWith("/account")) return Response.json({ totalMarginBalance: "100",
    totalWalletBalance: "100", totalUnrealizedProfit: "0", availableBalance: "100", positions: [] });
  return Response.json([]);
}

function pipeline({ governor = new BinanceRequestGovernor({ maxConcurrency: 6, reservedAccountConcurrency: 2 }),
  directFetch = signedPayload, privateProxyFetch = signedPayload, routingMode = "auto", queueTimeoutMs,
  directAttemptTimeoutMs = 80, credentialStore = { upsert: async () => ({ bound: true }) } } = {}) {
  const router = new BinanceNetworkRouter({ config: { ...config, routingMode, directAttemptTimeoutMs },
    directFetch, privateProxyFetch,
    gatewayClient: { fetch: () => { throw new Error("account credentials must never reach public cache"); } },
    directCooldownRemaining: bucket => governor.cooldownRemaining(bucket, Date.now()),
    onDirectRateLimit: (bucket, response, now) => governor.observeResponse(bucket, response, now),
  });
  const fetch = createBinanceAccountFetch({ governor, router, queueTimeoutMs });
  const service = new BinanceAccountService({ credentialStore, fetch,
    profitCalendarFetch: createBinanceAccountFetch({ governor, router, calendar: true, queueTimeoutMs }) });
  return { governor, router, fetch, service };
}

test("a full binding completes while six slow market requests are pending", { timeout: 3000 }, async () => {
  const governor = new BinanceRequestGovernor({ maxConcurrency: 6, reservedAccountConcurrency: 2 });
  let release, marketStarts = 0, beforeSave = 0, saves = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = Array.from({ length: 6 }, (_, i) => governor.fetch(async () => {
    marketStarts++; await gate; return Response.json([]);
  }, `https://fapi.binance.com/fapi/v1/klines?symbol=TEST${i}`, {}, { source: "market", priority: 90 }));
  await tick();
  assert.equal(marketStarts, 4);
  const { service } = pipeline({ governor, directFetch: async () => { throw new Error("ECONNRESET"); },
    credentialStore: { upsert: async () => { saves++; return { bound: true }; } } });
  try {
    const result = await service.bind("owner", credentials, { beforeSave: async () => { beforeSave++; } });
    assert.equal(result.status.bound, true);
    assert.equal(result.snapshot.marginBalance, 100);
    assert.equal(beforeSave, 1); assert.equal(saves, 1);
    assert.equal(marketStarts, 4, "binding did not require finishing/cancelling any market request");
    assert.equal(governor.snapshot().queued, 2);
  } finally { release(); await Promise.all(pending); }
  assert.equal(governor.snapshot().running, 0);
  assert.equal(governor.runningMarket, 0);
});

test("queue time does not consume the signed request execution deadline", { timeout: 4000 }, async () => {
  const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const busy = governor.fetch(async () => { await gate; return Response.json([]); },
    "https://fapi.binance.com/fapi/v1/klines");
  const { service } = pipeline({ governor });
  const pending = service.signedGet({ baseUrl: "https://fapi.binance.com", pathname: "/fapi/v3/account",
    credentials, serverTime: Date.now(), timeoutMs: 1000 });
  try {
    await delay(1150);
    assert.equal(governor.snapshot().queued, 1);
    release(); await busy;
    assert.equal((await pending).totalMarginBalance, "100");
  } finally { release(); await busy; }
});

test("queued signatures are regenerated on admission, also on the cooldown fallback", async (t) => {
  for (const cooldown of [false, true]) {
    let now = 1_800_000_000_000, release, actualTimestamp;
    t.mock.method(Date, "now", () => now);
    const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
    const busy = governor.fetch(async () => { await new Promise(r => { release = r; }); return Response.json([]); },
      "https://fapi.binance.com/fapi/v1/klines");
    await tick();
    const read = (u, i) => { actualTimestamp = Number(new URL(u).searchParams.get("timestamp")); return signedPayload(u, i); };
    const { service } = pipeline({ governor, directFetch: cooldown ? () => assert.fail("direct ban bypass") : read,
      privateProxyFetch: read });
    const pending = service.signedGet({ baseUrl: "https://fapi.binance.com", pathname: "/fapi/v3/account",
      credentials, serverTime: now - 50 });
    await tick(); now += 8000;
    if (cooldown) governor.setUpstreamCooldown("futures", now + 60000);
    release(); await busy; await pending;
    assert.equal(actualTimestamp, now - 50);
    t.mock.restoreAll();
  }
});

for (const cancellation of ["abort", "queue-timeout"]) {
  test(`${cancellation} removes queued account work without network, permit or credential writes`, async () => {
    const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
    let release, networkCalls = 0;
    const busy = governor.fetch(async () => { await new Promise(r => { release = r; }); return Response.json([]); },
      "https://fapi.binance.com/fapi/v1/klines");
    await tick();
    const controller = new AbortController();
    const read = async () => { networkCalls++; return Response.json({}); };
    const { fetch } = pipeline({ governor, queueTimeoutMs: 40, directFetch: read, privateProxyFetch: read });
    const pending = fetch(accountUrl, { signal: controller.signal, headers: { "X-MBX-APIKEY": "test" } });
    const rejected = assert.rejects(pending, e => cancellation === "abort"
      ? e.name === "AbortError" : e.name === "TimeoutError" && e.stage === "queue");
    if (cancellation === "abort") controller.abort();
    await Promise.all([rejected, delay(60)]);
    assert.equal(governor.snapshot().queued, 0); assert.equal(networkCalls, 0);
    release(); await busy; assert.equal(networkCalls, 0);
  });
}

test("account time requests do not join a stalled public time request", async () => {
  const governor = new BinanceRequestGovernor({ maxConcurrency: 2, reservedAccountConcurrency: 1 });
  let release;
  const url = "https://fapi.binance.com/fapi/v1/time";
  const market = governor.fetch(async () => { await new Promise(r => { release = r; }); return Response.json({ serverTime: 1 }); }, url);
  await tick();
  try { assert.ok(await pipeline({ governor }).service.serverTime("https://fapi.binance.com", "/fapi/v1/time") > 1); }
  finally { release(); await market; }
});

test("the production factories install reserved slots and deadline-managed account/calendar fetches", async () => {
  const source = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const governorBlock = source.slice(source.indexOf("function getBinanceRequestGovernor()"),
    source.indexOf("function getBinanceGatewayConfig()"));
  const serviceBlock = source.slice(source.indexOf("function getBinanceAccountService()"),
    source.indexOf("async function resetBinanceNetworkRuntimeAfterAuthChange()"));
  const create = new Function("BinanceRequestGovernor", "BinanceAccountService", "createBinanceAccountFetch", "router", `
    let binanceRequestGovernor, binanceAccountService;
    const path = { join: () => "" }, app = { getPath: () => "" };
    const getBinanceNetworkRouter = () => router;
    const getBinanceCredentialStore = () => ({upsert: async () => ({bound:true})});
    ${governorBlock}\n${serviceBlock}
    return {governor:getBinanceRequestGovernor(), service:getBinanceAccountService()};
  `);
  const { router } = pipeline();
  const { governor, service } = create(BinanceRequestGovernor, BinanceAccountService, createBinanceAccountFetch, router);
  assert.equal(governor.maxConcurrency, 6); assert.equal(governor.reservedAccountConcurrency, 2);
  assert.equal((await service.bind("owner", credentials)).status.bound, true);
  const income = await service.signedGet({ baseUrl: "https://fapi.binance.com", pathname: "/fapi/v1/income",
    credentials, serverTime: Date.now(), networkFetch: service.profitCalendarFetch });
  assert.deepEqual(income, []);
  assert.equal(governor.snapshot().recentDiagnostics.at(-1).source, "account-calendar");
});

test("reserved lanes retain the total concurrency limit and market work resumes", async () => {
  const governor = new BinanceRequestGovernor({ maxConcurrency: 6, reservedAccountConcurrency: 2 });
  const releases = []; let active = 0, peak = 0;
  const work = async () => { active++; peak = Math.max(peak, active);
    await new Promise(r => releases.push(r)); active--; return Response.json([]); };
  const market = Array.from({ length: 6 }, (_, i) => governor.fetch(work,
    `https://fapi.binance.com/fapi/v1/klines?symbol=M${i}`, {}, { source: "market", priority: 999 }));
  await tick(); assert.equal(active, 4);
  const accounts = Array.from({ length: 3 }, (_, i) => governor.fetch(work,
    `${accountUrl}?signature=${i}`, {}, { source: "account", priority: 100 }));
  await tick(); assert.equal(active, 6);
  while (governor.snapshot().running || governor.snapshot().queued) {
    releases.splice(0).forEach(r => r()); await tick();
  }
  await Promise.all([...market, ...accounts]); assert.equal(peak, 6);
  assert.equal(governor.runningMarket, 0);
});

async function socketFixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const agent = new Agent({ connections: 8, bodyTimeout: 0, headersTimeout: 0 });
  t.after(async () => { await agent.destroy(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return (u, init) => transportFetch(`http://127.0.0.1:${server.address().port}${new URL(u).pathname}`, { ...init, dispatcher: agent });
}

for (const failure of ["time-body-stall", "signed-body-stall", "signed-body-reset"]) {
  test(`${failure}: real socket failure completes full bind through re-timed private reads`, { timeout: 4000 }, async t => {
    let directFailures = 0, privateReads = 0, saves = 0, closed = 0;
    const direct = await socketFixture(t, (req, res) => {
      const stall = failure === "time-body-stall" || req.url.endsWith("/account");
      res.writeHead(200, { "content-type": "application/json" });
      if (!stall) return res.end(JSON.stringify({ serverTime: Date.now() }));
      directFailures++; res.on("close", () => { closed++; }); res.write("{");
      if (failure.endsWith("reset")) setTimeout(() => res.destroy(), 10);
    });
    const reads = [];
    const { service, governor } = pipeline({ directFetch: direct,
      privateProxyFetch: (u, i) => { privateReads++; reads.push(new URL(u).pathname); return signedPayload(u, i); },
      credentialStore: { upsert: async () => { saves++; return { bound: true }; } } });
    const result = await service.bind("owner", credentials);
    await delay(20);
    assert.equal(result.status.bound, true); assert.equal(saves, 1);
    assert.ok(privateReads > 0); assert.ok(directFailures > 0); assert.ok(closed > 0);
    assert.ok(reads.indexOf("/fapi/v1/time") < reads.indexOf("/fapi/v3/account"));
    assert.equal(governor.snapshot().running, 0);
  });
}

test("a stalled 429 body preserves direct cooldown and immediately uses the private route", async () => {
  let cancelled = false;
  const { service, governor } = pipeline({ directFetch: async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { status: 429, headers: { "retry-after": "60" } }) });
  assert.equal((await service.bind("owner", credentials)).status.bound, true);
  assert.equal(cancelled, true); assert.ok(governor.cooldownRemaining("futures", Date.now()) > 0);
});

test("caller cancellation during direct body read must not issue a private permit", async () => {
  let bodyStarted, privateReads = 0, cancelled = false;
  const ready = new Promise(r => { bodyStarted = r; });
  const { fetch } = pipeline({ directFetch: async () => {
    bodyStarted(); return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  }, privateProxyFetch: () => { privateReads++; return Response.json({}); } });
  const controller = new AbortController();
  const pending = fetch(accountUrl, { signal: controller.signal, headers: { "X-MBX-APIKEY": "test" } });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await ready; await tick(); controller.abort(); await rejected;
  assert.equal(privateReads, 0); assert.equal(cancelled, true);
});

for (const mode of ["direct", "gateway"]) {
  test(`${mode} execution timeout stays bounded and never retries another route`, async () => {
    let direct = 0, proxy = 0;
    const stalled = () => new Response(new ReadableStream());
    const { fetch, governor } = pipeline({ routingMode: mode,
      directFetch: () => { direct++; return stalled(); }, privateProxyFetch: () => { proxy++; return stalled(); } });
    const pending = fetch(accountUrl, { headers: { "X-MBX-APIKEY": "test" } }, { timeoutMs: 40 });
    await Promise.all([assert.rejects(pending, { name: "TimeoutError" }), delay(60)]);
    assert.equal(direct, mode === "direct" ? 1 : 0); assert.equal(proxy, mode === "gateway" ? 1 : 0);
    assert.equal(governor.snapshot().running, 0);
  });
}

for (const code of [-2015, -1022]) {
  test(`authentication error ${code} is not retried or saved`, async () => {
    let proxy = 0, saved = false;
    const { service } = pipeline({ directFetch: async () => Response.json({ code }, { status: 400 }),
      privateProxyFetch: () => { proxy++; return Response.json({}); },
      credentialStore: { upsert: async () => { saved = true; } } });
    await assert.rejects(service.bind("owner", credentials), e => ["BINANCE_AUTH_FAILED", "BINANCE_SIGNATURE_INVALID"].includes(e.code));
    assert.equal(proxy, 0); assert.equal(saved, false);
  });
}
