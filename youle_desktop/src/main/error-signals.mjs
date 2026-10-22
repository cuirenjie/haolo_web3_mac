// Use only at an error boundary. Successful report text is never an error signal.
// Keep protocol fields separate from arbitrary payloads (prices, text, items,
// response bodies, stack traces). In particular, a bare number is not HTTP.
const STATUS_KEYS = ["status", "statusCode", "status_code", "httpStatus", "httpStatusCode", "http_status_code", "code", "errorCode", "error_code"];
const ERROR_KEYS = [
  "message", "reason", "detail", "details", "additionalDetails", "additional_details",
  "code", "errorCode", "error_code", "category", "errorClass", "name", "type",
  "statusText", "status_text", "error", "lastError", "last_error", "errorMessage", "error_message",
  "cause", "response", "codexErrorInfo", "codex_error_info",
  "responseStreamDisconnected", "response_stream_disconnected", "httpConnectionFailed", "http_connection_failed",
];

export function errorSignals(error) {
  const texts = new Set(), statuses = new Set(), seen = new Set();
  let retryable;
  const visit = (value, depth = 0) => {
    if (value == null || depth > 6) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return;
      if (text.length < 32_000 && text.startsWith("{")) {
        try { visit(JSON.parse(text), depth + 1); return; } catch { /* Plain error message. */ }
      }
      texts.add(text);
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (value.retryable === false) retryable = false;
    else if (value.retryable === true && retryable !== false) retryable = true;
    for (const key of STATUS_KEYS) {
      const raw = value[key];
      if ((typeof raw === "number" && Number.isInteger(raw))
        || (typeof raw === "string" && /^[45]\d{2}$/.test(raw.trim()))) {
        const status = Number(raw);
        if (status >= 400 && status <= 599) statuses.add(status);
      }
    }
    for (const key of ERROR_KEYS) visit(value[key], depth + 1);
  };
  visit(error);
  for (const text of texts) {
    // Preserve legacy serialized transport failures, but never match 1,402.66,
    // HTTP 402.66, status 402,000, or a numeric fragment of a longer token.
    for (const match of text.matchAll(/\b(?:HTTP(?:\/\d(?:\.\d)?)?(?:\s+status(?:\s+code)?)?|(?:unexpected\s+)?status(?:[\s_-]+code)?|MODEL_HTTP_)\s*[:=]?\s*([45]\d{2})(?![\w]|[.,]\d)/gi)) {
      statuses.add(Number(match[1]));
    }
  }
  return { detail: [...texts].join(" "), statuses: [...statuses], retryable };
}

export function isMembershipFailure(error) {
  const { detail } = errorSignals(error);
  return /TRIAL_REQUIRED|MEMBERSHIP_EXPIRED|MODEL_MEMBERSHIP_REQUIRED|membership[_\s-]*(?:required|expired)|未开通有效.*(?:体验版|套餐)|会员(?:等级|权益)?不足|会员(?:已)?(?:到期|过期)|會員(?:等級|權益)?不足|會員(?:已)?(?:到期|過期)/iu.test(detail);
}

export function isQuotaFailure(error) {
  // A model-tier or membership denial is not proof of an empty wallet.
  if (isMembershipFailure(error)) return false;
  const { detail, statuses } = errorSignals(error);
  return statuses.includes(402)
    || /(?:TRIAL_REQUIRED|MEMBERSHIP_EXPIRED|ANALYSIS_CREDITS_REQUIRED|积分不足|積分不足|当前套餐或积分不可用|未开通有效.*(?:体验版|套餐)|会员(?:等级|权益)?不足|会员(?:已)?(?:到期|过期)|會員(?:已)?(?:到期|過期)|会员权益不可用|请先开通体验版|开通体验版或其他套餐|当前没有可用积分|您的额度不足|额度不足|余额不足|没有余额|无可用额度|可用额度为\s*0|Token\s*余额不足|充值\s*Token|insufficient[_\s-]*(?:quota|balance|credits?|funds?|tokens?)|not enough[_\s-]*(?:quota|balance|credits?|funds?|tokens?)|out of[_\s-]*(?:quota|credits?|funds?|tokens?)|no[_\s-]*(?:quota|credits?|funds?|tokens?)|payment required|quota[_\s-]*exceeded|billing[_\s-]*(?:required|quota|limit))/iu.test(detail);
}
