import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { chartSwitchRequest, exactConditionTriggerPoints, planAlertSimulation, verifySimulation } from "../src/main/trading-alerts/simulation-planner.mjs";

const base = normalizeAlertRule(JSON.parse(await readFile(new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url), "utf8")));

function rows(values) {
  const start = 1_700_000_000_000;
  return values.map((close, index) => ({
    time: start + index * 3_600_000,
    closeTime: start + (index + 1) * 3_600_000,
    open: index ? values[index - 1] : close,
    high: Math.max(index ? values[index - 1] : close, close) + 2,
    low: Math.min(index ? values[index - 1] : close, close) - 2,
    close,
    volume: 1000,
  }));
}

function priceRule(operator, value) {
  return normalizeAlertRule({
    ...base,
    ruleId: `simulation-${operator}`,
    title: "价格触发模拟",
    root: { type: "condition", condition: {
      conditionId: "price-edge", contextId: "primary", operator,
      left: { type: "field", field: "close" }, right: { type: "constant", value }, confirmation: "bar_close",
    } },
    dataRequirements: [],
    ruleHash: undefined,
  });
}

function frames(values) {
  return { primary: { interval: "1h", candles: rows(values), closed: true, coverage: "available" } };
}

test("planner synthesizes legal OHLCV and proves a strict price crossing with the real evaluator", async () => {
  const rule = priceRule("cross_over", 110);
  const source = frames([100, 101, 102]);
  source.primary.tickSize = 0.5;
  const simulation = await planAlertSimulation({ rule, frames: source, maxBars: 12, beamWidth: 32 });
  assert.equal(simulation.proof.triggered, true);
  assert.equal(simulation.overlay.isolated, true);
  assert.match(simulation.overlay.layerId, /^alert-simulation\//);
  assert.ok(simulation.generated.primary.length >= 6);
  assert.ok(simulation.triggerBarIndex >= 2);
  assert.equal(simulation.generated.primary[0].time, source.primary.candles.at(-1).closeTime);
  for (const [index, candle] of simulation.generated.primary.entries()) {
    assert.ok(candle.low <= Math.min(candle.open, candle.close));
    assert.ok(candle.high >= Math.max(candle.open, candle.close));
    assert.ok(candle.volume >= 0);
    assert.ok(Math.abs(candle.close / 0.5 - Math.round(candle.close / 0.5)) < 1e-9);
    const previous = index ? simulation.generated.primary[index - 1] : source.primary.candles.at(-1);
    assert.equal(candle.time, previous.closeTime);
    assert.equal(candle.open, previous.close);
    assert.ok(Math.abs(candle.close - candle.open) <= simulation.overlay.realism.maxMoveByContext.primary + 1e-9);
  }
  assert.equal(verifySimulation(rule, source, simulation).valid, true);
});

test("simulation is deterministic in path semantics and never mutates real candles", async () => {
  const rule = priceRule("cross_under", 90);
  const source = frames([100, 99, 98]);
  const before = structuredClone(source);
  const simulation = await planAlertSimulation({ rule, frames: source, maxBars: 12, beamWidth: 32 });
  assert.deepEqual(source, before);
  assert.ok(simulation.generated.primary.length > 0);
  assert.equal(simulation.proof.trace[0].conditionId, "price-edge");
});

test("planner searches volume as a first-class OHLCV dimension and proves a three-bar volume spike", async () => {
  const rule = normalizeAlertRule({
    ...base,
    ruleId: "simulation-volume-spike",
    title: "量能超过前3根每根三倍",
    root: { type: "condition", condition: {
      conditionId: "volume-spike",
      contextId: "primary",
      operator: "gt",
      left: { type: "field", field: "volume" },
      right: { type: "math", op: "mul", args: [
        { type: "constant", value: 3 },
        { type: "rolling", op: "max", expr: { type: "field", field: "volume" }, period: 3, offset: 1 },
      ] },
      confirmation: "bar_close",
    } },
    dataRequirements: [],
    ruleHash: undefined,
  });
  const source = frames([100, 101, 102, 103, 104]);
  source.primary.candles.forEach((candle, index) => { candle.volume = 900 + index * 25; });
  const simulation = await planAlertSimulation({ rule, frames: source, maxBars: 8, beamWidth: 24 });
  const trigger = simulation.generated.primary[simulation.triggerBarIndex];
  const prior = [
    ...source.primary.candles,
    ...simulation.generated.primary.slice(0, simulation.triggerBarIndex),
  ].slice(-3);
  assert.ok(trigger.volume > Math.max(...prior.map((candle) => candle.volume)) * 3);
  assert.ok(simulation.triggerBarIndex >= 2);
  assert.equal(simulation.proof.trace[0].conditionId, "volume-spike");
  assert.equal(verifySimulation(rule, source, simulation).valid, true);
});

test("specified fixed market produces a chart switch request before simulation", () => {
  assert.deepEqual(chartSwitchRequest(base), {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "1h",
    reason: "alert_simulation_context",
  });
});

test("unsupported or uncontrollable conditions fail closed instead of showing a false proof", async () => {
  const rule = normalizeAlertRule({
    ...base,
    ruleId: "external-simulation",
    root: { type: "condition", condition: {
      conditionId: "external", contextId: "primary", operator: "gt",
      left: { type: "external", capability: "chain.whales", field: "flow", params: {} },
      right: { type: "constant", value: 10 }, confirmation: "intrabar",
    } },
    evaluationPolicy: { ...base.evaluationPolicy, clock: "mixed" },
    dataRequirements: [],
    ruleHash: undefined,
  });
  await assert.rejects(() => planAlertSimulation({ rule, frames: frames([100, 101]), maxBars: 1, beamWidth: 4 }), /无法构造/);
});

test("complex MA5/MA20 death cross and MACD zero-axis cross are solved together", async () => {
  const values = Array.from({ length: 80 }, (_, index) => 100 + index * 0.1);
  const simulation = await planAlertSimulation({ rule: base, frames: frames(values), maxBars: 12, beamWidth: 80 });
  assert.equal(simulation.proof.triggered, true);
  assert.deepEqual(simulation.proof.trace.map((entry) => entry.conditionId), ["ma_cross", "macd_zero"]);
  assert.ok(simulation.proof.trace.every((entry) => entry.value === true));
  const point = simulation.triggerPoints.find((entry) => entry.conditionId === "ma_cross");
  assert.equal(point?.kind, "indicator");
  const trace = simulation.proof.trace.find((entry) => entry.conditionId === "ma_cross");
  const triggerCandle = simulation.generated.primary[simulation.triggerBarIndex];
  const previousCandle = simulation.triggerBarIndex > 0
    ? simulation.generated.primary[simulation.triggerBarIndex - 1]
    : frames(values).primary.candles.at(-1);
  const previousDifference = trace.previousLeft - trace.previousRight;
  const currentDifference = trace.left - trace.right;
  const progress = -previousDifference / (currentDifference - previousDifference);
  const expectedTime = previousCandle.time + (triggerCandle.time - previousCandle.time) * progress;
  const expectedLeft = trace.previousLeft + (trace.left - trace.previousLeft) * progress;
  const expectedRight = trace.previousRight + (trace.right - trace.previousRight) * progress;
  assert.ok(Math.abs(point.time - expectedTime) < 1e-6);
  assert.ok(Math.abs(point.price - (expectedLeft + expectedRight) / 2) < 1e-9);
  assert.ok(point.time >= previousCandle.time && point.time <= triggerCandle.time);
});

test("drawing touch is solved from exact bound line geometry", async () => {
  const source = frames([100, 101, 102]);
  const last = source.primary.candles.at(-1);
  source.primary.drawings = {
    line1: {
      drawingId: "line1",
      geometryMode: "extended",
      points: [
        { time: last.closeTime - 3_600_000, price: 108 },
        { time: last.closeTime, price: 110 },
      ],
    },
  };
  const rule = normalizeAlertRule({
    ...base,
    ruleId: "drawing-touch-simulation",
    contexts: [{ ...base.contexts[0], drawingBinding: { drawingId: "line1", drawingRevision: 1, marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1h", geometryMode: "extended" } }],
    root: { type: "condition", condition: {
      conditionId: "touch-line", contextId: "primary", operator: "touch",
      left: { type: "field", field: "close" }, right: { type: "drawing", drawingId: "line1", output: "price_at_time" },
      tolerance: { mode: "absolute", value: 0.01 }, confirmation: "intrabar",
    } },
    evaluationPolicy: { ...base.evaluationPolicy, clock: "mixed" },
    dataRequirements: [], ruleHash: undefined,
  });
  const simulation = await planAlertSimulation({ rule, frames: source, maxBars: 12, beamWidth: 40 });
  assert.equal(simulation.proof.triggered, true);
  assert.equal(simulation.proof.trace[0].conditionId, "touch-line");
  assert.ok(simulation.generated.primary.length >= 6);
  assert.ok(simulation.triggerBarIndex >= 2);
  assert.equal(simulation.generated.primary[0].time, last.closeTime);
  const triggerCandle = simulation.generated.primary[simulation.triggerBarIndex];
  const expectedTriggerPrice = 108 + (triggerCandle.time - (last.closeTime - 3_600_000)) / 3_600_000 * 2;
  assert.deepEqual(simulation.triggerPoint, {
    time: triggerCandle.time,
    price: expectedTriggerPrice,
    conditionId: "touch-line",
  });
  assert.ok(triggerCandle.low <= simulation.triggerPoint.price);
  assert.ok(triggerCandle.high >= simulation.triggerPoint.price);
  assert.equal(simulation.triggerPoints.length, 1);
  assert.deepEqual(simulation.triggerPoints[0].conditionIds, ["touch-line"]);
  assert.deepEqual(simulation.activeConditionIds, ["touch-line"]);
});

test("visual evidence includes drawing conditions from sibling contexts and groups one touch into one annotation point", () => {
  const drawingContext = {
    contextId: "drawing_1",
    marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] },
    intervals: ["1h"],
    drawingBinding: {
      drawingId: "line-sibling",
      drawingRevision: 1,
      marketId: "BINANCE:FUTURES:BTCUSDT",
      interval: "1h",
      geometryMode: "extended",
    },
  };
  const drawing = { type: "drawing", drawingId: "line-sibling", output: "price_at_time" };
  const rule = normalizeAlertRule({
    ...base,
    ruleId: "multi-condition-sibling-drawing-evidence",
    contexts: [base.contexts[0], drawingContext],
    root: { type: "all", children: [
      { type: "all", children: [
        { type: "condition", condition: { conditionId: "touch-high", contextId: "drawing_1", operator: "gte", left: { type: "field", field: "high" }, right: drawing, confirmation: "intrabar" } },
        { type: "condition", condition: { conditionId: "touch-low", contextId: "drawing_1", operator: "lte", left: { type: "field", field: "low" }, right: drawing, confirmation: "intrabar" } },
      ] },
      { type: "condition", condition: { conditionId: "volume-up", contextId: "primary", operator: "gt", left: { type: "field", field: "volume" }, right: { type: "lag", expr: { type: "field", field: "volume" }, bars: 1 }, confirmation: "bar_close" } },
    ] },
    evaluationPolicy: { ...base.evaluationPolicy, clock: "mixed" },
    dataRequirements: [],
    ruleHash: undefined,
  });
  const original = {
    primary: { interval: "1h", candles: rows([100, 101, 102]) },
    drawing_1: { interval: "1h", candles: rows([100, 101, 102]) },
  };
  const triggerCandle = {
    time: original.drawing_1.candles.at(-1).closeTime,
    closeTime: original.drawing_1.candles.at(-1).closeTime + 3_600_000,
    open: 102,
    high: 106,
    low: 102,
    close: 104,
    volume: 1_500,
  };
  const completed = {
    primary: { interval: "1h", candles: [...original.primary.candles, triggerCandle] },
    drawing_1: { interval: "1h", candles: [...original.drawing_1.candles, triggerCandle] },
  };
  const proof = {
    trace: [
      { conditionId: "touch-high", value: true, left: 106, right: 104 },
      { conditionId: "touch-low", value: true, left: 102, right: 104 },
      { conditionId: "volume-up", value: true, left: 1_500, right: 1_000 },
    ],
  };
  const points = exactConditionTriggerPoints(rule, proof, completed, original, 0);
  assert.equal(points.length, 1, "the technical high/low leaves form one user-visible touch condition");
  assert.equal(points[0].contextId, "drawing_1");
  assert.equal(points[0].drawingId, "line-sibling");
  assert.equal(points[0].price, 104);
  assert.deepEqual([...points[0].conditionIds].sort(), ["touch-high", "touch-low"]);
});

test("sequence conditions preserve order within the requested bar window", async () => {
  const condition = (conditionId, operator, value) => ({ type: "condition", condition: {
    conditionId, contextId: "primary", operator,
    left: { type: "field", field: "close" }, right: { type: "constant", value }, confirmation: "bar_close",
  } });
  const rule = normalizeAlertRule({
    ...base, ruleId: "sequence-simulation",
    root: { type: "sequence", steps: [condition("first-up", "cross_over", 105), condition("then-down", "cross_under", 95)], within: { value: 4, unit: "bars" } },
    dataRequirements: [], ruleHash: undefined,
  });
  const simulation = await planAlertSimulation({ rule, frames: frames([100, 101, 102]), maxBars: 12, beamWidth: 80 });
  assert.equal(simulation.proof.triggered, true);
  assert.ok(simulation.generated.primary.length >= 2);
});

test("multiple contexts are evaluated as one deterministic confirmation", async () => {
  const rule = normalizeAlertRule({
    ...base,
    ruleId: "multi-context-simulation",
    contexts: [
      base.contexts[0],
      { contextId: "confirm", marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:ETHUSDT"] }, intervals: ["4h"] },
    ],
    root: { type: "all", children: [
      { type: "condition", condition: { conditionId: "primary-down", contextId: "primary", operator: "cross_under", left: { type: "field", field: "close" }, right: { type: "constant", value: 95 }, confirmation: "bar_close" } },
      { type: "condition", condition: { conditionId: "confirm-down", contextId: "confirm", operator: "cross_under", left: { type: "field", field: "close" }, right: { type: "constant", value: 95 }, confirmation: "bar_close" } },
    ] },
    evaluationPolicy: { ...base.evaluationPolicy, joinMode: "latest_closed" },
    dataRequirements: [], ruleHash: undefined,
  });
  const source = { ...frames([100, 101, 102]), confirm: { interval: "4h", candles: rows([100, 101, 102]), closed: true, coverage: "available" } };
  const simulation = await planAlertSimulation({ rule, frames: source, maxBars: 12, beamWidth: 40 });
  assert.equal(simulation.proof.triggered, true);
  assert.deepEqual(Object.keys(simulation.generated).sort(), ["confirm", "primary"]);
});
