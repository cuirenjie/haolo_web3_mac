export interface TradingCacheCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TradingCacheStats {
  symbol: string;
  markPrice: number;
  midPrice: number;
  oraclePrice: number;
  openInterest: number;
  fundingRate: number;
  nextFundingTime: number;
  prevDayPrice: number;
  volume24h: number;
}

export interface TradingCacheBatch {
  candles: TradingCacheCandle[];
  sourceCandles: TradingCacheCandle[];
  source: { targetMs: number; sourceInterval: string | null; sourceMs: number | null };
  lastTradeId?: number;
}

export interface TradingCacheSnapshot {
  stats: TradingCacheStats;
  candleBatch: TradingCacheBatch;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TradingMarketCandleCache {
  get(key: string, at?: number): (TradingCacheSnapshot & {
    cachedAt: number;
    ageMs: number;
    isStale: boolean;
  }) | null;
  set(key: string, snapshot: TradingCacheSnapshot, cachedAt?: number): void;
  delete(key: string): void;
  clearMemory(): void;
  size(): number;
}

export function createTradingMarketCandleCache(options?: {
  storage?: StorageLike | null;
  now?: (() => number) | number;
  freshAgeMs?: number;
  staleAgeMs?: number;
  maxEntries?: number;
  maxCandles?: number;
  maxSourceCandles?: number;
}): TradingMarketCandleCache;

export function mergeTradingCandleBatches(
  current: TradingCacheBatch,
  incoming: TradingCacheBatch,
  options?: { candleLimit?: number },
): TradingCacheBatch;

export const CACHE_VERSION: number;
export const DEFAULT_FRESH_AGE_MS: number;
export const DEFAULT_STALE_AGE_MS: number;
export const DEFAULT_MAX_ENTRIES: number;
export const DEFAULT_MAX_CANDLES: number;
export const DEFAULT_MAX_SOURCE_CANDLES: number;
export const STORAGE_INDEX_KEY: string;
export const STORAGE_PREFIX: string;
