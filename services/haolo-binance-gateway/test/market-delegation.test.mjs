import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import WebSocket from "ws";
import { requireHttpIdentity, verifyMarketDelegation } from "../src/auth.mjs";
import { loadGatewayConfig } from "../src/config.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { baseConfig, createJwt } from "./helpers.mjs";

const secret = "test-market-only-delegation-secret-32-bytes";
const origins = { free: "https://market-free.youle.pro", paid: "https://market.youle.pro" };
function token(tier, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return createJwt(secret, { sub: "mobile:account", iss: "haolo-mobile-market", aud: origins[tier],
    typ: "haolo-market-delegation", scope: "public-market", tier, iat: now, exp: now + 30,
    membershipExpiresAt: tier === "paid" ? Date.now() + 60000 : null, ...extra });
}
const config = (tier) => baseConfig({ marketDelegationSecret: secret, marketRoutingMode: "compatible",
  marketNodeTier: tier, marketFreeOrigin: origins.free, marketPaidOrigin: origins.paid });

test("delegated public credentials cannot authorize account endpoints or another node", async () => {
  for (const tier of ["free", "paid"]) {
    const credential = token(tier);
    assert.equal(verifyMarketDelegation(credential, config(tier)).marketTier, tier);
    assert.throws(() => verifyMarketDelegation(credential, config(tier === "paid" ? "free" : "paid")));
    const request = { headers: { "x-haolo-market-delegation": credential } };
    await assert.rejects(requireHttpIdentity(request, config(tier)));
    assert.equal((await requireHttpIdentity(request, config(tier), null, { market: true })).marketTier, tier);
  }
  for (const changes of [{ scope: "account" }, { iss: "other" }, { exp: 1 },
    { iat: Math.floor(Date.now() / 1000) + 60 }, { exp: Math.floor(Date.now() / 1000) + 120 },
    { membershipExpiresAt: Date.now() - 1000 }, { typ: "access" }]) {
    assert.throws(() => verifyMarketDelegation(token("paid", changes), config("paid")));
  }
});

test("delegation cannot be enabled with routing off or a weak secret", () => {
  for (const env of [
    { HAOLO_MARKET_DELEGATION_SECRET: secret },
    { HAOLO_MARKET_DELEGATION_SECRET: "short", HAOLO_MARKET_ROUTING_MODE: "compatible", HAOLO_MARKET_NODE_TIER: "free" },
  ]) assert.throws(() => loadGatewayConfig(env), /delegation/);
});

test("independent nodes accept public REST and single-use tickets; wrong-node and private use fail", async (t) => {
  const nodes = {};
  for (const tier of ["free", "paid"]) {
    const listeners = new Set();
    const gateway = createPublicGatewayServer({ config: config(tier),
      restGateway: { cache: new GatewayCache(), get: async () => ({ statusCode: 200,
        value: { node: tier }, cacheStatus: "HIT", marketType: "futures" }) },
      privateEgressCoordinator: { ready: () => true, issuePermit: () => { throw new Error("must not reach private plane"); } },
      streamPool: { stats: () => ({}), subscribe(_market, _stream, handler) { listeners.add(handler); return () => listeners.delete(handler); } } });
    await gateway.listen();
    t.after(async () => { for (const s of gateway.websocketServer.clients) s.terminate(); await gateway.close(); });
    nodes[tier] = { gateway, listeners, origin: `http://127.0.0.1:${gateway.server.address().port}` };
  }
  for (const tier of ["free", "paid"]) {
    const node = nodes[tier], other = nodes[tier === "paid" ? "free" : "paid"];
    const headers = { "x-haolo-market-delegation": token(tier) };
    assert.equal((await (await fetch(node.origin + "/fapi/v1/klines", { headers })).json()).node, tier);
    assert.equal((await fetch(other.origin + "/fapi/v1/klines", { headers })).status, 401);
    assert.equal((await fetch(node.origin + "/api/private/v1/permits", { method: "POST", headers, body: "{}" })).status, 401);
    const issued = await fetch(node.origin + "/api/market/v1/tickets", { method: "POST", headers, body: '{"codecs":["json"]}' });
    assert.equal(issued.status, 201);
    const { ticket } = await issued.json();
    const url = node.origin.replace("http", "ws") + `/stream/futures?streams=btcusdt@aggTrade&ticket=${ticket}`;
    const socket = new WebSocket(url);
    await once(socket, "open");
    const next = once(socket, "message");
    const event = { stream: "btcusdt@aggTrade", data: { e: "aggTrade", s: "BTCUSDT", p: "0.0000000012345678", q: "1.00000000", a: 1 } };
    for (const listener of node.listeners) listener(event);
    assert.deepEqual(JSON.parse(String((await next)[0])), event);
    const ended = once(socket, "close"); socket.close(); await ended;
    const replay = new WebSocket(url); replay.on("error", () => {});
    const rejected = await new Promise(resolve => replay.on("unexpected-response", (_req, res) => { resolve(res.statusCode); res.destroy(); replay.terminate(); }));
    assert.equal(rejected, 401);
  }
});
