import { EventEmitter } from "node:events";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { WebSocketServer } from "ws";
import {
  MODEL_REQUEST_COMPRESSION_MIN_BYTES,
  prepareCompressedModelRequest,
} from "./model-request-compression.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function modelRequestRelayEnabled(env = process.env) {
  return !/^(?:0|false|no|off)$/i.test(
    String(env?.HAOLO_DESKTOP_MODEL_REQUEST_RELAY || "").trim(),
  );
}

export class ModelRequestRelay extends EventEmitter {
  constructor(options = {}) {
    super();
    this.upstream = normalizeUpstream(options.upstreamBaseUrl, options);
    this.fetch = typeof options.fetch === "function" ? options.fetch : globalThis.fetch;
    if (typeof this.fetch !== "function") {
      throw new Error("Model request relay requires a Fetch-compatible transport.");
    }
    this.minCompressBytes = positiveInteger(
      options.minCompressBytes,
      MODEL_REQUEST_COMPRESSION_MIN_BYTES,
    );
    this.maxRequestBytes = positiveInteger(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES);
    this.compressionOptions = options.compressionOptions || {};
    this.upstreamCompressionSupported = true;
    this.WebSocketImpl = options.WebSocketImpl || null;
    this.webSockets = new Set();
    this.webSocketServer = null;
    this.server = null;
    this.port = null;
    this.activeRequests = new Set();
  }

  async start() {
    if (this.server?.listening) return this.getStatus();
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    if (this.WebSocketImpl) {
      this.webSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: this.maxRequestBytes });
      server.on("upgrade", (request, socket, head) => this.handleWebSocket(request, socket, head));
    }
    server.requestTimeout = 0;
    server.headersTimeout = 30_000;
    server.keepAliveTimeout = 65_000;
    server.maxRequestsPerSocket = 0;
    this.server = server;
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, LOOPBACK_HOST);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("Model request relay did not receive a TCP listening address.");
    }
    this.port = address.port;
    return this.getStatus();
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.port = null;
    for (const socket of this.webSockets) socket.terminate();
    this.webSockets.clear();
    this.webSocketServer?.close();
    this.webSocketServer = null;
    for (const controller of this.activeRequests) controller.abort();
    this.activeRequests.clear();
    if (!server) return;
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    if (!server.listening) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  getStatus() {
    return {
      state: this.server?.listening ? "ready" : "stopped",
      baseUrl: this.localBaseUrl(),
      upstreamOrigin: this.upstream.origin,
      upstreamPath: this.upstream.pathname,
      minCompressBytes: this.minCompressBytes,
      maxRequestBytes: this.maxRequestBytes,
      supportsWebSockets: Boolean(this.WebSocketImpl),
    };
  }

  handleWebSocket(request, socket, head) {
    const target = this.targetUrl(request.url);
    if (!target || request.method !== "GET") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const url = new URL(target);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const headers = outboundHeaders(request.headers);
    for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"]) headers.delete(name);
    let upstream;
    try {
      upstream = new this.WebSocketImpl(url.href, { headers: Object.fromEntries(headers),
        perMessageDeflate: false, maxPayload: this.maxRequestBytes, handshakeTimeout: 12_000, followRedirects: false });
    } catch {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    this.webSockets.add(upstream);
    let downstream;
    const abort = () => { upstream.terminate(); downstream?.terminate(); };
    socket.on("error", abort);
    socket.once("close", abort);
    upstream.on("error", () => {
      if (downstream) downstream.close(1011, "Model transport failed");
      else socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    upstream.once("unexpected-response", (_request, response) => {
      const status = [401, 403, 404, 429].includes(response.statusCode) ? response.statusCode : 502;
      response.resume();
      socket.end(`HTTP/1.1 ${status} Upstream Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      upstream.terminate();
    });
    upstream.once("close", (code, reason) => {
      this.webSockets.delete(upstream);
      if (downstream?.readyState === 1) downstream.close(validCloseCode(code), reason);
      else if (!downstream) socket.destroy();
    });
    upstream.once("open", () => {
      if (socket.destroyed || !this.webSocketServer) { upstream.terminate(); return; }
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
        downstream = client;
        this.webSockets.add(client);
        client.on("error", abort);
        client.once("close", (code, reason) => {
          this.webSockets.delete(client);
          if (upstream.readyState === 1) upstream.close(validCloseCode(code), reason);
        });
        const forward = (from, to) => from.on("message", (data, binary) => {
          this.emit("websocket-frame", { direction: from === client ? "upstream" : "downstream", bytes: data.byteLength, binary });
          if (to.readyState !== 1) return;
          from.pause();
          to.send(data, { binary }, (error) => { if (error) abort(); else from.resume(); });
        });
        forward(client, upstream);
        forward(upstream, client);
      });
    });
  }

  localBaseUrl() {
    if (!this.port) return null;
    return `http://${LOOPBACK_HOST}:${this.port}${trimTrailingSlash(this.upstream.pathname)}`;
  }

  async handleRequest(request, response) {
    const startedAt = performance.now();
    const controller = new AbortController();
    this.activeRequests.add(controller);
    let responseStarted = false;
    let upstreamStatus = 0;
    let compression = null;
    const abortUpstream = () => controller.abort();
    request.once("aborted", abortUpstream);
    response.once("close", () => {
      if (!response.writableEnded) abortUpstream();
    });

    try {
      const target = this.targetUrl(request.url);
      if (!target) {
        writeJsonError(response, 404, "MODEL_RELAY_ROUTE_NOT_FOUND", "Unknown model relay route.");
        return;
      }
      const body = await readRequestBody(request, this.maxRequestBytes);
      const originalInit = {
        method: request.method,
        headers: request.headers,
        body: requestHasBody(request.method) ? body : undefined,
      };
      const prepared = await prepareCompressedModelRequest(target, originalInit, {
        ...this.compressionOptions,
        env: this.upstreamCompressionSupported
          ? this.compressionOptions.env
          : { HAOLO_DESKTOP_MODEL_REQUEST_COMPRESSION: "0" },
        force: true,
        minBytes: this.minCompressBytes,
      });
      compression = prepared.compression;
      const headers = outboundHeaders(prepared.init.headers);
      let upstreamResponse = await this.fetch(target, {
        method: request.method,
        headers,
        body: requestHasBody(request.method) ? prepared.init.body : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
      if (prepared.compression.applied && upstreamResponse.status === 415) {
        await discardFetchResponse(upstreamResponse);
        this.upstreamCompressionSupported = false;
        compression = {
          ...prepared.compression,
          fallbackApplied: true,
          fallbackStatus: 415,
          finalWireBytes: body.byteLength,
        };
        upstreamResponse = await this.fetch(target, {
          method: request.method,
          headers: outboundHeaders(originalInit.headers),
          body: requestHasBody(request.method) ? originalInit.body : undefined,
          redirect: "manual",
          signal: controller.signal,
        });
      }
      upstreamStatus = upstreamResponse.status;
      copyResponseHeaders(upstreamResponse.headers, response);
      response.writeHead(upstreamResponse.status);
      responseStarted = true;
      if (!upstreamResponse.body || request.method === "HEAD") {
        response.end();
        return;
      }
      await pipeline(Readable.fromWeb(upstreamResponse.body), response);
    } catch (error) {
      if (!responseStarted && !response.headersSent && !controller.signal.aborted) {
        const status = error?.code === "MODEL_RELAY_BODY_TOO_LARGE" ? 413 : 502;
        writeJsonError(
          response,
          status,
          error?.code || "MODEL_RELAY_UPSTREAM_FAILED",
          status === 413
            ? "Model request exceeds the local relay safety limit."
            : "Model transport failed before the upstream response started.",
        );
      } else if (!response.writableEnded) {
        response.destroy(error instanceof Error ? error : undefined);
      }
      this.emit("request-error", {
        code: error?.code || error?.cause?.code || "MODEL_RELAY_UPSTREAM_FAILED",
        message: String(error?.message || error),
        aborted: controller.signal.aborted,
      });
    } finally {
      request.off("aborted", abortUpstream);
      this.activeRequests.delete(controller);
      this.emit("request-metrics", {
        method: String(request.method || "GET").toUpperCase(),
        path: safePathname(request.url),
        status: upstreamStatus || response.statusCode || 0,
        durationMs: performance.now() - startedAt,
        compression,
      });
    }
  }

  targetUrl(requestUrl) {
    const raw = String(requestUrl || "");
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    let target;
    try {
      target = new URL(raw, this.upstream.origin);
    } catch {
      return null;
    }
    if (target.origin !== this.upstream.origin) return null;
    const basePath = trimTrailingSlash(this.upstream.pathname);
    if (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) {
      return null;
    }
    return target.toString();
  }
}

function validCloseCode(code) {
  return code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1011;
}

async function discardFetchResponse(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // A compatibility retry must not fail because the rejected body is already closed.
  }
}

function normalizeUpstream(value, options) {
  let upstream;
  try {
    upstream = new URL(String(value || ""));
  } catch {
    throw new Error("Model request relay requires a valid upstream base URL.");
  }
  if (upstream.username || upstream.password || upstream.search || upstream.hash) {
    throw new Error("Model request relay upstream URL cannot contain credentials, query, or fragment.");
  }
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(upstream.hostname.toLowerCase());
  if (upstream.protocol !== "https:" && !(upstream.protocol === "http:" && (loopback || options.allowInsecure === true))) {
    throw new Error("Model request relay requires HTTPS unless an insecure test upstream is explicitly allowed.");
  }
  return upstream;
}

async function readRequestBody(request, maxBytes) {
  if (!requestHasBody(request.method)) return Buffer.alloc(0);
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw bodyTooLargeError(maxBytes);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > maxBytes) throw bodyTooLargeError(maxBytes);
    chunks.push(bytes);
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
}

function bodyTooLargeError(maxBytes) {
  const error = new Error(`Model relay request exceeds ${maxBytes} bytes.`);
  error.code = "MODEL_RELAY_BODY_TOO_LARGE";
  return error;
}

function outboundHeaders(value) {
  const headers = new Headers(value || {});
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("accept-encoding", "identity");
  headers.set("x-haolo-client-transport", "loopback-compression-relay");
  return headers;
}

function copyResponseHeaders(headers, response) {
  for (const [name, value] of headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    response.setHeader(name, value);
  }
  if (typeof headers.getSetCookie === "function") {
    const setCookie = headers.getSetCookie();
    if (setCookie.length) response.setHeader("set-cookie", setCookie);
  }
}

function writeJsonError(response, status, code, message) {
  if (response.headersSent) return;
  const body = Buffer.from(JSON.stringify({ error: { code, message } }), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
  });
  response.end(body);
}

function requestHasBody(method) {
  const normalized = String(method || "GET").toUpperCase();
  return normalized !== "GET" && normalized !== "HEAD";
}

function safePathname(value) {
  try {
    return new URL(String(value || "/"), "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function trimTrailingSlash(value) {
  const normalized = String(value || "/").replace(/\/+$/, "");
  return normalized === "/" ? "" : normalized;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
