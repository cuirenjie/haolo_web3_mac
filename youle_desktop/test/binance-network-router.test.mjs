import assert from "node:assert/strict";
import test from "node:test";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import {
  BINANCE_DIRECT_ROUTE_FAILED,
  BinanceNetworkRouter,
} from "../src/main/binance-network-router.mjs";

function autoConfig() {
  return resolveBinanceGatewayConfig({
    HAOLO_BINANCE_ROUTING_MODE: "auto",
    HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://market.haolo.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private-market.haolo.example",
    HAOLO_BINANCE_DIRECT_ATTEMPT_TIMEOUT_MS: "1000",
  });
}

test("auto router uses the current client network when Binance is reachable", async () => {
  const directRequests = [];
  const gatewayRequests = [];
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async (url) => {
      directRequests.push(String(url));
      return new Response(JSON.stringify([[1, "2"]]), { status: 200 });
    },
    gatewayClient: {
      async fetch(url) { gatewayRequests.push(String(url)); return new Response("[]"); },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });

  const response = await router.publicFetch("https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT");
  assert.equal(response.status, 200);
  assert.deepEqual(directRequests, ["https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT"]);
  assert.deepEqual(gatewayRequests, []);
  assert.equal(router.snapshot()["public:futures"].failures, 0);
});

test("public requests fall back to Haolo and recover direct after the route cooldown", async () => {
  let currentMs = 10_000;
  let directAttempts = 0;
  const gatewayRequests = [];
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    now: () => currentMs,
    cooldownBaseMs: 1_000,
    directFetch: async () => {
      directAttempts += 1;
      if (directAttempts === 1) throw new Error("blocked network");
      return new Response("[]", { status: 200 });
    },
    gatewayClient: {
      async fetch(url) {
        gatewayRequests.push(String(url));
        return new Response("[]", { status: 200 });
      },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => new Response("{}"),
  });
  const input = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT";

  await router.publicFetch(input);
  await router.publicFetch(input);
  assert.equal(directAttempts, 1);
  assert.deepEqual(gatewayRequests, [
    "https://market.haolo.example/fapi/v1/klines?symbol=BTCUSDT",
    "https://market.haolo.example/fapi/v1/klines?symbol=BTCUSDT",
  ]);
  currentMs += 1_001;
  await router.publicFetch(input);
  assert.equal(directAttempts, 2);
  assert.equal(router.snapshot()["public:futures"].failures, 0);
});

test("private route signals the account service to re-sign before gateway retry", async () => {
  let directAttempts = 0;
  let proxyAttempts = 0;
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async () => {
      directAttempts += 1;
      throw new Error("direct account route unavailable");
    },
    gatewayClient: {
      async fetch() { return new Response("{}"); },
      async marketStreamEndpoint() { return "wss://market.haolo.example/stream/futures?ticket=one"; },
    },
    privateProxyFetch: async () => {
      proxyAttempts += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const url = "https://fapi.binance.com/fapi/v3/account?timestamp=1&signature=old";

  await assert.rejects(router.privateFetch(url), (error) => error?.code === BINANCE_DIRECT_ROUTE_FAILED);
  const response = await router.privateFetch(url);
  assert.equal(response.status, 200);
  assert.equal(directAttempts, 1);
  assert.equal(proxyAttempts, 1);
});

test("websocket routing probes the real target and obtains a one-use gateway ticket only on failure", async () => {
  const ticketRequests = [];
  const router = new BinanceNetworkRouter({
    config: autoConfig(),
    directFetch: async () => { throw new Error("direct ping blocked"); },
    gatewayClient: {
      async fetch() { return new Response("{}"); },
      async marketStreamEndpoint(params) {
        ticketRequests.push(params);
        return "wss://market.haolo.example/stream/futures?ticket=short";
      },
    },
    privateProxyFetch: async () => new Response("{}"),
  });

  const endpoint = await router.marketStreamEndpoint({ marketType: "futures", combined: true });
  assert.deepEqual(endpoint, {
    url: "wss://market.haolo.example/stream/futures?ticket=short",
    route: "gateway",
    marketType: "futures",
  });
  assert.deepEqual(ticketRequests, [{ marketType: "futures", combined: true }]);
});

test("router rejects arbitrary targets and any private write method", async () => {
  const router = new BinanceNetworkRouter({
    config: resolveBinanceGatewayConfig({ HAOLO_BINANCE_ROUTING_MODE: "direct" }),
    directFetch: async () => new Response("{}"),
  });
  await assert.rejects(router.publicFetch("https://attacker.example/api/v3/time"), /not allowed/);
  await assert.rejects(
    router.privateFetch("https://api.binance.com/api/v3/order", { method: "POST" }),
    /GET only/,
  );
});

test("automatic routing observes Binance reachability without inspecting VPNs or user IPs", async () => {
  const { readFile } = await import("node:fs/promises");
  const [routerSource, mainSource] = await Promise.all([
    readFile(new URL("../src/main/binance-network-router.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
  ]);
  const source = `${routerSource}\n${mainSource}`;
  assert.doesNotMatch(source, /Get-NetAdapter|NetworkInterfaceType|networkInterfaces\(|vpn process|public ip/i);
  assert.match(routerSource, /fapi\/v1\/ping/);
  assert.match(routerSource, /api\/v3\/ping/);
});
