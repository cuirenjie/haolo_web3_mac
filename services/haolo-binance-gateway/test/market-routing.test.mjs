import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import { GatewayCache } from "../src/cache.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { profileMarketEntitlement, marketTier } from "../src/market-routing.mjs";
import { decodeMarketPayload } from "../src/market-wire-codec.mjs";
import { baseConfig } from "./helpers.mjs";
import { createBinanceGatewayClient } from "../../../youle_desktop/src/main/binance-gateway-client.mjs";
import { resolveBinanceGatewayConfig } from "../../../youle_desktop/src/main/binance-gateway-config.mjs";

test("valid trial uses paid; expired/malformed membership cannot buy access via plan or headers", () => {
  const now = Date.now();
  for (const plan of ["trial", "basic", "pro", "flagship"]) {
    const identity = profileMarketEntitlement({ is_member: true, plan, membership_expires_at: new Date(now + 1000).toISOString() }, now);
    assert.equal(marketTier(identity, now), "paid");
    assert.equal(marketTier(identity, now + 1000), "free");
  }
  for (const profile of [{ is_member: false, plan: "flagship" }, { is_member: "true" },
    { is_member: true, membership_expires_at: "invalid" }, { is_member: true, membership_expires_at: new Date(now).toISOString() }]) {
    assert.equal(profileMarketEntitlement(profile, now).marketTier, "free");
  }
  assert.equal(profileMarketEntitlement({}).marketTier, "unknown");
});

async function fixture(t, overrides = {}) {
  const listeners = new Set();
  const config = baseConfig({ marketRoutingMode: "strict", marketNodeTier: "paid", marketCompactEnabled: true,
    marketPaidOrigin: "https://market.example", marketFreeOrigin: "https://free.example", ...overrides });
  const gateway = createPublicGatewayServer({ config, restGateway: { cache: new GatewayCache(),
    get: async () => ({ statusCode: 200, value: { price: "1.000000" }, cacheStatus: "HIT", marketType: "futures" }) },
    accessTokenVerifier: { verify: async (token) => ({ userId: token,
      marketTier: token === "free" ? "free" : token === "unknown" ? "unknown" : "paid", membershipExpiresAt: token === "free" ? null : Date.now() + 60000 }) },
    streamPool: { stats: () => ({}), subscribe(_market, _stream, listener) { listeners.add(listener); return () => listeners.delete(listener); } } });
  await gateway.listen();
  t.after(async () => { for (const socket of gateway.websocketServer.clients) socket.terminate(); await gateway.close(); });
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  const request = (token, path = "/api/market/v1/tickets", init = {}) => fetch(origin + path, { method: path.endsWith("tickets") ? "POST" : "GET",
    ...init, headers: { authorization: `Bearer ${token}`, "x-haolo-market-routing": "1", ...init.headers } });
  return { gateway, config, origin, request, listeners };
}

test("strict paid/free nodes enforce REST, tickets and direct WS; identity is authoritative", async (t) => {
  for (const tier of ["paid", "free"]) {
    const { request, origin, config } = await fixture(t, { marketNodeTier: tier });
    const wrong = tier === "paid" ? "free" : "trial";
    for (const path of ["/api/market/v1/tickets", "/fapi/v1/ticker/price"]) {
      const response = await request(wrong, path, { headers: { "x-haolo-tier": tier, "x-haolo-market-routing": "" } });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).marketOrigin, tier === "paid" ? config.marketFreeOrigin : config.marketPaidOrigin);
    }
    assert.equal((await request(tier === "paid" ? "trial" : "free")).status, 201);
    assert.equal((await request("unknown")).status, 503);
    const client = new WebSocket(origin.replace("http", "ws") + "/ws/futures", { headers: { authorization: `Bearer ${wrong}` } });
    client.on("error", () => {});
    const denied = await new Promise((resolve) => client.on("unexpected-response", (_req, response) => { resolve(response.statusCode); response.destroy(); client.terminate(); }));
    assert.equal(denied, 409);
  }
});

test("one-use negotiated socket delivers ordered exact frames and bounded traffic attribution", async (t) => {
  const { request, origin, listeners, gateway } = await fixture(t);
  const { ticket, codec } = await (await request("trial", undefined, { body: JSON.stringify({ codecs: ["hmc1"] }) })).json();
  assert.equal(codec, "hmc1");
  const client = new WebSocket(origin.replace("http", "ws") + `/stream/futures?streams=btcusdt@aggTrade&ticket=${ticket}`);
  t.after(() => client.terminate());
  const received = [];
  const done = new Promise((resolve) => client.on("message", (raw) => { received.push(JSON.parse(String(raw))); if (received.length === 100) resolve(); }));
  await once(client, "open");
  const expected = [];
  for (let a = 0; a < 100; a++) {
    const event = { stream: "btcusdt@aggTrade", data: { e: "aggTrade", E: 1790908800001, s: "BTCUSDT", a, p: "0.0000000012345678", q: "0.10000000", T: 1790908800000, m: false } };
    expected.push(event);
    for (const listener of listeners) listener(event);
  }
  await done;
  assert.equal(received[0][0], "hmc1");
  assert.deepEqual(received.map(decodeMarketPayload), expected);
  const metrics = await (await fetch(origin + "/metrics", { headers: { authorization: `Bearer ${gateway ? "test-metrics-token-at-least-long-enough" : ""}` } })).text();
  assert.match(metrics, /tier="paid".*family="aggTrade".*codec="hmc1".*legacy="false"/);
  assert.doesNotMatch(metrics, /BTCUSDT|btcusdt|trial|ticket=/);
  const replay = new WebSocket(origin.replace("http", "ws") + `/ws/futures?ticket=${ticket}`);
  replay.on("error", () => {});
  const denied = await new Promise((resolve) => replay.on("unexpected-response", (_req, response) => { resolve(response.statusCode); response.destroy(); replay.terminate(); }));
  assert.equal(denied, 401);
});

test("legacy clients remain raw and a lease releases all subscriptions before reconnect", async (t) => {
  const { request, origin, listeners } = await fixture(t, { marketSessionMaxMs: 100 });
  const { ticket, codec } = await (await request("trial")).json();
  assert.equal(codec, "json");
  const client = new WebSocket(origin.replace("http", "ws") + `/stream/futures?streams=btcusdt@aggTrade&ticket=${ticket}`);
  await once(client, "open");
  const ended = once(client, "close");
  const frame = once(client, "message");
  const event = { stream: "btcusdt@aggTrade", data: { e: "aggTrade", p: "0.00000001" } };
  for (const listener of listeners) listener(event);
  assert.deepEqual(JSON.parse(String((await frame)[0])), event);
  assert.equal((await ended)[0], 1000);
  assert.equal(listeners.size, 0);
});

test("compact rollback and zero-percent cohorts negotiate JSON for capable clients", async (t) => {
  for (const overrides of [{ marketCompactEnabled: false }, { marketCompactPercent: 0 }]) {
    const { request } = await fixture(t, overrides);
    const response = await request("trial", undefined, { body: JSON.stringify({ codecs: ["hmc1", "json"] }) });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).codec, "json");
  }
});

test("REST attribution counts avoided 304 body bytes against the same JSON baseline", async (t) => {
  const { request, origin } = await fixture(t);
  const first = await request('trial', '/fapi/v1/ticker/price');
  const bytes = Buffer.byteLength(await first.text());
  const cached = await request('trial', '/fapi/v1/ticker/price', { headers: { 'if-none-match': first.headers.get('etag') } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  const metrics = await (await fetch(origin + '/metrics', { headers: { authorization: 'Bearer test-metrics-token-at-least-long-enough' } })).text();
  const counter = name => Number(metrics.split('\n').find(line => line.startsWith(`haolo_market_traffic_${name}{`)).split(' ').at(-1));
  assert.equal(counter('payload_bytes_total'), bytes);
  assert.equal(counter('json_bytes_total'), bytes * 2);
  assert.equal(counter('messages_total'), 2);
});

test("desktop to independent paid/free gateways selects the correct ticket cache and codec", async (t) => {
  const paid = await fixture(t);
  const free = await fixture(t, { marketNodeTier: "free" });
  const config = resolveBinanceGatewayConfig({ HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.example", HAOLO_BINANCE_MARKET_FREE_URL: "https://free.example" });
  for (const token of ["free", "trial"]) {
    const client = createBinanceGatewayClient({ config, apiClient: { getTrustedAccessToken: async () => token },
      fetchImpl: (url, init) => {
        const logical = new URL(url);
        const target = logical.origin === config.marketOrigin ? paid : free;
        return fetch(target.origin + logical.pathname + logical.search, init);
      } });
    assert.equal((await client.fetch(config.marketOrigin + "/fapi/v1/ticker/price")).status, 200);
    const endpoint = new URL(await client.marketStreamEndpoint({ marketType: "futures", combined: true }));
    assert.equal(endpoint.hostname, token === "free" ? "free.example" : "market.example");
    const target = token === "free" ? free : paid;
    const socket = new WebSocket(target.origin.replace("http", "ws") + endpoint.pathname + endpoint.search + "&streams=btcusdt@aggTrade");
    t.after(() => socket.terminate());
    await once(socket, "open");
    const frame = once(socket, "message");
    const event = { stream: "btcusdt@aggTrade", data: { e: "aggTrade", E: 1790908800001, s: "BTCUSDT", a: 9, p: "0.000000001", q: "0.10000000", T: 1790908800000, m: false } };
    for (const listener of target.listeners) listener(event);
    assert.deepEqual(decodeMarketPayload(JSON.parse(String((await frame)[0]))), event);
    const ended = once(socket, "close"); socket.close(); await ended;
  }
});

test("compatible rollout serves old free clients while routing capable ones; strict is needed for isolation", async (t) => {
  const { request } = await fixture(t, { marketRoutingMode: "compatible" });
  assert.equal((await request("free", undefined, { headers: { "x-haolo-market-routing": "" } })).status, 201);
  assert.equal((await request("free")).status, 409);
});
