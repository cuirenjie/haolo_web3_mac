import https from "node:https";
import tls from "node:tls";
import { createConnectionLookup } from "../connection-route-lookup.mjs";

const ALLOWED_BINANCE_ACCOUNT_ORIGINS = new Set([
  "https://api.binance.com",
  "https://fapi.binance.com",
]);
const ALLOWED_REQUEST_HEADERS = new Set(["accept", "user-agent", "x-mbx-apikey"]);
const MAX_CONNECT_HEADER_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

function normalizedProxyOrigin(value) {
  const proxy = new URL(String(value || ""));
  if (
    proxy.protocol !== "https:"
    || proxy.username
    || proxy.password
    || proxy.pathname !== "/"
    || proxy.search
    || proxy.hash
  ) throw new TypeError("Binance private proxy must use an HTTPS origin");
  return proxy;
}

function responseHeaders(headers = {}) {
  const normalized = new Headers();
  for (const [key, values] of Object.entries(headers)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (value != null) normalized.append(key, String(value));
    }
  }
  return normalized;
}

function requestHeaders(value) {
  const headers = new Headers(value || {});
  return Object.fromEntries([...headers.entries()].filter(([key]) => ALLOWED_REQUEST_HEADERS.has(key.toLowerCase())));
}

function parseRetryAfterMs(value, nowMs = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : 0;
}

function connectTls(tlsModule, options, signal, registerSocket) {
  return new Promise((resolve, reject) => {
    let socket;
    let settled = false;
    const cleanup = () => {
      socket?.off?.("error", fail);
      signal?.removeEventListener?.("abort", abort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      socket?.destroy?.();
      reject(error);
    };
    const abort = () => fail(signal.reason || new DOMException("The operation was aborted", "AbortError"));
    try {
      socket = tlsModule.connect(options, () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(socket);
      });
      registerSocket?.(socket);
      socket.once("error", fail);
      if (signal?.aborted) abort();
      else signal?.addEventListener?.("abort", abort, { once: true });
    } catch (error) {
      fail(error);
    }
  });
}

function readConnectResponse(socket, requestText, signal, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => fail(Object.assign(new Error("private proxy CONNECT timed out"), { name: "TimeoutError" })), timeoutMs);
    timer.unref?.();
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", fail);
      socket.off("close", onClose);
      signal?.removeEventListener?.("abort", abort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(signal.reason || new DOMException("The operation was aborted", "AbortError"));
    const onClose = () => fail(new Error("private proxy closed before CONNECT completed"));
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (buffer.length > MAX_CONNECT_HEADER_BYTES) {
        fail(new Error("private proxy CONNECT response headers are too large"));
        return;
      }
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const head = buffer.subarray(0, boundary).toString("latin1");
      const remainder = buffer.subarray(boundary + 4);
      const lines = head.split("\r\n");
      const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})(?:\s+(.*))?$/.exec(lines.shift() || "");
      if (!statusMatch) {
        fail(new Error("private proxy returned an invalid CONNECT response"));
        return;
      }
      const headers = {};
      for (const line of lines) {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;
        headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      }
      settled = true;
      cleanup();
      if (remainder.length) socket.unshift(remainder);
      resolve({ status: Number(statusMatch[1]), statusText: statusMatch[2] || "", headers });
    };
    socket.on("data", onData);
    socket.once("error", fail);
    socket.once("close", onClose);
    if (signal?.aborted) abort();
    else signal?.addEventListener?.("abort", abort, { once: true });
    socket.write(requestText);
  });
}

function requestThroughTlsSocket({ target, method, headers, signal, innerSocket, httpsModule }) {
  return new Promise((resolve, reject) => {
    const agent = new httpsModule.Agent({ keepAlive: false, maxSockets: 1 });
    agent.createConnection = (_options, callback) => {
      callback?.(null, innerSocket);
      return innerSocket;
    };
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      agent.destroy();
      callback(value);
    };
    const request = httpsModule.request(target, { method, headers, agent, signal }, (incoming) => {
      const chunks = [];
      let size = 0;
      incoming.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("Binance private response is too large"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      incoming.once("error", (error) => finish(reject, error));
      incoming.once("end", () => {
        const status = Number(incoming.statusCode || 502);
        const body = [204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        finish(resolve, new Response(body, {
          status,
          statusText: incoming.statusMessage || "",
          headers: responseHeaders(incoming.headers),
        }));
      });
    });
    request.once("error", (error) => finish(reject, error));
    request.end();
  });
}

export async function performHttpsConnectRequest({
  target,
  proxy,
  permitToken,
  method = "GET",
  headers = {},
  signal,
  tlsModule = tls,
  httpsModule = https,
  lookup,
  connectOuter,
  registerSocket,
  unregisterSocket,
} = {}) {
  let outerSocket;
  let innerSocket;
  const connectionLookup = createConnectionLookup(lookup);
  try {
    outerSocket = connectOuter ? await connectOuter(proxy.href, { signal }) : await connectTls(tlsModule, {
      host: proxy.hostname,
      port: Number(proxy.port || 443),
      servername: proxy.hostname,
      ALPNProtocols: ["http/1.1"],
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      ...(connectionLookup ? { lookup: connectionLookup, family: 4 } : {}),
    }, signal, registerSocket).catch((error) => {
      if (!signal?.aborted) connectionLookup?.invalidate?.(proxy.hostname);
      throw error;
    });
    if (connectOuter) registerSocket?.(outerSocket);
    const authority = `${target.hostname}:443`;
    const basic = Buffer.from(`haolo:${permitToken}`).toString("base64");
    const connectResponse = await readConnectResponse(
      outerSocket,
      `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: Basic ${basic}\r\nProxy-Connection: keep-alive\r\n\r\n`,
      signal,
    );
    if (connectResponse.status !== 200) {
      const retryAfter = connectResponse.headers["retry-after"];
      return Object.freeze({
        upstream: false,
        response: new Response(JSON.stringify({ code: -1003, msg: "Haolo private egress rejected the request." }), {
          status: connectResponse.status,
          statusText: connectResponse.statusText,
          headers: { "content-type": "application/json", ...(retryAfter ? { "retry-after": retryAfter } : {}) },
        }),
      });
    }
    innerSocket = await connectTls(tlsModule, {
      socket: outerSocket,
      servername: target.hostname,
      ALPNProtocols: ["http/1.1"],
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    }, signal, registerSocket);
    const response = await requestThroughTlsSocket({ target, method, headers, signal, innerSocket, httpsModule });
    return Object.freeze({ upstream: true, response });
  } finally {
    unregisterSocket?.(innerSocket);
    unregisterSocket?.(outerSocket);
    innerSocket?.destroy?.();
    if (outerSocket !== innerSocket) outerSocket?.destroy?.();
  }
}

function permitRateLimitResponse(error) {
  const status = [418, 429].includes(Number(error?.status)) ? Number(error.status) : 429;
  const retryAfterMs = Math.max(1_000, Number(error?.retryAfterMs || 60_000));
  return new Response(JSON.stringify({ code: -1003, msg: "Haolo shared Binance egress is at capacity." }), {
    status,
    statusText: status === 418 ? "I'm a Teapot" : "Too Many Requests",
    headers: {
      "content-type": "application/json",
      "retry-after": String(Math.ceil(retryAfterMs / 1_000)),
      "x-haolo-binance-governor": "shared-egress",
    },
  });
}

export class BinancePrivateProxyTransport {
  constructor({ proxyUrl = "", permitProvider, usageReporter = null, requestImpl = performHttpsConnectRequest, lookup = null, connectOuter = null } = {}) {
    if (typeof permitProvider !== "function" || typeof requestImpl !== "function") {
      throw new TypeError("permitProvider and requestImpl are required");
    }
    this.defaultProxy = proxyUrl ? normalizedProxyOrigin(proxyUrl) : null;
    this.permitProvider = permitProvider;
    this.usageReporter = typeof usageReporter === "function" ? usageReporter : null;
    this.requestImpl = requestImpl;
    this.lookup = lookup;
    this.connectOuter = connectOuter;
    this.activeSockets = new Set();
    this.closed = false;
  }

  async fetch(urlValue, init = {}) {
    if (this.closed) throw new Error("Binance private proxy transport is closed");
    const target = new URL(urlValue);
    if (!ALLOWED_BINANCE_ACCOUNT_ORIGINS.has(target.origin)) {
      throw new TypeError("private Binance proxy target is not allowed");
    }
    const method = String(init.method || "GET").toUpperCase();
    if (method !== "GET") throw new TypeError("private Binance proxy permits GET only");
    let permit;
    try {
      permit = await this.permitProvider(target.href, { signal: init.signal });
    } catch (error) {
      if ([418, 429].includes(Number(error?.status))) return permitRateLimitResponse(error);
      throw error;
    }
    const proxy = normalizedProxyOrigin(permit?.proxyUrl || this.defaultProxy?.origin || "");
    if (!permit?.permitToken || !permit?.permitId || String(permit.targetHost || "").toLowerCase() !== target.hostname.toLowerCase()) {
      throw new Error("Haolo private egress returned an invalid permit");
    }
    const result = await this.requestImpl({
      target,
      proxy,
      permitToken: String(permit.permitToken),
      method,
      headers: requestHeaders(init.headers),
      signal: init.signal,
      lookup: this.lookup,
      connectOuter: this.connectOuter,
      registerSocket: (socket) => socket && this.activeSockets.add(socket),
      unregisterSocket: (socket) => socket && this.activeSockets.delete(socket),
    });
    const response = result?.response || result;
    if (result?.upstream !== false && this.usageReporter && response) {
      await Promise.resolve(this.usageReporter({
        permitId: permit.permitId,
        status: Number(response.status || 0),
        usedWeight1m: Number(response.headers?.get?.("x-mbx-used-weight-1m") || 0),
        retryAfterMs: parseRetryAfterMs(response.headers?.get?.("retry-after")),
      })).catch(() => false);
    }
    return response;
  }

  async close() {
    this.closed = true;
    for (const socket of this.activeSockets) socket.destroy?.();
    this.activeSockets.clear();
  }
}

export { ALLOWED_BINANCE_ACCOUNT_ORIGINS, ALLOWED_REQUEST_HEADERS, parseRetryAfterMs };
