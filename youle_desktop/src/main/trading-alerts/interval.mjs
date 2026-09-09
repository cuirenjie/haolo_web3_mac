// Calendar intervals are not implemented by the alert scheduler/adapter yet.
// Check before lowercasing: Binance's M means month, m means minute.
export function normalizeTradingAlertInterval(value) {
  const interval = String(value ?? "").trim();
  if (/^\d+(?:M|[yY])$/.test(interval)) {
    // Keep this leaf module independent from errors.mjs (which imports the
    // protocol). The error envelope accepts these structured fields.
    throw Object.assign(new TypeError("暂不支持月线或年线预警，请选择分钟、小时、日或周周期。"), {
      code: "TRADING_ALERT_INTERVAL_UNSUPPORTED", category: "validation",
    });
  }
  return interval.toLowerCase();
}
