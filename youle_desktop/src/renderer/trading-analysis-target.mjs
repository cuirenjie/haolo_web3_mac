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
 * visible chart. Binance perpetual is the stable default; an explicit spot
 * request is respected, while non-Binance markets remain a compatibility
 * fallback when no matching Binance contract exists.
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
  const requestedMarket = symbolMarkets.find((market) => market?.marketType === marketType);
  if (requestedMarket) return requestedMarket;
  if (marketType === "spot") return currentMarket;

  return symbolMarkets.find((market) => market?.provider === currentMarket?.provider)
    || symbolMarkets[0]
    // A syntactically plausible but unavailable market must never terminate
    // the turn. Fall back to the chart captured at send time; the result uses
    // that market's real identity and cannot masquerade as the requested one.
    || currentMarket
    || null;
}

export function selectTradingAnalysisInterval(params = {}) {
  const requestedInterval = String(params.interval || "").trim().toUpperCase();
  if (requestedInterval) return requestedInterval;
  return String(params.currentInterval || DEFAULT_TRADING_ANALYSIS_INTERVAL).trim().toUpperCase();
}
