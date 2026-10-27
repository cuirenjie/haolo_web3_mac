import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { Agent, fetch as transportFetch } from "undici";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { BinancePublicMarketService } from "../src/main/binance-public-market-service.mjs";

const candles = [[1800000000000, "10", "12", "9", "11", "5", 1800003599999]];
const input = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=501";
const request = { marketType: "futures", path: "/fapi/v1/klines",
  parameters: { symbol: "BTCUSDT", interval: "1h", limit: 501 } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = resolveBinanceGatewayConfig({}, { routingMode: "auto", marketGatewayUrl: "https://market.example.invalid" });
const ok = res => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(candles)); };
const hold = res => { res.writeHead(200, { "content-type": "application/json" }); res.write("["); };

async function fixture(t, handler, options = {}) {
  const calls = [], signals = [], closed = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    res.on("close", () => closed.push(req.url));
    handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const agent = new Agent({ connections: 4, pipelining: 1, bodyTimeout: 0, headersTimeout: 0 });
  const fetchRoute = route => (_url, init) => {
    signals.push({ route, signal: init.signal });
    return transportFetch(`http://127.0.0.1:${server.address().port}/${route}`, { ...init, dispatcher: agent });
  };
  const router = new BinanceNetworkRouter({ config, publicHedgeDelayMs: 25,
    directFetch: fetchRoute("direct"), gatewayClient: { fetch: fetchRoute("gateway") }, ...options });
  const governor = new BinanceRequestGovernor({ maxConcurrency: 1 });
  const service = new BinancePublicMarketService({ timeoutMs: 0,
    fetch: (url, init) => governor.fetch(router.publicFetch.bind(router), url, init, {
      timeoutMs: 1500, publicFallbackFetch: router.publicGatewayOnlyFetch.bind(router),
    }),
  });
  t.after(async () => {
    await service.close(); router.close(); await agent.destroy(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return { router, service, governor, calls, signals, closed };
}

test("direct headers cannot cancel a gateway whose complete candles arrive first", { timeout: 3000 }, async t => {
  const { router, service, signals, calls } = await fixture(t, (req, res) => {
    if (req.url === "/direct") hold(res); else ok(res);
  });
  const result = await service.request(request);
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.route, "public-gateway");
  assert.deepEqual(result.data, candles);
  assert.deepEqual(calls, ["/direct", "/gateway"]);
  assert.equal(signals.find(s => s.route === "direct").signal.aborted, true);
  assert.equal(router.snapshot()["public:futures"].healthyRemainingMs, 0);
});

test("gateway headers cannot cancel a slower direct response with complete candles", { timeout: 3000 }, async t => {
  const { router, service, signals } = await fixture(t, (req, res) => {
    if (req.url === "/gateway") hold(res); else setTimeout(() => ok(res), 120);
  });
  const result = await service.request(request);
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.route, "direct");
  assert.deepEqual(result.data, candles);
  assert.equal(signals.find(s => s.route === "gateway").signal.aborted, true);
  assert.ok(router.snapshot()["public:futures"].healthyRemainingMs > 0);
});

for (const kind of ["reset", "truncated-json", "html", "null", "wrong-shape"]) {
  for (const preferred of ["direct", "gateway"]) {
    test(`${preferred} preferred route with ${kind} recovers within the same request`, { timeout: 3000 }, async t => {
      const { router, service, calls } = await fixture(t, (req, res) => {
        if (req.url !== `/${preferred}`) return ok(res);
        if (kind === "reset") {
          hold(res); setTimeout(() => req.socket.destroy(), 10); return;
        }
        res.end({ "truncated-json": "[[1,", html: "<html>upstream error</html>", null: "null", "wrong-shape": "{}" }[kind]);
      });
      if (preferred === "direct") router.markDirectSuccess("public", "futures");
      else router.markDirectSlow("public", "futures");
      const result = await service.request(request);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, candles);
      assert.equal(result.diagnostics.route, preferred === "direct" ? "public-gateway" : "direct");
      assert.deepEqual(calls, [`/${preferred}`, preferred === "direct" ? "/gateway" : "/direct"]);
      assert.equal(service.cache.size, 1);
      if (preferred === "direct") {
        assert.equal(router.snapshot()["public:futures"].healthyRemainingMs, 0);
        assert.ok(router.snapshot()["public:futures"].failures > 0);
      }
    });
  }
}

for (const preferred of ["direct", "gateway"]) test(`${preferred} body deadline leaves time for the alternative route`, { timeout: 3000 }, async t => {
  const { router, service, signals } = await fixture(t, (req, res) => {
    if (req.url === `/${preferred}`) hold(res); else ok(res);
  }, { config: { ...config, directAttemptTimeoutMs: 80 }, chartGatewayAttemptTimeoutMs: 80 });
  if (preferred === "direct") router.markDirectSuccess("public", "futures");
  else router.markDirectSlow("public", "futures");
  const result = await service.request(request);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, candles);
  assert.equal(signals.find(s => s.route === preferred).signal.aborted, true);
});

test("both broken bodies fail without caching or creating a healthy lease; a later request can recover", { timeout: 3000 }, async t => {
  let online = false;
  const { router, service } = await fixture(t, (_req, res) => online ? ok(res) : res.end("["));
  assert.equal((await service.request(request)).ok, false);
  assert.equal(service.cache.size, 0);
  assert.equal(router.snapshot()["public:futures"].healthyRemainingMs, 0);
  online = true;
  assert.deepEqual((await service.request(request)).data, candles);
});

test("cancelling during the race aborts both bodies, frees admission, and does not cache a late response", { timeout: 3000 }, async t => {
  let bothStarted;
  const ready = new Promise(resolve => { bothStarted = resolve; });
  let count = 0;
  const { router, service, governor, signals } = await fixture(t, (_req, res) => {
    hold(res); if (++count === 2) bothStarted();
  });
  const caller = new AbortController();
  const rejected = assert.rejects(service.request(request, { signal: caller.signal }), { name: "AbortError" });
  await ready;
  caller.abort(); await rejected; await delay(20);
  assert.ok(signals.every(s => s.signal.aborted));
  assert.equal(governor.snapshot().running, 0);
  assert.equal(service.cache.size, 0);
  assert.equal(router.snapshot()["public:futures"].healthyRemainingMs, 0);
});

test("one cancelled consumer cannot abort the other chart's route recovery", { timeout: 3000 }, async t => {
  let release, gatewayStarted;
  const ready = new Promise(resolve => { gatewayStarted = resolve; });
  const { service, calls } = await fixture(t, (req, res) => {
    if (req.url === "/direct") { res.end("["); return; }
    res.writeHead(200); res.write(" "); release = () => res.end(JSON.stringify(candles)); gatewayStarted();
  });
  const caller = new AbortController();
  const first = assert.rejects(service.request(request, { signal: caller.signal }), { name: "AbortError" });
  const second = service.request(request);
  await ready; caller.abort(); await first; release();
  assert.deepEqual((await second).data, candles);
  assert.deepEqual(calls, ["/direct", "/gateway"]);
});

test("a gateway body timeout never bypasses a direct exchange cooldown", { timeout: 3000 }, async t => {
  const { router, service, calls } = await fixture(t, (_req, res) => hold(res), { chartGatewayAttemptTimeoutMs: 50 });
  router.observeDirectRateLimit("futures", new Response(null, { status: 429, headers: { "retry-after": "60" } }));
  router.markDirectSlow("public", "futures");
  const result = await service.request(request);
  assert.equal(result.ok, false);
  assert.match(result.error, /gateway attempt timed out/);
  assert.deepEqual(calls, ["/gateway"]);
});

test("conditional 304 and explicit gateway authentication failures keep their original semantics", async () => {
  for (const status of [304, 401, 403, 404]) {
    let directCalls = 0;
    const router = new BinanceNetworkRouter({ config,
      directFetch: async () => { directCalls++; return Response.json(candles); },
      gatewayClient: { fetch: async () => new Response(null, { status, headers: { etag: '"same-history"' } }) },
    });
    router.markDirectSlow("public", "futures");
    const result = await router.publicFetch(input);
    assert.equal(result.status, status);
    assert.equal(result.headers.get("etag"), '"same-history"');
    assert.equal(directCalls, 0);
    router.close();
  }
});
