import assert from "node:assert/strict";
import test from "node:test";
import { TrafficMetrics, restFamily } from "../src/traffic-metrics.mjs";
import { compactCohort } from "../src/ws-compression.mjs";
import { loadGatewayConfig } from "../src/config.mjs";

test("traffic labels are bounded, invalid counters ignored, and wire deltas counted once", () => {
  const metrics = new TrafficMetrics('untrusted"label');
  const socket = { bytesWritten: 100 };
  const release = metrics.trackSocket(socket, { tier: "paid", market: "futures", transport: "ws" });
  socket.bytesWritten += 400;
  metrics.record({ tier: "paid", market: "futures", transport: "ws", family: "aggTrade", codec: "hmc1", bytes: 200, jsonBytes: 300 });
  metrics.record({ tier: "user-123", market: "token", transport: "url", family: "symbol", codec: "token", bytes: 12 });
  metrics.record({ bytes: NaN });
  let output = metrics.prometheus();
  assert.match(output, /socket_bytes_total\{node="shared",tier="paid",transport="ws",market="futures"\} 400/);
  assert.match(output, /family="other",codec="json"/);
  assert.doesNotMatch(output, /user-123|token|symbol|untrusted|NaN/);
  assert.equal(metrics.prometheus(), output);
  socket.bytesWritten += 25; release(); release();
  assert.match(metrics.prometheus(), /market="futures"\} 425/);
  assert.equal(metrics.sockets.size, 0); assert.equal(metrics.timer, null);
});

test("REST categories exclude symbols, credentials and arbitrary URLs", () => {
  for (const [url, family] of [["/fapi/v1/ticker/24hr?symbol=BTCUSDT", "ticker"], ["/api/v3/klines", "kline"],
    ["/fapi/v1/aggTrades", "aggTrade"], ["/fapi/v1/premiumIndex", "markPrice"],
    ["/futures/data/topLongShortPositionRatio", "ratio"], ["/unknown?token=x", "other"]]) {
    assert.equal(restFamily(url), family);
  }
});

test("compact rollout defaults to capable clients, supports stable cohorts and explicit rollback", () => {
  const env = { NODE_ENV: "production", HAOLO_GATEWAY_ROLE: "market",
    HAOLO_MARKET_REDIS_URL: "redis://redis:6379", HAOLO_GATEWAY_METRICS_TOKEN: "test-metrics-token-at-least-24-chars" };
  const config = loadGatewayConfig(env);
  assert.equal(config.marketCompactEnabled, true); assert.equal(config.marketCompactPercent, 100);
  assert.equal(loadGatewayConfig({ ...env, HAOLO_MARKET_COMPACT_ENABLED: "false" }).marketCompactEnabled, false);
  assert.equal(compactCohort("trial", 0), false); assert.equal(compactCohort("trial", 100), true);
  const sample = Array.from({ length: 1000 }, (_, i) => compactCohort(String(i), 10));
  assert.ok(sample.filter(Boolean).length > 65 && sample.filter(Boolean).length < 140);
  assert.deepEqual(sample, Array.from({ length: 1000 }, (_, i) => compactCohort(String(i), 10)));
});
