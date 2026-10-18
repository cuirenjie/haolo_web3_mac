export const TRADING_CHAN_MENTION = "@策略:缠论";
export const TRADING_CHAN_EXPERT_PROMPT_START = "<haolo_trading_chan_expert_prompt>";
export const TRADING_CHAN_EXPERT_PROMPT_END = "</haolo_trading_chan_expert_prompt>";

export type TradingChanRequestMode = "conversation" | "chart-analysis";

export interface TradingChanRequest {
  mode: TradingChanRequestMode;
  instruction: string;
  symbol: string | null;
  interval: string | null;
  lookbackMs: number | null;
  lookbackLabel: string | null;
  drawingRequested: boolean;
}

const TRADING_CHAN_MENTION_TOKENS = ["@策略:缠论", "@策略：缠论"] as const;

export function tradingChanMentioned(text: string) {
  const source = String(text || "");
  return TRADING_CHAN_MENTION_TOKENS.some((token) => source.includes(token));
}

export function stripTradingChanMention(text: string) {
  let source = String(text || "");
  for (const token of TRADING_CHAN_MENTION_TOKENS) {
    const index = source.indexOf(token);
    if (index >= 0) source = `${source.slice(0, index)}${source.slice(index + token.length)}`;
  }
  return source.trim();
}

export function buildTradingChanExpertPrompt(baseAgentText: string) {
  return baseAgentText;
}
