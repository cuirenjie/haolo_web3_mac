import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as market from "../src/renderer/trading-expert-market.ts";
import { selectTradingAnalysisMarket, selectTradingAnalysisInterval } from "../src/renderer/trading-analysis-target.mjs";
import { applyTradingLivePriceToBatch, tradingCandleCloseTimeMs } from "../src/renderer/trading-market-candle-cache.mjs";

// Execute the production methods, replacing only their external boundaries.
// AST extraction keeps tests independent of source whitespace and private API exports.
const source = readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const workspaceClass = parsed.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "TradingExpertMarketWorkspace");
const methods = new Map(workspaceClass.members.filter(ts.isMethodDeclaration).map((node) => [node.name.getText(parsed), node.getText(parsed)]));
const compiledMethods = new Map();
function runtime(name, dependencies) {
  if (!compiledMethods.has(name)) {
    assert.ok(methods.has(name), `Missing production method ${name}`);
    compiledMethods.set(name, ts.transpileModule(`class Harness { ${methods.get(name)} }`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText);
  }
  return runInNewContext(`${compiledMethods.get(name)}\nHarness`, { ...market, tradingCandleCloseTimeMs, Date, ...dependencies });
}

const NOW = Date.parse("2026-09-04T15:30:01Z");
const HOUR = 3_600_000;
const MINUTE = 60_000;
const BTC = { id: "BINANCE:FUTURES:BTCUSDT", provider: "binance", symbol: "BTCUSDT", marketType: "perpetual", assetClass: "crypto", markPrice: 123, baseAsset: "BTC", quoteAsset: "USDT", displaySymbol: "BTC/USDT" };
const ETH = { ...BTC, id: "BINANCE:FUTURES:ETHUSDT", symbol: "ETHUSDT", baseAsset: "ETH", displaySymbol: "ETH/USDT" };
function batch(lastOpen = Math.floor(NOW / HOUR) * HOUR, interval = "60") {
  const source = market.binanceResolutionSource(interval);
  const candles = Array.from({ length: 100 }, (_, index) => ({
    time: (lastOpen - (99 - index) * source.targetMs) / 1_000,
    open: 100, high: 102, low: 98, close: 100, volume: 10,
    closed: lastOpen - (99 - index) * source.targetMs + source.targetMs <= NOW,
  }));
  return { candles, sourceCandles: candles.map((candle) => ({ ...candle })), source };
}
const unavailable = async () => { throw new Error("offline"); };
function refreshHarness(t, { fetchCandles = unavailable, fetchStats = unavailable, quote, interval = "60", fallback = batch().candles } = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const writes = [];
  const commits = [];
  const calls = { candles: 0, stats: 0 };
  const Harness = runtime("refreshCurrentMarketSnapshotForAnalysis", {
    applyTradingLivePriceToBatch,
    MARKET_LIVE_PRICE_MAX_AGE_MS: 120_000,
    window: { setTimeout: (resolve) => { queueMicrotask(resolve); return 0; } },
    fetchTradingCandles: async (...args) => { calls.candles++; return fetchCandles(...args); },
    fetchTradingMarketStats: async (...args) => { calls.stats++; return fetchStats(...args); },
    getTradingMarketCandleCache: () => ({ candleBatch: { candles: fallback } }),
    setTradingMarketCandleCache: (_key, value) => writes.push(value),
  });
  const workspace = Object.assign(new Harness(), {
    selectedMarketId: BTC.id, loadedMarketId: BTC.id, activeInterval: interval, loadedInterval: interval,
    loadGeneration: 1, disposed: false, candles: fallback, stats: { midPrice: 456 },
    latestLivePricesByMarketId: new Map(quote ? [[BTC.id, quote]] : []),
    commitMarketSnapshot: (...args) => commits.push(args),
  });
  return { workspace, writes, commits, calls, refresh: () => workspace.refreshCurrentMarketSnapshotForAnalysis(BTC, interval, fallback) };
}

for (const [label, fallback] of [
  ["three-day-old history", batch(Math.floor(NOW / HOUR) * HOUR - 72 * HOUR).candles],
  ["current-time cached candle with unverified OHLC", batch().candles],
]) {
  test(`offline current analysis rejects ${label} without writing cache or chart`, async (t) => {
    const h = refreshHarness(t, { fallback });
    await assert.rejects(h.refresh(), /已阻止使用旧 K 线分析/);
    assert.equal(h.calls.candles, 3);
    assert.equal(h.calls.stats, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.commits.length, 0);
  });
}

test("a live quote cannot rescue an expired REST history", async (t) => {
  const h = refreshHarness(t, {
    fetchCandles: async () => batch(Math.floor(NOW / HOUR) * HOUR - 72 * HOUR),
    quote: { price: 200, eventTimeMs: NOW, receivedAt: NOW },
  });
  await assert.rejects(h.refresh(), /已阻止使用旧 K 线分析/);
  assert.equal(h.calls.candles, 3);
  assert.equal(h.writes.length, 0);
});

test("a valid REST candle snapshot remains usable when ticker is unavailable", async (t) => {
  const h = refreshHarness(t, { fetchCandles: async () => batch() });
  const result = await h.refresh();
  assert.equal(result.candles.at(-1).close, 100);
  assert.equal(result.candles.length, 100);
  assert.equal(h.calls.candles, 1);
  assert.equal(h.calls.stats, 2);
  assert.equal(h.writes.length, 1);
  assert.equal(h.commits.length, 1);
});

test("a recently received stale WebSocket event cannot overwrite a fresh REST snapshot", async (t) => {
  const h = refreshHarness(t, {
    fetchCandles: async () => batch(),
    quote: { price: 200, eventTimeMs: NOW - 3 * HOUR, receivedAt: NOW },
  });
  const result = await h.refresh();
  assert.equal(result.candles.at(-1).close, 100);
  assert.equal(h.writes[0].stats.midPrice, 100);
});

test("a quote older than the REST request cannot roll the completed snapshot back", async (t) => {
  const h = refreshHarness(t, {
    fetchCandles: async () => batch(),
    quote: { price: 200, eventTimeMs: NOW - 30_000, receivedAt: NOW - 30_000 },
  });
  const result = await h.refresh();
  assert.equal(result.candles.at(-1).close, 100);
  assert.equal(h.commits[0].at(-1), false, "the chart must use the same reconciled batch as the analysis");
});

test("analysis commits skip a second quote merge while ordinary chart loads retain it", () => {
  const Harness = runtime("commitMarketSnapshot", {});
  let reconciliations = 0;
  const workspace = Object.assign(new Harness(), {
    reconcileCurrentLivePrice: () => { reconciliations++; },
    updateStatsUi() {}, updateChartData() {}, syncAlertSimulationForCurrentContext() {},
  });
  const args = [BTC.symbol, BTC.id, BTC.provider, BTC.assetClass, BTC.marketType, BTC, "60", {}, batch()];
  workspace.commitMarketSnapshot(...args, false);
  assert.equal(reconciliations, 0);
  workspace.commitMarketSnapshot(...args);
  assert.equal(reconciliations, 1);
});

test("WebSocket reconciliation retains its event time across a candle boundary", async (t) => {
  const lastOpen = Math.floor(NOW / MINUTE) * MINUTE - MINUTE;
  const h = refreshHarness(t, {
    interval: "1", fetchCandles: async () => batch(lastOpen, "1"),
    quote: { price: 101, eventTimeMs: NOW - 2_000, receivedAt: NOW },
  });
  const result = await h.refresh();
  assert.equal(result.candles.at(-1).time, lastOpen / 1_000);
  assert.equal(result.candles.length, 100, "must not stamp a previous-bucket event into the new bucket");
});

test("a current quote can advance one adjacent candle but cannot synthesize a history gap", async (t) => {
  const h = refreshHarness(t, {
    interval: "1", fetchCandles: async () => batch(Math.floor(NOW / MINUTE) * MINUTE - MINUTE, "1"),
    fetchStats: async () => market.tradingMarketStatsFromCandles(BTC.symbol, [{ close: 110 }]),
  });
  const result = await h.refresh();
  assert.equal(result.candles.at(-1).time, Math.floor(NOW / MINUTE) * 60);
  assert.equal(result.candles.at(-1).close, 110);
  assert.equal(result.candles.length, 101);
});

test("a quote cannot bridge even a short gap accepted by the cadence tolerance", async (t) => {
  const h = refreshHarness(t, {
    interval: "1", fetchCandles: async () => batch(Math.floor(NOW / MINUTE) * MINUTE - 3 * MINUTE, "1"),
    fetchStats: async () => market.tradingMarketStatsFromCandles(BTC.symbol, [{ close: 110 }]),
  });
  await assert.rejects(h.refresh(), /已阻止使用旧 K 线分析/);
  assert.equal(h.writes.length, 0);
});

test("a market switch while fetching a valid snapshot does not commit to the chart", async (t) => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const h = refreshHarness(t, { fetchCandles: () => pending });
  const running = h.refresh();
  h.workspace.selectedMarketId = ETH.id;
  finish(batch());
  await running;
  assert.equal(h.commits.length, 0);
  assert.equal(h.writes.length, 1, "the completed BTC response can still be cached under BTC");
});

for (const runner of ["runChanConversation", "runWyckoffConversation", "runOrderFlowConversation"]) {
  for (const change of ["market", "interval", "generation", "disposed", "unchanged"]) {
    test(`${runner} checks ${change} after the snapshot await`, async () => {
      let finish;
      const pending = new Promise((resolve) => { finish = resolve; });
      const jobs = [];
      const reachedJob = new Error("test intercepted analysis job");
      const Harness = runtime(runner, {
        selectTradingAnalysisMarket, selectTradingAnalysisInterval,
        window: { codexDesktop: { runTradingChanTest() {}, runTradingWyckoffAnalysis() {}, runTradingOrderFlowAnalysis() {} } },
        visibleCandlesInLogicalRange: () => [], activeTradingAnalysisLanguage: () => "zh-CN",
        tradingFavoriteRecord: (value) => ({ ...value }),
        tradingAnalysisJobs: { start(value) { jobs.push(value); throw reachedJob; } },
      });
      const workspace = Object.assign(new Harness(), {
        markets: [BTC, ETH], selectedMarketId: BTC.id, selectedSymbol: BTC.symbol, selectedMarketMeta: BTC,
        loadedMarketId: BTC.id, loadedInterval: "60", activeInterval: "60", candles: batch().candles,
        loadGeneration: 1, marketLoading: false, disposed: false, chart: null, drawingStorageSessionId: "test",
        refreshCurrentMarketSnapshotForAnalysis: () => pending,
      });
      const running = workspace[runner]({ symbol: "BTCUSDT", interval: "60" });
      if (change === "market") Object.assign(workspace, { selectedMarketId: ETH.id, selectedSymbol: ETH.symbol, loadedMarketId: ETH.id, candles: batch().candles });
      if (change === "interval") workspace.activeInterval = "15";
      if (change === "generation") workspace.loadGeneration++;
      if (change === "disposed") workspace.disposed = true;
      finish(batch());
      if (change === "unchanged") {
        await assert.rejects(running, (error) => error === reachedJob);
        assert.equal(jobs[0].symbol, BTC.symbol);
        assert.equal(jobs[0].market.symbol, BTC.symbol);
      } else {
        await assert.rejects(running, /行情已切换/);
        assert.equal(jobs.length, 0);
      }
    });
  }
}

test("wave child cutoff includes the current parent window and bounds historical windows", () => {
  const snapshotTime = Date.parse("2026-09-04T15:30:00Z");
  const candles = [{ time: Date.parse("2026-09-04T12:00:00Z") / 1_000 }];
  assert.equal(market.tradingWaveContextEndTime(candles, "240", snapshotTime), snapshotTime);
  const historic = [{ time: Date.parse("2026-09-03T12:00:00Z") / 1_000 }];
  assert.equal(market.tradingWaveContextEndTime(historic, "240", snapshotTime), Date.parse("2026-09-03T16:00:00Z"));
});

test("wave child fetch includes latest closed bars and ignores future bars marked closed by REST", async () => {
  const node = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "fetchTradingWaveDegreeContexts");
  const code = ts.transpileModule(node.getText(parsed).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const now = Date.parse("2026-09-04T15:30:00Z");
  const requested = [];
  const fetchContexts = runInNewContext(`${code}\nfetchTradingWaveDegreeContexts`, {
    ...market,
    fetchTradingCandles: async (_symbol, interval, _count, endTime) => {
      requested.push(endTime);
      const step = market.tradingViewResolutionDurationMs(interval);
      return { candles: Array.from({ length: 100 }, (_, i) => ({ time: (Math.floor(now / step) * step - (99 - i) * step) / 1_000, closed: true })) };
    },
  });
  const cutoff = market.tradingWaveContextEndTime([{ time: Date.parse("2026-09-04T12:00:00Z") / 1_000 }], "240", now);
  const result = await fetchContexts("BTCUSDT", "240", { endTime: cutoff });
  assert.deepEqual(requested, [now, now]);
  assert.equal(result[0].candles.at(-1).time, Date.parse("2026-09-04T14:00:00Z") / 1_000);
  assert.equal(result[1].candles.at(-1).time, Date.parse("2026-09-04T15:15:00Z") / 1_000);
  const historic = await fetchContexts("BTCUSDT", "240", { endTime: Date.parse("2026-09-04T12:00:00Z") });
  assert.equal(historic[0].candles.at(-1).time, Date.parse("2026-09-04T11:00:00Z") / 1_000);
  assert.equal(historic[1].candles.at(-1).time, Date.parse("2026-09-04T11:45:00Z") / 1_000);
});
