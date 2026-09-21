import assert from "node:assert/strict";
import test from "node:test";
import { GatewayCache } from "../src/cache.mjs";
import { classifyPrivateRoute, PrivateEgressCoordinator } from "../src/private-egress-coordinator.mjs";
import { baseConfig } from "./helpers.mjs";

const identity = { userId: "00000000-0000-0000-0000-000000000001" };

function shard(id, proxyUrl) {
  return { id, proxyUrl, spotWeightLimitPerMinute: 100, futuresWeightLimitPerMinute: 100, enabled: true };
}

test("private route weights are server-owned and reject trading routes", () => {
  assert.deepEqual(classifyPrivateRoute({ marketType: "futures", pathname: "/fapi/v3/account" }), {
    marketType: "futures",
    pathname: "/fapi/v3/account",
    hasSymbol: false,
    weight: 5,
    priority: "core",
    targetHost: "fapi.binance.com",
  });
  assert.equal(classifyPrivateRoute({ marketType: "futures", pathname: "/fapi/v1/openOrders", hasSymbol: true }).weight, 1);
  assert.equal(classifyPrivateRoute({ marketType: "futures", pathname: "/fapi/v1/openOrders", hasSymbol: false }).weight, 40);
  assert.throws(
    () => classifyPrivateRoute({ marketType: "futures", pathname: "/fapi/v1/order" }),
    /not allowed/,
  );
});

test("rendezvous assignment is stable and independent of shard list order", () => {
  const shards = [shard("sg-a", "https://sg-a.example"), shard("sg-b", "https://sg-b.example")];
  const first = new PrivateEgressCoordinator({ config: baseConfig({ privateEgressShards: shards }), cache: new GatewayCache() });
  const second = new PrivateEgressCoordinator({ config: baseConfig({ privateEgressShards: [...shards].reverse() }), cache: new GatewayCache() });
  assert.equal(first.selectShard(identity.userId).id, second.selectShard(identity.userId).id);
});

test("single futures cancellations receive permits while other writes stay forbidden", async () => {
  const coordinator = new PrivateEgressCoordinator({
    config: baseConfig({ privateEgressShards: [shard("sg-a", "https://sg-a.example")] }),
    cache: new GatewayCache(),
  });
  for (const metadata of [
    { marketType: "futures", pathname: "/fapi/v1/order", hasSymbol: true, method: "DELETE" },
    { marketType: "futures", pathname: "/fapi/v1/algoOrder", hasSymbol: false, method: "DELETE" },
  ]) {
    const permit = await coordinator.issuePermit(identity, metadata);
    assert.equal(permit.weight, 1);
    assert.equal(permit.priority, "core");
    assert.equal(permit.targetHost, "fapi.binance.com");
    assert.ok(permit.permitToken);
    await assert.rejects(() => coordinator.issuePermit({}, metadata), (error) => error.statusCode === 401);
  }
  for (const metadata of [
    { marketType: "futures", pathname: "/fapi/v1/order", hasSymbol: false, method: "DELETE" },
    { marketType: "spot", pathname: "/api/v3/order", hasSymbol: true, method: "DELETE" },
    { marketType: "futures", pathname: "/fapi/v1/allOpenOrders", hasSymbol: true, method: "DELETE" },
    { marketType: "futures", pathname: "/fapi/v1/algoOpenOrders", method: "DELETE" },
    { marketType: "futures", pathname: "/fapi/v1/order?symbol=BTCUSDT", hasSymbol: true, method: "DELETE" },
    ...["POST", "PUT", "PATCH"].map((method) => ({ marketType: "futures", pathname: "/fapi/v1/order", hasSymbol: true, method })),
    { marketType: "futures", pathname: "/fapi/v1/leverage", hasSymbol: true, method: "POST" },
    { marketType: "futures", pathname: "/fapi/v3/account", method: "DELETE" },
  ]) {
    await assert.rejects(() => coordinator.issuePermit(identity, metadata), (error) => error.code === "PRIVATE_ROUTE_FORBIDDEN");
  }
  assert.equal(coordinator.metrics.permitsIssued, 2);
});

test("cancellation permits retain per-user budgets and upstream cooldowns", async () => {
  const metadata = { marketType: "futures", pathname: "/fapi/v1/order", hasSymbol: true, method: "DELETE" };
  const coordinator = new PrivateEgressCoordinator({
    config: baseConfig({
      privateEgressShards: [shard("sg-a", "https://sg-a.example")],
      privateUserFuturesWeightPerMinute: 1,
    }),
    cache: new GatewayCache(),
    now: () => Date.UTC(2026, 8, 21),
  });
  const permit = await coordinator.issuePermit(identity, metadata);
  await assert.rejects(() => coordinator.issuePermit(identity, metadata), (error) => error.code === "EGRESS_USER_BUDGET_EXHAUSTED");
  await coordinator.reportUsage(identity, { permitId: permit.permitId, status: 429, retryAfterMs: 30_000 });
  await assert.rejects(() => coordinator.issuePermit(identity, metadata), (error) => error.code === "EGRESS_UPSTREAM_COOLDOWN");
});

test("rendezvous topology changes move only users affected by the added or removed shard", () => {
  const cache = new GatewayCache();
  const a = shard("sg-a", "https://sg-a.example");
  const b = shard("sg-b", "https://sg-b.example");
  const c = shard("sg-c", "https://sg-c.example");
  const coordinator = (shards) => new PrivateEgressCoordinator({ config: baseConfig({ privateEgressShards: shards }), cache });
  const two = coordinator([a, b]);
  const three = coordinator([a, b, c]);
  const removedB = coordinator([a, c]);
  const users = Array.from({ length: 1_000 }, (_, index) => `user-${index}`);
  for (const userId of users) {
    const before = two.selectShard(userId).id;
    const afterAdd = three.selectShard(userId).id;
    if (afterAdd !== before) assert.equal(afterAdd, "sg-c");
    const afterRemoval = removedB.selectShard(userId).id;
    if (afterAdd !== "sg-b") assert.equal(afterRemoval, afterAdd);
  }
});

test("background budget cannot consume reserved core capacity", async () => {
  let nowMs = Date.UTC(2026, 7, 21, 0, 0, 0);
  const config = baseConfig({
    privateEgressShards: [shard("sg-a", "https://sg-a.example")],
    privateTotalSafetyPercent: 60,
    privateBackgroundSafetyPercent: 35,
  });
  const coordinator = new PrivateEgressCoordinator({ config, cache: new GatewayCache(), now: () => nowMs });
  await coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v1/income" });
  await assert.rejects(
    () => coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v1/income" }),
    (error) => error.code === "EGRESS_BACKGROUND_BUDGET_EXHAUSTED",
  );
  const core = await coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v3/account" });
  assert.equal(core.priority, "core");
  assert.equal(core.shardId, "sg-a");
  assert.equal(core.proxyUrl, "https://sg-a.example");
  nowMs += 1;
});

test("an upstream 429 cools the assigned shard without rotating the user", async () => {
  let nowMs = Date.UTC(2026, 7, 21, 0, 0, 0);
  const coordinator = new PrivateEgressCoordinator({
    config: baseConfig({ privateEgressShards: [
      shard("sg-a", "https://sg-a.example"),
      shard("sg-b", "https://sg-b.example"),
    ] }),
    cache: new GatewayCache(),
    now: () => nowMs,
  });
  const permit = await coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v3/account" });
  await coordinator.reportUsage(identity, { permitId: permit.permitId, status: 429, usedWeight1m: 80, retryAfterMs: 30_000 });
  await assert.rejects(
    () => coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v3/account" }),
    (error) => error.code === "EGRESS_UPSTREAM_COOLDOWN" && error.retryAfterMs === 30_000,
  );
  assert.equal(coordinator.selectShard(identity.userId).id, permit.shardId);
  // The 429 cooldown expires first, but the reported Binance minute weight
  // remains authoritative until the original minute window rolls over.
  nowMs += 60_001;
  const recovered = await coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v3/account" });
  assert.equal(recovered.shardId, permit.shardId);
});

test("a per-user Redis budget prevents one account from exhausting its shard", async () => {
  const coordinator = new PrivateEgressCoordinator({
    config: baseConfig({
      privateEgressShards: [shard("sg-a", "https://sg-a.example")],
      privateUserFuturesWeightPerMinute: 20,
    }),
    cache: new GatewayCache(),
  });
  for (let index = 0; index < 4; index += 1) {
    await coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v3/account" });
  }
  await assert.rejects(
    () => coordinator.issuePermit(identity, { marketType: "futures", pathname: "/fapi/v3/account" }),
    (error) => error.code === "EGRESS_USER_BUDGET_EXHAUSTED",
  );
  const otherUser = await coordinator.issuePermit(
    { userId: "00000000-0000-0000-0000-000000000002" },
    { marketType: "futures", pathname: "/fapi/v3/account" },
  );
  assert.equal(otherUser.shardId, "sg-a");
});
