const CACHE_VERSION = 1;
const DEFAULT_FRESH_AGE_MS = 5 * 60_000;
const DEFAULT_STALE_AGE_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_MAX_ENTRIES = 48;
const DEFAULT_MAX_CANDLES = 500;
const DEFAULT_MAX_SOURCE_CANDLES = 1_500;
const STORAGE_PREFIX = "haolo.trading.market.candles.v1.";
const STORAGE_INDEX_KEY = `${STORAGE_PREFIX}index`;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedCandle(value) {
  const candle = {
    time: Math.floor(finiteNumber(value?.time)),
    open: finiteNumber(value?.open),
    high: finiteNumber(value?.high),
    low: finiteNumber(value?.low),
    close: finiteNumber(value?.close),
    volume: Math.max(0, finiteNumber(value?.volume)),
  };
  if (
    candle.time <= 0
    || candle.open <= 0
    || candle.close <= 0
    || candle.high < Math.max(candle.open, candle.close)
    || candle.low > Math.min(candle.open, candle.close)
    || candle.low <= 0
  ) return null;
  return candle;
}

function normalizedCandles(value) {
  if (!Array.isArray(value)) return [];
  const map = new Map();
  for (const candidate of value) {
    const candle = normalizedCandle(candidate);
    if (candle) map.set(candle.time, candle);
  }
  return [...map.values()].sort((first, second) => first.time - second.time);
}

function cloneCandles(value) {
  return normalizedCandles(value).map((candle) => ({ ...candle }));
}

function normalizedSource(value) {
  const targetMs = Math.max(1, Math.floor(finiteNumber(value?.targetMs, 60_000)));
  const sourceInterval = String(value?.sourceInterval || "").trim() || null;
  const sourceMs = sourceInterval ? Math.max(1, Math.floor(finiteNumber(value?.sourceMs, targetMs))) : null;
  return { targetMs, sourceInterval, sourceMs };
}

function normalizedStats(value) {
  return {
    symbol: String(value?.symbol || "").trim().toUpperCase(),
    markPrice: finiteNumber(value?.markPrice),
    midPrice: finiteNumber(value?.midPrice),
    oraclePrice: finiteNumber(value?.oraclePrice),
    openInterest: finiteNumber(value?.openInterest),
    fundingRate: finiteNumber(value?.fundingRate),
    nextFundingTime: Math.max(0, finiteNumber(value?.nextFundingTime)),
    prevDayPrice: finiteNumber(value?.prevDayPrice),
    volume24h: Math.max(0, finiteNumber(value?.volume24h)),
  };
}

function cloneEntry(entry) {
  return {
    cachedAt: entry.cachedAt,
    stats: normalizedStats(entry.stats),
    candleBatch: {
      candles: cloneCandles(entry.candleBatch?.candles),
      sourceCandles: cloneCandles(entry.candleBatch?.sourceCandles),
      source: normalizedSource(entry.candleBatch?.source),
      ...(Number.isFinite(Number(entry.candleBatch?.lastTradeId))
        ? { lastTradeId: Number(entry.candleBatch.lastTradeId) }
        : {}),
    },
  };
}

function candleTuple(candle) {
  return [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume];
}

function candleFromTuple(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 5) return null;
  return normalizedCandle({
    time: tuple[0],
    open: tuple[1],
    high: tuple[2],
    low: tuple[3],
    close: tuple[4],
    volume: tuple[5],
  });
}

function serializeEntry(entry, limits) {
  const normalized = cloneEntry(entry);
  const candles = normalized.candleBatch.candles.slice(-limits.maxCandles);
  const source = normalized.candleBatch.source;
  const sourceCandles = source.sourceInterval && source.sourceMs !== source.targetMs
    ? normalized.candleBatch.sourceCandles.slice(-limits.maxSourceCandles)
    : [];
  const stats = normalized.stats;
  return {
    v: CACHE_VERSION,
    t: normalized.cachedAt,
    c: candles.map(candleTuple),
    s: sourceCandles.map(candleTuple),
    r: [source.targetMs, source.sourceInterval || "", source.sourceMs || 0],
    a: normalized.candleBatch.lastTradeId,
    m: [
      stats.symbol,
      stats.markPrice,
      stats.midPrice,
      stats.oraclePrice,
      stats.openInterest,
      stats.fundingRate,
      stats.nextFundingTime,
      stats.prevDayPrice,
      stats.volume24h,
    ],
  };
}

function deserializeEntry(payload) {
  if (!payload || Number(payload.v) !== CACHE_VERSION || !Array.isArray(payload.c) || !Array.isArray(payload.r)) return null;
  const candles = normalizedCandles(payload.c.map(candleFromTuple).filter(Boolean));
  if (!candles.length) return null;
  const source = normalizedSource({
    targetMs: payload.r[0],
    sourceInterval: payload.r[1],
    sourceMs: payload.r[2],
  });
  const persistedSourceCandles = Array.isArray(payload.s)
    ? normalizedCandles(payload.s.map(candleFromTuple).filter(Boolean))
    : [];
  const sourceCandles = source.sourceInterval && source.sourceMs === source.targetMs
    ? candles.map((candle) => ({ ...candle }))
    : persistedSourceCandles;
  const stats = Array.isArray(payload.m) ? payload.m : [];
  return cloneEntry({
    cachedAt: Math.max(0, finiteNumber(payload.t)),
    stats: {
      symbol: stats[0],
      markPrice: stats[1],
      midPrice: stats[2],
      oraclePrice: stats[3],
      openInterest: stats[4],
      fundingRate: stats[5],
      nextFundingTime: stats[6],
      prevDayPrice: stats[7],
      volume24h: stats[8],
    },
    candleBatch: {
      candles,
      sourceCandles,
      source,
      lastTradeId: payload.a,
    },
  });
}

function storageEntryKey(key) {
  return `${STORAGE_PREFIX}${encodeURIComponent(key)}`;
}

function readIndex(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_INDEX_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const key = String(item?.k || "").trim();
      const accessedAt = Math.max(0, finiteNumber(item?.a));
      return key ? [{ k: key, a: accessedAt }] : [];
    });
  } catch {
    return [];
  }
}

function writeIndex(storage, index) {
  storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
}

function mergeCandleSeries(current, incoming) {
  const map = new Map();
  normalizedCandles(current).forEach((candle) => map.set(candle.time, candle));
  normalizedCandles(incoming).forEach((candle) => map.set(candle.time, candle));
  return [...map.values()].sort((first, second) => first.time - second.time);
}

function aggregateCandles(candles, targetMs) {
  const buckets = new Map();
  for (const candle of normalizedCandles(candles)) {
    const bucketTime = Math.floor(candle.time * 1_000 / targetMs) * targetMs / 1_000;
    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, { ...candle, time: bucketTime });
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }
  return [...buckets.values()].sort((first, second) => first.time - second.time);
}

export function mergeTradingCandleBatches(current, incoming, { candleLimit = 500 } = {}) {
  const currentBatch = cloneEntry({ cachedAt: 0, stats: {}, candleBatch: current }).candleBatch;
  const incomingBatch = cloneEntry({ cachedAt: 0, stats: {}, candleBatch: incoming }).candleBatch;
  const source = normalizedSource(incomingBatch.source?.targetMs ? incomingBatch.source : currentBatch.source);
  const sameSource = currentBatch.source.targetMs === source.targetMs
    && currentBatch.source.sourceInterval === source.sourceInterval
    && currentBatch.source.sourceMs === source.sourceMs;
  const limit = Math.max(1, Math.floor(Number(candleLimit) || DEFAULT_MAX_CANDLES));
  let sourceCandles = sameSource
    ? mergeCandleSeries(currentBatch.sourceCandles, incomingBatch.sourceCandles)
    : incomingBatch.sourceCandles;
  let candles;
  if (source.sourceInterval && sourceCandles.length) {
    const recomputed = source.sourceMs === source.targetMs
      ? sourceCandles.map((candle) => ({ ...candle }))
      : aggregateCandles(sourceCandles, source.targetMs);
    candles = mergeCandleSeries(
      sameSource ? mergeCandleSeries(currentBatch.candles, incomingBatch.candles) : incomingBatch.candles,
      recomputed,
    );
  } else {
    candles = sameSource
      ? mergeCandleSeries(currentBatch.candles, incomingBatch.candles)
      : incomingBatch.candles;
  }
  const ratio = source.sourceMs ? Math.max(1, Math.ceil(source.targetMs / source.sourceMs)) : 1;
  const sourceLimit = Math.min(15_000, Math.max(limit * ratio + ratio + 2, DEFAULT_MAX_SOURCE_CANDLES));
  sourceCandles = sourceCandles.slice(-sourceLimit);
  const tradeIds = [currentBatch.lastTradeId, incomingBatch.lastTradeId]
    .map(Number)
    .filter(Number.isFinite);
  return {
    candles: candles.slice(-limit).map((candle) => ({ ...candle })),
    sourceCandles: sourceCandles.map((candle) => ({ ...candle })),
    source: { ...source },
    ...(tradeIds.length ? { lastTradeId: Math.max(...tradeIds) } : {}),
  };
}

export function createTradingMarketCandleCache({
  storage = null,
  now = Date.now,
  freshAgeMs = DEFAULT_FRESH_AGE_MS,
  staleAgeMs = DEFAULT_STALE_AGE_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxCandles = DEFAULT_MAX_CANDLES,
  maxSourceCandles = DEFAULT_MAX_SOURCE_CANDLES,
} = {}) {
  const memory = new Map();
  const limits = {
    maxCandles: Math.max(1, Math.floor(Number(maxCandles) || DEFAULT_MAX_CANDLES)),
    maxSourceCandles: Math.max(1, Math.floor(Number(maxSourceCandles) || DEFAULT_MAX_SOURCE_CANDLES)),
  };
  const capacity = Math.max(1, Math.floor(Number(maxEntries) || DEFAULT_MAX_ENTRIES));
  const currentTimeMs = () => {
    const value = typeof now === "function" ? now() : Date.now();
    return value instanceof Date ? value.getTime() : Number(value) || Date.now();
  };

  const remove = (key) => {
    memory.delete(key);
    if (!storage) return;
    try { storage.removeItem(storageEntryKey(key)); } catch {}
    try {
      writeIndex(storage, readIndex(storage).filter((item) => item.k !== key));
    } catch {}
  };

  const touchMemory = (key, entry) => {
    memory.delete(key);
    memory.set(key, entry);
    while (memory.size > capacity) memory.delete(memory.keys().next().value);
  };

  const touchPersistent = (key, accessedAt) => {
    if (!storage) return;
    const index = readIndex(storage).filter((item) => item.k !== key);
    index.push({ k: key, a: accessedAt });
    while (index.length > capacity) {
      const evicted = index.shift();
      if (evicted) {
        try { storage.removeItem(storageEntryKey(evicted.k)); } catch {}
      }
    }
    try { writeIndex(storage, index); } catch {}
  };

  const persist = (key, entry) => {
    if (!storage) return;
    const serialized = JSON.stringify(serializeEntry(entry, limits));
    const write = () => storage.setItem(storageEntryKey(key), serialized);
    let index = readIndex(storage).filter((item) => item.k !== key);
    let written = false;
    try {
      write();
      written = true;
    } catch {
      while (index.length) {
        const evicted = index.shift();
        try { storage.removeItem(storageEntryKey(evicted.k)); } catch {}
        try {
          write();
          written = true;
          break;
        } catch {}
      }
    }
    if (!written) return;
    index.push({ k: key, a: currentTimeMs() });
    while (index.length > capacity) {
      const evicted = index.shift();
      if (evicted) {
        try { storage.removeItem(storageEntryKey(evicted.k)); } catch {}
      }
    }
    try { writeIndex(storage, index); } catch {}
  };

  return Object.freeze({
    get(key, at = currentTimeMs()) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) return null;
      let entry = memory.get(normalizedKey) || null;
      if (!entry && storage) {
        try {
          entry = deserializeEntry(JSON.parse(storage.getItem(storageEntryKey(normalizedKey)) || "null"));
        } catch {
          entry = null;
        }
      }
      if (!entry) {
        try {
          if (storage?.getItem(storageEntryKey(normalizedKey)) !== null) remove(normalizedKey);
        } catch {}
        return null;
      }
      const ageMs = Math.max(0, Number(at) - entry.cachedAt);
      if (ageMs > staleAgeMs) {
        remove(normalizedKey);
        return null;
      }
      touchMemory(normalizedKey, entry);
      touchPersistent(normalizedKey, Number(at));
      return {
        ...cloneEntry(entry),
        ageMs,
        isStale: ageMs > freshAgeMs,
      };
    },

    set(key, snapshot, cachedAt = currentTimeMs()) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) throw new TypeError("cache key is required");
      const entry = cloneEntry({
        cachedAt: Math.max(1, Number(cachedAt) || currentTimeMs()),
        stats: snapshot?.stats,
        candleBatch: snapshot?.candleBatch,
      });
      if (!entry.candleBatch.candles.length) return;
      entry.candleBatch.candles = entry.candleBatch.candles.slice(-limits.maxCandles);
      entry.candleBatch.sourceCandles = entry.candleBatch.sourceCandles.slice(-limits.maxSourceCandles);
      touchMemory(normalizedKey, entry);
      persist(normalizedKey, entry);
    },

    delete: remove,
    clearMemory() { memory.clear(); },
    size() { return memory.size; },
  });
}

export {
  CACHE_VERSION,
  DEFAULT_FRESH_AGE_MS,
  DEFAULT_MAX_CANDLES,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_SOURCE_CANDLES,
  DEFAULT_STALE_AGE_MS,
  STORAGE_INDEX_KEY,
  STORAGE_PREFIX,
};
