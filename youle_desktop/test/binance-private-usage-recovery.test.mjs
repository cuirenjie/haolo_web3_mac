import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BinancePrivateProxyTransport } from "../src/main/binance-account/private-proxy-fetch.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { BinanceAccountService } from "../src/main/binance-account/service.mjs";
import { createBinanceAccountFetch } from "../src/main/binance-account/network-fetch.mjs";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";

const config = resolveBinanceGatewayConfig({}, {
  routingMode: "auto", marketGatewayUrl: "https://market.example.invalid",
  privateProxyUrl: "https://private.example.invalid",
});
const accountUrl = "https://fapi.binance.com/fapi/v3/account";
const tick = () => new Promise(resolve => setImmediate(resolve));

async function within(promise, ms = 1000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("account result waited for usage reporting")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

function transportWith(reporter, options = {}) {
  let sequence = 0;
  return new BinancePrivateProxyTransport({
    permitProvider: async url => ({ permitId: `fixture-${++sequence}`, permitToken: "synthetic-permit",
      proxyUrl: config.privateProxyUrl, targetHost: new URL(url).hostname }),
    requestImpl: async () => ({ response: Response.json({ ok: true }) }),
    usageReporter: reporter,
    ...options,
  });
}

test("full binding succeeds while the real usage client is waiting for a stalled response body", async () => {
  const bodies = [];
  const reports = [];
  let sequence = 0, beforeSave = 0, saves = 0, upstreamReads = 0;
  const client = createBinanceGatewayClient({ config,
    apiClient: { getTrustedAccessToken: async () => "synthetic-access-token" },
    fetchImpl: async (url, init) => {
      if (url.endsWith("/permits")) {
        const metadata = JSON.parse(init.body);
        return Response.json({ permitId: `fixture-${++sequence}`, permitToken: "synthetic-permit",
          proxyUrl: config.privateProxyUrl, targetHost: metadata.marketType === "futures" ? "fapi.binance.com" : "api.binance.com" });
      }
      assert.ok(url.endsWith("/usage"));
      reports.push({ body: JSON.parse(init.body), signal: init.signal });
      return new Response(new ReadableStream({ start(controller) { bodies.push(controller); } }));
    },
  });
  const transport = new BinancePrivateProxyTransport({
    permitProvider: (url, options) => client.privateRequestPermit(url, options),
    usageReporter: (report, options) => client.reportPrivateUsage(report, options),
    requestImpl: async ({ target }) => {
      upstreamReads++;
      return { response: Response.json(target.pathname.endsWith("/time") ? { serverTime: Date.now() }
        : target.pathname.endsWith("/account") ? { totalMarginBalance: "100", totalWalletBalance: "100",
          totalUnrealizedProfit: "0", availableBalance: "100", positions: [] } : []) };
    },
  });
  const router = new BinanceNetworkRouter({ config, privateProxyFetch: transport.fetch.bind(transport),
    directFetch: async () => { throw Object.assign(new Error("synthetic reset"), { code: "ECONNRESET" }); } });
  const service = new BinanceAccountService({
    credentialStore: { upsert: async () => { saves++; return { bound: true }; } },
    fetch: createBinanceAccountFetch({ governor: new BinanceRequestGovernor({ maxConcurrency: 6,
      reservedAccountConcurrency: 2 }), router }),
  });
  const binding = service.bind("fixture-owner", { apiKey: "synthetic-key", apiSecret: "synthetic-secret" },
    { beforeSave: async () => { beforeSave++; } });
  try {
    const result = await within(binding);
    assert.equal(result.status.bound, true);
    assert.equal(result.snapshot.marginBalance, 100);
    assert.equal(beforeSave, 1);
    assert.equal(saves, 1);
    assert.equal(upstreamReads, 8);
    assert.equal(reports.length, 1, "only one report may occupy the shared gateway pool");
    assert.doesNotMatch(JSON.stringify(reports[0].body), /synthetic-key|synthetic-secret|synthetic-permit|signature/);
    await transport.close();
    await tick();
    assert.equal(reports[0].signal.aborted, true, "closing the transport cancels the real usage client");
  } finally {
    await transport.close();
    // Also release the body on the unfixed implementation so a failing baseline leaves no timer behind.
    for (const body of bodies) { try { body.enqueue(new TextEncoder().encode("{}")); body.close(); } catch {} }
    await binding.catch(() => {});
  }
});

test("throwing and rejected usage reporters preserve successful responses and subsequent reads", async () => {
  for (const reporter of [() => { throw new Error("sync report failure"); }, async () => { throw new Error("async report failure"); }]) {
    const transport = transportWith(reporter);
    try {
      for (let i = 0; i < 3; i++) assert.deepEqual(await (await within(transport.fetch(accountUrl))).json(), { ok: true });
      await tick();
    } finally { await transport.close(); }
  }
});

test("usage reporting has an independent deadline and a later request recovers", async () => {
  const signals = [];
  const transport = transportWith((_report, { signal }) => {
    signals.push(signal);
    return signals.length === 1 ? new Promise(() => {}) : true;
  }, { usageReportTimeoutMs: 40 });
  try {
    assert.equal((await within(transport.fetch(accountUrl))).status, 200);
    await delay(70);
    assert.equal(signals[0].aborted, true);
    assert.equal((await within(transport.fetch(accountUrl))).status, 200);
    await tick();
    assert.equal(signals.length, 2);
  } finally { await transport.close(); }
});

test("caller cancellation after a completed read does not cancel its usage report", async () => {
  const caller = new AbortController();
  let reportingSignal, release;
  const hold = new Promise(resolve => { release = resolve; });
  const transport = transportWith((_report, { signal }) => { reportingSignal = signal; return hold; });
  try {
    assert.equal((await within(transport.fetch(accountUrl, { signal: caller.signal }))).status, 200);
    caller.abort();
    assert.equal(reportingSignal.aborted, false);
  } finally { release(); await transport.close(); }
});

test("expired queued observations are discarded and fresh reports can still run", async t => {
  let clock = 100_000, release;
  t.mock.method(Date, "now", () => clock);
  const hold = new Promise(resolve => { release = resolve; });
  const reports = [];
  const transport = transportWith(report => { reports.push(report); return reports.length === 1 ? hold : true; });
  try {
    await within(transport.fetch(accountUrl));
    await within(transport.fetch(accountUrl));
    clock += 12_001;
    release();
    await tick();
    assert.equal(reports.length, 1);
    await within(transport.fetch(accountUrl));
    await tick();
    assert.deepEqual(reports.map(report => report.permitId), ["fixture-1", "fixture-3"]);
  } finally { release(); await transport.close(); }
});

test("pending usage stays bounded and prioritizes upstream cooldown reports", async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const reports = [];
  let status = 200;
  const transport = transportWith(report => { reports.push(report); return reports.length === 1 ? hold : true; }, {
    requestImpl: async () => ({ response: Response.json({}, { status,
      headers: status === 429 ? { "retry-after": "7", "x-mbx-used-weight-1m": "2500" } : {} }) }),
  });
  try {
    for (let i = 0; i < 80; i++) await within(transport.fetch(accountUrl));
    status = 429;
    const rejected = await within(transport.fetch(accountUrl));
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get("retry-after"), "7");
    assert.equal(reports.length, 1);
    release();
    await tick();
    assert.equal(reports.length, 65, "one running report and at most 64 queued reports");
    assert.equal(reports[1].status, 429);
    assert.equal(reports[1].retryAfterMs, 7000);
    assert.equal(reports[1].usedWeight1m, 2500);
    assert.equal(new Set(reports.map(report => report.permitId)).size, reports.length);
  } finally { release(); await transport.close(); }
});

test("closing a transport cancels reports, drops the queue and prevents later dispatch", async () => {
  const signals = [];
  const transport = transportWith((_report, { signal }) => { signals.push(signal); return new Promise(() => {}); });
  await within(transport.fetch(accountUrl));
  await within(transport.fetch(accountUrl));
  await transport.close();
  await tick();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
  await assert.rejects(transport.fetch(accountUrl), /closed/);
});

test("a stalled usage report cannot hide an invalid credential response or save a binding", async () => {
  let saves = 0;
  const transport = transportWith(() => new Promise(() => {}), {
    requestImpl: async ({ target }) => ({ response: target.pathname.endsWith("/time")
      ? Response.json({ serverTime: Date.now() }) : Response.json({ code: -2015 }, { status: 401 }) }),
  });
  const router = new BinanceNetworkRouter({ config: { ...config, routingMode: "gateway" },
    privateProxyFetch: transport.fetch.bind(transport) });
  const service = new BinanceAccountService({ credentialStore: { upsert: () => { saves++; } },
    fetch: createBinanceAccountFetch({ governor: new BinanceRequestGovernor(), router }) });
  try {
    await assert.rejects(within(service.bind("fixture", { apiKey: "synthetic", apiSecret: "synthetic" })),
      { code: "BINANCE_AUTH_FAILED" });
    assert.equal(saves, 0);
  } finally { await transport.close(); }
});

test("a failed upstream request and a rejected CONNECT retain their original outcome", async () => {
  let reports = 0;
  for (const requestImpl of [async () => { throw new DOMException("upstream timeout", "TimeoutError"); },
    async () => ({ upstream: false, response: Response.json({}, { status: 429 }) })]) {
    const transport = transportWith(() => { reports++; }, { requestImpl });
    try {
      const result = await transport.fetch(accountUrl).catch(error => error);
      assert.ok(result.name === "TimeoutError" || result.status === 429);
      assert.equal(reports, 0);
    } finally { await transport.close(); }
  }
});
