import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Binance direct and Haolo gateway requests use separate network transports", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src", "main", "main.mjs"), "utf8");

  const directStart = source.indexOf("function appNetworkFetch");
  assert.ok(directStart >= 0);

  const directBlock = source.slice(directStart, source.indexOf("async function responseJson", directStart));
  assert.ok(
    directBlock.includes("net?.fetch"),
    "direct Binance requests should keep using Electron net.fetch",
  );

  assert.match(source, /createBinanceGatewayNetworkFetch/);
  assert.doesNotMatch(source, /function appGatewayNetworkFetch/);
  assert.match(source, /const developmentRuntime = Boolean\([\s\S]*HAOLO_DESKTOP_DEV_SERVER_URL[\s\S]*app\.isPackaged && !developmentRuntime/);
  assert.match(source, /\[binance-network\] gateway configuration/);

  const clientStart = source.indexOf("function getBinanceGatewayClient");
  const clientEnd = source.indexOf("function getTradingMarketDataHub", clientStart);
  const clientBlock = source.slice(clientStart, clientEnd);
  assert.ok(
    clientBlock.includes("fetchImpl: binanceGatewayNetworkFetch"),
    "gateway client must be wired to the dedicated gateway transport",
  );
  assert.match(clientBlock, /createBinanceGatewayNetworkFetch\(config, \{ network: getHaoloNetworkTransport\(\) \}\)/);

  const hubStart = source.indexOf("function getTradingMarketDataHub");
  const hubEnd = source.indexOf("function getBinancePrivateProxyTransport", hubStart);
  const hubBlock = source.slice(hubStart, hubEnd);
  assert.match(hubBlock, /lookupProvider:[\s\S]*route === "gateway"[\s\S]*binanceGatewayNetworkFetch\?\.lookup/);
  assert.match(hubBlock, /WebSocketImpl: getHaoloNetworkTransport\(\)\.webSocketClass\(WebSocket\)/);
  assert.match(source, /connectOuter: \(url, options\) => getHaoloNetworkTransport\(\)\.connect\(url, options\)/);

  const routerStart = source.indexOf("function getBinanceNetworkRouter");
  const routerEnd = source.indexOf("function getBinancePublicMarketService", routerStart);
  const routerBlock = source.slice(routerStart, routerEnd);
  assert.match(routerBlock, /BinanceRoutePreferenceStore/);
  assert.match(routerBlock, /binance-route-preferences\.json/);
  assert.match(routerBlock, /initialState: binanceRoutePreferenceStore\.load\(\)/);
  assert.match(routerBlock, /onStateChange: \(state\) => binanceRoutePreferenceStore\?\.schedule\(state\)/);
  assert.match(routerBlock, /binanceNetworkRouter\.startBackgroundProbes\(\)/);
});
