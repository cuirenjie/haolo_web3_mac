export const TRADING_ALERT_FEATURE_FLAG = "HAOLO_TRADING_ALERTS_ENABLED";
export const TRADING_ALERT_SHADOW_FLAG = "HAOLO_TRADING_ALERTS_SHADOW";

export function parseTradingAlertFeatureFlag(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

export function tradingAlertsEnabled(env = process.env) {
  return parseTradingAlertFeatureFlag(env?.[TRADING_ALERT_FEATURE_FLAG]);
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
    reason: enabled ? "enabled_by_environment" : "disabled_by_default",
  });
}
