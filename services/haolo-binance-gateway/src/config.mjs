import fs from "node:fs";

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function booleanValue(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function csv(value, fallback = []) {
  const items = String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : [...fallback];
}

function gatewayRole(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  if (!["all", "public", "private"].includes(normalized)) {
    throw new Error("HAOLO_GATEWAY_ROLE must be all, public or private");
  }
  return normalized;
}

function httpsOrigin(value, field) {
  let parsed;
  try { parsed = new URL(String(value || "").trim()); } catch { throw new Error(`${field} must be an HTTPS origin`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${field} must be an HTTPS origin`);
  }
  return parsed.origin;
}

function absolutePath(value, fallback, field) {
  const normalized = String(value || fallback).trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//") || /[?#]/.test(normalized)) {
    throw new Error(`${field} must be an absolute URL path`);
  }
  return normalized;
}

function privateEgressShards(value, { production, privatePort }) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (production) throw new Error("HAOLO_PRIVATE_EGRESS_SHARDS_JSON is required in production");
    return [Object.freeze({
      id: "local",
      proxyUrl: `https://localhost:${privatePort}`,
      spotWeightLimitPerMinute: 6_000,
      futuresWeightLimitPerMinute: 2_400,
      enabled: true,
    })];
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("HAOLO_PRIVATE_EGRESS_SHARDS_JSON must be valid JSON"); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 128) {
    throw new Error("HAOLO_PRIVATE_EGRESS_SHARDS_JSON must contain 1 to 128 shards");
  }
  const ids = new Set();
  const shards = parsed.map((entry, index) => {
    const id = String(entry?.id || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id) || ids.has(id)) {
      throw new Error(`private egress shard ${index} has an invalid or duplicate id`);
    }
    ids.add(id);
    return Object.freeze({
      id,
      proxyUrl: httpsOrigin(entry?.proxyUrl, `private egress shard ${id} proxyUrl`),
      spotWeightLimitPerMinute: positiveInteger(entry?.spotWeightLimitPerMinute, 6_000, { min: 100, max: 1_000_000 }),
      futuresWeightLimitPerMinute: positiveInteger(entry?.futuresWeightLimitPerMinute, 2_400, { min: 100, max: 1_000_000 }),
      enabled: entry?.enabled !== false,
    });
  });
  if (!shards.some((shard) => shard.enabled)) throw new Error("at least one private egress shard must be enabled");
  return shards;
}

function optionalReadableFile(value, field) {
  const pathname = String(value || "").trim();
  if (!pathname) return "";
  if (!fs.existsSync(pathname) || !fs.statSync(pathname).isFile()) {
    throw new Error(`${field} does not reference a readable file`);
  }
  return pathname;
}

export function loadGatewayConfig(env = process.env) {
  const production = String(env.NODE_ENV || "development").toLowerCase() === "production";
  const role = gatewayRole(env.HAOLO_GATEWAY_ROLE);
  const jwtSecret = String(env.HAOLO_GATEWAY_JWT_SECRET || env.JWT_SECRET || "").trim();
  const privateShardHashSecret = String(env.HAOLO_PRIVATE_SHARD_HASH_SECRET || (production ? "" : jwtSecret)).trim();
  const metricsToken = String(env.HAOLO_GATEWAY_METRICS_TOKEN || "").trim();
  const allowAnonymousPublic = booleanValue(env.HAOLO_GATEWAY_ALLOW_ANONYMOUS_PUBLIC, !production);
  const allowInsecurePrivateProxy = booleanValue(env.HAOLO_PRIVATE_PROXY_ALLOW_INSECURE, !production);
  const privateTlsCertPath = optionalReadableFile(env.HAOLO_PRIVATE_PROXY_TLS_CERT, "HAOLO_PRIVATE_PROXY_TLS_CERT");
  const privateTlsKeyPath = optionalReadableFile(env.HAOLO_PRIVATE_PROXY_TLS_KEY, "HAOLO_PRIVATE_PROXY_TLS_KEY");
  const privatePort = positiveInteger(env.HAOLO_PRIVATE_PROXY_PORT, 8788, { max: 65535 });
  const redisUrl = String(env.HAOLO_MARKET_REDIS_URL || "").trim();
  const egressShards = privateEgressShards(env.HAOLO_PRIVATE_EGRESS_SHARDS_JSON, { production, privatePort });
  const privateEgressShardId = String(env.HAOLO_PRIVATE_EGRESS_SHARD_ID || (production ? "" : egressShards[0].id)).trim().toLowerCase();
  const privateTotalSafetyPercent = positiveInteger(env.HAOLO_PRIVATE_TOTAL_SAFETY_PERCENT, 60, { min: 10, max: 90 });
  const privateBackgroundSafetyPercent = positiveInteger(env.HAOLO_PRIVATE_BACKGROUND_SAFETY_PERCENT, 35, { min: 1, max: 80 });
  const authApiOriginValue = String(env.HAOLO_AUTH_API_ORIGIN || (production && role !== "private" ? "https://haolo.com" : "")).trim();
  const authApiOrigin = authApiOriginValue ? httpsOrigin(authApiOriginValue, "HAOLO_AUTH_API_ORIGIN") : "";

  if (!allowAnonymousPublic && !jwtSecret) {
    throw new Error("HAOLO_GATEWAY_JWT_SECRET is required when public gateway authentication is enabled");
  }
  if (!jwtSecret) {
    throw new Error("HAOLO_GATEWAY_JWT_SECRET is required for the private account proxy");
  }
  if (production && jwtSecret.length < 24) {
    throw new Error("HAOLO_GATEWAY_JWT_SECRET must contain at least 24 characters in production");
  }
  if (production && metricsToken.length < 24) {
    throw new Error("HAOLO_GATEWAY_METRICS_TOKEN must contain at least 24 characters in production");
  }
  if (production && role !== "private" && privateShardHashSecret.length < 24) {
    throw new Error("HAOLO_PRIVATE_SHARD_HASH_SECRET must contain at least 24 characters in production");
  }
  if (role !== "public" && Boolean(privateTlsCertPath) !== Boolean(privateTlsKeyPath)) {
    throw new Error("HAOLO_PRIVATE_PROXY_TLS_CERT and HAOLO_PRIVATE_PROXY_TLS_KEY must be configured together");
  }
  if (role !== "public" && !privateTlsCertPath && !allowInsecurePrivateProxy) {
    throw new Error("private proxy requires TLS or HAOLO_PRIVATE_PROXY_ALLOW_INSECURE=true behind a trusted TLS load balancer");
  }
  if (production && !redisUrl) {
    throw new Error("HAOLO_MARKET_REDIS_URL is required for production private egress coordination");
  }
  if (role !== "public" && !egressShards.some((shard) => shard.id === privateEgressShardId && shard.enabled)) {
    throw new Error("HAOLO_PRIVATE_EGRESS_SHARD_ID must identify an enabled shard");
  }
  if (privateBackgroundSafetyPercent >= privateTotalSafetyPercent) {
    throw new Error("HAOLO_PRIVATE_BACKGROUND_SAFETY_PERCENT must be lower than HAOLO_PRIVATE_TOTAL_SAFETY_PERCENT");
  }

  return Object.freeze({
    production,
    gatewayRole: role,
    publicHost: String(env.HAOLO_MARKET_GATEWAY_HOST || "0.0.0.0"),
    publicPort: positiveInteger(env.HAOLO_MARKET_GATEWAY_PORT, 8787, { max: 65535 }),
    privateHost: String(env.HAOLO_PRIVATE_PROXY_HOST || "0.0.0.0"),
    privatePort,
    jwtSecret,
    privateShardHashSecret,
    metricsToken,
    jwtIssuer: String(env.HAOLO_GATEWAY_JWT_ISSUER || "").trim(),
    jwtAudience: String(env.HAOLO_GATEWAY_JWT_AUDIENCE || "").trim(),
    authApiOrigin,
    authProfilePath: absolutePath(env.HAOLO_AUTH_PROFILE_PATH, "/api/auth/me", "HAOLO_AUTH_PROFILE_PATH"),
    authRequestTimeoutMs: positiveInteger(env.HAOLO_AUTH_REQUEST_TIMEOUT_MS, 5_000, { min: 1_000, max: 30_000 }),
    authCacheTtlMs: positiveInteger(env.HAOLO_AUTH_CACHE_TTL_MS, 15_000, { min: 1_000, max: 60_000 }),
    allowAnonymousPublic,
    trustProxy: booleanValue(env.HAOLO_GATEWAY_TRUST_PROXY, false),
    redisUrl,
    requestTimeoutMs: positiveInteger(env.HAOLO_BINANCE_REQUEST_TIMEOUT_MS, 10_000, { min: 1_000, max: 60_000 }),
    downstreamRequestsPerMinute: positiveInteger(env.HAOLO_MARKET_REQUESTS_PER_MINUTE, 300, { min: 10, max: 100_000 }),
    maxSubscriptionsPerClient: positiveInteger(env.HAOLO_MARKET_MAX_SUBSCRIPTIONS_PER_CLIENT, 50, { min: 1, max: 1_024 }),
    maxWebsocketClientsPerUser: positiveInteger(env.HAOLO_MARKET_MAX_WS_CLIENTS_PER_USER, 8, { min: 1, max: 1_000 }),
    maxWebsocketClientsTotal: positiveInteger(env.HAOLO_MARKET_MAX_WS_CLIENTS_TOTAL, 10_000, { min: 10, max: 100_000 }),
    maxStreamsPerUpstreamSocket: positiveInteger(env.HAOLO_MARKET_MAX_STREAMS_PER_UPSTREAM, 300, { min: 1, max: 1_024 }),
    upstreamRotationMs: positiveInteger(env.HAOLO_MARKET_UPSTREAM_ROTATION_MS, 23 * 60 * 60 * 1_000 + 30 * 60 * 1_000, { min: 60_000 }),
    privateTlsCertPath,
    privateTlsKeyPath,
    privateProxyMaxConnectionsPerUser: positiveInteger(env.HAOLO_PRIVATE_PROXY_MAX_CONNECTIONS_PER_USER, 6, { min: 1, max: 100 }),
    privateProxyConnectsPerMinute: positiveInteger(env.HAOLO_PRIVATE_PROXY_CONNECTS_PER_MINUTE, 60, { min: 1, max: 10_000 }),
    privateProxyIdleTimeoutMs: positiveInteger(env.HAOLO_PRIVATE_PROXY_IDLE_TIMEOUT_MS, 180_000, { min: 30_000, max: 3_600_000 }),
    privateProxyMaxTunnelMs: positiveInteger(env.HAOLO_PRIVATE_PROXY_MAX_TUNNEL_MS, 30_000, { min: 5_000, max: 120_000 }),
    allowLegacyPrivateProxyJwt: booleanValue(env.HAOLO_PRIVATE_PROXY_ALLOW_LEGACY_JWT, !production),
    privateEgressShardId,
    privateEgressShards: Object.freeze(egressShards),
    privatePermitTtlMs: positiveInteger(env.HAOLO_PRIVATE_PERMIT_TTL_MS, 15_000, { min: 5_000, max: 60_000 }),
    privateTotalSafetyPercent,
    privateBackgroundSafetyPercent,
    privateUserSpotWeightPerMinute: positiveInteger(env.HAOLO_PRIVATE_USER_SPOT_WEIGHT_PER_MINUTE, 120, { min: 10, max: 100_000 }),
    privateUserFuturesWeightPerMinute: positiveInteger(env.HAOLO_PRIVATE_USER_FUTURES_WEIGHT_PER_MINUTE, 240, { min: 10, max: 100_000 }),
    privateAllowedHosts: csv(env.HAOLO_PRIVATE_PROXY_ALLOWED_HOSTS, [
      "api.binance.com",
      "fapi.binance.com",
    ]),
    spotRestBaseUrl: String(env.HAOLO_BINANCE_SPOT_REST_BASE_URL || "https://data-api.binance.vision").replace(/\/+$/, ""),
    futuresRestBaseUrl: String(env.HAOLO_BINANCE_FUTURES_REST_BASE_URL || "https://fapi.binance.com").replace(/\/+$/, ""),
    spotWebSocketUrl: String(env.HAOLO_BINANCE_SPOT_WS_URL || "wss://data-stream.binance.vision:443/stream"),
    futuresWebSocketUrl: String(env.HAOLO_BINANCE_FUTURES_WS_URL || "wss://fstream.binance.com/stream"),
  });
}
