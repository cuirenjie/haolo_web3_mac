import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Binance realtime tickets and sockets stay behind the trusted main-process Data Hub", async () => {
  const [main, preload, renderer, gatewayClient] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/binance-gateway-client.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /new TradingMarketDataHub\([\s\S]*router\.marketStreamEndpoint/);
  assert.match(main, /binanceMarket:streamSubscribe[\s\S]*assertExternalModelsIpcSender\(event\)/);
  assert.match(main, /subscribeMode: "websocket"[\s\S]*streamHub: getTradingMarketDataHub\(\)/);
  assert.match(preload, /subscribeBinanceMarketStreams[\s\S]*binanceMarket:streamSubscribe/);
  assert.match(preload, /unsubscribeBinanceMarketStreams[\s\S]*binanceMarket:streamUnsubscribe/);
  assert.doesNotMatch(preload, /marketStreamEndpoint|getTrustedAccessToken|ticketUrl/);
  assert.match(renderer, /subscribeBinanceMarketStreams/);
  assert.doesNotMatch(renderer, /new WebSocket|fstream\.binance\.com|data-stream\.binance\.vision/);
  assert.match(gatewayClient, /apiClient\.getTrustedAccessToken/);
  assert.match(gatewayClient, /withMarketTicket/);
});
