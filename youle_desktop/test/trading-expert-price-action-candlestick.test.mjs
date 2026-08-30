import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTradingMarketSnapshot, validateStrategyDrawingPatch } from "../src/main/trading-analysis/protocol.mjs";
import {
  PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG,
  priceActionLastClosedCandleIndex,
  runPriceActionCandlestickPatternEngine,
} from "../src/main/trading-analysis/price-action-candlestick-pattern-engine.mjs";
import { runPriceActionStrategyEngine } from "../src/main/trading-analysis/price-action-strategy-engine.mjs";
import { buildPriceActionStrategyDrawingPatch, buildPriceActionStrategyReport } from "../src/main/trading-analysis/price-action-strategy-pipeline.mjs";
import { normalizeTradingAiDrawingPatch } from "../src/renderer/trading-expert-drawing.ts";

const START = 1_720_000_000;

function candle(open, high, low, close) {
  return { open, high, low, close };
}

function trend(direction, count = 30, start = direction === "bullish" ? 90 : 120) {
  const candles = [];
  let value = start;
  for (let index = 0; index < count; index += 1) {
    const open = value;
    const close = direction === "bullish" ? open + 0.5 : open - 0.5;
    candles.push(candle(open, Math.max(open, close) + 0.35, Math.min(open, close) - 0.35, close));
    value = close;
  }
  return candles;
}

function snapshotFrom(candles, options = {}) {
  const marketId = options.marketId || "BINANCE:CANDLETESTUSDT";
  const interval = options.interval || "60";
  const candleSeconds = options.candleSeconds || 3_600;
  return normalizeTradingMarketSnapshot({
    marketId,
    interval,
    snapshotTime: options.snapshotTime ?? START + candles.length * candleSeconds,
    candles: candles.map((item, index) => ({
      ...item,
      time: START + index * candleSeconds,
      volume: index + 1,
    })),
  });
}

function scan(candles) {
  const snapshot = snapshotFrom(candles);
  return runPriceActionCandlestickPatternEngine(snapshot, { rangeUnit: 1, zones: [] });
}

function mirror(candles, pivot = 220) {
  return candles.map((item) => ({
    open: pivot - item.open,
    high: pivot - item.low,
    low: pivot - item.high,
    close: pivot - item.close,
  }));
}

function patternIds(result) {
  return result.patterns.map((pattern) => pattern.patternId);
}

function morningStarFixture() {
  return [
    ...trend("bearish"),
    candle(105, 105.2, 100.8, 101),
    candle(100.2, 100.6, 99.9, 100.4),
    candle(100.5, 104.2, 100.3, 104),
    candle(104, 105.8, 103.8, 105.6),
  ];
}

function threeWhiteSoldiersFixture() {
  return [
    ...trend("bearish"),
    candle(104.9, 106.5, 104.7, 106.3),
    candle(105.7, 107.6, 105.6, 107.4),
    candle(106.7, 108.7, 106.6, 108.5),
    candle(108.5, 109.4, 108.3, 109.2),
  ];
}

test("candlestick catalog freezes the requested broad named-pattern coverage", () => {
  const ids = new Set(PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG.map((item) => item.id));
  assert.equal(PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG.length, 54);
  for (const id of [
    "top-fractal", "bottom-fractal", "three-white-soldiers", "three-black-crows",
    "bullish-harami", "dark-cloud-cover", "morning-star", "evening-star",
    "bullish-engulfing", "bearish-engulfing", "rising-three-methods", "falling-three-methods",
  ]) assert.ok(ids.has(id), `missing ${id}`);
});

test("morning star and evening star are mirror-recognized with trend context", () => {
  const bullish = scan(morningStarFixture());
  const bearish = scan(mirror(morningStarFixture()));
  assert.ok(patternIds(bullish).includes("morning-star"));
  assert.ok(patternIds(bearish).includes("evening-star"));
  assert.equal(bullish.patterns.find((item) => item.patternId === "morning-star").confirmation, "confirmed");
  assert.equal(bearish.patterns.find((item) => item.patternId === "evening-star").confirmation, "confirmed");
});

test("three white soldiers and three black crows are mirror-recognized", () => {
  assert.ok(patternIds(scan(threeWhiteSoldiersFixture())).includes("three-white-soldiers"));
  assert.ok(patternIds(scan(mirror(threeWhiteSoldiersFixture()))).includes("three-black-crows"));
});

test("bullish harami and dark cloud cover require the correct prior trend", () => {
  const bullishHarami = [
    ...trend("bearish"),
    candle(105, 105.2, 100.8, 101),
    candle(102.2, 102.65, 102, 102.45),
    candle(102.4, 105.7, 102.3, 105.5),
  ];
  assert.ok(patternIds(scan(bullishHarami)).includes("bullish-harami"));
  assert.ok(patternIds(scan(mirror(bullishHarami))).includes("bearish-harami"));

  const darkCloud = [
    ...trend("bullish"),
    candle(105, 109.2, 104.8, 109),
    candle(109.1, 109.3, 106.6, 106.8),
    candle(106.8, 107, 104.4, 104.6),
  ];
  assert.ok(patternIds(scan(darkCloud)).includes("dark-cloud-cover"));
  assert.ok(patternIds(scan(mirror(darkCloud))).includes("piercing-line"));

  const wrongContext = [...trend("bullish"), ...bullishHarami.slice(-3)];
  assert.ok(!patternIds(scan(wrongContext)).includes("bullish-harami"));
});

test("top and bottom fractals are mirror-recognized after the right candle closes", () => {
  const top = [
    ...trend("bullish"),
    candle(105, 106, 104, 105.2),
    candle(106, 109, 105, 107),
    candle(106.4, 107.5, 103.8, 105),
  ];
  const topResult = scan(top);
  const bottomResult = scan(mirror(top));
  assert.ok(patternIds(topResult).includes("top-fractal"));
  assert.ok(patternIds(bottomResult).includes("bottom-fractal"));
  const topFractal = topResult.patterns.find((item) => item.patternId === "top-fractal");
  assert.equal(topFractal.formationStatus, "confirmed");
  assert.equal(topFractal.confirmation, "confirmed");
  assert.equal(topFractal.complete, true);
});

test("closed hammer formation and open-right fractal use independent close confirmation on 4H", () => {
  const candleSeconds = 14_400;
  const hammerCandles = [
    ...trend("bearish"),
    candle(104.4, 105.2, 100.5, 105),
    candle(105.1, 107, 104.9, 106.8),
  ];
  const hammerSnapshot = snapshotFrom(hammerCandles, {
    interval: "240",
    candleSeconds,
    snapshotTime: START + (hammerCandles.length - 1) * candleSeconds + candleSeconds / 2,
  });
  const hammerResult = runPriceActionStrategyEngine(hammerSnapshot);
  const hammer = hammerResult.candlestickPatterns.recentPatterns.find((item) => item.patternId === "hammer");
  assert.ok(hammer, "closed hammer must be recognized");
  assert.equal(priceActionLastClosedCandleIndex(hammerSnapshot), hammerCandles.length - 2);
  assert.equal(hammer.formationStatus, "confirmed");
  assert.equal(hammer.complete, true);
  assert.equal(hammer.confirmation, "unconfirmed", "an open follow-through candle cannot confirm direction");

  const hammerDrawingResult = {
    ...hammerResult,
    candlestickPatterns: Object.freeze({
      ...hammerResult.candlestickPatterns,
      drawablePatterns: Object.freeze([hammer]),
    }),
  };
  const hammerPatch = buildPriceActionStrategyDrawingPatch(hammerSnapshot, hammerDrawingResult);
  const hammerLabel = hammerPatch.operations.find((item) => item.drawing.tool === "text" && /锤子线/.test(item.drawing.text || ""))?.drawing;
  assert.ok(hammerLabel);
  assert.equal(hammerLabel.text, "锤子线");
  assert.equal(hammerLabel.status, "confirmed");

  const topCandles = [
    ...trend("bullish"),
    candle(105, 106, 104, 105.2),
    candle(106, 109, 105, 107),
    candle(106.4, 107.5, 103.8, 105),
  ];
  const topSnapshot = snapshotFrom(topCandles, {
    interval: "240",
    candleSeconds,
    snapshotTime: START + (topCandles.length - 1) * candleSeconds + candleSeconds / 2,
  });
  const topResult = runPriceActionStrategyEngine(topSnapshot);
  const topFractal = topResult.candlestickPatterns.recentPatterns.find((item) => item.patternId === "top-fractal");
  assert.ok(topFractal, "open right candle may expose a provisional top fractal preview");
  assert.equal(priceActionLastClosedCandleIndex(topSnapshot), topCandles.length - 2);
  assert.equal(topFractal.formationStatus, "forming");
  assert.equal(topFractal.confirmation, "unconfirmed");
  assert.equal(topFractal.complete, false);
  assert.equal(topFractal.actionable, false);
  for (const candidate of [...topResult.setups.activeCandidates, ...topResult.setups.historicalCandidates]) {
    assert.ok(candidate.signalIndex <= topCandles.length - 2, "open candle must not enter the execution signal engine");
  }

  const topDrawingResult = {
    ...topResult,
    candlestickPatterns: Object.freeze({
      ...topResult.candlestickPatterns,
      drawablePatterns: Object.freeze([topFractal]),
    }),
  };
  const topPatch = buildPriceActionStrategyDrawingPatch(topSnapshot, topDrawingResult);
  const topLabel = topPatch.operations.find((item) => item.drawing.tool === "text" && /顶分型/.test(item.drawing.text || ""))?.drawing;
  const topEllipse = topPatch.operations.find((item) => item.drawing.tool === "ellipse" && item.drawing.evidenceIds.includes(topFractal.id))?.drawing;
  assert.ok(topLabel);
  assert.ok(topEllipse);
  assert.equal(topLabel.text, "顶分型 · 待收盘");
  assert.equal(topLabel.status, "tentative");
  assert.equal(topEllipse.status, "tentative");
  assert.match(buildPriceActionStrategyReport(topSnapshot, topResult), /顶分型[\s\S]*形态包含未收盘 K 线，只作预览/);

  const bottomSnapshot = snapshotFrom(mirror(topCandles), {
    interval: "240",
    candleSeconds,
    snapshotTime: START + (topCandles.length - 1) * candleSeconds + candleSeconds / 2,
  });
  const bottomResult = runPriceActionStrategyEngine(bottomSnapshot);
  const bottomFractal = bottomResult.candlestickPatterns.recentPatterns.find((item) => item.patternId === "bottom-fractal");
  assert.ok(bottomFractal, "mirror case must expose a provisional bottom fractal preview");
  assert.equal(bottomFractal.formationStatus, "forming");
  assert.equal(bottomFractal.complete, false);
});

test("gap-dependent patterns reject crypto-like touching candles and accept a real full gap", () => {
  const realGap = [
    ...trend("bearish"),
    candle(105, 105.2, 100.8, 101),
    candle(100, 100.1, 99.9, 100.02),
    candle(100.3, 104.3, 100.25, 104),
  ];
  const noGap = [
    ...trend("bearish"),
    candle(105, 105.2, 100.8, 101),
    candle(100.9, 101.1, 100.7, 100.92),
    candle(100.9, 104.3, 100.75, 104),
  ];
  assert.ok(patternIds(scan(realGap)).includes("bullish-abandoned-baby"));
  assert.ok(!patternIds(scan(noGap)).includes("bullish-abandoned-baby"));
});

test("drawing patch circles a complete pattern and labels it with the same evidence", () => {
  const snapshot = snapshotFrom(morningStarFixture());
  const result = runPriceActionStrategyEngine(snapshot);
  const morning = result.candlestickPatterns.drawablePatterns.find((item) => item.patternId === "morning-star");
  assert.ok(morning, "morning star must be selected for drawing");
  const patch = buildPriceActionStrategyDrawingPatch(snapshot, result);
  const ellipse = patch.operations.find((item) => item.drawing.tool === "ellipse" && item.drawing.text === "晨星")?.drawing;
  const label = patch.operations.find((item) => item.drawing.tool === "text" && /晨星/.test(item.drawing.text || ""))?.drawing;
  assert.ok(ellipse);
  assert.ok(label);
  assert.equal(label.bold, false);
  assert.equal(label.points[0].price, ellipse.points[1].price);
  assert.ok(label.points[0].time > ellipse.points[0].time);
  assert.ok(label.points[0].time < ellipse.points[1].time);
  assert.equal(ellipse.points.length, 2);
  assert.equal(ellipse.lineStyle, "solid");
  assert.ok(ellipse.evidenceIds.includes(morning.id));
  assert.ok(label.evidenceIds.includes(morning.id));
  assert.doesNotThrow(() => validateStrategyDrawingPatch(patch, snapshot, "price-action"));
  const rendererDrawings = normalizeTradingAiDrawingPatch(patch, {
    marketId: snapshot.marketId,
    interval: snapshot.interval,
  });
  assert.ok(rendererDrawings.some((drawing) => drawing.tool === "ellipse" && drawing.text === "晨星"));
  assert.ok(rendererDrawings.some((drawing) => drawing.tool === "text" && /晨星/.test(drawing.text || "")));
  assert.match(buildPriceActionStrategyReport(snapshot, result), /明确K线形态[\s\S]*晨星/);
});

test("English candlestick labels use semantic pattern IDs instead of evidence hashes", () => {
  const snapshot = snapshotFrom(morningStarFixture());
  const result = runPriceActionStrategyEngine(snapshot);
  const morning = result.candlestickPatterns.drawablePatterns.find((item) => item.patternId === "morning-star");
  assert.ok(morning);
  const patch = buildPriceActionStrategyDrawingPatch(snapshot, result, { language: "en" });
  const label = patch.operations.find((item) => (
    item.drawing.tool === "text" && item.drawing.evidenceIds.includes(morning.id)
  ))?.drawing;
  assert.ok(label);
  assert.equal(label.text, "morning star");
  assert.doesNotMatch(label.text, /pa[- ]candlestick[ -][0-9a-f]+/iu);
});

test("every multi-candle catalog pattern is paired with a visible covering ellipse", () => {
  const snapshot = snapshotFrom(trend("bullish", 48, 80));
  const baseResult = runPriceActionStrategyEngine(snapshot);
  const compositePatterns = PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG.filter((item) => item.candleCount > 1);
  assert.equal(compositePatterns.length, 42);

  for (const catalogItem of compositePatterns) {
    const endIndex = snapshot.candles.length - 5;
    const startIndex = endIndex - catalogItem.candleCount + 1;
    const selected = snapshot.candles.slice(startIndex, endIndex + 1);
    const low = Math.min(...selected.map((item) => item.low));
    const high = Math.max(...selected.map((item) => item.high));
    const patternId = `fixture-${catalogItem.id}`;
    const pattern = Object.freeze({
      id: patternId,
      patternId: catalogItem.id,
      name: catalogItem.name,
      direction: catalogItem.direction,
      category: catalogItem.category,
      candleCount: catalogItem.candleCount,
      startIndex,
      endIndex,
      startTime: selected[0].time,
      endTime: selected.at(-1).time,
      low,
      high,
      priorTrend: "neutral",
      zone: null,
      confirmation: "confirmed",
      complete: true,
      actionable: false,
      quality: 1,
      explanation: "composite drawing coverage fixture",
      evidenceIds: Object.freeze([`evidence-${catalogItem.id}`]),
    });
    const result = {
      ...baseResult,
      candlestickPatterns: Object.freeze({
        ...baseResult.candlestickPatterns,
        drawablePatterns: Object.freeze([pattern]),
      }),
    };
    const patch = buildPriceActionStrategyDrawingPatch(snapshot, result);
    const ellipse = patch.operations.find((item) => (
      item.drawing.tool === "ellipse" && item.drawing.evidenceIds.includes(patternId)
    ))?.drawing;
    const label = patch.operations.find((item) => (
      item.drawing.tool === "text" && item.drawing.evidenceIds.includes(patternId)
    ))?.drawing;

    assert.ok(ellipse, `${catalogItem.id} must include an ellipse`);
    assert.ok(label, `${catalogItem.id} must include a paired label`);
    assert.equal(label.text, catalogItem.name, `${catalogItem.id} closed label must omit redundant confirmation text`);
    assert.ok(ellipse.points[0].time < selected[0].time, `${catalogItem.id} ellipse must start before its first candle center`);
    assert.ok(ellipse.points[1].time > selected.at(-1).time, `${catalogItem.id} ellipse must end after its last candle center`);
    assert.ok(ellipse.points[0].price < low, `${catalogItem.id} ellipse must cover the pattern low`);
    assert.ok(ellipse.points[1].price > high, `${catalogItem.id} ellipse must cover the pattern high`);
    assert.equal(ellipse.lineWidth, 0.8, `${catalogItem.id} ellipse must use the requested thin stroke`);
    assert.doesNotThrow(() => validateStrategyDrawingPatch(patch, snapshot, "price-action"));
    const rendererDrawings = normalizeTradingAiDrawingPatch(patch, {
      marketId: snapshot.marketId,
      interval: snapshot.interval,
    });
    assert.ok(rendererDrawings.some((drawing) => drawing.id === ellipse.id && drawing.tool === "ellipse"));
  }
});

test("single-candle catalog patterns keep labels and never draw ellipses", () => {
  const snapshot = snapshotFrom(trend("bullish", 48, 80));
  const baseResult = runPriceActionStrategyEngine(snapshot);
  const singleCandlePatterns = PRICE_ACTION_CANDLESTICK_PATTERN_CATALOG.filter((item) => item.candleCount === 1);
  assert.equal(singleCandlePatterns.length, 12);

  for (const catalogItem of singleCandlePatterns) {
    const startIndex = snapshot.candles.length - 5;
    const selected = snapshot.candles[startIndex];
    const patternId = `fixture-${catalogItem.id}`;
    const pattern = Object.freeze({
      id: patternId,
      patternId: catalogItem.id,
      name: catalogItem.name,
      direction: catalogItem.direction,
      category: catalogItem.category,
      candleCount: catalogItem.candleCount,
      startIndex,
      endIndex: startIndex,
      startTime: selected.time,
      endTime: selected.time,
      low: selected.low,
      high: selected.high,
      priorTrend: "neutral",
      zone: null,
      confirmation: "confirmed",
      complete: true,
      actionable: false,
      quality: 1,
      explanation: "single-candle drawing coverage fixture",
      evidenceIds: Object.freeze([`evidence-${catalogItem.id}`]),
    });
    const result = {
      ...baseResult,
      candlestickPatterns: Object.freeze({
        ...baseResult.candlestickPatterns,
        drawablePatterns: Object.freeze([pattern]),
      }),
    };
    const patch = buildPriceActionStrategyDrawingPatch(snapshot, result);
    const matchingDrawings = patch.operations.filter((item) => item.drawing.evidenceIds.includes(patternId));
    assert.ok(matchingDrawings.some((item) => item.drawing.tool === "text"), `${catalogItem.id} must keep its label`);
    assert.equal(matchingDrawings.find((item) => item.drawing.tool === "text")?.drawing.text, catalogItem.name, `${catalogItem.id} closed label must omit redundant confirmation text`);
    assert.ok(!matchingDrawings.some((item) => item.drawing.tool === "ellipse"), `${catalogItem.id} must not include an ellipse`);
    assert.doesNotThrow(() => normalizeTradingAiDrawingPatch(patch, {
      marketId: snapshot.marketId,
      interval: snapshot.interval,
    }));
  }
});

test("strategy drawing protocol fails closed on malformed circle and ellipse point counts", () => {
  const snapshot = snapshotFrom(morningStarFixture());
  const base = {
    schemaVersion: 1,
    analysisId: "candlestick-protocol-test",
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
  };
  for (const tool of ["circle", "ellipse"]) {
    assert.throws(() => validateStrategyDrawingPatch({
      ...base,
      operations: [{
        op: "upsert",
        drawing: {
          id: `bad-${tool}`,
          strategyId: "price-action",
          theory: "strategy",
          layer: "ai/strategy/price-action",
          tool,
          points: [{ time: snapshot.candles[0].time, price: 100 }],
          colorToken: "strategy-note",
          status: "confirmed",
          evidenceIds: ["fixture"],
        },
      }],
    }, snapshot, "price-action"), /requires two points/);
  }
});

test("strategy drawing protocol accepts 0.8 ellipse strokes and rejects widths below the supported floor", () => {
  const snapshot = snapshotFrom(morningStarFixture());
  const result = runPriceActionStrategyEngine(snapshot);
  const patch = buildPriceActionStrategyDrawingPatch(snapshot, result);
  const ellipseOperation = patch.operations.find((item) => item.drawing.tool === "ellipse");
  assert.ok(ellipseOperation);
  assert.equal(ellipseOperation.drawing.lineWidth, 0.8);
  assert.doesNotThrow(() => validateStrategyDrawingPatch(patch, snapshot, "price-action"));
  assert.throws(() => validateStrategyDrawingPatch({
    ...patch,
    operations: [{
      ...ellipseOperation,
      drawing: { ...ellipseOperation.drawing, lineWidth: 0.49 },
    }],
  }, snapshot, "price-action"), /lineWidth is invalid/);
});

test("candlestick names and drawings remain invariant when volume is changed", () => {
  const snapshot = snapshotFrom(morningStarFixture());
  const changed = normalizeTradingMarketSnapshot({
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    snapshotTime: snapshot.snapshotTime,
    candles: snapshot.candles.map((item, index) => ({ ...item, volume: index % 2 ? 0 : 99_999_999 })),
  });
  const left = runPriceActionStrategyEngine(snapshot);
  const right = runPriceActionStrategyEngine(changed);
  const patternFacts = (result) => result.candlestickPatterns.recentPatterns.map((item) => ({
    patternId: item.patternId,
    direction: item.direction,
    startIndex: item.startIndex,
    endIndex: item.endIndex,
    low: item.low,
    high: item.high,
    formationStatus: item.formationStatus,
    confirmation: item.confirmation,
    complete: item.complete,
    actionable: item.actionable,
    quality: item.quality,
  }));
  const drawingFacts = (patch) => patch.operations.map((item) => ({
    tool: item.drawing.tool,
    points: item.drawing.points,
    text: item.drawing.text,
    colorToken: item.drawing.colorToken,
    lineStyle: item.drawing.lineStyle,
    lineWidth: item.drawing.lineWidth,
  }));
  assert.deepEqual(patternFacts(left), patternFacts(right));
  assert.deepEqual(
    drawingFacts(buildPriceActionStrategyDrawingPatch(snapshot, left)),
    drawingFacts(buildPriceActionStrategyDrawingPatch(changed, right)),
  );
});
