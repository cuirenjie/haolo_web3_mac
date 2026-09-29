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
const names = ["refreshMarketDataFallback", "refreshLiveCandle", "recoverMarketHistory", "persistCurrentMarketCandleSnapshot",
  "updateChartData", "syncAlertSimulationForCurrentContext", "alertSimulationMatchesCurrentContext", "commitLoadedSelection"];
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
    mergeCandles: (_current, incoming) => incoming,
    atm4MaBand: () => [], atm4BandSeriesData: () => [],
    MARKET_SOCKET_STALE_MS: 30000,
    fetchLatestTradingCandles: () => { throw new Error("must recover full history, not two live bars"); },
  });
  vm.runInContext(javascript, context);
  const harness = new context.Harness();
  Object.assign(harness, { disposed: false, loadGeneration: 1, selectedProvider: "binance", selectedSymbol: "SKHYNIXUSDT",
    selectedMarketType: "perpetual", selectedMarketId: "BINANCE:FUTURES:SKHYNIXUSDT", activeInterval: "60",
    candles: [], sourceCandles: [], chartCandles: [], marketHistoryReady: false,
    lastAggregateTradeId: null, marketDataRequestAbortController: new AbortController(),
    marketKlineLastActivityAt: Date.now(), marketSocketLastActivityAt: Date.now(),
    reconcileCurrentLivePrice() {}, updateStatsUi() {},
    updateChartData(options) { calls.push(options); }, scheduleCurrentMarketCandlePersistence() {},
  });
  return { harness, calls };
}

function renderedFixture({ attached = false, matching = true, empty = false } = {}) {
  const batch = { candles: Array.from({ length: 500 }, (_, i) => bar(i)), sourceCandles: [],
    source: { sourceInterval: "1h", sourceMs: 3600000, targetMs: 3600000 } };
  const f = fixture(async () => batch);
  const h = f.harness, events = [];
  delete h.updateChartData; // Exercise the real update and simulation lifecycle.
  Object.assign(h, {
    candles: empty ? [] : batch.candles.slice(-100), chartCandles: empty ? [] : batch.candles.slice(-100),
    loadedMarketId: h.selectedMarketId, loadedInterval: h.activeInterval,
    alertSimulationState: { marketId: matching ? h.selectedMarketId : "BINANCE:FUTURES:BTCUSDT", interval: h.activeInterval },
    alertSimulationSeries: attached ? {} : null,
    chart: { timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 20, to: 40 }),
      setVisibleLogicalRange: () => events.push("preserve") }) },
    candleSeries: { setData: () => events.push("data") },
    primarySeriesData: candles => candles, updateMainIndicatorData() {}, updateIndicatorData() {},
    renderIndicatorAnalysisPatches() {}, applyMarketPriceFormat() {}, syncCurrentPriceLine() {}, renderLatestOhlc() {},
    clearMarketError() {}, updateCountdown() {}, synchronizeVisibleChartGeometry() {},
    invalidateVolumeProfileSnapshot() {}, queueVisiblePriceScaleUpdate() {},
    prepareChartViewportReset() { events.push("reset"); this.resettingChartViewport = true; },
    applyInitialChartViewport() { events.push("initial"); },
    attachAlertSimulation({ focus }) { this.alertSimulationSeries = {}; events.push(focus ? "attach-focus" : "attach"); },
    focusAlertSimulationViewport() { events.push("focus"); },
    detachAlertSimulation() { this.alertSimulationSeries = null; events.push("detach"); },
  });
  return { ...f, events };
}

test("history recovery preserves an existing simulated view instead of resetting it", async () => {
  const { harness, events } = renderedFixture({ attached: true });
  await harness.refreshLiveCandle(1);
  assert.equal(harness.marketHistoryReady, true);
  assert.deepEqual(events, ["data", "focus"]);
});

test("empty history recovery initializes the chart then restores and focuses the retained simulation", async () => {
  const { harness, events } = renderedFixture({ empty: true });
  await harness.refreshLiveCandle(1);
  assert.equal(harness.marketHistoryReady, true);
  assert.deepEqual(events, ["reset", "data", "initial", "attach-focus"]);
  assert.ok(harness.alertSimulationSeries);
});

test("every candle commit focuses existing simulations after reset and restores detached ones", () => {
  const { harness, events } = renderedFixture({ attached: true });
  harness.updateChartData({ resetViewport: true });
  assert.deepEqual(events, ["reset", "data", "initial", "focus"]);
  events.length = 0;
  harness.alertSimulationSeries = null;
  harness.updateChartData();
  assert.deepEqual(events, ["data", "attach-focus"]);
});

test("recovery and ordinary updates never reattach another market or interval's simulation", async () => {
  const { harness, events } = renderedFixture({ matching: false, attached: true });
  await harness.refreshLiveCandle(1);
  assert.equal(harness.marketHistoryReady, true);
  assert.deepEqual(events, ["data", "detach"]);
  events.length = 0;
  harness.alertSimulationState.marketId = harness.selectedMarketId;
  harness.alertSimulationState.interval = "240";
  harness.updateChartData({ preserveViewport: true });
  assert.deepEqual(events, ["data", "preserve", "detach"]);
  assert.equal(harness.alertSimulationSeries, null);
});

test("history recovery retains cached navigation even when no simulation exists", async () => {
  const { harness, events } = renderedFixture();
  harness.alertSimulationState = null;
  await harness.refreshLiveCandle(1);
  assert.equal(harness.marketHistoryReady, true);
  assert.deepEqual(events, ["data"]);
});

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
