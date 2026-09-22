import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { GatewayAuthError, requireHttpIdentity, verifyHaoloAccessJwt, bearerToken, metricsAuthorized } from "./auth.mjs";
import { MarketGatewayError } from "./binance-rest.mjs";
import { FixedWindowRateLimiter } from "./rate-limit.mjs";
import { validateStreamName } from "./stream-pool.mjs";
import { DrainState, closeHttp } from "./drain.mjs";
import { createMarketFrameEncoder } from "./market-frame.mjs";
import { compressionCohort, compressionOptions } from "./ws-compression.mjs";

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

function sendMetrics(response, metrics, streamMetrics, privateEgressMetrics = {}) {
  const values = {
    ...metrics,
    ...Object.fromEntries(Object.entries(streamMetrics).map(([key, value]) => [`stream_${key}`, value])),
    ...Object.fromEntries(Object.entries(privateEgressMetrics).map(([key, value]) => [`private_egress_${key}`, value])),
  };
  const payload = `${Object.entries(values)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => `haolo_market_gateway_${key} ${Number(value)}`)
    .join("\n")}\n`;
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

async function websocketIdentity(request, config, cache, accessTokenVerifier = null) {
  const url = new URL(request.url, "http://gateway.local");
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  if (ticket) {
    const value = await cache.take(`ticket:${ticket}`);
    if (!value?.userId) throw new GatewayAuthError("invalid or expired market ticket");
    return value;
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

export function createPublicGatewayServer({ config, restGateway, streamPool, privateEgressCoordinator = null, accessTokenVerifier = null } = {}) {
  const controlLimiter = new FixedWindowRateLimiter({ limit: config.downstreamRequestsPerMinute });
  const requestBurstLimiter = new FixedWindowRateLimiter({
    limit: config.downstreamBurstRequestsPerMinute || Math.max(1_200, config.downstreamRequestsPerMinute * 4),
  });
  const upstreamBudgetStates = new Map();
  const encodeMarketFrame = createMarketFrameEncoder();
  const websocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: compressionOptions(config), maxPayload: 64 * 1024 });
  const metrics = {
    httpRequests: 0,
    httpErrors: 0,
    websocketClients: 0,
    websocketCompressedClients: 0,
    websocketMarketFrames: 0,
    websocketMarketPayloadBytes: 0,
    websocketRejected: 0,
    websocketBackpressureDisconnects: 0,
    websocketCoalescedFrames: 0,
    restCacheHits: 0,
    restCacheMisses: 0,
    restCacheStale: 0,
    restNotModified: 0,
    restPayloadBytes: 0,
    upstreamAdmissions: 0,
    downstreamRateLimited: 0,
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
      sendMetrics(response, metrics, streamPool.stats(), privateEgressCoordinator?.metrics);
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
        const identity = await requireHttpIdentity(request, config, accessTokenVerifier);
        const rate = controlLimiter.consume(`ticket:${identity.userId}:${clientAddress(request, config)}`);
        if (!rate.allowed) {
          throw new MarketGatewayError("ticket rate limit exceeded", { statusCode: 429, code: "RATE_LIMITED", retryAfterMs: rate.resetAt - Date.now() });
        }
        const ticket = crypto.randomBytes(32).toString("base64url");
        const expiresInMs = 30_000;
        await restGateway.cache.set(`ticket:${ticket}`, { userId: identity.userId }, expiresInMs, expiresInMs);
        sendJson(response, 201, { ticket, expiresInMs });
        return;
      }
      if (request.method !== "GET") throw new MarketGatewayError("method not allowed", { statusCode: 405, code: "METHOD_NOT_ALLOWED" });
      const identity = await requireHttpIdentity(request, config, accessTokenVerifier);
      const address = clientAddress(request, config);
      const requestKey = `${identity.userId}:${address}`;
      const burstRate = requestBurstLimiter.consume(requestKey);
      if (!burstRate.allowed) {
        metrics.downstreamRateLimited += 1;
        throw new MarketGatewayError("request rate limit exceeded", { statusCode: 429, code: "RATE_LIMITED", retryAfterMs: burstRate.resetAt - Date.now() });
      }
      let upstreamBudget = upstreamBudgetStates.get(requestKey) || null;
      if (upstreamBudget?.resetAt <= Date.now()) {
        upstreamBudgetStates.delete(requestKey);
        upstreamBudget = null;
      }
      const result = await restGateway.get(request.url, {
        async beforeUpstream(route) {
          const now = Date.now();
          const totalLimit = route.marketType === "futures"
            ? config.publicFuturesUpstreamWeightPerMinute || 1_440
            : config.publicSpotUpstreamWeightPerMinute || 3_600;
          const budget = await restGateway.cache.consumeWeightBudget({
            shardId: "public-egress",
            marketType: route.marketType,
            windowId: Math.floor(now / 60_000),
            weight: route.weight,
            totalLimit,
            backgroundLimit: totalLimit,
            background: false,
            userKey: crypto.createHash("sha256").update(requestKey).digest("hex").slice(0, 32),
            userLimit: config.downstreamRequestsPerMinute,
            ttlMs: 60_000 - (now % 60_000) + 5_000,
          });
          upstreamBudget = Object.freeze({
            marketType: route.marketType,
            remaining: Math.max(0, config.downstreamRequestsPerMinute - budget.usedByUser),
            resetAt: now + budget.retryAfterMs,
          });
          upstreamBudgetStates.delete(requestKey);
          upstreamBudgetStates.set(requestKey, upstreamBudget);
          while (upstreamBudgetStates.size > 20_000) {
            upstreamBudgetStates.delete(upstreamBudgetStates.keys().next().value);
          }
          if (!budget.allowed) {
            metrics.downstreamRateLimited += 1;
            throw new MarketGatewayError(
              budget.rejectedBy === "user"
                ? "upstream request-weight budget exceeded"
                : "shared upstream request-weight budget exceeded",
              {
                statusCode: 429,
                code: "RATE_LIMITED",
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
    } catch (error) {
      metrics.httpErrors += 1;
      const statusCode = Number(error?.statusCode || 500);
      const retryAfterSeconds = Math.ceil(Number(error?.retryAfterMs || 0) / 1_000);
      const errorCode = String(error?.code || "INTERNAL_ERROR");
      const rateLimitSource = errorCode.startsWith("UPSTREAM_")
        ? "gateway-upstream"
        : errorCode === "RATE_LIMITED"
          ? "gateway-downstream"
          : "";
      sendJson(response, statusCode, {
        error: errorCode,
        message: statusCode >= 500 ? "market gateway unavailable" : String(error?.message || "request rejected"),
        retryAfterMs: Number(error?.retryAfterMs || 0),
      }, {
        ...(retryAfterSeconds > 0 ? { "retry-after": String(retryAfterSeconds) } : {}),
        ...(rateLimitSource ? { "x-haolo-rate-limit-source": rateLimitSource } : {}),
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
    try {
      const identity = await websocketIdentity(request, config, restGateway.cache, accessTokenVerifier);
      const rate = controlLimiter.consume(`ws:${identity.userId}:${clientAddress(request, config)}`);
      if (!rate.allowed) throw new GatewayAuthError("connection rate limit exceeded", 429);
      if (metrics.websocketClients >= config.maxWebsocketClientsTotal) {
        throw new GatewayAuthError("gateway connection capacity exceeded", 503);
      }
      if (Number(websocketClientsByUser.get(identity.userId) || 0) >= config.maxWebsocketClientsPerUser) {
        throw new GatewayAuthError("user connection limit exceeded", 429);
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
      socket.write(`HTTP/1.1 ${statusCode} Rejected\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    }
  }));

  websocketServer.on("connection", (websocket, _request, context) => {
    metrics.websocketClients += 1;
    const compressed = websocket.extensions.includes("permessage-deflate");
    if (compressed) metrics.websocketCompressedClients += 1;
    const disposers = new Map();
    const { route } = context;
    let released = false;
    let backpressureTimer = null;
    const pendingMarketFrames = new Map();
    const sendFrame = (frame) => {
      websocket.send(frame.text, { binary: false, compress: frame.bytes >= (config.wsCompressionThreshold || 1024) });
      metrics.websocketMarketFrames += 1;
      // Application bytes before compression, NOT wire/billing bytes.
      metrics.websocketMarketPayloadBytes += frame.bytes;
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
      clearBackpressure();
      metrics.websocketClients = Math.max(0, metrics.websocketClients - 1);
      if (compressed) metrics.websocketCompressedClients = Math.max(0, metrics.websocketCompressedClients - 1);
      const remaining = Math.max(0, Number(websocketClientsByUser.get(context.identity.userId) || 1) - 1);
      if (remaining) websocketClientsByUser.set(context.identity.userId, remaining);
      else websocketClientsByUser.delete(context.identity.userId);
      for (const dispose of disposers.values()) dispose();
      disposers.clear();
    };
    const subscribe = (streamValue) => {
      const stream = validateStreamName(streamValue);
      if (disposers.has(stream)) return;
      if (disposers.size >= config.maxSubscriptionsPerClient) throw new TypeError("subscription limit exceeded");
      const dispose = streamPool.subscribe(route.marketType, stream, (event) => {
        if (websocket.readyState !== 1) return;
        sendMarketEvent(event.stream, encodeMarketFrame(event, route.mode === "stream"));
      });
      disposers.set(stream, dispose);
    };
    const unsubscribe = (streamValue) => {
      const stream = validateStreamName(streamValue);
      disposers.get(stream)?.();
      disposers.delete(stream);
      pendingMarketFrames.delete(stream);
    };
    try {
      for (const stream of route.initialStreams) subscribe(stream);
    } catch (error) {
      release();
      websocket.close(1008, String(error?.message || "invalid subscription").slice(0, 120));
      return;
    }
    websocket.on("message", (payload) => {
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
