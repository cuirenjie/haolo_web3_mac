import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { Agent, fetch as transportFetch } from "undici";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { BinancePublicMarketService } from "../src/main/binance-public-market-service.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { bufferBinanceResponse } from "../src/main/binance-response-body.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const candles = [[1, "93.1", "94.2", "92.8", "93.7", "100"]];
const request = { marketType: "futures", path: "/fapi/v1/klines", parameters: { symbol: "HYPEUSDT", interval: "1h" } };
const input = "https://fapi.binance.com/fapi/v1/klines?symbol=HYPEUSDT&interval=1h";
const config = resolveBinanceGatewayConfig({ HAOLO_BINANCE_ROUTING_MODE: "auto",
  HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
  HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private.haolo.example" });

async function fixture(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const agent = new Agent({ connections: 1, pipelining: 1, bodyTimeout: 0, headersTimeout: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await agent.destroy(); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return (path, init = {}) => transportFetch(base + path, { ...init, dispatcher: agent });
}

function pipeline(fetchImpl, { mode = "gateway", timeoutMs = 500, now } = {}) {
  const router = new BinanceNetworkRouter({ config: { ...config, routingMode: mode },
    directFetch: fetchImpl, gatewayClient: { fetch: fetchImpl } });
  const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
  const service = new BinancePublicMarketService({ timeoutMs: 0, now,
    fetch: (url, init) => governor.fetch(router.publicFetch.bind(router), url, init, { timeoutMs }) });
  return { router, governor, service };
}

for (const status of [200, 429, 503]) {
  test(`discarded gateway HTTP ${status} releases its connection before the next request`, { timeout: 3_000 }, async (t) => {
    let closed = false;
    const localFetch = await fixture(t, (req, res) => {
      if (req.url === "/next") return res.end("[]");
      res.on("close", () => { closed = true; });
      res.writeHead(status, { "content-type": "application/json", ...(status === 200 ? { "x-haolo-cache": "STALE" } : {}) });
      res.write("[" + " ".repeat(256 * 1024));
    });
    const router = new BinanceNetworkRouter({ config, directFetch: async () => new Response(JSON.stringify(candles)),
      gatewayClient: { fetch: (_url, init) => localFetch("/hold", init) } });
    router.markDirectFailure("public", "futures");
    assert.deepEqual(await (await router.publicFetch(input)).json(), candles);
    assert.deepEqual(await (await localFetch("/next", { signal: AbortSignal.timeout(1_000) })).json(), []);
    assert.equal(closed, true);
  });
}

for (const marketType of ["futures", "spot"]) {
  test(`${marketType} body stalls retain admission until timeout and allow a clean retry`, { timeout: 3_000 }, async (t) => {
    let calls = 0;
    let headersSent;
    const headers = new Promise((resolve) => { headersSent = resolve; });
    const localFetch = await fixture(t, (_req, res) => {
      calls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      if (calls > 1) return res.end(JSON.stringify(candles));
      res.write("["); headersSent();
    });
    const { service, governor } = pipeline((_url, init) => localFetch("/candles", init), { timeoutMs: 100 });
    const marketRequest = { ...request, marketType, path: marketType === "spot" ? "/api/v3/klines" : request.path };
    const pending = service.request(marketRequest);
    await headers; await delay(10);
    assert.equal(governor.snapshot().running, 1);
    const failed = await pending;
    assert.equal(failed.ok, false); assert.match(failed.error, /timed out/);
    assert.equal(governor.snapshot().running, 0);
    assert.equal(service.cache.size, 0);
    const retried = await service.request(marketRequest);
    assert.equal(retried.ok, true); assert.equal(retried.cached, false);
    assert.deepEqual(retried.data, candles); assert.equal(calls, 2);
  });
}

for (const mode of ["gateway", "auto"]) {
  test(`${mode} caller cancellation after headers reaches the upstream body`, { timeout: 3_000 }, async (t) => {
    let headersSent, upstreamSignal;
    const headers = new Promise((resolve) => { headersSent = resolve; });
    const localFetch = await fixture(t, (_req, res) => { res.writeHead(200); res.write("["); headersSent(); });
    const { service, governor } = pipeline((_url, init) => { upstreamSignal = init.signal; return localFetch("/hold", init); }, { mode });
    const controller = new AbortController();
    const pending = service.request(request, { signal: controller.signal });
    const rejected = assert.rejects(pending, (error) => error.name === "AbortError");
    await headers; await delay(10);
    controller.abort(new DOMException("chart closed", "AbortError"));
    await rejected; await delay(10);
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(governor.snapshot().running, 0);
    assert.equal(service.cache.size, 0);
  });
}

for (const cancelledIndex of [0, 1]) {
  test(`cancelling shared reader ${cancelledIndex} preserves the other chart`, { timeout: 3_000 }, async (t) => {
    let finish, upstreamSignal, calls = 0, headersSent;
    const headers = new Promise((resolve) => { headersSent = resolve; });
    const localFetch = await fixture(t, (_req, res) => {
      calls += 1; res.writeHead(200); res.write(" ");
      finish = () => res.end(JSON.stringify(candles)); headersSent();
    });
    const { service, governor } = pipeline((_url, init) => { upstreamSignal = init.signal; return localFetch("/hold", init); });
    const controllers = [new AbortController(), new AbortController()];
    const pending = controllers.map((controller) => service.request(request, { signal: controller.signal }));
    const rejected = assert.rejects(pending[cancelledIndex], (error) => error.name === "AbortError");
    await headers;
    controllers[cancelledIndex].abort(new DOMException("chart closed", "AbortError"));
    await rejected;
    assert.equal(upstreamSignal.aborted, false);
    finish();
    assert.deepEqual((await pending[1 - cancelledIndex]).data, candles);
    assert.equal(calls, 1); assert.equal(governor.snapshot().coalesced, 1);
  });
}

test("cancelling all shared readers releases the slot and lets the same URL retry", { timeout: 3_000 }, async (t) => {
  let calls = 0, headersSent;
  const headers = new Promise((resolve) => { headersSent = resolve; });
  const localFetch = await fixture(t, (_req, res) => {
    calls += 1; res.writeHead(200);
    if (calls > 1) return res.end(JSON.stringify(candles));
    res.write("["); headersSent();
  });
  const { service, governor } = pipeline((_url, init) => localFetch("/hold", init));
  const controllers = [new AbortController(), new AbortController()];
  const pending = controllers.map((controller) => service.request(request, { signal: controller.signal }));
  const rejected = pending.map((promise) => assert.rejects(promise, (error) => error.name === "AbortError"));
  await headers;
  controllers.forEach((controller) => controller.abort());
  await Promise.all(rejected);
  assert.deepEqual((await service.request(request)).data, candles);
  assert.equal(calls, 2); assert.equal(governor.snapshot().running, 0);
});

test("broken or invalid successful bodies never replace valid cached data", async () => {
  for (const invalid of ["[", "null", "123", "<html>upstream error</html>"]) {
    let currentMs = 1_000_000, body = invalid, calls = 0;
    const service = new BinancePublicMarketService({ now: () => currentMs,
      fetch: async () => { calls += 1; return new Response(body); } });
    assert.equal((await service.request(request)).ok, false);
    assert.equal(service.cache.size, 0);
    body = JSON.stringify(candles);
    assert.deepEqual((await service.request(request)).data, candles);
    currentMs += 1_001; body = invalid;
    const stale = await service.request(request);
    assert.equal(stale.stale, true); assert.deepEqual(stale.data, candles);
    assert.deepEqual([...service.cache.values()][0].data, candles);
    assert.equal(calls, 3);
  }
});

test("truncated HTTP errors preserve status and Retry-After without hiding authentication failures", { timeout: 3_000 }, async (t) => {
  let status = 429;
  const localFetch = await fixture(t, (req, res) => {
    res.writeHead(status, { "retry-after": "7", "content-type": "application/json" }); res.write("[");
    setTimeout(() => req.socket.destroy(), 10);
  });
  const { service } = pipeline((_url, init) => localFetch("/broken", init));
  for (status of [429, 401, 403]) {
    const result = await service.request(request);
    assert.equal(result.ok, false); assert.equal(result.status, status);
    assert.equal(result.retryAfterMs, 7_000); assert.equal(service.cache.size, 0);
  }
});

test("standalone service deadline and cancellation also cover uncooperative body streams", { timeout: 3_000 }, async () => {
  for (const cancelled of [false, true]) {
    let bodyCancelled = false;
    const caller = new AbortController();
    const service = new BinancePublicMarketService({ timeoutMs: 1_000,
      fetch: async () => new Response(new ReadableStream({ cancel() { bodyCancelled = true; } })) });
    const pending = service.request(request, { signal: caller.signal });
    if (cancelled) {
      const rejected = assert.rejects(pending, (error) => error.name === "AbortError");
      await delay(10); caller.abort(); await rejected;
    } else { assert.equal((await pending).ok, false); }
    assert.equal(bodyCancelled, true); assert.equal(service.cache.size, 0);
  }
});

test("response size limits cancel the source instead of buffering without a bound", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; },
  }));
  await assert.rejects(bufferBinanceResponse(response, { maxBytes: 4 }), /exceeded 4 bytes/);
  assert.equal(cancelled, true);
});

test("responses arriving after a deadline are explicitly discarded", { timeout: 2_000 }, async () => {
  let finish, cancelled = false;
  const governor = new BinanceRequestGovernor();
  const response = governor.fetch(() => new Promise((resolve) => { finish = resolve; }), input, {}, { timeoutMs: 20 });
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    await assert.rejects(response, (error) => error.name === "TimeoutError");
    finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await delay(10);
    assert.equal(cancelled, true); assert.equal(governor.snapshot().running, 0);
  } finally { clearTimeout(keepAlive); }
});

test("gateway hedge winners retain caller cancellation through body consumption", { timeout: 3_000 }, async (t) => {
  let headersSent, upstreamSignal;
  const headers = new Promise((resolve) => { headersSent = resolve; });
  const localFetch = await fixture(t, (_req, res) => { res.writeHead(200); res.write("["); headersSent(); });
  const { service, router } = pipeline((_url, init) => { upstreamSignal = init.signal; return localFetch("/hold", init); }, { mode: "auto" });
  router.directFetch = async () => { throw new Error("direct route unavailable"); };
  const caller = new AbortController();
  const rejected = assert.rejects(service.request(request, { signal: caller.signal }), (error) => error.name === "AbortError");
  await headers; await delay(10); caller.abort(); await rejected; await delay(10);
  assert.equal(upstreamSignal.aborted, true);
});

test("a discarded late hedge loser is cancelled even when its transport ignores abort", { timeout: 3_000 }, async () => {
  let finishDirect, cancelled = false;
  const router = new BinanceNetworkRouter({ config, publicHedgeDelayMs: 25,
    directFetch: () => new Promise((resolve) => { finishDirect = resolve; }),
    gatewayClient: { fetch: async () => new Response(JSON.stringify(candles)) },
  });
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    assert.deepEqual(await (await router.publicFetch(input)).json(), candles);
    finishDirect(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await delay(10); assert.equal(cancelled, true);
  } finally { clearTimeout(keepAlive); }
});

test("authentication failures cannot fall back to an existing successful cache", async () => {
  let currentMs = 1_000_000, status = 200;
  const service = new BinancePublicMarketService({ now: () => currentMs,
    fetch: async () => new Response(status === 200 ? JSON.stringify(candles) : "<html>denied</html>", { status }),
  });
  await service.request(request); currentMs += 1_001;
  for (status of [401, 403]) {
    const result = await service.request(request);
    assert.equal(result.ok, false); assert.equal(result.status, status); assert.equal(result.stale, undefined);
  }
  const caller = new AbortController(); caller.abort();
  await assert.rejects(service.request(request, { signal: caller.signal }), (error) => error.name === "AbortError");
});

test("already-cancelled routes never send a request or leave an unhandled fetch rejection", async () => {
  let calls = 0;
  const unexpectedFetch = async () => { calls += 1; return new Response("[]"); };
  const caller = new AbortController(); caller.abort();
  for (const mode of ["direct", "gateway", "auto"]) {
    const router = new BinanceNetworkRouter({ config: { ...config, routingMode: mode },
      directFetch: unexpectedFetch, gatewayClient: { fetch: unexpectedFetch }, privateProxyFetch: unexpectedFetch,
    });
    await assert.rejects(router.publicFetch(input, { signal: caller.signal }), (error) => error.name === "AbortError");
    await assert.rejects(router.privateFetch("https://fapi.binance.com/fapi/v3/account", { signal: caller.signal }));
  }
  await delay(0); assert.equal(calls, 0);
});
