import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createTradingAnalysisModelProviderRegistry,
} from "../src/main/trading-analysis/model-provider.mjs";
import {
  evaluateCorrectionWaveRules,
  evaluateMotiveWaveRules,
  runWaveTheoryEngine,
  waveDegreeIntervals,
} from "../src/main/trading-analysis/wave-engine.mjs";
import {
  buildWaveActionPlan,
  buildWaveAnalysisReport,
  buildWaveDrawingPatch,
  buildWaveModelPrompt,
  normalizeWaveModelReview,
  runTradingWaveAnalysisPipeline,
} from "../src/main/trading-analysis/wave-pipeline.mjs";
import {
  buildWaveRequestRoutingPrompt,
  normalizeWaveRequestRoutingModelResponse,
} from "../src/main/trading-analysis/wave-request-router.mjs";
import {
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "../src/main/trading-analysis/protocol.mjs";
import {
  buildExecutionPlanV1,
  formatExecutionPlanMarkdown,
} from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import {
  buildTradingWaveExpertPrompt,
  stripTradingWaveMention,
  tradingWaveMentioned,
  TRADING_WAVE_EXPERT_PROMPT_END,
  TRADING_WAVE_EXPERT_PROMPT_START,
} from "../src/renderer/trading-expert-wave-request.ts";
import {
  TRADING_WAVE_INSUFFICIENT_DATA_CODE,
  runTradingWaveAnalysisWithAutoExpansion,
} from "../src/renderer/trading-expert-wave-expansion.ts";
import { translateAppText } from "../src/renderer/app-language.mjs";

const WAVE_ANCHORS = [
  [0, 101],
  [5, 100],
  [17, 115],
  [29, 108],
  [45, 132],
  [57, 123],
  [73, 145],
  [85, 130],
  [91, 137],
  [103, 120],
  [119, 127],
];

const WAVE_SUBDIVISIONS = [1, 5, 3, 5, 3, 5, 5, 3, 5, 3];

function segmentProgress(segmentCount) {
  if (segmentCount === 5) return [0, 0.32, 0.23, 0.62, 0.52, 1];
  if (segmentCount === 3) return [0, 0.62, 0.45, 1];
  return [0, 1];
}

function hierarchicalPrice(index, anchors = WAVE_ANCHORS, subdivisions = WAVE_SUBDIVISIONS) {
  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const [rightIndex, rightPrice] = anchors[anchorIndex];
    const [leftIndex, leftPrice] = anchors[anchorIndex - 1];
    if (index > rightIndex) continue;
    const progressAnchors = segmentProgress(subdivisions[anchorIndex - 1]);
    const duration = rightIndex - leftIndex;
    const offsets = progressAnchors.map((_, progressIndex) => (
      progressIndex === progressAnchors.length - 1
        ? duration
        : Math.round(duration * progressIndex / (progressAnchors.length - 1))
    ));
    const offset = index - leftIndex;
    for (let microIndex = 1; microIndex < offsets.length; microIndex += 1) {
      if (offset > offsets[microIndex]) continue;
      const leftOffset = offsets[microIndex - 1];
      const rightOffset = offsets[microIndex];
      const localProgress = (offset - leftOffset) / Math.max(1, rightOffset - leftOffset);
      const progress = progressAnchors[microIndex - 1]
        + (progressAnchors[microIndex] - progressAnchors[microIndex - 1]) * localProgress;
      return leftPrice + (rightPrice - leftPrice) * progress;
    }
  }
  return anchors.at(-1)[1];
}

function fixtureCandles(count = 120, anchors = WAVE_ANCHORS, subdivisions = WAVE_SUBDIVISIONS) {
  return Array.from({ length: count }, (_, index) => {
    const close = hierarchicalPrice(index, anchors, subdivisions);
    const previous = hierarchicalPrice(Math.max(0, index - 1), anchors, subdivisions);
    const open = previous + (close - previous) * 0.35;
    return {
      time: 1_720_000_000 + index * 3_600,
      open,
      high: Math.max(open, close) + 0.24,
      low: Math.min(open, close) - 0.24,
      close,
      volume: 100 + index,
    };
  });
}

function scaledWaveCandles({ count = 120, step = 3_600, scale = 0.2, tail = [] } = {}) {
  const endTime = fixtureCandles().at(-1).time;
  const startTime = endTime - (count + tail.length - 1) * step;
  const prices = [
    ...Array.from({ length: count }, (_, index) => 126.6 + (hierarchicalPrice(index) - 125) * scale),
    ...tail,
  ];
  return prices.map((close, index) => {
    const previous = prices[Math.max(0, index - 1)];
    const open = previous + (close - previous) * 0.35;
    return {
      time: startTime + index * step,
      open,
      high: Math.max(open, close) + 0.02,
      low: Math.min(open, close) - 0.02,
      close,
      volume: 200 + index,
    };
  });
}

const WXY_ANCHORS = [
  [0, 105],
  [5, 100],
  [17, 110],
  [29, 105],
  [41, 112],
  [53, 107],
  [65, 116],
  [77, 111],
  [89, 119],
  [101, 115],
];
const WXY_SUBDIVISIONS = [1, 5, 3, 5, 3, 5, 3, 5, 3];

function wxyFixtureCandles() {
  return fixtureCandles(102, WXY_ANCHORS, WXY_SUBDIVISIONS);
}

const SOL_INVALID_ANCHORS = [
  [0, 74],
  [5, 74.33],
  [17, 72.78],
  [29, 73.59],
  [45, 72.29],
  [57, 74.33],
  [73, 73.15],
  [85, 74.06],
  [97, 73.53],
  [109, 75.7],
  [119, 75.4],
];
const SOL_INVALID_SUBDIVISIONS = [1, 5, 3, 5, 3, 5, 5, 3, 5, 3];

function fixtureParams(candles = fixtureCandles()) {
  return {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_720_500_000_000,
    instruction: "对当前画布数浪并绘制主计数、备选计数和失效位",
    candles,
  };
}

function fastPushCandles() {
  const anchors = [
    [0, 90], [5, 80], [20, 100], [28, 94],
    [45, 130], [53, 118], [70, 150], [78, 145],
    [90, 152], [99, 149],
  ];
  const valueAt = (index) => {
    for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
      const [rightIndex, rightPrice] = anchors[anchorIndex];
      const [leftIndex, leftPrice] = anchors[anchorIndex - 1];
      if (index > rightIndex) continue;
      return leftPrice + (rightPrice - leftPrice) * (index - leftIndex) / (rightIndex - leftIndex);
    }
    return anchors.at(-1)[1];
  };
  return Array.from({ length: 100 }, (_, index) => {
    const close = valueAt(index);
    const previous = valueAt(Math.max(0, index - 1));
    const open = previous + (close - previous) * 0.35;
    return {
      time: 1_720_000_000 + index * 3_600,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      volume: 100 + index,
    };
  });
}

function rulePoints(prices, firstType = "low") {
  return prices.map((price, index) => ({
    id: `rule-point-${firstType}-${index}-${price}`,
    index: index * 10,
    time: 1_720_000_000 + index * 36_000,
    price,
    type: index % 2 === 0 ? firstType : firstType === "low" ? "high" : "low",
    status: "confirmed",
  }));
}

test("motive hard rules accept a standard impulse and reject the SOL overlap count", () => {
  const valid = evaluateMotiveWaveRules(
    rulePoints([100, 115, 108, 132, 123, 145]),
    { atr: 1, subdivisions: [5, 3, 5, 3, 5] },
  );
  assert.equal(valid.impulseValid, true);
  assert.equal(valid.rules.wave3MakesProgress, true);
  assert.equal(valid.rules.wave4HoldsWave3Origin, true);
  assert.equal(valid.rules.wave5MakesProgress, true);
  assert.equal(valid.rules.impulseInternalStructureVerified, true);

  const solScreenshot = evaluateMotiveWaveRules(
    rulePoints([74.33, 72.78, 73.59, 72.29, 74.33, 73.15], "high"),
    { atr: 0.2, subdivisions: [5, 3, 5, 3, 5], diagonalPosition: "ending" },
  );
  assert.equal(solScreenshot.impulseValid, false);
  assert.equal(solScreenshot.diagonalValid, false);
  assert.equal(solScreenshot.rules.wave4HoldsWave3Origin, false);
  assert.equal(solScreenshot.rules.wave5MakesProgress, false);
  assert.ok(solScreenshot.rejectionReasons.includes("wave4_full_retrace"));
  assert.ok(solScreenshot.rejectionReasons.includes("wave5_progress_or_verified_truncation"));
  assert.equal(Number(solScreenshot.ratios.wave4Retracement.toFixed(3)), 1.569);

  const stalledThird = evaluateMotiveWaveRules(
    rulePoints([100, 110, 105, 109, 106, 112]),
    { atr: 0.5, subdivisions: [5, 3, 5, 3, 5] },
  );
  assert.equal(stalledThird.impulseValid, false);
  assert.equal(stalledThird.rules.wave3MakesProgress, false);
  assert.ok(stalledThird.rejectionReasons.includes("wave3_progress"));
});

test("candidate generation never repackages the SOL invalid motive as a complete cycle", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams(
    fixtureCandles(120, SOL_INVALID_ANCHORS, SOL_INVALID_SUBDIVISIONS),
  ));
  const result = runWaveTheoryEngine(snapshot);
  const invalidIndexes = [5, 17, 29, 45, 57, 73];
  assert.equal(result.structures.candidates.some((candidate) => (
    ["impulse", "diagonal", "cycle"].includes(candidate.kind)
      && invalidIndexes.every((index, pointIndex) => candidate.points[pointIndex]?.index === index)
  )), false);
  assert.equal(result.structures.candidates.some((candidate) => candidate.kind === "diagonal"), false);
});

test("wave snapshots retain the bounded expanded history beyond the generic 600-candle cap", () => {
  const snapshot = normalizeTradingMarketSnapshot(
    fixtureParams(fixtureCandles(700)),
    { maximumCandles: 2_500 },
  );
  assert.equal(snapshot.candles.length, 700);
});

test("wave-4 overlap never becomes a diagonal without position, wedge, and internal evidence", () => {
  const expandingShape = rulePoints([100, 110, 105, 120, 108, 125]);
  const unresolved = evaluateMotiveWaveRules(expandingShape, {
    atr: 1,
    subdivisions: [3, 3, 3, 3, 3],
  });
  assert.equal(unresolved.impulseValid, false);
  assert.equal(unresolved.diagonalValid, false);
  assert.equal(unresolved.rules.diagonalPositionVerified, false);

  const positioned = evaluateMotiveWaveRules(expandingShape, {
    atr: 1,
    subdivisions: [3, 3, 3, 3, 3],
    diagonalPosition: "leading",
  });
  assert.equal(positioned.diagonalValid, true);
  assert.equal(positioned.rules.diagonalVariant, "expanding");
  assert.equal(positioned.rules.diagonalWedgeVerified, true);

  const nonWedge = evaluateMotiveWaveRules(
    rulePoints([100, 110, 105, 120, 108, 122]),
    { atr: 1, subdivisions: [3, 3, 3, 3, 3], diagonalPosition: "leading" },
  );
  assert.equal(nonWedge.diagonalValid, false);
  assert.equal(nonWedge.rules.diagonalWedgeVerified, false);
});

test("fifth-wave truncation is allowed only when slight and internally verified", () => {
  const slight = evaluateMotiveWaveRules(
    rulePoints([100, 110, 105, 120, 112, 119]),
    { atr: 0.2, subdivisions: [5, 3, 5, 3, 5] },
  );
  assert.equal(slight.impulseValid, true);
  assert.equal(slight.rules.wave5MakesProgress, false);
  assert.equal(slight.rules.truncatedFifthVerified, true);

  const unverified = evaluateMotiveWaveRules(
    rulePoints([100, 110, 105, 120, 112, 119]),
    { atr: 0.2, subdivisions: [5, 3, 5, 3, 3] },
  );
  assert.equal(unverified.impulseValid, false);
  assert.equal(unverified.rules.truncatedFifthVerified, false);

  const excessive = evaluateMotiveWaveRules(
    rulePoints([100, 110, 105, 120, 112, 116]),
    { atr: 0.2, subdivisions: [5, 3, 5, 3, 5] },
  );
  assert.equal(excessive.impulseValid, false);
  assert.equal(excessive.rules.truncationSlight, false);
});

test("ABC names require the matching 5-3-5 or 3-3-5 subdivision evidence", () => {
  const zigzagPoints = rulePoints([100, 110, 105, 113]);
  const zigzag = evaluateCorrectionWaveRules(zigzagPoints, { subdivisions: [5, 3, 5] });
  assert.equal(zigzag.valid, true);
  assert.equal(zigzag.pattern, "zigzag");
  assert.equal(zigzag.rules.internalStructureVerified, true);
  assert.equal(evaluateCorrectionWaveRules(zigzagPoints).valid, false);

  const flat = evaluateCorrectionWaveRules(
    rulePoints([100, 110, 100.5, 111]),
    { subdivisions: [3, 3, 5] },
  );
  assert.equal(flat.valid, true);
  assert.equal(flat.pattern, "flat");
});

test("wave engine deterministically generates rule-checked impulse and correction candidates", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const first = runWaveTheoryEngine(snapshot);
  const second = runWaveTheoryEngine(snapshot);

  assert.deepEqual(first, second);
  assert.equal(first.engineId, "elliott_wave");
  assert.equal(first.status, "succeeded");
  assert.ok(first.structures.swings.length >= 9);
  assert.ok(first.structures.candidates.some((candidate) => candidate.kind === "impulse"));
  const impulse = first.structures.candidates.find((candidate) => candidate.kind === "impulse");
  assert.equal(impulse.points.length, 6);
  assert.equal(impulse.rules.wave2HoldsOrigin, true);
  assert.equal(impulse.rules.wave3MakesProgress, true);
  assert.equal(impulse.rules.wave4HoldsWave3Origin, true);
  assert.equal(impulse.rules.wave3NotShortest, true);
  assert.equal(impulse.rules.wave4AvoidsWave1, true);
  assert.equal(impulse.rules.impulseInternalStructureVerified, true);
  assert.deepEqual(impulse.subdivisions.map((item) => item.segmentCount), [5, 3, 5, 3, 5]);
  assert.ok(impulse.projection.low < impulse.projection.high);
  const completeCycle = first.structures.candidates.find((candidate) => (
    candidate.kind === "cycle" && candidate.pattern === "impulse_plus_abc"
  ));
  assert.ok(completeCycle);
  assert.deepEqual(completeCycle.labels, ["0", "1", "2", "3", "4", "5", "A", "B", "C"]);
  assert.equal(completeCycle.components.impulsePointCount, 6);
  assert.ok(completeCycle.degree.startsWith("当前画布"));
  assert.ok(first.statistics.completeCycleCount >= 1);
  assert.equal(completeCycle.components.motiveKind, "impulse");
  assert.equal(completeCycle.components.structureVerified, true);
});

test("wave engine keeps a fresh five-wave price structure when child pivots are not yet visible", () => {
  const snapshot = normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:ETHUSDT",
    interval: "60",
    snapshotTime: 1_721_000_000_000,
    candles: fastPushCandles(),
  });
  const result = runWaveTheoryEngine(snapshot);
  const primary = result.structures.primaryCandidate;
  assert.equal(primary.kind, "impulse");
  assert.equal(primary.validation, "hard_price_rules_pending_lower_degree_structure");
  assert.equal(primary.status, "tentative");
  assert.deepEqual(primary.points.map((point) => point.index), [28, 45, 53, 70, 78, 90]);
  assert.equal(primary.rules.wave2HoldsOrigin, true);
  assert.equal(primary.rules.wave3MakesProgress, true);
  assert.equal(primary.rules.wave4HoldsWave3Origin, true);
  assert.equal(primary.rules.wave4AvoidsWave1, true);
  assert.equal(primary.rules.wave5MakesProgress, true);
  assert.equal(primary.rules.impulseInternalStructureVerified, false);
  assert.equal(result.statistics.completeCycleCount, 0);
  assert.ok(primary.points.every((point) => result.evidence.some((item) => item.evidenceId === point.id)));
});

test("wave drawing renders all 0–5 points for a fresh impulse instead of only ABC", () => {
  const snapshot = normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:ETHUSDT",
    interval: "60",
    snapshotTime: 1_721_000_000_000,
    candles: fastPushCandles(),
  });
  const theoryResult = runWaveTheoryEngine(snapshot);
  const primary = theoryResult.structures.primaryCandidate;
  const patch = buildWaveDrawingPatch(snapshot, theoryResult, {
    primaryCandidateId: primary.id,
    alternateCandidateIds: [],
    showProjectionZone: false,
    verdict: "approve",
  });
  const path = patch.operations.find((operation) => operation.drawing.tool === "path");
  assert.deepEqual(path.drawing.points.map((point) => point.time), primary.points.map((point) => point.time));
  assert.deepEqual(
    patch.operations.filter((operation) => operation.drawing.tool === "note" && /^[0-5]$/.test(operation.drawing.text))
      .map((operation) => operation.drawing.text),
    ["0", "1", "2", "3", "4", "5"],
  );
  assert.match(
    patch.operations.find((operation) => operation.drawing.text?.startsWith("主计数："))?.drawing.text || "",
    /暂定5浪推动/,
  );
});

test("model review cannot replace a fresh impulse with an older ABC correction", () => {
  const points = (indices, firstType) => indices.map((index, pointIndex) => ({
    id: `${firstType}-${index}`,
    index,
    time: 1_720_000_000 + index * 3_600,
    price: 100 + index,
    type: pointIndex % 2 === 0 ? firstType : firstType === "low" ? "high" : "low",
  }));
  const theoryResult = {
    statistics: { candleCount: 100 },
    structures: {
      candidates: [
        {
          id: "fresh-impulse",
          kind: "impulse",
          points: points([70, 75, 80, 85, 90, 95], "low"),
        },
        {
          id: "old-abc",
          kind: "correction",
          points: points([20, 30, 40, 50], "high"),
        },
      ],
      primaryCandidate: null,
    },
  };
  theoryResult.structures.primaryCandidate = theoryResult.structures.candidates[0];
  const review = normalizeWaveModelReview(JSON.stringify({
    schemaVersion: 1,
    verdict: "approve",
    summary: "旧 ABC",
    primaryCandidateId: "old-abc",
  }), theoryResult);
  assert.equal(review.primaryCandidateId, "fresh-impulse");
});

test("wave subdivision evidence rejects arbitrary noisy odd counts", () => {
  const result = evaluateMotiveWaveRules(
    rulePoints([100, 115, 108, 132, 123, 145]),
    { atr: 1, subdivisions: [31, 21, 15, 21, 31] },
  );
  assert.equal(result.rules.impulseInternalStructureVerified, false);
  assert.equal(result.impulseValid, false);
  assert.ok(result.rejectionReasons.includes("impulse_internal_structure"));
});

test("wave engine promotes a verified lower-degree candidate when the visible parent window has none", () => {
  const snapshot = normalizeTradingMarketSnapshot({
    ...fixtureParams(fixtureCandles(120, SOL_INVALID_ANCHORS, SOL_INVALID_SUBDIVISIONS)),
    interval: "240",
    contextCandles: [
      { interval: "60", candles: fixtureCandles() },
      { interval: "15", candles: fixtureCandles() },
    ],
  }, { maximumCandles: 2_500 });
  const result = runWaveTheoryEngine(snapshot);

  assert.equal(result.multiTimeframe.structure.status, "succeeded");
  assert.equal(result.multiTimeframe.execution.status, "succeeded");
  assert.equal(result.fallback.role, "structure");
  assert.equal(result.fallback.interval, "60");
  assert.equal(result.structures.primaryCandidate.sourceRole, "structure");
  assert.equal(result.structures.primaryCandidate.sourceInterval, "60");
  assert.equal(result.status, "succeeded");
  assert.equal(result.statistics.analysisCandidateCount, 0);
  assert.ok(result.statistics.fallbackCandidateCount > 0);
  assert.ok(result.structures.candidates.every((candidate) => candidate.sourceInterval === "60"));
  assert.equal(result.signals[0].sourceInterval, "60");
  assert.ok(result.structures.primaryCandidate.points.length >= 4);
  assert.equal(result.hierarchy.parentRole, "structure");
  assert.equal(result.hierarchy.structure.candidate.id, result.structures.primaryCandidate.id);
  assert.ok(result.hierarchy.execution.candidate);
});

test("wave pipeline sends the lower-degree fallback through model review and Drawing Gateway", async () => {
  const params = {
    ...fixtureParams(fixtureCandles(120, SOL_INVALID_ANCHORS, SOL_INVALID_SUBDIVISIONS)),
    interval: "240",
    contextCandles: [
      { interval: "60", candles: fixtureCandles() },
      { interval: "15", candles: fixtureCandles() },
    ],
  };
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    capabilities: { json: true, theoryReview: true },
    async analyze() {
      return {
        text: JSON.stringify({
          schemaVersion: 1,
          verdict: "approve",
          summary: "主周期暂无候选，采用低周期已验证结构。",
          report: "当前使用结构周期兜底计数，等待更低周期确认。",
          marketBias: "neutral",
          strategyRationale: "候选来自真实低周期 K 线。",
          primaryCandidateId: "unknown-candidate",
          alternateCandidateIds: [],
          showProjectionZone: false,
          confidence: 0.6,
        }),
      };
    },
  }]);
  const result = await runTradingWaveAnalysisPipeline(params, {
    modelRegistry: registry,
    providerId: "fixture-provider",
  });

  assert.equal(result.ok, true);
  assert.equal(result.theoryResult.fallback.role, "structure");
  assert.equal(result.theoryResult.structures.primaryCandidate.sourceInterval, "60");
  assert.ok(result.analysisPlan.drawingPatch.operations.length > 0);
  assert.match(result.analysisPlan.report, /主周期.*未形成|低周期.*兜底/);
  assert.ok(buildWaveModelPrompt(
    normalizeTradingMarketSnapshot(params, { maximumCandles: 2_500 }),
    result.theoryResult,
  ).length < 120_000);
});

test("wave engine reports insufficient data when no alternating pivots exist", async () => {
  const monotonic = Array.from({ length: 60 }, (_, index) => ({
    time: 1_720_000_000 + index * 3_600,
    open: 100 + index,
    high: 100.8 + index,
    low: 99.8 + index,
    close: 100.5 + index,
    volume: 100,
  }));
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams(monotonic));
  assert.equal(runWaveTheoryEngine(snapshot).status, "insufficient_data");
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    async analyze() {
      throw new Error("model must not run without deterministic candidates");
    },
  }]);
  await assert.rejects(
    runTradingWaveAnalysisPipeline(fixtureParams(monotonic), {
      modelRegistry: registry,
      providerId: "fixture-provider",
    }),
    (error) => error.code === "TRADING_WAVE_INSUFFICIENT_DATA",
  );
});

test("wave renderer expands the candle window until deterministic candidates are available", async () => {
  const allCandles = Array.from({ length: 500 }, (_, index) => ({ time: index + 1 }));
  const expansionEvents = [];
  const result = await runTradingWaveAnalysisWithAutoExpansion({
    initialCandles: allCandles.slice(-100),
    getAvailableCandles: () => allCandles,
    async analyze(candles) {
      return candles.length >= 400
        ? { ok: true }
        : { ok: false, error: { code: TRADING_WAVE_INSUFFICIENT_DATA_CODE } };
    },
    onExpansion: (event) => expansionEvents.push(event),
  });

  assert.deepEqual(result.attemptCounts, [100, 200, 400]);
  assert.equal(result.candles.length, 400);
  assert.equal(result.historyLoadCount, 0);
  assert.equal(result.exhausted, false);
  assert.deepEqual(expansionEvents.map((event) => event.type), ["window", "window"]);
});

test("wave auto-expansion never introduces candles after a historical visible range", async () => {
  const allCandles = Array.from({ length: 500 }, (_, index) => ({ time: index + 1 }));
  const result = await runTradingWaveAnalysisWithAutoExpansion({
    initialCandles: allCandles.slice(200, 300),
    getAvailableCandles: () => allCandles,
    async analyze(candles) {
      return candles.length >= 300
        ? { ok: true }
        : { ok: false, error: { code: TRADING_WAVE_INSUFFICIENT_DATA_CODE } };
    },
  });

  assert.deepEqual(result.attemptCounts, [100, 200, 300]);
  assert.equal(result.candles[0].time, 1);
  assert.equal(result.candles.at(-1).time, 300);
});

test("wave auto-expansion loads older history only after exhausting loaded candles", async () => {
  let candlePool = Array.from({ length: 500 }, (_, index) => ({ time: index + 501 }));
  let historyLoads = 0;
  const result = await runTradingWaveAnalysisWithAutoExpansion({
    initialCandles: candlePool.slice(-100),
    getAvailableCandles: () => candlePool,
    async analyze(candles) {
      return candles.length >= 1_000
        ? { ok: true }
        : { ok: false, error: { code: TRADING_WAVE_INSUFFICIENT_DATA_CODE } };
    },
    async loadMoreHistory() {
      historyLoads += 1;
      candlePool = [
        ...Array.from({ length: 500 }, (_, index) => ({ time: index + 1 })),
        ...candlePool,
      ];
    },
  });

  assert.deepEqual(result.attemptCounts, [100, 200, 400, 500, 1_000]);
  assert.equal(result.candles.length, 1_000);
  assert.equal(result.historyLoadCount, 1);
  assert.equal(historyLoads, 1);
});

test("wave auto-expansion does not retry model, network, or cancellation errors", async () => {
  const candles = Array.from({ length: 500 }, (_, index) => ({ time: index + 1 }));
  let expansionEvents = 0;
  let historyLoads = 0;
  const result = await runTradingWaveAnalysisWithAutoExpansion({
    initialCandles: candles.slice(-100),
    getAvailableCandles: () => candles,
    async analyze() {
      return { ok: false, error: { code: "TRADING_WAVE_ANALYSIS_FAILED" } };
    },
    async loadMoreHistory() {
      historyLoads += 1;
    },
    onExpansion: () => {
      expansionEvents += 1;
    },
  });

  assert.deepEqual(result.attemptCounts, [100]);
  assert.equal(expansionEvents, 0);
  assert.equal(historyLoads, 0);
});

test("wave pipeline stays vendor-neutral and emits a guarded AI wave layer", async () => {
  const calls = [];
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    capabilities: { json: true, theoryReview: true },
    async analyze(request, options) {
      calls.push({ request, options });
      return {
        text: JSON.stringify({
          schemaVersion: 1,
          verdict: "approve",
          summary: "主计数暂按既有候选，等待确认位或失效位触发。",
          report: "复核只使用确定性引擎候选，并保留替代计数。",
          marketBias: "neutral",
          strategyRationale: "当前计数满足基础硬规则，但末端和浪级仍需后续收盘 K 线确认。",
          primaryCandidateId: "unknown-candidate",
          alternateCandidateIds: [],
          showProjectionZone: true,
          confidence: 0.7,
        }),
      };
    },
  }]);
  const result = await runTradingWaveAnalysisPipeline(fixtureParams(), {
    modelRegistry: registry,
    providerId: "fixture-provider",
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.options.reasoningEffort), ["medium", "high"]);
  assert.equal(calls[0].request.theoryId, "elliott_wave");
  assert.equal(calls[0].request.task, "wave-theory-review-and-drawing-plan");
  assert.match(calls[0].request.prompt, /确定性 TheoryResult/);
  assert.match(calls[0].request.prompt, /确定性 actionLevels/);
  assert.match(calls[0].request.prompt, /波4重叠绝不会自动改名为倾斜/);
  assert.equal(result.model.providerId, "fixture-provider");
  assert.equal(result.model.reasoningEffort, "high");
  assert.equal(result.model.reviewAttempts, 2);
  assert.match(result.model.escalationReason, /deterministic_candidates_close/);
  assert.ok(result.analysisPlan.drawingPatch.operations.length >= 24);
  assert.ok(result.analysisPlan.drawingPatch.operations.length <= 32);
  assert.ok(result.analysisPlan.drawingPatch.operations.every(({ drawing }) => (
    drawing.theory === "wave" && drawing.layer === "ai/wave" && drawing.locked === true
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => drawing.tool === "path"));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => drawing.tool === "rectangle"));
  assert.equal(result.theoryResult.structures.primaryCandidate.kind, "cycle");
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "path" && drawing.colorToken === "wave-primary"
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "path" && drawing.colorToken === "wave-correction"
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "note" && drawing.text === "5"
  )));
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "note" && drawing.text === "A"
  )));
  assert.equal(result.analysisPlan.actionPlan.state, "ready");
  assert.equal(result.analysisPlan.actionPlan.gate.passed, true);
  assert.equal(result.analysisPlan.actionPlan.executionBasis, "structural_fallback");
  assert.ok([
    "confirmed_wave_boundary",
    "confirmed_wave_pivot",
    "macro_confirmation_fallback",
    "atr_volatility_fallback",
  ].includes(result.analysisPlan.actionPlan.triggerBasis));
  assert.ok(Number.isFinite(result.analysisPlan.actionPlan.longTrigger));
  assert.ok(Number.isFinite(result.analysisPlan.actionPlan.longInvalidation));
  assert.ok(result.analysisPlan.actionPlan.longInvalidation < result.analysisPlan.actionPlan.longTrigger);
  assert.equal(result.analysisPlan.actionPlan.stopBasis.fallback, true);
  assert.ok(result.analysisPlan.actionPlan.longTargets.length >= 1);
  assert.match(result.analysisPlan.report, /可执行条件单已生成/);
  assert.match(result.analysisPlan.report, /兜底|低周期证据/);
  assert.match(result.analysisPlan.report, /主周期边界（不是当前入场价）/);
  assert.match(result.analysisPlan.report, /三级数浪/);
  assert.match(result.analysisPlan.report, /比例参考/);
  assert.match(result.analysisPlan.report, /不是唯一事实/);
  assert.doesNotMatch(result.analysisPlan.report, /倾斜例外/);
  const alternativeTokenDrawings = result.analysisPlan.drawingPatch.operations
    .map(({ drawing }) => drawing)
    .filter((drawing) => drawing.colorToken === "wave-alternative");
  assert.ok(alternativeTokenDrawings.some((drawing) => /-invalidation$/.test(drawing.id)));
  assert.equal(alternativeTokenDrawings.filter((drawing) => /-alternate-\d+$/.test(drawing.id)).length, 0);
  const alternateLabels = result.analysisPlan.drawingPatch.operations
    .map(({ drawing }) => drawing.text || "")
    .filter((text) => /^备选\d：/.test(text));
  assert.equal(alternateLabels.length, 0);
  assert.equal(result.analysisPlan.drawingPatch.operations.filter(({ drawing }) => (
    drawing.tool === "note" && /^Fib (0\.382|0\.5|0\.618|1)$/.test(drawing.text)
  )).length, 3);
  assert.ok(result.analysisPlan.drawingPatch.operations.some(({ drawing }) => (
    drawing.tool === "note" && drawing.text.startsWith("主计数：标准5浪")
  )));
  assert.match(result.analysisPlan.report, /Fib 0\.382|结构风险倍数兜底目标/);
  assert.doesNotMatch(result.analysisPlan.report, /备选1：|主计数：完整5浪/);

  const prompt = buildWaveModelPrompt(
    normalizeTradingMarketSnapshot(fixtureParams()),
    result.theoryResult,
  );
  assert.doesNotMatch(prompt, /gpt-\d|deepseek|openai/i);
  const [engineSource, pipelineSource] = await Promise.all([
    readFile(new URL("../src/main/trading-analysis/wave-engine.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/wave-pipeline.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(engineSource, /gpt|deepseek|openai/i);
  assert.doesNotMatch(pipelineSource, /gpt-\d|deepseek|openai/i);
});

test("4H wave analysis uses real 1H and 15m child waves for a bounded tactical trigger", () => {
  const mainCandles = fixtureCandles();
  const structureCandles = scaledWaveCandles({ step: 3_600, scale: 0.2 });
  const executionCandles = scaledWaveCandles({
    step: 900,
    scale: 0.08,
    tail: [127.08, 127.24, 127.06, 127.2, 126.98, 127.15, 127.0],
  });
  executionCandles.push({
    ...executionCandles.at(-1),
    time: Math.floor(fixtureParams().snapshotTime / 1_000) + 900,
    open: 999,
    close: 999,
    high: 1_000,
    low: 998,
  });
  const snapshot = normalizeTradingMarketSnapshot({
    ...fixtureParams(mainCandles),
    interval: "240",
    tickSize: 0.01,
    contextCandles: [
      { interval: "60", candles: structureCandles },
      { interval: "15", candles: executionCandles },
    ],
  }, { maximumCandles: 2_500 });
  const result = runWaveTheoryEngine(snapshot);
  const action = buildWaveActionPlan(snapshot, result.structures.primaryCandidate, result);

  assert.deepEqual(waveDegreeIntervals("240"), { structure: "60", execution: "15" });
  assert.equal(result.multiTimeframe.structure.interval, "60");
  assert.equal(result.multiTimeframe.execution.interval, "15");
  assert.ok(result.multiTimeframe.structure.statistics.candleCount >= 30);
  assert.equal(result.multiTimeframe.execution.statistics.candleCount, executionCandles.length - 1);
  assert.ok(
    result.multiTimeframe.execution.lastClosedBarTime * 1_000 + 15 * 60 * 1_000
      <= snapshot.snapshotTime,
  );
  assert.equal(action.analysisInterval, "240");
  assert.equal(action.structureInterval, "60");
  assert.equal(action.executionInterval, "15");
  assert.equal(action.gate.maximumDistanceAtr, 3);
  assert.notEqual(action.macroConfirmation, action.longTrigger);
  assert.notEqual(action.macroConfirmation, action.shortTrigger);
  assert.equal(action.state, "ready", JSON.stringify(action.gate));
  const trigger = action.primaryScenario === "bullish" ? action.longTrigger : action.shortTrigger;
  const stop = action.primaryScenario === "bullish" ? action.longInvalidation : action.shortInvalidation;
  assert.ok(Math.abs(trigger - action.currentPrice) / result.multiTimeframe.execution.statistics.atr <= 2);
  assert.ok(
    Math.abs(trigger - stop) / result.multiTimeframe.execution.statistics.atr
      <= action.gate.maximumStopDistanceAtr + Number.EPSILON,
  );
  assert.ok(Math.abs(trigger - stop) / trigger * 100 <= action.gate.maximumStopDistancePercent + Number.EPSILON);
  assert.ok(action.stopBasis.sourceRoles.includes("analysis"));
  assert.equal(action.stopBasis.sourceInterval, "240");
  assert.notEqual(stop, action.macroInvalidation);
  assert.ok(action.gate.finalNetRiskReward >= 1.2);

  const review = {
    primaryCandidateId: result.structures.primaryCandidate.id,
    alternateCandidateIds: [],
    showProjectionZone: false,
    verdict: "approve",
  };
  const patch = buildWaveDrawingPatch(snapshot, result, review);
  assert.ok(patch.operations.some(({ drawing }) => drawing.id.endsWith("-structure-child")));
  assert.ok(patch.operations.some(({ drawing }) => drawing.id.endsWith("-execution-micro")));
  assert.ok(patch.operations.some(({ drawing }) => drawing.id.endsWith("-execution-trigger")));
  assert.ok(patch.operations.filter(({ drawing }) => (
    drawing.tool === "path" && /structure-child|execution-micro/.test(drawing.id)
  )).every(({ drawing }) => (
    ["wave-primary", "wave-correction"].includes(drawing.colorToken)
      && Number.isFinite(drawing.lineWidth)
      && ["solid", "dotted"].includes(drawing.lineStyle)
  )));
  const report = buildWaveAnalysisReport(snapshot, result, review);
  assert.match(report, /当前状态：可执行条件已就绪/);
  assert.match(report, /主周期边界（不是当前入场价）/);
  assert.match(report, /15分钟.*触发/);
  assert.equal(action.stopBasis.kind, "support_zone");
  assert.match(action.stopBasis.label, /结构支撑区下沿/);
  assert.ok(action.stopBasis.zoneLower < action.currentPrice);
  assert.ok(action.stopBasis.zoneUpper > action.stopBasis.zoneLower);
  assert.ok(action.stopBasis.touchCount >= 2);
  assert.ok(action.stopBasis.evidenceIds.length >= 2);
  assert.equal(action.stopBasis.tickSize, 0.01);
  assert.ok(action.stopBasis.buffer >= 0.02);
  assert.ok(action.targetBasis.length >= 3);
  assert.ok(action.targetBasis.every((level) => /Fib|候选结构投影/.test(level.label)));
  assert.match(report, /止盈止损与斐波那契依据/);
  assert.match(report, /依据.*Fib/);

  const executionPlan = buildExecutionPlanV1(
    { id: "wave", version: "0.4.0" },
    {
      snapshot,
      theoryResult: result,
      analysisPlan: {
        analysisId: "analysis-wave-multi-degree",
        actionPlan: action,
      },
    },
    { candles: mainCandles, currentPrice: action.currentPrice },
  );
  assert.equal(executionPlan.expiresAt - executionPlan.createdAt, 15 * 60 * 1_000 * 12);
  assert.equal(executionPlan.market.interval, "240");
  assert.equal(executionPlan.preferredSide, action.primaryScenario === "bullish" ? "long" : "short");
  assert.ok(executionPlan.riskReward.every((item) => Number.isFinite(item.ratio)));
  assert.ok(executionPlan.takeProfits.length >= 2);
  const preferredPlanScenario = executionPlan.scenarios.find((item) => item.side === executionPlan.preferredSide);
  assert.match(preferredPlanScenario.stop.label, /结构支撑区下沿/);
  assert.ok(preferredPlanScenario.stop.evidenceIds.some((id) => action.stopBasis.evidenceIds.includes(id)));
  assert.ok(executionPlan.takeProfits.every((item) => /依据 Fib|依据 候选结构投影|依据 结构风险倍数|用户偏好/.test(item.condition)));
  assert.ok(executionPlan.scenarios
    .find((item) => item.side === executionPlan.preferredSide)
    .targets.some((target) => /Fib|候选结构投影/.test(target.label)));
  assert.match(formatExecutionPlanMarkdown(executionPlan), /依据 Fib|依据 候选结构投影/);
});

test("wave pipeline preserves concrete W-X-Y subwave labels during drawing", async () => {
  const params = fixtureParams(wxyFixtureCandles());
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runWaveTheoryEngine(snapshot);
  const doubleThree = theoryResult.structures.candidates.find((candidate) => candidate.pattern === "double_three");
  assert.ok(doubleThree);
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    async analyze() {
      return {
        text: JSON.stringify({
          schemaVersion: 1,
          verdict: "approve",
          summary: "W-X-Y 双重三浪候选，等待末端确认。",
          report: "按确定性候选标注 W、X、Y 及内部三段。",
          marketBias: "neutral",
          strategyRationale: "W 与 Y 都具备内部三段，X 未越调整起点。",
          primaryCandidateId: doubleThree.id,
          alternateCandidateIds: [],
          showProjectionZone: true,
          confidence: 0.68,
        }),
      };
    },
  }]);
  const result = await runTradingWaveAnalysisPipeline(params, {
    modelRegistry: registry,
    providerId: "fixture-provider",
  });
  const notes = result.analysisPlan.drawingPatch.operations
    .map(({ drawing }) => drawing)
    .filter((drawing) => drawing.tool === "note");
  assert.ok(notes.some((drawing) => drawing.text.includes("W:a")));
  assert.ok(notes.some((drawing) => drawing.text.includes("W:b")));
  assert.ok(notes.some((drawing) => drawing.text.includes("Y:a")));
  assert.ok(notes.some((drawing) => drawing.text.includes("Y:b")));
  assert.equal(new Set(notes.map((drawing) => drawing.id)).size, notes.length);
  assert.match(result.analysisPlan.report, /W-X-Y 双重三浪调整/);
});

test("Drawing Gateway isolates wave semantic tokens from other theories", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const base = {
    schemaVersion: 1,
    analysisId: "wave-analysis-test",
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations: [{
      op: "upsert",
      drawing: {
        id: "wave-path-test",
        theory: "wave",
        tool: "path",
        colorToken: "wave-primary",
        points: [
          { time: snapshot.candles[5].time, price: snapshot.candles[5].low },
          { time: snapshot.candles[17].time, price: snapshot.candles[17].high },
        ],
      },
    }],
  };
  const patch = validateTradingDrawingPatch(base, snapshot);
  assert.equal(patch.operations[0].drawing.layer, "ai/wave");
  assert.throws(
    () => validateTradingDrawingPatch({
      ...base,
      operations: [{
        ...base.operations[0],
        drawing: { ...base.operations[0].drawing, theory: "chan" },
      }],
    }, snapshot),
    /unsupported drawing style/,
  );
});

test("wave request routing inherits the current canvas unless fields are explicit", () => {
  const bare = normalizeWaveRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.99,
  }), "@策略:波浪理论");
  assert.deepEqual(bare.request, {
    mode: "chart-analysis",
    instruction: "",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: true,
  });

  const explicit = normalizeWaveRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: "ETHUSDT",
    interval: "15",
    lookbackMs: 86_400_000,
    lookbackLabel: "24小时",
    confidence: 0.98,
  }), "@策略:波浪理论 看下 ETH 最近24小时的15分钟K线并数浪");
  assert.equal(explicit.request.symbol, "ETHUSDT");
  assert.equal(explicit.request.interval, "15");
  assert.equal(explicit.request.lookbackMs, 86_400_000);
  assert.equal(tradingWaveMentioned("@策略：波浪"), true);
  assert.equal(stripTradingWaveMention("@策略：波浪理论 什么是第三浪？"), "什么是第三浪？");
  assert.match(
    buildWaveRequestRoutingPrompt({ text: "@策略:波浪理论" }),
    /不得根据常见默认值、上下文猜测或补全 BTC、日线、时间范围/,
  );

  const expertPrompt = buildTradingWaveExpertPrompt("附件：wave.png");
  assert.match(expertPrompt, /同时保留主计数和合理的备选计数/);
  assert.match(expertPrompt, /三浪必须越过一浪终点且不能是 1、3、5 中最短/);
  assert.match(expertPrompt, /完整 0-1-2-3-4-5/);
  assert.match(expertPrompt, /一浪与四浪重叠不能自动解释为倾斜/);
  assert.match(expertPrompt, /Zigzag 必须有 5-3-5 内部证据/);
  assert.match(expertPrompt, /不得用“暂定”包装违反硬规则/);
  assert.match(expertPrompt, /W:a、W:b、W 与 Y:a、Y:b、Y/);
  assert.match(expertPrompt, /盘面只绘制主计数、必要的确认\/失效区和简短浪标/);
  assert.match(expertPrompt, /上破哪个确定性价位后偏多、跌破哪个价位后偏空/);
  assert.ok(expertPrompt.includes(TRADING_WAVE_EXPERT_PROMPT_START));
  assert.ok(expertPrompt.includes(TRADING_WAVE_EXPERT_PROMPT_END));
  assert.ok(expertPrompt.indexOf("附件：wave.png") > expertPrompt.indexOf(TRADING_WAVE_EXPERT_PROMPT_END));
});

test("Trading Expert wires wave analysis through IPC, playback, and light/dark themes", async () => {
  const [mainSource, preloadSource, rendererSource, catalogSource, clientSource, marketSource, drawingSource, playbackSource, stylesSource] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-strategy-runtime/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-ai-playback.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(mainSource, /tradingAnalysis:classifyWaveRequest/);
  assert.match(mainSource, /tradingAnalysis:runWave/);
  assert.match(mainSource, /tradingAutomationWaveContextIntervals/);
  assert.match(mainSource, /strategyId === "wave"[\s\S]*?tradingAutomationWaveContextCandles/);
  assert.match(preloadSource, /classifyTradingWaveRequest/);
  assert.match(preloadSource, /runTradingWaveAnalysis/);
  assert.match(rendererSource, /await classifyTradingStrategyForSend\(/);
  assert.match(clientSource, /client\.classifyTradingStrategyRequest\(/);
  assert.match(rendererSource, /tradingStrategyRequestAtSend\?\.mode === "chart-analysis"/);
  assert.match(rendererSource, /runTradingStrategyChartRequest\(threadId, tradingStrategyAtSend/);
  assert.match(catalogSource, /buildTradingWaveExpertPrompt/);
  assert.match(rendererSource, /正在分析波浪结构/);
  assert.match(rendererSource, /正在绘制波浪计数/);
  assert.match(marketSource, /runWaveConversation/);
  assert.match(marketSource, /const capturedTarget = request\.analysisTarget/);
  assert.match(marketSource, /tradingWaveDegreeContextResolutions/);
  assert.match(marketSource, /fetchTradingWaveDegreeContexts/);
  assert.match(marketSource, /contextCandles: await waveDegreeContextsPromise/);
  assert.match(marketSource, /const analysisEndTimeMs = tradingWaveContextEndTime\(analysisCandles, targetInterval, analysisSnapshotTime\)/);
  assert.match(marketSource, /endTime: analysisEndTimeMs \|\| request\.analysisTarget\?\.capturedAt/);
  assert.match(marketSource, /contextCandles: await fetchTradingWaveDegreeContexts\(snapshot\.market\.symbol/);
  assert.match(marketSource, /endTime: tradingWaveContextEndTime\(snapshot\.candles, snapshot\.interval, snapshotTime\)/);
  assert.doesNotMatch(translateAppText("K 线及低周期子浪。", "en"), /\p{Script=Han}/u);
  assert.doesNotMatch(translateAppText("发送时行情快照不足", "en"), /\p{Script=Han}/u);
  assert.match(marketSource, /按价格硬规则与低一级结构验证 0-1-2-3-4-5、A-B-C \/ W-X-Y 候选/);
  assert.match(marketSource, /runTradingWaveAnalysisWithAutoExpansion/);
  assert.match(await readFile(new URL("../src/main/trading-analysis/wave-pipeline.mjs", import.meta.url), "utf8"), /maximumCandles: 2_500/);
  assert.match(marketSource, /focusWaveAnalysisCandles[\s\S]*timeScale\(\)\.setVisibleRange/);
  assert.match(marketSource, /TRADING_WAVE_INSUFFICIENT_DATA[\s\S]*当前范围仅有/);
  assert.doesNotMatch(marketSource, /所选范围"\}仅有 \$\{analysisCandles\.length\} 根 K 线，不足以形成可靠的波浪摆动点/);
  assert.match(marketSource, /当前 \$\{event\.fromCount\} 根 K 线未形成合格浪型，正在自动扩大到 \$\{event\.toCount\} 根继续验证/);
  assert.match(marketSource, /自动扩大到 \$\{analysisCandles\.length\} 根 K 线，仍未形成可复核浪型/);
  assert.match(marketSource, /逐笔绘制简短浪标、主路径和关键价位/);
  assert.match(marketSource, /playAiDrawingPatch/);
  assert.match(drawingSource, /drawing\.theory === "wave"/);
  assert.match(drawingSource, /waveAuxiliaryPath/);
  assert.match(
    drawingSource,
    /drawing\.theory === "wave" && drawing\.tool === "path" && !waveAuxiliaryPath\s*\? "solid"/,
  );
  assert.match(playbackSource, /"chan" \| "order-flow" \| "wave"/);
  assert.doesNotMatch(playbackSource, /new\s+PointerEvent|dispatchEvent\s*\(/);
  assert.match(stylesSource, /--trading-ai-wave-primary: #3159c9;/);
  assert.match(stylesSource, /--trading-ai-wave-correction: #d97706;/);
  assert.match(
    stylesSource,
    /html\[data-theme="dark"\] \.trading-expert-market[\s\S]*?--trading-ai-wave-primary: #7ea2ff;[\s\S]*?--trading-ai-wave-correction: #ffb454;/,
  );
});
