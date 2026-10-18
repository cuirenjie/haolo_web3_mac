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
  constructor(message, { statusCode = 502, code = "MARKET_GATEWAY_ERROR", retryAfterMs = 0, upstreamStatus = 0, limitScope = "" } = {}) {
    super(message);
    this.name = "MarketGatewayError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.upstreamStatus = Number(upstreamStatus) || 0;
    this.limitScope = limitScope;
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
    const match = /^(\d+)([mhdwM])$/.exec(url.searchParams.get("interval") || "");
    const duration = match ? Number(match[1]) * ({m:60_000,h:3_600_000,d:86_400_000,w:604_800_000,M:32*86_400_000}[match[2]]) : Infinity;
    const end = Number(url.searchParams.get("endTime"));
    return end > 0 && end + duration < Date.now()
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
    this.cooldownStatus = new Map();
  }

  publicCooldownKey(marketType) {
    const egressId = String(this.config?.publicEgressId || "").trim();
    // Keep the historical key for the default single-egress deployment so a
    // rolling upgrade cannot forget an active cooldown written by the old
    // gateway. Explicit IDs opt into per-EIP isolation.
    return egressId && egressId !== "public-egress"
      ? `public-cooldown:${egressId}:${marketType}`
      : `public-cooldown:${marketType}`;
  }

  async rememberCooldown(marketType, status, retryMs) {
    const safeRetryMs = Math.max(1_000, Number(retryMs) || 60_000);
    const until = Date.now() + safeRetryMs;
    const previousUntil = Number(this.cooldownUntil.get(marketType) || 0);
    const effectiveUntil = Math.max(previousUntil, until);
    this.cooldownUntil.set(marketType, effectiveUntil);
    if (until >= previousUntil) this.cooldownStatus.set(marketType, Number(status) || 0);
    // A public gateway is normally replicated. Keep the upstream cooldown in
    // the same Redis-backed cache used by the shared weight ledger so one
    // replica cannot continue probing Binance after another replica receives
    // a 418/429. The memory cache remains the development fallback.
    if (typeof this.cache?.set === "function") {
      try {
        const cooldownValue = { until, status: Number(status) || 0 };
        const storedUntil = typeof this.cache?.setCooldownAtLeast === "function"
          ? await this.cache.setCooldownAtLeast(this.publicCooldownKey(marketType), cooldownValue, safeRetryMs)
          : (await this.cache.set(this.publicCooldownKey(marketType), cooldownValue, safeRetryMs, safeRetryMs), until);
        const sharedUntil = Math.max(effectiveUntil, Number(storedUntil) || until);
        if (sharedUntil > effectiveUntil) this.cooldownStatus.set(marketType, Number(status) || 0);
        this.cooldownUntil.set(marketType, sharedUntil);
      } catch {
        // Keep the local circuit breaker active if Redis is transiently
        // unavailable. A cache failure must not turn Binance's 429/418 into
        // a misleading gateway 500 response.
      }
    }
    return Number(this.cooldownUntil.get(marketType) || effectiveUntil);
  }

  async publicCooldown(marketType, nowMs = Date.now()) {
    let sharedCooldown = null;
    try {
      sharedCooldown = typeof this.cache?.getSharedValue === "function"
        ? await this.cache.getSharedValue(this.publicCooldownKey(marketType), nowMs)
        : await this.cache.get(this.publicCooldownKey(marketType), nowMs);
    } catch {
      // The local circuit breaker remains authoritative for this process.
    }
    const until = Math.max(
      Number(this.cooldownUntil.get(marketType) || 0),
      Number(sharedCooldown?.value?.until || 0),
    );
    if (until > nowMs) this.cooldownUntil.set(marketType, until);
    const status = Number(sharedCooldown?.value?.status)
      || Number(this.cooldownStatus.get(marketType) || 0)
      || 429;
    return Object.freeze({ until, status });
  }

  async get(requestUrl, { beforeUpstream = null, freshness = "default" } = {}) {
    const route = resolvePublicMarketRequest(requestUrl, this.config);
    const usable = (entry) => entry?.fresh && (freshness !== "live" || Date.now() - entry.storedAt <= 1_000);
    const readCache = () => this.cache.get(route.cacheKey, Date.now(), { maxAgeMs: freshness === "live" ? 1_000 : Infinity });
    const cached = await readCache();
    if (usable(cached)) return marketResult(route, { value: cached.value, cacheStatus: "HIT", statusCode: 200,
      headers: { "x-haolo-data-fetched-at": String(cached.storedAt || 0) } });
    const nowMs = Date.now();
    const sharedCooldown = await this.publicCooldown(route.marketType, nowMs);
    const cooldownUntil = sharedCooldown.until;
    if (cooldownUntil > nowMs) {
      this.cooldownUntil.set(route.marketType, cooldownUntil);
      const retryAfter = String(Math.max(1, Math.ceil((cooldownUntil - nowMs) / 1_000)));
      if (cached) return marketResult(route, {
        value: cached.value,
        cacheStatus: "STALE",
        statusCode: 200,
        headers: {
          "x-haolo-data-fetched-at": String(cached.storedAt || 0),
          "retry-after": retryAfter,
          "x-haolo-rate-limit-source": "gateway-upstream",
          "x-haolo-upstream-status": String(sharedCooldown.status),
        },
      });
      throw new MarketGatewayError("Binance upstream is cooling down", {
        statusCode: 503,
        code: "UPSTREAM_COOLDOWN",
        retryAfterMs: cooldownUntil - Date.now(),
        upstreamStatus: sharedCooldown.status,
      });
    }
    return this.cache.sharedSingleFlight(route.cacheKey, async (leaseSignal) => {
      const refreshed = await readCache();
      if (usable(refreshed)) return marketResult(route, { value: refreshed.value, cacheStatus: "HIT", statusCode: 200,
        headers: { "x-haolo-data-fetched-at": String(refreshed.storedAt || 0) } });
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
                "x-haolo-data-fetched-at": String(refreshed.storedAt || 0),
                ...(rateLimited ? { "x-haolo-rate-limit-source": "gateway-downstream" } : {}),
                ...(error?.limitScope ? { "x-haolo-rate-limit-scope": error.limitScope } : {}),
                ...(retryMs ? { "retry-after": String(Math.max(1, Math.ceil(retryMs / 1_000))) } : {}),
              },
            });
          }
          throw error;
        }
      }
      // Another replica may have received a Binance 418/429 while this
      // request was waiting for shared weight admission. Re-read the breaker
      // immediately before sending anything upstream.
      const lateCooldown = await this.publicCooldown(route.marketType, Date.now());
      if (lateCooldown.until > Date.now()) {
        if (refreshed) return marketResult(route, {
          value: refreshed.value,
          cacheStatus: "STALE",
          statusCode: 200,
          headers: {
            "x-haolo-data-fetched-at": String(refreshed.storedAt || 0),
            "retry-after": String(Math.max(1, Math.ceil((lateCooldown.until - Date.now()) / 1_000))),
            "x-haolo-rate-limit-source": "gateway-upstream",
            "x-haolo-upstream-status": String(lateCooldown.status),
          },
        });
        throw new MarketGatewayError("Binance upstream is cooling down", {
          statusCode: 503,
          code: "UPSTREAM_COOLDOWN",
          retryAfterMs: lateCooldown.until - Date.now(),
          upstreamStatus: lateCooldown.status,
        });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      timer.unref?.();
      let response;
      try {
        leaseSignal?.throwIfAborted();
        const signal = leaseSignal ? AbortSignal.any([leaseSignal, controller.signal]) : controller.signal;
        response = await this.fetchImpl(route.upstream, { method: "GET", signal, redirect: "error" });
      } catch (error) {
        clearTimeout(timer);
        if (refreshed) return marketResult(route, { value: refreshed.value, cacheStatus: "STALE", statusCode: 200,
          headers: { "x-haolo-data-fetched-at": String(refreshed.storedAt || 0) } });
        throw new MarketGatewayError(`Binance upstream request failed: ${String(error?.message || error)}`, { code: "UPSTREAM_UNAVAILABLE" });
      }
      let body;
      try {
        body = await response.text();
      } finally {
        clearTimeout(timer);
      }
      const headers = Object.fromEntries([...response.headers.entries()].filter(([key]) => /^x-mbx-used-weight|^retry-after$/i.test(key)));
      const observedWeightHeader = response.headers.get("x-mbx-used-weight-1m")
        || response.headers.get("x-mbx-used-weight");
      const observedWeight = observedWeightHeader == null || String(observedWeightHeader).trim() === ""
        ? Number.NaN
        : Number(observedWeightHeader);
      if (Number.isFinite(observedWeight) && observedWeight >= 0 && typeof this.cache.raiseWeightFloor === "function") {
        const observedAt = Date.now();
        const serverAt = Date.parse(response.headers.get("date") || "");
        const weightWindow = Math.floor((Number.isFinite(serverAt) ? serverAt : observedAt) / 60_000);
        await this.cache.raiseWeightFloor({
          shardId: this.config?.publicEgressId || "public-egress",
          marketType: route.marketType,
          windowId: weightWindow,
          value: observedWeight,
          ttlMs: 60_000 - (observedAt % 60_000) + 5_000,
        }).catch(() => {});
      }
      if (!response.ok) {
        const retryMs = retryAfterMs(response.headers.get("retry-after"));
        if (response.status === 418 || response.status === 429) {
          await this.rememberCooldown(route.marketType, response.status, retryMs || (response.status === 418 ? 300_000 : 60_000));
        }
        if (refreshed && (response.status >= 500 || response.status === 418 || response.status === 429)) {
          return marketResult(route, {
            value: refreshed.value,
            cacheStatus: "STALE",
            statusCode: 200,
            headers: {
              ...headers,
              "x-haolo-data-fetched-at": String(refreshed.storedAt || 0),
              ...(response.status === 418 || response.status === 429 ? { "x-haolo-upstream-status": String(response.status) } : {}),
              ...(response.status === 418 || response.status === 429 ? { "x-haolo-rate-limit-source": "gateway-upstream" } : {}),
            },
          });
        }
        throw new MarketGatewayError(`Binance upstream returned HTTP ${response.status}`, {
          statusCode: response.status === 418 || response.status === 429 ? 503 : response.status,
          code: response.status === 418 || response.status === 429 ? "UPSTREAM_RATE_LIMITED" : "UPSTREAM_REJECTED",
          retryAfterMs: retryMs,
          upstreamStatus: response.status,
        });
      }
      let value;
      try { value = body ? JSON.parse(body) : {}; } catch {
        throw new MarketGatewayError("Binance upstream returned invalid JSON", { code: "UPSTREAM_INVALID_RESPONSE" });
      }
      await this.cache.set(route.cacheKey, value, route.policy.fresh, route.policy.stale);
      headers["x-haolo-data-fetched-at"] = String(Date.now());
      return marketResult(route, { value, cacheStatus: "MISS", statusCode: 200, headers });
    }, { leaseMs: this.config.requestTimeoutMs + 5_000, readResult: async () => {
      const entry = await readCache();
      return usable(entry) ? marketResult(route, { value: entry.value, cacheStatus: "HIT", statusCode: 200,
        headers: { "x-haolo-data-fetched-at": String(entry.storedAt || 0) } }) : null;
    } }).catch((error) => {
      if (cached && ["MARKET_COORDINATION_UNAVAILABLE", "MARKET_REFRESH_PENDING"].includes(error?.code)) {
        return marketResult(route, { value: cached.value, cacheStatus: "STALE", statusCode: 200,
          headers: { "x-haolo-data-fetched-at": String(cached.storedAt || 0), "retry-after": "1" } });
      }
      throw error;
    });
  }
}

export const PUBLIC_FUTURES_PATHS = FUTURES_PATHS;
export const PUBLIC_SPOT_PATHS = SPOT_PATHS;
