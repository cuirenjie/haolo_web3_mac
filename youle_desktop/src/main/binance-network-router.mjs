import { DEFAULT_DIRECT_ENDPOINTS } from "./binance-gateway-config.mjs";

const ACCOUNT_ORIGINS = new Set([
  "https://api.binance.com",
  "https://fapi.binance.com",
]);
const ROUTE_BLOCKING_STATUSES = new Set([403, 451]);

export const BINANCE_DIRECT_ROUTE_FAILED = "BINANCE_DIRECT_ROUTE_FAILED";

export class BinanceDirectRouteError extends Error {
  constructor(message = "Direct Binance route is unavailable", options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "BinanceDirectRouteError";
    this.code = BINANCE_DIRECT_ROUTE_FAILED;
    this.marketType = options.marketType || null;
  }
}

function normalizedMarketType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "spot" || normalized === "futures") return normalized;
  throw new TypeError("unsupported Binance market type");
}

function publicMarketType(url) {
  if (url.origin === DEFAULT_DIRECT_ENDPOINTS.publicRest.futures) return "futures";
  if (url.origin === DEFAULT_DIRECT_ENDPOINTS.publicRest.spot) return "spot";
  throw new TypeError("public Binance router target is not allowed");
}

function privateMarketType(url) {
  if (!ACCOUNT_ORIGINS.has(url.origin)) throw new TypeError("private Binance router target is not allowed");
  return url.origin === "https://fapi.binance.com" || url.pathname.startsWith("/fapi/")
    ? "futures"
    : "spot";
}

function routeKey(kind, marketType) {
  return `${kind}:${marketType}`;
}

function isRouteBlockingResponse(response) {
  return ROUTE_BLOCKING_STATUSES.has(Number(response?.status || 0));
}

function websocketKey(marketType, combined) {
  return combined ? `${marketType}Combined` : marketType;
}

async function fetchWithDeadline(fetchImpl, input, init, timeoutMs) {
  if (init?.signal?.aborted) throw init.signal.reason || new DOMException("The operation was aborted", "AbortError");
  const timeoutController = new AbortController();
  const signals = [timeoutController.signal, init?.signal].filter(Boolean);
  const signal = typeof AbortSignal?.any === "function"
    ? AbortSignal.any(signals)
    : timeoutController.signal;
  const forwardAbort = typeof AbortSignal?.any !== "function" && init?.signal
    ? () => timeoutController.abort(init.signal.reason)
    : null;
  if (forwardAbort) init.signal.addEventListener("abort", forwardAbort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error("Direct Binance attempt timed out");
    error.name = "TimeoutError";
    timeoutController.abort(error);
  }, timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(input, { ...init, signal });
  } finally {
    clearTimeout(timer);
    if (forwardAbort) init.signal.removeEventListener("abort", forwardAbort);
  }
}

export class BinanceNetworkRouter {
  constructor({
    config,
    directFetch = globalThis.fetch,
    gatewayClient = null,
    privateProxyFetch = null,
    now = Date.now,
    cooldownBaseMs = 15_000,
    cooldownMaxMs = 5 * 60_000,
    healthyTtlMs = 30_000,
  } = {}) {
    if (!config || typeof directFetch !== "function") throw new TypeError("config and directFetch are required");
    this.config = config;
    this.directFetch = directFetch;
    this.gatewayClient = gatewayClient;
    this.privateProxyFetch = privateProxyFetch;
    this.now = now;
    this.cooldownBaseMs = Math.max(1_000, Number(cooldownBaseMs) || 15_000);
    this.cooldownMaxMs = Math.max(this.cooldownBaseMs, Number(cooldownMaxMs) || 5 * 60_000);
    this.healthyTtlMs = Math.max(1_000, Number(healthyTtlMs) || 30_000);
    this.states = new Map();
  }

  currentTimeMs() {
    const value = typeof this.now === "function" ? this.now() : Date.now();
    return value instanceof Date ? value.getTime() : Number(value) || Date.now();
  }

  state(key) {
    let value = this.states.get(key);
    if (!value) {
      value = { failures: 0, cooldownUntil: 0, healthyUntil: 0, probing: false };
      this.states.set(key, value);
    }
    return value;
  }

  fallbackAvailable(kind) {
    return kind === "public"
      ? Boolean(this.config.marketGatewayEnabled && this.gatewayClient)
      : Boolean(this.config.privateProxyEnabled && this.privateProxyFetch);
  }

  acquire(kind, marketType) {
    const mode = this.config.routingMode || this.config.mode || "direct";
    if (mode === "gateway") return { route: "gateway", state: null, probe: false };
    if (mode === "direct" || !this.fallbackAvailable(kind)) return { route: "direct", state: null, probe: false };
    const state = this.state(routeKey(kind, marketType));
    const currentMs = this.currentTimeMs();
    if (state.cooldownUntil > currentMs || state.probing) return { route: "gateway", state, probe: false };
    const probe = state.failures > 0;
    if (probe) state.probing = true;
    return { route: "direct", state, probe };
  }

  markDirectSuccess(kind, marketType) {
    const state = this.state(routeKey(kind, marketType));
    state.failures = 0;
    state.cooldownUntil = 0;
    state.healthyUntil = this.currentTimeMs() + this.healthyTtlMs;
    state.probing = false;
  }

  markDirectFailure(kind, marketType) {
    const state = this.state(routeKey(kind, marketType));
    state.failures = Math.min(20, state.failures + 1);
    const cooldownMs = Math.min(this.cooldownMaxMs, this.cooldownBaseMs * 2 ** Math.min(state.failures - 1, 6));
    state.cooldownUntil = this.currentTimeMs() + cooldownMs;
    state.healthyUntil = 0;
    state.probing = false;
  }

  releaseProbe(state) {
    if (state) state.probing = false;
  }

  gatewayPublicUrl(url) {
    if (!this.config.marketOrigin) throw new Error("Haolo market gateway is not configured");
    const gatewayUrl = new URL(url.href);
    const origin = new URL(this.config.marketOrigin);
    gatewayUrl.protocol = origin.protocol;
    gatewayUrl.host = origin.host;
    return gatewayUrl.href;
  }

  async publicGatewayFetch(url, init) {
    if (!this.gatewayClient) throw new Error("Haolo market gateway is not configured");
    return this.gatewayClient.fetch(this.gatewayPublicUrl(url), init);
  }

  directRequest(kind, input, init) {
    const mode = this.config.routingMode || this.config.mode || "direct";
    if (mode !== "auto" || !this.fallbackAvailable(kind)) return this.directFetch(input, init);
    return fetchWithDeadline(
      this.directFetch,
      input,
      init,
      this.config.directAttemptTimeoutMs || 3_000,
    );
  }

  async publicFetch(input, init = {}) {
    const url = new URL(String(input));
    const marketType = publicMarketType(url);
    const decision = this.acquire("public", marketType);
    if (decision.route === "gateway") return this.publicGatewayFetch(url, init);
    try {
      const response = await this.directRequest("public", url.href, init);
      if (!isRouteBlockingResponse(response)) {
        this.markDirectSuccess("public", marketType);
        return response;
      }
      if (!this.fallbackAvailable("public")) return response;
      this.markDirectFailure("public", marketType);
      return this.publicGatewayFetch(url, init);
    } catch (error) {
      if (init?.signal?.aborted || !this.fallbackAvailable("public")) throw error;
      this.markDirectFailure("public", marketType);
      return this.publicGatewayFetch(url, init);
    } finally {
      this.releaseProbe(decision.probe ? decision.state : null);
    }
  }

  async privateFetch(input, init = {}) {
    const url = new URL(String(input));
    const marketType = privateMarketType(url);
    const method = String(init.method || "GET").toUpperCase();
    if (method !== "GET") throw new TypeError("private Binance router permits GET only");
    const decision = this.acquire("private", marketType);
    if (decision.route === "gateway") return this.privateProxyFetch(url.href, init);
    try {
      const response = await this.directRequest("private", url.href, init);
      if (!isRouteBlockingResponse(response)) {
        this.markDirectSuccess("private", marketType);
        return response;
      }
      if (!this.fallbackAvailable("private")) return response;
      this.markDirectFailure("private", marketType);
      throw new BinanceDirectRouteError("Direct Binance account route was blocked", { marketType });
    } catch (error) {
      if (error?.code === BINANCE_DIRECT_ROUTE_FAILED) throw error;
      if (init?.signal?.aborted || !this.fallbackAvailable("private")) throw error;
      this.markDirectFailure("private", marketType);
      throw new BinanceDirectRouteError("Direct Binance account route failed", { cause: error, marketType });
    } finally {
      this.releaseProbe(decision.probe ? decision.state : null);
    }
  }

  async probePublicDirect(marketType) {
    const pingPath = marketType === "futures" ? "/fapi/v1/ping" : "/api/v3/ping";
    const pingUrl = new URL(pingPath, `${this.config.publicRest[marketType]}/`).href;
    const response = await fetchWithDeadline(
      this.directFetch,
      pingUrl,
      { method: "GET", cache: "no-store" },
      this.config.directAttemptTimeoutMs || 3_000,
    );
    if (isRouteBlockingResponse(response)) throw new Error(`Direct Binance probe returned HTTP ${response.status}`);
    return response;
  }

  async marketStreamEndpoint({ marketType: value, combined = false } = {}) {
    const marketType = normalizedMarketType(value);
    const directEndpoint = this.config.publicWebSocket[websocketKey(marketType, combined)];
    const mode = this.config.routingMode || this.config.mode || "direct";
    if (mode === "direct" || !this.fallbackAvailable("public")) {
      return Object.freeze({ url: directEndpoint, route: "direct", marketType });
    }
    if (mode === "gateway") {
      const url = await this.gatewayClient.marketStreamEndpoint({ marketType, combined });
      return Object.freeze({ url, route: "gateway", marketType });
    }
    const state = this.state(routeKey("public", marketType));
    const currentMs = this.currentTimeMs();
    if (state.cooldownUntil > currentMs || state.probing) {
      const url = await this.gatewayClient.marketStreamEndpoint({ marketType, combined });
      return Object.freeze({ url, route: "gateway", marketType });
    }
    if (state.healthyUntil > currentMs) {
      return Object.freeze({ url: directEndpoint, route: "direct", marketType });
    }
    state.probing = true;
    try {
      await this.probePublicDirect(marketType);
      this.markDirectSuccess("public", marketType);
      return Object.freeze({ url: directEndpoint, route: "direct", marketType });
    } catch {
      this.markDirectFailure("public", marketType);
      const url = await this.gatewayClient.marketStreamEndpoint({ marketType, combined });
      return Object.freeze({ url, route: "gateway", marketType });
    } finally {
      state.probing = false;
    }
  }

  reportMarketStreamOutcome({ marketType: value, route, outcome, connectedDurationMs = 0 } = {}) {
    if (route !== "direct" || (this.config.routingMode || this.config.mode) !== "auto") return;
    const marketType = normalizedMarketType(value);
    if (outcome === "connected") {
      this.markDirectSuccess("public", marketType);
      return;
    }
    if (outcome === "failed" && Number(connectedDurationMs || 0) < 30_000) {
      this.markDirectFailure("public", marketType);
    }
  }

  snapshot() {
    const currentMs = this.currentTimeMs();
    return Object.freeze(Object.fromEntries([...this.states].map(([key, state]) => [key, Object.freeze({
      failures: state.failures,
      cooldownRemainingMs: Math.max(0, state.cooldownUntil - currentMs),
      healthyRemainingMs: Math.max(0, state.healthyUntil - currentMs),
      probing: state.probing,
    })])));
  }
}

export { ACCOUNT_ORIGINS, ROUTE_BLOCKING_STATUSES };
