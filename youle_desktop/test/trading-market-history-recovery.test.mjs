import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mergeTradingCandleBatches } from "../src/renderer/trading-market-candle-cache.mjs";
import { developmentDirectNetwork } from "../src/main/development-network.mjs";
import { initialMarketLogicalRange } from "../src/renderer/trading-expert-market.ts";

const source = fs.readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true);
const workspace = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "TradingExpertMarketWorkspace");
const names = ["refreshMarketDataFallback", "refreshLiveCandle", "recoverMarketHistory", "persistCurrentMarketCandleSnapshot"];
const methods = workspace.members.filter(node => names.includes(node.name?.getText(ast))).map(node => node.getText(ast));
const javascript = ts.transpileModule(`class Harness { ${methods.join("\n")} }; globalThis.Harness = Harness;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const bar = (i, closed = true) => ({ time: 1800000000 + i * 3600, open: 10, high: 12, low: 9, close: 11, volume: 5, closed });
function fixture(fetchHistory) {
  const calls = [];
  const context = vm.createContext({ Date, mergeTradingCandleBatches, fetchTradingCandles: fetchHistory,
    binanceMarketRestCooldownRemaining: () => 0,
    binanceResolutionSource: () => ({ sourceInterval: "1h", sourceMs: 3600000, targetMs: 3600000 }),
    tradingCandleSeriesMatchesResolution: () => true,
    tradingMarketStatsFromCandles: (_symbol, candles) => ({ midPrice: candles.at(-1).close }),
    MARKET_SOCKET_STALE_MS: 30000,
    fetchLatestTradingCandles: () => { throw new Error("must recover full history, not two live bars"); },
  });
  vm.runInContext(javascript, context);
  const harness = new context.Harness();
  Object.assign(harness, { disposed: false, loadGeneration: 1, selectedProvider: "binance", selectedSymbol: "SKHYNIXUSDT",
    selectedMarketType: "perpetual", activeInterval: "60", candles: [], sourceCandles: [], marketHistoryReady: false,
    lastAggregateTradeId: null, marketDataRequestAbortController: new AbortController(),
    marketKlineLastActivityAt: Date.now(), marketSocketLastActivityAt: Date.now(),
    commitLoadedSelection() {}, reconcileCurrentLivePrice() {}, updateStatsUi() {},
    updateChartData(options) { calls.push(options); }, scheduleCurrentMarketCandlePersistence() {},
  });
  return { harness, calls };
}

test("after a failed bootstrap, live traffic does not suppress the full 500-bar recovery", async () => {
  let requests = 0;
  const batch = { candles: Array.from({ length: 500 }, (_, i) => bar(i)), sourceCandles: [],
    source: { sourceInterval: "1h", sourceMs: 3600000, targetMs: 3600000 } };
  batch.sourceCandles = batch.candles;
  const { harness, calls } = fixture(async (_symbol, _interval, count) => {
    assert.equal(count, 500);
    requests++;
    if (requests === 1) throw new Error("gateway unavailable");
    return batch;
  });
  await harness.refreshLiveCandle(1);
  assert.equal(harness.marketHistoryReady, false);
  harness.candles = [bar(498), bar(499, false)];
  harness.sourceCandles = harness.candles;
  let recovery;
  const refresh = harness.refreshLiveCandle.bind(harness);
  harness.refreshLiveCandle = generation => recovery = refresh(generation);
  harness.refreshMarketDataFallback(1);
  await recovery;
  assert.equal(requests, 2);
  assert.equal(harness.candles.length, 500);
  assert.equal(harness.marketHistoryReady, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].resetViewport, true);
});

test("late full-history response cannot overwrite a newly selected chart", async () => {
  let release;
  const { harness, calls } = fixture(() => new Promise(resolve => { release = resolve; }));
  const work = harness.refreshLiveCandle(1);
  harness.loadGeneration = 2;
  harness.selectedSymbol = "ETHUSDT";
  release({ candles: [bar(1)], sourceCandles: [], source: {} });
  await work;
  assert.equal(harness.candles.length, 0);
  assert.equal(harness.marketHistoryReady, false);
  assert.equal(calls.length, 0);
});

test("concurrent recovery triggers coalesce and failed history is never persisted as complete", async () => {
  let release, requests = 0;
  const { harness } = fixture(() => { requests++; return new Promise(resolve => { release = resolve; }); });
  harness.candles = [bar(0), bar(1)];
  Object.assign(harness, { loadedProvider: "binance", loadedSymbol: "SKHYNIXUSDT", loadedInterval: "60",
    stats: { midPrice: 11 },
    currentMarketCandleCacheKey() { throw new Error("incomplete history must not reach persistence"); },
  });
  assert.doesNotThrow(() => harness.persistCurrentMarketCandleSnapshot());
  const first = harness.refreshLiveCandle(1);
  await harness.refreshLiveCandle(1);
  assert.equal(requests, 1);
  release({ candles: [], sourceCandles: [], source: {} });
  await first;
  assert.equal(harness.marketHistoryReady, false);
});

for (const theme of ["light", "dark"]) test(`${theme}: sparse recovery/new listing retains normal candle spacing`, () => {
  for (const count of [1, 2, 6, 80, 500]) {
    const range = initialMarketLogicalRange(count, "60");
    assert.equal(range.to - range.from, 105);
    assert.equal(range.to, count + 5);
  }
});

test("DIRECT diagnostic mode is opt-in and restricted to development", () => {
  assert.equal(developmentDirectNetwork({ HAOLO_DEV_NETWORK_MODE: "direct" }), false);
  assert.equal(developmentDirectNetwork({ HAOLO_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:5177" }), false);
  assert.equal(developmentDirectNetwork({ HAOLO_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:5177", HAOLO_DEV_NETWORK_MODE: "direct" }), true);
});
