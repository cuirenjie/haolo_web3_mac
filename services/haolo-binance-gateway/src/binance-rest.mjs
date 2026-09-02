const FUTURES_PATHS = new Set([
  "/fapi/v1/exchangeInfo",
  "/fapi/v1/ticker/24hr",
  "/fapi/v1/premiumIndex",
  "/fapi/v1/openInterest",
  "/fapi/v1/klines",
  "/fapi/v1/aggTrades",
  "/fapi/v1/depth",
  "/futures/data/openInterestHist",
]);

const SPOT_PATHS = new Set([
  "/api/v3/exchangeInfo",
  "/api/v3/ticker/24hr",
  "/api/v3/ticker",
  "/api/v3/ticker/price",
  "/api/v3/ticker/bookTicker",
  "/api/v3/klines",
  "/api/v3/uiKlines",
  "/api/v3/aggTrades",
  "/api/v3/depth",
  "/api/v3/trades",
  "/api/v3/avgPrice",
  "/api/v3/time",
  "/api/v3/ping",
]);

const SYMBOL_PATTERN = /^[A-Z0-9_\p{Script=Han}]{2,40}$/u;
const INTERVAL_PATTERN = /^(?:1s|[1-9]\d*[mhdwM])$/;
const QUERY_KEYS = new Set([
  "symbol", "symbols", "interval", "limit", "startTime", "endTime", "contractType", "period", "pair", "timezone",
  "type", "symbolStatus", "timeZone", "permissions", "fromId",
]);

export class MarketGatewayError extends Error {
  constructor(message, { statusCode = 502, code = "MARKET_GATEWAY_ERROR", retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "MarketGatewayError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(value, now = Date.now()) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : 0;
}

function validateQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (!QUERY_KEYS.has(key)) throw new MarketGatewayError(`unsupported query parameter: ${key}`, { statusCode: 400, code: "INVALID_QUERY" });
  }
  const symbol = url.searchParams.get("symbol");
  if (symbol && !SYMBOL_PATTERN.test(symbol)) throw new MarketGatewayError("invalid symbol", { statusCode: 400, code: "INVALID_SYMBOL" });
  const symbols = url.searchParams.get("symbols");
  if (symbols) {
    let parsed;
    try { parsed = JSON.parse(symbols); } catch {}
    if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some((entry) => !SYMBOL_PATTERN.test(String(entry)))) {
      throw new MarketGatewayError("invalid symbols", { statusCode: 400, code: "INVALID_SYMBOLS" });
    }
  }
  const interval = url.searchParams.get("interval") || url.searchParams.get("period");
  if (interval && !INTERVAL_PATTERN.test(interval)) throw new MarketGatewayError("invalid interval", { statusCode: 400, code: "INVALID_INTERVAL" });
  const limit = url.searchParams.get("limit");
  if (limit != null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 1_500)) {
    throw new MarketGatewayError("invalid limit", { statusCode: 400, code: "INVALID_LIMIT" });
  }
  for (const key of ["startTime", "endTime"]) {
    const value = url.searchParams.get(key);
    if (value != null && (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      throw new MarketGatewayError(`invalid ${key}`, { statusCode: 400, code: "INVALID_TIME" });
    }
  }
}

function cachePolicy(pathname, url) {
  if (pathname.endsWith("exchangeInfo")) return { fresh: 6 * 60 * 60_000, stale: 24 * 60 * 60_000 };
  if (pathname.endsWith("klines") || pathname.endsWith("uiKlines")) {
    return url.searchParams.has("endTime")
      ? { fresh: 60 * 60_000, stale: 24 * 60 * 60_000 }
      : { fresh: 1_000, stale: 30_000 };
  }
  if (pathname.endsWith("openInterestHist")) return { fresh: 30_000, stale: 5 * 60_000 };
  if (pathname.includes("ticker") || pathname.endsWith("premiumIndex") || pathname.endsWith("openInterest")) {
    return { fresh: 2_000, stale: 30_000 };
  }
  return { fresh: 1_000, stale: 10_000 };
}

function depthWeight(limit, futures) {
  if (futures) {
    if (limit <= 50) return 2;
    if (limit <= 100) return 5;
    if (limit <= 500) return 10;
    return 20;
  }
  if (limit <= 100) return 5;
  if (limit <= 500) return 25;
  if (limit <= 1_000) return 50;
  return 250;
}

export function publicMarketRequestWeight(marketType, pathname, url) {
  const hasSymbol = url.searchParams.has("symbol");
  const limit = Math.max(1, Number(url.searchParams.get("limit")) || 500);
  if (pathname.endsWith("/aggTrades")) return marketType === "futures" ? 20 : 2;
  if (pathname.endsWith("/depth")) return depthWeight(limit, marketType === "futures");
  if (pathname.endsWith("/klines") || pathname.endsWith("/uiKlines")) {
    if (marketType === "spot") return 2;
    if (limit < 100) return 1;
    if (limit < 500) return 2;
    if (limit <= 1_000) return 5;
    return 10;
  }
  if (pathname.endsWith("/ticker/24hr")) return hasSymbol ? 2 : 80;
  if (pathname.endsWith("/exchangeInfo")) return marketType === "spot" ? 20 : 1;
  return 1;
}

function canonicalCacheKey(marketType, pathname, searchParams) {
  const sorted = [...searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return `rest:${marketType}:${pathname}?${new URLSearchParams(sorted)}`;
}

export function resolvePublicMarketRequest(requestUrl, config) {
  const url = new URL(requestUrl, "http://gateway.local");
  let marketType;
  let pathname = url.pathname;
  const versioned = /^\/api\/market\/v1\/binance\/(spot|futures)(\/.*)$/.exec(pathname);
  if (versioned) {
    marketType = versioned[1];
    pathname = versioned[2];
  } else if (pathname.startsWith("/fapi/") || pathname.startsWith("/futures/")) {
    marketType = "futures";
  } else if (pathname.startsWith("/api/")) {
    marketType = "spot";
  }
  if (!marketType) throw new MarketGatewayError("unknown market route", { statusCode: 404, code: "NOT_FOUND" });
  const allowed = marketType === "futures" ? FUTURES_PATHS : SPOT_PATHS;
  if (!allowed.has(pathname)) throw new MarketGatewayError("market route is not allowed", { statusCode: 404, code: "ROUTE_NOT_ALLOWED" });
  validateQuery(url);
  const baseUrl = marketType === "futures" ? config.futuresRestBaseUrl : config.spotRestBaseUrl;
  const upstream = new URL(`${baseUrl}${pathname}`);
  upstream.search = url.search;
  return Object.freeze({
    marketType,
    pathname,
    upstream,
    policy: cachePolicy(pathname, url),
    cacheKey: canonicalCacheKey(marketType, pathname, url.searchParams),
    weight: publicMarketRequestWeight(marketType, pathname, url),
  });
}

function marketResult(route, value) {
  return Object.freeze({ marketType: route.marketType, ...value });
}

export class BinanceRestGateway {
  constructor({ config, cache, fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.cache = cache;
    this.fetchImpl = fetchImpl;
    this.cooldownUntil = new Map();
  }

  async get(requestUrl, { beforeUpstream = null } = {}) {
    const route = resolvePublicMarketRequest(requestUrl, this.config);
    const cached = await this.cache.get(route.cacheKey);
    if (cached?.fresh) return marketResult(route, { value: cached.value, cacheStatus: "HIT", statusCode: 200, headers: {} });
    const cooldownUntil = Number(this.cooldownUntil.get(route.marketType) || 0);
    if (cooldownUntil > Date.now()) {
      const retryAfter = String(Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1_000)));
      if (cached) return marketResult(route, {
        value: cached.value,
        cacheStatus: "STALE",
        statusCode: 200,
        headers: { "retry-after": retryAfter, "x-haolo-rate-limit-source": "gateway-upstream" },
      });
      throw new MarketGatewayError("Binance upstream is cooling down", { statusCode: 503, code: "UPSTREAM_COOLDOWN", retryAfterMs: cooldownUntil - Date.now() });
    }
    return this.cache.singleFlight(route.cacheKey, async () => {
      const refreshed = await this.cache.get(route.cacheKey);
      if (refreshed?.fresh) return marketResult(route, { value: refreshed.value, cacheStatus: "HIT", statusCode: 200, headers: {} });
      if (typeof beforeUpstream === "function") {
        try {
          await beforeUpstream(route);
        } catch (error) {
          if (refreshed) {
            const retryMs = Math.max(0, Number(error?.retryAfterMs) || 0);
            const rateLimited = error?.code === "RATE_LIMITED";
            return marketResult(route, {
              value: refreshed.value,
              cacheStatus: "STALE",
              statusCode: 200,
              headers: {
                ...(rateLimited ? { "x-haolo-rate-limit-source": "gateway-downstream" } : {}),
                ...(retryMs ? { "retry-after": String(Math.max(1, Math.ceil(retryMs / 1_000))) } : {}),
              },
            });
          }
          throw error;
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      timer.unref?.();
      let response;
      try {
        response = await this.fetchImpl(route.upstream, { method: "GET", signal: controller.signal, redirect: "error" });
      } catch (error) {
        if (refreshed) return marketResult(route, { value: refreshed.value, cacheStatus: "STALE", statusCode: 200, headers: {} });
        throw new MarketGatewayError(`Binance upstream request failed: ${String(error?.message || error)}`, { code: "UPSTREAM_UNAVAILABLE" });
      } finally {
        clearTimeout(timer);
      }
      const body = await response.text();
      const headers = Object.fromEntries([...response.headers.entries()].filter(([key]) => /^x-mbx-used-weight|^retry-after$/i.test(key)));
      const observedWeightHeader = response.headers.get("x-mbx-used-weight-1m")
        || response.headers.get("x-mbx-used-weight");
      const observedWeight = observedWeightHeader == null || String(observedWeightHeader).trim() === ""
        ? Number.NaN
        : Number(observedWeightHeader);
      if (Number.isFinite(observedWeight) && observedWeight >= 0 && typeof this.cache.raiseWeightFloor === "function") {
        const observedAt = Date.now();
        await this.cache.raiseWeightFloor({
          shardId: "public-egress",
          marketType: route.marketType,
          windowId: Math.floor(observedAt / 60_000),
          value: observedWeight,
          ttlMs: 60_000 - (observedAt % 60_000) + 5_000,
        }).catch(() => {});
      }
      if (!response.ok) {
        const retryMs = retryAfterMs(response.headers.get("retry-after"));
        if (response.status === 418 || response.status === 429) {
          this.cooldownUntil.set(route.marketType, Date.now() + Math.max(1_000, retryMs || 60_000));
        }
        if (refreshed && (response.status >= 500 || response.status === 418 || response.status === 429)) {
          return marketResult(route, {
            value: refreshed.value,
            cacheStatus: "STALE",
            statusCode: 200,
            headers: {
              ...headers,
              ...(response.status === 418 || response.status === 429 ? { "x-haolo-rate-limit-source": "gateway-upstream" } : {}),
            },
          });
        }
        throw new MarketGatewayError(`Binance upstream returned HTTP ${response.status}`, {
          statusCode: response.status === 418 || response.status === 429 ? 503 : response.status,
          code: response.status === 418 || response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REJECTED",
          retryAfterMs: retryMs,
        });
      }
      let value;
      try { value = body ? JSON.parse(body) : {}; } catch {
        throw new MarketGatewayError("Binance upstream returned invalid JSON", { code: "UPSTREAM_INVALID_RESPONSE" });
      }
      await this.cache.set(route.cacheKey, value, route.policy.fresh, route.policy.stale);
      return marketResult(route, { value, cacheStatus: "MISS", statusCode: 200, headers });
    });
  }
}

export const PUBLIC_FUTURES_PATHS = FUTURES_PATHS;
export const PUBLIC_SPOT_PATHS = SPOT_PATHS;
