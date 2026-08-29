const DEFAULT_DIRECT_ENDPOINTS = Object.freeze({
  publicRest: Object.freeze({
    futures: "https://fapi.binance.com",
    spot: "https://data-api.binance.vision",
  }),
  publicWebSocket: Object.freeze({
    futures: "wss://fstream.binance.com/ws",
    spot: "wss://data-stream.binance.vision:443/ws",
    futuresCombined: "wss://fstream.binance.com/stream",
    spotCombined: "wss://data-stream.binance.vision:443/stream",
  }),
});

const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function httpsOrigin(value, field, { required = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw && !required) return "";
  let parsed;
  try { parsed = new URL(raw); } catch { throw new TypeError(`${field} is invalid`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new TypeError(`${field} must be an HTTPS origin`);
  }
  return parsed.origin;
}

function secureProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try { parsed = new URL(raw); } catch { throw new TypeError("HAOLO_BINANCE_PRIVATE_PROXY_URL is invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new TypeError("HAOLO_BINANCE_PRIVATE_PROXY_URL must be an HTTPS origin");
  }
  return parsed.origin;
}

function booleanValue(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function routingModeValue(value, fallback) {
  const normalized = String(value || fallback || "").trim().toLowerCase();
  if (!["auto", "direct", "gateway"].includes(normalized)) {
    throw new TypeError("HAOLO_BINANCE_ROUTING_MODE must be auto, direct or gateway");
  }
  return normalized;
}

function positiveInteger(value, fallback, { min = 500, max = 30_000 } = {}) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function durationValue(value, fallback, { min, max }) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function resolutionCandidates(value) {
  if (value == null || value === "") return Object.freeze([]);
  const candidates = Array.isArray(value) ? value : String(value).split(",");
  if (candidates.length > 8) throw new TypeError("Binance gateway resolution candidates are limited to 8 hosts");
  const normalized = candidates.map((candidate) => String(candidate || "").trim().toLowerCase().replace(/\.$/, ""));
  if (normalized.some((candidate) => !DNS_HOSTNAME_PATTERN.test(candidate))) {
    throw new TypeError("Binance gateway resolution candidates must be DNS hostnames or IPv4 addresses");
  }
  return Object.freeze([...new Set(normalized)]);
}

export function resolveBinanceGatewayConfig(env = process.env, deployment = {}) {
  const marketOrigin = httpsOrigin(
    env.HAOLO_BINANCE_MARKET_GATEWAY_URL || deployment.marketGatewayUrl,
    "HAOLO_BINANCE_MARKET_GATEWAY_URL",
  );
  const privateProxyUrl = secureProxyUrl(env.HAOLO_BINANCE_PRIVATE_PROXY_URL || deployment.privateProxyUrl);
  const gatewayEnabled = Boolean(marketOrigin);
  const routingMode = routingModeValue(
    env.HAOLO_BINANCE_ROUTING_MODE || deployment.routingMode,
    marketOrigin || privateProxyUrl ? "auto" : "direct",
  );
  const requireGateway = env.HAOLO_BINANCE_REQUIRE_GATEWAY == null
    ? deployment.requireGateway === true
    : booleanValue(env.HAOLO_BINANCE_REQUIRE_GATEWAY);
  if (requireGateway && (!marketOrigin || !privateProxyUrl)) {
    throw new TypeError("HAOLO_BINANCE_REQUIRE_GATEWAY requires both market and private Binance gateway origins");
  }
  if (routingMode === "gateway" && (!marketOrigin || !privateProxyUrl)) {
    throw new TypeError("HAOLO_BINANCE_ROUTING_MODE=gateway requires both market and private Binance gateway origins");
  }
  const websocketOrigin = marketOrigin ? marketOrigin.replace(/^https:/, "wss:") : "";
  const gatewayPublicRest = Object.freeze({ futures: marketOrigin, spot: marketOrigin });
  const gatewayPublicWebSocket = Object.freeze({
    futures: gatewayEnabled ? `${websocketOrigin}/ws/futures` : "",
    spot: gatewayEnabled ? `${websocketOrigin}/ws/spot` : "",
    futuresCombined: gatewayEnabled ? `${websocketOrigin}/stream/futures` : "",
    spotCombined: gatewayEnabled ? `${websocketOrigin}/stream/spot` : "",
  });
  return Object.freeze({
    mode: routingMode,
    routingMode,
    requireGateway,
    marketOrigin,
    marketGatewayResolutionCandidates: resolutionCandidates(
      env.HAOLO_BINANCE_MARKET_GATEWAY_RESOLUTION_CANDIDATES
        || deployment.marketGatewayResolutionCandidates,
    ),
    ticketUrl: gatewayEnabled ? `${marketOrigin}/api/market/v1/tickets` : "",
    privatePermitUrl: gatewayEnabled ? `${marketOrigin}/api/private/v1/permits` : "",
    privateUsageUrl: gatewayEnabled ? `${marketOrigin}/api/private/v1/usage` : "",
    publicRest: DEFAULT_DIRECT_ENDPOINTS.publicRest,
    publicWebSocket: DEFAULT_DIRECT_ENDPOINTS.publicWebSocket,
    gatewayPublicRest,
    gatewayPublicWebSocket,
    marketGatewayEnabled: gatewayEnabled,
    privateProxyUrl,
    privateProxyEnabled: Boolean(privateProxyUrl && marketOrigin),
    directAttemptTimeoutMs: positiveInteger(
      env.HAOLO_BINANCE_DIRECT_ATTEMPT_TIMEOUT_MS || deployment.directAttemptTimeoutMs,
      3_000,
    ),
    publicHedgeDelayMs: durationValue(
      env.HAOLO_BINANCE_PUBLIC_HEDGE_DELAY_MS || deployment.publicHedgeDelayMs,
      200,
      { min: 50, max: 2_000 },
    ),
    routePreferenceTtlMs: durationValue(
      env.HAOLO_BINANCE_ROUTE_PREFERENCE_TTL_MS || deployment.routePreferenceTtlMs,
      30 * 60_000,
      { min: 60_000, max: 6 * 60 * 60_000 },
    ),
    backgroundProbeIntervalMs: durationValue(
      env.HAOLO_BINANCE_BACKGROUND_PROBE_INTERVAL_MS || deployment.backgroundProbeIntervalMs,
      45_000,
      { min: 10_000, max: 5 * 60_000 },
    ),
    gatewayRequestTimeoutMs: durationValue(
      env.HAOLO_BINANCE_GATEWAY_REQUEST_TIMEOUT_MS || deployment.gatewayRequestTimeoutMs,
      8_000,
      { min: 2_000, max: 60_000 },
    ),
  });
}

export function withMarketTicket(endpoint, ticket) {
  const url = new URL(endpoint);
  if (ticket) url.searchParams.set("ticket", String(ticket));
  return url.href;
}

export { DEFAULT_DIRECT_ENDPOINTS };
