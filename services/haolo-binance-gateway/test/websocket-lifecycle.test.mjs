import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import WebSocket from "ws";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { baseConfig, createJwt } from "./helpers.mjs";

test("dead peers release capacity; healthy peers and shared subscriptions survive", { timeout: 5000 }, async t => {
  const diagnostics = [], liveStreams = new Set();
  const config = baseConfig({ maxWebsocketClientsPerUser: 2, downstreamRequestsPerMinute: 300 });
  const gateway = createPublicGatewayServer({ config, websocketHeartbeatMs: 40, onDiagnostic: e => diagnostics.push(e),
    restGateway: { cache: new GatewayCache() },
    streamPool: { stats: () => ({}), subscribe(_market, stream, callback) {
      const record = { stream, callback }; liveStreams.add(record); return () => liveStreams.delete(record);
    } } });
  const clients = [];
  t.after(async () => { clients.forEach(c => c.terminate()); await gateway.close(); });
  await gateway.listen();
  const origin = `ws://127.0.0.1:${gateway.server.address().port}`;
  const auth = { authorization: `Bearer ${createJwt(config.jwtSecret)}` };
  const open = async (options = {}) => {
    const client = new WebSocket(`${origin}/stream/futures?streams=btcusdt@ticker`, { headers: auth, ...options });
    clients.push(client); await once(client, "open"); return client;
  };
  const healthy = await open(); const dead = await open({ autoPong: false });
  const ninth = new WebSocket(`${origin}/stream/futures`, { headers: auth }); clients.push(ninth);
  const status = await new Promise(resolve => {
    ninth.on("unexpected-response", (_req, response) => { resolve({ status: response.statusCode, code: response.headers["x-haolo-error-code"] }); response.destroy(); ninth.terminate(); });
    ninth.on("error", () => {});
  });
  assert.equal(status.status, 429);
  assert.equal(status.code, "WS_USER_CONNECTION_LIMIT");
  await delay(150);
  assert.equal(dead.readyState, WebSocket.CLOSED);
  assert.equal(healthy.readyState, WebSocket.OPEN);
  assert.equal(gateway.metrics.websocketClients, 1);
  assert.equal(liveStreams.size, 1);
  const recovered = await open();
  const frame = once(recovered, "message");
  for (const record of liveStreams) record.callback({ stream: record.stream, data: { c: "123.4500" } });
  assert.equal(JSON.parse((await frame)[0]).data.c, "123.4500");
  assert.equal(gateway.metrics.websocketHeartbeatTimeouts, 1);
  assert(diagnostics.some(e => e.code === "WS_USER_CONNECTION_LIMIT" && e.userConnections === 2 && e.limit === 2));
  const text = JSON.stringify(diagnostics);
  assert(!text.includes(auth.authorization)); assert(!text.includes("00000000-0000")); assert(!text.includes("ticket="));
});

test("rate-limit diagnostics stay distinct from concurrent connection limits", { timeout: 5000 }, async t => {
  const events = [];
  const config = baseConfig({ downstreamRequestsPerMinute: 1, maxWebsocketClientsPerUser: 8 });
  const gateway = createPublicGatewayServer({ config, onDiagnostic: e => events.push(e),
    restGateway: { cache: new GatewayCache() }, streamPool: { stats: () => ({}), subscribe: () => () => {} } });
  const clients = [];
  t.after(async () => { clients.forEach(c => c.terminate()); await gateway.close(); });
  await gateway.listen();
  const url = `ws://127.0.0.1:${gateway.server.address().port}/stream/spot`;
  const options = { headers: { authorization: `Bearer ${createJwt(config.jwtSecret)}` } };
  const first = new WebSocket(url, options); clients.push(first); await once(first, "open");
  const second = new WebSocket(url, options); clients.push(second); second.on("error", () => {});
  const result = await new Promise(resolve => second.on("unexpected-response", (_request, response) => {
    resolve({ status: response.statusCode, code: response.headers["x-haolo-error-code"], retry: Number(response.headers["retry-after"]) });
    response.destroy(); second.terminate();
  }));
  assert.equal(result.status, 429); assert.equal(result.code, "WS_CONNECTION_RATE_LIMIT");
  assert(result.retry > 0 && result.retry <= 60);
  assert.equal(gateway.metrics.websocketConnectionRateLimited, 1);
  assert.equal(gateway.metrics.websocketUserConnectionLimited, 0);
  assert(events.some(e => e.code === "WS_CONNECTION_RATE_LIMIT" && e.limit === 1));
});
