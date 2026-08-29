import crypto from "node:crypto";

export function createJwt(secret, payload = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1_000) + 300, ...payload })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

export function baseConfig(overrides = {}) {
  return {
    production: false,
    gatewayRole: "all",
    jwtSecret: "test-secret-at-least-long-enough",
    privateShardHashSecret: "test-shard-hash-secret-long-enough",
    metricsToken: "test-metrics-token-at-least-long-enough",
    jwtIssuer: "",
    jwtAudience: "",
    allowAnonymousPublic: false,
    trustProxy: false,
    requestTimeoutMs: 1_000,
    downstreamRequestsPerMinute: 10,
    maxSubscriptionsPerClient: 5,
    maxWebsocketClientsPerUser: 2,
    maxWebsocketClientsTotal: 100,
    maxStreamsPerUpstreamSocket: 10,
    upstreamRotationMs: 60_000,
    publicHost: "127.0.0.1",
    publicPort: 0,
    privateHost: "127.0.0.1",
    privatePort: 0,
    privateTlsCertPath: "",
    privateTlsKeyPath: "",
    privateProxyMaxConnectionsPerUser: 2,
    privateProxyConnectsPerMinute: 5,
    privateProxyIdleTimeoutMs: 30_000,
    privateProxyMaxTunnelMs: 30_000,
    allowLegacyPrivateProxyJwt: false,
    privateEgressShardId: "sg-a",
    privateEgressShards: [{
      id: "sg-a",
      proxyUrl: "https://sg-a.private.haolo.example",
      spotWeightLimitPerMinute: 6_000,
      futuresWeightLimitPerMinute: 2_400,
      enabled: true,
    }],
    privatePermitTtlMs: 15_000,
    privateTotalSafetyPercent: 60,
    privateBackgroundSafetyPercent: 35,
    privateUserSpotWeightPerMinute: 120,
    privateUserFuturesWeightPerMinute: 240,
    privateAllowedHosts: ["fapi.binance.com", "api.binance.com"],
    spotRestBaseUrl: "https://data-api.binance.vision",
    futuresRestBaseUrl: "https://fapi.binance.com",
    spotWebSocketUrl: "wss://data-stream.binance.vision/stream",
    futuresWebSocketUrl: "wss://fstream.binance.com/stream",
    redisUrl: "",
    ...overrides,
  };
}
