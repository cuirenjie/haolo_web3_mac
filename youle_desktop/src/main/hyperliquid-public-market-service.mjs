const INFO_URL = "https://api.hyperliquid.xyz/info";
const SUPPORTED_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "8h", "12h", "1d", "3d", "1w", "1M",
]);
const MAX_CACHE_ENTRIES = 96;
const REQUEST_TIMEOUT_MS = 12_000;

export class HyperliquidPublicMarketRequestError extends Error {
  constructor(message, code = "HYPERLIQUID_MARKET_REQUEST_INVALID") {
    super(message);
    this.name = "HyperliquidPublicMarketRequestError";
    this.code = code;
  }
}

function boundedInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new HyperliquidPublicMarketRequestError(`${field} is invalid`);
  }
  return normalized;
}

export function normalizeHyperliquidCandleRequest(value = {}) {
  const coin = String(value?.coin || "").trim().toUpperCase();
  const interval = String(value?.interval || "").trim();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(coin)) {
    throw new HyperliquidPublicMarketRequestError("Invalid Hyperliquid coin");
  }
  if (!SUPPORTED_INTERVALS.has(interval)) {
    throw new HyperliquidPublicMarketRequestError("Invalid Hyperliquid interval");
  }
  const startTime = boundedInteger(value?.startTime, "startTime");
  const endTime = boundedInteger(value?.endTime, "endTime");
  if (endTime < startTime || endTime - startTime > 6 * 366 * 86_400_000) {
    throw new HyperliquidPublicMarketRequestError("Invalid Hyperliquid time range");
  }
  return Object.freeze({ coin, interval, startTime, endTime });
}

function cloneData(value) {
  return value == null ? value : structuredClone(value);
}

function retryAfterMs(response) {
  const value = Number(response?.headers?.get?.("retry-after"));
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value * 1_000) : null;
}

export class HyperliquidPublicMarketService {
  constructor({ fetch: networkFetch = globalThis.fetch, now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (typeof networkFetch !== "function") throw new TypeError("fetch is required");
    this.fetch = networkFetch;
    this.now = now;
    this.timeoutMs = Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS);
    this.cache = new Map();
  }

  currentTimeMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value) || Date.now();
  }

  async candles(value = {}) {
    const request = normalizeHyperliquidCandleRequest(value);
    const cacheKey = JSON.stringify(request);
    const currentMs = this.currentTimeMs();
    const cached = this.cache.get(cacheKey);
    if (cached?.expiresAt > currentMs) {
      return { ok: true, status: 200, data: cloneData(cached.data), cached: true, retryAfterMs: null };
    }
    if (cached) this.cache.delete(cacheKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetch(INFO_URL, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: request }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response?.ok || !Array.isArray(data)) {
      return {
        ok: false,
        status: Number(response?.status || 0),
        data: null,
        cached: false,
        retryAfterMs: retryAfterMs(response),
        error: String(data?.error || `Hyperliquid market request failed: ${response?.status || 0}`).slice(0, 500),
      };
    }
    this.cache.set(cacheKey, { data: cloneData(data), expiresAt: currentMs + 15_000 });
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
    return { ok: true, status: Number(response.status || 200), data: cloneData(data), cached: false, retryAfterMs: null };
  }
}
