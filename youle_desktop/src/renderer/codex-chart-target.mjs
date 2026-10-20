import { resolveTradingMarketAlias } from "../shared/trading-market-aliases.mjs";

// Normalize explicit tool parameters only. Codex owns natural-language intent.
export function resolveCodexChartTarget(args = {}, current = null, { reuseOpenedInterval = false } = {}) {
  let marketId = String(args.marketId || "").trim();
  let symbol = resolveTradingMarketAlias(args.symbol) || String(args.symbol || "").trim().toUpperCase().replace(/[/_-]/g, "");
  if (symbol && !/^[A-Z0-9_]{2,40}$/.test(symbol)
      && !/^[A-Z0-9_\p{Script=Han}]{1,30}(?:USDT|USDC|BUSD|USD)$/u.test(symbol)) {
    throw new Error("Unknown chart name or invalid symbol. Use an exact market catalog identity.");
  }
  if (symbol && (!marketId || /^binance:/i.test(marketId)) && !/(?:USDT|USDC|BUSD|USD)$/.test(symbol)) symbol += "USDT";
  if (/^binance:/i.test(marketId)) {
    marketId = marketId.toUpperCase().replace(/^BINANCE:USDM:/, "BINANCE:FUTURES:");
  }
  if (marketId && symbol && marketId.split(":").at(-1)?.toUpperCase() !== symbol) {
    throw new Error("Chart marketId and symbol disagree.");
  }
  marketId ||= symbol ? `BINANCE:FUTURES:${symbol}` : current?.marketId || "";
  symbol ||= marketId.split(":").at(-1) || current?.symbol || "";
  if (!marketId || !symbol) throw new Error("Specify a chart market or symbol.");
  const sameMarket = marketId === current?.marketId;
  const raw = String(args.interval || (reuseOpenedInterval && sameMarket ? current?.interval : "") || "60").trim();
  const match = /^(\d+)(s|m|h|d|w|M|Y)$/i.exec(raw);
  let interval = raw.toUpperCase();
  if (match) {
    const amount = Number(match[1]), unit = match[2];
    interval = unit === "M" ? `${amount}M`
      : unit.toLowerCase() === "h" ? String(amount * 60)
      : unit.toLowerCase() === "m" ? String(amount)
      : `${amount}${unit.toUpperCase()}`;
  }
  if (!/^[1-9]\d{0,5}(?:S|D|W|M|Y)?$/.test(interval)) throw new Error("Invalid chart interval.");
  return { marketId, symbol, interval };
}
