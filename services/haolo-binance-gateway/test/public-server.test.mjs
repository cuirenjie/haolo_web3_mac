import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { GatewayCache } from "../src/cache.mjs";
import { PrivateEgressCoordinator } from "../src/private-egress-coordinator.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { baseConfig, createJwt } from "./helpers.mjs";

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
