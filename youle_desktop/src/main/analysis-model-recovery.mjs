import { isRetryableModelTransportError, waitForModelTransportRecovery } from "./model-transport-recovery.mjs";

export const ANALYSIS_RECOVERY_MODEL = "gpt-5.5";
export const ANALYSIS_RECOVERY_EFFORT = "xhigh";
export const ANALYSIS_RECOVERY_PROVIDER = "haolo_ai";
export const ANALYSIS_RECOVERY_ATTEMPTS = 2;

function failureFields(error) {
  const fields = [];
  const visited = new Set();
  const visit = (value, depth = 0) => {
    if (value == null || depth > 4 || visited.has(value)) return;
    if (typeof value === "string") { fields.push(value); return; }
    if (typeof value !== "object") return;
    visited.add(value);
    for (const key of ["message", "detail", "additionalDetails", "additional_details", "code", "errorCode", "category", "errorClass", "name", "type", "error", "cause", "response", "codexErrorInfo", "codex_error_info"]) visit(value[key], depth + 1);
  };
  visit(error);
  return fields.join(" ");
}

export function isModelOverloadFailure(error) {
  return /server[_ ]is[_ ]overloaded|\boverloaded\b|\bat capacity\b|\bslow_down\b|\boverload(?:ed)?_error\b|上游过载|模型.{0,8}(?:过载|容量已满)/iu.test(failureFields(error));
}

export function isRecoverableAnalysisModelFailure(error, { allowUnknownTerminal = false } = {}) {
  const text = failureFields(error);
  const status = String(error?.status || "").toLowerCase();
  const httpStatus = Number(error?.httpStatus || error?.statusCode || error?.status || error?.cause?.httpStatus || error?.cause?.status);
  if (error?.willRetry === true || /cancelled|canceled|interrupted|aborted/.test(status)) return false;
  if (/TRIAL_REQUIRED|ACCOUNT_ID_REQUIRED|CLEANUP_INCOMPLETE/iu.test(text)) return false;
  if (/AbortError|cancelled|canceled|INVOCATION_CANCELLED|ABORT_ERR|TRADING_ANALYSIS_CANCELLED|authentication|auth_failed|auth_expired|unauthori[sz]ed|forbidden|invalid.api.key|permission|entitlement|membership|insufficient.{0,12}(?:quota|balance|credits)|billing|payment|会员|积分|余额不足|权限|鉴权|取消|context[_ ](?:length|window)|too many tokens|content[_ ]filter|policy|side[_ ]effect|invalid[_ ]request|unsupported|invalid.*(?:parameter|argument)|thread[_ ]history|thread_index_missing/iu.test(text)) return false;
  if (httpStatus >= 400 && httpStatus < 500 && ![408, 425, 429].includes(httpStatus)) return false;
  if (Array.isArray(error?.effects) && error.effects.length) return false;
  if (["auth", "context", "permission", "invalid_request", "content_filter"].includes(String(error?.category || error?.errorClass || "").toLowerCase())) return false;
  // Capacity errors are incorrectly tagged retryable=false by some runtimes.
  // Override that flag only after the hard failure gates above.
  if (isModelOverloadFailure(error)) return true;
  if (isRetryableModelTransportError(error) || [408, 425, 429].includes(httpStatus) || httpStatus >= 500) return true;
  if (/stream_disconnected|upstream_5xx|rate_limit|concurrency_limit|connection_refused|timeout|proxy|internal[_ ]server[_ ]error|error occurred while processing your request/iu.test(text)) return true;
  if (/TRADING_ANALYSIS_(?:APP_SERVER_FAILED|MODEL_FAILED|MODEL_EMPTY_RESPONSE)|CODEX_(?:TURN|SUBAGENT)_FAILED/.test(text)) return true;
  return allowUnknownTerminal && ["", "none", "unknown"].includes(String(error?.errorClass || "").toLowerCase());
}

function checkCancelled(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Analysis cancelled", "AbortError");
}

// Only for isolated, read-only model calls. The same request/snapshot remains
// owned by the caller; no data refresh, drawing or tool effects are replayed.
export async function runWithAnalysisModelRecovery({ operation, modelId, reasoningEffort, signal, onRecovery, wait = waitForModelTransportRecovery }) {
  let fallbackAttempts = modelId === ANALYSIS_RECOVERY_MODEL && reasoningEffort === ANALYSIS_RECOVERY_EFFORT ? 1 : 0;
  let selection = { modelId, reasoningEffort, ...(fallbackAttempts ? { modelProvider: ANALYSIS_RECOVERY_PROVIDER } : {}) };
  for (;;) {
    checkCancelled(signal);
    try {
      const result = await operation(selection);
      checkCancelled(signal);
      return { ...result, reasoningEffort: selection.reasoningEffort, ...(fallbackAttempts ? { recovery: { modelId: ANALYSIS_RECOVERY_MODEL, reasoningEffort: ANALYSIS_RECOVERY_EFFORT, attempts: fallbackAttempts } } : {}) };
    } catch (error) {
      checkCancelled(signal);
      const recoverable = isRecoverableAnalysisModelFailure(error);
      if (!recoverable || fallbackAttempts >= ANALYSIS_RECOVERY_ATTEMPTS) {
        if (fallbackAttempts && error && typeof error === "object" && Object.isExtensible(error)) {
          error.modelId = selection.modelId;
          error.reasoningEffort = selection.reasoningEffort;
          error.recovery = { modelId: selection.modelId, reasoningEffort: selection.reasoningEffort, attempts: fallbackAttempts, exhausted: recoverable };
        }
        throw error;
      }
      const delayMs = fallbackAttempts ? 4_000 : 1_500;
      fallbackAttempts += 1;
      selection = { modelId: ANALYSIS_RECOVERY_MODEL, modelProvider: ANALYSIS_RECOVERY_PROVIDER, reasoningEffort: ANALYSIS_RECOVERY_EFFORT };
      try { onRecovery?.({ ...selection, attempt: fallbackAttempts, delayMs }); } catch { /* Observer cannot break recovery. */ }
      await wait(delayMs, signal);
    }
  }
}
