import zlib from "node:zlib";
import { assertAllowedModelRequest } from "./retired-model-policy.mjs";
import { migrateDeepSeekModelSelection } from "./deepseek-model-policy.mjs";

// Inspect the actual wire envelope, including already-compressed requests.
// Transcript text mentioning a retired model is deliberately left untouched.
export function assertAllowedModelBody(body, encoding = "", maxBytes = 128 * 1024 * 1024) {
  normalizeModelRequestBody(body, encoding, maxBytes);
}

export function normalizeModelRequestBody(body, encoding = "", maxBytes = 128 * 1024 * 1024) {
  if (body == null || body.length === 0) return body;
  let bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const format = String(encoding || "").trim().toLowerCase();
  const decompress = { gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync, zstd: zlib.zstdDecompressSync }[format];
  if (format && format !== "identity") {
    if (!decompress) throw Object.assign(new Error("Unsupported model request encoding"), { code: "MODEL_REQUEST_ENCODING_UNSUPPORTED" });
    bytes = decompress(bytes, { maxOutputLength: maxBytes });
  }
  let payload;
  try { payload = JSON.parse(bytes.toString("utf8")); } catch { return body; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return body;
  assertAllowedModelRequest(payload);
  const migrated = migrateDeepSeekModelSelection(payload);
  if (migrated === payload) return body;
  const serialized = Buffer.from(JSON.stringify(migrated));
  const compress = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, zstd: zlib.zstdCompressSync }[format];
  return compress ? compress(serialized) : serialized;
}
