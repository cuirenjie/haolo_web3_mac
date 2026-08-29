/**
 * Binance's public Spot market-data host is intentionally separate from the
 * authenticated Spot API host. Futures keeps Binance's documented default,
 * while both values can be overridden for a deployment-side market gateway.
 */
export const DEFAULT_BINANCE_PUBLIC_MARKET_BASE_URLS = Object.freeze({
  futures: "https://fapi.binance.com",
  spot: "https://data-api.binance.vision",
});

const BINANCE_PUBLIC_MARKET_BASE_URL_ENV_KEYS = Object.freeze({
  futures: "HAOLO_BINANCE_FUTURES_MARKET_BASE_URL",
  spot: "HAOLO_BINANCE_SPOT_MARKET_BASE_URL",
});

function normalizeBaseUrl(value, fallback) {
  const raw = String(value || fallback || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BinancePublicMarketRequestError("Invalid Binance market base URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new BinancePublicMarketRequestError("Binance market base URL must be an HTTPS origin");
  }
  return parsed.origin;
}

export function resolveBinancePublicMarketBaseUrls(env = process.env) {
  const source = env && typeof env === "object" ? env : {};
  return Object.freeze({
    futures: normalizeBaseUrl(
      source[BINANCE_PUBLIC_MARKET_BASE_URL_ENV_KEYS.futures],
      DEFAULT_BINANCE_PUBLIC_MARKET_BASE_URLS.futures,
    ),
    spot: normalizeBaseUrl(
      source[BINANCE_PUBLIC_MARKET_BASE_URL_ENV_KEYS.spot],
      DEFAULT_BINANCE_PUBLIC_MARKET_BASE_URLS.spot,
    ),
  });
}

const ROUTES = new Map([
  ["futures:/fapi/v1/exchangeInfo", []],
  ["futures:/fapi/v1/ticker/24hr", ["symbol"]],
  ["futures:/fapi/v1/premiumIndex", ["symbol"]],
  ["futures:/fapi/v1/openInterest", ["symbol"]],
  ["futures:/fapi/v1/klines", ["symbol", "interval", "limit", "startTime", "endTime"]],
  ["futures:/fapi/v1/aggTrades", ["symbol", "fromId", "startTime", "endTime", "limit"]],
  ["futures:/fapi/v1/depth", ["symbol", "limit"]],
  ["futures:/futures/data/openInterestHist", ["symbol", "period", "limit", "startTime", "endTime"]],
  ["spot:/api/v3/exchangeInfo", ["permissions", "symbolStatus"]],
  ["spot:/api/v3/ticker/24hr", ["symbol", "type"]],
  ["spot:/api/v3/klines", ["symbol", "interval", "limit", "startTime", "endTime"]],
  ["spot:/api/v3/aggTrades", ["symbol", "fromId", "startTime", "endTime", "limit"]],
  ["spot:/api/v3/depth", ["symbol", "limit"]],
]);

const MAX_CACHE_ENTRIES = 256;
const REQUEST_TIMEOUT_MS = 12_000;

export class BinancePublicMarketRequestError extends Error {
  constructor(message, code = "BINANCE_MARKET_REQUEST_INVALID") {
    super(message);
    this.name = "BinancePublicMarketRequestError";
    this.code = code;
  }
}

function validateParameter(key, value) {
  if (value === undefined || value === null || value === "") return null;
  if (key === "symbol") {
    const symbol = String(value).trim().toUpperCase();
    // Binance USDⓈ-M Futures can use Han characters as the canonical API
    // symbol (for example 龙虾USDT and 币安人生USDT). Keep the allowlist
    // narrow while accepting the symbol alphabet returned by exchangeInfo.
    if (!/^[A-Z0-9_\p{Script=Han}]{2,40}$/u.test(symbol)) {
      throw new BinancePublicMarketRequestError("Invalid Binance symbol", "BINANCE_MARKET_SYMBOL_INVALID");
    }
    return symbol;
  }
  if (key === "interval" || key === "period") {
    const interval = String(value);
    if (!/^\d{1,3}[smhdwM]$/.test(interval)) throw new BinancePublicMarketRequestError("Invalid Binance interval");
    return interval;
  }
  if (key === "permissions") {
    if (String(value).toUpperCase() !== "SPOT") throw new BinancePublicMarketRequestError("Invalid Binance permissions");
    return "SPOT";
  }
  if (key === "symbolStatus") {
    if (String(value).toUpperCase() !== "TRADING") throw new BinancePublicMarketRequestError("Invalid Binance symbol status");
    return "TRADING";
  }
  if (key === "type") {
    const type = String(value).toUpperCase();
    if (!new Set(["FULL", "MINI"]).has(type)) throw new BinancePublicMarketRequestError("Invalid Binance ticker type");
    return type;
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new BinancePublicMarketRequestError(`Invalid Binance parameter: ${key}`);
  if (key === "limit" && (numeric < 1 || numeric > 5_000)) throw new BinancePublicMarketRequestError("Invalid Binance limit");
  return String(numeric);
}

export function normalizeBinancePublicMarketRequest(value = {}, { baseUrls = resolveBinancePublicMarketBaseUrls() } = {}) {
  const marketType = String(value?.marketType || "").toLowerCase();
  const route = String(value?.path || "");
  if (!Object.hasOwn(baseUrls, marketType)) throw new BinancePublicMarketRequestError("Invalid Binance market type");
  const allowed = ROUTES.get(`${marketType}:${route}`);
  if (!allowed) throw new BinancePublicMarketRequestError("Binance market route is not allowed");
  const parameters = value?.parameters == null ? {} : value.parameters;
  if (typeof parameters !== "object" || Array.isArray(parameters)) throw new BinancePublicMarketRequestError("Invalid Binance parameters");
  const keys = Object.keys(parameters);
  if (keys.length > 8 || keys.some((key) => !allowed.includes(key))) {
    throw new BinancePublicMarketRequestError("Binance market parameter is not allowed");
  }
  const url = new URL(route, normalizeBaseUrl(baseUrls[marketType], DEFAULT_BINANCE_PUBLIC_MARKET_BASE_URLS[marketType]));
  for (const key of keys) {
    const normalized = validateParameter(key, parameters[key]);
    if (normalized !== null) url.searchParams.set(key, normalized);
  }
  return Object.freeze({ marketType, path: route, url: url.href });
}

function cacheTtlMs(request) {
  if (request.path.endsWith("/exchangeInfo")) return 6 * 60 * 60_000;
  if (request.path.endsWith("/openInterestHist")) return 60_000;
  if (request.path.endsWith("/ticker/24hr")) return new URL(request.url).searchParams.has("symbol") ? 2_000 : 30_000;
  if (request.path.endsWith("/premiumIndex") || request.path.endsWith("/openInterest")) return 2_000;
  if (request.path.endsWith("/klines")) return new URL(request.url).searchParams.has("endTime") ? 60_000 : 1_000;
  return 1_000;
}

function cloneData(value) {
  return value == null ? value : structuredClone(value);
}

function retryAfterMs(response) {
  const value = Number(response?.headers?.get?.("retry-after"));
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value * 1_000) : null;
}

export class BinancePublicMarketService {
  constructor({
    fetch: networkFetch = globalThis.fetch,
    now = Date.now,
    timeoutMs = REQUEST_TIMEOUT_MS,
    baseUrls = resolveBinancePublicMarketBaseUrls(),
  } = {}) {
    if (typeof networkFetch !== "function") throw new TypeError("fetch is required");
    this.fetch = networkFetch;
    this.now = now;
    this.timeoutMs = Number(timeoutMs) === 0
      ? 0
      : Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS);
    this.baseUrls = Object.freeze({
      futures: normalizeBaseUrl(baseUrls?.futures, DEFAULT_BINANCE_PUBLIC_MARKET_BASE_URLS.futures),
      spot: normalizeBaseUrl(baseUrls?.spot, DEFAULT_BINANCE_PUBLIC_MARKET_BASE_URLS.spot),
    });
    this.cache = new Map();
  }

  currentTimeMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value) || Date.now();
  }

  cached(url, currentMs) {
    const entry = this.cache.get(url);
    if (!entry || entry.expiresAt <= currentMs) {
      if (entry) this.cache.delete(url);
      return null;
    }
    return { ok: true, status: 200, data: cloneData(entry.data), cached: true, retryAfterMs: null };
  }

  store(url, data, expiresAt) {
    this.cache.delete(url);
    this.cache.set(url, { data: cloneData(data), expiresAt });
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
  }

  async request(value = {}, { signal: callerSignal } = {}) {
    let request;
    try {
      request = normalizeBinancePublicMarketRequest(value, { baseUrls: this.baseUrls });
    } catch (error) {
      if (!(error instanceof BinancePublicMarketRequestError)) throw error;
      return {
        ok: false,
        status: 400,
        data: null,
        cached: false,
        retryAfterMs: null,
        error: error.message,
        errorCode: error.code,
      };
    }
    const currentMs = this.currentTimeMs();
    const cached = this.cached(request.url, currentMs);
    if (cached) return cached;
    if (callerSignal?.aborted) {
      throw callerSignal.reason || new DOMException("The operation was aborted", "AbortError");
    }
    const controller = this.timeoutMs > 0 ? new AbortController() : null;
    const forwardAbort = controller && callerSignal
      ? () => controller.abort(callerSignal.reason || new DOMException("The operation was aborted", "AbortError"))
      : null;
    if (forwardAbort) callerSignal.addEventListener("abort", forwardAbort, { once: true });
    const timer = controller
      ? setTimeout(() => controller.abort(new DOMException("The operation was aborted", "AbortError")), this.timeoutMs)
      : null;
    timer?.unref?.();
    let response;
    try {
      response = await this.fetch(request.url, {
        method: "GET",
        cache: "no-store",
        signal: controller?.signal || callerSignal,
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (forwardAbort) callerSignal.removeEventListener("abort", forwardAbort);
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response?.ok) {
      const errorCode = Number(data?.code) === -1121
        ? "BINANCE_MARKET_SYMBOL_UNAVAILABLE"
        : null;
      return {
        ok: false,
        status: Number(response?.status || 0),
        data: null,
        cached: false,
        retryAfterMs: retryAfterMs(response),
        error: String(data?.msg || `Binance market request failed: ${response?.status || 0}`).slice(0, 500),
        ...(errorCode ? { errorCode } : {}),
      };
    }
    this.store(request.url, data, currentMs + cacheTtlMs(request));
    return { ok: true, status: Number(response.status || 200), data: cloneData(data), cached: false, retryAfterMs: null };
  }
}
