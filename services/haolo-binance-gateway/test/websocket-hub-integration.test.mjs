import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import WebSocket from "ws";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { baseConfig, createJwt } from "./helpers.mjs";
import { TradingMarketDataHub } from "../../../youle_desktop/src/main/trading-market-data-hub.mjs";

async function until(predicate, timeoutMs = 3500) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) { assert(Date.now() < end, "condition did not recover within deadline"); await delay(10); }
}

test("eight occupied slots reject the ninth, then fresh tickets restore shared subscriptions after dead peers retire", { timeout: 8000 }, async t => {
  const config = baseConfig({ maxWebsocketClientsPerUser: 8, downstreamRequestsPerMinute: 300 });
  const listeners = new Set(), diagnostics = [];
  const gateway = createPublicGatewayServer({ config, websocketHeartbeatMs: 100, onDiagnostic: e => diagnostics.push(e),
    restGateway: { cache: new GatewayCache() }, streamPool: { stats: () => ({}), subscribe(_market, stream, callback) {
      const entry = { stream, callback }; listeners.add(entry); return () => listeners.delete(entry);
    } } });
  await gateway.listen();
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const headers = { authorization: `Bearer ${createJwt(config.jwtSecret)}` };
  const peers = [];
  let hub;
  t.after(async () => { await hub?.close(); peers.forEach(peer => peer.terminate()); await gateway.close(); });
  for (let i = 0; i < 8; i++) {
    const peer = new WebSocket(origin.replace("http:", "ws:") + "/stream/futures", { headers, autoPong: i === 0 });
    peers.push(peer); await once(peer, "open");
  }
  let tickets = 0;
  hub = new TradingMarketDataHub({ reconnectBaseMs: 10, idleCloseMs: 30, closeTimeoutMs: 100, endpointProvider: async () => {
    tickets++;
    const response = await fetch(origin + "/api/market/v1/tickets", { method: "POST", headers });
    assert.equal(response.status, 201);
    return { url: origin.replace("http:", "ws:") + "/stream/futures?ticket=" + (await response.json()).ticket, route: "gateway" };
  } });
  const health = [], frames = [], handles = [];
  for (let i = 0; i < 12; i++) handles.push(hub.subscribe({ marketType: "futures", streams: ["btcusdt@ticker"] },
    e => frames.push(e), e => health.push(e)));
  await until(() => gateway.metrics.websocketUserConnectionLimited === 1);
  assert.equal(health.some(e => e.status === "connected"), false);
  await until(() => health.some(e => e.status === "connected"));
  assert.equal(config.maxWebsocketClientsPerUser, 8);
  assert.equal(gateway.metrics.websocketHeartbeatTimeouts, 7);
  assert.equal(peers[0].readyState, WebSocket.OPEN);
  assert.equal(tickets, 2, "recovery obtains a fresh one-use ticket only once for all consumers");
  assert.equal(hub.stats().sockets, 1);
  for (const listener of listeners) listener.callback({ stream: listener.stream, data: { c: "123.45000000" } });
  await until(() => frames.length === 12);
  assert(frames.every(e => e.data.c === "123.45000000"));
  await Promise.all(handles.map(handle => handle.dispose()));
  await until(() => gateway.metrics.websocketClients === 1);
  assert.equal(listeners.size, 0);
  assert(diagnostics.some(e => e.code === "WS_USER_CONNECTION_LIMIT" && e.userConnections === 8));
});
