import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import { createMarketFrameEncoder } from "../src/market-frame.mjs";
import { compressionCohort } from "../src/ws-compression.mjs";
import { loadGatewayConfig } from "../src/config.mjs";
import { startGateway } from "../src/server.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { baseConfig } from "./helpers.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";

test("shared event serializes once per wire format for 2000 subscribers", () => {
  let calls = 0;
  const encode = createMarketFrameEncoder((value) => { calls++; return JSON.stringify(value); });
  const event = Object.freeze({ stream: "btcusdt@aggTrade", data: { a: 123, p: "666.01", q: "0.01" } });
  for (let i = 0; i < 2000; i++) {
    assert.equal(encode(event, false).text, JSON.stringify(event.data));
    assert.equal(encode(event, true).text, JSON.stringify({ stream: event.stream, data: event.data }));
  }
  assert.equal(calls, 2);
  assert.strictEqual(encode(event, true), encode(event, true));
  encode({ ...event, data: { ...event.data, a: 124 } }, true);
  assert.equal(calls, 3);
});

test("market-only production config needs no business signing key or private shard", () => {
  const env = { NODE_ENV: "production", HAOLO_GATEWAY_ROLE: "market",
    HAOLO_MARKET_REDIS_URL: "redis://redis:6379", HAOLO_GATEWAY_METRICS_TOKEN: "test-metrics-token-at-least-24-chars" };
  const config = loadGatewayConfig(env);
  assert.equal(config.jwtSecret, "");
  assert.deepEqual(config.privateEgressShards, []);
  assert.equal(config.wsCompressionPercent, 0);
  assert.throws(() => loadGatewayConfig({ ...env, HAOLO_GATEWAY_ALLOW_ANONYMOUS_PUBLIC: "true" }), /cannot allow anonymous/);
});

test("compression cohorts are stable and opt-in", () => {
  assert.equal(compressionCohort("alice", 0), false);
  assert.equal(compressionCohort("alice", 100), true);
  const selected = Array.from({ length: 1000 }, (_, i) => compressionCohort(String(i), 20));
  assert.ok(selected.filter(Boolean).length > 150 && selected.filter(Boolean).length < 250);
  assert.deepEqual(selected, Array.from({ length: 1000 }, (_, i) => compressionCohort(String(i), 20)));
});

test("recovering a slow quote client cannot deliver an older quote after a new one", async () => {
  let publish;
  const gateway = createPublicGatewayServer({ config: baseConfig({ allowAnonymousPublic: true }),
    restGateway: { cache: new GatewayCache() },
    streamPool: { stats: () => ({}), subscribe(_market, _stream, listener) { publish = listener; return () => {}; } } });
  await gateway.listen();
  const client = new WebSocket(`ws://127.0.0.1:${gateway.server.address().port}/stream/futures?streams=btcusdt@ticker`);
  try {
    await once(client, "open");
    const serverSocket = [...gateway.websocketServer.clients][0];
    let buffered = 600000;
    Object.defineProperty(serverSocket, "bufferedAmount", { get: () => buffered });
    const received = [];
    client.on("message", (raw) => received.push(JSON.parse(String(raw)).data.n));
    publish({ stream: "btcusdt@ticker", data: { n: 1 } });
    buffered = 0;
    const message = once(client, "message");
    publish({ stream: "btcusdt@ticker", data: { n: 2 } });
    await message;
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(received, [2]);
  } finally { const closed = once(client, "close"); client.close(); await closed; await gateway.close(); }
});

for (const percent of [0, 100]) test(`real sockets preserve frames/order with compression ${percent}%`, async () => {
  const listeners = [];
  const gateway = await startGateway({
    config: baseConfig({ gatewayRole: "market", authApiOrigin: "https://haolo.com", wsCompressionPercent: percent }),
    cache: new GatewayCache(),
    restGateway: { cache: new GatewayCache() },
    accessTokenVerifier: { verify: async () => ({ userId: "test-user" }) },
    streamPool: { stats: () => ({}), subscribe(_market, _stream, listener) { listeners.push(listener); return () => {}; }, close: async () => {} },
  });
  const port = gateway.publicGateway.server.address().port;
  assert.equal(gateway.privateProxy, null);
  assert.equal(gateway.privateEgressCoordinator, null);
  const client = new WebSocket(`ws://127.0.0.1:${port}/stream/futures?streams=btcusdt@aggTrade`, {
    headers: { authorization: "Bearer fixture" }, perMessageDeflate: true,
  });
  try {
    await once(client, "open");
    assert.equal(client.extensions.includes("permessage-deflate"), percent === 100);
    const received = [];
    const done = new Promise((resolve) => client.on("message", (data, binary) => {
      assert.equal(binary, false); received.push(JSON.parse(String(data)));
      if (received.length === 30) resolve();
    }));
    for (let n = 0; n < 30; n++) listeners[0]({ stream: "btcusdt@aggTrade", data: { n, padding: "x".repeat(2048) } });
    await Promise.race([done, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("delivery timeout")), 3000); timer.unref(); })]);
    assert.deepEqual(received.map((x) => x.data.n), Array.from({ length: 30 }, (_, i) => i));
    const denied = await fetch(`http://127.0.0.1:${port}/api/private/v1/permits`, { method: "POST" });
    assert.equal(denied.status, 503);
  } finally {
    const closed = once(client, "close"); client.close(); await closed; await gateway.close();
  }
});
