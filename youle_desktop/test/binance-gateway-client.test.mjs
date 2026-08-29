import assert from "node:assert/strict";
import test from "node:test";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";

test("gateway client keeps Haolo JWT in main process and exposes only one-use WS ticket", async () => {
  const config = resolveBinanceGatewayConfig({
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private.haolo.example",
  });
  const requests = [];
  const client = createBinanceGatewayClient({
    config,
    apiClient: { async getTrustedAccessToken() { return "trusted-access-token"; } },
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/tickets")) return new Response(JSON.stringify({ ticket: "short-ticket" }), { status: 201 });
      if (String(url).endsWith("/permits")) return new Response(JSON.stringify({
        permitId: "permit-id-000000000001",
        permitToken: "short-private-permit",
        proxyUrl: "https://sg-a.private.haolo.example",
        targetHost: "fapi.binance.com",
      }), { status: 201 });
      if (String(url).endsWith("/usage")) return new Response("{}", { status: 202 });
      return new Response("{}", { status: 200 });
    },
  });
  await client.fetch("https://market.haolo.example/fapi/v1/klines");
  const endpoint = await client.marketStreamEndpoint({ marketType: "futures" });
  const permit = await client.privateRequestPermit("https://fapi.binance.com/fapi/v3/account?timestamp=123&signature=secret-signature");
  await client.reportPrivateUsage({ permitId: permit.permitId, status: 200, usedWeight1m: 10 });
  assert.equal(endpoint, "wss://market.haolo.example/ws/futures?ticket=short-ticket");
  assert.equal(new Headers(requests[0].init.headers).get("authorization"), "Bearer trusted-access-token");
  assert.equal(new Headers(requests[1].init.headers).get("authorization"), "Bearer trusted-access-token");
  assert.equal(new Headers(requests[2].init.headers).get("authorization"), "Bearer trusted-access-token");
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    marketType: "futures",
    pathname: "/fapi/v3/account",
    hasSymbol: false,
  });
  assert.doesNotMatch(requests[2].init.body, /signature|timestamp|secret-signature/);
  assert.equal(permit.proxyUrl, "https://sg-a.private.haolo.example");
  assert.deepEqual(JSON.parse(requests[3].init.body), {
    permitId: "permit-id-000000000001",
    status: 200,
    usedWeight1m: 10,
    retryAfterMs: 0,
  });
  assert.doesNotMatch(endpoint, /trusted-access-token/);
});

test("gateway client refreshes an expired Haolo token once after HTTP 401", async () => {
  const config = resolveBinanceGatewayConfig({
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
  });
  const tokenRequests = [];
  const requests = [];
  const client = createBinanceGatewayClient({
    config,
    apiClient: {
      async getTrustedAccessToken(options = {}) {
        tokenRequests.push(options);
        return options.forceRefresh ? "refreshed-token" : "expired-token";
      },
    },
    fetchImpl: async (_url, init) => {
      requests.push(new Headers(init.headers).get("authorization"));
      return new Response("{}", { status: requests.length === 1 ? 401 : 200 });
    },
  });

  const response = await client.fetch("https://market.haolo.example/fapi/v1/ping");
  assert.equal(response.status, 200);
  assert.deepEqual(requests, ["Bearer expired-token", "Bearer refreshed-token"]);
  assert.deepEqual(tokenRequests, [{ forceRefresh: false }, { forceRefresh: true }]);
});
