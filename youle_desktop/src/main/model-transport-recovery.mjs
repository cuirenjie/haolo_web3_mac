import { modelFailureFacts } from "./model-failure-policy.mjs";
const DEFAULT_SHORT_DELAYS_MS = [1_500, 4_000, 8_000, 15_000];
const DEFAULT_LOW_FREQUENCY_DELAY_MS = 60_000;
const DEFAULT_LOW_FREQUENCY_AFTER = 3;

const RETRYABLE_CODES = new Set([
  "STREAM_DISCONNECTED",
  "RESPONSE_STREAM_DISCONNECTED",
  "NETWORK_ERROR",
  "FETCH_FAILED",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "WORKFLOW_TURN_TIMEOUT",
]);

const NON_RETRYABLE_CODES = new Set([
  "INVOCATION_CANCELLED",
  "ABORT_ERR",
  "AUTH_FAILED",
  "AUTH_EXPIRED",
  "INVALID_API_KEY",
  "CONTEXT_LENGTH_EXCEEDED",
  "CONTENT_FILTER",
  "INVALID_REQUEST",
  "PROVIDER_TOOL_PROTOCOL_UNSUPPORTED",
]);

export function isRetryableModelTransportError(error) {
  if (!error || isAbortError(error)) return false;
  const facts = modelFailureFacts(error);
  if (facts.hardFailure || facts.retryable === false) return false;
  if (error.retryable === false) return false;

  const nestedError = error?.codexErrorInfo || error?.codex_error_info || {};
  const disconnected = nestedError?.responseStreamDisconnected
    || nestedError?.response_stream_disconnected
    || {};
  const hasStructuredDisconnect = Boolean(
    nestedError?.responseStreamDisconnected
    || nestedError?.response_stream_disconnected
    || error?.responseStreamDisconnected
    || error?.response_stream_disconnected,
  );
  const code = normalizedCode(error.code || error.type || error.cause?.code);
  if (NON_RETRYABLE_CODES.has(code)) return false;

  const status = Number(
    error.status
    ?? error.statusCode
    ?? error.status_code
    ?? error.httpStatus
    ?? error.httpStatusCode
    ?? error.http_status_code
    ?? disconnected.httpStatusCode
    ?? disconnected.http_status_code
    ?? error.cause?.status,
  );
  if (![408, 425, 429].includes(status) && status >= 400 && status < 500) return false;

  const category = String(error.category || "").trim().toLowerCase();
  if (["auth", "permission", "invalid_request", "context", "content_filter"].includes(category)) return false;
  if (error.retryable === true) return true;
  if (hasStructuredDisconnect) return true;
  if (RETRYABLE_CODES.has(code)) return true;
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  if (["transport", "network", "timeout", "rate_limit", "upstream"].includes(category)) return true;

  const text = [
    error.message,
    error.detail,
    error.additionalDetails,
    error.additional_details,
    nestedError.additionalDetails,
    nestedError.additional_details,
    error.name,
    error.type,
    error.cause?.message,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  return (
    /(?:stream|connection|socket|network).*(?:closed|disconnect|reset|refused|terminated|timeout|timed out)/.test(text)
    || /(?:timeout|timed out|fetch failed|temporary upstream|service unavailable|too many requests|超时)/.test(text)
  );
}

export function modelTransportErrorMadeProgress(error) {
  return [
    error?.streamReceivedBytes,
    error?.receivedBytes,
    error?.receivedChars,
    error?.partialText?.length,
  ].some((value) => Number(value) > 0);
}

export function modelTransportRecoveryDelay({
  noProgressFailures,
  error,
  shortDelaysMs = DEFAULT_SHORT_DELAYS_MS,
  lowFrequencyDelayMs = DEFAULT_LOW_FREQUENCY_DELAY_MS,
  lowFrequencyAfter = DEFAULT_LOW_FREQUENCY_AFTER,
} = {}) {
  const failures = Math.max(1, Number(noProgressFailures) || 1);
  const threshold = Math.max(2, Number(lowFrequencyAfter) || DEFAULT_LOW_FREQUENCY_AFTER);
  if (failures >= threshold) {
    return {
      delayMs: rateLimitDelayMs(error, positiveDelay(lowFrequencyDelayMs, DEFAULT_LOW_FREQUENCY_DELAY_MS)),
      lowFrequency: true,
    };
  }
  const delays = normalizedDelays(shortDelaysMs);
  return {
    delayMs: rateLimitDelayMs(error, delays[Math.min(failures - 1, delays.length - 1)]),
    lowFrequency: false,
  };
}

export async function runReadOnlyModelOperationWithRecovery({
  operation,
  signal,
  onRetry,
  waitForRetry = waitForModelTransportRecovery,
  shortDelaysMs,
  lowFrequencyDelayMs,
  lowFrequencyAfter,
  maxAttempts = Number.POSITIVE_INFINITY,
} = {}) {
  if (typeof operation !== "function") throw new TypeError("operation is required");
  const attemptLimit = normalizedAttemptLimit(maxAttempts);
  let attempt = 0;
  let noProgressFailures = 0;
  for (;;) {
    throwIfAborted(signal);
    attempt += 1;
    try {
      return await operation({ attempt });
    } catch (error) {
      if (!isRetryableModelTransportError(error)) throw error;
      if (attempt >= attemptLimit) {
        if (error && typeof error === "object") {
          error.recoveryAttempts = attempt;
          error.recoveryExhausted = true;
        }
        throw error;
      }
      noProgressFailures = modelTransportErrorMadeProgress(error)
        ? 1
        : noProgressFailures + 1;
      const recovery = modelTransportRecoveryDelay({
        noProgressFailures,
        error,
        shortDelaysMs,
        lowFrequencyDelayMs,
        lowFrequencyAfter,
      });
      try {
        onRetry?.({
          attempt,
          nextAttempt: attempt + 1,
          noProgressFailures,
          error,
          ...recovery,
        });
      } catch {
        // Recovery observers cannot turn a recoverable transport failure into
        // a terminal model failure.
      }
      await waitForRetry(recovery.delayMs, signal);
    }
  }
}

function normalizedAttemptLimit(value) {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.max(1, Math.floor(number))
    : Number.POSITIVE_INFINITY;
}

export function waitForModelTransportRecovery(delayMs, signal) {
  throwIfAborted(signal);
  const delay = Math.max(0, Number(delayMs) || 0);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    timer?.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("The model operation was cancelled.", "AbortError");
}

function isAbortError(error) {
  const name = String(error?.name || "").trim().toLowerCase();
  const code = normalizedCode(error?.code);
  return name === "aborterror" || name === "cancellederror" || code === "ABORT_ERR" || code === "INVOCATION_CANCELLED";
}

function normalizedCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function normalizedDelays(values) {
  const delays = (Array.isArray(values) ? values : DEFAULT_SHORT_DELAYS_MS)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return delays.length ? delays : [...DEFAULT_SHORT_DELAYS_MS];
}

function positiveDelay(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function rateLimitDelayMs(error, fallback) {
  const retryAfterMs = Number(error?.retryAfterMs ?? error?.retry_after_ms);
  return Number.isFinite(retryAfterMs) && retryAfterMs > fallback
    ? Math.min(retryAfterMs, 15 * 60_000)
    : fallback;
}
