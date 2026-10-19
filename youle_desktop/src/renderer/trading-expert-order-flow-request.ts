export const TRADING_ORDER_FLOW_MENTION = "@策略:订单流";
export const TRADING_ORDER_FLOW_EXPERT_PROMPT_START = "<haolo_trading_order_flow_expert_prompt>";
export const TRADING_ORDER_FLOW_EXPERT_PROMPT_END = "</haolo_trading_order_flow_expert_prompt>";

export type TradingOrderFlowRequestMode = "conversation" | "chart-analysis";

export interface TradingOrderFlowRequest {
  mode: TradingOrderFlowRequestMode;
  instruction: string;
  symbol: string | null;
  interval: string | null;
  lookbackMs: number | null;
  lookbackLabel: string | null;
  drawingRequested: boolean;
}

const TRADING_ORDER_FLOW_MENTION_TOKENS = ["@策略:订单流", "@策略：订单流"] as const;

export function tradingOrderFlowMentioned(text: string) {
  const source = String(text || "");
  return TRADING_ORDER_FLOW_MENTION_TOKENS.some((token) => source.includes(token));
}

export function stripTradingOrderFlowMention(text: string) {
  let source = String(text || "");
  for (const token of TRADING_ORDER_FLOW_MENTION_TOKENS) {
    const index = source.indexOf(token);
    if (index >= 0) source = `${source.slice(0, index)}${source.slice(index + token.length)}`;
  }
  return source.trim();
}

export function buildTradingOrderFlowExpertPrompt(baseAgentText: string) {
  return baseAgentText;
}
