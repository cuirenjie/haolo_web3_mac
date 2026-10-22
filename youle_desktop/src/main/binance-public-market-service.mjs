import { bufferBinanceResponse, fetchBinanceResponse } from "./binance-response-body.mjs";

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
  ...["globalLongShortAccountRatio", "topLongShortAccountRatio", "topLongShortPositionRatio"].map(route => [`futures:/futures/data/${route}`, ["symbol", "period", "limit", "startTime", "endTime"]]),
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
  for (const key of allowed) {
    const normalized = validateParameter(key, parameters[key]);
    if (normalized !== null) url.searchParams.set(key, normalized);
  }
  if (/\/futures\/data\/(?:globalLongShortAccountRatio|topLongShortAccountRatio|topLongShortPositionRatio)$/.test(route)) {
    if (!url.searchParams.has("symbol") || !["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"].includes(url.searchParams.get("period")) || Number(url.searchParams.get("limit") || 30) > 500) {
      throw new BinancePublicMarketRequestError("Invalid Binance ratio parameters");
    }
  }
  const freshness = value.freshness === "live" ? "live" : "default";
  return Object.freeze({ marketType, path: route, url: url.href, freshness,
    demand: value.demand === "prefetch" ? "prefetch" : "interactive" });
}

function historicalKlines(request, now) {
  const url = new URL(request.url);
  const match = /^(\d+)([smhdwM])$/.exec(url.searchParams.get("interval") || "");
  const duration = match ? Number(match[1]) * ({s:1000,m:60_000,h:3_600_000,d:86_400_000,w:604_800_000,M:32*86_400_000}[match[2]]) : Infinity;
  const end = Number(url.searchParams.get("endTime"));
  return end > 0 && end + duration < now;
}

function cacheTtlMs(request, now) {
  if (request.path.endsWith("Ratio")) return 60_000;
  if (request.path.endsWith("/exchangeInfo")) return 6 * 60 * 60_000;
  if (request.path.endsWith("/openInterestHist")) return 60_000;
  if (request.path.endsWith("/ticker/24hr")) return new URL(request.url).searchParams.has("symbol") ? 2_000 : 30_000;
  if (request.path.endsWith("/premiumIndex") || request.path.endsWith("/openInterest")) return 2_000;
  if (request.path.endsWith("/klines")) {
    return historicalKlines(request, now) ? 60_000 : 1_000;
  }
  return 1_000;
}

function cacheStaleTtlMs(request, now) {
  if (request.path.endsWith("Ratio")) return 5 * 60_000;
  if (request.path.endsWith("/exchangeInfo")) return 24 * 60 * 60_000;
  if (request.path.endsWith("/openInterestHist")) return 5 * 60_000;
  if (request.path.endsWith("/ticker/24hr")) return 60_000;
  if (request.path.endsWith("/premiumIndex") || request.path.endsWith("/openInterest")) return 2 * 60_000;
  if (request.path.endsWith("/klines")) {
    return historicalKlines(request, now) ? 24 * 60 * 60_000 : 5 * 60_000;
  }
  // Depth and aggregate trades are order-flow evidence, so their emergency
  // fallback is deliberately tiny compared with candles and metadata.
  return 10_000;
}

function cloneData(value) {
  return value == null ? value : structuredClone(value);
}

function responseEtag(response) {
  const value = String(response?.headers?.get?.("etag") || "");
  return /^(?:W\/)?"[^"\r\n]{1,240}"$/.test(value) ? value : null;
}

function retryAfterMs(response, currentMs = Date.now()) {
  const raw = String(response?.headers?.get?.("retry-after") || "").trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - currentMs) : null;
}

function headerNumber(response, name) {
  const raw = response?.headers?.get?.(name);
  if (raw == null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function headerStatus(response, name) {
  const value = headerNumber(response, name);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function responseDiagnostics(response) {
  const status = Number(response?.status || 0);
  const route = String(response?.headers?.get?.("x-haolo-binance-route") || "unknown").slice(0, 32);
  const egress = String(response?.headers?.get?.("x-haolo-binance-egress") || "unknown").slice(0, 32);
  const source = String(response?.headers?.get?.("x-haolo-rate-limit-source") || "").slice(0, 32);
  let origin = "none";
  if (source === "local-budget") origin = "local_budget";
  else if (source === "direct-binance") origin = "direct_binance";
  else if (source === "gateway-downstream") origin = "gateway_downstream";
  else if (source === "gateway-upstream") origin = "gateway_upstream";
  else if ([418, 429].includes(status)) origin = route.includes("gateway") ? "gateway_downstream" : "direct_binance";
  return Object.freeze({
    route,
    egress,
    origin,
    limitScope: String(response?.headers?.get?.("x-haolo-rate-limit-scope") || "unknown").slice(0, 32),
    cacheStatus: String(response?.headers?.get?.("x-haolo-cache") || "none").slice(0, 16).toUpperCase(),
    upstreamStatus: headerStatus(response, "x-haolo-upstream-status"),
    usedWeight: headerNumber(response, "x-mbx-used-weight-1m")
      ?? headerNumber(response, "x-sapi-used-ip-weight-1m")
      ?? headerNumber(response, "x-mbx-used-weight"),
    gatewayRemaining: headerNumber(response, "x-ratelimit-remaining"),
  });
}

function isRateLimitedOrigin(diagnostics) {
  const origin = String(diagnostics?.origin || "");
  if (["direct_binance", "gateway_downstream", "local_budget"].includes(origin)) return true;
  return origin === "gateway_upstream"
    && [418, 429].includes(Number(diagnostics?.upstreamStatus));
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
    this.deferred = new Map();
    this.lifecycleController = new AbortController();
    this.pendingRequests = new Set();
    this.flights = new Map();
    this.closePromise = null;
  }

  currentTimeMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value) || Date.now();
  }

  cached(url, currentMs, freshness = "default") {
    const entry = this.cache.get(url);
    if (!entry || entry.expiresAt <= currentMs) return null;
    if (freshness === "live" && currentMs - entry.storedAt > 1_000) return null;
    this.cache.delete(url);
    this.cache.set(url, entry);
    return {
      ok: true,
      status: 200,
      data: cloneData(entry.data),
      cached: true,
      retryAfterMs: null,
      fetchedAt: entry.storedAt,
      diagnostics: Object.freeze({ route: "memory-cache", egress: "client", origin: "none", cacheStatus: "HIT", upstreamStatus: null, usedWeight: null, gatewayRemaining: null }),
    };
  }

  stale(url, currentMs) {
    const entry = this.cache.get(url);
    if (!entry || entry.staleUntil <= currentMs) {
      if (entry) this.cache.delete(url);
      return null;
    }
    return entry;
  }

  staleResult(entry, currentMs, { status = 0, retryAfter = null, diagnostics = null, error = "" } = {}) {
    return {
      ok: true,
      status: 200,
      data: cloneData(entry.data),
      cached: true,
      stale: true,
      staleAgeMs: Math.max(0, currentMs - entry.expiresAt),
      fetchedAt: entry.storedAt,
      sourceStatus: Number(status || 0),
      retryAfterMs: retryAfter,
      rateLimited: [418, 429].includes(Number(status))
        || isRateLimitedOrigin(diagnostics),
      diagnostics: diagnostics || Object.freeze({ route: "memory-cache", egress: "client", origin: "transport", cacheStatus: "STALE", upstreamStatus: null, usedWeight: null, gatewayRemaining: null }),
      ...(error ? { degradedReason: String(error).slice(0, 500) } : {}),
    };
  }

  store(url, data, currentMs, request, { fresh = true, fetchedAt = null, etag = null } = {}) {
    const prior = this.cache.get(url);
    // Repeated stale responses must not restart the age/retention clock.
    const storedAt = Number.isFinite(fetchedAt) && fetchedAt > 0
      ? Math.min(currentMs, fetchedAt)
      : !fresh && prior ? prior.storedAt : currentMs;
    const freshMs = fresh ? cacheTtlMs(request, storedAt) : 0;
    const expiresAt = storedAt + freshMs;
    this.cache.delete(url);
    this.cache.set(url, {
      data: cloneData(data),
      etag,
      storedAt,
      expiresAt,
      staleUntil: expiresAt + cacheStaleTtlMs(request, storedAt),
    });
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
  }

  request(value = {}, { signal: callerSignal } = {}) {
    const lifecycleSignal = this.lifecycleController.signal;
    if (lifecycleSignal.aborted) return Promise.reject(lifecycleSignal.reason);
    if (callerSignal?.aborted) return Promise.reject(callerSignal.reason);
    let request;
    try { request = normalizeBinancePublicMarketRequest(value, { baseUrls: this.baseUrls }); }
    catch { return this.requestInternal(value, { signal: lifecycleSignal }); }
    // A background request must never determine the priority/freshness of a
    // live caller. Canonical URL parameters allow equivalent requests to join.
    const key = `${request.url}\n${request.freshness}\n${request.demand}`;
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, consumers: 0, settled: false };
      const signal = AbortSignal.any([controller.signal, lifecycleSignal]);
      flight.promise = this.requestInternal(value, { signal });
      this.flights.set(key, flight);
      this.pendingRequests.add(flight.promise);
      const done = () => {
        flight.settled = true;
        if (this.flights.get(key) === flight) this.flights.delete(key);
        this.pendingRequests.delete(flight.promise);
      };
      flight.promise.then(done, done);
    }
    flight.consumers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (callback, result) => {
        if (finished) return;
        finished = true;
        callerSignal?.removeEventListener("abort", abort);
        flight.consumers--;
        if (!flight.consumers && !flight.settled) {
          if (this.flights.get(key) === flight) this.flights.delete(key);
          flight.controller.abort(new DOMException("No market request consumers remain", "AbortError"));
        }
        callback(result);
      };
      const abort = () => finish(reject, callerSignal.reason);
      callerSignal?.addEventListener("abort", abort, { once: true });
      flight.promise.then(result => finish(resolve, cloneData(result)), error => finish(reject, error));
    });
  }

  close(reason = new DOMException("The Binance market service is closing", "AbortError")) {
    if (this.closePromise) return this.closePromise;
    this.lifecycleController.abort(reason);
    this.closePromise = Promise.allSettled([...this.pendingRequests]).then(() => undefined);
    return this.closePromise;
  }

  async requestInternal(value = {}, { signal: callerSignal } = {}) {
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
    if (callerSignal?.aborted) {
      throw callerSignal.reason || new DOMException("The operation was aborted", "AbortError");
    }
    const currentMs = this.currentTimeMs();
    const cached = this.cached(request.url, currentMs, request.freshness);
    if (cached) return cached;
    const deferred = this.deferred.get(request.url);
    if (deferred?.until > currentMs) {
      const result = { ...deferred.result, retryAfterMs: deferred.until - currentMs };
      const stale = this.stale(request.url, currentMs);
      return stale ? this.staleResult(stale, currentMs, {
        status: result.status, retryAfter: result.retryAfterMs, diagnostics: result.diagnostics,
      }) : result;
    }
    this.deferred.delete(request.url);
    const controller = this.timeoutMs > 0 ? new AbortController() : null;
    const forwardAbort = controller && callerSignal
      ? () => controller.abort(callerSignal.reason || new DOMException("The operation was aborted", "AbortError"))
      : null;
    if (forwardAbort) callerSignal.addEventListener("abort", forwardAbort, { once: true });
    const timer = controller
      ? setTimeout(() => controller.abort(new DOMException("Binance market request timed out", "TimeoutError")), this.timeoutMs)
      : null;
    timer?.unref?.();
    const signal = controller?.signal || callerSignal;
    let response;
    const retained = this.stale(request.url, currentMs);
    // Sequence-sensitive bootstrap endpoints always receive a complete body.
    const validator = !/\/(?:depth|aggTrades)$/.test(request.path) ? retained?.etag : null;
    try {
      response = await fetchBinanceResponse(this.fetch, request.url, {
        method: "GET",
        cache: "no-store",
        headers: {
          ...(validator ? { "if-none-match": validator } : {}),
          ...(request.freshness === "live" ? { "x-haolo-market-freshness": "live" } : {}),
          ...(request.demand === "prefetch" ? { "x-haolo-market-demand": "prefetch" } : {}),
        },
        signal,
      });
      const complete = await bufferBinanceResponse(response, { signal });
      let data;
      const notModified = response.status === 304;
      if (notModified) {
        // Conditional GET uses weak comparison: a compressing proxy can mark
        // the 200 tag weak while forwarding the origin's strong tag on 304.
        const returnedTag = responseEtag(response);
        if (!validator || !returnedTag || returnedTag.replace(/^W\//, "") !== validator.replace(/^W\//, "")
          || retained.staleUntil <= this.currentTimeMs()) {
          throw new Error("Market response has no usable matching ETag representation");
        }
        data = retained.data;
      } else try { data = await complete.json(); } catch (error) {
        // Non-JSON HTTP errors still carry useful status/Retry-After headers.
        if (response.ok) throw error;
        data = null;
      }
      signal?.throwIfAborted();
      if (response.ok && (data === null || typeof data !== "object")) {
        throw new Error("Binance market response does not contain JSON market data");
      }
      const completedAt = this.currentTimeMs();
      const diagnostics = responseDiagnostics(response);
      const responseRetryAfterMs = retryAfterMs(response, completedAt);
      if ([418, 429].includes(response.status) || isRateLimitedOrigin(diagnostics)) {
        this.deferred.set(request.url, {
          until: completedAt + Math.max(1_000, responseRetryAfterMs ?? 60_000),
          result: { ok: false, status: response.ok ? 429 : response.status, data: null,
            cached: false, rateLimited: true, diagnostics, error: "Market request is waiting for capacity" },
        });
        while (this.deferred.size > MAX_CACHE_ENTRIES) this.deferred.delete(this.deferred.keys().next().value);
      }
      if (!response.ok && !notModified) {
        const errorCode = Number(data?.code) === -1121
          ? "BINANCE_MARKET_SYMBOL_UNAVAILABLE"
          : null;
        const status = Number(response.status || 0);
        const error = String(data?.msg || `Binance market request failed: ${status}`).slice(0, 500);
        const stale = this.stale(request.url, completedAt);
        if (stale && (status === 418 || status === 429 || status >= 500 || !status)) {
          return this.staleResult(stale, completedAt, {
            status, retryAfter: responseRetryAfterMs, diagnostics, error,
          });
        }
        return {
          ok: false, status, data: null, cached: false,
          retryAfterMs: responseRetryAfterMs, error, diagnostics,
          rateLimited: [418, 429].includes(status) || isRateLimitedOrigin(diagnostics),
          ...(errorCode ? { errorCode } : {}),
        };
      }
      const gatewayStale = diagnostics.cacheStatus === "STALE";
      // A 304 without origin timing proves equality, not data freshness.
      const fetchedAt = headerNumber(response, "x-haolo-data-fetched-at") || (notModified ? retained.storedAt : null);
      const tooOldForLive = request.freshness === "live" && fetchedAt > 0 && completedAt - fetchedAt > 1_000;
      const expiredValidation = notModified && completedAt - fetchedAt >= cacheTtlMs(request, fetchedAt);
      this.store(request.url, data, completedAt, request, {
        fresh: !gatewayStale && !tooOldForLive && !expiredValidation, fetchedAt, etag: responseEtag(response),
      });
      if (gatewayStale || tooOldForLive || expiredValidation) {
        const entry = this.stale(request.url, completedAt);
        if (!entry) return { ok: false, status: 503, data: null, cached: false,
          error: "Market data exceeded its retention window", diagnostics };
        return this.staleResult(entry, completedAt, {
          status: Number(response.status || 200), retryAfter: responseRetryAfterMs, diagnostics,
        });
      }
      return {
        ok: true, status: notModified ? 200 : Number(response.status || 200), data: cloneData(data),
        cached: notModified, revalidated: notModified, retryAfterMs: null, diagnostics, fetchedAt: this.cache.get(request.url)?.storedAt,
      };
    } catch (error) {
      if (callerSignal?.aborted) throw callerSignal.reason || error;
      const failedAt = this.currentTimeMs();
      const evidence = response || error?.binanceResponse;
      const sourceStatus = Number(evidence?.status || 0);
      const status = sourceStatus >= 400 ? sourceStatus : 0;
      const retryAfter = retryAfterMs(evidence, failedAt);
      const diagnostics = evidence ? Object.freeze({
        ...responseDiagnostics(evidence),
        ...(sourceStatus < 400 ? { origin: "transport" } : {}),
      }) : Object.freeze({
        route: "unknown",
        egress: "unknown",
        origin: "transport",
        cacheStatus: "NONE",
        upstreamStatus: null,
        usedWeight: null,
        gatewayRemaining: null,
      });
      const stale = this.stale(request.url, failedAt);
      if (stale && (!status || status === 418 || status === 429 || status >= 500)) {
        return this.staleResult(stale, failedAt, {
          status, retryAfter, diagnostics, error: error?.message || error,
        });
      }
      return {
        ok: false,
        status,
        data: null,
        cached: false,
        retryAfterMs: retryAfter,
        rateLimited: [418, 429].includes(status) || isRateLimitedOrigin(diagnostics),
        error: String(error?.message || error || "Binance market request failed").slice(0, 500),
        diagnostics,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (forwardAbort) callerSignal.removeEventListener("abort", forwardAbort);
    }
  }
}
