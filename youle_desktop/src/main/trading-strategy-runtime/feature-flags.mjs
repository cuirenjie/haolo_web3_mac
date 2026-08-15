export const TRADING_STRATEGY_RUNTIME_MODES = Object.freeze(["legacy", "v1", "shadow"]);
export const DEFAULT_TRADING_STRATEGY_RUNTIME_MODE = "v1";

function normalizedList(value) {
  return new Set(String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean));
}

export function tradingStrategyRuntimeMode(environment = process.env) {
  const value = String(environment?.HAOLO_TRADING_STRATEGY_RUNTIME_MODE || "")
    .trim()
    .toLowerCase();
  return TRADING_STRATEGY_RUNTIME_MODES.includes(value)
    ? value
    : DEFAULT_TRADING_STRATEGY_RUNTIME_MODE;
}

export function disabledTradingStrategyIds(environment = process.env) {
  return normalizedList(environment?.HAOLO_DISABLED_TRADING_STRATEGIES);
}

export function tradingStrategyRuntimeEnabled(strategyId, environment = process.env) {
  const id = String(strategyId || "").trim().toLowerCase();
  if (!id) return false;
  if (tradingStrategyRuntimeMode(environment) === "legacy") return false;
  return !disabledTradingStrategyIds(environment).has(id);
}

export function tradingStrategyShadowMode(strategyId, environment = process.env) {
  return tradingStrategyRuntimeMode(environment) === "shadow"
    && tradingStrategyRuntimeEnabled(strategyId, environment);
}

export function tradingStrategyRuntimeStatus(environment = process.env) {
  const mode = tradingStrategyRuntimeMode(environment);
  const disabled = disabledTradingStrategyIds(environment);
  return Object.freeze({
    mode,
    enabled: mode !== "legacy",
    shadow: mode === "shadow",
    disabledStrategyIds: Object.freeze([...disabled].sort()),
  });
}
