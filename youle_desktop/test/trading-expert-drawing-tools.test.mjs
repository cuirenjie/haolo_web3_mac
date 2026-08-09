import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const drawingSource = readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

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

test("manual and AI drawings persist in isolated conversation storage", async () => {
  const [drawing, market, main] = await Promise.all([drawingSource, marketSource, mainSource]);
  const { tradingDrawingSessionStorageKey } = await import("../src/renderer/trading-expert-drawing.ts");

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
  assert.match(drawing, /private persistAiDrawings\(\)/);
  assert.match(drawing, /tradingDrawingSessionStorageKey\("ai", this\.storageSessionId\)/);
  assert.match(drawing, /switchStorageSession\([\s\S]*loadStoredDrawings\(this\.storageSessionId\)[\s\S]*loadStoredAiDrawings\(this\.storageSessionId\)/);
  assert.match(drawing, /LEGACY_TRADING_AI_DRAWINGS_STORAGE_KEY[\s\S]*window\.localStorage\.removeItem\(legacyStorageKey\)/);
  assert.match(drawing, /getInterval: \(\) => string/);
  assert.match(drawing, /interval: patch\.interval/);
  assert.match(drawing, /tradingAiDrawingMatchesContext\(drawing, symbol, interval\)/);
  assert.match(drawing, /playAiDrawingPatch[\s\S]*?cancelAiPlayback\(\{ clear: true \}\)/);
  assert.match(market, /getInterval: \(\) => this\.activeInterval/);
  assert.match(market, /storageSessionId: this\.drawingStorageSessionId/);
  assert.match(market, /syncDrawingStorageSession\([\s\S]*switchStorageSession\(drawingStorageSessionId/);
  assert.match(main, /syncTradingExpertMarketWorkspace\([\s\S]*targetThreadId \|\| preserved\.threadId,[\s\S]*replacementThreadId === targetThreadId \? preserved\.threadId : ""/);
  assert.match(main, /syncTradingExpertMarketWorkspace\([\s\S]*freshHost,[\s\S]*targetThreadId \|\| ""/);

  const restartBlock = market.slice(
    market.indexOf("private async restartMarketData"),
    market.indexOf("private async refreshSnapshot"),
  );
  const destroyBlock = market.slice(market.indexOf("destroy() {"));
  assert.match(restartBlock, /cancelChanAnalysis\(\{ clear: false, notifyMain: true \}\)/);
  assert.doesNotMatch(restartBlock, /cancelChanAnalysis\(\{ clear: true/);
  assert.match(destroyBlock, /cancelChanAnalysis\(\{ clear: false, notifyMain: true \}\)/);
  assert.ok((market.match(/cancelAiPlayback\(\{ clear: false \}\)/g) || []).length >= 4);
});

test("drawing coordinate conversion rejects missing chart values instead of teleporting endpoints", async () => {
  const { finiteTradingChartCoordinate } = await import("../src/renderer/trading-expert-drawing.ts");

  assert.equal(finiteTradingChartCoordinate(null), null);
  assert.equal(finiteTradingChartCoordinate(undefined), null);
  assert.equal(finiteTradingChartCoordinate(Number.NaN), null);
  assert.equal(finiteTradingChartCoordinate(Number.POSITIVE_INFINITY), null);
  assert.equal(finiteTradingChartCoordinate("0"), null);
  assert.equal(finiteTradingChartCoordinate(0), 0);
  assert.equal(finiteTradingChartCoordinate(123.5), 123.5);
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

test("drawing toolbar replaces the app sidebar and binds to chart coordinates", async () => {
  const [main, market, drawing, styles] = await Promise.all([
    mainSource,
    marketSource,
    drawingSource,
    stylesSource,
  ]);

  assert.match(main, /\$\{tradingExpertLayout \? "" : renderAppSidebar\(\)\}/);
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
  assert.match(drawing, /private clearAllDrawings\(\)[\s\S]*this\.aiPlayback\.cancel\(\)[\s\S]*this\.drawings = \[\][\s\S]*this\.aiDrawings = \[\][\s\S]*this\.redoStack = \[\]/);
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
  assert.match(drawing, /timeScale\.logicalToCoordinate\(logical as any\)/);
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
  const drawing = await drawingSource;

  assert.match(drawing, /private draftConfirmedPointCount = 0/);
  assert.match(drawing, /private draftRequiredPointCount = 0/);
  assert.match(drawing, /if \(this\.draft && this\.hasPendingDraftPoint\(\)\)/);
  assert.match(drawing, /const previewIndex = this\.draftConfirmedPointCount/);
  assert.match(drawing, /this\.draft\.points\[previewIndex\] = drawingPoint/);
  assert.match(drawing, /tradingDrawingAdvanceDraftPoints\([\s\S]*?this\.draftRequiredPointCount,[\s\S]*?drawingPoint/);
  assert.match(drawing, /this\.draft\.points = progress\.points[\s\S]*?this\.draftConfirmedPointCount = progress\.confirmedPointCount/);
  assert.match(drawing, /if \(!progress\.complete\)/);
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
  assert.match(drawing, /avoidBoxInteriors: String\(drawing\.colorToken \|\| ""\)\.startsWith\("order-flow-"\)/);
  assert.match(drawing, /visibleOrderFlowBoxObstacles\(aiDrawings, bounds\)/);
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
  assert.match(drawing, /if \(drawing\.tool === "note" && !noteLayout\) return ""/);
  assert.match(drawing, /const nearHorizontalPenalty = Math\.max\(0, diagonalThreshold - verticalSeparation\) \* 5_000/);
  assert.match(textRenderer, /private renderTextHitTargets\([\s\S]*?points: ScreenPoint\[],[\s\S]*?drawing: TradingDrawingModel,[\s\S]*?bounds: \{ width: number; height: number \}/);
  assert.match(drawing, /const AI_NOTE_FONT_SIZE = 10/);
  assert.match(drawing, /const AI_NOTE_TEXT_MAX_WIDTH = 200/);
  assert.match(drawing, /fontSize: drawing\.tool === "note" \? AI_NOTE_FONT_SIZE : undefined/);
  assert.match(textRenderer, /textLength="\$\{layout\.lineWidths\[index\]\}" lengthAdjust="spacingAndGlyphs"/);
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

test("drawing toolbar header aligns with the market bar and exits to a normal new task", async () => {
  const [main, drawing, styles] = await Promise.all([
    mainSource,
    drawingSource,
    stylesSource,
  ]);

  assert.doesNotMatch(drawing, /TEAM_AVATAR_URL/);
  assert.match(
    drawing,
    /class="trading-drawing-toolbar-head"[\s\S]*data-action="exit-trading-expert"[\s\S]*<span>退出<\/span>[\s\S]*class="trading-drawing-toolbar-scroll"/,
  );
  assert.doesNotMatch(drawing, /class="trading-drawing-exit"[\s\S]*?<img/);
  assert.match(
    styles,
    /\.trading-drawing-toolbar-head\s*\{[^}]*height: 36\.4px;[^}]*flex: 0 0 36\.4px;[^}]*border-bottom: 1px solid var\(--trading-market-border\);/s,
  );
  assert.match(
    styles,
    /\.trading-drawing-exit:hover\s*\{[^}]*background: var\(--trading-market-control\);[^}]*color: #000000;/s,
  );
  assert.match(
    styles,
    /\.trading-drawing-exit\s*\{[^}]*color: #000000;[^}]*font: inherit;/s,
  );
  assert.match(
    styles,
    /\.trading-drawing-exit > span\s*\{[^}]*font-size: calc\(12px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s,
  );
  assert.match(styles, /html\[data-theme="dark"\] \.trading-drawing-exit\s*\{[^}]*color: #f4f6f8;/s);
  assert.match(
    main,
    /async function exitTradingExpertWorkspace\(\)[\s\S]*isTradingExpertThreadId\(threadId\)[\s\S]*state\.leftCollapsed = false;[\s\S]*state\.rightCollapsed = true;[\s\S]*await startNewThread\(\);/,
  );
  assert.match(
    main,
    /querySelector<HTMLButtonElement>\('\[data-action="exit-trading-expert"\]'\)[\s\S]*void exitTradingExpertWorkspace\(\);/,
  );
});
