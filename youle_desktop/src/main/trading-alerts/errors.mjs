import { ALERT_ERROR_CATEGORIES } from "./protocol.mjs";

const CATEGORIES = new Set(ALERT_ERROR_CATEGORIES);

export class TradingAlertError extends Error {
  constructor(message, {
    code = "TRADING_ALERT_FAILED",
    category = "evaluation",
    retryable = false,
    details = null,
    cause,
  } = {}) {
    super(String(message || "Trading alert failed"), cause ? { cause } : undefined);
    this.name = "TradingAlertError";
    this.code = String(code || "TRADING_ALERT_FAILED");
    this.category = CATEGORIES.has(category) ? category : "evaluation";
    this.retryable = Boolean(retryable);
    this.details = details && typeof details === "object" ? structuredClone(details) : null;
  }
}

export function tradingAlertErrorEnvelope(error, fallback = {}) {
  const category = CATEGORIES.has(error?.category) ? error.category : (CATEGORIES.has(fallback.category) ? fallback.category : "evaluation");
  return Object.freeze({
    code: String(error?.code || fallback.code || "TRADING_ALERT_FAILED"),
    category,
    message: String(error?.message || fallback.message || "Trading alert failed").slice(0, 1_000),
    retryable: Boolean(error?.retryable ?? fallback.retryable),
    details: error?.details && typeof error.details === "object" ? structuredClone(error.details) : null,
  });
}

export function assertTradingAlert(condition, message, options) {
  if (!condition) throw new TradingAlertError(message, options);
}

