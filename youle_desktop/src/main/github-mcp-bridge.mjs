import crypto from "node:crypto";
import http from "node:http";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 512 * 1024;

export class GitHubMcpBridge {
  constructor(options = {}) {
    if (typeof options.invoke !== "function") {
      throw new TypeError("GitHubMcpBridge requires an invoke function");
    }
    this.invoke = options.invoke;
    this.server = null;
    this.baseUrl = null;
    this.token = null;
  }

  async start() {
    if (this.server) return this.environment();
    this.token = crypto.randomBytes(32).toString("base64url");
    const server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    server.keepAliveTimeout = 5_000;
    server.headersTimeout = 10_000;
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen(0, HOST, () => {
        server.off("error", onError);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await closeServer(server);
      this.token = null;
      throw new Error("GitHub MCP bridge did not receive a loopback port");
    }
    this.server = server;
    this.baseUrl = `http://${HOST}:${address.port}`;
    return this.environment();
  }

  environment() {
    if (!this.server || !this.baseUrl || !this.token) {
      throw new Error("GitHub MCP bridge is not running");
    }
    return {
      HAOLO_GITHUB_BROKER_URL: this.baseUrl,
      HAOLO_GITHUB_BROKER_TOKEN: this.token,
    };
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.baseUrl = null;
    this.token = null;
    if (server) await closeServer(server);
  }

  async handleRequest(request, response) {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/tools/call") {
      writeJson(response, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
      return;
    }
    if (!this.authorized(request.headers.authorization)) {
      writeJson(response, 401, { error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      return;
    }
    try {
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw requestError("INVALID_REQUEST", "Request body must be a JSON object", 400);
      }
      const tool = typeof body.tool === "string" ? body.tool.trim() : "";
      const args = body.arguments;
      if (!tool || !args || typeof args !== "object" || Array.isArray(args)) {
        throw requestError("INVALID_REQUEST", "tool and arguments are required", 400);
      }
      const result = await this.invoke({ tool, arguments: args });
      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, bridgeErrorStatus(error), {
        error: bridgeErrorPayload(error),
      });
    }
  }

  authorized(value) {
    const prefix = "Bearer ";
    if (!this.token || typeof value !== "string" || !value.startsWith(prefix)) return false;
    const supplied = Buffer.from(value.slice(prefix.length), "utf8");
    const expected = Buffer.from(this.token, "utf8");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw requestError("REQUEST_TOO_LARGE", "Request body is too large", 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw requestError("INVALID_JSON", "Request body is not valid JSON", 400);
  }
}

function requestError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function bridgeErrorStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function bridgeErrorPayload(error) {
  const upstream = error?.payload?.error || error?.payload?.detail || null;
  if (upstream && typeof upstream === "object" && !Array.isArray(upstream)) {
    return {
      code: String(upstream.code || error.code || "GITHUB_RELAY_ERROR"),
      message: String(upstream.message || error.message || "GitHub relay failed"),
      category: upstream.category || error.category || "remote",
      retryable: Boolean(upstream.retryable ?? error.retryable),
      retry_after_ms: upstream.retry_after_ms ?? error.retryAfterMs ?? null,
      request_id: upstream.request_id ?? error.requestId ?? null,
      upstream_status: upstream.upstream_status ?? error.upstreamStatus ?? null,
    };
  }
  return {
    code: String(error?.code || "GITHUB_RELAY_ERROR"),
    message: String(error?.message || "GitHub relay failed"),
    category: String(error?.category || "execution"),
    retryable: Boolean(error?.retryable),
  };
}

function writeJson(response, status, value) {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.end(JSON.stringify(value));
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}
