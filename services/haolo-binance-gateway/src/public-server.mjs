import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { GatewayAuthError, requireHttpIdentity, verifyHaoloAccessJwt, bearerToken, metricsAuthorized } from "./auth.mjs";
import { MarketGatewayError } from "./binance-rest.mjs";
import { FixedWindowRateLimiter } from "./rate-limit.mjs";
import { validateStreamName } from "./stream-pool.mjs";
import { DrainState, closeHttp } from "./drain.mjs";

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
  const limiter = new FixedWindowRateLimiter({ limit: config.downstreamRequestsPerMinute });
  const websocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 64 * 1024 });
  const metrics = { httpRequests: 0, httpErrors: 0, websocketClients: 0, websocketRejected: 0 };
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
        const rate = limiter.consume(`private-permit:${identity.userId}:${clientAddress(request, config)}`);
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
        const rate = limiter.consume(`ticket:${identity.userId}:${clientAddress(request, config)}`);
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
      const rate = limiter.consume(`${identity.userId}:${clientAddress(request, config)}`);
      if (!rate.allowed) {
        throw new MarketGatewayError("request rate limit exceeded", { statusCode: 429, code: "RATE_LIMITED", retryAfterMs: rate.resetAt - Date.now() });
      }
      const result = await restGateway.get(request.url);
      sendJson(response, result.statusCode, result.value, {
        "cache-control": "private, max-age=0",
        "x-haolo-cache": result.cacheStatus,
        "x-ratelimit-remaining": String(rate.remaining),
        ...result.headers,
      });
    } catch (error) {
      metrics.httpErrors += 1;
      const statusCode = Number(error?.statusCode || 500);
      const retryAfterSeconds = Math.ceil(Number(error?.retryAfterMs || 0) / 1_000);
      sendJson(response, statusCode, {
        error: String(error?.code || "INTERNAL_ERROR"),
        message: statusCode >= 500 ? "market gateway unavailable" : String(error?.message || "request rejected"),
        retryAfterMs: Number(error?.retryAfterMs || 0),
      }, retryAfterSeconds > 0 ? { "retry-after": String(retryAfterSeconds) } : {});
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
      const rate = limiter.consume(`ws:${identity.userId}:${clientAddress(request, config)}`);
      if (!rate.allowed) throw new GatewayAuthError("connection rate limit exceeded", 429);
      if (metrics.websocketClients >= config.maxWebsocketClientsTotal) {
        throw new GatewayAuthError("gateway connection capacity exceeded", 503);
      }
      if (Number(websocketClientsByUser.get(identity.userId) || 0) >= config.maxWebsocketClientsPerUser) {
        throw new GatewayAuthError("user connection limit exceeded", 429);
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
    const disposers = new Map();
    const { route } = context;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      metrics.websocketClients = Math.max(0, metrics.websocketClients - 1);
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
        const payload = route.mode === "stream" ? { stream: event.stream, data: event.data } : event.data;
        websocket.send(JSON.stringify(payload));
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
