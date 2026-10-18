export const TRADING_WAVE_MENTION = "@策略:波浪理论";
export const TRADING_WAVE_EXPERT_PROMPT_START = "<haolo_trading_wave_expert_prompt>";
export const TRADING_WAVE_EXPERT_PROMPT_END = "</haolo_trading_wave_expert_prompt>";

export type TradingWaveRequestMode = "conversation" | "chart-analysis";

export interface TradingWaveRequest {
  mode: TradingWaveRequestMode;
  instruction: string;
  symbol: string | null;
  interval: string | null;
  lookbackMs: number | null;
  lookbackLabel: string | null;
  drawingRequested: boolean;
}

const TRADING_WAVE_MENTION_TOKENS = [
  "@策略:波浪理论",
  "@策略：波浪理论",
  "@策略:波浪",
  "@策略：波浪",
] as const;

export function tradingWaveMentioned(text: string) {
  const source = String(text || "");
  return TRADING_WAVE_MENTION_TOKENS.some((token) => source.includes(token));
}

export function stripTradingWaveMention(text: string) {
  let source = String(text || "");
  for (const token of TRADING_WAVE_MENTION_TOKENS) {
    source = source.split(token).join("");
  }
  return source.trim();
}

export function buildTradingWaveExpertPrompt(baseAgentText: string) {
  return baseAgentText;
}
