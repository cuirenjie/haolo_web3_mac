import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { retryTradingMarketLoad } from "../src/renderer/trading-market-load-retry.ts";
import { isBinanceMarketSymbolError, tradingMarketErrorPresentation } from "../src/renderer/trading-expert-market.ts";

const source = fs.readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("market.ts", source, ts.ScriptTarget.Latest, true);
const workspace = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === "TradingExpertMarketWorkspace");
const names = ["restartMarketData", "clearMarketError", "refreshLiveCandle"];
const methods = workspace.members.filter(node => names.includes(node.name?.getText(ast))).map(node => node.getText(ast));
const javascript = ts.transpileModule(`class Harness { ${methods.join("\n")} }; globalThis.Harness = Harness;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const batch = { candles: [{ time: 1800000000, open: 10, high: 12, low: 9, close: 11, volume: 5 }],
  sourceCandles: [], source: { sourceInterval: "1h", sourceMs: 3600000, targetMs: 3600000 } };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function tick(t, ms) { t.mock.timers.tick(ms); await flush(); }

function fixture(t, fetchHistory, { cooldown = () => 0, cached = null } = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1800000000000 });
  const calls = [], commits = [], cacheWrites = [];
  const context = vm.createContext({ Date, AbortController, retryTradingMarketLoad,
    console: { error() {} }, isBinanceMarketSymbolError, tradingMarketErrorPresentation,
    window: { setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
      setInterval: () => 1, clearInterval() {} },
    fetchTradingCandles: (...args) => { calls.push(args); return fetchHistory(...args); },
    fetchLatestTradingCandles: (...args) => fetchHistory(...args),
    binanceMarketRestCooldownRemaining: cooldown,
    tradingMarketCandleCacheKey: args => `${args.symbol}:${args.interval}`,
    getTradingMarketCandleCache: () => cached,
    setTradingMarketCandleCache: (...args) => cacheWrites.push(args),
    tradingCandleSeriesMatchesResolution: () => true,
    tradingCandleBatchHasFinalizedHistory: () => true,
    tradingCandleBatchCanRefreshIncrementally: () => false,
    tradingAnalysisCandlesRequireCurrentRefresh: () => false,
    tradingMarketStatsFromCandles: () => ({ midPrice: 11 }),
    MARKET_SOCKET_FALLBACK_INTERVAL_MS: 10000, BINANCE_MARKET_RATE_LIMIT_RETRY_PADDING_MS: 500,
  });
  vm.runInContext(javascript, context);
  const harness = new context.Harness();
  Object.assign(harness, { disposed: false, loadGeneration: 0, selectedProvider: "binance", selectedSymbol: "BTCUSDT",
    selectedMarketId: "BINANCE:FUTURES:BTCUSDT", selectedMarketType: "perpetual", selectedAssetClass: "crypto",
    activeInterval: "60", candles: [], sourceCandles: [], marketHistoryReady: false,
    marketRateLimitRetryTimer: null, historyCooldownTimer: null, candleCachePersistTimer: null,
    pollTimer: null, candlePollTimer: null, lastAggregateTradeId: null,
    errorElement: { hidden: true, dataset: {}, setAttribute() {}, removeAttribute() {} }, currentPriceElement: {},
    detachAlertSimulation() {}, closeSocket() {}, cancelScheduledLiveChartPaint() {},
    hideCrosshairTimeLabel() {}, hideCrosshairPriceLabel() {}, hideCandleCountdown() {},
    connectSocket() {}, clearChart() {}, refreshSnapshot() {}, prefetchFavoriteCandleSnapshots() {},
    setLoading(value) { this.loading = value; },
    commitMarketSnapshot(symbol, marketId, _provider, _asset, _type, _meta, interval, stats, candleBatch) {
      this.candles = candleBatch.candles; this.stats = stats; this.loadedMarketId = marketId; this.loadedInterval = interval;
      commits.push({ symbol, interval }); this.clearMarketError();
    },
  });
  return { harness, calls, commits, cacheWrites };
}

test("initial failure stays loading and automatically renders recovered history", async t => {
  let attempts = 0;
  const { harness, calls, commits } = fixture(t, async () => {
    if (++attempts < 3) throw new Error("connection failed");
    return batch;
  });
  const pending = harness.restartMarketData();
  await flush();
  assert.equal(harness.loading, true);
  assert.equal(harness.errorElement.hidden, true);
  await harness.refreshLiveCandle(harness.loadGeneration); // Socket reconnect during bootstrap.
  assert.equal(calls.length, 1);
  await tick(t, 1500);
  assert.equal(harness.errorElement.hidden, true);
  await tick(t, 1500);
  await pending;
  assert.equal(calls.length, 3);
  assert.equal(harness.loading, false);
  assert.equal(harness.marketHistoryReady, true);
  assert.equal(harness.marketBootstrapGeneration, null);
  assert.equal(harness.errorElement.hidden, true);
  assert.deepEqual(commits, [{ symbol: "BTCUSDT", interval: "60" }]);
});

test("persistent failure reveals Retry only at 30 seconds; manual retry gets a fresh window", async t => {
  let online = false;
  const { harness, calls } = fixture(t, async () => {
    if (!online) throw new Error("connection failed");
    return batch;
  });
  const pending = harness.restartMarketData();
  await flush();
  for (let i = 0; i < 19; i++) await tick(t, 1500);
  await tick(t, 1499);
  assert.equal(calls.length, 20);
  assert.equal(harness.loading, true);
  assert.equal(harness.errorElement.hidden, true);
  await tick(t, 1);
  await pending;
  assert.equal(harness.loading, false);
  assert.equal(harness.errorElement.hidden, false);
  assert.equal(harness.errorElement.dataset.marketAction, "retry");
  assert.equal(calls[0][5].aborted, true);
  const retry = harness.restartMarketData();
  await flush();
  assert.equal(harness.errorElement.hidden, true);
  online = true;
  await tick(t, 1500);
  await retry;
  assert.equal(harness.marketHistoryReady, true);
});

test("a hung request is cancelled at the deadline and its late result cannot update the chart or cache", async t => {
  let release;
  const { harness, calls, commits, cacheWrites } = fixture(t, () => new Promise(resolve => { release = resolve; }));
  const pending = harness.restartMarketData();
  await tick(t, 30000);
  await pending;
  assert.equal(calls[0][5].aborted, true);
  assert.equal(harness.errorElement.hidden, false);
  release(batch);
  await flush();
  assert.equal(commits.length, 0);
  assert.equal(cacheWrites.length, 0);
});

for (const phase of ["backoff", "request"]) test(`changing interval cancels old ${phase} without stale errors or data`, async t => {
  let release;
  const { harness, calls, commits, cacheWrites } = fixture(t, async (_symbol, interval) => {
    if (interval === "15") return batch;
    if (phase === "backoff") throw new Error("offline");
    return new Promise(resolve => { release = resolve; });
  });
  const oldLoad = harness.restartMarketData();
  await flush();
  harness.activeInterval = "15";
  await harness.restartMarketData();
  await oldLoad;
  release?.(batch);
  await tick(t, 30000);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][5].aborted, true);
  assert.equal(harness.errorElement.hidden, true);
  assert.equal(harness.marketBootstrapGeneration, null);
  assert.deepEqual(commits, [{ symbol: "BTCUSDT", interval: "15" }]);
  assert.equal(cacheWrites.length, 1);
});

test("closing a chart cancels its backoff without showing an error", async t => {
  const { harness, calls, commits } = fixture(t, async () => { throw new Error("offline"); });
  const pending = harness.restartMarketData();
  await flush();
  harness.disposed = true; harness.loadGeneration++; harness.marketDataRequestAbortController.abort();
  await pending;
  await tick(t, 30000);
  assert.equal(calls.length, 1);
  assert.equal(commits.length, 0);
  assert.equal(harness.errorElement.hidden, true);
});

test("delisted symbols keep their immediate actionable error", async t => {
  const { harness, calls } = fixture(t, async () => { throw Object.assign(new Error("Invalid symbol"), { code: "BINANCE_MARKET_SYMBOL_INVALID" }); });
  await harness.restartMarketData();
  await tick(t, 30000);
  assert.equal(calls.length, 1);
  assert.equal(harness.errorElement.hidden, false);
  assert.equal(harness.errorElement.dataset.marketAction, "open-default-market");
});

test("server retry-after is respected within the same 30-second budget", async t => {
  let attempts = 0;
  const { harness, calls } = fixture(t, async () => {
    if (++attempts === 1) throw Object.assign(new Error("busy"), { retryAfterMs: 7500 });
    return batch;
  });
  const pending = harness.restartMarketData();
  await flush();
  await tick(t, 7499);
  assert.equal(calls.length, 1);
  assert.equal(harness.errorElement.hidden, true);
  await tick(t, 1);
  await pending;
  assert.equal(calls.length, 2);
  assert.equal(harness.marketHistoryReady, true);
});

test("an existing long cooldown issues no requests and reveals Retry at 30 seconds", async t => {
  const { harness, calls } = fixture(t, async () => batch, { cooldown: () => 60000 });
  const pending = harness.restartMarketData();
  await tick(t, 29999);
  assert.equal(harness.errorElement.hidden, true);
  await tick(t, 1);
  await pending;
  assert.equal(calls.length, 0);
  assert.equal(harness.errorElement.hidden, false);
});

test("a usable cached chart remains visible when the network retry window expires", async t => {
  const { harness } = fixture(t, async () => { throw new Error("offline"); }, {
    cached: { stats: { midPrice: 11 }, candleBatch: batch },
  });
  const pending = harness.restartMarketData();
  await flush();
  assert.equal(harness.loading, false);
  await tick(t, 30000);
  await pending;
  assert.equal(harness.errorElement.hidden, true);
  assert.equal(harness.candles.length, 1);
});
