import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { createBinanceGatewayNetworkFetch } from "../src/main/binance-gateway-network.mjs";

const deployment = JSON.parse(fs.readFileSync(new URL("../resources/binance-gateway.json", import.meta.url), "utf8"));
const resolveWith = (network, hostname) => new Promise((resolve, reject) => network.lookup(hostname,
  { family: 4 }, (error, address) => error ? reject(error) : resolve(address)));

test("both production gateways retain a premium route when all domain lookups hang", async () => {
  const config = resolveBinanceGatewayConfig({}, deployment);
  const network = createBinanceGatewayNetworkFetch(config, { routeOptions: {
    lookupImpl() {}, timeoutMs: 100,
    probeImpl: async ({ address }) => {
      if (address !== "47.75.125.102") throw new Error("unavailable route");
    },
  } });
  try {
    assert.equal(await resolveWith(network, "market.youle.pro"), "47.75.125.102");
    assert.equal(await resolveWith(network, "sg-a.binance-egress.waduo.com"), "47.75.125.102");
  } finally { network.close(); }
});

test("packaged market and private routes both choose the GA alias while preserving their service identities", async () => {
  const config = resolveBinanceGatewayConfig({}, deployment);
  assert.equal(config.gatewayRouteSelection, true);
  assert.ok(config.marketGatewayResolutionCandidates.includes("haolo.com"));
  assert.ok(config.privateProxyResolutionCandidates.includes("haolo.com"));
  const observations = [];
  const network = createBinanceGatewayNetworkFetch(config, { routeOptions: {
    lookupImpl(host, _options, callback) {
      callback(null, [{ address: host === "haolo.com" ? "203.0.113.1" : "203.0.113.2", family: 4 }]);
    },
    async probeImpl(options) {
      observations.push(options);
      if (options.address !== "203.0.113.1") throw new Error("origin unavailable");
    },
  } });
  try {
    assert.equal(await resolveWith(network, "market.youle.pro"), "203.0.113.1");
    assert.equal(await resolveWith(network, "sg-a.binance-egress.waduo.com"), "203.0.113.1");
    assert.ok(observations.some((x) => x.origin === config.marketOrigin && x.service === "haolo-binance-market-gateway"));
    assert.ok(observations.some((x) => x.origin === config.privateProxyUrl && x.service === "haolo-binance-private-proxy"));
    await assert.rejects(network("https://haolo.com/api/auth/config"), /origin is not allowed/);
  } finally { network.close(); }
});

test("custom origins do not inherit production premium health probes", async () => {
  const config = resolveBinanceGatewayConfig({ HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://custom.example",
    HAOLO_BINANCE_PRIVATE_PROXY_URL: "https://private.custom.example",
    HAOLO_BINANCE_MARKET_GATEWAY_RESOLUTION_CANDIDATES: "resolver.custom.example" }, deployment);
  const calls = [];
  const network = createBinanceGatewayNetworkFetch(config, { routeOptions: {
    probeImpl() { throw new Error("must not probe production on a custom gateway"); },
  }, fetchOptions: {
    lookupImpl(host, _options, callback) { calls.push(host); callback(null, "203.0.113.9", 4); },
  } });
  try {
    assert.equal(await resolveWith(network, "custom.example"), "203.0.113.9");
    assert.deepEqual(calls, ["resolver.custom.example"]);
  } finally { network.close(); }
});

test("deployment rollback switch restores ordinary gateway resolution", async () => {
  const config = resolveBinanceGatewayConfig({ HAOLO_BINANCE_GATEWAY_ROUTE_SELECTION: "false",
    HAOLO_BINANCE_MARKET_GATEWAY_RESOLUTION_CANDIDATES: "8.219.93.44" }, deployment);
  assert.equal(config.gatewayRouteSelection, false);
  const network = createBinanceGatewayNetworkFetch(config);
  try { assert.equal(await resolveWith(network, "market.youle.pro"), "8.219.93.44"); }
  finally { network.close(); }
});

test("a custom market resolver still works when the private gateway uses production premium routing", async () => {
  const config = resolveBinanceGatewayConfig({ HAOLO_BINANCE_MARKET_GATEWAY_URL: "https://custom.example",
    HAOLO_BINANCE_MARKET_GATEWAY_RESOLUTION_CANDIDATES: "resolver.custom.example" }, deployment);
  const calls = [];
  const network = createBinanceGatewayNetworkFetch(config, { routeOptions: {
    lookupImpl() { throw new Error("custom market must keep its ordinary resolver"); },
  }, fetchOptions: {
    lookupImpl(host, _options, callback) { calls.push(host); callback(null, "203.0.113.9", 4); },
  } });
  try {
    assert.equal(await resolveWith(network, "custom.example"), "203.0.113.9");
    assert.deepEqual(calls, ["resolver.custom.example"]);
  } finally { network.close(); }
});
