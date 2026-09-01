import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  tradingExtremaLabelSide,
  tradingVisibleExtrema,
} from "../src/renderer/trading-chart-extrema.ts";

const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const splitPaneSource = readFile(new URL("../src/renderer/trading-expert-split-pane.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("visible K-line extrema use only candles intersecting the logical viewport", () => {
  const candles = [
    { time: 1, high: 500, low: 10 },
    { time: 2, high: 120, low: 80 },
    { time: 3, high: 150, low: 90 },
    { time: 4, high: 130, low: 60 },
    { time: 5, high: 900, low: 1 },
  ];
  assert.deepEqual(tradingVisibleExtrema(candles, { from: 1, to: 3 }), {
    high: candles[2],
    low: candles[3],
  });
  assert.deepEqual(tradingVisibleExtrema(candles, { from: 3.2, to: 1.4 }), {
    high: candles[2],
    low: candles[3],
  });
  assert.equal(tradingVisibleExtrema(candles, null), null);
});

test("extrema labels point inward and flip before they overflow the plot", () => {
  assert.equal(tradingExtremaLabelSide(120, 1_000, 80), "right");
  assert.equal(tradingExtremaLabelSide(880, 1_000, 80), "left");
  assert.equal(tradingExtremaLabelSide(970, 1_000, 80), "left");
  assert.equal(tradingExtremaLabelSide(20, 1_000, 80), "right");
});

test("main and split charts keep extrema labels synchronized across data and geometry changes", async () => {
  const [market, splitPane, styles] = await Promise.all([marketSource, splitPaneSource, stylesSource]);
  assert.match(market, /new TradingChartExtremaOverlay\(\{[\s\S]*?getCandles: \(\) => this\.chartCandles/);
  assert.match(splitPane, /new TradingChartExtremaOverlay\(\{[\s\S]*?getCandles: \(\) => this\.candles/);
  assert.match(market, /subscribeVisibleLogicalRangeChange[\s\S]*?this\.extremaOverlay\?\.schedule\(\)/);
  assert.match(splitPane, /subscribeVisibleLogicalRangeChange[\s\S]*?this\.extremaOverlay\?\.schedule\(\)/);
  assert.match(styles, /--trading-market-extrema-label:\s*#111318/);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*?--trading-market-extrema-label:\s*#f2f4f7/);
  assert.match(styles, /--trading-market-price-label-font-size:\s*calc\(11px \+ var\(--app-font-size-offset\)\)/);
  const extremaLabel = sourceBlock(styles, ".trading-market-extrema-label {", ".trading-market-extrema-label[hidden]");
  assert.match(extremaLabel, /font-family:\s*"Segoe UI", "Microsoft YaHei", Arial, sans-serif/);
  assert.match(extremaLabel, /font-size:\s*var\(--trading-market-price-label-font-size\)/);
  assert.match(extremaLabel, /font-weight:\s*500/);
  assert.match(extremaLabel, /font-feature-settings:\s*"zero" 0/);
  assert.match(extremaLabel, /font-variant-numeric:\s*tabular-nums/);
  assert.doesNotMatch(extremaLabel, /var\(--font-sans\)/);
  assert.match(styles, /\.trading-market-focus-price\s*\{[\s\S]*?font-size:\s*var\(--trading-market-price-label-font-size\)/);
});

test("foreground trade ticks paint on the next frame and reuse the current-price line", async () => {
  const market = await marketSource;
  const schedule = sourceBlock(market, "private scheduleLiveChartPaint()", "private paintLatestCandle()");
  const syncLine = sourceBlock(market, "private syncCurrentPriceLine", "private commitLoadedSelection");
  const fullRefresh = sourceBlock(market, "private updateChartData(options:", "private prepareChartViewportReset");
  const countdown = sourceBlock(market, "private updateCountdown()", "private setStat(");
  assert.match(schedule, /if \(document\.hidden\)[\s\S]*?MARKET_BACKGROUND_PAINT_INTERVAL_MS/);
  assert.match(schedule, /this\.liveChartPaintFrame = window\.requestAnimationFrame/);
  assert.doesNotMatch(schedule, /MARKET_LIVE_PAINT_INTERVAL_MS|setTimeout\([\s\S]*?100/);
  assert.match(syncLine, /if \(this\.priceLine\) this\.priceLine\.applyOptions\(options\)/);
  assert.match(syncLine, /else this\.priceLine = this\.candleSeries\.createPriceLine\(options\)/);
  assert.match(fullRefresh, /this\.syncCurrentPriceLine\(lastRaw\)/);
  assert.doesNotMatch(fullRefresh, /removePriceLine\(this\.priceLine\)[\s\S]*?createPriceLine/);
  assert.match(market, /latest\.high > this\.lockedPriceRange\.to \|\| latest\.low < this\.lockedPriceRange\.from[\s\S]*?this\.updateVisiblePriceScale\(\)/);
  assert.match(countdown, /else \{[\s\S]*?this\.hideCandleCountdown\(\);[\s\S]*?\}[\s\S]*?this\.updateCurrentPriceLabel\(\);/);
});
