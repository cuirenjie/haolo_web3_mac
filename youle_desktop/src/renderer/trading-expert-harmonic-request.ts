export const TRADING_HARMONIC_MENTION = "@策略:谐波形态";
export const TRADING_HARMONIC_EXPERT_PROMPT_START = "<haolo_trading_harmonic_expert_prompt>";
export const TRADING_HARMONIC_EXPERT_PROMPT_END = "</haolo_trading_harmonic_expert_prompt>";

const TRADING_HARMONIC_MENTION_TOKENS = [
  "@策略:谐波形态",
  "@策略：谐波形态",
  "@策略:谐波",
  "@策略：谐波",
] as const;

export function stripTradingHarmonicMention(text: string) {
  let source = String(text || "");
  for (const token of TRADING_HARMONIC_MENTION_TOKENS) source = source.split(token).join("");
  return source.trim();
}

export function buildTradingHarmonicExpertPrompt(baseAgentText: string) {
  return baseAgentText;
}
