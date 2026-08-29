export const TRADING_ALERT_FEATURE_FLAG = "HAOLO_TRADING_ALERTS_ENABLED";
export const TRADING_ALERT_SHADOW_FLAG = "HAOLO_TRADING_ALERTS_SHADOW";

export function parseTradingAlertFeatureFlag(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

export function tradingAlertsEnabled(env = process.env) {
  const configured = env?.[TRADING_ALERT_FEATURE_FLAG];
  // Trading alerts are a normal desktop capability. Keep an explicit kill
  // switch for incident response, but do not make ordinary users opt in via an
  // environment variable before a confirmed alert can be persisted and armed.
  return configured === undefined || configured === null || String(configured).trim() === ""
    ? true
    : parseTradingAlertFeatureFlag(configured);
}

export function tradingAlertsShadowMode(env = process.env) {
  return parseTradingAlertFeatureFlag(env?.[TRADING_ALERT_SHADOW_FLAG]);
}

export function tradingAlertFeatureState(env = process.env) {
  const enabled = tradingAlertsEnabled(env);
  return Object.freeze({
    flag: TRADING_ALERT_FEATURE_FLAG,
    enabled,
    shadowMode: tradingAlertsShadowMode(env),
    reason: enabled
      ? (env?.[TRADING_ALERT_FEATURE_FLAG] == null ? "enabled_by_default" : "enabled_by_environment")
      : "disabled_by_environment",
  });
}
