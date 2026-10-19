import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { GatewayCache } from "../src/cache.mjs";
import { MarketTicketStore, MARKET_TICKET_TTL_MS } from "../src/market-tickets.mjs";

test("ticket audit distinguishes expiry, one-use consumption, unknown and malformed credentials", async () => {
  let clock = Date.now();
  const cache = new GatewayCache(), store = new MarketTicketStore(cache, { now: () => clock });
  const identity = { userId: "fixture-user", codec: "json" };
  const issued = await store.issue(identity, { clientProtocol: "2" });
  assert.equal(issued.expiresInMs, 30_000);
  const results = await Promise.all(Array.from({ length: 16 }, () => store.consume(issued.ticket)));
  assert.equal(results.filter(r => r.status === "ok").length, 1);
  assert.equal(results.filter(r => r.status === "consumed").length, 15);
  assert.deepEqual(results[0].identity, identity);
  assert.equal(results[1].audit.ticketRef, issued.audit.ticketRef);
  assert.doesNotMatch(JSON.stringify(results[1]), /fixture-user|Bearer/);
  assert.ok(!JSON.stringify(results[1]).includes(issued.ticket));
  const expiring = await store.issue(identity);
  clock += MARKET_TICKET_TTL_MS;
  assert.equal((await store.consume(expiring.ticket)).status, "expired");
  assert.equal((await store.consume(expiring.ticket)).status, "expired");
  assert.equal((await store.consume(crypto.randomBytes(32).toString("base64url"))).status, "unknown");
  assert.equal((await store.consume("not-a-ticket")).status, "invalid");
  clock += 300_001;
  assert.equal((await store.consume(expiring.ticket)).status, "unknown", "diagnostic retention cannot become permanent state");
});

test("legacy tickets remain one-use and legacy consumption is not mislabeled as a known replay", async () => {
  const cache = new GatewayCache(), store = new MarketTicketStore(cache);
  const legacy = crypto.randomBytes(32).toString("base64url");
  await cache.set(`ticket:${legacy}`, { userId: "legacy-user" }, 30_000);
  assert.equal((await store.consume(legacy)).status, "ok");
  assert.equal((await store.consume(legacy)).status, "consumed");
  const modern = await store.issue({ userId: "modern-user" });
  assert.equal((await cache.take(`ticket:${modern.ticket}`)).userId, "modern-user");
  assert.equal((await store.consume(modern.ticket)).status, "unavailable");
});

test("an unavailable configured Redis never falls back to local ticket acceptance", async () => {
  const cache = new GatewayCache({ redisUrl: "redis://offline" });
  const store = new MarketTicketStore(cache);
  const ticket = crypto.randomBytes(32).toString("base64url");
  cache.memory.set(`ticket:${ticket}`, { value: { userId: "local-shadow" }, staleUntil: Date.now() + 30_000 });
  await assert.rejects(store.issue({ userId: "user" }), { code: "WS_TICKET_STORE_UNAVAILABLE", statusCode: 503 });
  await assert.rejects(store.consume(ticket), { code: "WS_TICKET_STORE_UNAVAILABLE", statusCode: 503 });
});

test("real Redis: replicas atomically consume once and retain only bounded noncredential diagnostics", { skip: !process.env.REDIS_TEST_URL }, async () => {
  const prefix = `ticket-test:${crypto.randomUUID()}:`;
  const caches = [0, 1].map(() => new GatewayCache({ redisUrl: process.env.REDIS_TEST_URL, prefix }));
  await Promise.all(caches.map(c => c.connect()));
  let clock = Date.now();
  const stores = caches.map(c => new MarketTicketStore(c, { now: () => clock }));
  try {
    const issued = await stores[0].issue({ userId: "redis-user" }, { clientProtocol: "2" });
    const keys = stores[0].keys(issued.ticket);
    assert.ok(await caches[0].redis.pTTL(caches[0].key(keys.live)) <= 30_000);
    const results = await Promise.all(Array.from({ length: 32 }, (_, i) => stores[i % 2].consume(issued.ticket)));
    assert.equal(results.filter(r => r.status === "ok").length, 1);
    assert.equal(results.filter(r => r.status === "consumed").length, 31);
    assert.equal(await caches[0].redis.exists(caches[0].key(keys.live)), 0);
    const audit = await caches[0].redis.get(caches[0].key(keys.audit));
    assert.doesNotMatch(audit, /redis-user|Bearer/);
    assert.ok(!audit.includes(issued.ticket));
    assert.ok(await caches[0].redis.pTTL(caches[0].key(keys.audit)) <= 300_000);
    const expired = await stores[0].issue({ userId: "expired-user" });
    await caches[0].redis.del(caches[0].key(stores[0].keys(expired.ticket).live));
    clock += 30_000;
    assert.equal((await stores[1].consume(expired.ticket)).status, "expired");
  } finally {
    const keys = await caches[0].redis.keys(`${prefix}*`);
    if (keys.length) await caches[0].redis.unlink(keys);
    await Promise.all(caches.map(c => c.close()));
  }
});
