import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  client: new URL("../src/main/youle-api-client.mjs", import.meta.url),
  main: new URL("../src/main/main.mjs", import.meta.url),
  preload: new URL("../src/main/preload.mjs", import.meta.url),
  renderer: new URL("../src/renderer/main.ts", import.meta.url),
  market: new URL("../src/renderer/trading-expert-market.ts", import.meta.url),
};

test("trading favorites use the shared authenticated server collection", async () => {
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
    ),
  );

  for (const operation of [
    "listTradingFavorites",
    "addTradingFavorite",
    "removeTradingFavorite",
    "reorderTradingFavorites",
  ]) {
    assert.match(sources.client, new RegExp(`async ${operation}`));
    assert.match(sources.main, new RegExp(operation));
    assert.match(sources.preload, new RegExp(operation));
  }
  assert.match(sources.client, /DEFAULT_TRADING_FAVORITES_PATH = "\/api\/mobile\/v1\/favorites"/);
  assert.match(sources.market, /syncFavoriteServer\(true\)/);
  assert.match(sources.market, /onMembershipChange: \(record, checked\) => this\.syncWatchlistMembership/);
  assert.match(sources.market, /onReorder: \(records\) => this\.syncWatchlistOrder/);
  assert.doesNotMatch(sources.market, /this\.syncFavoriteServerMembership\(market, !wasFavorite\)/);
  assert.doesNotMatch(sources.market, /this\.syncFavoriteServerOrder\(orderedMarketIds\)/);
  assert.match(sources.market, /replaceGroupMarkets\("watchlist", remoteRecords\)/);
  assert.match(sources.renderer, /reorderTradingFavorites\?\(params/);
  assert.match(sources.market, /favoriteLocalRevision/);
  assert.match(sources.market, /scheduleFavoriteServerRetry/);
  assert.match(sources.market, /replaceGroupMarkets\("watchlist", remoteRecords\)/);

  const readSharedBlock = sources.main.slice(
    sources.main.indexOf("async function readSharedBinanceAccountConnections"),
    sources.main.indexOf("async function syncSharedBinanceAccountConnection"),
  );
  assert.doesNotMatch(readSharedBlock, /registerMobileDevice/);
  assert.match(sources.main, /if \(!local\.bound\) throw error/);
});

test("trading favorite responses accept the supported server envelopes", async () => {
  const { tradingFavoriteApiItems } = await import("../src/renderer/trading-expert-market.ts");
  const first = { id: "binance:usdm:BTCUSDT" };
  const second = { id: "binance:usdm:ETHUSDT" };
  assert.deepEqual(tradingFavoriteApiItems({ items: [first] }), [first]);
  assert.deepEqual(tradingFavoriteApiItems({ favorites: [first] }), [first]);
  assert.deepEqual(tradingFavoriteApiItems({ data: [first] }), [first]);
  assert.deepEqual(tradingFavoriteApiItems({ data: { items: [second] } }), [second]);
  assert.deepEqual(tradingFavoriteApiItems({ data: { favorites: [second] } }), [second]);
  assert.deepEqual(tradingFavoriteApiItems([first]), [first]);
  assert.deepEqual(tradingFavoriteApiItems({}), []);
});
