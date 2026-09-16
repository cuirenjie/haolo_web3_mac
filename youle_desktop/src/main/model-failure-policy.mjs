// The runtime sometimes wraps HTTP denials as responseStreamDisconnected or
// httpConnectionFailed. Retain the original terminal decision through wrappers.
export function modelFailureFacts(error) {
  const texts = [], statuses = [], seen = new Set();
  let retryable;
  const visit = (value, depth = 0) => {
    if (value == null || depth > 6 || seen.has(value)) return;
    if (typeof value === "string") {
      texts.push(value);
      if (value.length < 32_000 && value.trim().startsWith("{")) {
        try { visit(JSON.parse(value), depth + 1); } catch { /* Ordinary error text. */ }
      }
      return;
    }
    if (typeof value !== "object") return;
    seen.add(value);
    if (value.retryable === false) retryable = false;
    else if (value.retryable === true && retryable !== false) retryable = true;
    for (const key of ["status", "statusCode", "status_code", "httpStatus", "httpStatusCode", "http_status_code"]) {
      const status = Number(value[key]);
      if (status >= 400 && status <= 599) statuses.push(status);
    }
    for (const key of ["message", "detail", "additionalDetails", "additional_details", "code", "errorCode", "category", "errorClass", "name", "type", "error", "cause", "response", "codexErrorInfo", "codex_error_info", "responseStreamDisconnected", "response_stream_disconnected", "httpConnectionFailed", "http_connection_failed"]) visit(value[key], depth + 1);
  };
  visit(error);
  const detail = texts.join(" ");
  for (const match of detail.matchAll(/(?:HTTP(?:\/\d(?:\.\d)?)?|(?:unexpected\s+)?status(?:\s+code)?)\s*[:=]?\s*([45]\d{2})\b/gi)) statuses.push(Number(match[1]));
  const terminalStatus = statuses.find((s) => s < 500 && ![408, 425, 429].includes(s));
  const httpStatus = terminalStatus || statuses[0] || null;
  const hardFailure = Boolean(terminalStatus)
    || /PERMISSION_DENIED|MODEL_(?:NOT_ENABLED|RETIRED)|TRIAL_REQUIRED|ACCOUNT_ID_REQUIRED|CLEANUP_INCOMPLETE|unauthori[sz]ed|forbidden|auth(?:entication)?[_ ](?:failed|expired)|invalid.api.key|not enabled for|权限|鉴权|余额不足/i.test(detail);
  return { httpStatus, retryable, hardFailure, detail };
}
