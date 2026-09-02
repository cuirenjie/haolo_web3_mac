export const DEFAULT_TRADING_ANALYSIS_INTERVAL: "60";

export type TradingAnalysisMarketType = "perpetual" | "spot";

export interface TradingAnalysisTargetMarket {
  provider?: string;
  symbol?: string;
  marketType?: string;
}

export function explicitTradingAnalysisMarketType(instruction: unknown): TradingAnalysisMarketType;

export function selectTradingAnalysisMarket<T extends TradingAnalysisTargetMarket>(
  markets: ReadonlyArray<T>,
  params?: {
    symbol?: unknown;
    currentMarket?: T | null;
    explicitSymbol?: boolean;
    instruction?: unknown;
    forcePerpetual?: boolean;
  },
): T | null;

export function selectTradingAnalysisInterval(params?: {
  interval?: unknown;
  currentInterval?: unknown;
  explicitSymbol?: boolean;
}): string;
