import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_TRADING_CHART_SETTINGS,
  DEFAULT_TRADING_SPLIT_LAYOUT_ID,
  TRADING_CHART_SETTINGS_STORAGE_KEY,
  TRADING_SPLIT_LAYOUTS,
  TRADING_SPLIT_LAYOUT_STORAGE_KEY,
  cloneTradingChartSettings,
  filterTradingOrderLinesForDisplay,
  heikinAshiCandles,
  hlcCandles,
  loadTradingChartSettings,
  loadTradingSplitLayoutId,
  normalizeTradingChartSettings,
  normalizeTradingSplitLayoutId,
  renderTradingChartSettingsDialog,
  renderTradingSplitLayoutPicker,
  saveTradingChartSettings,
  saveTradingSplitLayoutId,
  tradingFloatingOverlayPlacement,
  tradingPriceScaleUsesAutoScale,
  tradingSplitLayout,
} from "../src/renderer/trading-expert-chart-settings.ts";
import {
  tradingSplitPaneMarketMatchesQuery,
  tradingSplitPaneMarketSearchResults,
} from "../src/renderer/trading-expert-split-pane.ts";

const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const splitPaneSource = readFile(new URL("../src/renderer/trading-expert-split-pane.ts", import.meta.url), "utf8");
const drawingSource = readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    value(key) {
      return values.get(key);
    },
  };
}

test("chart settings normalize corrupt values and preserve independent light/dark palettes", () => {
  const settings = normalizeTradingChartSettings({
    version: 5,
    chartStyle: "bars",
    verticalPaddingPercent: 99,
    risingColor: "bad",
    fallingColor: "#123abc",
    priceScaleMode: "logarithmic",
    orderDisplay: {
      currentOrders: false,
      positions: "invalid",
      liquidation: 0,
      takeProfitStopLoss: true,
    },
    themes: {
      light: { backgroundColor: "#f0f1f2", horizontalGridVisible: false },
      dark: { backgroundColor: "#010203", verticalGridColor: "not-a-color" },
    },
  });

  assert.equal(settings.chartStyle, "bars");
  assert.equal(settings.verticalPaddingPercent, 15);
  assert.equal(settings.risingColor, DEFAULT_TRADING_CHART_SETTINGS.risingColor);
  assert.equal(settings.fallingColor, "#123ABC");
  assert.equal(settings.priceScaleMode, "logarithmic");
  assert.deepEqual(settings.orderDisplay, {
    currentOrders: false,
    positions: true,
    liquidation: true,
    takeProfitStopLoss: true,
  });
  assert.equal(settings.themes.light.backgroundColor, "#F0F1F2");
  assert.equal(settings.themes.light.horizontalGridVisible, false);
  assert.equal(settings.themes.dark.backgroundColor, "#010203");
  assert.equal(
    settings.themes.dark.verticalGridColor,
    DEFAULT_TRADING_CHART_SETTINGS.themes.dark.verticalGridColor,
  );
  assert.notEqual(settings.themes.light, settings.themes.dark);
});

test("relocated price controls default off, migrate old toolbar state, and persist new explicit choices", () => {
  for (const settings of [cloneTradingChartSettings(), normalizeTradingChartSettings({ version: 4, priceScaleMode: 'logarithmic' })]) {
    assert.equal(settings.autoScale, false); assert.equal(settings.priceScaleMode, 'linear');
    for (const theme of ['light', 'dark']) {
      const html = renderTradingChartSettingsDialog(settings, theme);
      for (const key of ['autoScale', 'logarithmicScale', 'percentageScale']) {
        assert.match(html, new RegExp(`type="checkbox" data-chart-setting="${key}"`));
        assert.doesNotMatch(html, new RegExp(`data-chart-setting="${key}"[^>]*checked`));
      }
    }
  }
  const settings = cloneTradingChartSettings(); settings.autoScale = true; settings.priceScaleMode = 'logarithmic';
  const storage = memoryStorage(); saveTradingChartSettings(storage, settings);
  const restored = loadTradingChartSettings(storage);
  assert.equal(restored.autoScale, true); assert.equal(restored.priceScaleMode, 'logarithmic');
});

test("HLC is the default and migrates legacy candlestick while current choices remain authoritative", async () => {
  assert.equal(DEFAULT_TRADING_CHART_SETTINGS.chartStyle, "hlc");
  assert.equal(cloneTradingChartSettings().chartStyle, "hlc");
  assert.equal(normalizeTradingChartSettings({ chartStyle: "invalid" }).chartStyle, "hlc");

  const emptyStorage = memoryStorage();
  assert.equal(loadTradingChartSettings(emptyStorage).chartStyle, "hlc");

  const legacyDefaultStorage = memoryStorage({
    [TRADING_CHART_SETTINGS_STORAGE_KEY]: JSON.stringify({
      version: 2,
      chartStyle: "candlestick",
    }),
  });
  assert.equal(loadTradingChartSettings(legacyDefaultStorage).chartStyle, "hlc");

  const currentSavedStorage = memoryStorage({
    [TRADING_CHART_SETTINGS_STORAGE_KEY]: JSON.stringify({
      version: 3,
      chartStyle: "candlestick",
    }),
  });
  assert.equal(loadTradingChartSettings(currentSavedStorage).chartStyle, "candlestick");
  assert.equal(normalizeTradingChartSettings({ version: 2, chartStyle: "bars" }).chartStyle, "bars");

  for (const theme of ["light", "dark"]) {
    const html = renderTradingChartSettingsDialog(cloneTradingChartSettings(), theme);
    assert.match(html, /name="chartStyle" value="hlc"[^>]*checked/);
    assert.doesNotMatch(html, /name="chartStyle" value="candlestick"[^>]*checked/);
  }

  assert.match(
    await marketSource,
    /action === "restore-chart-settings"[\s\S]*?cloneTradingChartSettings\(DEFAULT_TRADING_CHART_SETTINGS\)/,
  );
});

test("light chart canvas defaults to white and migrates the former gray default", () => {
  assert.equal(DEFAULT_TRADING_CHART_SETTINGS.themes.light.backgroundColor, "#ffffff");
  assert.equal(DEFAULT_TRADING_CHART_SETTINGS.themes.dark.backgroundColor, "#0b0c0f");

  const legacy = cloneTradingChartSettings();
  legacy.version = 1;
  legacy.themes.light.backgroundColor = "#f7f9fc";
  const storage = memoryStorage({
    [TRADING_CHART_SETTINGS_STORAGE_KEY]: JSON.stringify(legacy),
  });
  const migrated = loadTradingChartSettings(storage);
  assert.equal(migrated.version, 5);
  assert.equal(migrated.themes.light.backgroundColor, "#ffffff");
  assert.equal(migrated.themes.dark.backgroundColor, "#0B0C0F");
});

test("all coordinate modes start with native auto-fit and retain manual ranges during theme changes", async () => {
  const market = await marketSource;
  const splitPane = await splitPaneSource;
  assert.match(market, /rightPriceScale: \{[\s\S]*?autoScale: true/);
  for (const source of [market, splitPane]) {
    assert.match(source, /captureManualTradingPriceRanges\(this\.chart\)/);
    assert.match(source, /restoreManualTradingPriceRanges\(manualRanges\)/);
    assert.match(source, /TRADING_CHART_NAVIGATION_OPTIONS/);
  }
  assert.match(market, /private applyInitialChartViewport\(\)[\s\S]*?setAutoScale\(true\)/);
  assert.match(splitPane, /scaleModeChanged \? \{ mode: priceScaleMode\(settings\), autoScale: true \}/);
});

test("chart settings and selected split layout survive storage round trips", () => {
  const storage = memoryStorage();
  const settings = cloneTradingChartSettings();
  settings.chartStyle = "heikin-ashi";
  settings.showCountdown = true;
  settings.drawingToolsEnabled = false;
  settings.orderDisplay.positions = false;
  settings.themes.light.backgroundColor = "#ABCDEF";
  settings.themes.dark.backgroundColor = "#101112";

  saveTradingChartSettings(storage, settings);
  saveTradingSplitLayoutId(storage, "7-left-major");

  assert.equal(loadTradingChartSettings(storage).chartStyle, "heikin-ashi");
  assert.equal(loadTradingChartSettings(storage).showCountdown, true);
  assert.equal(loadTradingChartSettings(storage).drawingToolsEnabled, false);
  assert.equal(loadTradingChartSettings(storage).orderDisplay.positions, false);
  assert.equal(loadTradingChartSettings(storage).themes.light.backgroundColor, "#ABCDEF");
  assert.equal(loadTradingChartSettings(storage).themes.dark.backgroundColor, "#101112");
  assert.equal(loadTradingSplitLayoutId(storage), "7-left-major");
  assert.match(storage.value(TRADING_CHART_SETTINGS_STORAGE_KEY), /heikin-ashi/);
  assert.equal(storage.value(TRADING_SPLIT_LAYOUT_STORAGE_KEY), "7-left-major");
});

test("invalid persisted settings and layout fall back safely", () => {
  const storage = memoryStorage({
    [TRADING_CHART_SETTINGS_STORAGE_KEY]: "{invalid",
    [TRADING_SPLIT_LAYOUT_STORAGE_KEY]: "20-impossible",
  });
  assert.deepEqual(loadTradingChartSettings(storage), cloneTradingChartSettings());
  assert.equal(loadTradingSplitLayoutId(storage), DEFAULT_TRADING_SPLIT_LAYOUT_ID);
  assert.equal(normalizeTradingSplitLayoutId(null), DEFAULT_TRADING_SPLIT_LAYOUT_ID);
  assert.equal(tradingSplitLayout("missing").id, DEFAULT_TRADING_SPLIT_LAYOUT_ID);
});

test("HLC and Heikin-Ashi transforms retain timestamps and produce valid candles", () => {
  const candles = [
    { time: 10, open: 10, high: 16, low: 8, close: 14, volume: 12 },
    { time: 20, open: 14, high: 18, low: 12, close: 16, volume: 15 },
  ];
  const hlc = hlcCandles(candles);
  assert.equal(hlc[0].open, 10);
  assert.equal(hlc[1].open, 14);
  assert.deepEqual(hlc.map(({ time, volume }) => ({ time, volume })), [
    { time: 10, volume: 12 },
    { time: 20, volume: 15 },
  ]);

  const heikin = heikinAshiCandles(candles);
  assert.equal(heikin[0].open, 12);
  assert.equal(heikin[0].close, 12);
  assert.equal(heikin[1].open, 12);
  assert.equal(heikin[1].close, 15);
  heikin.forEach((candle) => {
    assert.ok(candle.high >= Math.max(candle.open, candle.close));
    assert.ok(candle.low <= Math.min(candle.open, candle.close));
  });
});

test("split picker exposes 1 through 9 panes with many valid arrangements", () => {
  assert.ok(TRADING_SPLIT_LAYOUTS.length >= 20);
  assert.deepEqual([...new Set(TRADING_SPLIT_LAYOUTS.map((layout) => layout.count))], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  TRADING_SPLIT_LAYOUTS.forEach((layout) => {
    assert.equal(layout.cells.length, layout.count, layout.id);
    layout.cells.forEach((cell) => {
      assert.ok(cell.column >= 1 && cell.column <= layout.columns.length, layout.id);
      assert.ok(cell.row >= 1 && cell.row <= layout.rows.length, layout.id);
      assert.ok(cell.column + (cell.columnSpan ?? 1) - 1 <= layout.columns.length, layout.id);
      assert.ok(cell.row + (cell.rowSpan ?? 1) - 1 <= layout.rows.length, layout.id);
    });
  });
  assert.ok(TRADING_SPLIT_LAYOUTS.filter((layout) => layout.count === 3).length >= 4);
  assert.ok(TRADING_SPLIT_LAYOUTS.filter((layout) => layout.count === 4).length >= 4);
  const html = renderTradingSplitLayoutPicker("4-grid");
  assert.match(html, /data-market-layout-picker/);
  assert.match(html, /data-market-layout="4-grid"\s+class="selected"/);
  assert.equal((html.match(/class="trading-market-layout-row"/g) || []).length, 9);
  assert.equal((html.match(/data-market-action="select-split-layout"/g) || []).length, TRADING_SPLIT_LAYOUTS.length);
});

test("floating split-layout placement clamps horizontally and flips around every pane row", () => {
  const below = tradingFloatingOverlayPlacement({
    hostWidth: 1200,
    hostHeight: 900,
    anchorLeft: 1180,
    anchorTop: 30,
    anchorBottom: 62,
  });
  assert.deepEqual(below, {
    left: 802,
    width: 390,
    maxHeight: 825,
    top: 67,
    bottom: null,
    placement: "below",
  });

  const above = tradingFloatingOverlayPlacement({
    hostWidth: 1200,
    hostHeight: 900,
    anchorLeft: 10,
    anchorTop: 820,
    anchorBottom: 852,
  });
  assert.equal(above.placement, "above");
  assert.equal(above.top, null);
  assert.equal(above.bottom, 85);
  assert.equal(above.maxHeight, 807);

  for (const anchorLeft of [0, 140, 280]) {
    for (const anchorTop of [8, 220, 432]) {
      const placement = tradingFloatingOverlayPlacement({
        hostWidth: 280,
        hostHeight: 480,
        anchorLeft,
        anchorTop,
        anchorBottom: anchorTop + 32,
      });
      assert.equal(placement.width, 264);
      assert.ok(placement.left >= 8);
      assert.ok(placement.left + placement.width <= 272);
      assert.ok(placement.maxHeight > 0);
      assert.notEqual(placement.top, placement.bottom);
    }
  }
});

test("settings dialog contains the eight requested categories with order display last", () => {
  const html = renderTradingChartSettingsDialog(cloneTradingChartSettings(), "light");
  const tabIds = [...html.matchAll(/data-market-settings-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabIds, [
    "main-style",
    "background",
    "scale",
    "rise-fall",
    "coordinate",
    "live-price",
    "drawing-tools",
    "order-display",
  ]);
  assert.match(html, /主图样式/);
  assert.match(html, /图表背景/);
  assert.match(html, /K线缩放/);
  assert.match(html, /涨跌颜色/);
  assert.match(html, /坐标选择/);
  assert.match(html, /实时价格/);
  assert.match(html, /画线工具/);
  assert.match(html, /订单显示/);
  assert.match(html, /当前委托/);
  assert.match(html, /当前持仓/);
  assert.match(html, /强平价格/);
  assert.match(html, /止盈止损/);
  assert.doesNotMatch(html, /限价委托、条件市价委托、条件限价委托|多头持仓、空头持仓|持仓的预估强平价格|限价止盈止损、条件市价止盈止损、条件限价止盈止损/);
  assert.doesNotMatch(html, /trading-chart-order-display-copy[^>]*>[\s\S]*?<small>/);
  const enabledOrderDisplays = [...html.matchAll(/data-chart-setting="orderDisplay\.([^"]+)" checked/g)]
    .map((match) => match[1]);
  assert.deepEqual(enabledOrderDisplays, [
    "currentOrders",
    "positions",
    "liquidation",
    "takeProfitStopLoss",
  ]);
  assert.doesNotMatch(html, /下单相关|K线大事件|开盘时间|主题选择|品牌水印|快捷键/);
  assert.match(html, /当前正在编辑亮色主题/);
  assert.match(renderTradingChartSettingsDialog(cloneTradingChartSettings(), "dark"), /当前正在编辑暗色主题/);
});

test("order display settings independently filter every canvas order-line category", () => {
  const lines = [
    { kind: "limit-long" },
    { kind: "limit-short" },
    { kind: "conditional-long" },
    { kind: "conditional-short" },
    { kind: "position-long" },
    { kind: "position-short" },
    { kind: "liquidation" },
    { kind: "take-profit" },
    { kind: "stop-loss" },
  ];
  assert.deepEqual(
    filterTradingOrderLinesForDisplay(lines, cloneTradingChartSettings().orderDisplay),
    lines,
  );
  assert.deepEqual(
    filterTradingOrderLinesForDisplay(lines, {
      currentOrders: false,
      positions: true,
      liquidation: false,
      takeProfitStopLoss: true,
    }).map((line) => line.kind),
    ["position-long", "position-short", "take-profit", "stop-loss"],
  );
  assert.equal(lines.length, 9);
});

test("settings and split actions are direct buttons wired to persisted settings and real independent split charts", async () => {
  const [market, splitPane, drawing] = await Promise.all([marketSource, splitPaneSource, drawingSource]);
  const symbolIndex = market.indexOf("${renderMarketChartActions()}");
  const favoritesIndex = market.indexOf('class="trading-market-favorite-tickers"');
  assert.ok(symbolIndex >= 0 && favoritesIndex > symbolIndex);
  assert.equal((market.match(/class="trading-market-chart-action"/g) ?? []).length, 2);
  assert.match(market, /data-market-action="open-chart-settings"/);
  assert.match(market, /data-market-action="open-split-layouts"/);
  assert.doesNotMatch(market, /toggle-more-menu|data-market-more-menu|•••/);
  assert.equal((splitPane.match(/class="trading-market-chart-action"/g) ?? []).length, 2);
  assert.doesNotMatch(splitPane, /toggle-more-menu|data-split-more-menu|•••/);
  assert.match(market, /saveTradingChartSettings\(window\.localStorage/);
  assert.match(market, /filterTradingOrderLinesForDisplay\(this\.orderLines, this\.chartSettings\.orderDisplay\)/);
  assert.match(market, /private applyOrderDisplaySettings\(\)/);
  assert.match(market, /this\.applyOrderDisplaySettings\(\)/);
  assert.match(market, /setOrderLines\(this\.displayedOrderLines\(\)\)/);
  assert.doesNotMatch(market, /setOrderLines\(this\.orderLines\)/);
  assert.match(market, /saveTradingSplitLayoutId\(window\.localStorage/);
  assert.match(market, /rebuildPrimarySeries\(\)/);
  assert.match(market, /getScaleAnchor: \(\) => this\.chartSettings\.scaleAnchor/);
  assert.doesNotMatch(market, /cursorAnchoredByDefault/);
  assert.match(market, /new TradingExpertSplitPane/);
  assert.match(market, /fetchTradingCandles/);
  assert.match(market, /getFinnhubMarketCandles/);
  assert.match(market, /getIfindMarketCandles/);
  assert.match(splitPane, /createChart/);
  assert.match(splitPane, /data-split-symbol/);
  assert.match(splitPane, /data-split-interval/);
  assert.match(splitPane, /const targetMarket = this\.market;[\s\S]*?const targetInterval = this\.interval/);
  assert.match(splitPane, /this\.loadCandles\(targetMarket, targetInterval\)/);
  assert.match(splitPane, /window\.setTimeout\(\(\) => void this\.reload\(false\), SPLIT_PANE_REFRESH_INTERVAL_MS\)/);
  assert.match(splitPane, /this\.settings = cloneTradingChartSettings\(settings\)/);
  assert.match(splitPane, /getScaleAnchor: \(\) => this\.settings\.scaleAnchor/);
  assert.match(drawing, /setUserDrawingEnabled\(enabled: boolean\)/);
});

test("chart settings button shows a descriptive tooltip for mouse and keyboard in both themes", async () => {
  const [market, css] = await Promise.all([marketSource, stylesSource]);
  const actionStart = market.indexOf("function renderMarketChartActions()");
  const actionEnd = market.indexOf("export function renderTradingExpertMarketWorkspace()", actionStart);
  const chartActions = market.slice(actionStart, actionEnd);

  assert.match(chartActions, /aria-describedby="trading-market-chart-settings-tooltip"/);
  assert.match(chartActions, /id="trading-market-chart-settings-tooltip"[\s\S]*?role="tooltip"[\s\S]*?<strong>K线设置<\/strong>[\s\S]*?<span>更改样式、图标颜色、开盘时间、工具栏等<\/span>/);
  assert.doesNotMatch(chartActions, /title="设置"/);
  assert.match(css, /\.trading-market-chart-settings-tooltip\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?background:\s*var\(--trading-market-panel\);[\s\S]*?color:\s*var\(--trading-market-text\);[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /open-chart-settings"\]:hover:not\(:disabled, \[aria-expanded="true"\]\)[\s\S]*?\+ \.trading-market-chart-settings-tooltip,[\s\S]*?open-chart-settings"\]:focus-visible:not\(:disabled, \[aria-expanded="true"\]\)[\s\S]*?visibility:\s*visible;[\s\S]*?opacity:\s*1;/);
  assert.match(css, /\.trading-market-chart-settings-tooltip span\s*\{[\s\S]*?color:\s*var\(--trading-market-muted\);/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-panel:\s*#0f1014;[\s\S]*?--trading-market-text:\s*#dfe1e3;[\s\S]*?--trading-market-muted:\s*#7e899b;/);
  assert.match(css, /\.trading-expert-market\s*\{[\s\S]*?--trading-market-panel:\s*#ffffff;[\s\S]*?--trading-market-text:\s*#172033;[\s\S]*?--trading-market-muted:\s*#7b8797;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.trading-market-chart-settings-tooltip\s*\{[\s\S]*?transition:\s*none;/);
});

test("new controls cover light and dark themes plus interaction and async states", async () => {
  const css = await stylesSource;
  assert.match(css, /\.trading-market-chart-action:hover:not\(:disabled\)/);
  assert.match(css, /\.trading-market-chart-action:active:not\(:disabled\)/);
  assert.match(css, /\.trading-market-chart-action:focus-visible/);
  assert.match(css, /\.trading-market-chart-action\[aria-expanded="true"\]/);
  assert.match(css, /\.trading-market-chart-action:disabled/);
  assert.match(css, /\.trading-market-layout-row button\.selected/);
  assert.match(css, /\.trading-market-layout-row button > \.sr-only[\s\S]*?clip-path: inset\(50%\)/);
  assert.match(css, /\.trading-market-split-loading/);
  assert.match(css, /\.trading-market-split-error:hover/);
  assert.match(css, /\.trading-market-split-toolbar button:disabled/);
  assert.match(css, /\.trading-market-split-symbol-menu button:hover/);
  assert.match(css, /\.trading-market-split-symbol-menu button:active/);
  assert.match(css, /\.trading-market-split-symbol-menu button:focus-visible/);
  assert.match(css, /\.trading-chart-settings-check input:checked/);
  assert.match(css, /\.trading-chart-settings-choice:has\(input:disabled\)/);
  assert.match(css, /\.trading-chart-settings-switch input:checked \+ span/);
  assert.match(css, /\.trading-chart-settings-switch:hover input:not\(:disabled\) \+ span/);
  assert.match(css, /\.trading-chart-settings-switch:active input:not\(:disabled\) \+ span::after/);
  assert.match(css, /\.trading-chart-settings-switch input:focus-visible \+ span/);
  assert.match(css, /\.trading-chart-settings-switch:has\(input:disabled\)/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-chart-settings-dialog/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-control:\s*#212224/);
  assert.match(css, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-chart-switch-off:\s*#3a3f47[\s\S]*?--trading-chart-switch-on:\s*#69a8ff/);
  assert.match(css, /\.trading-expert-market\s*\{[\s\S]*?--trading-market-control:\s*#f0f3f7/);
  assert.match(css, /\.trading-expert-market\s*\{[\s\S]*?--trading-chart-switch-off:\s*#d7d8da[\s\S]*?--trading-chart-switch-on:\s*#2f80ed/);
  assert.match(css, /html\[data-theme="light"\] \.trading-chart-settings-dialog/);
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /color-scheme: light/);
  const newControlCss = css.slice(css.indexOf(".trading-market-chart-actions"));
  assert.match(newControlCss, /var\(--trading-market-panel\)/);
  assert.match(newControlCss, /var\(--trading-market-text\)/);
  assert.match(newControlCss, /var\(--trading-market-border\)/);
  assert.match(newControlCss, /var\(--trading-market-accent\)/);
});

test("order display reuses the frameless typography spacing and control scale of chart settings", async () => {
  const css = await stylesSource;
  const listStart = css.indexOf(".trading-chart-order-display-list {");
  const rowStart = css.indexOf(".trading-chart-order-display-row {", listStart);
  const copyStart = css.indexOf(".trading-chart-order-display-copy strong {", rowStart);
  const switchStart = css.indexOf(".trading-chart-settings-switch {", copyStart);
  assert.ok(listStart >= 0 && rowStart > listStart && copyStart > rowStart && switchStart > copyStart);

  const listCss = css.slice(listStart, rowStart);
  assert.match(listCss, /gap:\s*22px/);
  assert.doesNotMatch(listCss, /border:|border-radius:|background:/);

  const rowCss = css.slice(rowStart, css.indexOf(".trading-chart-order-display-copy {", rowStart));
  assert.match(rowCss, /min-height:\s*34px/);
  assert.match(rowCss, /gap:\s*24px/);
  assert.match(rowCss, /padding:\s*0/);
  assert.doesNotMatch(rowCss, /border-bottom/);

  const copyCss = css.slice(copyStart, switchStart);
  assert.match(copyCss, /padding-top:\s*7px/);
  assert.match(copyCss, /color:\s*var\(--trading-market-muted\)/);
  assert.match(copyCss, /font-size:\s*calc\(13px \+ var\(--app-font-size-offset\)\)/);
  assert.match(copyCss, /font-weight:\s*400/);
  assert.doesNotMatch(copyCss, /small/);

  const switchCss = css.slice(switchStart, css.indexOf(".trading-chart-settings-switch input {", switchStart));
  assert.match(switchCss, /width:\s*36px/);
  assert.match(switchCss, /height:\s*20px/);
  assert.match(switchCss, /flex:\s*0 0 36px/);
  assert.match(switchCss, /margin-top:\s*7px/);
  const knobStart = css.indexOf(".trading-chart-settings-switch > span::after {", switchStart);
  const knobCss = css.slice(knobStart, css.indexOf(".trading-chart-settings-switch input:checked + span {", knobStart));
  assert.match(knobCss, /width:\s*14px/);
  assert.match(knobCss, /height:\s*14px/);
  assert.match(css, /\.trading-chart-settings-switch input:checked \+ span::after\s*\{[\s\S]*?translateX\(16px\)/);
});

test("candle countdown is attached to the live price axis in both themes", async () => {
  const [market, css] = await Promise.all([marketSource, stylesSource]);
  assert.match(market, /private updateCountdown\(\)[\s\S]*?this\.updateCurrentPriceLabel\(\)/);
  assert.match(market, /private updateCurrentPriceLabel\(\)[\s\S]*?this\.positionCandleCountdown\(y\)/);
  assert.match(
    market,
    /private positionCandleCountdown\(y: number\)[\s\S]*?priceScale\("right", 0\)\.width\(\)[\s\S]*?dataset\.placement = placement/,
  );
  const countdownCssStart = css.indexOf(".trading-market-candle-countdown {");
  const countdownCssEnd = css.indexOf(".trading-market-candle-countdown[hidden]", countdownCssStart);
  assert.ok(countdownCssStart >= 0 && countdownCssEnd > countdownCssStart);
  const countdownCss = css.slice(countdownCssStart, countdownCssEnd);
  assert.doesNotMatch(countdownCss, /\btop:\s*8px|\bright:\s*68px/);
  assert.match(countdownCss, /var\(--trading-market-panel\)/);
  assert.match(countdownCss, /var\(--trading-market-text\)/);
  assert.match(countdownCss, /var\(--trading-market-live-price-color/);
  assert.match(countdownCss, /data-placement="below"/);
  assert.match(countdownCss, /data-placement="above"/);
});

test("every split pane uses the main toolbar components without blocking period controls", async () => {
  const [splitPane, css] = await Promise.all([splitPaneSource, stylesSource]);
  assert.match(splitPane, /trading-market-overview trading-market-split-toolbar/);
  assert.match(splitPane, /trading-market-symbol trading-market-split-symbol-trigger/);
  assert.match(splitPane, /renderTradingMarketAssetLogo\(this\.market\.baseAsset, this\.market\.provider, true, this\.market\.assetClass, this\.market\.displaySymbol\)/);
  assert.match(splitPane, /trading-market-chart-actions trading-market-split-chart-actions/);
  assert.equal((splitPane.match(/class="trading-market-chart-action"/g) ?? []).length, 2);
  assert.match(splitPane, /trading-market-period-trigger trading-market-split-period-trigger/);
  assert.match(splitPane, /trading-market-times trading-market-split-times/);
  assert.match(splitPane, /data-split-action="open-chart-settings"/);
  assert.match(splitPane, /data-split-action="open-split-layouts"/);
  assert.match(splitPane, /onOpenGlobalSettings\?: \(anchor: HTMLElement\) => void/);
  assert.match(splitPane, /this\.onOpenGlobalSettings\?\.\(target\)/);
  assert.match(splitPane, /data-split-action="symbol"/);
  assert.match(splitPane, /data-split-action="interval"/);
  assert.doesNotMatch(splitPane, /<select/);
  assert.match(css, /\.trading-market-symbol\s*\{[\s\S]*?min-width:\s*212px[\s\S]*?height:\s*36px[\s\S]*?gap:\s*7px/);
  assert.match(css, /\.trading-market-period-trigger\s*\{[\s\S]*?height:\s*32px[\s\S]*?font-size:\s*calc\(12px/);
  assert.match(css, /\.trading-market-times button\s*\{[\s\S]*?height:\s*32px[\s\S]*?padding:\s*0 9px[\s\S]*?font-size:\s*calc\(12px/);
  assert.doesNotMatch(css, /\.trading-market-split-symbol-trigger strong\s*\{/);
  assert.doesNotMatch(css, /\.trading-market-split-times button\s*\{/);
  assert.match(css, /\[data-split-symbol-logo\]\s*\{[\s\S]*?display:\s*contents/);
  assert.match(css, /\.trading-market-split-symbol-menu\s*\{[\s\S]*?max-height:/);
  assert.match(css, /@container \(max-width:\s*520px\)/);
});

test("every auxiliary split pane searches the complete market catalog with the main picker styling", async () => {
  const [market, splitPane, css] = await Promise.all([marketSource, splitPaneSource, stylesSource]);
  assert.match(splitPane, /class="trading-market-picker trading-market-split-symbol-menu"/);
  assert.match(splitPane, /type="search"[\s\S]*?data-split-symbol-search[\s\S]*?placeholder="搜索交易对"/);
  assert.match(splitPane, /名称<\/span><span>平台<\/span><span>最新价<\/span><span>24H涨幅/);
  assert.match(splitPane, /tradingSplitPaneMarketMatchesQuery[\s\S]*?compactMarketSearchText/);
  assert.match(splitPane, /SPLIT_PANE_MARKET_RESULT_LIMIT = 120/);
  assert.match(splitPane, /renderTradingMarketAssetLogo\(market\.baseAsset, market\.provider, false, market\.assetClass, market\.displaySymbol\)/);
  assert.match(splitPane, /market\.quoteAvailable[\s\S]*?market\.markPrice[\s\S]*?market\.changePercent/);
  assert.match(splitPane, /private positionSymbolMenu\(\)[\s\S]*?paneRect\.bottom - triggerRect\.bottom/);
  assert.match(splitPane, /updateMarkets\(markets: readonly TradingSplitPaneMarket\[\]\)/);
  assert.match(market, /const catalog = this\.markets\.map\(\(market\) => this\.splitPaneMarket\(market\)\)/);
  assert.doesNotMatch(market, /const catalog = this\.markets\.slice\(0,\s*60\)/);
  assert.match(market, /private syncSplitPaneMarkets\(\)[\s\S]*?pane\.updateMarkets\(markets\)/);
  assert.match(market, /this\.syncSplitPaneMarkets\(\);[\s\S]*?this\.renderMarkets\(\)/);
  assert.match(css, /\.trading-market-split-symbol-menu\s*\{[^}]*width:\s*min\(576px, 100cqw\);[^}]*max-width:\s*100cqw;[^}]*max-height:/s);
  assert.match(css, /\.trading-market-split-symbol-menu \.trading-market-picker-head,[\s\S]*?grid-template-columns:/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*?\.trading-market-split-symbol-menu[\s\S]*?color-scheme:\s*dark/);
  assert.match(css, /html\[data-theme="light"\][\s\S]*?\.trading-market-split-symbol-menu[\s\S]*?color-scheme:\s*light/);
});

test("split market search accepts compact pairs, metadata, selected pinning, and result limits", () => {
  const market = (id, baseAsset, marketType = "perpetual") => ({
    id,
    provider: "binance",
    symbol: `${baseAsset}USDT`,
    baseAsset,
    quoteAsset: "USDT",
    displaySymbol: `${baseAsset}/USDT`,
    description: `${baseAsset}/USDT 币安${marketType === "spot" ? "现货" : "永续合约"}`,
    venue: "币安",
    assetClass: "crypto",
    marketType,
    tag: marketType === "spot" ? "现货" : "永续",
    markPrice: 1,
    changePercent: 0,
    quoteAvailable: true,
  });
  const markets = [
    market("eth", "ETH"),
    market("sol", "SOL", "spot"),
    market("btc", "BTC"),
  ];
  assert.equal(tradingSplitPaneMarketMatchesQuery(markets[0], "ethusdt"), true);
  assert.equal(tradingSplitPaneMarketMatchesQuery(markets[1], "现货"), true);
  assert.deepEqual(
    tradingSplitPaneMarketSearchResults(markets, "", "btc", 2).map(({ id }) => id),
    ["btc", "eth"],
  );
  assert.deepEqual(
    tradingSplitPaneMarketSearchResults(markets, "sol/usdt", "btc").map(({ id }) => id),
    ["sol"],
  );
});

test("the primary toolbar belongs to its own grid cell while split layouts are active", async () => {
  const [market, css] = await Promise.all([marketSource, stylesSource]);
  assert.match(market, /const splitActive = layout\.count > 1;[\s\S]*?this\.syncPrimaryPaneOverview\(splitActive\)/);
  assert.match(
    market,
    /private syncPrimaryPaneOverview\(splitActive: boolean\)[\s\S]*?this\.primaryChartPane\.insertBefore\(this\.marketOverview, this\.viewport\)/,
  );
  assert.match(market, /this\.chartGrid\.before\(this\.marketOverview\)/);
  assert.match(css, /\.trading-market-primary-pane\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(
    css,
    /\.trading-expert-market\.split-layout-active[\s\S]*?\.trading-market-primary-pane > \.trading-market-overview\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*margin:\s*0;/,
  );
  assert.match(
    css,
    /\.trading-expert-market\.split-layout-active[\s\S]*?\.trading-market-primary-pane \.trading-market-picker\s*\{[^}]*left:\s*0;[^}]*max-width:\s*100cqw/,
  );
});

test("the primary pane reuses the compact split-period menu only while split mode is active", async () => {
  const [market, css] = await Promise.all([marketSource, stylesSource]);
  assert.match(market, /trading-market-split-period-menu trading-market-primary-period-menu/);
  assert.match(market, /data-market-primary-period-menu[\s\S]*?role="listbox"[\s\S]*?图表 1 自定义周期/);
  assert.match(
    market,
    /if \(this\.host\.classList\.contains\("split-layout-active"\)\) \{[\s\S]*?this\.setPrimaryPeriodMenuOpen\(this\.primaryPeriodMenu\.hidden\)[\s\S]*?\} else \{[\s\S]*?this\.setPeriodEditorOpen\(this\.periodEditor\.hidden\)/,
  );
  assert.match(
    market,
    /private renderPeriodButtons\(\)[\s\S]*?this\.periodTimes\.innerHTML = buttons;[\s\S]*?this\.primaryPeriodMenu\.innerHTML = buttons/,
  );
  assert.match(market, /private setPrimaryPeriodMenuOpen\(open: boolean\)[\s\S]*?aria-haspopup[\s\S]*?splitActive \? "listbox" : "dialog"/);
  assert.match(css, /\.trading-market-split-period-menu\s*\{[^}]*width:\s*min\(232px, 100cqw\);[^}]*flex-wrap:\s*wrap;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.trading-market-split-period-menu button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--trading-market-accent\)/s);
  assert.match(css, /\.trading-market-split-period-menu button:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.45;/s);
  assert.match(css, /\.trading-expert-market\.split-layout-active[\s\S]*?\.trading-market-primary-pane \.trading-market-period-controls\s*\{[^}]*z-index:\s*97;/);
});

test("the split-layout picker escapes pane clipping and stays inside the whole market workspace", async () => {
  const [market, splitPane, css] = await Promise.all([marketSource, splitPaneSource, stylesSource]);
  assert.match(splitPane, /onOpenSplitLayouts\?: \(anchor: HTMLElement\) => void/);
  assert.match(splitPane, /this\.onOpenSplitLayouts\?\.\(target\)/);
  assert.match(market, /this\.layoutPickerHome = document\.createComment\("trading-market-layout-picker-home"\)/);
  assert.match(market, /private setLayoutPickerOpen\(open: boolean, anchor: HTMLElement \| null = null\)[\s\S]*?this\.host\.append\(this\.layoutPicker\)/);
  assert.match(
    market,
    /private positionLayoutPicker\(\)[\s\S]*?const placement = tradingFloatingOverlayPlacement\([\s\S]*?hostWidth: hostRect\.width[\s\S]*?anchorBottom: anchorRect\.bottom - hostRect\.top/,
  );
  assert.match(market, /!this\.layoutPicker\.hidden[\s\S]*?!this\.layoutPicker\.contains\(event\.target\)[\s\S]*?this\.setLayoutPickerOpen\(false\)/);
  assert.match(market, /this\.layoutPickerHome\.parentNode\?\.insertBefore\([\s\S]*?this\.clearLayoutPickerPosition\(\)/);
  assert.match(css, /\.trading-market-layout-picker\.floating\s*\{[^}]*z-index:\s*140;[^}]*margin:\s*0;/s);
});

test("split pane polling keeps the existing chart visible and updates an unchanged tail incrementally", async () => {
  const splitPane = await splitPaneSource;
  assert.match(splitPane, /const showLoading = resetViewport \|\| this\.candles\.length === 0/);
  assert.match(splitPane, /this\.loadingElement\.hidden = !showLoading/);
  assert.match(splitPane, /const previousCandles = this\.candles;[\s\S]*?this\.updateData\(previousCandles\)/);
  assert.match(splitPane, /if \(unchangedPrefix === previousData\.length && unchangedPrefix === nextData\.length\) return/);
  assert.match(splitPane, /const canUpdateTail =[\s\S]*?this\.series\?\.update\(datum\)/);
  assert.match(splitPane, /if \(showLoading \|\| this\.candles\.length === 0\) this\.errorElement\.hidden = false/);
  assert.match(splitPane, /finally \{[\s\S]*?this\.loadingElement\.hidden = true;[\s\S]*?this\.scheduleRefresh\(\)/);
});

test("split panes keep global titlebar favorite quotes while symbol and period selections stay local", async () => {
  const [market, splitPane, css] = await Promise.all([marketSource, splitPaneSource, stylesSource]);
  assert.match(
    market,
    /this\.favoriteTickerBar\.hidden = false/,
  );
  assert.doesNotMatch(css, /\.trading-expert-market\.split-layout-active \.trading-market-favorite-tickers/);
  assert.match(market, /private splitPaneSelections = new Map<number, TradingSplitPaneSelection>\(\)/);
  assert.match(market, /const savedSelection = this\.splitPaneSelections\.get\(index\)/);
  assert.match(market, /onSelectionChange: \(selection\) => \{[\s\S]*?this\.splitPaneSelections\.set\(index, selection\)/);
  assert.match(market, /onOpenGlobalSettings: \(anchor\) => \{[\s\S]*?this\.setChartSettingsOpen\(true, anchor\)/);
  assert.match(market, /this\.splitPanes\.forEach\(\(pane\) => pane\.updateSettings\(this\.chartSettings, themeName, syncSplitPriceMode\)\)/);
  assert.match(splitPane, /this\.onSelectionChange\?\.\(\{[\s\S]*?marketId: this\.market\.id,[\s\S]*?interval: this\.interval,[\s\S]*?market: \{ \.\.\.this\.market \}/);
  assert.match(splitPane, /this\.settings = cloneTradingChartSettings\(settings\)/);
});


test("TradingView navigation migrates legacy anchors and retains new explicit preferences", () => {
  assert.equal(DEFAULT_TRADING_CHART_SETTINGS.scaleAnchor, "right");
  assert.equal(normalizeTradingChartSettings({ version: 3, scaleAnchor: "cursor", chartStyle: "bars" }).scaleAnchor, "right");
  assert.equal(normalizeTradingChartSettings({ version: 4, scaleAnchor: "cursor" }).scaleAnchor, "cursor");
  assert.equal(normalizeTradingChartSettings({ version: 4, scaleAnchor: "right" }).scaleAnchor, "right");
  assert.equal(normalizeTradingChartSettings({ version: 3, chartStyle: "candlestick" }).chartStyle, "candlestick");
});
