export const TRADING_EXPERT_DEFAULT_MODEL_VALUE = "gpt-5.6-sol";
export const TRADING_EXPERT_REASONING_EFFORT = "ultra";

export const TRADING_EXPERT_MODEL_VALUES = [
  TRADING_EXPERT_DEFAULT_MODEL_VALUE,
] as const;

const TRADING_EXPERT_MODEL_VALUE_SET = new Set<string>(
  TRADING_EXPERT_MODEL_VALUES,
);

export function isTradingExpertModelValue(value: unknown) {
  return TRADING_EXPERT_MODEL_VALUE_SET.has(
    String(value ?? "").trim().toLowerCase(),
  );
}

export function tradingExpertModelOptions<T extends { value: unknown }>(
  options: readonly T[],
): T[] {
  return options.filter((option) => isTradingExpertModelValue(option.value));
}

export function defaultTradingExpertModelOption<T extends { value: unknown }>(
  options: readonly T[],
): T | null {
  const available = tradingExpertModelOptions(options);
  return (
    available.find(
      (option) =>
        String(option.value).trim().toLowerCase() ===
        TRADING_EXPERT_DEFAULT_MODEL_VALUE,
    ) ||
    available[0] ||
    null
  );
}
