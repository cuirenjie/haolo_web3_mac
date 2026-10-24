export const BINANCE_REBIND_MESSAGE = "API Key 无效，请重新绑定";

const BINDING_ERROR_MESSAGES = Object.freeze({
  READ_ONLY_KEY_REQUIRED: "API 权限不符合只读要求。请开启读取权限，关闭交易、提现和划转权限后重新绑定。",
  CONNECTION_REVOKED: "此 Binance 连接已解绑，请关闭窗口后重新绑定。",
  ACCOUNT_CREDENTIALS_NOT_BOUND: "尚未完成 Binance API 绑定，请重新绑定。",
  CONNECTION_LIMIT: "已达到账户连接数量上限，请解除不用的连接后重试。",
  DEVICE_LIMIT: "已达到设备数量上限，请移除不用的设备后重试。",
  IDEMPOTENCY_CONFLICT: "本次请求与之前的操作冲突，请关闭窗口后重试。",
});

export function binanceBindingErrorMessage(code) {
  return Object.hasOwn(BINDING_ERROR_MESSAGES, code) ? BINDING_ERROR_MESSAGES[code] : null;
}

export function isBinanceCredentialError(error) {
  return ["BINANCE_CREDENTIALS_INVALID", "BINANCE_AUTH_FAILED", "BINANCE_SIGNATURE_INVALID"]
    .includes(error?.code);
}

// Electron invoke errors discard custom properties. Send only this public
// recovery contract, never the HTTP payload, signed URL or credentials.
export function binanceCredentialErrorResult(error) {
  if (!isBinanceCredentialError(error)) return null;
  return {
    ok: false,
    error: { code: "BINANCE_CREDENTIALS_INVALID", message: BINANCE_REBIND_MESSAGE, retryable: false },
  };
}

// Electron otherwise strips status/retry-after from thrown IPC exceptions.
export function binanceAccountReadErrorResult(error) {
  const rateLimited = [429, 418].includes(Number(error?.status))
    || ["BINANCE_BUDGET_DEFERRED", "BINANCE_RATE_LIMITED"].includes(error?.code);
  return binanceCredentialErrorResult(error) || {
    ok: false,
    error: {
      code: String(error?.code || "BINANCE_REQUEST_FAILED"),
      message: rateLimited ? (error?.code === "BINANCE_RATE_LIMITED"
        ? "币安暂时限制请求，稍后自动重试。" : "账户数据请求繁忙，稍后自动重试。")
        : String(error?.message || "账户数据读取失败，请重试。"),
      scope: "binance_account",
      status: Number(error?.status) || 0,
      retryable: error?.retryable !== false,
      ...(Number(error?.retryAfterMs) > 0 ? { retryAfterMs: Number(error.retryAfterMs) } : {}),
    },
  };
}
