import assert from "node:assert/strict";
import test from "node:test";
import { resolveBinanceGatewayConfig, withMarketTicket } from "../src/main/binance-gateway-config.mjs";

test("Binance gateway config keeps direct defaults until a deployment origin is configured", () => {
  const config = resolveBinanceGatewayConfig({});
  assert.equal(config.mode, "direct");
  assert.equal(config.publicRest.futures, "https://fapi.binance.com");
  assert.equal(config.privateProxyEnabled, false);
  assert.equal(config.publicHedgeDelayMs, 200);
  assert.equal(config.routePreferenceTtlMs, 30 * 60_000);
  assert.equal(config.backgroundProbeIntervalMs, 45_000);
  assert.equal(config.gatewayRequestTimeoutMs, 8_000);
  assert.deepEqual(config.marketGatewayResolutionCandidates, []);
});

test("Binance gateway config derives protected REST and WebSocket routes", () => {
  const config = resolveBinanceGatewayConfig({
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private-market.haolo.example",
  });
  assert.equal(config.mode, "auto");
  assert.equal(config.publicRest.spot, "https://data-api.binance.vision");
  assert.equal(config.publicWebSocket.futures, "wss://fstream.binance.com/ws");
  assert.equal(config.gatewayPublicWebSocket.futures, "wss://market.haolo.example/ws/futures");
  assert.equal(config.gatewayPublicWebSocket.spotCombined, "wss://market.haolo.example/stream/spot");
  assert.equal(config.privateProxyEnabled, true);
  assert.equal(
    withMarketTicket(config.gatewayPublicWebSocket.futures, "ticket-value"),
    "wss://market.haolo.example/ws/futures?ticket=ticket-value",
  );
});

test("packaged deployment config supplies fail-closed gateway origins without machine environment variables", () => {
  const config = resolveBinanceGatewayConfig({}, {
    marketGatewayUrl: "https://market.haolo.example",
    privateProxyUrl: "https://private-market.haolo.example",
    requireGateway: true,
    gatewayRequestTimeoutMs: 45_000,
    marketGatewayResolutionCandidates: ["gateway-resolver.example", "203.0.113.8"],
  });
  assert.equal(config.mode, "auto");
  assert.equal(config.privateProxyEnabled, true);
  assert.equal(config.requireGateway, true);
  assert.equal(config.gatewayRequestTimeoutMs, 45_000);
  assert.deepEqual(config.marketGatewayResolutionCandidates, ["gateway-resolver.example", "203.0.113.8"]);
});

test("Binance gateway config supports explicit direct and fail-closed gateway routing", () => {
  const direct = resolveBinanceGatewayConfig({
    HAOLO_BINANCE_ROUTING_MODE: "direct",
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private-market.haolo.example",
  });
  assert.equal(direct.routingMode, "direct");
  const gateway = resolveBinanceGatewayConfig({
    HAOLO_BINANCE_ROUTING_MODE: "gateway",
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private-market.haolo.example",
    HAOLO_BINANCE_DIRECT_ATTEMPT_TIMEOUT_MS: "2500",
    HAOLO_BINANCE_PUBLIC_HEDGE_DELAY_MS: "150",
    HAOLO_BINANCE_ROUTE_PREFERENCE_TTL_MS: "3600000",
    HAOLO_BINANCE_BACKGROUND_PROBE_INTERVAL_MS: "30000",
    HAOLO_BINANCE_GATEWAY_REQUEST_TIMEOUT_MS: "6000",
  });
  assert.equal(gateway.routingMode, "gateway");
  assert.equal(gateway.directAttemptTimeoutMs, 2500);
  assert.equal(gateway.publicHedgeDelayMs, 150);
  assert.equal(gateway.routePreferenceTtlMs, 3_600_000);
  assert.equal(gateway.backgroundProbeIntervalMs, 30_000);
  assert.equal(gateway.gatewayRequestTimeoutMs, 6_000);
  assert.throws(
    () => resolveBinanceGatewayConfig({ HAOLO_BINANCE_ROUTING_MODE: "gateway" }),
    /requires both/,
  );
  assert.throws(
    () => resolveBinanceGatewayConfig({ HAOLO_BINANCE_ROUTING_MODE: "vpn-detection" }),
    /auto, direct or gateway/,
  );
});

test("Binance gateway config refuses insecure or credential-bearing endpoints", () => {
  assert.throws(() => resolveBinanceGatewayConfig({ HAOLO_BINANCE_MARKET_GATEWAY_URL: "http://market.example" }), /HTTPS/);
  assert.throws(() => resolveBinanceGatewayConfig({ HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.example/path" }), /HTTPS origin/);
  assert.throws(() => resolveBinanceGatewayConfig({ HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://user:pass@proxy.example" }), /HTTPS origin/);
  assert.throws(() => resolveBinanceGatewayConfig({ HAOLO_BINANCE_REQUIRE_GATEWAY: "true" }), /requires both/);
  assert.throws(
    () => resolveBinanceGatewayConfig({
      HAOLO_BINANCE_MARKET_GATEWAY_RESOLUTION_CANDIDATES: "https://resolver.example/path",
    }),
    /DNS hostnames or IPv4/,
  );
});
