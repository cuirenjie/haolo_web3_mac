export const BINANCE_REBIND_MESSAGE = "API Key 无效，请重新绑定";

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
  return binanceCredentialErrorResult(error) || {
    ok: false,
    error: {
      code: String(error?.code || "BINANCE_REQUEST_FAILED"),
      message: String(error?.message || "账户数据读取失败，请重试。"),
      status: Number(error?.status) || 0,
      retryable: error?.retryable !== false,
      ...(Number(error?.retryAfterMs) > 0 ? { retryAfterMs: Number(error.retryAfterMs) } : {}),
    },
  };
}
