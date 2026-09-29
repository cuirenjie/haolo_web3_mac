import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createHaoloNetworkTransport } from "../src/main/haolo-network-transport.mjs";
import { createBinanceGatewayNetworkFetch } from "../src/main/binance-gateway-network.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";

const main = readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const parsed = ts.createSourceFile("main.mjs", main, ts.ScriptTarget.Latest, true);
const names = ["getBinanceGatewayClient", "resetBinanceNetworkRuntimeAfterAuthChange", "restartClientAfterAuthChange", "resetHaoloNetworkTransport"];
const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
const code = functions.map(node => node.getText(parsed)).join("\n");

function harness(t, { runtime = true, failStop = false, custom = false } = {}) {
  const transports = [], requests = [], events = [];
  const networkFactory = () => {
    const generation = transports.length;
    const network = createHaoloNetworkTransport({
      resolveProxy: async () => "DIRECT",
      policyOptions: { probeRegion: async () => ({ schemaVersion: 1, service: "haolo-network-policy", egressRegion: "OTHER" }) },
      fetchImpl: async (url, init) => {
        requests.push({ generation, url: String(url), authorization: new Headers(init.headers).get("authorization") });
        return new Response(JSON.stringify({ ticket: "fixture", permitToken: "fixture", permitId: "fixture", proxyUrl: "https://sg-a.binance-egress.waduo.com" }));
      },
    });
    transports.push(network);
    return network;
  };
  t.after(() => { for (const network of transports) network.close(); });
  const gatewayFetch = (config, options) => {
    if (!custom) return createBinanceGatewayNetworkFetch(config, options);
    const fetch = options.network.fetch;
    fetch.close = () => events.push("custom-close");
    return fetch;
  };
  const fixture = new Function("networkFactory", "createBinanceGatewayNetworkFetch", "createBinanceGatewayClient", "options", "events", `
    let binanceGatewayClient = null, binanceGatewayNetworkFetch = null;
    let haoloNetworkTransport = null, haoloServiceNetworkFetch = null;
    let tradingAlertServicePromise = null, tradingAlertService = null, tradingMarketDataHub = null;
    let binanceNetworkRouter = null, binancePrivateProxyTransport = null, binanceRoutePreferenceStore = null;
    let binancePublicMarketService = null, binanceAccountService = null, personalContextService = null;
    let githubMcpBridge = null, client = options.runtime ? {} : null;
    let authChangeRestartPromise = null;
    const appServerClients = new Map(client ? [['workspace', client]] : []);
    const appServerClientByThreadId = new Map(), appServerWorkspaceByKey = new Map(), idleStoppingAppServerKeys = new Set();
    const internalSubagentThreads = { clearAll() {} };
    const binanceMarketRendererSubscriptions = new Map(), binancePublicRequestCoordinator = { cancelAll() {} };
    const stopAppServerClient = async () => { events.push('runtime-stop'); if (options.failStop) throw new Error('fixture stop failure'); };
    const getBinanceGatewayConfig = () => ({ marketOrigin: 'https://market.youle.pro', marketGatewayEnabled: true,
      ticketUrl: 'https://market.youle.pro/ticket', gatewayPublicWebSocket: { spot: 'wss://market.youle.pro/ws' },
      privateProxyEnabled: true, privatePermitUrl: 'https://market.youle.pro/permit' });
    let token = 'fixture-before';
    const getYouleApiClient = () => ({ getTrustedAccessToken: async () => token });
    const getHaoloNetworkTransport = () => haoloNetworkTransport ||= networkFactory();
    ${code}
    return { get: getBinanceGatewayClient, reset: restartClientAfterAuthChange, network: getHaoloNetworkTransport,
      cachedFetch: () => binanceGatewayNetworkFetch, changeToken: value => { token = value; } };
  `)(networkFactory, gatewayFetch, createBinanceGatewayClient, { runtime, failStop }, events);
  return { ...fixture, requests, events };
}

for (const options of [{ runtime: true }, { runtime: false }, { runtime: true, failStop: true }, { runtime: true, custom: true }]) {
  test(`auth resets recreate REST, WS ticket and private permit transports ${JSON.stringify(options)}`, async t => {
    const h = harness(t, options);
    for (let generation = 0; generation < 3; generation++) {
      h.changeToken(`fixture-${generation}`);
      const gateway = h.get(), network = h.network(), fetch = h.cachedFetch();
      assert.equal((await gateway.fetch("https://market.youle.pro/rest")).status, 200);
      assert.match(await gateway.marketStreamEndpoint({ marketType: "spot" }), /ticket=fixture/);
      assert.equal((await gateway.privateRequestPermit("https://api.binance.com/api/v3/account")).permitId, "fixture");
      assert.ok(h.requests.slice(-3).every(request => request.generation === generation && request.authorization === `Bearer fixture-${generation}`));
      await h.reset();
      assert.equal(h.cachedFetch(), null);
      assert.notEqual(h.network(), network);
      assert.notEqual(h.get(), gateway);
      assert.notEqual(h.cachedFetch(), fetch);
      await assert.rejects(network.fetch("https://market.youle.pro/stale"), /transport is closed/);
    }
    assert.equal(h.requests.length, 9, "one request per operation without replay");
    if (options.custom) assert.equal(h.events.filter(event => event === "custom-close").length, 3);
  });
}
