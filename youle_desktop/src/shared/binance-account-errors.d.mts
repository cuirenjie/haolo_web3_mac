export const BINANCE_REBIND_MESSAGE: string;
export function isBinanceCredentialError(error: unknown): boolean;
export function binanceCredentialErrorResult(error: unknown): {
  ok: false;
  error: { code: string; message: string; retryable: false };
} | null;
