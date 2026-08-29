export type TradingMarketIdentityProvider = "binance" | "finnhub" | "ifind";
export type TradingMarketAssetClass = "crypto" | "commodity" | "etf" | "stock" | "preipo" | "index" | "forex" | "a-share";

const BINANCE_ASSET_LOGO_URL = "https://bin.bnbstatic.com/static/assets/logos";
const HYPERLIQUID_ASSET_LOGO_URL = "https://app.hyperliquid.xyz/coins";
const TRADFI_ASSET_CLASSES = new Set<TradingMarketAssetClass>([
  "commodity",
  "etf",
  "stock",
  "preipo",
  "index",
  "forex",
  "a-share",
]);

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

function normalizeAssetClass(value: unknown): TradingMarketAssetClass | null {
  const normalized = String(value || "").trim().toLowerCase() as TradingMarketAssetClass;
  return normalized === "crypto" || TRADFI_ASSET_CLASSES.has(normalized) ? normalized : null;
}

function firstAssetGlyph(displayName: string, asset: string) {
  const label = String(displayName || "").trim();
  const first = Array.from(label).find((character) => /[\p{L}\p{N}]/u.test(character));
  return first || asset.trim().toUpperCase().slice(0, 1) || "A";
}

function inferredTradFiAssetClass(asset: string, assetClass: unknown) {
  const normalized = asset.trim().toUpperCase();
  if (normalized === "XAU" || normalized === "XAG" || normalized === "XAUT") return "commodity" as const;
  if (normalized === "OPENAI" || normalized === "ANTHROPIC") return "preipo" as const;
  const explicit = normalizeAssetClass(assetClass);
  if (explicit && explicit !== "crypto") return explicit;
  return null;
}

function renderTradFiAssetMark(asset: string, assetClass: Exclude<TradingMarketAssetClass, "crypto">) {
  const normalizedAsset = asset.trim().toUpperCase();
  const glyph = normalizedAsset === "SNDK" || normalizedAsset === "SNDKB"
    ? "S"
    : normalizedAsset === "XAU" || normalizedAsset === "XAUT"
    ? "Au"
    : normalizedAsset === "XAG"
      ? "Ag"
      : normalizedAsset.slice(0, 2) || "TF";
  const icon = assetClass === "commodity"
    ? `<path d="M5 10h14l-2 3H7zM4 14h16l-2 4H6z"/><path d="M8 7h8"/>`
    : assetClass === "preipo"
      ? `<path d="m12 4 4 5-2 9H10L8 9z"/><path d="m9 13-3 3m9-3 3 3"/>`
      : assetClass === "forex"
        ? `<path d="M5 8h12l-3-3m5 11H7l3 3"/>`
        : `<path d="M4 17 9 12l3 2 5-7 3 2"/><circle cx="9" cy="12" r="1"/><circle cx="17" cy="7" r="1"/>`;
  const symbolClass = normalizedAsset.replace(/[^A-Z0-9_-]/g, "").toLowerCase();
  return `<span class="trading-market-asset-mark asset-class-${assetClass} asset-symbol-${symbolClass}" data-market-logo-local="${assetClass}" data-market-logo-glyph="${escapeAttribute(glyph)}">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>
    <b>${escapeAttribute(glyph)}</b>
  </span>`;
}

function renderAShareAssetMark(asset: string, displayName: string) {
  const glyph = firstAssetGlyph(displayName, asset);
  return `<span class="trading-market-asset-mark asset-class-a-share" data-market-logo-local="a-share" data-market-logo-glyph="${escapeAttribute(glyph)}">
    <b>${escapeAttribute(glyph)}</b>
  </span>`;
}

export function renderTradingMarketAssetLogo(
  asset: string,
  provider: TradingMarketIdentityProvider = "binance",
  current = false,
  assetClass?: string,
  displayName = "",
) {
  const normalizedAsset = asset.trim().toUpperCase();
  const normalizedAssetClass = normalizeAssetClass(assetClass);
  const isAShare = provider === "ifind" || normalizedAssetClass === "a-share";
  const tradFiAssetClass = !isAShare && provider === "binance"
    ? inferredTradFiAssetClass(normalizedAsset, assetClass)
    : null;
  return `
    <span class="trading-market-asset-logo provider-${provider}${isAShare ? " asset-class-a-share" : ""}${current ? " current" : ""}" data-market-logo-shell aria-hidden="true">
      ${isAShare
        ? renderAShareAssetMark(normalizedAsset, displayName)
        : tradFiAssetClass
        ? renderTradFiAssetMark(normalizedAsset, tradFiAssetClass)
        : `<span data-market-logo-fallback>${escapeAttribute(tradingMarketAssetBadge(normalizedAsset))}</span>`}
      ${provider === "binance" && !tradFiAssetClass ? `<img
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
