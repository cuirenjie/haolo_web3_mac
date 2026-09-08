export const DEFAULT_TRADING_ANALYSIS_INTERVAL = "60";

export function explicitTradingAnalysisMarketType(instruction) {
  const source = String(instruction || "");
  if (/(?:现货|spot)/iu.test(source) && !/(?:永续|合约|期货|perpetual|futures?)/iu.test(source)) {
    return "spot";
  }
  return "perpetual";
}

/**
 * User-specified symbols do not inherit the provider/type of the currently
 * visible chart. Binance perpetual is the stable default and an explicit spot
 * request is respected. An unavailable requested Binance market returns null
 * so the caller cannot silently analyze a different symbol or venue.
 */
export function selectTradingAnalysisMarket(markets, params = {}) {
  const candidates = Array.isArray(markets) ? markets : [];
  const symbol = String(params.symbol || "").trim().toUpperCase();
  const currentMarket = params.currentMarket || null;
  if (!params.explicitSymbol) return currentMarket;
  if (!symbol) return currentMarket;

  const marketType = params.forcePerpetual
    ? "perpetual"
    : explicitTradingAnalysisMarketType(params.instruction);
  const symbolMarkets = candidates.filter((market) => (
    String(market?.symbol || "").trim().toUpperCase() === symbol
  ));
  const requestedBinanceMarket = symbolMarkets.find((market) => (
    market?.provider === "binance" && market?.marketType === marketType
  ));
  if (requestedBinanceMarket) return requestedBinanceMarket;
  return null;
}

export function selectTradingAnalysisInterval(params = {}) {
  const requestedInterval = String(params.interval || "").trim().toUpperCase();
  if (requestedInterval) return requestedInterval;
  // An explicitly named market is a complete target in its own right. Do not
  // inherit an unrelated chart interval (for example the BTC 1D chart) when
  // the user asks to review `SKHYNIX` without writing a period. Binance
  // perpetual 1H is the stable default for this case.
  if (params.explicitSymbol) return DEFAULT_TRADING_ANALYSIS_INTERVAL;
  return String(params.currentInterval || DEFAULT_TRADING_ANALYSIS_INTERVAL).trim().toUpperCase();
}
