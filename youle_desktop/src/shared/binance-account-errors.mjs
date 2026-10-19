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
