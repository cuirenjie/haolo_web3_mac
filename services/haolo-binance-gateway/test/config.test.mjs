import assert from "node:assert/strict";
import test from "node:test";
import { loadGatewayConfig } from "../src/config.mjs";

const productionEnv = {
  NODE_ENV: "production",
  HAOLO_GATEWAY_JWT_SECRET: "production-jwt-secret-at-least-24-chars",
  HAOLO_PRIVATE_SHARD_HASH_SECRET: "production-shard-hash-secret-24-chars",
  HAOLO_PRIVATE_PROXY_ALLOW_INSECURE: "true",
  HAOLO_MARKET_REDIS_URL: "redis://redis:6379/0",
  HAOLO_PRIVATE_EGRESS_SHARD_ID: "sg-a",
  HAOLO_PRIVATE_EGRESS_SHARDS_JSON: JSON.stringify([{
    id: "sg-a",
    proxyUrl: "https://sg-a.private.haolo.example",
    spotWeightLimitPerMinute: 6000,
    futuresWeightLimitPerMinute: 2400,
  }]),
};

test("production config requires a separate strong metrics token", () => {
  assert.throws(
    () => loadGatewayConfig(productionEnv),
    /HAOLO_GATEWAY_METRICS_TOKEN/,
  );
  const config = loadGatewayConfig({
    ...productionEnv,
    HAOLO_GATEWAY_METRICS_TOKEN: "production-metrics-token-at-least-24-chars",
  });
  assert.equal(config.metricsToken, "production-metrics-token-at-least-24-chars");
  assert.deepEqual(config.privateAllowedHosts, ["api.binance.com", "fapi.binance.com"]);
  assert.equal(config.privateEgressShardId, "sg-a");
  assert.equal(config.privateEgressShards[0].proxyUrl, "https://sg-a.private.haolo.example");
  assert.equal(config.downstreamRequestsPerMinute, 300);
  assert.equal(config.downstreamBurstRequestsPerMinute, 1_200);
  assert.equal(config.publicFuturesUpstreamWeightPerMinute, 1_440);
  assert.equal(config.publicSpotUpstreamWeightPerMinute, 3_600);
});

test("production config fails closed without Redis or an explicit egress shard directory", () => {
  assert.throws(() => loadGatewayConfig({
    NODE_ENV: "production",
    HAOLO_GATEWAY_JWT_SECRET: "production-jwt-secret-at-least-24-chars",
    HAOLO_GATEWAY_METRICS_TOKEN: "production-metrics-token-at-least-24-chars",
    HAOLO_PRIVATE_PROXY_ALLOW_INSECURE: "true",
  }), /SHARDS_JSON/);
});

test("public-only production role does not require private TLS files", () => {
  const config = loadGatewayConfig({
    ...productionEnv,
    HAOLO_GATEWAY_ROLE: "public",
    HAOLO_GATEWAY_METRICS_TOKEN: "production-metrics-token-at-least-24-chars",
    HAOLO_PRIVATE_PROXY_ALLOW_INSECURE: "false",
  });
  assert.equal(config.gatewayRole, "public");
  assert.equal(config.redisUrl, "redis://redis:6379/0");
});
