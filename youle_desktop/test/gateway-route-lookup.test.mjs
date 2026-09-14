import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createGatewayRouteLookup, probeGatewayRoute } from "../src/main/gateway-route-lookup.mjs";
import { createProxyFreeHttpsFetch } from "../src/main/proxy-free-https-fetch.mjs";

const origin = "https://market.gateway.example";
const service = "haolo-binance-market-gateway";
const routes = [{ origin, service, candidates: ["edge.gateway.example", "203.0.113.3"] }];
const resolveWith = (lookup, host = "market.gateway.example", options = { family: 4 }) => new Promise((resolve, reject) => {
  lookup(host, options, (error, address) => error ? reject(error) : resolve(address));
});
function dnsLookup(host, _options, callback) {
  queueMicrotask(() => callback(null, host === "edge.gateway.example"
    ? [{ address: "203.0.113.1", family: 4 }, { address: "203.0.113.2", family: 4 }]
    : [{ address: "203.0.113.3", family: 4 }]));
}
function delayedProbe(latencies, observations = []) {
  return ({ address, signal }) => new Promise((resolve, reject) => {
    observations.push({ address, signal });
    const latency = latencies[address];
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      if (latency === false) reject(new Error("route unavailable")); else resolve();
    }, latency === false ? 1 : latency);
    const abort = () => { clearTimeout(timer); reject(new Error("probe cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

test("selects the fastest healthy address, coalesces cold lookups, caches and cancels losing probes", async () => {
  const observations = [];
  const lookup = createGatewayRouteLookup({ routes, lookupImpl: dnsLookup,
    probeImpl: delayedProbe({ "203.0.113.1": 40, "203.0.113.2": 2, "203.0.113.3": 80 }, observations) });
  try {
    const answers = await Promise.all(Array.from({ length: 10 }, () => resolveWith(lookup)));
    assert.deepEqual(new Set(answers), new Set(["203.0.113.2"]));
    assert.equal(observations.length, 3, "duplicate DNS addresses and concurrent requests share probes");
    assert.ok(observations.every(({ signal }) => signal.aborted));
    assert.deepEqual(await resolveWith(lookup, undefined, { family: 4, all: true }), [{ address: "203.0.113.2", family: 4 }]);
    assert.equal(observations.length, 3);
  } finally { lookup.close(); }
});

test("original route can win and a failed premium address is not returned merely because DNS resolves", async () => {
  const lookup = createGatewayRouteLookup({ routes, lookupImpl: dnsLookup,
    probeImpl: delayedProbe({ "203.0.113.1": false, "203.0.113.2": 100, "203.0.113.3": 2 }) });
  try { assert.equal(await resolveWith(lookup), "203.0.113.3"); }
  finally { lookup.close(); }
});

test("hung DNS does not delay the pinned healthy fallback", async () => {
  const lookup = createGatewayRouteLookup({ routes, lookupImpl() {}, timeoutMs: 100,
    probeImpl: async ({ address }) => assert.equal(address, "203.0.113.3") });
  try { assert.equal(await resolveWith(lookup), "203.0.113.3"); }
  finally { lookup.close(); }
});

test("expiration and failed-connection invalidation both refresh the selected route", async () => {
  let now = 0;
  let winner = "203.0.113.1";
  const lookup = createGatewayRouteLookup({ routes, lookupImpl: dnsLookup, cacheTtlMs: 100, now: () => now,
    probeImpl: async ({ address }) => { if (address !== winner) throw new Error("not healthy"); } });
  try {
    assert.equal(await resolveWith(lookup), winner);
    winner = "203.0.113.2";
    assert.equal(await resolveWith(lookup), "203.0.113.1");
    now = 101;
    assert.equal(await resolveWith(lookup), winner);
    winner = "203.0.113.3";
    lookup.invalidate("market.gateway.example");
    assert.equal(await resolveWith(lookup), winner);
  } finally { lookup.close(); }
});

test("all rejected probes fail closed; selection deadline bounds hanging DNS/probes", async () => {
  const failed = createGatewayRouteLookup({ routes, lookupImpl: dnsLookup, probeImpl: async () => { throw new Error("bad TLS"); } });
  await assert.rejects(resolveWith(failed), { code: "EHOSTUNREACH" });
  failed.close();
  const hung = createGatewayRouteLookup({ routes, lookupImpl() {}, probeImpl: () => new Promise(() => {}), timeoutMs: 20 });
  await assert.rejects(resolveWith(hung), { code: "ETIMEDOUT" });
  hung.close();
});

test("failed edge yields to an alternative, and a stale socket cannot invalidate the newer route", async () => {
  const lookup = createGatewayRouteLookup({ routes, lookupImpl: dnsLookup,
    probeImpl: delayedProbe({ "203.0.113.1": 1, "203.0.113.2": 8, "203.0.113.3": 30 }) });
  try {
    assert.equal(await resolveWith(lookup), "203.0.113.1");
    lookup.invalidate("market.gateway.example", "203.0.113.1");
    assert.equal(await resolveWith(lookup), "203.0.113.2");
    lookup.invalidate("market.gateway.example", "203.0.113.1");
    assert.equal(await resolveWith(lookup), "203.0.113.2");
  } finally { lookup.close(); }
});

test("the sole recovered pinned route remains usable with hung DNS during its cooldown", async () => {
  const lookup = createGatewayRouteLookup({ routes, lookupImpl() {}, timeoutMs: 100,
    probeImpl: async ({ address }) => assert.equal(address, "203.0.113.3") });
  try {
    assert.equal(await resolveWith(lookup), "203.0.113.3");
    lookup.invalidate("market.gateway.example", "203.0.113.3");
    assert.equal(await resolveWith(lookup), "203.0.113.3");
  } finally { lookup.close(); }
});

test("close aborts active selection and refuses new lookups", async () => {
  let probeSignal;
  const lookup = createGatewayRouteLookup({ routes, lookupImpl: dnsLookup,
    probeImpl: ({ signal }) => { probeSignal = signal; return new Promise(() => {}); } });
  const result = resolveWith(lookup);
  await new Promise((resolve) => setImmediate(resolve));
  lookup.close();
  await assert.rejects(result, { code: "ECANCELED" });
  assert.equal(probeSignal.aborted, true);
  await assert.rejects(resolveWith(lookup), { code: "ECANCELED" });
});

test("unconfigured origins and explicit IPv6 use normal DNS without production route overrides", async () => {
  const calls = [];
  const lookup = createGatewayRouteLookup({ routes, lookupImpl(host, options, callback) {
    calls.push({ host, options }); callback(null, "2001:db8::1", 6);
  }, probeImpl() { throw new Error("must not probe"); } });
  assert.equal(await resolveWith(lookup, "custom.example"), "2001:db8::1");
  assert.equal(await resolveWith(lookup, "market.gateway.example", { family: 6 }), "2001:db8::1");
  assert.equal(calls.length, 2);
  lookup.close();
});

function fixtureRequest({ body = { status: "ok", service }, status = 200, error = null, observe = () => {} } = {}) {
  return (url, options, callback) => {
    observe(url, options);
    const request = new EventEmitter();
    request.destroy = (reason) => queueMicrotask(() => request.emit("error", reason));
    request.end = () => queueMicrotask(() => {
      if (error) { request.emit("error", error); return; }
      const response = new PassThrough(); response.statusCode = status;
      callback(response); response.end(JSON.stringify(body));
    });
    return request;
  };
}

test("probe preserves Host/TLS identity and sends no business credentials", async () => {
  await probeGatewayRoute({ origin, service, address: "203.0.113.1", requestImpl: fixtureRequest({ observe(url, options) {
    assert.equal(url.href, `${origin}/health`);
    assert.equal(options.method, "GET");
    assert.equal(options.servername, "market.gateway.example");
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent, false);
    assert.deepEqual(options.headers, { accept: "application/json", "accept-encoding": "identity" });
    options.lookup(url.hostname, {}, (error, ip) => { assert.equal(error, null); assert.equal(ip, "203.0.113.1"); });
  } }) });
});

test("probe rejects certificate errors, wrong service, 503 and malformed identity", async () => {
  for (const fixture of [
    { error: Object.assign(new Error("certificate mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }) },
    { body: { status: "ok", service: "unrelated-service" } },
    { status: 503 },
    { body: { status: "down", service } },
    { body: { status: "ok", service, padding: "a".repeat(5000) } },
  ]) {
    await assert.rejects(probeGatewayRoute({ origin, service, address: "203.0.113.1", requestImpl: fixtureRequest(fixture) }));
  }
});

test("business POST failure invalidates cached route without replaying the request", async () => {
  const invalidated = [];
  let requests = 0;
  const lookup = (_host, _options, callback) => callback(null, "203.0.113.8", 4);
  lookup.invalidate = (host, address) => invalidated.push({ host, address });
  const network = createProxyFreeHttpsFetch({ allowedOrigins: [origin], routeLookup: lookup,
    requestImpl(url, options) {
      requests++;
      const request = new PassThrough();
      options.lookup(url.hostname, { family: 4 }, () => {});
      queueMicrotask(() => request.destroy(Object.assign(new Error("reset"), { code: "ECONNRESET" })));
      return request;
    }, agent: { destroy() {} } });
  await assert.rejects(network(`${origin}/api/market/v1/tickets`, { method: "POST", body: "{}" }), { code: "ECONNRESET" });
  assert.equal(requests, 1);
  assert.deepEqual(invalidated, [{ host: "market.gateway.example", address: "203.0.113.8" }]);
  network.close();
});
