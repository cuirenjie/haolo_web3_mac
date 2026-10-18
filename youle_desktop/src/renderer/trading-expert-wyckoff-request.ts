export const TRADING_WYCKOFF_MENTION = "@策略:威科夫";
export const TRADING_WYCKOFF_EXPERT_PROMPT_START = "<haolo_trading_wyckoff_expert_prompt>";
export const TRADING_WYCKOFF_EXPERT_PROMPT_END = "</haolo_trading_wyckoff_expert_prompt>";

export type TradingWyckoffRequestMode = "conversation" | "chart-analysis";

export interface TradingWyckoffRequest {
  mode: TradingWyckoffRequestMode;
  instruction: string;
  symbol: string | null;
  interval: string | null;
  lookbackMs: number | null;
  lookbackLabel: string | null;
  drawingRequested: boolean;
}

const TRADING_WYCKOFF_MENTION_TOKENS = [
  "@策略:威科夫",
  "@策略：威科夫",
  "@策略:Wyckoff",
  "@策略：Wyckoff",
] as const;

export function tradingWyckoffMentioned(text: string) {
  const source = String(text || "");
  return TRADING_WYCKOFF_MENTION_TOKENS.some((token) => source.includes(token));
}

export function stripTradingWyckoffMention(text: string) {
  let source = String(text || "");
  for (const token of TRADING_WYCKOFF_MENTION_TOKENS) source = source.split(token).join("");
  return source.trim();
}

export function buildTradingWyckoffExpertPrompt(baseAgentText: string) {
  return baseAgentText;
}
