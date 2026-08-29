import crypto from "node:crypto";
import http from "node:http";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 512 * 1024;

export class ChromeMcpBridge {
  constructor({ invoke } = {}) {
    if (typeof invoke !== "function") throw new TypeError("ChromeMcpBridge requires an invoke function");
    this.invoke = invoke;
    this.server = null;
    this.baseUrl = null;
    this.token = null;
  }

  async start() {
    if (this.server) return this.environment();
    this.token = crypto.randomBytes(32).toString("base64url");
    const server = http.createServer((request, response) => void this.handleRequest(request, response));
    server.keepAliveTimeout = 5_000;
    server.headersTimeout = 10_000;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await closeServer(server);
      this.token = null;
      throw new Error("Chrome MCP bridge did not receive a loopback port");
    }
    this.server = server;
    this.baseUrl = `http://${HOST}:${address.port}`;
    return this.environment();
  }

  environment() {
    if (!this.server || !this.baseUrl || !this.token) throw new Error("Chrome MCP bridge is not running");
    return { HAOLO_CHROME_BROKER_URL: this.baseUrl, HAOLO_CHROME_BROKER_TOKEN: this.token };
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
      if (!body || typeof body !== "object" || Array.isArray(body)) throw bridgeError("INVALID_REQUEST", "Request body must be an object.", 400);
      const tool = String(body.tool || "").trim();
      const args = body.arguments;
      if (!tool || !args || typeof args !== "object" || Array.isArray(args)) throw bridgeError("INVALID_REQUEST", "tool and arguments are required.", 400);
      const context = body.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context : {};
      const result = await this.invoke({ tool, arguments: args, context });
      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, Number(error?.status) || 502, {
        error: {
          code: String(error?.code || "CHROME_BRIDGE_ERROR"),
          message: String(error?.message || "Chrome bridge failed."),
          category: String(error?.category || "execution"),
          retryable: Boolean(error?.retryable),
        },
      });
    }
  }

  authorized(value) {
    if (!this.token || typeof value !== "string" || !value.startsWith("Bearer ")) return false;
    const supplied = Buffer.from(value.slice(7), "utf8");
    const expected = Buffer.from(this.token, "utf8");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw bridgeError("REQUEST_TOO_LARGE", "Request body exceeds 512 KiB.", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw bridgeError("INVALID_JSON", "Request body is not valid JSON.", 400);
  }
}

function bridgeError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function writeJson(response, status, value) {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.end(JSON.stringify(value));
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}
