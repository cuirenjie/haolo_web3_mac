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
  assert.match(sources.market, /syncFavoriteServer\(\)/);
  assert.match(sources.market, /syncFavoriteServerMembership\(market, !wasFavorite\)/);
  assert.match(sources.market, /syncFavoriteServerOrder\(orderedMarketIds\)/);
  assert.match(sources.renderer, /reorderTradingFavorites\?\(params/);
});
