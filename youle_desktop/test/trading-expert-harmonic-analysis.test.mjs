import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HARMONIC_PATTERN_SPECS,
  HARMONIC_SUPPORTED_PATTERN_IDS,
  evaluateHarmonicCandidate,
  runHarmonicPatternEngine,
} from "../src/main/trading-analysis/harmonic-engine.mjs";
import { evaluateSharkCandidate } from "../src/main/trading-analysis/harmonic-shark-engine.mjs";
import { evaluateCypherCandidate } from "../src/main/trading-analysis/harmonic-cypher-engine.mjs";
import {
  buildHarmonicDrawingPatch,
  buildHarmonicDevelopingDrawingPatch,
  buildHarmonicModelPrompt,
  normalizeHarmonicModelReview,
  runTradingHarmonicAnalysisPipeline,
} from "../src/main/trading-analysis/harmonic-pipeline.mjs";
import {
  buildHarmonicRequestRoutingPrompt,
  normalizeHarmonicRequestRoutingModelResponse,
  stripTradingHarmonicMentionLiteral,
} from "../src/main/trading-analysis/harmonic-request-router.mjs";
import {
  normalizeTradingMarketSnapshot,
  validateStrategyDrawingPatch,
} from "../src/main/trading-analysis/protocol.mjs";
import { buildExecutionPlanV1 } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";
import { BUILTIN_TRADING_STRATEGY_ADAPTERS } from "../src/main/trading-strategy-runtime/builtins/index.mjs";
import { TradingStrategyCoordinator } from "../src/main/trading-strategy-runtime/coordinator.mjs";
import { createTradingStrategyRegistry } from "../src/main/trading-strategy-runtime/registry.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const definitions = Object.freeze({
  gartley: [115, 100, 200, 138.2, 183.2, 121.4, 128],
  bat: [115, 100, 200, 150, 175, 111.4, 118],
  butterfly: [115, 100, 200, 121.4, 170, 73, 80],
  crab: [115, 100, 200, 138.2, 186, 38.2, 45],
  "deep-crab": [115, 100, 200, 111.4, 155, 38.2, 45],
  shark: [115, 100, 200, 150, 215, 109.7, 118],
  cypher: [115, 100, 200, 150, 235, 128.89, 136],
});

function harmonicCandles(patternId, { bearish = false, throughIndex = 89, confirm = true } = {}) {
  const source = definitions[patternId];
  const values = bearish ? source.map((price) => 300 - price) : source;
  const indexes = [0, 10, 25, 40, 55, 70, 89];
  const candles = [];
  for (let index = 0; index <= throughIndex; index += 1) {
    let segment = 0;
    while (segment < indexes.length - 2 && index > indexes[segment + 1]) segment += 1;
    const span = indexes[segment + 1] - indexes[segment];
    const progress = span ? (index - indexes[segment]) / span : 0;
    const close = values[segment] + (values[segment + 1] - values[segment]) * progress;
    candles.push({
      time: 1_700_000_000 + index * 3_600,
      open: close,
      high: close + 0.08,
      low: close - 0.08,
      close,
      volume: 100 + index,
    });
  }
  if (confirm && throughIndex >= 71) {
    const d = values[5];
    const open = bearish ? d - 0.05 : d + 0.05;
    const close = bearish ? d - 0.8 : d + 0.8;
    candles[71] = {
      time: 1_700_000_000 + 71 * 3_600,
      open,
      high: Math.max(open, close) + 0.08,
      low: Math.min(open, close) - 0.08,
      close,
      volume: 240,
    };
  }
  return candles;
}

function noisyGartleyCandles({ minorHigh = 160 } = {}) {
  const values = [115, 100, 200, 138.2, minorHigh, 150, 183.2, 121.4, 128];
  const indexes = [0, 10, 25, 40, 46, 49, 55, 70, 89];
  const candles = [];
  for (let index = 0; index <= 89; index += 1) {
    let segment = 0;
    while (segment < indexes.length - 2 && index > indexes[segment + 1]) segment += 1;
    const progress = (index - indexes[segment]) / (indexes[segment + 1] - indexes[segment]);
    const close = values[segment] + (values[segment + 1] - values[segment]) * progress;
    candles.push({
      time: 1_700_000_000 + index * 3_600,
      open: close,
      high: close + 0.08,
      low: close - 0.08,
      close,
      volume: 100 + index,
    });
  }
  candles[71] = {
    time: 1_700_000_000 + 71 * 3_600,
    open: 121.45,
    high: 122.28,
    low: 121.37,
    close: 122.2,
    volume: 240,
  };
  return candles;
}

function snapshot(patternId, options = {}) {
  return normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:TESTUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    candles: harmonicCandles(patternId, options),
  });
}

function noPatternSnapshot(count = 140) {
  return normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:NOPATTERNUSDT",
    interval: "240",
    snapshotTime: Date.now(),
    candles: Array.from({ length: count }, (_, index) => {
      const close = 50_000 + index * 12;
      return {
        time: 1_710_000_000 + index * 14_400,
        open: close - 2,
        high: close + 8,
        low: close - 8,
        close,
        volume: 100 + index,
      };
    }),
  });
}

function modelText(candidateId, overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    verdict: "approve",
    summary: "谐波拓扑、比例与 PRZ 通过验证，等待确认后按条件执行。",
    report: "当前候选由确定性规则验证。",
    rationale: "主候选通过几何、比例和 PRZ 收敛检查，未增加点位。",
    primaryCandidateId: candidateId,
    alternateCandidateIds: [],
    ...overrides,
  });
}

test("v3 detects all seven supported patterns in bullish and bearish mirrors without changing the classic table", () => {
  assert.deepEqual(HARMONIC_PATTERN_SPECS.map((item) => item.id), [
    "gartley",
    "bat",
    "butterfly",
    "crab",
    "deep-crab",
  ]);
  assert.deepEqual(HARMONIC_SUPPORTED_PATTERN_IDS, [
    "gartley",
    "bat",
    "butterfly",
    "crab",
    "deep-crab",
    "shark",
    "cypher",
  ]);
  for (const patternId of Object.keys(definitions)) {
    for (const bearish of [false, true]) {
      const result = runHarmonicPatternEngine(snapshot(patternId, { bearish }));
      assert.equal(result.status, "succeeded", `${patternId} ${bearish ? "bearish" : "bullish"}`);
      assert.equal(result.structures.primaryCandidate.patternId, patternId);
      assert.equal(result.structures.primaryCandidate.direction, bearish ? "bearish" : "bullish");
      assert.deepEqual(
        result.structures.primaryCandidate.points.map((point) => point.label),
        patternId === "shark" ? ["0", "X", "A", "B", "C"] : ["X", "A", "B", "C", "D"],
      );
      assert.ok(result.structures.primaryCandidate.prz.low < result.structures.primaryCandidate.prz.high);
      assert.equal(result.engine.subengines.length, 3);
    }
  }
});

test("multi-scale scan filters minor swing pairs without loosening completed-pattern ratios", () => {
  const marketSnapshot = normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:NOISYGARTLEYUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    candles: noisyGartleyCandles(),
  });
  const result = runHarmonicPatternEngine(marketSnapshot);
  assert.equal(result.status, "succeeded");
  assert.equal(result.structures.primaryCandidate.patternId, "gartley");
  assert.match(result.structures.primaryCandidate.scan.selectionMode, /skip/);
  assert.ok(result.pivots.scanProfiles.length >= 3);
  assert.ok(result.pivots.scanProfiles.every((profile) => profile.completedSequenceCount <= 2_000));
  assert.ok(Math.abs(result.structures.primaryCandidate.ratios.bXa - 0.618) < 0.003);
  assert.ok(Math.abs(result.structures.primaryCandidate.ratios.dXa - 0.786) < 0.003);
});

test("bounded skip never hides a more extreme intervening swing", () => {
  const marketSnapshot = normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:EXTREMESWINGUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    candles: noisyGartleyCandles({ minorHigh: 190 }),
  });
  const result = runHarmonicPatternEngine(marketSnapshot);
  assert.equal(result.structures.candidates.some((candidate) => (
    candidate.patternId === "gartley"
    && candidate.points.map((point) => point.index).join(":") === "10:25:40:55:70"
  )), false);
});

test("600-candle multi-scale search remains bounded on a high-swing fixture", () => {
  const candles = Array.from({ length: 600 }, (_, index) => {
    const close = 50_000 + Math.sin(index * 0.31) * 900 + Math.sin(index * 0.077) * 2_100 + index * 2;
    return {
      time: 1_700_000_000 + index * 3_600,
      open: close - Math.sin(index) * 40,
      high: close + 120 + Math.abs(Math.sin(index * 0.7)) * 80,
      low: close - 120 - Math.abs(Math.cos(index * 0.9)) * 80,
      close,
      volume: 1_000 + index,
    };
  });
  const marketSnapshot = normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:PERFUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    candles,
  });
  const startedAt = performance.now();
  const result = runHarmonicPatternEngine(marketSnapshot);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(result.pivots.scanProfiles.length, 4);
  assert.ok(result.pivots.scanProfiles.every((profile) => (
    profile.completedSequenceCount <= 2_000 && profile.developingSequenceCount <= 2_000
  )));
  assert.ok(elapsedMs < 1_000, `bounded scan took ${elapsedMs.toFixed(2)}ms`);
});

test("all seven topologies expose honest developing candidates before the terminal pivot completes", () => {
  for (const patternId of Object.keys(definitions)) {
    const result = runHarmonicPatternEngine(snapshot(patternId, { throughIndex: 60, confirm: false }));
    assert.equal(result.status, "developing", patternId);
    assert.equal(result.structures.candidates.length, 0);
    assert.ok(result.structures.developingCandidates.some((candidate) => candidate.patternId === patternId), patternId);
    assert.ok(result.structures.developingCandidates.every((candidate) => (
      candidate.stage === "developing"
      && candidate.tradeState === "developing"
      && !candidate.actionLevels
    )));
  }
});

test("developing analysis draws only confirmed partial topology and projected PRZ with no executable levels", async () => {
  const marketSnapshot = snapshot("gartley", { throughIndex: 60, confirm: false });
  let modelCalls = 0;
  const modelRegistry = { async analyze() { modelCalls += 1; throw new Error("developing candidates are deterministic"); } };
  const result = await runTradingHarmonicAnalysisPipeline({
    marketId: marketSnapshot.marketId,
    interval: marketSnapshot.interval,
    snapshotTime: marketSnapshot.snapshotTime,
    candles: marketSnapshot.candles,
    instruction: "分析并画出谐波形态",
  }, { modelRegistry, providerId: "stub" });
  assert.equal(result.ok, true);
  assert.equal(result.theoryResult.status, "developing");
  assert.equal(result.model.finishReason, "deterministic-developing-candidate");
  assert.equal(modelCalls, 0);
  assert.match(result.analysisPlan.report, /发展中结构/);
  assert.match(result.analysisPlan.report, /当前动作：等待，不交易/);
  assert.equal(result.analysisPlan.actionPlan.longTrigger, undefined);
  assert.equal(result.analysisPlan.actionPlan.shortTrigger, undefined);
  const drawings = result.analysisPlan.drawingPatch.operations.map((operation) => operation.drawing);
  assert.ok(drawings.some((drawing) => drawing.tool === "rectangle" && /预测 D PRZ/.test(drawing.text)));
  assert.ok(drawings.every((drawing) => !/^(确认|失效|T1|T2)/.test(drawing.text || "")));
  const confirmedPath = drawings.find((drawing) => drawing.id.endsWith("-xabc-developing"));
  assert.equal(confirmedPath.lineStyle, "solid");
  assert.equal(confirmedPath.lineWidth, 3);
  assert.equal(confirmedPath.status, "confirmed");
  const projectedLeg = drawings.find((drawing) => drawing.id.endsWith("-projected-terminal-leg"));
  assert.equal(projectedLeg.lineStyle, "dashed");
  assert.equal(projectedLeg.lineWidth, 2);
  assert.equal(projectedLeg.status, "tentative");
  assert.deepEqual(
    drawings.filter((drawing) => drawing.tool === "text" && /^[XABC]$/.test(drawing.text)).map((drawing) => drawing.text),
    ["X", "A", "B", "C"],
  );
  assert.equal(drawings.filter((drawing) => drawing.id.includes("-ratio-line-")).length, 2);
  assert.ok(drawings.filter((drawing) => drawing.id.includes("-ratio-line-")).every((drawing) => (
    drawing.lineStyle === "dotted" && drawing.lineWidth === 1.5
  )));
  assert.ok(drawings.some((drawing) => drawing.tool === "text" && drawing.text === "D? 预测"));
  assert.deepEqual(
    buildHarmonicDevelopingDrawingPatch(marketSnapshot, result.theoryResult),
    result.analysisPlan.drawingPatch,
  );

  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const coordinator = new TradingStrategyCoordinator({ registry, modelRegistry, providerId: "stub" });
  const coordinated = await coordinator.run("harmonic", {
    marketId: marketSnapshot.marketId,
    interval: marketSnapshot.interval,
    snapshotTime: marketSnapshot.snapshotTime,
    candles: marketSnapshot.candles,
    instruction: "分析并画出谐波形态",
  });
  assert.equal(coordinated.strategyResult.status, "completed");
  assert.equal(coordinated.executionPlan.action, "wait");
  assert.equal(coordinated.executionPlan.scenarios.length, 0);
  assert.match(coordinated.analysisPlan.report, /预测 PRZ/);
  assert.equal(modelCalls, 0);
});

test("Shark and Cypher remain isolated from classic and from each other at topology and ratio boundaries", () => {
  const sharkSnapshot = snapshot("shark");
  const sharkResult = runHarmonicPatternEngine(sharkSnapshot);
  const sharkPoints = sharkResult.structures.primaryCandidate.points.map((point) => ({ ...point }));
  assert.equal(sharkResult.structures.primaryCandidate.patternId, "shark");
  for (const spec of HARMONIC_PATTERN_SPECS) {
    assert.equal(evaluateHarmonicCandidate(sharkSnapshot, sharkPoints, spec), null);
  }

  const cypherSnapshot = snapshot("cypher");
  const cypherResult = runHarmonicPatternEngine(cypherSnapshot);
  const cypherPoints = cypherResult.structures.primaryCandidate.points.map((point) => ({ ...point }));
  assert.equal(cypherResult.structures.primaryCandidate.patternId, "cypher");
  assert.equal(evaluateSharkCandidate(cypherSnapshot, cypherPoints, { atr: cypherResult.pivots.atr }), null);
  assert.equal(evaluateCypherCandidate(sharkSnapshot, sharkPoints, { atr: sharkResult.pivots.atr }), null);

  const cypherBoundary = cypherPoints.map((point) => ({ ...point }));
  cypherBoundary[2].price = 161.8;
  assert.ok(evaluateCypherCandidate(cypherSnapshot, cypherBoundary, { atr: cypherResult.pivots.atr }));
  cypherBoundary[2].price = 161.9;
  assert.equal(evaluateCypherCandidate(cypherSnapshot, cypherBoundary, { atr: cypherResult.pivots.atr }), null);

  const sharkBoundary = sharkPoints.map((point) => ({ ...point }));
  const sharkXa = Math.abs(sharkBoundary[2].price - sharkBoundary[1].price);
  sharkBoundary[3].price = sharkBoundary[2].price + sharkXa * 1.13;
  assert.ok(evaluateSharkCandidate(sharkSnapshot, sharkBoundary, { atr: sharkResult.pivots.atr }));
  sharkBoundary[3].price -= sharkXa * 0.001;
  assert.equal(evaluateSharkCandidate(sharkSnapshot, sharkBoundary, { atr: sharkResult.pivots.atr }), null);
});

test("ratio, geometry, and PRZ hard gates reject visually similar invalid paths", () => {
  const validSnapshot = snapshot("gartley");
  const engine = runHarmonicPatternEngine(validSnapshot);
  const points = engine.structures.primaryCandidate.points.map((point) => ({ ...point }));
  const invalidB = points.map((point) => ({ ...point }));
  invalidB[2].price = 155;
  assert.equal(evaluateHarmonicCandidate(validSnapshot, invalidB, "gartley"), null);
  const invalidD = points.map((point) => ({ ...point }));
  invalidD[4].price = 90;
  assert.equal(evaluateHarmonicCandidate(validSnapshot, invalidD, "gartley"), null);
  const crossedTime = points.map((point) => ({ ...point }));
  crossedTime[3].index = crossedTime[2].index;
  assert.equal(evaluateHarmonicCandidate(validSnapshot, crossedTime, "gartley"), null);
  assert.throws(() => evaluateHarmonicCandidate(validSnapshot, points, "shark"), /Unknown harmonic pattern/);
});

test("D/PRZ arrival stays tentative until a later closed candle confirms the Terminal Bar", () => {
  const tentative = runHarmonicPatternEngine(snapshot("gartley", { throughIndex: 70, confirm: false }));
  assert.equal(tentative.status, "succeeded");
  assert.equal(tentative.structures.primaryCandidate.status, "tentative");
  assert.equal(tentative.structures.primaryCandidate.tradeState, "awaiting-confirmation");
  assert.equal(tentative.structures.primaryCandidate.confirmation, null);

  const confirmed = runHarmonicPatternEngine(snapshot("gartley", { throughIndex: 89, confirm: true }));
  assert.equal(confirmed.structures.primaryCandidate.status, "confirmed");
  assert.equal(confirmed.structures.primaryCandidate.tradeState, "active");
  assert.ok(confirmed.structures.primaryCandidate.confirmation.index > confirmed.structures.primaryCandidate.points[4].index);
});

test("model review can select only deterministic candidate ids and cannot add prices", () => {
  const marketSnapshot = snapshot("gartley");
  const theoryResult = runHarmonicPatternEngine(marketSnapshot);
  const candidate = theoryResult.structures.primaryCandidate;
  const review = normalizeHarmonicModelReview(modelText("invented-candidate", {
    alternateCandidateIds: ["invented-candidate", candidate.id],
    madeUpPrice: 999999,
  }), theoryResult);
  assert.equal(review.primaryCandidateId, candidate.id);
  assert.deepEqual(review.alternateCandidateIds, []);
  const prompt = buildHarmonicModelPrompt(marketSnapshot, theoryResult, { instruction: "分析并画图" });
  assert.match(prompt, /不得新增、删除、移动 candidate\.points/);
  assert.match(prompt, /Terminal Bar/);
  assert.doesNotMatch(JSON.stringify(review), /999999/);
  assert.throws(() => normalizeHarmonicModelReview(modelText(candidate.id, {
    rationale: "模型自行添加目标价 999999",
  }), theoryResult), /must not contain numeric claims/);
});

test("drawing patch renders exact XABCD, PRZ, confirmation, stop, T1 and T2 in the isolated strategy layer", () => {
  const marketSnapshot = snapshot("bat");
  const theoryResult = runHarmonicPatternEngine(marketSnapshot);
  const candidate = theoryResult.structures.primaryCandidate;
  const review = normalizeHarmonicModelReview(modelText(candidate.id), theoryResult);
  const patch = buildHarmonicDrawingPatch(marketSnapshot, theoryResult, review);
  assert.equal(patch.operations.length, 21);
  const drawings = patch.operations.map((operation) => operation.drawing);
  assert.ok(drawings.every((drawing) => drawing.strategyId === "harmonic"));
  assert.ok(drawings.every((drawing) => drawing.theory === "strategy" && drawing.layer === "ai/strategy/harmonic"));
  const path = drawings.find((drawing) => drawing.id.endsWith("-xabcd"));
  assert.deepEqual(path.points, candidate.points.map((point) => ({ time: point.time, price: point.price })));
  assert.equal(path.lineStyle, "solid");
  assert.equal(path.lineWidth, 3);
  assert.equal(path.colorToken, "strategy-support");
  assert.deepEqual(drawings.filter((drawing) => drawing.tool === "text" && /^[XABCD]$/.test(drawing.text)).map((drawing) => drawing.text), ["X", "A", "B", "C", "D"]);
  assert.ok(drawings.filter((drawing) => drawing.tool === "text" && /^[XABCD]$/.test(drawing.text)).every((drawing) => (
    drawing.fontSize === 12 && drawing.bold === true
  )));
  const ratioLines = drawings.filter((drawing) => drawing.id.includes("-ratio-line-"));
  const ratioLabels = drawings.filter((drawing) => drawing.id.includes("-ratio-label-"));
  assert.equal(ratioLines.length, 4);
  assert.equal(ratioLabels.length, 4);
  assert.ok(ratioLines.every((drawing) => drawing.tool === "path" && drawing.lineStyle === "dotted" && drawing.lineWidth === 1.5));
  assert.ok(ratioLabels.every((drawing) => drawing.tool === "text" && drawing.fontSize === 10 && drawing.bold === true));
  const point = (label) => candidate.points.find((candidatePoint) => candidatePoint.label === label);
  assert.deepEqual(drawings.find((drawing) => drawing.id.endsWith("-ratio-line-b-xa")).points, [point("X"), point("B")].map(({ time, price }) => ({ time, price })));
  assert.deepEqual(drawings.find((drawing) => drawing.id.endsWith("-ratio-line-c-ab")).points, [point("A"), point("C")].map(({ time, price }) => ({ time, price })));
  assert.match(drawings.find((drawing) => drawing.id.endsWith("-ratio-label-cd-projections")).text, /^CD\/BC \d\.\d{3} · CD\/AB \d\.\d{3}$/);
  assert.ok(drawings.some((drawing) => drawing.tool === "rectangle" && drawing.text.startsWith("PRZ")));
  assert.ok(drawings.some((drawing) => drawing.text?.startsWith("确认")));
  assert.ok(drawings.some((drawing) => drawing.text?.startsWith("失效")));
  assert.equal(drawings.filter((drawing) => /^T[12] /.test(drawing.text || "")).length, 2);

  const crossedLayer = structuredClone(patch);
  crossedLayer.operations[0].drawing.layer = "ai/strategy/other";
  assert.throws(() => validateStrategyDrawingPatch(crossedLayer, marketSnapshot, "harmonic"), /unsupported strategy drawing style/);
  const arbitraryColor = structuredClone(patch);
  arbitraryColor.operations[0].drawing.colorToken = "#ffffff";
  assert.throws(() => validateStrategyDrawingPatch(arbitraryColor, marketSnapshot, "harmonic"), /unsupported strategy drawing style/);
  const arbitraryLineStyle = structuredClone(patch);
  arbitraryLineStyle.operations[0].drawing.lineStyle = "glow";
  assert.throws(() => validateStrategyDrawingPatch(arbitraryLineStyle, marketSnapshot, "harmonic"), /lineStyle is invalid/);
  const oversizedLine = structuredClone(patch);
  oversizedLine.operations[0].drawing.lineWidth = 99;
  assert.throws(() => validateStrategyDrawingPatch(oversizedLine, marketSnapshot, "harmonic"), /lineWidth is invalid/);
});

test("Shark and Cypher drawing patches preserve topology-specific labels, terminal points, and target bases", async () => {
  for (const patternId of ["shark", "cypher"]) {
    const marketSnapshot = snapshot(patternId);
    const theoryResult = runHarmonicPatternEngine(marketSnapshot);
    const candidate = theoryResult.structures.primaryCandidate;
    const review = normalizeHarmonicModelReview(modelText(candidate.id), theoryResult);
    const patch = buildHarmonicDrawingPatch(marketSnapshot, theoryResult, review);
    const drawings = patch.operations.map((item) => item.drawing);
    const expectedLabels = patternId === "shark" ? ["0", "X", "A", "B", "C"] : ["X", "A", "B", "C", "D"];
    assert.deepEqual(
      drawings.filter((drawing) => drawing.tool === "text" && expectedLabels.includes(drawing.text)).map((drawing) => drawing.text),
      expectedLabels,
    );
    const expectedRatios = patternId === "shark" ? ["AB/XA", "BC/AB", "C/OX"] : ["B/XA", "C/XA", "D/XC"];
    const ratioLabels = drawings.filter((drawing) => drawing.id.includes("-ratio-label-")).map((drawing) => drawing.text);
    assert.equal(ratioLabels.length, 3);
    expectedRatios.forEach((label) => assert.ok(ratioLabels.some((text) => text.startsWith(`${label} `)), `${patternId}:${label}`));
    assert.ok(drawings.some((drawing) => drawing.text === `${candidate.patternName} ${candidate.terminalLabel} / Terminal Bar`));
    assert.ok(drawings.some((drawing) => drawing.id.endsWith(patternId === "shark" ? "-0xabc" : "-xabcd")));

    const modelRegistry = {
      async analyze(_providerId, request) {
        return {
          text: modelText(candidate.id),
          providerId: "stub",
          modelId: "stub-harmonic-review",
          requestId: request.requestId,
          latencyMs: 1,
          usage: null,
          finishReason: "stop",
        };
      },
    };
    const result = await runTradingHarmonicAnalysisPipeline({
      marketId: marketSnapshot.marketId,
      interval: marketSnapshot.interval,
      snapshotTime: marketSnapshot.snapshotTime,
      candles: marketSnapshot.candles,
      instruction: "分析并画出谐波形态",
    }, { modelRegistry, providerId: "stub" });
    assert.match(result.analysisPlan.report, new RegExp(expectedLabels.join("-")));
    assert.match(result.analysisPlan.report, patternId === "shark" ? /C→B/ : /D→C/);
  }
});

test("pipeline preserves deterministic harmonic targets while ExecutionPlanV1 expands the final target into three exits", async () => {
  const marketSnapshot = snapshot("gartley");
  const deterministic = runHarmonicPatternEngine(marketSnapshot).structures.primaryCandidate;
  const modelRegistry = {
    async analyze(_providerId, request) {
      assert.equal(request.theoryId, "harmonic-xabcd");
      return {
        text: modelText(deterministic.id),
        providerId: "stub",
        modelId: "stub-harmonic-review",
        requestId: request.requestId,
        latencyMs: 1,
        usage: null,
        finishReason: "stop",
      };
    },
  };
  const params = {
    marketId: marketSnapshot.marketId,
    interval: marketSnapshot.interval,
    snapshotTime: marketSnapshot.snapshotTime,
    candles: marketSnapshot.candles,
    instruction: "分析并画出谐波形态",
  };
  const result = await runTradingHarmonicAnalysisPipeline(params, { modelRegistry, providerId: "stub" });
  assert.equal(result.ok, true);
  assert.equal(result.analysisPlan.actionPlan.longTargets.length, 2);
  assert.deepEqual(result.analysisPlan.actionPlan.longTargets, result.theoryResult.structures.primaryCandidate.actionLevels.targets);
  assert.match(result.analysisPlan.report, /T1/);
  assert.match(result.analysisPlan.report, /T2/);

  const manifest = JSON.parse(fs.readFileSync(
    path.join(root, "resources", "trading-strategies", "builtins", "harmonic", "strategy.json"),
    "utf8",
  ));
  assert.equal(manifest.dataRequirements.candles.preferredCount, 600);
  const executionPlan = buildExecutionPlanV1(manifest, result, params);
  assert.equal(executionPlan.action, "long");
  assert.equal(executionPlan.preferredSide, "long");
  assert.equal(executionPlan.takeProfits.length, 3);
  assert.equal(
    executionPlan.takeProfits[2].price.price,
    result.analysisPlan.actionPlan.longTargets.at(-1),
  );
  assert.equal(executionPlan.riskReward[0].ratio <= 0.5, true);
  assert.equal(executionPlan.riskReward[1].ratio <= 0.8, true);
  assert.equal(executionPlan.takeProfits.reduce((sum, target) => sum + target.allocationPercent, 0), 100);
  assert.equal(executionPlan.positionSizing.suggestedQuantity, null);
  assert.match(executionPlan.warnings.join(" "), /不是自动订单/);
  assert.doesNotMatch(JSON.stringify(executionPlan), /placeOrder|createOrder|apiKey|secret/i);
});

test("no qualified pattern completes as a deterministic no-trade analysis instead of failing", async () => {
  const marketSnapshot = noPatternSnapshot();
  let modelCalls = 0;
  const modelRegistry = {
    async analyze() {
      modelCalls += 1;
      throw new Error("the model must not be called for the deterministic no-candidate path");
    },
  };
  const params = {
    marketId: marketSnapshot.marketId,
    interval: marketSnapshot.interval,
    snapshotTime: marketSnapshot.snapshotTime,
    candles: marketSnapshot.candles,
    instruction: "帮我分析并画线",
  };

  const result = await runTradingHarmonicAnalysisPipeline(params, { modelRegistry, providerId: "stub" });
  assert.equal(result.ok, true);
  assert.equal(result.theoryResult.status, "insufficient_data");
  assert.equal(result.model.modelId, "harmonic-rule-engine-v3");
  assert.equal(modelCalls, 0);
  assert.match(result.analysisPlan.report, /扫描已经正常完成/);
  assert.match(result.analysisPlan.report, /当前动作：不交易/);
  assert.equal(result.analysisPlan.drawingPatch.operations.length >= 1, true);
  assert.equal(result.analysisPlan.drawingPatch.operations.every((operation) => (
    operation.drawing.layer === "ai/strategy/harmonic"
    && operation.drawing.colorToken === "strategy-note"
  )), true);
  assert.match(result.analysisPlan.drawingPatch.operations.at(-1).drawing.text, /未通过七形态全部硬规则/);

  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const coordinator = new TradingStrategyCoordinator({ registry, modelRegistry, providerId: "stub" });
  const coordinated = await coordinator.run("harmonic", params);
  assert.equal(coordinated.ok, true);
  assert.equal(coordinated.strategyResult.status, "completed");
  assert.equal(coordinated.executionPlan.action, "insufficient_data");
  assert.equal(coordinated.executionPlan.scenarios.length, 0);
  assert.match(coordinated.analysisPlan.report, /^## NOPATTERN\/USDT 币安永续 4H/m);
  assert.match(coordinated.analysisPlan.report, /数据\/价位不足，不交易/);
  assert.equal(modelCalls, 0);
});

test("harmonic request router preserves current chart defaults and rejects chart mutation in conversation", () => {
  assert.equal(stripTradingHarmonicMentionLiteral("@策略:谐波形态 分析下"), "分析下");
  assert.match(buildHarmonicRequestRoutingPrompt({ text: "分析下" }), /谐波形态请求路由器/);
  const routed = normalizeHarmonicRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
  }), "@策略:谐波形态", { hasCurrentAnalysis: false });
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.drawingRequested, true);
  assert.equal(routed.request.symbol, null);
  assert.throws(() => normalizeHarmonicRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "conversation",
    intent: "expert-question",
    symbol: "BTCUSDT",
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.99,
  }), "讲讲 Gartley"), /must not mutate/);
});

test("registry and coordinator complete the harmonic mention-to-drawing-to-execution-plan chain", async () => {
  const marketSnapshot = snapshot("butterfly");
  const candidate = runHarmonicPatternEngine(marketSnapshot).structures.primaryCandidate;
  const registry = createTradingStrategyRegistry({ adapters: BUILTIN_TRADING_STRATEGY_ADAPTERS });
  const modelRegistry = {
    async analyze(_providerId, request) {
      if (request.task === "harmonic-request-routing") {
        return {
          text: JSON.stringify({
            schemaVersion: 1,
            mode: "chart-analysis",
            intent: "chart-drawing",
            symbol: null,
            interval: null,
            lookbackMs: null,
            lookbackLabel: null,
            confidence: 0.99,
          }),
          providerId: "stub",
          modelId: "stub-router",
          requestId: request.requestId,
          latencyMs: 1,
        };
      }
      assert.equal(request.task, "harmonic-pattern-review-and-drawing-plan");
      return {
        text: modelText(candidate.id),
        providerId: "stub",
        modelId: "stub-review",
        requestId: request.requestId,
        latencyMs: 1,
        usage: null,
        finishReason: "stop",
      };
    },
  };
  const coordinator = new TradingStrategyCoordinator({ registry, modelRegistry, providerId: "stub" });
  const routed = await coordinator.classify("harmonic", {
    text: "@策略:谐波形态 分析当前图表并自动画线",
  });
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.drawingRequested, true);

  const result = await coordinator.run("harmonic", {
    marketId: marketSnapshot.marketId,
    interval: marketSnapshot.interval,
    snapshotTime: marketSnapshot.snapshotTime,
    candles: marketSnapshot.candles,
    instruction: routed.request.instruction,
  });
  assert.equal(result.ok, true);
  assert.equal(result.strategy.id, "harmonic");
  assert.equal(result.theoryResult.structures.primaryCandidate.patternId, "butterfly");
  assert.equal(result.analysisPlan.drawingPatch.operations.length, 21);
  assert.equal(result.executionPlan.takeProfits.length, 3);
  assert.match(result.analysisPlan.report, /^## TEST\/USDT 币安永续 1H/m);
  assert.match(result.analysisPlan.report, /谐波形态结论/);
});

test("renderer discovers harmonic metadata and requests enough closed candles without a host menu branch", () => {
  const catalog = fs.readFileSync(path.join(root, "src", "renderer", "trading-strategy-runtime", "catalog.ts"), "utf8");
  const market = fs.readFileSync(path.join(root, "src", "renderer", "trading-expert-market.ts"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src", "renderer", "main.ts"), "utf8");
  assert.match(catalog, /builtins\/\*\/strategy\.json/);
  assert.match(catalog, /buildTradingHarmonicExpertPrompt/);
  assert.match(catalog, /dataRequirements\?: Record<string/);
  assert.match(market, /minimumCandles/);
  assert.match(market, /preferredCandles/);
  assert.match(market, /analysisWindowCount/);
  assert.match(market, /captureSplitPaneAnalysisSnapshots\(\s*requestedLookbackMs,\s*preferredCandles,/);
  assert.match(renderer, /minimumCandles:\s*strategy\.dataRequirements/);
  assert.match(renderer, /preferredCandles:\s*strategy\.dataRequirements/);
  assert.match(renderer, /harmonic:/);
  assert.doesNotMatch(renderer, /strategy\.id === "harmonic"/);
});
