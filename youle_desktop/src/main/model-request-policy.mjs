import zlib from "node:zlib";
import { projectModelToolContext } from "./model-context-projection.mjs";
import { assertAllowedModelRequest, isRetiredExecutionModel } from "./retired-model-policy.mjs";
import { migrateDeepSeekModelSelection, isManagedAnalysisModel, DEEPSEEK_FLASH_MODEL } from "./deepseek-model-policy.mjs";

export function modelFromRequestBody(body, encoding = "") {
  try {
    const decode = { gzip: zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync, zstd: zlib.zstdDecompressSync }[String(encoding).trim().toLowerCase()];
    const payload = JSON.parse((decode ? decode(body, { maxOutputLength: 128 * 1024 * 1024 }) : body).toString("utf8"));
    return payload?.response?.model || payload?.model || "";
  } catch { return ""; }
}

// Inspect the actual wire envelope, including already-compressed requests.
// Transcript text mentioning a retired model is deliberately left untouched.
export function assertAllowedModelBody(body, encoding = "", maxBytes = 128 * 1024 * 1024) {
  normalizeModelRequestBody(body, encoding, maxBytes);
}

export function normalizeModelRequestBody(body, encoding = "", maxBytes = 128 * 1024 * 1024, resolveHistoryModel, managedAnalysis = false, contextOptions = {}) {
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
  // Codex can compact with the previous turn's model even after settings/update.
  // Only a host-confirmed selection for this exact runtime thread may replace
  // that stale model. Generic transports and explicit retired selections remain
  // rejected, and no transcript/history item is rewritten.
  let compatible = payload;
  const envelope = payload.type === "response.create" && payload.response && typeof payload.response === "object"
    ? payload.response : payload;
  if (isRetiredExecutionModel(envelope.model) && typeof resolveHistoryModel === "function") {
    const selection = resolveHistoryModel(envelope.prompt_cache_key);
    if (selection?.model && !isRetiredExecutionModel(selection.model)) {
      const migratedEnvelope = { ...envelope, model: selection.model,
        ...(envelope.reasoning ? { reasoning: { ...envelope.reasoning, effort: selection.effort || "low" } } : {}) };
      compatible = envelope === payload ? migratedEnvelope : { ...payload, response: migratedEnvelope };
    }
  }
  assertAllowedModelRequest(compatible);
  let migrated = migrateDeepSeekModelSelection(compatible);
  const target = migrated.type === "response.create" && migrated.response && typeof migrated.response === "object" ? migrated.response : migrated;
  if (managedAnalysis && isManagedAnalysisModel(target.model)) {
    const normalized = { ...target, model: DEEPSEEK_FLASH_MODEL,
      reasoning: { ...target.reasoning, effort: "low" },
      ...(Object.hasOwn(target, "reasoning_effort") ? { reasoning_effort: "low" } : {}) };
    migrated = target === migrated ? normalized : { ...migrated, response: normalized };
  }
  if (managedAnalysis && contextOptions.enabled !== false) {
    const projection = projectModelToolContext(migrated);
    migrated = projection.payload;
    // Observability is counts only, never user text, account IDs or tool data.
    try { contextOptions.onMetrics?.(projection.metrics); } catch { /* Diagnostic observer only. */ }
  }
  if (migrated === payload) return body;
  const serialized = Buffer.from(JSON.stringify(migrated));
  const compress = { gzip: zlib.gzipSync, deflate: zlib.deflateSync, br: zlib.brotliCompressSync, zstd: zlib.zstdCompressSync }[format];
  return compress ? compress(serialized) : serialized;
}
