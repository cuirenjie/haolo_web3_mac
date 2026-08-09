import zlib from "node:zlib";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

export const MODEL_REQUEST_COMPRESSION_MIN_BYTES = 64 * 1024;
export const MODEL_REQUEST_COMPRESSION_MIN_SAVINGS_RATIO = 0.05;

const gzipAsync = promisify(zlib.gzip);
const zstdAsync = typeof zlib.zstdCompress === "function"
  ? promisify(zlib.zstdCompress)
  : null;

export function modelRequestCompressionEnabled(env = process.env) {
  return !/^(?:0|false|no|off)$/i.test(
    String(env?.HAOLO_DESKTOP_MODEL_REQUEST_COMPRESSION || "").trim(),
  );
}

export function isModelInferenceRequestUrl(value) {
  let pathname;
  try {
    pathname = new URL(String(value)).pathname.toLowerCase();
  } catch {
    return false;
  }
  return pathname.endsWith("/responses")
    || pathname.endsWith("/chat/completions")
    || pathname.includes(":generatecontent")
    || pathname.includes(":streamgeneratecontent");
}

export async function prepareCompressedModelRequest(value, init = {}, options = {}) {
  if (!modelRequestCompressionEnabled(options.env)) {
    return compressionResult(init, "disabled");
  }
  if (!options.force && !isModelInferenceRequestUrl(value)) {
    return compressionResult(init, "not-model-request");
  }
  const method = String(init.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || init.body == null) {
    return compressionResult(init, "missing-body");
  }

  const headers = new Headers(init.headers || {});
  if (headers.has("content-encoding")) {
    return compressionResult(init, "already-encoded");
  }
  const contentType = String(headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("json")) {
    return compressionResult(init, "not-json");
  }

  const originalBody = requestBodyBuffer(init.body);
  if (!originalBody) {
    return compressionResult(init, "unsupported-body");
  }
  const minBytes = positiveInteger(options.minBytes, MODEL_REQUEST_COMPRESSION_MIN_BYTES);
  if (originalBody.byteLength < minBytes) {
    return compressionResult(init, "below-threshold", originalBody.byteLength);
  }

  const startedAt = performance.now();
  let compressedBody;
  let encoding;
  try {
    if (zstdAsync && options.preferGzip !== true) {
      encoding = "zstd";
      compressedBody = await zstdAsync(originalBody, {
        params: {
          [zlib.constants.ZSTD_c_compressionLevel]: positiveInteger(options.zstdLevel, 3),
        },
      });
    } else {
      encoding = "gzip";
      compressedBody = await gzipAsync(originalBody, {
        level: positiveInteger(options.gzipLevel, 6),
      });
    }
  } catch (error) {
    return compressionResult(
      init,
      "compression-failed",
      originalBody.byteLength,
      0,
      performance.now() - startedAt,
      error,
    );
  }

  const minimumSavingsRatio = finiteRatio(
    options.minimumSavingsRatio,
    MODEL_REQUEST_COMPRESSION_MIN_SAVINGS_RATIO,
  );
  const savingsRatio = 1 - (compressedBody.byteLength / originalBody.byteLength);
  if (savingsRatio < minimumSavingsRatio) {
    return compressionResult(
      init,
      "insufficient-savings",
      originalBody.byteLength,
      compressedBody.byteLength,
      performance.now() - startedAt,
    );
  }

  headers.set("content-encoding", encoding);
  headers.delete("content-length");
  return {
    init: {
      ...init,
      headers,
      body: compressedBody,
    },
    compression: {
      applied: true,
      reason: "compressed",
      encoding,
      originalBytes: originalBody.byteLength,
      wireBytes: compressedBody.byteLength,
      savingsRatio,
      elapsedMs: performance.now() - startedAt,
      error: null,
    },
  };
}

function requestBodyBuffer(body) {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  return null;
}

function compressionResult(
  init,
  reason,
  originalBytes = bodyByteLength(init?.body),
  wireBytes = originalBytes,
  elapsedMs = 0,
  error = null,
) {
  return {
    init,
    compression: {
      applied: false,
      reason,
      encoding: null,
      originalBytes,
      wireBytes,
      savingsRatio: originalBytes > 0 ? 1 - (wireBytes / originalBytes) : 0,
      elapsedMs,
      error: error ? String(error?.message || error) : null,
    },
  };
}

function bodyByteLength(body) {
  const buffer = requestBodyBuffer(body);
  return buffer?.byteLength || 0;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function finiteRatio(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number < 1 ? number : fallback;
}
