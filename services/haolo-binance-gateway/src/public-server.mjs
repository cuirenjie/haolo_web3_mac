import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { GatewayAuthError, requireHttpIdentity, verifyHaoloAccessJwt, bearerToken, metricsAuthorized } from "./auth.mjs";
import { MarketGatewayError, PUBLIC_FUTURES_PATHS, PUBLIC_SPOT_PATHS } from "./binance-rest.mjs";
import { FixedWindowRateLimiter } from "./rate-limit.mjs";
import { validateStreamName } from "./stream-pool.mjs";
import { DrainState, closeHttp } from "./drain.mjs";
import { createMarketFrameEncoder } from "./market-frame.mjs";
import { compressionCohort, compressionOptions } from "./ws-compression.mjs";
import { marketTier, requireMarketRoute } from "./market-routing.mjs";
import { TrafficMetrics, streamFamily } from "./traffic-metrics.mjs";
import { MARKET_WIRE_CODEC } from "./market-wire-codec.mjs";
import { MarketTicketStore } from "./market-tickets.mjs";

// A browser that cannot consume the feed must not turn the gateway into an
// unbounded memory queue. Quote-like streams are latest-value state, so under
// pressure we coalesce them; aggTrade remains lossless until the hard limit,
// after which the client is asked to reconnect and backfill from REST.
const WS_SOFT_BUFFER_BYTES = 512 * 1024;
const WS_HARD_BUFFER_BYTES = 2 * 1024 * 1024;
const WS_BACKPRESSURE_FLUSH_MS = 25;

function coalescableMarketStream(stream) {
  return /@(ticker|miniTicker|markPrice(?:@1s)?|kline_)/.test(String(stream || ""));
}

function sendJson(response, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(payload);
  return Buffer.byteLength(payload);
}

function etagMatches(header, etag) {
  if (!header) return false;
  return String(header)
    .split(",")
    .some((candidate) => candidate.trim() === "*" || candidate.trim().replace(/^W\//, "") === etag);
}

function publicRestPath(requestUrl) {
  const pathname = new URL(requestUrl, "http://gateway.local").pathname;
  const versioned = /^\/api\/market\/v1\/binance\/(?:spot|futures)(\/.*)$/.exec(pathname);
  return versioned ? versioned[1] : pathname;
}

function publicRestEtagEnabled(requestUrl) {
  const pathname = publicRestPath(requestUrl);
  // Order-flow endpoints are intentionally excluded: their responses are
  // frequently unique and must retain their existing response semantics.
  return (pathname.startsWith("/api/") || pathname.startsWith("/fapi/") || pathname.startsWith("/futures/"))
    && !pathname.endsWith("/depth")
    && !pathname.endsWith("/aggTrades");
}

function sendPublicRestJson(request, response, statusCode, body, headers = {}) {
  const payload = JSON.stringify(body);
  const etag = `"${crypto.createHash("sha256").update(payload).digest("hex")}"`;
  const responseHeaders = { ...headers, etag };
  if (etagMatches(request.headers["if-none-match"], etag)) {
    response.writeHead(304, {
      ...responseHeaders,
      "content-length": "0",
    });
    response.end();
    return 0;
  }
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...responseHeaders,
  });
  response.end(payload);
  return Buffer.byteLength(payload);
}

function sendMetrics(response, metrics, streamMetrics, privateEgressMetrics = {}, traffic = "") {
  const values = {
    ...metrics,
    ...Object.fromEntries(Object.entries(streamMetrics).map(([key, value]) => [`stream_${key}`, value])),
    ...Object.fromEntries(Object.entries(privateEgressMetrics).map(([key, value]) => [`private_egress_${key}`, value])),
  };
  const payload = `${Object.entries(values)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => `haolo_market_gateway_${key} ${Number(value)}`)
    .join("\n")}\n${traffic}\n`;
  response.writeHead(200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function clientAddress(request, config) {
  if (config.trustProxy) {
    const realIp = String(request.headers["x-real-ip"] || "").trim();
    if (realIp) return realIp.slice(0, 128);
    const forwarded = String(request.headers["x-forwarded-for"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (forwarded.length) return forwarded.at(-1).slice(0, 128);
  }
  return String(request.socket.remoteAddress || "unknown").slice(0, 128);
}

async function websocketIdentity(request, config, tickets, accessTokenVerifier = null) {
  const url = new URL(request.url, "http://gateway.local");
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  if (ticket) {
    const result = await tickets.consume(ticket);
    if (result.status !== "ok") {
      throw Object.assign(new GatewayAuthError("market ticket unavailable; obtain a new ticket"), {
        code: `WS_TICKET_${result.status.toUpperCase()}`, ticketAudit: result.audit,
      });
    }
    return { ...result.identity, ticketAudit: result.audit };
  }
  const token = bearerToken(request.headers);
  if (!token && config.allowAnonymousPublic) return { userId: `anonymous:${clientAddress(request, config)}` };
  if (!token) throw new GatewayAuthError("authentication required");
  return accessTokenVerifier
    ? accessTokenVerifier.verify(token)
    : verifyHaoloAccessJwt(token, config);
}

function websocketRoute(requestUrl) {
  const url = new URL(requestUrl, "http://gateway.local");
  const match = /^\/(ws|stream)\/(spot|futures)$/.exec(url.pathname);
  if (!match) return null;
  return Object.freeze({ mode: match[1], marketType: match[2], initialStreams: String(url.searchParams.get("streams") || "").split("/").filter(Boolean) });
}

async function readJsonBody(request, maxBytes = 4 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new MarketGatewayError("request body is too large", { statusCode: 413, code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new MarketGatewayError("request body must be valid JSON", { statusCode: 400, code: "INVALID_JSON" });
  }
}

export function createPublicGatewayServer({ config, restGateway, streamPool, privateEgressCoordinator = null, accessTokenVerifier = null,
  onDiagnostic = entry => console.warn(JSON.stringify(entry)), websocketHeartbeatMs = 30_000 } = {}) {
  const diagnosticSalt = crypto.randomBytes(32);
  const userReference = identity => identity?.userId
    ? crypto.createHmac("sha256", diagnosticSalt).update(identity.userId).digest("hex").slice(0, 16) : undefined;
  const diagnostic = entry => { try { onDiagnostic(entry); } catch {} };
  const tickets = new MarketTicketStore(restGateway.cache);
  const ticketDiagnostic = audit => audit ? {
    ticketRef: audit.ticketRef, clientProtocol: audit.clientProtocol,
    ...(audit.issuedAt ? { ticketAgeMs: Math.max(0, Date.now() - audit.issuedAt) } : {}),
  } : {};
  const controlLimiter = new FixedWindowRateLimiter({ limit: config.downstreamRequestsPerMinute });
  const requestBurstLimiter = new FixedWindowRateLimiter({
    limit: config.downstreamBurstRequestsPerMinute || Math.max(1_200, config.downstreamRequestsPerMinute * 4),
  });
  const upstreamBudgetStates = new Map();
  const encodeMarketFrame = createMarketFrameEncoder();
  const trafficMetrics = new TrafficMetrics(config.marketNodeTier);
  const websocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: compressionOptions(config), maxPayload: 64 * 1024 });
  const metrics = {
    httpRequests: 0,
    httpErrors: 0,
    websocketClients: 0,
    websocketCompressedClients: 0,
    websocketMarketFrames: 0,
    websocketMarketPayloadBytes: 0,
    websocketRejected: 0,
    websocketTicketExpired: 0,
    websocketTicketConsumed: 0,
    websocketTicketUnknown: 0,
    websocketTicketInvalid: 0,
    websocketTicketUnavailable: 0,
    ticketStoreUnavailable: 0,
    websocketUserConnectionLimited: 0,
    websocketConnectionRateLimited: 0,
    websocketTotalConnectionLimited: 0,
    websocketHeartbeatTimeouts: 0,
    websocketCommandRejected: 0,
    websocketBackpressureDisconnects: 0,
    websocketCoalescedFrames: 0,
    restCacheHits: 0,
    restCacheMisses: 0,
    restCacheStale: 0,
    restNotModified: 0,
    restPayloadBytes: 0,
    upstreamAdmissions: 0,
    upstreamRateLimited: 0,
    upstreamCooldownHits: 0,
    downstreamRateLimited: 0,
    ingressRateLimited: 0,
    userWeightRateLimited: 0,
    egressWeightRateLimited: 0,
    authenticationUnavailable: 0,
    authenticationTimeouts: 0,
    marketCoordinationUnavailable: 0,
  };
  const websocketClientsByUser = new Map();
  const drain = new DrainState();
  let closing;

  const server = http.createServer(drain.http(async (request, response) => {
    if (request.url === "/metrics") {
      if (!metricsAuthorized(request.headers, config.metricsToken)) {
        sendJson(response, 401, { error: "AUTHENTICATION_REQUIRED" });
        return;
      }
      sendMetrics(response, metrics, streamPool.stats(), privateEgressCoordinator?.metrics, trafficMetrics.prometheus());
      return;
    }
    if (request.url === "/health" || request.url === "/ready") {
      const ready = request.url !== "/ready" || (
        (restGateway.cache.ready?.() ?? true)
        && (privateEgressCoordinator?.ready?.() ?? true)
      );
      sendJson(response, ready ? 200 : 503, {
        status: ready ? "ok" : "not_ready",
        service: "haolo-binance-market-gateway",
        cache: restGateway.cache.redis ? "redis" : "memory",
        privateEgress: privateEgressCoordinator ? (privateEgressCoordinator.ready() ? "ready" : "not_ready") : "disabled",
      });
      return;
    }
    metrics.httpRequests += 1;
    const requestStartedAt = Date.now();
    try {
      if (request.method === "POST" && request.url === "/api/private/v1/permits") {
        if (!privateEgressCoordinator) throw new MarketGatewayError("private egress control plane is disabled", { statusCode: 503, code: "PRIVATE_EGRESS_DISABLED" });
        const identity = await requireHttpIdentity(request, config, accessTokenVerifier);
        const rate = controlLimiter.consume(`private-permit:${identity.userId}:${clientAddress(request, config)}`);
        if (!rate.allowed) {
          throw new MarketGatewayError("private permit rate limit exceeded", { statusCode: 429, code: "RATE_LIMITED", retryAfterMs: rate.resetAt - Date.now() });
        }
        const permit = await privateEgressCoordinator.issuePermit(identity, await readJsonBody(request));
        sendJson(response, 201, permit);
        return;
      }
      if (request.method === "POST" && request.url === "/api/private/v1/usage") {
        if (!privateEgressCoordinator) throw new MarketGatewayError("private egress control plane is disabled", { statusCode: 503, code: "PRIVATE_EGRESS_DISABLED" });
        const identity = await requireHttpIdentity(request, config, accessTokenVerifier);
        const result = await privateEgressCoordinator.reportUsage(identity, await readJsonBody(request));
        sendJson(response, 202, result);
        return;
      }
      if (request.method === "POST" && request.url === "/api/market/v1/tickets") {
        const identity = await requireHttpIdentity(request, config, accessTokenVerifier, { market: true });
        requireMarketRoute(identity, request, config);
        const rate = controlLimiter.consume(`ticket:${identity.userId}:${clientAddress(request, config)}`);
        if (!rate.allowed) {
          throw new MarketGatewayError("ticket rate limit exceeded", { statusCode: 429, code: "RATE_LIMITED", retryAfterMs: rate.resetAt - Date.now() });
        }
        const body = await readJsonBody(request);
        const codec = config.marketCompactEnabled && Array.isArray(body?.codecs) && body.codecs.includes(MARKET_WIRE_CODEC) ? MARKET_WIRE_CODEC : "json";
        const { ticket, expiresInMs, audit } = await tickets.issue({
          userId: identity.userId, marketTier: marketTier(identity), membershipExpiresAt: identity.membershipExpiresAt || null,
          marketRouting: identity.marketRouting || request.headers["x-haolo-market-routing"] === "1", codec,
        }, { clientProtocol: body?.ticketProtocol === 2 ? "2" : "legacy" });
        diagnostic({ event: "market_ticket_issued", ...ticketDiagnostic(audit), userRef: userReference(identity), expiresInMs });
        sendJson(response, 201, { ticket, expiresInMs, codec });
        return;
      }
      if (request.method !== "GET") throw new MarketGatewayError("method not allowed", { statusCode: 405, code: "METHOD_NOT_ALLOWED" });
      const identity = await requireHttpIdentity(request, config, accessTokenVerifier, { market: true });
      requireMarketRoute(identity, request, config);
      const address = clientAddress(request, config);
      const requestKey = `${identity.userId}:${address}`;
      const burstRate = requestBurstLimiter.consume(requestKey);
      if (!burstRate.allowed) {
        metrics.downstreamRateLimited += 1;
        metrics.ingressRateLimited += 1;
        throw new MarketGatewayError("request rate limit exceeded", { statusCode: 429, code: "RATE_LIMITED", limitScope: "ingress", retryAfterMs: burstRate.resetAt - Date.now() });
      }
      let upstreamBudget = upstreamBudgetStates.get(requestKey) || null;
      if (upstreamBudget?.resetAt <= Date.now()) {
        upstreamBudgetStates.delete(requestKey);
        upstreamBudget = null;
      }
      const result = await restGateway.get(request.url, {
        freshness: request.headers["x-haolo-market-freshness"] === "live" ? "live" : "default",
        async beforeUpstream(route) {
          const now = Date.now();
          const totalLimit = route.marketType === "futures"
            ? config.publicFuturesUpstreamWeightPerMinute || 1_440
            : config.publicSpotUpstreamWeightPerMinute || 3_600;
          const budget = await restGateway.cache.consumeWeightBudget({
            shardId: config.publicEgressId || "public-egress",
            marketType: route.marketType,
            windowId: Math.floor(now / 60_000),
            weight: route.weight,
            totalLimit,
            backgroundLimit: totalLimit,
            background: false,
            userKey: crypto.createHash("sha256").update(requestKey).digest("hex").slice(0, 32),
            userLimit: config.publicUserWeightPerMinute || config.downstreamRequestsPerMinute,
            ttlMs: 60_000 - (now % 60_000) + 5_000,
          });
          upstreamBudget = Object.freeze({
            marketType: route.marketType,
            remaining: Math.max(0, (config.publicUserWeightPerMinute || config.downstreamRequestsPerMinute) - budget.usedByUser),
            resetAt: now + budget.retryAfterMs,
          });
          upstreamBudgetStates.delete(requestKey);
          upstreamBudgetStates.set(requestKey, upstreamBudget);
          while (upstreamBudgetStates.size > 20_000) {
            upstreamBudgetStates.delete(upstreamBudgetStates.keys().next().value);
          }
          if (!budget.allowed) {
            metrics.downstreamRateLimited += 1;
            if (budget.rejectedBy === "user") metrics.userWeightRateLimited += 1;
            else metrics.egressWeightRateLimited += 1;
            throw new MarketGatewayError(
              budget.rejectedBy === "user"
                ? "upstream request-weight budget exceeded"
                : "shared upstream request-weight budget exceeded",
              {
                statusCode: 429,
                code: "RATE_LIMITED",
                limitScope: budget.rejectedBy === "user" ? "user-weight" : "egress-weight",
                retryAfterMs: budget.retryAfterMs,
              },
            );
          }
          metrics.upstreamAdmissions += 1;
        },
      });
      if (result.cacheStatus === "HIT") metrics.restCacheHits += 1;
      else if (result.cacheStatus === "STALE") metrics.restCacheStale += 1;
      else metrics.restCacheMisses += 1;
      if (result.headers?.["x-haolo-rate-limit-source"] === "gateway-upstream") {
        metrics.upstreamCooldownHits += 1;
      }
      // Never turn an error representation (429/5xx) into a cacheable 304;
      // conditional semantics apply only to successful market JSON.
      const etagEligible = result.statusCode === 200 && publicRestEtagEnabled(request.url);
      const responseBytes = etagEligible
        ? sendPublicRestJson(request, response, result.statusCode, result.value, {
          "cache-control": "private, max-age=0",
          "x-haolo-cache": result.cacheStatus,
          ...(upstreamBudget && upstreamBudget.marketType === result.marketType
            ? { "x-ratelimit-remaining": String(upstreamBudget.remaining) }
            : {}),
          "x-haolo-request-limit-remaining": String(burstRate.remaining),
          ...result.headers,
        })
        : sendJson(response, result.statusCode, result.value, {
        "cache-control": "private, max-age=0",
        "x-haolo-cache": result.cacheStatus,
        ...(upstreamBudget && upstreamBudget.marketType === result.marketType
          ? { "x-ratelimit-remaining": String(upstreamBudget.remaining) }
          : {}),
        "x-haolo-request-limit-remaining": String(burstRate.remaining),
        ...result.headers,
      });
      if (responseBytes === 0 && etagEligible) metrics.restNotModified += 1;
      metrics.restPayloadBytes += responseBytes;
      trafficMetrics.record({ tier: marketTier(identity), transport: "rest", market: result.marketType,
        legacy: request.headers["x-haolo-market-routing"] !== "1", bytes: responseBytes });
    } catch (error) {
      metrics.httpErrors += 1;
      const statusCode = Number(error?.statusCode || 500);
      const retryAfterSeconds = Math.ceil(Number(error?.retryAfterMs || 0) / 1_000);
      const errorCode = String(error?.code || "INTERNAL_ERROR");
      const requestId = statusCode >= 500 ? crypto.randomUUID() : "";
      const authUnavailable = errorCode === "AUTHENTICATION_UNAVAILABLE";
      if (errorCode === "WS_TICKET_STORE_UNAVAILABLE") metrics.ticketStoreUnavailable += 1;
      if (authUnavailable) {
        metrics.authenticationUnavailable += 1;
        if (error.failureKind === "timeout") metrics.authenticationTimeouts += 1;
      }
      if (["MARKET_COORDINATION_UNAVAILABLE", "MARKET_REFRESH_PENDING"].includes(errorCode)) metrics.marketCoordinationUnavailable += 1;
      if (requestId) {
        // Only known route names and fixed error categories are recorded. Never
        // log queries, bearer tokens, tickets, user IDs, or dependency bodies.
        let route = "other";
        try {
          const candidate = publicRestPath(request.url);
          if (PUBLIC_FUTURES_PATHS.has(candidate) || PUBLIC_SPOT_PATHS.has(candidate)
            || ["/api/private/v1/permits", "/api/private/v1/usage", "/api/market/v1/tickets"].includes(candidate)) route = candidate;
        } catch {}
        const knownCodes = ["AUTHENTICATION_UNAVAILABLE", "MARKET_COORDINATION_UNAVAILABLE", "MARKET_REFRESH_PENDING",
          "UPSTREAM_UNAVAILABLE", "UPSTREAM_INVALID_RESPONSE", "UPSTREAM_REJECTED", "UPSTREAM_RATE_LIMITED", "UPSTREAM_COOLDOWN", "PRIVATE_EGRESS_DISABLED"];
        const failureKind = ["timeout", "network", "upstream-status", "invalid-response", "invalid-profile"].includes(error.failureKind) ? error.failureKind : "unknown";
        try { onDiagnostic({ event: "market_gateway_error", requestId, route, status: statusCode,
          code: knownCodes.includes(errorCode) ? errorCode : "INTERNAL_ERROR", elapsedMs: Date.now() - requestStartedAt,
          ...(authUnavailable ? { dependency: "haolo-auth", failureKind, dependencyStatus: Number(error.dependencyStatus) || 0,
            dependencyElapsedMs: Number(error.dependencyElapsedMs) || 0 } : {}),
        }); } catch {}
      }
      const rateLimitSource = ["UPSTREAM_RATE_LIMITED", "UPSTREAM_COOLDOWN"].includes(errorCode)
        ? "gateway-upstream"
        : errorCode === "RATE_LIMITED"
          ? "gateway-downstream"
          : "";
      if (errorCode === "UPSTREAM_RATE_LIMITED" || errorCode === "UPSTREAM_COOLDOWN") {
        metrics.upstreamRateLimited += 1;
      }
      sendJson(response, statusCode, {
        error: errorCode,
        ...(errorCode === "MARKET_ROUTE_REQUIRED" ? { marketOrigin: error.marketOrigin } : {}),
        message: statusCode >= 500 ? "market gateway unavailable" : String(error?.message || "request rejected"),
        retryAfterMs: Number(error?.retryAfterMs || 0),
      }, {
        ...(requestId ? { "x-haolo-request-id": requestId } : {}),
        ...(authUnavailable ? { "x-haolo-error-source": "haolo-auth" } : {}),
        ...(retryAfterSeconds > 0 ? { "retry-after": String(retryAfterSeconds) } : {}),
        ...(rateLimitSource ? { "x-haolo-rate-limit-source": rateLimitSource } : {}),
        ...(error?.limitScope ? { "x-haolo-rate-limit-scope": error.limitScope } : {}),
        ...(Number(error?.upstreamStatus) > 0 ? { "x-haolo-upstream-status": String(Number(error.upstreamStatus)) } : {}),
      });
    }
  }));

  server.on("upgrade", drain.upgrade(async (request, socket, head) => {
    const route = websocketRoute(request.url);
    if (!route) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    let identity;
    try {
      identity = await websocketIdentity(request, config, tickets, accessTokenVerifier);
      requireMarketRoute(identity, request, config);
      const rate = controlLimiter.consume(`ws:${identity.userId}:${clientAddress(request, config)}`);
      if (!rate.allowed) {
        metrics.websocketConnectionRateLimited += 1;
        throw Object.assign(new GatewayAuthError("connection rate limit exceeded", 429), {
          code: "WS_CONNECTION_RATE_LIMIT", retryAfterMs: rate.resetAt - Date.now(), limit: config.downstreamRequestsPerMinute });
      }
      if (metrics.websocketClients >= config.maxWebsocketClientsTotal) {
        metrics.websocketTotalConnectionLimited += 1;
        throw Object.assign(new GatewayAuthError("gateway connection capacity exceeded", 503), {
          code: "WS_TOTAL_CONNECTION_LIMIT", retryAfterMs: 2_000, limit: config.maxWebsocketClientsTotal });
      }
      if (Number(websocketClientsByUser.get(identity.userId) || 0) >= config.maxWebsocketClientsPerUser) {
        metrics.websocketUserConnectionLimited += 1;
        throw Object.assign(new GatewayAuthError("user connection limit exceeded", 429), {
          code: "WS_USER_CONNECTION_LIMIT", retryAfterMs: 2_000, limit: config.maxWebsocketClientsPerUser });
      }
      // Opt-in cohorts are chosen after authentication. Existing clients which
      // do not offer compression continue to negotiate the original protocol.
      if (!compressionCohort(identity.userId, config.wsCompressionPercent)) {
        delete request.headers["sec-websocket-extensions"];
      }
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketClientsByUser.set(identity.userId, Number(websocketClientsByUser.get(identity.userId) || 0) + 1);
        websocketServer.emit("connection", websocket, request, { route, identity });
      });
    } catch (error) {
      metrics.websocketRejected += 1;
      const statusCode = Number(error?.statusCode || 401);
      const admissionCodes = new Set(["WS_CONNECTION_RATE_LIMIT", "WS_USER_CONNECTION_LIMIT", "WS_TOTAL_CONNECTION_LIMIT"]);
      const ticketCodes = { WS_TICKET_EXPIRED: "websocketTicketExpired", WS_TICKET_CONSUMED: "websocketTicketConsumed",
        WS_TICKET_UNKNOWN: "websocketTicketUnknown", WS_TICKET_INVALID: "websocketTicketInvalid",
        WS_TICKET_UNAVAILABLE: "websocketTicketUnavailable", WS_TICKET_STORE_UNAVAILABLE: "ticketStoreUnavailable" };
      const knownCodes = new Set([...admissionCodes, ...Object.keys(ticketCodes), "AUTHENTICATION_UNAVAILABLE", "AUTHENTICATION_REQUIRED", "MARKET_ROUTE_REQUIRED", "MARKET_ENTITLEMENT_UNAVAILABLE"]);
      const code = knownCodes.has(error?.code) ? error.code : "WS_AUTHENTICATION_REJECTED";
      if (ticketCodes[code]) metrics[ticketCodes[code]] += 1;
      if (code === "AUTHENTICATION_UNAVAILABLE") {
        metrics.authenticationUnavailable += 1;
        if (error.failureKind === "timeout") metrics.authenticationTimeouts += 1;
      }
      const retryAfter = Math.max(1, Math.ceil(Number(error?.retryAfterMs || 1_000) / 1_000));
      diagnostic({ event: "market_ws_rejected", status: statusCode, code, market: route.marketType,
        ...ticketDiagnostic(error?.ticketAudit || identity?.ticketAudit),
        userRef: userReference(identity), userConnections: websocketClientsByUser.get(identity?.userId) || 0,
        connections: metrics.websocketClients, ...(admissionCodes.has(code) ? { limit: error.limit } : {}) });
      // end() flushes the bounded response before closing; never log the URL/ticket.
      socket.end(`HTTP/1.1 ${statusCode} Rejected\r\nConnection: close\r\nContent-Length: 0\r\nX-Haolo-Error-Code: ${code}\r\nRetry-After: ${retryAfter}\r\n\r\n`);
    }
  }));

  websocketServer.on("connection", (websocket, _request, context) => {
    metrics.websocketClients += 1;
    const compressed = websocket.extensions.includes("permessage-deflate");
    if (compressed) metrics.websocketCompressedClients += 1;
    const disposers = new Map();
    const { route } = context;
    const sessionId = crypto.randomUUID();
    const userRef = userReference(context.identity);
    const connectedAt = Date.now();
    diagnostic({ event: "market_ws_connected", sessionId, userRef, market: route.marketType,
      ...ticketDiagnostic(context.identity.ticketAudit),
      userConnections: websocketClientsByUser.get(context.identity.userId), connections: metrics.websocketClients });
    let released = false;
    let sessionExpired = false;
    let alive = true;
    let closeReason = "peer_closed";
    // A lost TCP path can otherwise retain a user's slot indefinitely. Keep
    // healthy streams alive, including during deployment drain.
    const heartbeatTimer = setInterval(() => {
      if (websocket.readyState !== 1) return;
      if (!alive) {
        closeReason = "heartbeat_timeout";
        metrics.websocketHeartbeatTimeouts += 1;
        websocket.terminate();
        return;
      }
      alive = false;
      try { websocket.ping(); } catch { websocket.terminate(); }
    }, Math.max(10, Number(websocketHeartbeatMs) || 30_000));
    heartbeatTimer.unref?.();
    websocket.on("pong", () => { alive = true; });
    // Reconnect obtains a fresh authoritative entitlement and one-use ticket.
    // Enforce the exact paid/trial expiry, with a bounded recheck lease for
    // cancellations or upgrades while a socket is open. Legacy off mode keeps
    // its original lifetime during rollout.
    let leaseTimer = null;
    if (config.marketRoutingMode && config.marketRoutingMode !== "off" &&
        (config.marketRoutingMode === "strict" || context.identity.marketRouting)) {
      const remaining = context.identity.membershipExpiresAt
        ? context.identity.membershipExpiresAt - Date.now() : Infinity;
      leaseTimer = setTimeout(() => {
        closeReason = "market_route_refresh";
        sessionExpired = true;
        clearBackpressure();
        for (const dispose of disposers.values()) dispose();
        disposers.clear();
        websocket.close(1000, "market_route_refresh");
      }, Math.max(1, Math.min(config.marketSessionMaxMs || 900_000, remaining)));
      leaseTimer.unref?.();
    }
    let backpressureTimer = null;
    const pendingMarketFrames = new Map();
    const sendFrame = (frame) => {
      websocket.send(frame.text, { binary: false, compress: frame.bytes >= (config.wsCompressionThreshold || 1024) });
      metrics.websocketMarketFrames += 1;
      // Application bytes before compression, NOT wire/billing bytes.
      metrics.websocketMarketPayloadBytes += frame.bytes;
      trafficMetrics.record({ tier: marketTier(context.identity), transport: "ws", market: route.marketType,
        family: streamFamily(frame.stream), codec: frame.codec, legacy: !context.identity.marketRouting,
        bytes: frame.bytes, jsonBytes: frame.jsonBytes ?? frame.bytes });
    };
    const clearBackpressure = () => {
      if (backpressureTimer !== null) clearTimeout(backpressureTimer);
      backpressureTimer = null;
      pendingMarketFrames.clear();
    };
    const scheduleBackpressureFlush = () => {
      if (backpressureTimer !== null || websocket.readyState !== 1) return;
      backpressureTimer = setTimeout(() => {
        backpressureTimer = null;
        flushBackpressureFrames();
      }, WS_BACKPRESSURE_FLUSH_MS);
      backpressureTimer.unref?.();
    };
    const flushBackpressureFrames = () => {
      if (websocket.readyState !== 1) return;
      if (Number(websocket.bufferedAmount || 0) > WS_SOFT_BUFFER_BYTES) {
        if (pendingMarketFrames.size) scheduleBackpressureFlush();
        return;
      }
      for (const [stream, frame] of pendingMarketFrames) {
        if (Number(websocket.bufferedAmount || 0) > WS_SOFT_BUFFER_BYTES) break;
        try {
          sendFrame(frame);
          pendingMarketFrames.delete(stream);
        } catch {
          break;
        }
      }
      if (pendingMarketFrames.size) scheduleBackpressureFlush();
    };
    const sendMarketEvent = (stream, frame) => {
      if (websocket.readyState !== 1) return;
      const buffered = Number(websocket.bufferedAmount || 0);
      if (buffered <= WS_SOFT_BUFFER_BYTES) {
        if (pendingMarketFrames.has(stream)) {
          pendingMarketFrames.set(stream, frame);
          metrics.websocketCoalescedFrames += 1;
          flushBackpressureFrames();
          return;
        }
        // Flush an older pending quote first, so it cannot follow this newer
        // frame when a slow connection recovers.
        flushBackpressureFrames();
        try { sendFrame(frame); } catch {}
        return;
      }
      if (buffered >= WS_HARD_BUFFER_BYTES) {
        metrics.websocketBackpressureDisconnects += 1;
        try { websocket.close(1013, "slow_client"); } catch { try { websocket.terminate(); } catch {} }
        return;
      }
      if (coalescableMarketStream(stream)) {
        pendingMarketFrames.set(stream, frame);
        metrics.websocketCoalescedFrames += 1;
        scheduleBackpressureFlush();
        return;
      }
      // Keep trade events ordered while there is still bounded headroom. Once
      // the hard limit is reached the branch above closes the slow client.
      try { sendFrame(frame); } catch {}
    };
    const release = () => {
      if (released) return;
      released = true;
      clearInterval(heartbeatTimer);
      clearTimeout(leaseTimer);
      clearBackpressure();
      metrics.websocketClients = Math.max(0, metrics.websocketClients - 1);
      if (compressed) metrics.websocketCompressedClients = Math.max(0, metrics.websocketCompressedClients - 1);
      const remaining = Math.max(0, Number(websocketClientsByUser.get(context.identity.userId) || 1) - 1);
      if (remaining) websocketClientsByUser.set(context.identity.userId, remaining);
      else websocketClientsByUser.delete(context.identity.userId);
      for (const dispose of disposers.values()) dispose();
      disposers.clear();
      diagnostic({ event: "market_ws_closed", sessionId, userRef, market: route.marketType, reason: closeReason,
        durationMs: Date.now() - connectedAt, userConnections: remaining, connections: metrics.websocketClients });
    };
    const subscribe = (streamValue) => {
      if (released || sessionExpired) throw new TypeError("market session expired");
      const stream = validateStreamName(streamValue);
      if (disposers.has(stream)) return;
      if (disposers.size >= config.maxSubscriptionsPerClient) throw new TypeError("subscription limit exceeded");
      const dispose = streamPool.subscribe(route.marketType, stream, (event) => {
        if (websocket.readyState !== 1) return;
        if (released || sessionExpired) return;
        sendMarketEvent(event.stream, encodeMarketFrame(event, route.mode === "stream", context.identity.codec));
      });
      disposers.set(stream, dispose);
    };
    const unsubscribe = (streamValue) => {
      const stream = validateStreamName(streamValue);
      disposers.get(stream)?.();
      disposers.delete(stream);
    };
    try {
      for (const stream of route.initialStreams) subscribe(stream);
    } catch (error) {
      release();
      websocket.close(1008, String(error?.message || "invalid subscription").slice(0, 120));
      return;
    }
    websocket.on("message", (payload) => {
      if (released || sessionExpired) return;
      let command;
      try { command = JSON.parse(String(payload)); } catch {
        websocket.send(JSON.stringify({ code: 3, msg: "Invalid JSON" }));
        return;
      }
      const method = String(command?.method || "").toUpperCase();
      const params = Array.isArray(command?.params) ? command.params : [];
      try {
        if (method === "SUBSCRIBE") for (const stream of params) subscribe(stream);
        else if (method === "UNSUBSCRIBE") for (const stream of params) unsubscribe(stream);
        else if (method === "LIST_SUBSCRIPTIONS") {
          websocket.send(JSON.stringify({ result: [...disposers.keys()], id: command?.id ?? null }));
          return;
        } else throw new TypeError("unsupported command");
        websocket.send(JSON.stringify({ result: null, id: command?.id ?? null }));
      } catch (error) {
        metrics.websocketCommandRejected += 1;
        diagnostic({ event: "market_ws_command_rejected", sessionId, userRef, market: route.marketType,
          subscriptions: disposers.size, limit: config.maxSubscriptionsPerClient });
        websocket.send(JSON.stringify({ code: 2, msg: String(error?.message || "invalid command"), id: command?.id ?? null }));
      }
    });
    websocket.on("error", () => {
      try { websocket.terminate(); } catch {}
    });
    websocket.on("close", release);
  });

  return Object.freeze({
    server,
    websocketServer,
    metrics,
    status: () => ({ phase: drain.phase, operations: drain.operations, websockets: websocketServer.clients.size }),
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.publicPort, config.publicHost, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    async close() {
      if (!closing) {
        drain.begin();
        const httpClosed = closeHttp(server);
        closing = (async () => {
          await drain.idle(); // include authentication for already accepted upgrades
          await new Promise((resolve) => websocketServer.close(resolve));
          await httpClosed;
          drain.phase = "stopped";
        })();
      }
      return closing;
    },
  });
}
