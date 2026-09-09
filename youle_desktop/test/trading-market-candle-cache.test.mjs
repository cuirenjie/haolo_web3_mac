import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_VERSION,
  STORAGE_PREFIX,
  applyTradingLivePriceToBatch,
  createTradingMarketCandleCache,
  mergeTradingCandleBatches,
  tradingCandleBucketTimeMs,
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

test("one canonical live price produces the same close for every default interval", () => {
  const eventTimeMs = 1_800_000_000_000;
  const livePrice = 80_731.7;
  const intervals = [
    [604_800_000, "1w", 4 * 86_400_000],
    [86_400_000, "1d", 0],
    [300_000, "5m", 0],
    [900_000, "15m", 0],
    [3_600_000, "1h", 0],
    [14_400_000, "4h", 0],
  ];
  const batches = intervals.map(([durationMs, sourceInterval, anchorMs], index) => {
    const bucketStart = Math.floor((eventTimeMs - anchorMs) / durationMs) * durationMs / 1_000
      + anchorMs / 1_000;
    const previousPrice = 78_000 + index * 100;
    const result = applyTradingLivePriceToBatch({
      candles: [candle(bucketStart, previousPrice)],
      sourceCandles: [candle(bucketStart, previousPrice)],
      source: { targetMs: durationMs, sourceInterval, sourceMs: durationMs },
    }, livePrice, eventTimeMs);
    assert.equal(result.candles.length, 1, `${sourceInterval} must reuse its native bucket anchor`);
    return result;
  });

  batches.forEach((batch) => {
    assert.equal(batch.candles.at(-1).close, livePrice);
    assert.equal(batch.sourceCandles.at(-1).close, livePrice);
    assert.ok(batch.candles.at(-1).high >= livePrice);
  });
});

test("canonical live price creates the current long-period bucket when history is stale", () => {
  const eventTimeMs = 1_800_000_000_000;
  const targetMs = 8 * 60 * 60_000;
  const sourceMs = 4 * 60 * 60_000;
  const eventBucket = Math.floor(eventTimeMs / sourceMs) * sourceMs / 1_000;
  const staleSource = eventBucket - 2 * sourceMs / 1_000;
  const patched = applyTradingLivePriceToBatch({
    candles: [candle(Math.floor(staleSource * 1_000 / targetMs) * targetMs / 1_000, 78_000)],
    sourceCandles: [candle(staleSource, 78_000)],
    source: { targetMs, sourceInterval: "4h", sourceMs },
  }, 80_731.7, eventTimeMs);

  assert.equal(patched.sourceCandles.at(-1).time, eventBucket);
  assert.equal(patched.sourceCandles.at(-1).close, 80_731.7);
  assert.equal(patched.candles.at(-1).close, 80_731.7);
});

test("weekly buckets always use Binance's Monday UTC anchor", () => {
  const thursday = Date.UTC(2026, 8, 3, 12, 0, 0);
  const monday = Date.UTC(2026, 7, 31, 0, 0, 0);
  assert.equal(
    tradingCandleBucketTimeMs(thursday, 604_800_000, "1w"),
    monday,
  );
  const patched = applyTradingLivePriceToBatch({
    candles: [],
    sourceCandles: [],
    source: { targetMs: 604_800_000, sourceInterval: "1w", sourceMs: 604_800_000 },
  }, 80_731.7, thursday);
  assert.equal(patched.candles.at(-1).time, monday / 1_000);
  assert.equal(patched.sourceCandles.at(-1).time, monday / 1_000);

  const badThursday = candle(Date.UTC(2026, 8, 3, 0, 0, 0) / 1_000, 79_000);
  const repaired = applyTradingLivePriceToBatch({
    candles: [badThursday],
    sourceCandles: [badThursday],
    source: { targetMs: 604_800_000, sourceInterval: "1w", sourceMs: 604_800_000 },
  }, 80_731.7, thursday);
  assert.deepEqual(repaired.candles.map((item) => item.time), [monday / 1_000]);
  assert.deepEqual(repaired.sourceCandles.map((item) => item.time), [monday / 1_000]);
});

test("weekly cache merges also collapse legacy Thursday bars into the Monday bucket", () => {
  const monday = Date.UTC(2026, 7, 31, 0, 0, 0) / 1_000;
  const thursday = Date.UTC(2026, 8, 3, 0, 0, 0) / 1_000;
  const source = { targetMs: 604_800_000, sourceInterval: "1w", sourceMs: 604_800_000 };
  const merged = mergeTradingCandleBatches(
    { candles: [candle(thursday, 79_000)], sourceCandles: [candle(thursday, 79_000)], source },
    { candles: [candle(monday, 80_000)], sourceCandles: [candle(monday, 80_000)], source },
  );
  assert.deepEqual(merged.candles.map((item) => item.time), [monday]);
  assert.deepEqual(merged.sourceCandles.map((item) => item.time), [monday]);
});

test("a delayed canonical quote never rewrites finalized history", () => {
  const durationMs = 300_000;
  const historicalTime = 1_700_000_100;
  const currentTime = historicalTime + durationMs / 1_000;
  const historical = { ...candle(historicalTime, 100), closed: true };
  const current = { ...candle(currentTime, 110), closed: false };
  const patched = applyTradingLivePriceToBatch({
    candles: [historical, current],
    sourceCandles: [historical, current],
    source: { targetMs: durationMs, sourceInterval: "5m", sourceMs: durationMs },
  }, 105, historicalTime * 1_000 + 1_000);

  assert.deepEqual(patched.candles, [historical, current]);
  assert.deepEqual(patched.sourceCandles, [historical, current]);
});

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

test("candle cache migrates away from legacy snapshots that cannot prove finality", () => {
  const storage = new MemoryStorage();
  const legacyPrefix = "haolo.trading.market.candles.v2.";
  const key = "BINANCE|BTCUSDT|CRYPTO|240|PERPETUAL";
  storage.setItem(`${legacyPrefix}${encodeURIComponent(key)}`, JSON.stringify({ v: 1, c: [] }));
  storage.setItem(`${legacyPrefix}index`, JSON.stringify([{ k: key, a: 1_000 }]));

  createTradingMarketCandleCache({ storage, now: () => 2_000 });

  assert.equal(CACHE_VERSION, 4);
  assert.equal(STORAGE_PREFIX, "haolo.trading.market.candles.v4.");
  assert.equal(storage.getItem(`${legacyPrefix}${encodeURIComponent(key)}`), null);
  assert.equal(storage.getItem(`${legacyPrefix}index`), null);
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

test("a forming cache fragment can never overwrite an authoritative closed candle", () => {
  const source = { targetMs: 14_400_000, sourceInterval: "4h", sourceMs: 14_400_000 };
  const time = 1_787_918_400;
  const fragment = { ...candle(time, 79_520), closed: false };
  const authoritative = {
    time,
    open: 79_563.2,
    high: 79_840,
    low: 78_271,
    close: 78_309,
    volume: 67_761.143,
    closed: true,
  };
  const staleBatch = { candles: [fragment], sourceCandles: [fragment], source };
  const restBatch = { candles: [authoritative], sourceCandles: [authoritative], source };

  const restAfterCache = mergeTradingCandleBatches(staleBatch, restBatch);
  const cacheAfterRest = mergeTradingCandleBatches(restBatch, staleBatch);

  assert.deepEqual(restAfterCache.candles[0], authoritative);
  assert.deepEqual(cacheAfterRest.candles[0], authoritative);
  assert.deepEqual(cacheAfterRest.sourceCandles[0], authoritative);
});

test("newer forming updates still replace older forming values", () => {
  const source = { targetMs: 60_000, sourceInterval: "1m", sourceMs: 60_000 };
  const time = 1_777_564_800;
  const older = { ...candle(time, 100), closed: false };
  const newer = { ...candle(time, 101), high: 103, closed: false };
  const merged = mergeTradingCandleBatches(
    { candles: [older], sourceCandles: [older], source },
    { candles: [newer], sourceCandles: [newer], source },
  );

  assert.equal(merged.candles[0].close, 101);
  assert.equal(merged.candles[0].high, 103);
  assert.equal(merged.candles[0].closed, false);
});

test("startup reconciliation keeps REST authoritative for already closed history", () => {
  const source = { targetMs: 14_400_000, sourceInterval: "4h", sourceMs: 14_400_000 };
  const time = 1_787_918_400;
  const rest = { ...candle(time, 78_309), high: 79_840, low: 78_271, closed: true };
  const staleClosedCache = { ...candle(time, 79_520), high: 79_638.3, low: 79_505.8, closed: true };
  const merged = mergeTradingCandleBatches(
    { candles: [rest], sourceCandles: [rest], source },
    { candles: [staleClosedCache], sourceCandles: [staleClosedCache], source },
    { closedCandleAuthority: "current" },
  );

  assert.deepEqual(merged.candles[0], rest);
  assert.deepEqual(merged.sourceCandles[0], rest);
});
