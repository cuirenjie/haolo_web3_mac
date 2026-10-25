import assert from "node:assert/strict";
import test from "node:test";
import { TrafficIdentityObserver } from "../src/traffic-identity.mjs";
import { TrafficActivity } from "../src/traffic-activity.mjs";
import { TrafficMetrics } from "../src/traffic-metrics.mjs";
import { GatewayCache } from "../src/cache.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { TradingMarketDataHub } from "../../../youle_desktop/src/main/trading-market-data-hub.mjs";
import { baseConfig } from "./helpers.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test("identity lookup caps concurrency and backs off when an old backend has no endpoint", async () => {
  let now = Date.now(), calls = 0;
  const releases = [];
  const observer = new TrafficIdentityObserver({ origin: "https://business.invalid", now: () => now,
    fetchImpl: async () => { calls++; await new Promise(resolve => releases.push(resolve)); return new Response(null, { status: 404 }); } });
  for (let i = 0; i < 100; i++) observer.observe(String(i), "fixture");
  assert.equal(observer.pending, 8);
  assert.equal(calls, 8);
  releases.forEach(release => release()); await tick();
  assert.equal(observer.pending, 0);
  now += 59_000; observer.get("0"); assert.equal(calls, 8);
  now += 1001; observer.get("0"); assert.equal(calls, 9);
  releases.at(-1)(); await tick();
});

test("identity observation is bounded, non-blocking and keeps historical payers during outages", async () => {
  let now = Date.now(), calls = 0, release;
  const observer = new TrafficIdentityObserver({ origin: "https://business.invalid", now: () => now,
    fetchImpl: async () => { calls++; await new Promise(resolve => { release = resolve; });
      return Response.json({ version: 1, classification: "paid_or_gift_v1", user_id: "user", payer: "paid", entitlement: "inactive",
        valid_until: new Date(now + 60000).toISOString() }); } });
  observer.observe("user", "private-token");
  assert.deepEqual(observer.get("user"), { payer: "unknown", entitlement: "unknown" });
  for (let i = 0; i < 100; i++) observer.get("user");
  assert.equal(calls, 1);
  release(); await tick();
  assert.deepEqual(observer.get("user"), { payer: "paid", entitlement: "inactive" });
  now += 61000;
  observer.fetch = async () => { throw Error("offline"); };
  assert.deepEqual(observer.get("user"), { payer: "paid", entitlement: "unknown" });
  await tick();
  assert.equal(observer.pending, 0);
});

test("unknown visibility, mixed consumers and expired telemetry remain distinct", () => {
  let now = 100;
  const state = new TrafficActivity(() => now), subscribed = new Set(["a@ticker", "b@ticker"]);
  assert.equal(state.combined(subscribed), "unknown");
  state.update({ version: 1, streams: [
    { stream: "a@ticker", activity: "foreground" }, { stream: "b@ticker", activity: "background" },
    { stream: "c@ticker", activity: "background" },
  ] }, subscribed);
  assert.equal(state.get("c@ticker"), "unknown");
  assert.equal(state.combined(subscribed), "mixed");
  now += 45001;
  assert.equal(state.get("a@ticker"), "unknown");
});

test("socket measurement conserves bytes across visibility transitions", () => {
  const metrics = new TrafficMetrics(), socket = { bytesWritten: 0 };
  let activity = "foreground";
  const stop = metrics.trackSocket(socket, () => ({ tier: "free", payer: "paid", entitlement: "inactive",
    activity, transport: "ws", market: "futures" }));
  socket.bytesWritten = 100; metrics.sampleSockets();
  activity = "background"; socket.bytesWritten = 120; metrics.sampleSockets();
  socket.bytesWritten = 220; stop();
  const output = metrics.prometheus();
  assert.match(output, /payer="paid".*activity="foreground".* 100/);
  assert.match(output, /activity="mixed".* 20/);
  assert.match(output, /activity="background".* 100/);
  assert.equal([...metrics.socketCounters.values()].reduce((a, b) => a + b, 0), 220);
});

for (const payer of ["paid", "free"]) test(`${payer}: telemetry preserves every trade and candle across window changes`, async t => {
  const listeners = new Map();
  const gateway = createPublicGatewayServer({ config: baseConfig(),
    restGateway: { cache: new GatewayCache(), get: async () => ({ statusCode: 200, value: { price: "1" }, cacheStatus: "HIT", marketType: "futures" }) },
    accessTokenVerifier: { verify: async () => ({ userId: "observed-user", marketTier: "free" }),
      trafficIdentity: { get: () => ({ payer, entitlement: "inactive" }) } },
    streamPool: { stats: () => ({}), subscribe(_market, stream, listener) { listeners.set(stream, listener); return () => listeners.delete(stream); } },
    onDiagnostic: () => {},
  });
  await gateway.listen();
  const origin = `http://127.0.0.1:${gateway.server.address().port}`;
  let activity = "foreground";
  const hub = new TradingMarketDataHub({ endpointProvider: async () => {
    const response = await fetch(origin + "/api/market/v1/tickets", { method: "POST", headers: { authorization: "Bearer fixture" } });
    const { ticket } = await response.json();
    return { url: origin.replace("http", "ws") + "/stream/futures?ticket=" + ticket, route: "gateway" };
  } });
  t.after(async () => { await hub.close(); for (const ws of gateway.websocketServer.clients) ws.terminate(); await gateway.close(); });
  const received = [], expected = [];
  const sub = hub.subscribe({ marketType: "futures", streams: ["btcusdt@aggTrade", "btcusdt@kline_1m"], activityProvider: () => activity }, e => received.push(e.data));
  for (let i = 0; i < 100 && listeners.size !== 2; i++) await wait(10);
  assert.equal(listeners.size, 2);
  await wait(350);
  for (const visibility of ["foreground", "background"]) {
    activity = visibility; sub.refreshActivity(); await wait(350);
    for (let a = 0; a < 100; a++) {
      const data = { e: "aggTrade", a, p: "1.000001", q: "0.000002", m: false };
      expected.push(data); listeners.get("btcusdt@aggTrade")({ stream: "btcusdt@aggTrade", data });
    }
    for (const closed of [false, true]) {
      const data = { e: "kline", k: { x: closed, t: 1000, c: "1.000001", v: "1000" } };
      expected.push(data); listeners.get("btcusdt@kline_1m")({ stream: "btcusdt@kline_1m", data });
    }
  }
  for (let i = 0; i < 100 && received.length !== expected.length; i++) await wait(10);
  assert.deepEqual(received, expected);
  const metrics = await (await fetch(origin + "/metrics", { headers: { authorization: "Bearer test-metrics-token-at-least-long-enough" } })).text();
  assert.match(metrics, new RegExp(`payer="${payer}".*activity="foreground".*family="aggTrade"`));
  assert.match(metrics, new RegExp(`payer="${payer}".*activity="background".*family="aggTrade"`));
  assert.match(metrics, /candle="open"/); assert.match(metrics, /candle="closed"/);
  assert.doesNotMatch(metrics, /observed-user|private-token|btcusdt/);
});
