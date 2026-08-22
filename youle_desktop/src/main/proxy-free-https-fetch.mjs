import https from "node:https";

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function abortError(reason) {
  if (reason instanceof Error) return reason;
  return new DOMException("The operation was aborted", "AbortError");
}

function timeoutError(timeoutMs) {
  const error = new Error(`Proxy-free HTTPS request timed out after ${timeoutMs}ms`);
  error.name = "TimeoutError";
  return error;
}

function requestBody(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || Buffer.isBuffer(value)) return value;
  if (value instanceof URLSearchParams) return value.toString();
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("proxy-free HTTPS fetch supports buffered request bodies only");
}

function responseHeaders(message) {
  const headers = new Headers();
  const raw = Array.isArray(message?.rawHeaders) ? message.rawHeaders : [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    headers.append(String(raw[index]), String(raw[index + 1]));
  }
  return headers;
}

export function createProxyFreeHttpsFetch({
  allowedOrigins = [],
  timeoutMs = 8_000,
  maxResponseBytes = 16 * 1024 * 1024,
  requestImpl = https.request,
  agent = null,
} = {}) {
  const origins = new Set([...allowedOrigins].map((value) => new URL(String(value)).origin));
  const requestTimeoutMs = Math.max(500, Number(timeoutMs) || 8_000);
  const responseLimit = Math.max(1_024, Number(maxResponseBytes) || 16 * 1024 * 1024);
  const httpsAgent = agent || new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 20_000,
    maxSockets: 12,
    maxFreeSockets: 6,
    scheduling: "lifo",
  });

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.protocol !== "https:") throw new TypeError("proxy-free transport permits HTTPS only");
    if (origins.size && !origins.has(url.origin)) throw new TypeError("proxy-free transport origin is not allowed");
    if (init.signal?.aborted) throw abortError(init.signal.reason);
    const body = requestBody(init.body);
    const headers = new Headers(init.headers || {});
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    if (body !== null && !headers.has("content-length")) {
      headers.set("content-length", String(Buffer.byteLength(body)));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let response = null;
      let request = null;
      let deadline = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        init.signal?.removeEventListener("abort", handleAbort);
        callback(value);
      };
      const handleAbort = () => {
        const error = abortError(init.signal?.reason);
        request?.destroy(error);
        response?.destroy?.(error);
        finish(reject, error);
      };
      request = requestImpl(url, {
        method: String(init.method || "GET").toUpperCase(),
        headers: Object.fromEntries(headers.entries()),
        agent: httpsAgent,
        family: 4,
      }, (message) => {
        response = message;
        const chunks = [];
        let receivedBytes = 0;
        message.on("data", (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > responseLimit) {
            const error = new Error(`Proxy-free HTTPS response exceeded ${responseLimit} bytes`);
            request.destroy(error);
            message.destroy?.(error);
            finish(reject, error);
            return;
          }
          chunks.push(buffer);
        });
        message.once("error", (error) => finish(reject, error));
        message.once("aborted", () => finish(reject, new Error("Proxy-free HTTPS response was aborted")));
        message.once("end", () => {
          const status = Number(message.statusCode || 0);
          if (status < 100 || status > 599) {
            finish(reject, new Error("Proxy-free HTTPS response has an invalid status"));
            return;
          }
          const responseBody = NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks);
          finish(resolve, new Response(responseBody, {
            status,
            statusText: String(message.statusMessage || ""),
            headers: responseHeaders(message),
          }));
        });
      });
      request.once("error", (error) => finish(reject, error));
      deadline = setTimeout(() => {
        const error = timeoutError(requestTimeoutMs);
        request.destroy(error);
        response?.destroy?.(error);
        finish(reject, error);
      }, requestTimeoutMs);
      deadline.unref?.();
      init.signal?.addEventListener("abort", handleAbort, { once: true });
      try {
        if (body !== null) request.write(body);
        request.end();
      } catch (error) {
        request.destroy?.(error);
        finish(reject, error);
      }
    });
  };

  Object.defineProperty(fetchImpl, "close", {
    value: () => httpsAgent.destroy?.(),
    enumerable: false,
  });
  return fetchImpl;
}
