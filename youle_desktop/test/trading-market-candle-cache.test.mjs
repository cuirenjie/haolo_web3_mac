import assert from "node:assert/strict";
import test from "node:test";
import {
  STORAGE_PREFIX,
  createTradingMarketCandleCache,
  mergeTradingCandleBatches,
} from "../src/renderer/trading-market-candle-cache.mjs";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function candle(time, close = time) {
  return { time, open: close, high: close + 1, low: Math.max(0.1, close - 1), close, volume: 2 };
}

function snapshot(symbol = "BTCUSDT", start = 1) {
  const candles = [candle(start, 10), candle(start + 60, 11)];
  return {
    stats: {
      symbol,
      markPrice: 11,
      midPrice: 11,
      oraclePrice: 11,
      openInterest: 2,
      fundingRate: 0.001,
      nextFundingTime: 100,
      prevDayPrice: 9,
      volume24h: 50,
    },
    candleBatch: {
      candles,
      sourceCandles: candles,
      source: { targetMs: 60_000, sourceInterval: "1m", sourceMs: 60_000 },
      lastTradeId: 8,
    },
  };
}

test("persistent candle cache restores compact snapshots across renderer restarts", () => {
  const storage = new MemoryStorage();
  const first = createTradingMarketCandleCache({ storage, now: () => 1_000 });
  first.set("BINANCE|BTCUSDT|CRYPTO|1|PERPETUAL", snapshot(), 1_000);
  const raw = [...storage.values.entries()].find(([key]) => key.startsWith(STORAGE_PREFIX) && !key.endsWith("index"))[1];
  assert.match(raw, /"c":\[\[/);
  assert.match(raw, /"s":\[\]/, "native source candles must not be stored twice");

  const second = createTradingMarketCandleCache({ storage, now: () => 1_050 });
  const restored = second.get("BINANCE|BTCUSDT|CRYPTO|1|PERPETUAL");
  assert.equal(restored.candleBatch.candles.length, 2);
  assert.equal(restored.candleBatch.sourceCandles.length, 2);
  assert.equal(restored.candleBatch.lastTradeId, 8);
  restored.candleBatch.candles[0].close = 999;
  assert.equal(second.get("BINANCE|BTCUSDT|CRYPTO|1|PERPETUAL").candleBatch.candles[0].close, 10);
});

test("persistent candle cache serves stale data while revalidating and prunes expired data", () => {
  const storage = new MemoryStorage();
  const cache = createTradingMarketCandleCache({
    storage,
    freshAgeMs: 100,
    staleAgeMs: 1_000,
    now: () => 1_000,
  });
  cache.set("one", snapshot(), 1_000);
  assert.equal(cache.get("one", 1_050).isStale, false);
  assert.equal(cache.get("one", 1_200).isStale, true);
  assert.equal(cache.get("one", 2_001), null);
  assert.equal(storage.getItem(`${STORAGE_PREFIX}one`), null);
});

test("persistent candle cache keeps the 48-style capacity as an LRU", () => {
  const storage = new MemoryStorage();
  const cache = createTradingMarketCandleCache({ storage, maxEntries: 2, now: () => 10 });
  cache.set("one", snapshot("ONE"), 1);
  cache.set("two", snapshot("TWO", 100), 2);
  cache.get("one", 3);
  cache.set("three", snapshot("THREE", 200), 4);

  const restarted = createTradingMarketCandleCache({ storage, maxEntries: 2, now: () => 5 });
  assert.ok(restarted.get("one", 5));
  assert.equal(restarted.get("two", 5), null);
  assert.ok(restarted.get("three", 5));
});

test("incremental batch merge overwrites the forming candle without dropping cached history", () => {
  const historical = Array.from({ length: 500 }, (_, index) => candle(60 + index * 60, 10 + index));
  const current = {
    candles: historical,
    sourceCandles: historical.slice(-20),
    source: { targetMs: 60_000, sourceInterval: "1m", sourceMs: 60_000 },
    lastTradeId: 10,
  };
  const latestTime = historical.at(-1).time;
  const incoming = {
    candles: [candle(latestTime, 999), candle(latestTime + 60, 1_000)],
    sourceCandles: [candle(latestTime, 999), candle(latestTime + 60, 1_000)],
    source: { targetMs: 60_000, sourceInterval: "1m", sourceMs: 60_000 },
    lastTradeId: 12,
  };
  const merged = mergeTradingCandleBatches(current, incoming, { candleLimit: 500 });
  assert.equal(merged.candles.length, 500);
  assert.equal(merged.candles.at(-2).close, 999);
  assert.equal(merged.candles.at(-1).close, 1_000);
  assert.equal(merged.lastTradeId, 12);
});
