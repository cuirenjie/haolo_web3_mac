import assert from "node:assert/strict";
import test from "node:test";

import {
  binanceMarketRestCooldownRemaining,
  parseBinanceMarketRetryAfterMs,
  recordBinanceMarketRateLimit,
} from "../src/renderer/trading-expert-market.ts";

test("Binance market Retry-After accepts seconds and HTTP dates", () => {
  assert.equal(parseBinanceMarketRetryAfterMs("2", 1_000), 2_000);
  assert.equal(
    parseBinanceMarketRetryAfterMs("Thu, 01 Jan 1970 00:00:03 GMT", 1_000),
    2_000,
  );
  assert.equal(parseBinanceMarketRetryAfterMs("invalid", 1_000), null);
  assert.equal(parseBinanceMarketRetryAfterMs(null, 1_000), null);
});

test("renderer rate-limit cooldowns remain isolated by Binance market", () => {
  const now = Date.now();
  recordBinanceMarketRateLimit(2_000, "futures");
  assert.ok(binanceMarketRestCooldownRemaining(now, "futures") >= 2_000);
  assert.equal(binanceMarketRestCooldownRemaining(now, "spot"), 0);
});

test("WebSocket silence fallbacks are delayed, bounded and do not duplicate the snapshot poll", async () => {
  const [marketSource, splitSource] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/renderer/trading-expert-split-pane.ts", import.meta.url), "utf8")),
  ]);
  assert.match(marketSource, /const MARKET_SOCKET_STALE_MS = 10_000/);
  assert.match(marketSource, /const FAVORITE_TICKER_SOCKET_STALE_MS = 10_000/);
  assert.match(marketSource, /const FAVORITE_TICKER_FALLBACK_BATCH_SIZE = 4/);
  assert.match(marketSource, /const binanceMarketRestRetryAt = new Map<"futures" \| "spot", number>/);
  assert.match(marketSource, /recordBinanceMarketRateLimit\(response\?\.retryAfterMs, marketType\)/);
  assert.doesNotMatch(marketSource, /void this\.refreshFavoriteTickerFallback\(generation\);\s*this\.favoriteTickerFallbackTimer/);
  const fallbackBody = /private refreshMarketDataFallback\(generation: number\) \{([\s\S]*?)private async refreshSnapshot/.exec(marketSource)?.[1] || "";
  assert.match(fallbackBody, /refreshLiveCandle\(generation\)/);
  assert.doesNotMatch(fallbackBody, /refreshSnapshot\(generation\)/);
  assert.match(splitSource, /const SPLIT_PANE_REFRESH_INTERVAL_MS = 30_000/);
});
