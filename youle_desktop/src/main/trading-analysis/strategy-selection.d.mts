export interface TradingStrategySelectionEntry {
  id?: string;
  enabled?: boolean;
  display?: { name?: string };
  mentions?: { canonical?: string; aliases?: readonly string[] };
}

export function resolveExplicitTradingStrategyId(
  text: string,
  strategies?: readonly TradingStrategySelectionEntry[],
): string | null;

export function resolveExplicitTradingStrategyIds(
  text: string,
  strategies?: readonly TradingStrategySelectionEntry[],
): string[];
