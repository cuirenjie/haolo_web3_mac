import { normalizeTradingMarketSnapshot } from "../src/main/trading-analysis/protocol.mjs";
import { runHarmonicPatternEngine } from "../src/main/trading-analysis/harmonic-engine.mjs";

const symbols = process.argv.slice(2).length
  ? process.argv.slice(2).map((value) => String(value).trim().toUpperCase()).filter(Boolean)
  : ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

for (const symbol of symbols) {
  if (!/^[A-Z0-9]{5,24}$/.test(symbol)) throw new TypeError(`Invalid Binance symbol: ${symbol}`);
  const url = new URL("https://fapi.binance.com/fapi/v1/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1h");
  url.searchParams.set("limit", "500");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${symbol} market request failed with HTTP ${response.status}`);
  const rows = await response.json();
  const candles = rows.slice(0, -1).map((row) => ({
    time: Math.floor(Number(row[0]) / 1_000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
  const snapshot = normalizeTradingMarketSnapshot({
    marketId: `BINANCE:FUTURES:${symbol}`,
    interval: "60",
    snapshotTime: Date.now(),
    candles,
  });
  const result = runHarmonicPatternEngine(snapshot);
  const primary = result.structures.primaryCandidate;
  process.stdout.write(`${JSON.stringify({
    symbol,
    candleCount: candles.length,
    status: result.status,
    pivotCount: result.pivots.compactCount,
    candidateCount: result.structures.candidates.length,
    primary: primary ? {
      pattern: primary.patternId,
      direction: primary.direction,
      state: primary.tradeState,
      score: primary.score,
    } : null,
  })}\n`);
}
