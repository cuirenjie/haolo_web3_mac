import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as market from "../src/renderer/trading-expert-market.ts";
import { TradingExpertSplitPane } from "../src/renderer/trading-expert-split-pane.ts";
import { applyTradingLivePriceToBatch, tradingCandleBucketTimeMs, tradingCandleCloseTimeMs, createTradingMarketCandleCache, STORAGE_PREFIX } from "../src/renderer/trading-market-candle-cache.mjs";
import { planBinanceInterval } from "../src/main/trading-alerts/binance-market-adapter.mjs";
import { normalizeMarketDataSubscription } from "../src/main/trading-alerts/market-data-hub.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { normalizeAlertIntentRequest } from "../src/main/trading-alerts/intent-provider.mjs";

const ms = date => Date.parse(`${date}T00:00:00Z`);
const dates = candles => candles.map(c => new Date(c.time * 1000).toISOString().slice(0, 10));
const candle = (date, closed = false) => ({ time: ms(date) / 1000, open: 95, high: 105, low: 90, close: 100, volume: 1000, closed });
const batch = (resolution, candles) => ({ source: market.binanceResolutionSource(resolution), candles, sourceCandles: candles.map(c => ({ ...c })) });

test("monthly quotes update the native calendar bar and preserve its OHLC and volume", t => {
  t.mock.timers.enable({ apis: ["Date"], now: ms("2026-09-10") });
  const before = batch("1M", [candle("2026-08-01", true), candle("2026-09-01")]);
  const updated = applyTradingLivePriceToBatch(before, 110, Date.now());
  assert.deepEqual(dates(updated.candles), ["2026-08-01", "2026-09-01"]);
  assert.deepEqual(updated.candles[0], before.candles[0]);
  assert.deepEqual(updated.candles[1], { ...before.candles[1], high: 110, close: 110 });
  assert.deepEqual(updated.sourceCandles, updated.candles);
});

for (const [open, close] of [["2026-01-01", "2026-02-01"], ["2026-02-01", "2026-03-01"], ["2024-02-01", "2024-03-01"], ["2026-12-01", "2027-01-01"]]) {
  test(`calendar boundary ${open} to ${close} drives freshness and rollover`, t => {
    const lastMoment = ms(close) - 1;
    t.mock.timers.enable({ apis: ["Date"], now: lastMoment });
    assert.equal(tradingCandleCloseTimeMs(ms(open), 30 * 86_400_000, "1M"), ms(close));
    assert.equal(market.tradingAnalysisCandlesRequireCurrentRefresh([candle(open)], "1M", lastMoment), false);
    assert.equal(market.tradingCandleBatchHasFinalizedHistory(batch("1M", [candle(open)]), lastMoment), true);
    assert.equal(market.tradingAnalysisCandlesRequireCurrentRefresh([candle(open)], "1M", ms(close) + 300_001), true);
    assert.equal(market.tradingWaveContextEndTime([candle(open)], "1M", ms(close) + 1000), ms(close));
    const updated = applyTradingLivePriceToBatch(batch("1M", [candle(open)]), 110, ms(close));
    assert.deepEqual(dates(updated.candles), [open, close]);
  });
}

test("annual and two-month bars aggregate by calendar boundaries", t => {
  t.mock.timers.enable({ apis: ["Date"], now: ms("2026-01-01") });
  const candles = Array.from({ length: 12 }, (_, i) => candle(`2025-${String(i + 1).padStart(2, "0")}-01`, true));
  const source = market.binanceResolutionSource("12M");
  const annual = market.aggregateTradingCandles(candles, source.targetMs, source.sourceInterval);
  assert.deepEqual(dates(annual), ["2025-01-01"]);
  assert.equal(annual[0].volume, 12_000);
  assert.equal(annual[0].closed, true);
  const twoMonths = market.binanceResolutionSource("2M");
  assert.deepEqual(dates(market.aggregateTradingCandles(candles.slice(0, 3), twoMonths.targetMs, twoMonths.sourceInterval)), ["2025-01-01", "2025-03-01"]);
  assert.equal(market.tradingResolutionCloseTimeMs(ms("2025-01-01"), "1Y"), ms("2026-01-01"));
});

test("fixed 30-day periods keep daily source bars and weekly periods keep the Monday anchor", () => {
  assert.equal(market.binanceResolutionSource("30D").sourceInterval, "3d");
  assert.equal(market.binanceResolutionSource("43200").sourceInterval, "3d");
  assert.equal(tradingCandleBucketTimeMs(ms("2026-09-10"), 7 * 86_400_000, "1w"), ms("2026-09-07"));
  assert.equal(tradingCandleCloseTimeMs(ms("2026-01-01"), 30 * 86_400_000, "3d"), ms("2026-01-31"));
});

test("annual split-pane live quotes do not create fixed-duration ghost candles", t => {
  t.mock.timers.enable({ apis: ["Date"], now: ms("2026-09-10") });
  const pane = Object.assign(Object.create(TradingExpertSplitPane.prototype), {
    market: { id: "BTC", provider: "binance" }, loadedMarketId: "BTC", interval: "12M", loadedInterval: "12M",
    candles: [candle("2026-01-01")], updateData() {}, renderLatestOhlc() {},
  });
  assert.equal(pane.applyLivePrice("BTC", 110, Date.now(), market.binanceResolutionSource("12M").targetMs, "1M"), true);
  assert.deepEqual(dates(pane.candles), ["2026-01-01"]);
  assert.equal(pane.candles[0].close, 110);
});

test("live monthly source candles contribute to their annual bucket through December", t => {
  t.mock.timers.enable({ apis: ["Date"], now: ms("2026-12-15") });
  const sourceText = readFileSync(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("market.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cls = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === "TradingExpertMarketWorkspace");
  const method = cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(ast) === "applyLiveSourceCandle");
  const js = ts.transpileModule(`class Harness { ${method.getText(ast)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Harness = runInNewContext(`${js}\nHarness`, { ...market, tradingCandleBucketTimeMs, tradingCandleCloseTimeMs });
  const h = Object.assign(new Harness(), { sourceCandles: [candle("2026-01-01", true)], candles: [], upsertLiveCandle: (rows, value) => [...rows.filter(c => c.time !== value.time), value].sort((a, b) => a.time - b.time) });
  h.applyLiveSourceCandle(candle("2026-12-01"), market.binanceResolutionSource("12M"));
  assert.deepEqual(dates(h.candles), ["2026-01-01"]);
  assert.equal(h.candles[0].volume, 2000);
  assert.equal(h.candles[0].closed, false);
});

test("legacy v3 snapshots are removed while new calendar snapshots round-trip", () => {
  const legacyPrefix = "haolo.trading.market.candles.v3.";
  const key = "BTC/1M";
  const values = new Map([[`${legacyPrefix}index`, JSON.stringify([{ k: key }])], [`${legacyPrefix}${encodeURIComponent(key)}`, "old incorrect data"]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const cache = createTradingMarketCandleCache({ storage });
  assert.equal(cache.get(key), null);
  assert.equal(values.has(`${legacyPrefix}${encodeURIComponent(key)}`), false);
  cache.set(key, { stats: {}, candleBatch: batch("1M", [candle("2026-09-01")]) });
  cache.clearMemory();
  assert.deepEqual(dates(cache.get(key).candleBatch.candles), ["2026-09-01"]);
  assert.equal(cache.get(key).candleBatch.source.sourceInterval, "1M");
  assert.ok(values.has(`${STORAGE_PREFIX}${encodeURIComponent(key)}`));
});

const ruleFixture = JSON.parse(readFileSync(new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url)));
for (const interval of ["1M", "12M", "1Y", "2y"]) {
  test(`unsupported calendar alert ${interval} is rejected before any minute normalization`, () => {
    const expected = error => error.code === "TRADING_ALERT_INTERVAL_UNSUPPORTED";
    const rule = structuredClone(ruleFixture); delete rule.ruleHash; rule.contexts[0].intervals = [interval];
    assert.throws(() => normalizeAlertRule(rule), expected);
    assert.throws(() => normalizeMarketDataSubscription({ marketId: "BINANCE:FUTURES:BTCUSDT", interval }), expected);
    assert.throws(() => planBinanceInterval(interval), expected);
    assert.throws(() => normalizeAlertIntentRequest({ schemaVersion: 1, requestId: "r", draftId: "d", sourceText: "Notify me on a breakout", conversation: [], currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval } }), expected);
  });
}

test("existing minute, hour, daily, weekly and custom alert intervals remain supported", () => {
  for (const [interval, duration] of [["1m", 60_000], ["12m", 720_000], ["1H", 3_600_000], ["1D", 86_400_000], ["1W", 604_800_000]]) {
    assert.equal(planBinanceInterval(interval).targetMs, duration);
    const rule = structuredClone(ruleFixture); delete rule.ruleHash; rule.contexts[0].intervals = [interval];
    assert.equal(normalizeAlertRule(rule).contexts[0].intervals[0], interval.toLowerCase());
  }
});
