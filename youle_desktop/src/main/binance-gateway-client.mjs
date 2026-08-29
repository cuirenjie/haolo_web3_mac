import { withMarketTicket } from "./binance-gateway-config.mjs";

const HAOLO_DESKTOP_CLIENT_ID = process.platform === "darwin"
  ? "macos-desktop"
  : process.platform === "win32"
    ? "windows-desktop"
    : "linux-desktop";

export class BinancePrivatePermitError extends Error {
  constructor(message, { status = 503, retryAfterMs = 0, code = "PRIVATE_EGRESS_UNAVAILABLE" } = {}) {
    super(message);
    this.name = "BinancePrivatePermitError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.code = code;
  }
}

function mergeHeaders(initHeaders, authorization) {
  const headers = new Headers(initHeaders || {});
  headers.set("Authorization", authorization);
  headers.set("X-Haolo-Client", HAOLO_DESKTOP_CLIENT_ID);
  return headers;
}

function privateRouteMetadata(input) {
  const url = new URL(String(input));
  if (!["https://api.binance.com", "https://fapi.binance.com"].includes(url.origin)) {
    throw new TypeError("private Binance permit target is not allowed");
  }
  return Object.freeze({
    marketType: url.origin === "https://fapi.binance.com" || url.pathname.startsWith("/fapi/") ? "futures" : "spot",
    pathname: url.pathname,
    hasSymbol: url.searchParams.has("symbol"),
  });
}

export function createBinanceGatewayClient({ config, apiClient, fetchImpl = globalThis.fetch } = {}) {
  if (!config || !apiClient || typeof fetchImpl !== "function") throw new TypeError("config, apiClient and fetchImpl are required");
  const authorization = async (forceRefresh = false) => `Bearer ${await apiClient.getTrustedAccessToken({ forceRefresh })}`;
  const authenticatedFetch = async (url, init = {}) => {
    let response = await fetchImpl(url, {
      ...init,
      headers: mergeHeaders(init.headers, await authorization()),
    });
    if (response.status !== 401 || init.signal?.aborted) return response;
    try { await response.body?.cancel?.(); } catch {}
    response = await fetchImpl(url, {
      ...init,
      headers: mergeHeaders(init.headers, await authorization(true)),
    });
    return response;
  };
  return Object.freeze({
    async fetch(url, init = {}) {
      if (!config.marketGatewayEnabled) throw new Error("Haolo market gateway is not configured");
      return authenticatedFetch(url, init);
    },
    async marketStreamEndpoint({ marketType, combined = false } = {}) {
      const normalizedMarket = String(marketType || "").toLowerCase();
      if (!["spot", "futures"].includes(normalizedMarket)) throw new TypeError("invalid marketType");
      const key = combined ? `${normalizedMarket}Combined` : normalizedMarket;
      const endpoint = config.gatewayPublicWebSocket[key];
      if (!endpoint || !config.ticketUrl) throw new Error("Haolo market gateway is not configured");
      const response = await authenticatedFetch(config.ticketUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ticket) throw new Error(`Haolo market ticket failed: HTTP ${response.status}`);
      return withMarketTicket(endpoint, payload.ticket);
    },
    async privateRequestPermit(targetUrl, { signal } = {}) {
      if (!config.privateProxyEnabled || !config.privatePermitUrl) throw new Error("Haolo private egress is not configured");
      const response = await authenticatedFetch(config.privatePermitUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(privateRouteMetadata(targetUrl)),
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.permitToken || !payload?.proxyUrl || !payload?.permitId) {
        throw new BinancePrivatePermitError(`Haolo private egress permit failed: HTTP ${response.status}`, {
          status: response.status,
          retryAfterMs: Number(payload?.retryAfterMs || 0),
          code: String(payload?.error || "PRIVATE_EGRESS_UNAVAILABLE"),
        });
      }
      return payload;
    },
    async reportPrivateUsage(report = {}) {
      if (!config.privateUsageUrl) return false;
      const response = await authenticatedFetch(config.privateUsageUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          permitId: String(report.permitId || ""),
          status: Number(report.status || 0),
          usedWeight1m: Number(report.usedWeight1m || 0),
          retryAfterMs: Number(report.retryAfterMs || 0),
        }),
        cache: "no-store",
      });
      return response.ok;
    },
  });
}

export { privateRouteMetadata };
