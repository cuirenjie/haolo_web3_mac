import {
  DEEPSEEK_EXECUTION_MODEL_VALUE,
  FIXED_CHAT_MODEL_OPTIONS,
} from "./chat-model-catalog.ts";

export const TRADING_EXPERT_DEFAULT_MODEL_VALUE = "gpt-5.6-sol";
export const TRADING_EXPERT_REASONING_EFFORT = "max";
export const TRADING_EXPERT_DEEPSEEK_REASONING_EFFORT = "max";

export const TRADING_EXPERT_MODEL_VALUES = [
  TRADING_EXPERT_DEFAULT_MODEL_VALUE,
  "gpt-6-sol",
  "gpt-6-astra",
] as const;

const TRADING_EXPERT_RUNTIME_MODEL_VALUE_SET = new Set<string>([
  ...TRADING_EXPERT_MODEL_VALUES,
  DEEPSEEK_EXECUTION_MODEL_VALUE,
]);

export function isTradingExpertModelValue(value: unknown) {
  return TRADING_EXPERT_RUNTIME_MODEL_VALUE_SET.has(
    String(value ?? "").trim().toLowerCase(),
  );
}

export function tradingExpertModelOptions<T extends { value: unknown }>(
  options: readonly T[],
): T[] {
  const optionsByValue = new Map(
    options.map((option) => [String(option.value ?? "").trim().toLowerCase(), option]),
  );
  const curatedOptions = new Map(
    FIXED_CHAT_MODEL_OPTIONS.map((option) => [option.value.toLowerCase(), option as unknown as T]),
  );
  return TRADING_EXPERT_MODEL_VALUES.map((value) => {
    const curated = curatedOptions.get(value);
    const available = optionsByValue.get(value);
    if (!curated) return available;
    const curatedOption = curated as unknown as (typeof FIXED_CHAT_MODEL_OPTIONS)[number];
    // The Trading Expert picker has a stable, deliberate three-model contract.
    // Keep backend credential/price metadata when present, while preventing a
    // server catalog's stale label or reasoning default from changing the UI.
    return available
      ? {
        ...curatedOption,
        ...available,
        value: curatedOption.value,
        label: curatedOption.label,
        isDefault: curatedOption.isDefault,
        defaultReasoningEffort: "max",
        reasoningEfforts: curatedOption.reasoningEfforts,
      }
      : curated;
  })
    .filter((option): option is T => Boolean(option));
}

export function tradingExpertReasoningEffort(model: unknown) {
  return TRADING_EXPERT_REASONING_EFFORT;
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
