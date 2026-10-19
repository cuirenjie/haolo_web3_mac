// Effective product defaults are available without onboarding or a memory write.
// They must never be attributed to an explicit choice made by the user.
export const DEFAULT_TRADING_PREFERENCE_ENTRIES = Object.freeze([
  ["trading.risk", "constraint", "max_loss_per_trade_percent", 2, "hard"],
  ["trading.risk", "constraint", "loss_calculation_basis", "按当前账户净值计算止损触发后的实际亏损，包含手续费和预估滑点，不按保证金比例计算", "hard"],
  ["trading.risk", "constraint", "minimum_risk_reward_ratio", 0.4, "hard"],
  ["trading.exit", "preference", "move_stop_to_break_even", true, "normal"],
  ["trading.exit", "preference", "break_even_trigger_r", 1, "normal"],
  ["communication", "preference", "trading_analysis_style", "concise", "normal"],
  ["trading.analysis", "preference", "required_analysis_sections", "仓位健康度、风险校验、关键价位、入场条件、止损、止盈、仓位大小和失效条件", "normal"],
  ["trading.discipline", "constraint", "default_execution_discipline", "先确定止损和失效条件再计算仓位；不得通过随意缩小止损距离放大仓位；不默认使用马丁格尔或亏损加仓；亏损后可以继续寻找新机会，但不得为了回本提高风险或降低交易标准", "hard"],
  ["trading.behavior", "preference", "risk_conflict_handling", "明确提示规则冲突和风险，并提供符合已保存风险规则的备选方案", "normal"],
].map(([scope, kind, key, value, strength]) => Object.freeze({
  id: `default:${scope}.${key}`, scope, kind, key, value, strength,
  source: "product_default", createdAt: null, updatedAt: null,
})));

export function withTradingPreferenceDefaults(values) {
  const entries = Array.isArray(values) ? values : [];
  // Legacy `trading` keys are still recognized by the profile reader. Adding a
  // canonical default before those are resolved would mask a saved preference.
  const missing = DEFAULT_TRADING_PREFERENCE_ENTRIES.filter(defaultEntry => !entries.some(entry => (
    entry.key === defaultEntry.key && (entry.scope === defaultEntry.scope || entry.scope === "trading")
  )));
  return [...missing, ...entries];
}
