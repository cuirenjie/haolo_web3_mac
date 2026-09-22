import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { GatewayCache } from "../src/cache.mjs";
import { BinanceRestGateway } from "../src/binance-rest.mjs";
import { PrivateEgressCoordinator } from "../src/private-egress-coordinator.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { baseConfig, createJwt } from "./helpers.mjs";

test("deployment drain keeps an accepted WebSocket alive until the client closes", { timeout: 5000 }, async () => {
  const config = baseConfig();
  const cache = new GatewayCache();
  const gateway = createPublicGatewayServer({
    config,
    restGateway: { cache },
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  const port = gateway.server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/market/v1/tickets`, {
    method: "POST", headers: { authorization: `Bearer ${createJwt(config.jwtSecret)}` },
  });
  const { ticket } = await response.json();
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/futures?ticket=${ticket}`);
  try {
    await once(client, "open");
    let closed = false;
    const closing = gateway.close().then(() => { closed = true; });
    await delay(50);
    assert.equal(closed, false);
    assert.equal(gateway.status().websockets, 1);
    const pong = once(client, "pong");
    client.ping("still-connected-after-cutover");
    assert.equal((await pong)[0].toString(), "still-connected-after-cutover");
    const ended = once(client, "close");
    client.close(1000);
    assert.equal((await ended)[0], 1000);
    await closing;
    assert.equal(gateway.status().phase, "stopped");
  } finally {
    client.terminate();
    await gateway.close();
  }
});

test("deployment drain waits for an accepted REST request before completing", { timeout: 5000 }, async () => {
  const config = baseConfig();
  let release;
  let entered;
  const accepted = new Promise((resolve) => { entered = resolve; });
  const work = new Promise((resolve) => { release = resolve; });
  const gateway = createPublicGatewayServer({
    config,
    restGateway: { cache: new GatewayCache(), async get() {
      entered();
      await work;
      return { statusCode: 200, value: { ok: true }, cacheStatus: "MISS", headers: {} };
    } },
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  const response = fetch(`http://127.0.0.1:${gateway.server.address().port}/fapi/v1/klines?symbol=BTCUSDT&interval=1m`, {
    headers: { authorization: `Bearer ${createJwt(config.jwtSecret)}` },
  });
  try {
    await accepted;
    let closed = false;
    const closing = gateway.close().then(() => { closed = true; });
    await delay(30);
    assert.equal(closed, false);
    release();
    assert.deepEqual(await (await response).json(), { ok: true });
    await closing;
  } finally { release(); await gateway.close(); }
});

test("public gateway requires Haolo auth and forwards only through REST gateway", async (t) => {
  const config = baseConfig();
  const requests = [];
  const gateway = createPublicGatewayServer({
    config,
    restGateway: {
      cache: { redis: null },
      async get(url) {
        requests.push(url);
        return { statusCode: 200, value: { ok: true }, cacheStatus: "MISS", headers: {} };
      },
    },
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  t.after(() => gateway.close());
  const port = gateway.server.address().port;
  const deniedMetrics = await fetch(`http://127.0.0.1:${port}/metrics`);
  assert.equal(deniedMetrics.status, 401);
  const allowedMetrics = await fetch(`http://127.0.0.1:${port}/metrics`, {
    headers: { authorization: `Bearer ${config.metricsToken}` },
  });
  assert.equal(allowedMetrics.status, 200);
  assert.match(await allowedMetrics.text(), /haolo_market_gateway_httpRequests/);
  const unauthorized = await fetch(`http://127.0.0.1:${port}/fapi/v1/klines?symbol=BTCUSDT&interval=1m`);
  assert.equal(unauthorized.status, 401);
  const token = createJwt(config.jwtSecret);
  const authorized = await fetch(`http://127.0.0.1:${port}/fapi/v1/klines?symbol=BTCUSDT&interval=1m`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { ok: true });
  assert.equal(requests.length, 1);
});

test("public Binance REST responses support conditional ETag requests", async (t) => {
  const config = baseConfig();
  const gateway = createPublicGatewayServer({
    config,
    restGateway: {
      cache: { redis: null },
      async get() {
        return { statusCode: 200, value: { symbol: "BTCUSDT", price: "100" }, cacheStatus: "HIT", headers: {} };
      },
    },
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  t.after(() => gateway.close());
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const headers = { authorization: `Bearer ${createJwt(config.jwtSecret)}` };
  const first = await fetch(`${origin}/fapi/v1/premiumIndex?symbol=BTCUSDT`, { headers });
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  assert.deepEqual(await first.json(), { symbol: "BTCUSDT", price: "100" });

  const cached = await fetch(`${origin}/fapi/v1/premiumIndex?symbol=BTCUSDT`, {
    headers: { ...headers, "if-none-match": etag },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("etag"), etag);
  assert.equal(cached.headers.get("content-length"), "0");
  assert.equal(cached.headers.get("x-haolo-cache"), "HIT");
  assert.equal(await cached.text(), "");
  assert.equal(gateway.metrics.restNotModified, 1);
  assert.equal(gateway.metrics.restPayloadBytes, Buffer.byteLength(JSON.stringify({ symbol: "BTCUSDT", price: "100" })));
});

test("public Binance REST errors never become conditional 304 responses", async (t) => {
  const config = baseConfig();
  const gateway = createPublicGatewayServer({
    config,
    restGateway: {
      cache: { redis: null },
      async get() {
        return { statusCode: 503, value: { error: "UPSTREAM_COOLDOWN" }, cacheStatus: "STALE", headers: {} };
      },
    },
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  t.after(() => gateway.close());
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const headers = { authorization: `Bearer ${createJwt(config.jwtSecret)}`, "if-none-match": '"error"' };
  const response = await fetch(`${origin}/fapi/v1/premiumIndex?symbol=BTCUSDT`, { headers });
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("etag"), false);
  assert.deepEqual(await response.json(), { error: "UPSTREAM_COOLDOWN" });
  assert.equal(gateway.metrics.restNotModified, 0);
});

for (const path of ["/fapi/v1/depth?symbol=BTCUSDT&limit=5", "/fapi/v1/aggTrades?symbol=BTCUSDT&limit=5"]) {
  test(`order-flow REST ${path.split("?")[0]} does not use ETag`, async (t) => {
    const config = baseConfig();
    const gateway = createPublicGatewayServer({
      config,
      restGateway: {
        cache: { redis: null },
        async get() { return { statusCode: 200, value: [{ id: 1 }], cacheStatus: "HIT", headers: {} }; },
      },
      streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
    });
    await gateway.listen();
    t.after(() => gateway.close());
    const url = `http://127.0.0.1:${gateway.server.address().port}${path}`;
    const headers = { authorization: `Bearer ${createJwt(config.jwtSecret)}`, "if-none-match": '"not-used"' };
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("etag"), false);
    assert.deepEqual(await response.json(), [{ id: 1 }]);
  });
}

test("fresh REST cache hits do not consume the weighted upstream user budget", async (t) => {
  const config = baseConfig({
    downstreamRequestsPerMinute: 10,
    downstreamBurstRequestsPerMinute: 100,
  });
  let upstreamCalls = 0;
  const restGateway = new BinanceRestGateway({
    config,
    cache: new GatewayCache(),
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response("[]", { status: 200 });
    },
  });
  const gateway = createPublicGatewayServer({
    config,
    restGateway,
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  t.after(() => gateway.close());
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const headers = { authorization: `Bearer ${createJwt(config.jwtSecret)}` };
  const firstUrl = `${origin}/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500`;
  const first = await fetch(firstUrl, { headers });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-haolo-cache"), "MISS");
  assert.equal(first.headers.get("x-ratelimit-remaining"), "5");
  const cached = await fetch(firstUrl, { headers });
  assert.equal(cached.status, 200);
  assert.equal(cached.headers.get("x-haolo-cache"), "HIT");
  assert.equal(cached.headers.get("x-ratelimit-remaining"), "5");
  const second = await fetch(`${origin}/fapi/v1/klines?symbol=ETHUSDT&interval=1m&limit=500`, { headers });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("x-ratelimit-remaining"), "0");
  const limited = await fetch(`${origin}/fapi/v1/klines?symbol=SOLUSDT&interval=1m&limit=500`, { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("x-haolo-rate-limit-source"), "gateway-downstream");
  assert.equal(upstreamCalls, 2);
});

test("Binance's observed request weight raises the shared public egress floor", async (t) => {
  const config = baseConfig({
    downstreamRequestsPerMinute: 100,
    downstreamBurstRequestsPerMinute: 100,
    publicFuturesUpstreamWeightPerMinute: 10,
  });
  let upstreamCalls = 0;
  const restGateway = new BinanceRestGateway({
    config,
    cache: new GatewayCache(),
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response("[]", {
        status: 200,
        headers: { "x-mbx-used-weight-1m": "9" },
      });
    },
  });
  const gateway = createPublicGatewayServer({
    config,
    restGateway,
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  t.after(() => gateway.close());
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const headers = { authorization: `Bearer ${createJwt(config.jwtSecret)}` };
  const first = await fetch(`${origin}/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500`, { headers });
  assert.equal(first.status, 200);
  const limited = await fetch(`${origin}/fapi/v1/klines?symbol=ETHUSDT&interval=1m&limit=500`, { headers });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("x-haolo-rate-limit-source"), "gateway-downstream");
  assert.equal(upstreamCalls, 1);
});

test("public gateway exchanges main-process JWT for a one-use WebSocket ticket", async (t) => {
  const config = baseConfig();
  const cache = new GatewayCache();
  const gateway = createPublicGatewayServer({
    config,
    restGateway: { cache, async get() { throw new Error("not used"); } },
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
  });
  await gateway.listen();
  t.after(() => gateway.close());
  const port = gateway.server.address().port;
  const token = createJwt(config.jwtSecret);
  const ticketResponse = await fetch(`http://127.0.0.1:${port}/api/market/v1/tickets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(ticketResponse.status, 201);
  const { ticket } = await ticketResponse.json();
  const first = new WebSocket(`ws://127.0.0.1:${port}/ws/futures?ticket=${ticket}`);
  await new Promise((resolve, reject) => {
    first.once("open", resolve);
    first.once("error", reject);
  });
  first.close();
  const secondStatus = await new Promise((resolve) => {
    const second = new WebSocket(`ws://127.0.0.1:${port}/ws/futures?ticket=${ticket}`);
    second.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    second.once("open", () => resolve(101));
    second.once("error", () => {});
  });
  assert.equal(secondStatus, 401);

  const invalidTicketResponse = await fetch(`http://127.0.0.1:${port}/api/market/v1/tickets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const { ticket: invalidTicket } = await invalidTicketResponse.json();
  const invalidStream = new WebSocket(`ws://127.0.0.1:${port}/stream/futures?streams=btcusdt@userData&ticket=${invalidTicket}`);
  const closeCode = await new Promise((resolve, reject) => {
    invalidStream.once("close", resolve);
    invalidStream.once("error", reject);
  });
  assert.equal(closeCode, 1008);
  assert.equal(gateway.metrics.websocketClients, 0);
});

test("public control plane issues sanitized private egress permits and shares upstream cooldown", async (t) => {
  const config = baseConfig();
  const cache = new GatewayCache();
  const coordinator = new PrivateEgressCoordinator({ config, cache });
  const gateway = createPublicGatewayServer({
    config,
    restGateway: { cache, async get() { throw new Error("not used"); } },
    streamPool: { stats: () => ({}), subscribe() { return () => {}; } },
    privateEgressCoordinator: coordinator,
  });
  await gateway.listen();
  t.after(() => gateway.close());
  const port = gateway.server.address().port;
  const token = createJwt(config.jwtSecret);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const permitResponse = await fetch(`http://127.0.0.1:${port}/api/private/v1/permits`, {
    method: "POST",
    headers,
    body: JSON.stringify({ marketType: "futures", pathname: "/fapi/v3/account", hasSymbol: false }),
  });
  assert.equal(permitResponse.status, 201);
  const permit = await permitResponse.json();
  assert.equal(permit.shardId, "sg-a");
  assert.equal(permit.targetHost, "fapi.binance.com");
  assert.equal(permit.weight, 5);
  assert.doesNotMatch(JSON.stringify(permit), /apiKey|signature|timestamp/i);
  for (const [pathname, hasSymbol] of [["/fapi/v1/order", true], ["/fapi/v1/algoOrder", false]]) {
    const cancelled = await fetch(`http://127.0.0.1:${port}/api/private/v1/permits`, {
      method: "POST", headers,
      body: JSON.stringify({ marketType: "futures", pathname, hasSymbol, method: "DELETE" }),
    });
    assert.equal(cancelled.status, 201);
    assert.equal((await cancelled.json()).weight, 1);
  }
  const forbidden = await fetch(`http://127.0.0.1:${port}/api/private/v1/permits`, {
    method: "POST", headers,
    body: JSON.stringify({ marketType: "futures", pathname: "/fapi/v1/order", hasSymbol: true, method: "POST" }),
  });
  assert.equal(forbidden.status, 403);
  const report = await fetch(`http://127.0.0.1:${port}/api/private/v1/usage`, {
    method: "POST",
    headers,
    body: JSON.stringify({ permitId: permit.permitId, status: 429, retryAfterMs: 10_000 }),
  });
  assert.equal(report.status, 202);
  const cooled = await fetch(`http://127.0.0.1:${port}/api/private/v1/permits`, {
    method: "POST",
    headers,
    body: JSON.stringify({ marketType: "futures", pathname: "/fapi/v3/account", hasSymbol: false }),
  });
  assert.equal(cooled.status, 429);
  assert.equal((await cooled.json()).error, "EGRESS_UPSTREAM_COOLDOWN");
});
