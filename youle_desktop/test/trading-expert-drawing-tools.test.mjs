import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const drawingSource = readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8");
const splitPaneSource = readFile(new URL("../src/renderer/trading-expert-split-pane.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("AI annotations localize once on commit and remain unchanged across later language switches", async () => {
  const {
    localizeTradingAiDrawingPatch,
    tradingAiDrawingDisplayModel,
    tradingDrawingNoteBoxGeometry,
    tradingDrawingTextLayout,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const original = Object.freeze({
    id: "chan-note", source: "ai", colorToken: "chan-note", fontSize: 10,
    text: "末端向上笔：77,600 → 80,499.9；最新确认为顶分型。",
    points: Object.freeze([{ time: 123, price: 80499.9 }]),
  });
  const display = tradingAiDrawingDisplayModel(original, "en");
  assert.equal(display, original);
  assert.equal(display.text, original.text);
  assert.equal(display.points, original.points);
  assert.equal(display.colorToken, original.colorToken);
  const localizedPatch = localizeTradingAiDrawingPatch({
    schemaVersion: 1,
    analysisId: "analysis-en",
    baseRevision: 0,
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "240",
    operations: [{ op: "upsert", drawing: original }],
  }, "en");
  const localizedText = localizedPatch.operations[0].drawing.text;
  assert.equal(localizedText, "Latest up stroke: 77,600 → 80,499.9; confirmed top fractal.");
  assert.equal(original.text, "末端向上笔：77,600 → 80,499.9；最新确认为顶分型。");
  assert.equal(tradingAiDrawingDisplayModel(localizedPatch.operations[0].drawing, "zh-CN").text, localizedText);
  assert.equal(tradingAiDrawingDisplayModel(localizedPatch.operations[0].drawing, "zh-TW").text, localizedText);
  for (const fontSize of [8, 10, 18, 36]) {
    const box = tradingDrawingNoteBoxGeometry({ x: 600, y: 400 }, localizedText, fontSize, { width: 1000, height: 700 });
    assert.equal(box.layout.lines.join("").replace(/\s/g, ""), localizedText.replace(/\s/g, ""));
    assert.ok(box.boxLeft >= 0 && box.boxLeft + box.boxWidth <= 1000);
  }
  const wrapped = tradingDrawingTextLayout("Latest central zone 78,579.7; watch the retest.", 10, 120);
  for (const word of ["Latest", "central", "zone", "78,579.7;", "watch", "retest."]) {
    assert.ok(wrapped.lines.some((line) => line.includes(word)), `${word} must not be split across lines`);
  }
  assert.equal(tradingAiDrawingDisplayModel(original, "zh-CN"), original);
  const legacy = Object.freeze({
    id: "price-action-analysis-candlestick-pattern-label-0",
    source: "ai",
    text: "pa candlestick 7fd3ae716ec4b42a · unclosed",
  });
  const legacyEnglish = tradingAiDrawingDisplayModel(legacy, "en");
  assert.equal(legacyEnglish.text, "Candlestick pattern · unclosed");
  assert.equal(tradingAiDrawingDisplayModel(legacy, "zh-CN").text, "蜡烛形态 · 待收盘");
  assert.equal(legacy.text, "pa candlestick 7fd3ae716ec4b42a · unclosed");
  const drawing = await drawingSource;
  assert.ok(drawing.indexOf("const aiDrawings = aiSourceDrawings.map") < drawing.indexOf("const aiCandlestickLabelRequests"));
  assert.match(drawing, /data-i18n-skip>\$\{markup\}/);
});

test("strategy rectangles render their semantic label on the bound region in both themes", async () => {
  const {
    renderTradingDrawingRegionLabel,
    tradingDrawingRegionLabelGeometry,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const bounds = { width: 800, height: 500 };
  const geometry = tradingDrawingRegionLabelGeometry(
    { x: 120, y: 260 },
    { x: 520, y: 180 },
    "[15m] 看涨 OB（Order Block）",
    bounds,
    10,
  );
  assert.ok(geometry);
  assert.ok(geometry.x >= 120 && geometry.x + geometry.width <= bounds.width);
  assert.ok(geometry.y >= 180 && geometry.y + geometry.height <= 260);
  assert.equal(geometry.layout.lines.join(""), "[15m] 看涨 OB（Order Block）");
  const markup = renderTradingDrawingRegionLabel(
    { x: 120, y: 260 },
    { x: 520, y: 180 },
    "[15m] 看涨 FVG <open>",
    "var(--trading-ai-order-flow-fvg-bull)",
    bounds,
    10,
  );
  assert.match(markup, /class="trading-drawing-region-label"/);
  assert.match(markup, /fill="var\(--trading-market-panel\)"/);
  assert.match(markup, /var\(--trading-ai-order-flow-fvg-bull\)/);
  assert.match(markup, /FVG &lt;open&gt;/);
  assert.doesNotMatch(markup, /fill="#(?:fff|ffffff|000|000000)"/i);
});

test("Trading Expert exposes a complete grouped TradingView-style drawing catalog", async () => {
  const { TRADING_DRAWING_TOOLS, tradingDrawingToolDefinition } = await import(
    "../src/renderer/trading-expert-drawing.ts"
  );
  const ids = new Set(TRADING_DRAWING_TOOLS.map((tool) => tool.id));
  const groups = new Set(TRADING_DRAWING_TOOLS.map((tool) => tool.group));

  assert.ok(TRADING_DRAWING_TOOLS.length >= 75);
  assert.deepEqual([...groups], [
    "cursor",
    "trend",
    "channel",
    "gann-fib",
    "brush",
    "geometry",
    "annotation",
    "pattern",
    "prediction",
  ]);
  for (const id of [
    "trend-line",
    "ray",
    "parallel-channel",
    "pitchfork",
    "gann-box",
    "fib-retracement",
    "brush",
    "rectangle",
    "text",
    "xabcd",
    "long-position",
    "measure",
  ]) {
    assert.ok(ids.has(id), `missing drawing tool ${id}`);
    assert.equal(tradingDrawingToolDefinition(id)?.id, id);
  }
});

test("drawing measurement preserves time, price, and percentage changes", async () => {
  const { measureTradingDrawing } = await import("../src/renderer/trading-expert-drawing.ts");
  assert.deepEqual(
    measureTradingDrawing(
      { time: 1_700_000_000, price: 50_000 },
      { time: 1_700_003_600, price: 52_500 },
    ),
    { seconds: 3_600, priceChange: 2_500, percentChange: 5 },
  );
});

test("drawing mode forwards wheel zoom to the chart surface without changing native wheel semantics", async () => {
  const { tradingDrawingForwardedWheelEventInit } = await import(
    "../src/renderer/trading-expert-drawing.ts"
  );
  const [drawing, market, splitPane] = await Promise.all([
    drawingSource,
    marketSource,
    splitPaneSource,
  ]);
  const wheelInit = tradingDrawingForwardedWheelEventInit({
    altKey: false,
    buttons: 0,
    clientX: 620,
    clientY: 310,
    ctrlKey: true,
    deltaMode: 0,
    deltaX: 0,
    deltaY: -120,
    deltaZ: 0,
    metaKey: false,
    screenX: 720,
    screenY: 410,
    shiftKey: false,
  });

  assert.deepEqual(wheelInit, {
    bubbles: true,
    cancelable: true,
    composed: true,
    altKey: false,
    buttons: 0,
    clientX: 620,
    clientY: 310,
    ctrlKey: true,
    deltaMode: 0,
    deltaX: 0,
    deltaY: -120,
    deltaZ: 0,
    metaKey: false,
    screenX: 720,
    screenY: 410,
    shiftKey: false,
  });
  assert.match(drawing, /this\.overlay\.addEventListener\("wheel", this\.handleWheel, \{ passive: false \}\)/);
  assert.match(
    drawing,
    /private readonly handleWheel = \(event: WheelEvent\) => \{[\s\S]*?this\.chartElement\.firstElementChild[\s\S]*?new WheelEvent\([\s\S]*?tradingDrawingForwardedWheelEventInit\(event\)[\s\S]*?chartSurface\.dispatchEvent\(forwardedEvent\)[\s\S]*?forwardedEvent\.defaultPrevented[\s\S]*?event\.preventDefault\(\)/,
  );
  assert.match(drawing, /this\.overlay\.removeEventListener\("wheel", this\.handleWheel\)/);
  assert.match(market, /handleScale:\s*\{[\s\S]*?mouseWheel: true/);
  assert.match(splitPane, /handleScale: true/);
});

test("AI drawings are isolated and replaced by market plus interval context", async () => {
  const {
    replaceTradingAiDrawingContext,
    tradingAiDrawingMatchesContext,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const drawings = [
    { id: "btc-1d-old", symbol: "BINANCE:FUTURES:BTCUSDT", interval: "1D" },
    { id: "btc-1h", symbol: "BINANCE:FUTURES:BTCUSDT", interval: "60" },
    { id: "eth-1d", symbol: "BINANCE:FUTURES:ETHUSDT", interval: "1D" },
  ];
  const replacement = {
    id: "btc-1d-new",
    symbol: "BINANCE:FUTURES:BTCUSDT",
    interval: "1D",
  };

  assert.equal(
    tradingAiDrawingMatchesContext(drawings[0], "BINANCE:FUTURES:BTCUSDT", "1D"),
    true,
  );
  assert.equal(
    tradingAiDrawingMatchesContext(drawings[1], "BINANCE:FUTURES:BTCUSDT", "1D"),
    false,
  );
  assert.deepEqual(
    replaceTradingAiDrawingContext(
      drawings,
      "BINANCE:FUTURES:BTCUSDT",
      "1D",
      [replacement],
    ).map(({ id }) => id),
    ["btc-1h", "eth-1d", "btc-1d-new"],
  );
});

test("manual drawings remain visible across periods while keeping market and pane scopes", async () => {
  const { tradingManualDrawingMatchesContext } = await import(
    "../src/renderer/trading-expert-drawing.ts"
  );
  const btc15m = { symbol: "BINANCE:FUTURES:BTCUSDT", interval: "15", drawingScope: "main" };
  const btc4h = { symbol: "BINANCE:FUTURES:BTCUSDT", interval: "240", drawingScope: "main" };
  const btcVolume = { symbol: "BINANCE:FUTURES:BTCUSDT", interval: "15", drawingScope: "indicator:volume" };
  const legacyBtc = { symbol: "BINANCE:FUTURES:BTCUSDT" };

  assert.equal(tradingManualDrawingMatchesContext(btc15m, btc15m.symbol, "15"), true);
  assert.equal(tradingManualDrawingMatchesContext(btc15m, btc15m.symbol, "240"), true);
  assert.equal(tradingManualDrawingMatchesContext(btc4h, btc15m.symbol, "15"), true);
  assert.equal(tradingManualDrawingMatchesContext(btcVolume, btc15m.symbol, "240"), false);
  assert.equal(tradingManualDrawingMatchesContext(btcVolume, btc15m.symbol, "240", "indicator:volume"), true);
  assert.equal(tradingManualDrawingMatchesContext(btc15m, "BINANCE:FUTURES:ETHUSDT", "15"), false);
  assert.equal(tradingManualDrawingMatchesContext(legacyBtc, btc15m.symbol, "15"), true);
});

test("main-chart indicator panes expose the shared freehand drawing surface", async () => {
  const [market, styles, drawing] = await Promise.all([
    marketSource,
    stylesSource,
    drawingSource,
  ]);
  assert.match(market, /private indicatorDrawingControllers = new Map/);
  assert.match(market, /drawingScope: `indicator:\$\{id\}`/);
  assert.match(market, /getCandleSeries: \(\) => runtime\.series\[0\]\?\.api/);
  assert.match(market, /this\.indicatorDrawingControllers\.forEach\(\(controller\) => controller\.destroy\(\)\)/);
  assert.match(drawing, /drawingScope\?: string/);
  assert.match(drawing, /paneIndex\?: number/);
  assert.match(drawing, /this\.drawingScope === "main"/);
  assert.match(styles, /\.trading-indicator-drawing-pane\s*\{[^}]*position: relative;/s);
});

test("the last successful drawing workspace restores its own layout without dropping other contexts", async () => {
  const {
    loadTradingLastDrawingWorkspace,
    tradingLastDrawingWorkspaceStorageKey,
  } = await import("../src/renderer/trading-expert-market.ts");
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  const market = (id, symbol, baseAsset) => ({
    id,
    provider: "binance",
    symbol,
    baseAsset,
    quoteAsset: "USDT",
    displaySymbol: `${baseAsset}/USDT`,
    description: `${baseAsset}/USDT perpetual`,
    venue: "币安",
    assetClass: "crypto",
    marketType: "perpetual",
    tag: "永续",
  });
  const splitWorkspace = {
    schemaVersion: 1,
    layoutId: "3-rows",
    updatedAt: 1_786_403_400_000,
    panes: [
      { paneIndex: 0, market: market("BINANCE:FUTURES:ETHUSDT", "ETHUSDT", "ETH"), interval: "15" },
      {
        paneIndex: 1,
        market: market("BINANCE:FUTURES:BTCUSDT", "BTCUSDT", "BTC"),
        interval: "240",
        indicators: { main: ["ema"], sub: ["volume"] },
      },
      { paneIndex: 2, market: market("BINANCE:FUTURES:SOLUSDT", "SOLUSDT", "SOL"), interval: "60" },
    ],
  };
  storage.setItem(
    tradingLastDrawingWorkspaceStorageKey("thread-history"),
    JSON.stringify(splitWorkspace),
  );
  assert.deepEqual(loadTradingLastDrawingWorkspace(storage, "thread-history"), splitWorkspace);

  const finalSingleWorkspace = {
    ...splitWorkspace,
    layoutId: "1-single",
    updatedAt: splitWorkspace.updatedAt + 1,
    panes: [
      { paneIndex: 0, market: market("BINANCE:FUTURES:BTCUSDT", "BTCUSDT", "BTC"), interval: "60" },
    ],
  };
  storage.setItem(
    tradingLastDrawingWorkspaceStorageKey("thread-history"),
    JSON.stringify(finalSingleWorkspace),
  );
  assert.deepEqual(loadTradingLastDrawingWorkspace(storage, "thread-history"), finalSingleWorkspace);
  assert.equal(loadTradingLastDrawingWorkspace(storage, "another-thread"), null);
});

test("the latest persisted AI canvas supplies one compact market-period label", async () => {
  const {
    loadTradingLastAnalysisContext,
    tradingAnalysisContextLabel,
    tradingAnalysisIntervalLabel,
    tradingLastAnalysisContextStorageKey,
  } = await import("../src/renderer/trading-expert-market.ts");
  const { tradingDrawingSessionStorageKey } = await import("../src/renderer/trading-expert-drawing.ts");
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  storage.setItem(tradingDrawingSessionStorageKey("ai", "thread-a"), JSON.stringify([
    { source: "ai", symbol: "BINANCE:FUTURES:BTCUSDT", interval: "60" },
    { source: "ai", symbol: "BINANCE:FUTURES:ETHUSDT", interval: "1D" },
  ]));

  const inferred = loadTradingLastAnalysisContext(storage, "thread-a");
  assert.equal(tradingAnalysisContextLabel(inferred), "ETH1D");
  assert.equal(tradingAnalysisIntervalLabel("15"), "15M");
  assert.equal(tradingAnalysisIntervalLabel("240"), "4H");
  assert.ok(storage.getItem(tradingLastAnalysisContextStorageKey("thread-a")));

  storage.setItem(tradingLastAnalysisContextStorageKey("thread-a"), JSON.stringify({
    schemaVersion: 1,
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    updatedAt: 123,
  }));
  assert.equal(
    tradingAnalysisContextLabel(loadTradingLastAnalysisContext(storage, "thread-a")),
    "BTC1H",
  );
});

test("manual and AI drawings persist in isolated conversation storage", async () => {
  const [drawing, market, main] = await Promise.all([drawingSource, marketSource, mainSource]);
  const { tradingDrawingSessionStorageKey } = await import("../src/renderer/trading-expert-drawing.ts");
  const restoreLastAnalysis = market.slice(
    market.indexOf("private restoreLastAnalysisSelection"),
    market.indexOf("private updateSymbolUi"),
  );

  assert.notEqual(
    tradingDrawingSessionStorageKey("manual", "thread-a"),
    tradingDrawingSessionStorageKey("manual", "thread-b"),
  );
  assert.equal(
    tradingDrawingSessionStorageKey("ai", "thread/a"),
    "haolo.trading-market.ai-drawings.v2.thread%2Fa",
  );
  assert.match(drawing, /haolo\.trading-market\.ai-drawings\.v2\./);
  assert.match(drawing, /private aiDrawings: TradingDrawingModel\[\] = \[\]/);
  assert.match(drawing, /this\.aiDrawings = loadStoredAiDrawings\(this\.storageSessionId\)/);
  assert.match(drawing, /private persistAiDrawings\(notify = true\)/);
  assert.match(drawing, /tradingDrawingSessionStorageKey\("ai", this\.storageSessionId\)/);
  assert.match(drawing, /switchStorageSession\([\s\S]*loadStoredDrawings\(this\.storageSessionId\)[\s\S]*loadStoredAiDrawings\(this\.storageSessionId\)/);
  assert.match(drawing, /LEGACY_TRADING_AI_DRAWINGS_STORAGE_KEY[\s\S]*window\.localStorage\.removeItem\(legacyStorageKey\)/);
  assert.match(drawing, /getInterval: \(\) => string/);
  assert.match(drawing, /interval: patch\.interval/);
  assert.match(drawing, /tradingAiDrawingMatchesContext\(drawing, symbol, interval\)/);
  assert.match(drawing, /playAiDrawingPatch[\s\S]*?cancelAiPlayback\(\{ clear: true \}\)/);
  assert.match(drawing, /await this\.aiPlayback\.play\(drawings, options\)[\s\S]*?this\.storeAiDrawingPatch\(patch\)/);
  assert.match(market, /getInterval: \(\) => this\.activeInterval/);
  assert.match(market, /storageSessionId: this\.drawingStorageSessionId/);
  assert.match(market, /syncDrawingStorageSession\([\s\S]*switchStorageSession\(drawingStorageSessionId/);
  assert.match(market, /this\.restoreLastAnalysisSelection\(\)/);
  assert.match(market, /loadTradingLastAnalysisContext\([\s\S]*this\.drawingStorageSessionId/);
  assert.match(restoreLastAnalysis, /context\.market[\s\S]*this\.favoriteMarketRecords[\s\S]*binanceMarketFromAnalysisContext\(context\)/);
  assert.match(restoreLastAnalysis, /this\.activeInterval = context\.interval;[\s\S]*if \(!this\.selectMarket\(market\)\) return false;[\s\S]*this\.updateSymbolUi\(\);/);
  assert.match(market, /migrateTradingLastAnalysisContext\([\s\S]*migrateFromSessionId,[\s\S]*drawingStorageSessionId/);
  assert.equal((market.match(/rememberTradingAnalysisJobContext\(job\)/g) || []).length, 5);
  assert.match(drawing, /onAiDrawingContextsChanged\(null\)/);
  assert.match(main, /const storageSessionId = tradingExpertMarketWorkspaceStorageSessionId\(\) \|\| threadId/);
  assert.match(main, /syncTradingExpertMarketWorkspace\([\s\S]*targetThreadId \|\| preserved\.threadId,[\s\S]*sourceStorageSessionId && sourceStorageSessionId !== targetStorageSessionId[\s\S]*?sourceStorageSessionId/);
  assert.match(main, /migrateTradingExpertMarketWorkspaceStorageSession\(previousThreadId, nextThreadId\)/);
  assert.match(main, /syncTradingExpertMarketWorkspace\([\s\S]*freshHost,[\s\S]*targetThreadId \|\| ""/);

  const restartBlock = market.slice(
    market.indexOf("private async restartMarketData"),
    market.indexOf("private async refreshSnapshot"),
  );
  const destroyBlock = market.slice(
    market.indexOf("destroy() {"),
    market.indexOf("function formatMarketPrice"),
  );
  assert.doesNotMatch(restartBlock, /cancelTradingAnalysis|cancelChanAnalysis/);
  assert.doesNotMatch(destroyBlock, /cancelTradingAnalysis|cancelChanAnalysis/);
  assert.equal((market.match(/const job = tradingAnalysisJobs\.start\(\{/g) || []).length, 5);
  assert.match(market, /persistTradingAiDrawingPatch\(storageSessionId, patch\)/);
});

test("each trading task persists its last selected market and interval", async () => {
  const market = await marketSource;
  const selectMarket = market.slice(
    market.indexOf("private selectMarket(market: TradingMarket)"),
    market.indexOf("private syncIntervalAvailability"),
  );
  const intervalAction = market.slice(
    market.indexOf('if (action === "interval")'),
    market.indexOf('if (action === "main-indicator")'),
  );
  const storageSwitch = market.slice(
    market.indexOf("syncDrawingStorageSession("),
    market.indexOf("private restoreLastAnalysisSelection"),
  );

  assert.match(selectMarket, /normalizeBinanceTradingMarket\(market\)[\s\S]*this\.selectedMarketId = selectedMarket\.id;[\s\S]*this\.recordLastDrawingWorkspace\(\);/);
  assert.match(intervalAction, /this\.activeInterval = interval;[\s\S]*this\.recordLastDrawingWorkspace\(\);/);
  assert.match(market, /onSelectionChange: \(selection\) => \{[\s\S]*this\.splitPaneSelections\.set\(index, selection\);[\s\S]*this\.recordLastDrawingWorkspace\(\);/);
  assert.match(storageSwitch, /previousStorageSessionId !== drawingStorageSessionId[\s\S]*loadTradingLastDrawingWorkspace\(window\.localStorage, drawingStorageSessionId\)[\s\S]*this\.restoreLastDrawingWorkspace\(workspace\)/);
});

test("drawing coordinate conversion rejects missing chart values instead of teleporting endpoints", async () => {
  const {
    finiteTradingChartCoordinate,
    tradingDrawingEllipseGeometry,
    tradingDrawingLogicalToCoordinate,
  } = await import("../src/renderer/trading-expert-drawing.ts");

  assert.equal(finiteTradingChartCoordinate(null), null);
  assert.equal(finiteTradingChartCoordinate(undefined), null);
  assert.equal(finiteTradingChartCoordinate(Number.NaN), null);
  assert.equal(finiteTradingChartCoordinate(Number.POSITIVE_INFINITY), null);
  assert.equal(finiteTradingChartCoordinate("0"), null);
  assert.equal(finiteTradingChartCoordinate(0), 0);
  assert.equal(finiteTradingChartCoordinate(123.5), 123.5);

  const integerOnlyScale = (logical) => Number.isInteger(logical) ? 100 + logical * 24 : 0;
  assert.equal(tradingDrawingLogicalToCoordinate(7, integerOnlyScale), 268);
  assert.equal(tradingDrawingLogicalToCoordinate(7.5, integerOnlyScale), 280);
  assert.equal(tradingDrawingLogicalToCoordinate(-0.48, integerOnlyScale), 88.48);
  assert.equal(tradingDrawingLogicalToCoordinate(Number.NaN, integerOnlyScale), null);

  const ellipse = tradingDrawingEllipseGeometry(
    { x: tradingDrawingLogicalToCoordinate(7.52, integerOnlyScale), y: 410 },
    { x: tradingDrawingLogicalToCoordinate(10.48, integerOnlyScale), y: 250 },
  );
  assert.ok(ellipse.rx > 0, "fractional candle padding must produce a visible horizontal ellipse radius");
  assert.equal(ellipse.cx, 316);
  assert.ok(Math.abs(ellipse.rx - 35.52) < Number.EPSILON * 128);
  assert.equal(ellipse.ry, 80);
});

test("controlled AI drawings preserve professional line and inline-label appearance", async () => {
  const { normalizeTradingAiDrawingPatch } = await import("../src/renderer/trading-expert-drawing.ts");
  const base = {
    strategyId: "harmonic",
    symbol: "BTCUSDT",
    interval: "1h",
    theory: "strategy",
    layer: "ai/strategy/harmonic",
    locked: true,
    status: "confirmed",
    evidenceIds: [],
  };
  const drawings = normalizeTradingAiDrawingPatch({
    schemaVersion: 1,
    analysisId: "harmonic-professional-drawing",
    baseRevision: 0,
    marketId: "BTCUSDT",
    interval: "1h",
    operations: [
      {
        op: "upsert",
        drawing: {
          ...base,
          id: "harmonic-main",
          tool: "path",
          points: [{ time: 1, price: 100 }, { time: 2, price: 110 }],
          colorToken: "strategy-support",
          lineStyle: "solid",
          lineWidth: 3,
        },
      },
      {
        op: "upsert",
        drawing: {
          ...base,
          id: "harmonic-ratio",
          tool: "text",
          points: [{ time: 2, price: 106 }],
          text: "B/XA 0.618",
          colorToken: "strategy-note",
          fontSize: 10,
          bold: true,
        },
      },
    ],
  });
  assert.equal(drawings[0].lineStyle, "solid");
  assert.equal(drawings[0].lineWidth, 3);
  assert.equal(drawings[1].tool, "text");
  assert.equal(drawings[1].fontSize, 10);
  assert.equal(drawings[1].bold, true);
});

test("drawing stroke styles resolve solid, dashed, dotted, and tool-default lines", async () => {
  const { tradingDrawingStrokeDashArray } = await import("../src/renderer/trading-expert-drawing.ts");

  assert.equal(tradingDrawingStrokeDashArray("solid"), "");
  assert.equal(tradingDrawingStrokeDashArray("dashed"), "7 5");
  assert.equal(tradingDrawingStrokeDashArray("dotted"), "2 4");
  assert.equal(tradingDrawingStrokeDashArray(undefined, true), "7 5");
  assert.equal(tradingDrawingStrokeDashArray("solid", true), "");
});

test("drawing tools expose single, two, three, multi-click, and drag placement modes", async () => {
  const {
    tradingDrawingPlacementMode,
    tradingDrawingRequiredPointCount,
    tradingDrawingToolDefinition,
  } = await import("../src/renderer/trading-expert-drawing.ts");

  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("trend-line")), "two-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("rectangle")), "two-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("circle")), "two-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("triangle")), "three-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("horizontal-line")), "single-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("text")), "single-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("anchored-text")), "single-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("note")), "single-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("price-note")), "two-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("brush")), "drag");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("xabcd")), "multi-click");
  assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition("cyclic-lines")), "two-click");

  const patternPointCounts = {
    xabcd: 5,
    cypher: 5,
    "head-shoulders": 7,
    abcd: 4,
    "triangle-pattern": 4,
    "three-drives": 7,
    "elliott-impulse": 6,
    "elliott-correction": 4,
    "elliott-triangle": 6,
  };
  for (const [id, count] of Object.entries(patternPointCounts)) {
    assert.equal(tradingDrawingRequiredPointCount(tradingDrawingToolDefinition(id)), count, id);
    assert.equal(tradingDrawingPlacementMode(tradingDrawingToolDefinition(id)), "multi-click", id);
  }
});

test("triangle vertices and circle radius follow their explicit clicked endpoints", async () => {
  const {
    tradingDrawingCircleGeometry,
    tradingDrawingTrianglePoints,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const first = { x: 20, y: 30 };
  const second = { x: 80, y: 42 };
  const third = { x: 56, y: 4 };

  assert.deepEqual(tradingDrawingTrianglePoints(first, second, third), [first, second, third]);
  assert.deepEqual(tradingDrawingCircleGeometry(first, second), {
    cx: 20,
    cy: 30,
    radius: Math.hypot(60, 12),
  });
});

test("multi-point drafts confirm one endpoint and one new segment per click", async () => {
  const { tradingDrawingAdvanceDraftPoints } = await import("../src/renderer/trading-expert-drawing.ts");
  const points = [
    { time: 100, price: 10 },
    { time: 100, price: 10 },
  ];
  const clicks = [
    { time: 200, price: 20 },
    { time: 300, price: 15 },
    { time: 400, price: 25 },
    { time: 500, price: 12 },
  ];
  let progress = { points, confirmedPointCount: 1, complete: false };

  for (const [index, click] of clicks.entries()) {
    progress = tradingDrawingAdvanceDraftPoints(
      progress.points,
      progress.confirmedPointCount,
      5,
      click,
    );
    assert.equal(progress.confirmedPointCount, index + 2);
    assert.equal(progress.complete, index === clicks.length - 1);
    assert.equal(progress.points.length, progress.complete ? 5 : index + 3);
    assert.deepEqual(progress.points.slice(0, progress.confirmedPointCount).at(-1), click);
  }

  assert.deepEqual(progress.points, [points[0], ...clicks]);
});

test("single-click lines keep and render exactly one control point", async () => {
  const drawing = await drawingSource;
  const storedDrawingBlock = drawing.slice(
    drawing.indexOf("function loadStoredDrawings("),
    drawing.indexOf("function formatDuration"),
  );
  const pointerDownBlock = drawing.slice(
    drawing.indexOf("private readonly handlePointerDown"),
    drawing.indexOf("private readonly handlePointerMove"),
  );
  const renderDrawingBlock = drawing.slice(
    drawing.indexOf("private renderDrawing("),
    drawing.indexOf("private renderDrawingHitTargets("),
  );

  assert.match(storedDrawingBlock, /tradingDrawingPlacementMode\(definition\) === "single-click"[\s\S]*?storedPoints\.slice\(0, 1\)/);
  assert.match(pointerDownBlock, /const placementMode = tradingDrawingPlacementMode\(definition\)/);
  assert.match(pointerDownBlock, /const requiredPointCount = tradingDrawingRequiredPointCount\(definition\)/);
  assert.match(pointerDownBlock, /points: requiredPointCount > 1 \? \[drawingPoint, drawingPoint\] : \[drawingPoint\]/);
  assert.match(renderDrawingBlock, /tradingDrawingPlacementMode\(definition\) === "single-click"[\s\S]*?pointEntries\.slice\(0, 1\)/);
});

test("closed drawing shapes expose their complete interior as a drag target", async () => {
  const {
    tradingDrawingClosedHitArea,
    tradingDrawingToolDefinition,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const first = { x: 10, y: 20 };
  const second = { x: 100, y: 70 };
  const third = { x: 72, y: 4 };

  assert.deepEqual(
    tradingDrawingClosedHitArea(tradingDrawingToolDefinition("rectangle"), first, second),
    { type: "rect", x: 10, y: 20, width: 90, height: 50 },
  );
  assert.deepEqual(
    tradingDrawingClosedHitArea(tradingDrawingToolDefinition("circle"), first, second),
    { type: "circle", cx: 10, cy: 20, radius: Math.hypot(90, 50) },
  );
  assert.deepEqual(
    tradingDrawingClosedHitArea(tradingDrawingToolDefinition("triangle"), first, second, third),
    { type: "polygon", points: [first, second, third] },
  );
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("rotated-rectangle"), first, second).type, "polygon");
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("parallel-channel"), first, second).type, "polygon");
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("fib-circles"), first, second).type, "circle");
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("gann-box"), first, second).type, "rect");
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("long-position"), first, second).type, "rect");
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("date-range"), first, second).type, "rect");
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("gann-fan"), first, second), null);
  assert.equal(tradingDrawingClosedHitArea(tradingDrawingToolDefinition("trend-line"), first, second), null);

  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);
  assert.match(drawing, /const closedArea = tradingDrawingClosedHitArea\(definition, first, second, third\)/);
  assert.match(drawing, /if \(closedArea\) return renderTradingDrawingClosedHitArea\(closedArea\)/);
  assert.match(styles, /\.trading-drawing-hit-target\.area\s*\{[^}]*fill: transparent;[^}]*stroke: none;[^}]*cursor: move;[^}]*pointer-events: all;/s);
});

test("Fibonacci retracement anchors the first click at 100 percent and the second at zero", async () => {
  const {
    formatTradingFibonacciPrice,
    tradingFibonacciLevelPrices,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const levels = tradingFibonacciLevelPrices(24.47, 2.584);

  assert.equal(levels[0].ratio, 1);
  assert.equal(levels[0].label, "100.0%");
  assert.equal(levels[0].price, 24.47);
  assert.equal(levels[3].ratio, 0.5);
  assert.equal(levels[3].price, 13.527);
  assert.equal(levels.at(-1).ratio, 0);
  assert.equal(levels.at(-1).label, "0.0%");
  assert.equal(levels.at(-1).price, 2.584);
  assert.equal(formatTradingFibonacciPrice(levels[0].price), "24.470");
  assert.equal(formatTradingFibonacciPrice(64_810.3), "64810.30");
});

test("drawing time coordinates extrapolate across the complete visible K-line canvas", async () => {
  const {
    tradingDrawingIsSingleCandlePatternSpan,
    tradingDrawingLogicalIndexAtTime,
    tradingDrawingTimeAtLogicalIndex,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const candles = [{ time: 100 }, { time: 200 }, { time: 400 }];

  assert.equal(tradingDrawingTimeAtLogicalIndex(candles, -1), 0);
  assert.equal(tradingDrawingTimeAtLogicalIndex(candles, 0.5), 150);
  assert.equal(tradingDrawingTimeAtLogicalIndex(candles, 1.5), 300);
  assert.equal(tradingDrawingTimeAtLogicalIndex(candles, 3), 600);
  assert.equal(tradingDrawingLogicalIndexAtTime(candles, 0), -1);
  assert.equal(tradingDrawingLogicalIndexAtTime(candles, 150), 0.5);
  assert.equal(tradingDrawingLogicalIndexAtTime(candles, 300), 1.5);
  assert.equal(tradingDrawingLogicalIndexAtTime(candles, 600), 3);
  assert.equal(tradingDrawingIsSingleCandlePatternSpan(candles, [{ time: 52 }, { time: 148 }]), true);
  assert.equal(tradingDrawingIsSingleCandlePatternSpan(candles, [{ time: 52 }, { time: 248 }]), false);
});

test("selected drawing endpoints expose price and date-time axis markers", async () => {
  const {
    formatTradingDrawingAxisPrice,
    formatTradingDrawingAxisTime,
    tradingDrawingAxisMarkerPoints,
    tradingDrawingToolDefinition,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const points = [
    { time: 100, price: 21.81 },
    { time: 200, price: 12.005 },
  ];

  assert.deepEqual(
    tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition("horizontal-line"), points),
    [{ point: points[0], showPrice: true, showTime: false }],
  );
  assert.deepEqual(
    tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition("vertical-line"), points),
    [{ point: points[0], showPrice: false, showTime: true }],
  );
  assert.deepEqual(
    tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition("trend-line"), points),
    points.map((point) => ({ point, showPrice: true, showTime: true })),
  );
  assert.deepEqual(
    tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition("ray"), points),
    points.map((point) => ({ point, showPrice: true, showTime: true })),
  );
  const trianglePoints = [...points, { time: 300, price: 16.75 }];
  assert.deepEqual(
    tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition("triangle"), trianglePoints),
    trianglePoints.map((point) => ({ point, showPrice: true, showTime: true })),
  );
  const patternPoints = [
    ...trianglePoints,
    { time: 400, price: 15.5 },
    { time: 500, price: 18.25 },
  ];
  assert.deepEqual(
    tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition("xabcd"), patternPoints),
    patternPoints.map((point) => ({ point, showPrice: true, showTime: true })),
  );
  assert.deepEqual(tradingDrawingAxisMarkerPoints(tradingDrawingToolDefinition("text"), points), []);
  assert.equal(formatTradingDrawingAxisPrice(21.81), "21.810");
  assert.equal(formatTradingDrawingAxisPrice(64_895), "64895.00");
  assert.equal(formatTradingDrawingAxisTime(0, 8 * 60 * 60), "1970-01-01 08:00");

  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);
  assert.match(drawing, /class="trading-drawing-axis-markers" data-drawing-axis-markers/);
  assert.match(drawing, /private updateAxisMarkers\(bounds:/);
  assert.match(drawing, /data-drawing-axis-price[\s\S]*?formatTradingDrawingAxisPrice\(marker\.point\.price\)/);
  assert.match(drawing, /data-drawing-axis-time[\s\S]*?formatTradingDrawingAxisTime\(marker\.point\.time, this\.timeOffsetSeconds\)/);
  assert.match(drawing, /this\.updateSelectionToolbar\(bounds\);[\s\S]*?this\.updateAxisMarkers\(bounds\)/);
  assert.match(styles, /\.trading-drawing-axis-marker\s*\{[^}]*background: var\(--trading-drawing-axis-marker\);[^}]*color: var\(--trading-drawing-axis-marker-text\);/s);
  assert.match(styles, /\.trading-drawing-axis-marker\.price\s*\{[^}]*transform: translateY\(-50%\);/s);
  assert.match(styles, /\.trading-drawing-axis-marker\.time\s*\{[^}]*bottom: 4px;[^}]*transform: translateX\(-50%\);/s);
  assert.match(styles, /--trading-market-crosshair-label: #7d838c;[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-crosshair-label: #626b77;/s);
  assert.match(styles, /--trading-drawing-axis-marker: #d7dade;[\s\S]*--trading-drawing-axis-marker-text: #4a515b;[\s\S]*html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-drawing-axis-marker: #858f9b;[\s\S]*--trading-drawing-axis-marker-text: #151a21;/s);
});

test("line, ray, and extended-line geometry clips to the visible plot", async () => {
  const { clipTradingDrawingLine } = await import("../src/renderer/trading-expert-drawing.ts");
  const first = { x: 20, y: 50 };
  const second = { x: 40, y: 60 };
  const bounds = { width: 100, height: 100 };

  assert.deepEqual(clipTradingDrawingLine(first, second, bounds, "segment"), [first, second]);
  assert.deepEqual(clipTradingDrawingLine(first, second, bounds, "ray"), [first, { x: 100, y: 90 }]);
  assert.deepEqual(clipTradingDrawingLine(first, second, bounds, "extended"), [
    { x: 0, y: 40 },
    { x: 100, y: 90 },
  ]);
  assert.deepEqual(
    clipTradingDrawingLine({ x: 50, y: 20 }, { x: 50, y: 40 }, bounds, "extended"),
    [{ x: 50, y: 0 }, { x: 50, y: 100 }],
  );
});

test("floating drawing toolbar stays inside the chart while moving independently", async () => {
  const { clampTradingDrawingToolbarPosition } = await import("../src/renderer/trading-expert-drawing.ts");
  const bounds = { width: 500, height: 300 };
  const toolbarSize = { width: 250, height: 40 };

  assert.deepEqual(
    clampTradingDrawingToolbarPosition({ x: -20, y: -10 }, bounds, toolbarSize),
    { x: 8, y: 8 },
  );
  assert.deepEqual(
    clampTradingDrawingToolbarPosition({ x: 480, y: 290 }, bounds, toolbarSize),
    { x: 242, y: 252 },
  );
});

test("drawing toolbar stays in the chart after removing the legacy vertical navigation", async () => {
  const [main, market, drawing, styles] = await Promise.all([
    mainSource,
    marketSource,
    drawingSource,
    stylesSource,
  ]);

  assert.doesNotMatch(main, /renderAppSidebar/);
  assert.match(market, /renderTradingDrawingToolbar\(\)/);
  assert.match(market, /renderTradingDrawingLayer\(\)/);
  assert.match(market, /new TradingDrawingController\(\{/);
  assert.match(market, /timeOffsetSeconds: CHINA_TIME_OFFSET_SECONDS/);
  assert.match(drawing, /timeScale\.coordinateToLogical\(screen\.x\)/);
  assert.match(drawing, /candleSeries\.coordinateToPrice\(screen\.y\)/);
  assert.match(drawing, /timeScale\.logicalToCoordinate/);
  assert.match(drawing, /candleSeries\.priceToCoordinate/);
  assert.match(drawing, /window\.localStorage\.setItem\([\s\S]*?tradingDrawingSessionStorageKey\("manual", this\.storageSessionId\)/);
  assert.match(drawing, /this\.snapPointToCandle\(point, screen\)/);
  assert.match(drawing, /this\.undo\(\)/);
  assert.match(drawing, /this\.redo\(\)/);
  assert.match(styles, /\.trading-drawing-toolbar\s*\{[^}]*width: 41\.6px;[^}]*min-width: 41\.6px;[^}]*flex: 0 0 41\.6px;/s);
  assert.match(styles, /\.trading-drawing-toolbar-scroll\s*\{[^}]*gap: 6px;/s);
  assert.match(styles, /\.trading-drawing-group\s*\{[^}]*width: 35\.2px;[^}]*height: 30px;[^}]*min-height: 30px;[^}]*flex: 0 0 30px;/s);
  assert.match(styles, /\.trading-drawing-primary\s*\{[^}]*width: 29\.6px;[^}]*height: 30px;/s);
  assert.match(styles, /\.trading-drawing-action\s*\{[^}]*width: 35\.2px;[^}]*height: 30px;[^}]*min-height: 30px;[^}]*flex: 0 0 30px;/s);
  assert.match(styles, /\.trading-drawing-layer\.drawing-active\s*\{[^}]*pointer-events: auto;[^}]*touch-action: none;/s);
});

test("drawing controls cover hover, active, focus, open, and disabled states in both themes", async () => {
  const styles = await stylesSource;
  assert.match(styles, /\.trading-drawing-primary:hover,[\s\S]*?background: var\(--trading-market-control\)/);
  assert.match(styles, /\.trading-drawing-primary\.active,[\s\S]*?background: var\(--trading-market-accent-soft\)/);
  assert.doesNotMatch(styles, /\.trading-drawing-group\.active,[^{]*\{[^}]*background: var\(--trading-market-accent-soft\)/);
  assert.match(styles, /\.trading-drawing-toolbar button:focus-visible,[\s\S]*?outline: 2px solid #2da6f7/);
  assert.match(
    styles,
    /\.trading-drawing-disclosure\s*\{[^}]*top: 0;[^}]*right: -3\.2px;[^}]*width: 9\.6px;[^}]*height: 30px;[^}]*place-items: center;/s,
  );
  assert.match(
    styles,
    /\.trading-drawing-disclosure:hover,[\s\S]*?\.trading-drawing-disclosure\[aria-expanded="true"\]\s*\{[^}]*background: var\(--trading-market-control\);[^}]*color: var\(--trading-market-text\);/s,
  );
  assert.doesNotMatch(styles, /\.trading-drawing-disclosure\[aria-expanded="true"\][^{]*\{[^}]*transform:/);
  assert.match(styles, /\.trading-drawing-action:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.32;/s);
  assert.match(styles, /\.trading-drawing-tool-menu\[hidden\]\s*\{[^}]*display: none !important;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-drawing-tool-menu\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-market-panel: #0f1014;[\s\S]*--trading-market-accent: #69a8ff;/s);
});

test("drawing trash confirms before permanently clearing manual, AI, and persisted history", async () => {
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);

  assert.match(drawing, /toolbarAction\("clear", "清空本会话所有绘图", "trash"\)/);
  assert.match(drawing, /data-drawing-clear-dialog[\s\S]*role="alertdialog"[\s\S]*aria-modal="true"/);
  assert.match(drawing, /本会话的手动绘图、AI 绘图及历史记录都将被永久删除，其他会话不受影响。此操作无法撤销。/);
  assert.match(drawing, /data-drawing-clear-action="cancel">取消<[\s\S]*data-drawing-clear-action="confirm">确认清空</);
  assert.match(drawing, /action === "clear"[\s\S]*this\.openClearDialog\(target\)/);
  assert.match(drawing, /action === "confirm"[\s\S]*this\.clearAllDrawings\(\)[\s\S]*this\.clearDialog\.close\(\)/);
  assert.match(drawing, /private clearAllDrawings\(\)[\s\S]*this\.aiPlayback\.cancel\(\)[\s\S]*const scopedClear = this\.drawingScope !== "main"[\s\S]*this\.drawings = scopedClear[\s\S]*this\.aiDrawings = scopedClear \? this\.aiDrawings : \[\][\s\S]*this\.redoStack = \[\]/);
  assert.match(drawing, /window\.localStorage\.removeItem\(tradingDrawingSessionStorageKey\("manual", this\.storageSessionId\)\)[\s\S]*window\.localStorage\.removeItem\(tradingDrawingSessionStorageKey\("ai", this\.storageSessionId\)\)/);
  assert.doesNotMatch(drawing, /private clearCurrentSymbol\(/);
  assert.match(styles, /\.trading-drawing-clear-dialog\s*\{[^}]*background: var\(--trading-market-panel\);[^}]*color: var\(--trading-market-text\);/s);
  assert.match(styles, /\.trading-drawing-clear-dialog button:hover:not\(:disabled\)[\s\S]*background: var\(--trading-market-control-hover\);/s);
  assert.match(styles, /\.trading-drawing-clear-dialog button:focus-visible\s*\{[^}]*outline: 2px solid #2da6f7;/s);
  assert.match(styles, /\.trading-drawing-clear-dialog button:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.46;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-drawing-clear-backdrop: rgba\(0, 0, 0, 0\.66\);[\s\S]*--trading-drawing-clear-danger: #f0526c;/s);
});

test("selected drawings expose endpoints, whole-line dragging, and the requested inline option bar", async () => {
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);

  assert.match(drawing, /mode: "handle" \| "drawing"/);
  assert.match(drawing, /drawing\.points\[this\.dragState\.handleIndex\] = point/);
  assert.match(drawing, /deltaTime = currentPoint\.time - this\.dragState\.startPoint\.time/);
  assert.match(drawing, /handleGrabOffset: ScreenPoint/);
  assert.match(drawing, /screenPoint\.x \+ this\.dragState\.handleGrabOffset\.x/);
  assert.match(drawing, /finiteTradingChartCoordinate\(timeScale\.coordinateToTime\(screen\.x\)\)/);
  assert.match(drawing, /document\.addEventListener\("pointermove", this\.handlePointerMove\)/);
  assert.match(drawing, /this\.queueDragRedraw\(\)/);
  assert.match(drawing, /timeScale\.coordinateToLogical\(screen\.x\)/);
  assert.match(drawing, /tradingDrawingLogicalToCoordinate\([\s\S]*?timeScale\.logicalToCoordinate\(integerLogical as any\)/);
  assert.match(drawing, /class="trading-drawing-handle" data-drawing-handle-index=/);
  assert.match(drawing, /class="trading-drawing-hit-target"/);
  for (const action of ["reset", "toggle-color", "toggle-style", "toggle-width", "toggle-lock", "delete"]) {
    assert.match(drawing, new RegExp(`selectionAction\\("${action}"`));
  }
  assert.doesNotMatch(drawing, /data-drawing-selection-action="settings?"/);
  assert.match(drawing, /color\?: string/);
  assert.match(drawing, /lineStyle\?: TradingDrawingLineStyle/);
  assert.match(drawing, /lineWidth\?: number/);

  assert.match(styles, /\.trading-drawing-hit-target\s*\{[^}]*stroke-width: 14px;[^}]*pointer-events: stroke;/s);
  assert.match(styles, /\.trading-drawing-handle\s*\{[^}]*cursor: grab;[^}]*pointer-events: all;/s);
  assert.match(styles, /\.trading-drawing-selection-action:hover,[\s\S]*?background: var\(--trading-market-control\)/);
  assert.match(styles, /\.trading-drawing-selection-action\[aria-expanded="true"\],[\s\S]*?background: var\(--trading-market-accent-soft\)/);
  assert.match(styles, /\.trading-drawing-selection-action:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.32;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-drawing-selection,[\s\S]*?background: #14171d;[\s\S]*?box-shadow:/s);
});

test("multi-click drafts follow the pointer until their final confirming click", async () => {
  const { tradingDrawingRewindDraftPoints } = await import("../src/renderer/trading-expert-drawing.ts");
  const drawing = await drawingSource;
  const first = { time: 1, price: 100 };
  const second = { time: 2, price: 110 };
  const cancelledThird = { time: 3, price: 105 };
  const preview = { time: 4, price: 108 };

  assert.deepEqual(
    tradingDrawingRewindDraftPoints([first, second, cancelledThird, preview], 3, preview),
    {
      points: [first, second, preview],
      confirmedPointCount: 2,
      complete: false,
    },
  );
  assert.deepEqual(
    tradingDrawingRewindDraftPoints([first, preview], 1, preview),
    { points: [], confirmedPointCount: 0, complete: false },
  );

  assert.match(drawing, /private draftConfirmedPointCount = 0/);
  assert.match(drawing, /private draftRequiredPointCount = 0/);
  assert.match(drawing, /if \(this\.draft && this\.hasPendingDraftPoint\(\)\)/);
  assert.match(drawing, /const previewIndex = this\.draftConfirmedPointCount/);
  assert.match(drawing, /this\.draft\.points\[previewIndex\] = drawingPoint/);
  assert.match(drawing, /tradingDrawingAdvanceDraftPoints\([\s\S]*?this\.draftRequiredPointCount,[\s\S]*?drawingPoint/);
  assert.match(drawing, /this\.draft\.points = progress\.points[\s\S]*?this\.draftConfirmedPointCount = progress\.confirmedPointCount/);
  assert.match(drawing, /if \(!progress\.complete\)/);
  assert.match(drawing, /this\.overlay\.addEventListener\("contextmenu", this\.handleContextMenu\)/);
  assert.match(drawing, /private readonly handleContextMenu = \(event: MouseEvent\)[\s\S]*?if \(!this\.userDrawingEnabled \|\| !this\.draft \|\| !this\.hasPendingDraftPoint\(\)\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);/);
  assert.match(drawing, /tradingDrawingRewindDraftPoints\([\s\S]*?this\.draft\.points = progress\.points;[\s\S]*?this\.draftConfirmedPointCount = progress\.confirmedPointCount;/);
  assert.match(drawing, /已取消第 \$\{cancelledPointNumber\} 个端点，前 \$\{progress\.confirmedPointCount\} 个端点已保留/);
  assert.match(drawing, /this\.overlay\.removeEventListener\("contextmenu", this\.handleContextMenu\)/);
  assert.match(drawing, /definition\?\.kind === "pattern"[\s\S]*?共 \$\{this\.draftRequiredPointCount\} 个/);
  assert.match(drawing, /第二个端点已设置[\s\S]*?移动鼠标选择第三个端点/);
  assert.match(drawing, /this\.renderPattern\(points, definition, color, lineAppearance\)/);
  assert.match(drawing, /definition\.kind === "pattern" && points\.length > 1[\s\S]*?points\.slice\(1\)\.map/);
});

test("text annotations use an in-chart editor and dedicated formatting toolbar", async () => {
  const { tradingDrawingTextLayout } = await import("../src/renderer/trading-expert-drawing.ts");
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);
  const pointerDownBlock = drawing.slice(
    drawing.indexOf("private readonly handlePointerDown"),
    drawing.indexOf("private readonly handlePointerMove"),
  );
  const selectionMarkup = drawing.slice(
    drawing.indexOf("function renderTradingDrawingSelectionToolbar()"),
    drawing.indexOf("export function renderTradingDrawingLayer()"),
  );

  const textLayout = tradingDrawingTextLayout("第一行\n第二行", 16);
  assert.deepEqual(textLayout.lines, ["第一行", "第二行"]);
  assert.equal(textLayout.lineHeight, 20.8);
  assert.equal(textLayout.width, 48);
  assert.equal(textLayout.height, 41.6);
  const wrappedLayout = tradingDrawingTextLayout("中枢上沿突破后等待回踩确认，跌回区间则视为假突破。", 12.8, 128);
  assert.ok(wrappedLayout.lines.length >= 3);
  assert.ok(wrappedLayout.lineWidths.every((width) => width <= 128));
  assert.match(pointerDownBlock, /if \(definition\.kind === "text" && placementMode === "single-click"\) \{[\s\S]*?this\.beginTextDrawing\(definition\.id, drawingPoint, screenPoint\);/);
  assert.doesNotMatch(pointerDownBlock, /window\.prompt/);
  assert.match(selectionMarkup, /data-drawing-selection-mode="text"[\s\S]*?selectionAction\("edit-text"/);
  assert.match(selectionMarkup, /selectionAction\("reset-text"[\s\S]*?selectionAction\("edit-text"/);
  assert.match(selectionMarkup, /data-drawing-text-input[\s\S]*?>清空<[\s\S]*?>确定</);
  assert.match(selectionMarkup, /toggle-text-color[\s\S]*?toggle-text-background[\s\S]*?toggle-font-size[\s\S]*?toggle-bold[\s\S]*?toggle-lock[\s\S]*?delete/);
  assert.doesNotMatch(selectionMarkup, /data-drawing-selection-action="settings?"/);
  assert.match(drawing, /const DEFAULT_TEXT_COLOR_LIGHT = "#4b5563"/);
  assert.match(drawing, /textBackgroundColor\?: string[\s\S]*?fontSize\?: number[\s\S]*?bold\?: boolean/);
  assert.match(drawing, /if \(action === "clear-text"\)[\s\S]*?input\.value = "";[\s\S]*?if \(action === "confirm-text"\)[\s\S]*?this\.confirmTextInput\(drawing\)/);
  assert.match(drawing, /const fontWeight = drawing\.bold \? 700 : 400[\s\S]*?font-weight="\$\{fontWeight\}"/);
  assert.match(styles, /\.trading-drawing-selection-popover\.text-input textarea\s*\{[^}]*background: var\(--trading-market-control\);[^}]*color: var\(--trading-market-text\);/s);
  assert.match(styles, /\.trading-drawing-selection-popover\.text-input > footer button:hover,[\s\S]*?button:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-drawing-color-grid > button\.transparent > span/);
});

test("AI note labels disperse as a group and avoid visible candles", async () => {
  const { layoutTradingAiNoteBoxes } = await import("../src/renderer/trading-expert-drawing.ts");
  const bounds = { width: 1200, height: 800 };
  const notes = Array.from({ length: 4 }, (_, index) => ({
    id: `note-${index}`,
    anchor: { x: 300 + index * 8, y: 430 + index * 5 },
    text: `结构标注 ${index + 1}：等待确认并观察关键位置，失效后重新评估。`,
    fontSize: 10,
  }));
  const candleObstacles = Array.from({ length: 24 }, (_, index) => ({
    x: 120 + index * 12,
    y: 300 + (index % 4) * 8,
    width: 9,
    height: 260,
  }));
  const placements = layoutTradingAiNoteBoxes(notes, bounds, candleObstacles);
  const rectFor = (placement) => ({
    x: placement.geometry.boxLeft,
    y: placement.geometry.boxTop,
    width: placement.geometry.boxWidth,
    height: placement.geometry.boxHeight,
  });
  const overlaps = (first, second, gap = 0) => (
    first.x < second.x + second.width + gap
    && first.x + first.width + gap > second.x
    && first.y < second.y + second.height + gap
    && first.y + first.height + gap > second.y
  );

  assert.equal(placements.length, notes.length);
  for (let firstIndex = 0; firstIndex < placements.length; firstIndex += 1) {
    const firstRect = rectFor(placements[firstIndex]);
    assert.ok(firstRect.x >= 6 && firstRect.x + firstRect.width <= bounds.width - 6);
    assert.ok(firstRect.y >= 40 && firstRect.y + firstRect.height <= bounds.height - 6);
    assert.ok(firstRect.width <= 200);
    assert.ok(placements[firstIndex].geometry.layout.lines.length >= 2);
    assert.ok(candleObstacles.every((obstacle) => !overlaps(firstRect, obstacle, 8)));
    for (let secondIndex = firstIndex + 1; secondIndex < placements.length; secondIndex += 1) {
      assert.equal(overlaps(firstRect, rectFor(placements[secondIndex]), 12), false);
    }
    const { boxLeft, boxTop, layout, textStartPoint } = placements[firstIndex].geometry;
    assert.deepEqual(textStartPoint, {
      x: boxLeft,
      y: boxTop + layout.lineHeight / 2,
    });
    assert.ok(
      Math.abs(notes[firstIndex].anchor.y - textStartPoint.y) >= 14,
      "AI note leaders should prefer a visible diagonal instead of a horizontal segment",
    );
  }
});

test("price-action candlestick labels avoid one another, candles, and strategy drawings", async () => {
  const {
    layoutTradingAiNoteBoxes,
    tradingDrawingIsPriceActionCandlestickPatternLabel,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const bounds = { width: 800, height: 500 };
  const labels = Array.from({ length: 3 }, (_, index) => ({
    id: `pattern-label-${index}`,
    anchor: { x: 330 + index * 12, y: 250 + index * 4 },
    text: index === 2 ? "long-legged-doji" : "spinning-top",
    fontSize: 12,
    avoidBoxInteriors: true,
    maxLeaderDistance: 180,
  }));
  const candleObstacles = Array.from({ length: 14 }, (_, index) => ({
    x: 270 + index * 13,
    y: 190 + (index % 3) * 7,
    width: 10,
    height: 180,
  }));
  const drawingObstacles = [
    { x: 250, y: 150, width: 220, height: 130 },
    { x: 500, y: 205, width: 95, height: 24 },
  ];
  const placements = layoutTradingAiNoteBoxes(labels, bounds, candleObstacles, drawingObstacles);
  const rectFor = ({ geometry }) => ({
    x: geometry.boxLeft,
    y: geometry.boxTop,
    width: geometry.boxWidth,
    height: geometry.boxHeight,
  });
  const overlaps = (first, second, gap = 0) => (
    first.x < second.x + second.width + gap
    && first.x + first.width + gap > second.x
    && first.y < second.y + second.height + gap
    && first.y + first.height + gap > second.y
  );

  assert.equal(placements.length, labels.length);
  placements.forEach((placement, index) => {
    const rect = rectFor(placement);
    assert.ok(candleObstacles.every((obstacle) => !overlaps(rect, obstacle, 8)));
    assert.ok(drawingObstacles.every((obstacle) => !overlaps(rect, obstacle, 8)));
    for (let other = index + 1; other < placements.length; other += 1) {
      assert.equal(overlaps(rect, rectFor(placements[other]), 12), false);
    }
  });
  assert.equal(tradingDrawingIsPriceActionCandlestickPatternLabel({
    id: "analysis-candlestick-pattern-label-1",
    source: "ai",
    strategyId: "price-action",
  }), true);
  assert.equal(tradingDrawingIsPriceActionCandlestickPatternLabel({
    id: "analysis-candlestick-pattern-label-1",
    source: "ai",
    strategyId: "harmonic",
  }), false);

  const drawing = await drawingSource;
  assert.match(drawing, /const aiTextLayoutRequests = \[\.\.\.aiCandlestickLabelRequests, \.\.\.aiNoteRequests\]/);
  assert.match(drawing, /avoidBoxInteriors: true,[\s\S]*?maxLeaderDistance: 180/);
  assert.match(drawing, /visiblePriceActionDrawingObstacles\(aiDrawings, bounds\)/);
  assert.match(drawing, /resolvedTextGeometry\.boxLeft \+ resolvedTextGeometry\.boxWidth \/ 2/);
});

test("live order-flow note leaders stay near their execution candle", async () => {
  const { layoutTradingAiNoteBoxes } = await import("../src/renderer/trading-expert-drawing.ts");
  const anchor = { x: 1040, y: 520 };
  const placements = layoutTradingAiNoteBoxes(Array.from({ length: 5 }, (_, index) => ({
    id: `micro-note-${index}`,
    anchor: { x: anchor.x, y: anchor.y + index * 3 },
    text: ["大额主动卖出", "成交密集价（POC）", "主动卖出失衡区", "主动买入失衡区", "大额主动买入"][index],
    fontSize: 10,
    maxLeaderDistance: 220,
  })), { width: 1200, height: 800 }, Array.from({ length: 24 }, (_, index) => ({
    x: 850 + index * 10,
    y: 380 + (index % 4) * 12,
    width: 8,
    height: 220,
  })));

  assert.equal(placements.length, 5);
  assert.ok(placements.every(({ geometry }) => (
    Math.abs(geometry.textStartPoint.x - anchor.x) <= 220
  )));
  const drawing = await drawingSource;
  assert.match(drawing, /\["order-flow-buy", "order-flow-sell", "order-flow-poc"\][\s\S]*?\? 220/);
});

test("order-flow note labels stay outside every visible structure box", async () => {
  const { layoutTradingAiNoteBoxes } = await import("../src/renderer/trading-expert-drawing.ts");
  const boxObstacles = [
    { x: 360, y: 260, width: 420, height: 260 },
    { x: 520, y: 390, width: 260, height: 180 },
  ];
  const placements = layoutTradingAiNoteBoxes([
    {
      id: "order-flow-fvg-label",
      anchor: { x: 520, y: 330 },
      text: "[4H] 支撑：回调缺口（FVG）",
      fontSize: 10,
      avoidBoxInteriors: true,
    },
    {
      id: "order-flow-ote-label",
      anchor: { x: 620, y: 470 },
      text: "[1H] OTE 0.618–0.786",
      fontSize: 10,
      avoidBoxInteriors: true,
    },
  ], { width: 1200, height: 800 }, [], boxObstacles);
  const overlaps = (first, second, gap = 0) => (
    first.x < second.x + second.width + gap
    && first.x + first.width + gap > second.x
    && first.y < second.y + second.height + gap
    && first.y + first.height + gap > second.y
  );

  assert.equal(placements.length, 2);
  for (const { geometry } of placements) {
    const labelRect = {
      x: geometry.boxLeft,
      y: geometry.boxTop,
      width: geometry.boxWidth,
      height: geometry.boxHeight,
    };
    assert.ok(boxObstacles.every((box) => !overlaps(labelRect, box, 8)));
  }
  const drawing = await drawingSource;
  assert.match(drawing, /const isOrderFlowNote = String\(drawing\.colorToken \|\| ""\)\.startsWith\("order-flow-"\)/);
  assert.match(drawing, /avoidBoxInteriors: isOrderFlowNote \|\| isGannTheoryNote/);
  assert.match(drawing, /visibleOrderFlowBoxObstacles\(aiDrawings, bounds\)/);
});

test("Gann notes stay outside visible Gann squares and remain connected to their anchors", async () => {
  const {
    layoutTradingAiNoteBoxes,
    tradingDrawingIsGannTheoryBox,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const gannSquare = { x: 280, y: 170, width: 360, height: 280 };
  const notes = [
    {
      id: "gann-summary",
      anchor: { x: 470, y: 310 },
      text: "江恩：高点锚定的下降投影 · 1x1 62951.44 · 等待收盘确认",
      fontSize: 11,
      avoidBoxInteriors: true,
      maxLeaderDistance: 360,
    },
    {
      id: "gann-cycle",
      anchor: { x: 520, y: 350 },
      text: "轮中轮 1/2 周期",
      fontSize: 11,
      avoidBoxInteriors: true,
      maxLeaderDistance: 360,
    },
  ];
  const placements = layoutTradingAiNoteBoxes(
    notes,
    { width: 1000, height: 650 },
    [],
    [gannSquare],
  );
  const overlaps = (first, second, gap = 0) => (
    first.x < second.x + second.width + gap
    && first.x + first.width + gap > second.x
    && first.y < second.y + second.height + gap
    && first.y + first.height + gap > second.y
  );

  assert.equal(placements.length, notes.length);
  for (const [index, placement] of placements.entries()) {
    const rect = {
      x: placement.geometry.boxLeft,
      y: placement.geometry.boxTop,
      width: placement.geometry.boxWidth,
      height: placement.geometry.boxHeight,
    };
    assert.equal(overlaps(rect, gannSquare, 8), false);
    assert.ok(Math.abs(placement.geometry.textStartPoint.x - notes[index].anchor.x) <= 360);
  }
  assert.equal(tradingDrawingIsGannTheoryBox({
    source: "ai",
    strategyId: "gann-theory",
    tool: "rectangle",
  }), true);
  assert.equal(tradingDrawingIsGannTheoryBox({
    source: "ai",
    strategyId: "gann-theory",
    tool: "path",
  }), false);

  const drawing = await drawingSource;
  assert.match(drawing, /avoidBoxInteriors: isOrderFlowNote \|\| isGannTheoryNote/);
  assert.match(drawing, /visibleGannTheoryBoxObstacles\(aiDrawings, bounds\)/);
  assert.match(drawing, /gannTheoryBoxObstacles/);
});

test("anchored text, note, and price note complete creation, editing, and rendering flows", async () => {
  const {
    tradingDrawingAnchoredScreenPoint,
    tradingDrawingNoteBoxGeometry,
    tradingDrawingScreenPointVisible,
    tradingDrawingViewportAnchor,
  } = await import("../src/renderer/trading-expert-drawing.ts");
  const drawing = await drawingSource;
  const pointerDownBlock = drawing.slice(
    drawing.indexOf("private readonly handlePointerDown"),
    drawing.indexOf("private readonly handlePointerMove"),
  );
  const commitBlock = drawing.slice(
    drawing.indexOf("private commitDraft()"),
    drawing.indexOf("private cancelDraft()"),
  );
  const textRenderer = drawing.slice(
    drawing.indexOf("private renderText("),
    drawing.indexOf("private renderMarker("),
  );
  const noteRenderer = textRenderer.slice(textRenderer.indexOf("const geometry = noteGeometry"));
  const noteVisualRenderer = noteRenderer.slice(0, noteRenderer.indexOf("private renderTextHitTargets"));

  const bounds = { width: 1200, height: 800 };
  const anchor = tradingDrawingViewportAnchor({ x: 300, y: 600 }, bounds);
  assert.deepEqual(anchor, { x: 0.25, y: 0.75 });
  assert.deepEqual(tradingDrawingAnchoredScreenPoint(anchor, { width: 1600, height: 1000 }), {
    x: 400,
    y: 750,
  });
  assert.deepEqual(tradingDrawingViewportAnchor({ x: -20, y: 900 }, bounds), { x: 0, y: 1 });
  assert.equal(tradingDrawingScreenPointVisible({ x: 0, y: 0 }, bounds), true);
  assert.equal(tradingDrawingScreenPointVisible({ x: 1200, y: 800 }, bounds), true);
  assert.equal(tradingDrawingScreenPointVisible({ x: -0.01, y: 400 }, bounds), false);
  assert.equal(tradingDrawingScreenPointVisible({ x: 600, y: 800.01 }, bounds), false);
  const noteBox = tradingDrawingNoteBoxGeometry(
    { x: 1192, y: 24 },
    "中枢上沿突破后等待回踩确认，跌回区间则视为假突破。",
    12.8,
    bounds,
  );
  assert.ok(noteBox.layout.lines.length > 1);
  assert.ok(noteBox.boxLeft >= 6 && noteBox.boxLeft + noteBox.boxWidth <= bounds.width - 6);
  assert.ok(noteBox.boxTop >= 6 && noteBox.boxTop + noteBox.boxHeight <= bounds.height - 6);
  assert.ok(noteBox.layout.lineWidths.every((width) => width <= noteBox.boxWidth - 20));

  assert.match(drawing, /viewportAnchor\?: ScreenPoint/);
  assert.match(drawing, /tool === "anchored-text"[\s\S]*?tradingDrawingViewportAnchor\(screenPoint, this\.plotBounds\(\)\)/);
  assert.match(drawing, /drawing\.tool === "anchored-text"[\s\S]*?tradingDrawingAnchoredScreenPoint\(drawing\.viewportAnchor, bounds\)/);
  assert.match(drawing, /originalViewportAnchor:[\s\S]*?drawing\.viewportAnchor/);
  assert.match(pointerDownBlock, /text: definition\.id === "price-note" \? formatTradingDrawingAxisPrice\(drawingPoint\.price\) : undefined/);
  assert.match(commitBlock, /const pendingText = definition\?\.kind === "text"[\s\S]*?this\.pendingTextDrawingId = completed\.id[\s\S]*?this\.openPendingTextEditor\(completed\)/);
  assert.match(drawing, /const textMode = definition\?\.kind === "text"/);
  assert.match(drawing, /data-drawing-text-input-title/);
  assert.match(drawing, /title\.textContent = `\$\{definition\?\.label \?\? "文本"\}输入`/);
  assert.match(textRenderer, /toolId === "text" \|\| toolId === "anchored-text"/);
  assert.match(textRenderer, /toolId === "price-note"[\s\S]*?class="trading-price-note"[\s\S]*?svgLine\(point, labelPoint, color, appearance\)/);
  assert.match(textRenderer, /class="trading-note"/);
  assert.match(noteRenderer, /svgLine\(point, geometry\.textStartPoint, color,[\s\S]*?style: drawing\.source === "ai" \? "dashed" : appearance\.style/);
  assert.match(noteRenderer, /class="trading-note-anchor"/);
  assert.match(noteRenderer, /textLines\(geometry\.boxLeft, geometry\.boxTop \+ fontSize\)/);
  assert.doesNotMatch(noteVisualRenderer, /<rect\b/);
  assert.doesNotMatch(noteRenderer, /geometry\.tailX|geometry\.tailEdgeY/);
  assert.match(drawing, /layoutTradingAiNoteBoxes\([\s\S]*?this\.visibleCandleObstacles\(bounds\)/);
  assert.match(drawing, /if \(drawing\.tool === "note" && !textLayout\) return ""/);
  assert.match(drawing, /const nearHorizontalPenalty = Math\.max\(0, diagonalThreshold - verticalSeparation\) \* 5_000/);
  assert.match(textRenderer, /private renderTextHitTargets\([\s\S]*?points: ScreenPoint\[],[\s\S]*?drawing: TradingDrawingModel,[\s\S]*?bounds: \{ width: number; height: number \}/);
  assert.match(drawing, /const AI_NOTE_FONT_SIZE = 10/);
  assert.match(drawing, /const AI_NOTE_TEXT_MAX_WIDTH = 200/);
  assert.match(drawing, /fontSize: drawing\.fontSize \?\? \(drawing\.tool === "note" \? AI_NOTE_FONT_SIZE : undefined\)/);
  assert.match(textRenderer, /trading-ai-inline-label/);
  assert.match(textRenderer, /textLength="\$\{layout\.lineWidths\[index\]\}" lengthAdjust="spacingAndGlyphs"/);
});

test("professional AI inline labels remain readable in light and dark themes", async () => {
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);
  assert.match(styles, /\.trading-ai-inline-label\s*\{[^}]*paint-order: stroke fill;[^}]*stroke: var\(--trading-market-panel\);[^}]*stroke-width: 3px;[^}]*text-anchor: middle;/s);
  assert.match(styles, /--trading-market-panel: #ffffff;[\s\S]*?--trading-ai-strategy-support: #078c53;[\s\S]*?--trading-ai-strategy-resistance: #dc3658;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*?--trading-market-panel: #0f1014;[\s\S]*?--trading-ai-strategy-support: #52dc88;[\s\S]*?--trading-ai-strategy-resistance: #ff718e;/);
  assert.match(drawing, /tradingDrawingIsPriceActionCandlestickPatternLabel[\s\S]*?strategyId === "price-action"[\s\S]*?candlestick-pattern-label-/);
  assert.match(styles, /--trading-price-action-candlestick-label: #6d4acb;[\s\S]*?html\[data-theme="dark"\] \.trading-expert-market[\s\S]*?--trading-price-action-candlestick-label: #ffffff;/);
  assert.match(styles, /\.trading-ai-inline-label\.trading-price-action-candlestick-label\s*\{[^}]*fill: var\(--trading-price-action-candlestick-label\);[^}]*paint-order: normal;[^}]*stroke: none;[^}]*font-weight: 400;/s);
  assert.match(drawing, /trading-price-action-candlestick-label-leader[\s\S]*?resolvedTextGeometry\.connectorPoint\.x[\s\S]*?trading-price-action-candlestick-label-target/);
  assert.match(styles, /\.trading-price-action-candlestick-label-leader\s*\{[^}]*stroke: var\(--trading-price-action-candlestick-label\);[^}]*stroke-width: 1\.2px;[^}]*stroke-dasharray: 4 4;[^}]*vector-effect: non-scaling-stroke;/s);
  assert.match(styles, /\.trading-price-action-candlestick-label-target\s*\{[^}]*fill: var\(--trading-price-action-candlestick-label\);[^}]*stroke: none;/s);
  assert.match(drawing, /const orderedAiDrawings = \[\.\.\.aiDrawings\]\.sort\([\s\S]*?tradingDrawingPriceActionCandlestickLayerRank/);
  assert.match(drawing, /tradingDrawingIsPriceActionCandlestickPatternEllipse\(drawing\)[\s\S]*?trading-price-action-candlestick-pattern-ellipse/);
  assert.match(drawing, /tradingDrawingIsPriceActionCandlestickPatternEllipse\(drawing\)[\s\S]*?tradingDrawingIsSingleCandlePatternSpan\(this\.getCandles\(\), drawing\.points\)[\s\S]*?return ""/);
  assert.match(styles, /\.trading-price-action-candlestick-pattern-ellipse\s*\{[^}]*fill: var\(--trading-price-action-candlestick-label\);[^}]*stroke: var\(--trading-price-action-candlestick-label\);[^}]*stroke-width: 0\.8px;[^}]*stroke-dasharray: none;[^}]*vector-effect: non-scaling-stroke;/s);
});

test("AI text annotations keep resize controls pinned to the topmost label", async () => {
  const { positionTradingAiTextSizeToolbar, tradingAiTextNextFontSize } = await import(
    "../src/renderer/trading-expert-drawing.ts"
  );
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);

  assert.equal(tradingAiTextNextFontSize(10, "decrease"), 9);
  assert.equal(tradingAiTextNextFontSize(10, "increase"), 11);
  assert.equal(tradingAiTextNextFontSize(13, "decrease"), 12);
  assert.equal(tradingAiTextNextFontSize(13, "increase"), 14);
  assert.equal(tradingAiTextNextFontSize(8, "decrease"), 8);
  assert.equal(tradingAiTextNextFontSize(36, "increase"), 36);

  assert.deepEqual(
    positionTradingAiTextSizeToolbar(
      { x: 180, y: 100, width: 160, height: 48 },
      { width: 500, height: 300 },
      { width: 66, height: 34 },
    ),
    { x: 108, y: 107 },
  );
  assert.deepEqual(
    positionTradingAiTextSizeToolbar(
      { x: 20, y: 10, width: 120, height: 20 },
      { width: 500, height: 300 },
      { width: 66, height: 34 },
    ),
    { x: 146, y: 8 },
  );
  assert.deepEqual(
    positionTradingAiTextSizeToolbar(
      { x: 20, y: 10, width: 120, height: 20 },
      { width: 500, height: 300 },
      { width: 66, height: 34 },
      "left",
    ),
    { x: 8, y: 8 },
  );

  assert.match(drawing, /data-ai-text-hit-content aria-label="AI 文字标注字号调节"/);
  assert.match(drawing, /data-ai-text-size-toolbar role="toolbar" aria-label="当前图表全部 AI 标注字号" hidden/);
  assert.match(drawing, /data-ai-text-size-action="decrease"[\s\S]*?data-ai-text-size-action="increase"/);
  assert.match(drawing, /class="trading-ai-text-size-toolbar-dismiss" data-ai-text-size-action="dismiss"[\s\S]*?>[\s\S]*?×/);
  assert.match(drawing, /renderAiTextSizeHitTarget\([\s\S]*?data-ai-text-size-trigger/);
  assert.match(drawing, /handleAiTextPointerOver[\s\S]*?showAiTextSizeToolbar/);
  assert.match(drawing, /aiTextDrawingsForCurrentContext\(\)[\s\S]*?this\.aiDrawings\.filter/);
  assert.match(drawing, /adjustAiTextFontSize\([\s\S]*?for \(const textDrawing of this\.aiTextDrawingsForCurrentContext\(\)\)[\s\S]*?textDrawing\.fontSize = next;[\s\S]*?this\.persistAiDrawings\(\);[\s\S]*?this\.redraw\(\);/);
  assert.match(drawing, /tradingAiDrawingMatchesContext\(drawing, symbol, interval\)/);
  assert.match(drawing, /const disabled = textDrawings\.every\([\s\S]*?button\.disabled = disabled/);
  assert.match(drawing, /topmostAiTextSizeTarget\(\)[\s\S]*?bounds\.y < topmost\.bounds\.y/);
  assert.match(drawing, /positionTradingAiTextSizeToolbar\([\s\S]*?\{ x, y, width, height \}[\s\S]*?"left"/);
  assert.match(drawing, /The controls are pinned to the topmost visible annotation/);
  assert.match(drawing, /aiTextSizeToolbarDismissed[\s\S]*?dismissAiTextSizeToolbar/);
  assert.match(drawing, /button\?\.dataset\.aiTextSizeAction[\s\S]*?action === "dismiss"[\s\S]*?dismissAiTextSizeToolbar/);

  assert.match(styles, /\.trading-ai-text-size-trigger\s*\{[^}]*pointer-events: all;/s);
  assert.match(styles, /\.trading-ai-text-size-toolbar\s*\{[^}]*background: color-mix\(in srgb, var\(--trading-market-panel\) 96%, transparent\);[^}]*pointer-events: auto;/s);
  assert.match(styles, /\.trading-ai-text-size-toolbar > button:hover,[\s\S]*?background: var\(--trading-market-control\);[\s\S]*?color: var\(--trading-market-text\);/);
  assert.match(styles, /\.trading-ai-text-size-toolbar > button:active\s*\{[^}]*background: var\(--trading-market-accent-soft\);[^}]*color: var\(--trading-market-accent\);/s);
  assert.match(styles, /\.trading-ai-text-size-toolbar > button:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.32;/s);
  assert.match(styles, /\.trading-ai-text-size-toolbar > button\.trading-ai-text-size-toolbar-dismiss\s*\{[^}]*top: -8px;[^}]*right: -8px;[^}]*opacity: 0;[^}]*pointer-events: none;/s);
  assert.match(styles, /\.trading-ai-text-size-toolbar:hover > button\.trading-ai-text-size-toolbar-dismiss,[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/s);
  assert.match(styles, /\.trading-ai-text-size-toolbar > button\.trading-ai-text-size-toolbar-dismiss:active\s*\{[^}]*background: var\(--trading-market-accent-soft\);[^}]*color: var\(--trading-market-accent\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-ai-text-size-toolbar\s*\{[^}]*background: #14171d;[^}]*box-shadow: 0 16px 42px rgba\(0, 0, 0, 0\.54\);/s);
});

test("Fibonacci retracement matches the full-width colored reference in both themes", async () => {
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);

  assert.match(drawing, /TRADING_FIBONACCI_LEVELS = \[[\s\S]*ratio: 1, label: "100\.0%"[\s\S]*ratio: 0, label: "0\.0%"/);
  assert.match(drawing, /second\.y \+ \(first\.y - second\.y\) \* level\.ratio/);
  assert.match(drawing, /class="trading-fibonacci-level-line" x1="0"[\s\S]*x2="\$\{bounds\.width\}"/);
  assert.match(drawing, /class="trading-fibonacci-connector"[\s\S]*svgStrokeAttributes\(\{ \.\.\.appearance, dashed: true \}, 1\.5\)/);
  assert.match(drawing, /class="trading-drawing-handle fibonacci"[\s\S]*data-fibonacci-endpoint="\$\{index === 0 \? "100" : "0"\}"/);
  assert.match(drawing, /definition\?\.kind === "fib"[\s\S]*100%[\s\S]*0%/);
  assert.match(styles, /--trading-fibonacci-level-pink: #c61ca4;[\s\S]*--trading-fibonacci-level-blue: #246dcc;/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-expert-market\s*\{[\s\S]*--trading-fibonacci-level-pink: #ff72d5;[\s\S]*--trading-fibonacci-level-blue: #78adff;/);
  assert.match(styles, /\.trading-fibonacci-label\s*\{[^}]*paint-order: stroke fill;[^}]*stroke: var\(--trading-fibonacci-label-outline\);[^}]*font-weight: 600;/s);
  assert.match(styles, /\.trading-drawing-handle\.fibonacci\s*\{[^}]*--trading-fibonacci-handle-stroke/s);
});

test("selection color, line style, and width apply to Fibonacci and every stroked drawing family", async () => {
  const drawing = await drawingSource;
  const selectionHandler = drawing.slice(
    drawing.indexOf("private readonly handleSelectionToolbarClick"),
    drawing.indexOf("private readonly handleOutsidePointerDown"),
  );
  const renderDrawing = drawing.slice(
    drawing.indexOf("private renderDrawing("),
    drawing.indexOf("private renderDrawingHitTargets("),
  );
  const specializedRenderers = drawing.slice(
    drawing.indexOf("private renderChannel("),
    drawing.indexOf("destroy()"),
  );

  assert.match(selectionHandler, /drawing\.color = color[\s\S]*?persistDrawingEdit\("已更新颜色"\)/);
  assert.match(selectionHandler, /drawing\.lineStyle = style[\s\S]*?persistDrawingEdit\("已更新线条样式"\)/);
  assert.match(selectionHandler, /drawing\.lineWidth = width[\s\S]*?persistDrawingEdit\("已更新线宽"\)/);
  assert.match(renderDrawing, /const lineAppearance: TradingDrawingStrokeAppearance = \{[\s\S]*?width: drawing\.lineWidth,[\s\S]*?style: drawing\.lineStyle/);
  assert.match(renderDrawing, /this\.renderFib\([\s\S]*?color,[\s\S]*?Boolean\(drawing\.color\),[\s\S]*?lineAppearance/);
  assert.match(specializedRenderers, /const levelColor = customColor \? color : level\.color/);
  assert.match(specializedRenderers, /trading-fibonacci-level-line[\s\S]*?svgStrokeAttributes\(appearance, 1\.25\)/);
  for (const renderer of [
    "renderChannel", "renderPitchfork", "renderGann", "renderTimeZones", "renderFibCircles",
    "renderRotatedRectangle", "renderCurve", "renderText", "renderPattern", "renderPosition",
    "renderRange", "renderProjection", "renderMeasurement",
  ]) {
    assert.match(specializedRenderers, new RegExp(`private ${renderer}\\([\\s\\S]*?appearance: TradingDrawingStrokeAppearance`));
  }
  assert.match(renderDrawing, /definition\.kind === "rectangle"[\s\S]*?svgStrokeAttributes\(lineAppearance, 1\.6\)/);
  assert.match(renderDrawing, /definition\.kind === "ellipse"[\s\S]*?svgStrokeAttributes\(lineAppearance, 1\.6\)/);
  assert.match(renderDrawing, /definition\.kind === "arc"[\s\S]*?svgStrokeAttributes\(lineAppearance, 1\.8\)/);
  assert.match(renderDrawing, /definition\.kind === "polyline"[\s\S]*?svgStrokeAttributes\(lineAppearance, 1\.8\)/);
});

test("new manual drawings reuse the previous style for each drawing tool", async () => {
  const drawing = await drawingSource;

  assert.match(drawing, /export interface TradingDrawingStyle/);
  assert.match(drawing, /private readonly drawingStyles = new Map<TradingDrawingToolId, TradingDrawingStyle>\(\)/);
  assert.match(drawing, /this\.drawingStyles\.set\(drawing\.tool, tradingDrawingStyleFromModel\(drawing\)\)/);
  assert.match(drawing, /this\.drawingStyleForTool\(definition\.id\)/);
  assert.match(drawing, /this\.drawingStyleForTool\(tool\)/);
  assert.match(drawing, /drawingStyles\?: Partial<Record<TradingDrawingToolId, TradingDrawingStyle>>/);
  assert.match(drawing, /this\.rememberDrawingStyle\(this\.selectedDrawing\(\)\)/);
});

test("drawing defaults and toolbar icon weight match the neutral compact treatment", async () => {
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);

  assert.match(drawing, /DEFAULT_DRAWING_COLOR_LIGHT = "#787b86"/);
  assert.match(drawing, /DEFAULT_DRAWING_COLOR_DARK = "#b2b5be"/);
  assert.match(drawing, /DEFAULT_DRAWING_LINE_WIDTH = 1/);
  assert.match(styles, /\.trading-drawing-width-preview\s*\{[^}]*border-top: var\(--drawing-width, 1px\) solid currentcolor;/s);
  assert.doesNotMatch(drawing, /trading-drawing-color-preview|data-drawing-color-preview/);
  assert.doesNotMatch(drawing, /trading-drawing-selection-caret/);
  assert.doesNotMatch(styles, /\.trading-drawing-color-preview|\.trading-drawing-selection-caret/);
  assert.match(
    styles,
    /\.trading-drawing-primary > svg,[\s\S]*?\.trading-drawing-tool-menu button > svg\s*\{[^}]*stroke-width: 1\.25;/s,
  );
  assert.match(styles, /\.trading-drawing-disclosure > svg\s*\{[^}]*stroke-width: 1\.1;/s);
  assert.match(styles, /\.trading-drawing-selection-action > svg\s*\{[^}]*stroke-width: 1\.25;/s);
});

test("the six-dot grip moves only the option bar and line dragging keeps that position fixed", async () => {
  const [drawing, styles] = await Promise.all([drawingSource, stylesSource]);

  assert.match(drawing, /private selectionToolbarPosition: ScreenPoint \| null = null/);
  assert.match(drawing, /private selectionToolbarDrag: SelectionToolbarDragState \| null = null/);
  assert.match(drawing, /closest<HTMLElement>\("\.trading-drawing-selection-grip"\)/);
  assert.match(drawing, /this\.selectionToolbar\.setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(drawing, /clampTradingDrawingToolbarPosition\(\{/);
  assert.match(drawing, /if \(!this\.selectionToolbarPosition\) \{/);
  assert.match(drawing, /this\.selectionToolbarPosition = position;/);
  const lineMoveBlock = drawing.slice(
    drawing.indexOf("private readonly handlePointerMove"),
    drawing.indexOf("private readonly handlePointerUp"),
  );
  assert.doesNotMatch(lineMoveBlock, /selectionToolbarPosition = null/);
  assert.match(
    styles,
    /\.trading-drawing-selection-grip\s*\{[^}]*cursor: grab;[^}]*touch-action: none;/s,
  );
  assert.match(
    styles,
    /\.trading-drawing-selection\.dragging \.trading-drawing-selection-grip\s*\{[^}]*cursor: grabbing;/s,
  );
});

test("drawing group affordances match the compact TradingView-style toolbar", async () => {
  const drawing = await drawingSource;

  assert.match(drawing, /<path d="m3 2 2 2-2 2"\/>/);
  assert.doesNotMatch(drawing, /<path d="m2 3 2 2 2-2"\/>/);
  assert.match(drawing, /reset: '<path d="M4 4v6h6M5\.7 16\.4A8 8 0 1 0 4\.3 9\.2"\/>',/);
  assert.match(drawing, /trash: '<path d="M5 7h14M9 7V4h6v3M7 9v11h10V9M10\.5 11v6M13\.5 11v6"\/>',/);
});

test("drawing toolbar header removes the exit divider and aligns the symbol to its old edge", async () => {
  const [main, drawing, styles] = await Promise.all([
    mainSource,
    drawingSource,
    stylesSource,
  ]);

  assert.doesNotMatch(drawing, /TEAM_AVATAR_URL/);
  assert.match(
    drawing,
    /class="trading-drawing-toolbar-head" aria-hidden="true"><\/div>[\s\S]*class="trading-drawing-toolbar-scroll"/,
  );
  assert.doesNotMatch(drawing, /trading-drawing-exit|exit-trading-expert|<span>退出<\/span>/);
  assert.match(
    styles,
    /\.trading-drawing-toolbar-head\s*\{[^}]*height: 36\.4px;[^}]*flex: 0 0 36\.4px;[^}]*border-bottom: 0;/s,
  );
  assert.match(
    styles,
    /\.trading-drawing-toolbar\s*\{[^}]*z-index: auto;[^}]*width: 41\.6px;[^}]*border-right: 0;/s,
  );
  assert.match(styles, /\.trading-drawing-toolbar-scroll\s*\{[^}]*position: relative;[^}]*z-index: 40;/s);
  assert.match(styles, /\.trading-drawing-tool-menu\s*\{[^}]*position: absolute;[^}]*z-index: 110;/s);
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout \.trading-market-content > \.trading-market-overview\s*\{[^}]*padding-right: 64px;/s,
  );
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout \.trading-market-content > \.trading-market-overview\s*\{[^}]*padding-right: 64px;[^}]*padding-left: 0;/s,
  );
  assert.match(
    styles,
    /\.desktop-body\.trading-expert-layout\.left-panel-collapsed:not\(\.trading-expert-chart-collapsed\)[\s\S]*?\.trading-market-content > \.trading-market-overview\s*\{[^}]*width: calc\(100% \+ 41\.6px\);[^}]*margin-left: -41\.6px;[^}]*padding-left: 36px;/s,
  );
  assert.doesNotMatch(styles, /trading-drawing-exit/);
  assert.doesNotMatch(main, /exitTradingExpertWorkspace|exit-trading-expert/);
});

test("the shared drawing toolbar targets every split pane with isolated drawing state", async () => {
  const [drawing, market, splitPane, styles] = await Promise.all([
    drawingSource,
    marketSource,
    splitPaneSource,
    stylesSource,
  ]);
  const { tradingSplitPaneDrawingStorageSessionId } = await import(
    "../src/renderer/trading-expert-market.ts"
  );

  assert.equal(
    tradingSplitPaneDrawingStorageSessionId("thread/alpha", 1),
    "thread/alpha::split-pane:1",
  );
  assert.equal(
    tradingSplitPaneDrawingStorageSessionId("", 2),
    "trading-expert-unassigned::split-pane:2",
  );
  assert.match(splitPane, /renderTradingDrawingLayer\(\)/);
  assert.match(splitPane, /new TradingDrawingController\(\{[\s\S]*?controlsHost: options\.drawing\.controlsHost/);
  assert.match(splitPane, /bindControlEvents: false,[\s\S]*?controlActive: false/);
  assert.match(splitPane, /getChart: \(\) => this\.chart,[\s\S]*?getCandleSeries: \(\) => this\.series/);
  assert.match(splitPane, /getSymbol: \(\) => this\.market\.id,[\s\S]*?getInterval: \(\) => this\.interval/);
  assert.match(splitPane, /getDrawingController\(\)[\s\S]*?updateDrawingStorageSession\(/);
  assert.match(drawing, /export interface TradingDrawingSharedToolState/);
  assert.match(drawing, /private controlTarget\(\)[\s\S]*?this\.resolveControlTarget\?\.\(\)/);
  assert.match(drawing, /handleToolbarClick[\s\S]*?controlTarget\.handleToolbarClick\(event\)/);
  assert.match(drawing, /handlePointerDown[\s\S]*?this\.onSurfaceFocus\?\.\(this\)/);
  assert.match(drawing, /if \(!this\.controlActive \|\| !this\.userDrawingEnabled\) return/);
  assert.match(market, /private activeDrawingController: TradingDrawingController \| null = null/);
  assert.match(market, /private syncDrawingSharedToolState\([\s\S]*?controller\.applySharedToolState\(state\)/);
  assert.match(market, /private activateDrawingController\([\s\S]*?controller\.setControlActive\(true\)/);
  assert.match(market, /tradingSplitPaneDrawingStorageSessionId\(this\.drawingStorageSessionId, index\)/);
  assert.match(market, /this\.splitPanes\.forEach\(\(pane\) => pane\.getDrawingController\(\)\?\.setUserDrawingEnabled\(enabled\)\)/);
  assert.match(styles, /\.trading-market-split-viewport\s*\{[^}]*position: relative;[^}]*overflow: hidden;[^}]*background: var\(--trading-market-panel\);/s);
  assert.match(styles, /\.trading-market-split-chart\s*\{[^}]*width: 100%;[^}]*height: 100%;/s);
  const splitViewportStyles = styles.slice(
    styles.indexOf(".trading-market-split-viewport"),
    styles.indexOf(".trading-market-split-loading[hidden]"),
  );
  assert.doesNotMatch(splitViewportStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
});

test("every visible split pane runs the requested analysis and plays its own drawing patch", async () => {
  const [market, splitPane] = await Promise.all([marketSource, splitPaneSource]);

  assert.match(splitPane, /async analysisSnapshot\(lookbackMs: number \| null\)/);
  assert.match(splitPane, /await this\.reload\(true\)/);
  assert.match(splitPane, /paneIndex: this\.paneIndex,[\s\S]*?market: \{ \.\.\.this\.market \},[\s\S]*?interval: this\.interval/);
  assert.match(splitPane, /playAiDrawingPatch\([\s\S]*?this\.drawingController\?\.playAiDrawingPatch\(patch, \{[\s\S]*?\.\.\.options,[\s\S]*?beforePlayback:/);
  assert.match(market, /private captureSplitPaneAnalysisSnapshots\([\s\S]*?const panes = \[\.\.\.this\.splitPanes\][\s\S]*?panes\.map\(\(pane\) => pane\.analysisSnapshot\(lookbackMs\)\)/);
  assert.match(market, /snapshotFailures\.push\([\s\S]*?行情快照读取失败/);
  assert.match(market, /private async runSplitPaneAnalyses\([\s\S]*?const snapshots = \[\.\.\.options\.snapshots\]/);
  assert.match(market, /const failures: TradingSplitPaneAnalysisFailure\[\] = \[\.\.\.options\.snapshotFailures\]/);
  assert.match(market, /Array\.from\(\{ length: Math\.min\(2, snapshots\.length\) \}, \(\) => worker\(\)\)/);
  assert.match(market, /const snapshot = snapshots\[cursor\]/);
  assert.match(market, /const response = await options\.analyze\(snapshot\)/);
  assert.match(market, /await commitTradingAnalysisDrawingPatch\([\s\S]*?snapshot\.paneIndex/);
  assert.match(market, /主图分析继续有效；已纳入 \$\{completed\} 个辅助分屏，另有 \$\{failed\} 个辅助分屏暂未参与结论/);
  assert.match(market, /analysisProgressPhase: string;[\s\S]*?drawingProgressPhase: string;/);
  assert.match(market, /分析完成，正在逐笔落图/);
  assert.equal((market.match(/await this\.runSplitPaneAnalyses\(\{/g) || []).length, 5);
  assert.equal((market.match(/report: combineTradingAnalysisReports\(/g) || []).length, 6);
  assert.equal((market.match(/narrative: combineTradingAnalysisNarratives\(/g) || []).length, 5);
  assert.match(market, /const api:[\s\S]{0,160}= strategyId[\s\S]{0,240}runTradingStrategyAnalysis/);
  assert.match(market, /runTradingStrategyAnalysis![\s\S]{0,220}strategyId,[\s\S]{0,160}: window\.codexDesktop\.runTradingGeneralAnalysis/);
  assert.doesNotMatch(market, /strategyId === "price-action"[\s\S]{0,160}runTradingGeneralAnalysis/);
  for (const api of [
    "runTradingChanTest",
    "runTradingWaveAnalysis",
    "runTradingWyckoffAnalysis",
    "runTradingOrderFlowAnalysis",
  ]) {
    assert.match(market, new RegExp(`const api = window\\.codexDesktop\\.${api}`));
  }
});

test("successful manual or AI persistence records the active layout and all pane selections", async () => {
  const [drawing, market, splitPane] = await Promise.all([
    drawingSource,
    marketSource,
    splitPaneSource,
  ]);

  assert.match(drawing, /onDrawingStateChanged\?: \(source: TradingDrawingController\) => void/);
  assert.match(
    drawing,
    /private persistDrawings\(notify = true\)[\s\S]*?window\.localStorage\.setItem\([\s\S]*?if \(notify\) this\.onDrawingStateChanged\?\.\(this\)/,
  );
  assert.match(
    drawing,
    /private persistAiDrawings\(notify = true\)[\s\S]*?window\.localStorage\.setItem\([\s\S]*?if \(notify\) this\.onDrawingStateChanged\?\.\(this\)/,
  );
  assert.match(drawing, /switchStorageSession\([\s\S]*?this\.persistDrawings\(false\)[\s\S]*?this\.persistAiDrawings\(false\)/);
  assert.match(drawing, /cancelAiPlayback\([\s\S]*?this\.persistAiDrawings\(false\)/);
  assert.match(splitPane, /onDrawingStateChanged: options\.drawing\.onDrawingStateChanged/);
  assert.match(market, /onDrawingStateChanged: \(\) => this\.recordLastDrawingWorkspace\(\)/);
  assert.match(market, /private recordLastDrawingWorkspace\(\)[\s\S]*?layoutId: layout\.id,[\s\S]*?panes/);
  assert.match(market, /loadTradingLastDrawingWorkspace\([\s\S]*?this\.drawingStorageSessionId/);
  assert.match(market, /if \(lastDrawingWorkspace\) this\.splitLayoutId = lastDrawingWorkspace\.layoutId/);
  assert.match(market, /restoreLastDrawingWorkspace\([\s\S]*?this\.splitPaneSelections\.set\(pane\.paneIndex/);
  assert.match(market, /migrateTradingLastDrawingWorkspace\(/);
});
