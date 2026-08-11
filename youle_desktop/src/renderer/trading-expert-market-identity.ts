export type TradingMarketIdentityProvider = "binance" | "finnhub" | "ifind";

const BINANCE_ASSET_LOGO_URL = "https://bin.bnbstatic.com/static/assets/logos";
const HYPERLIQUID_ASSET_LOGO_URL = "https://app.hyperliquid.xyz/coins";

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function tradingMarketAssetBadge(symbol: string) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (normalizedSymbol === "BTC") return "₿";
  return normalizedSymbol.slice(0, 2);
}

export function binanceTradingMarketAssetLogoUrl(asset: string) {
  return `${BINANCE_ASSET_LOGO_URL}/${encodeURIComponent(asset.trim().toUpperCase())}.png`;
}

export function hyperliquidTradingMarketAssetLogoUrl(asset: string) {
  return `${HYPERLIQUID_ASSET_LOGO_URL}/${encodeURIComponent(asset.trim().toUpperCase())}.svg`;
}

export function renderTradingMarketAssetLogo(
  asset: string,
  provider: TradingMarketIdentityProvider = "binance",
  current = false,
) {
  const normalizedAsset = asset.trim().toUpperCase();
  return `
    <span class="trading-market-asset-logo provider-${provider}${current ? " current" : ""}" data-market-logo-shell aria-hidden="true">
      <span data-market-logo-fallback>${escapeAttribute(tradingMarketAssetBadge(normalizedAsset))}</span>
      ${provider === "binance" ? `<img
        src="${escapeAttribute(binanceTradingMarketAssetLogoUrl(normalizedAsset))}"
        alt=""
        loading="${current ? "eager" : "lazy"}"
        decoding="async"
        referrerpolicy="no-referrer"
        data-market-logo
        data-market-logo-asset="${escapeAttribute(normalizedAsset)}"
        data-market-logo-stage="binance"
      />` : ""}
    </span>
  `;
}
