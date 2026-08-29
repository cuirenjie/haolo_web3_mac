import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  computeAtr,
  computeKdj,
  computeMacd,
  computeRsi,
  indicatorEma,
  indicatorSma,
} from "../src/main/trading-alerts/indicator-registry.mjs";
import { drawingPriceAtTime } from "../src/main/trading-alerts/drawing-geometry.mjs";
import { TradingAlertEvaluator, UNKNOWN, evaluateReplay } from "../src/main/trading-alerts/evaluator.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";

const baseFixture = normalizeAlertRule(JSON.parse(await readFile(new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url), "utf8")));

function candles(closes, start = 1_700_000_000_000, interval = 60_000) {
  return closes.map((close, index) => ({
    time: start + index * interval,
    closeTime: start + (index + 1) * interval,
    open: index ? closes[index - 1] : close,
    high: Math.max(index ? closes[index - 1] : close, close) + 1,
    low: Math.min(index ? closes[index - 1] : close, close) - 1,
    close,
    volume: 100 + index,
  }));
}

function singleRule(condition, root = null) {
  return normalizeAlertRule({
    ...baseFixture,
    ruleId: `rule-${condition.conditionId}`,
    root: root || { type: "condition", condition },
    dataRequirements: [],
    ruleHash: undefined,
  });
}

function event(rule, rows, id = "event-1", overrides = {}) {
  const time = rows.at(-1).closeTime;
  return {
    eventId: id,
    time,
    intervalMs: 60_000,
    frames: {
      primary: { candles: rows, index: rows.length - 1, closed: true, coverage: "available", receivedAt: time, ...overrides },
    },
  };
}

test("main-process indicator formulas match renderer golden vectors", async () => {
  const renderer = await import("../src/renderer/trading-expert-indicators.ts");
  const rows = candles(Array.from({ length: 80 }, (_, index) => 100 + Math.sin(index / 3) * 7 + index * 0.2));
  const closes = rows.map((entry) => entry.close);
  assert.deepEqual(indicatorSma(closes, 5), renderer.indicatorSma(closes, 5));
  assert.deepEqual(indicatorEma(closes, 12), renderer.indicatorEma(closes, 12));
  const oursMacd = computeMacd(closes);
  const theirsMacd = renderer.computeMacd(closes);
  assert.deepEqual(oursMacd.dif, theirsMacd.macd);
  assert.deepEqual(oursMacd.dea, theirsMacd.signal);
  assert.deepEqual(oursMacd.histogram, theirsMacd.histogram);
  assert.deepEqual(computeRsi(closes), renderer.computeRsi(closes));
  assert.deepEqual(computeKdj(rows), renderer.computeKdj(rows));
  assert.deepEqual(computeAtr(rows), renderer.computeAtr(rows));
});

test("cross-under is a strict edge and bar-close conditions wait for close", () => {
  const rule = singleRule({
    conditionId: "price-cross",
    contextId: "primary",
    operator: "cross_under",
    left: { type: "field", field: "close" },
    right: { type: "constant", value: 100 },
    confirmation: "bar_close",
  });
  const rows = candles([102, 101, 99]);
  const evaluator = new TradingAlertEvaluator();
  assert.equal(evaluator.evaluate(rule, event(rule, rows, "open", { closed: false })).value, UNKNOWN);
  assert.equal(evaluator.evaluate(rule, event(rule, rows, "closed")).value, true);
  assert.equal(evaluator.evaluate(rule, event(rule, candles([102, 99, 98]), "still-below")).value, false);
});

test("rolling volume windows exclude the current bar and compare every prior bar exactly", () => {
  const rule = singleRule({
    conditionId: "volume-three-times-prior-three",
    contextId: "primary",
    operator: "gt",
    left: { type: "field", field: "volume" },
    right: { type: "math", op: "mul", args: [
      { type: "constant", value: 3 },
      { type: "rolling", op: "max", expr: { type: "field", field: "volume" }, period: 3, offset: 1 },
    ] },
    confirmation: "bar_close",
  });
  const rows = candles([100, 101, 102, 103]);
  [100, 90, 110, 331].forEach((volume, index) => { rows[index].volume = volume; });
  const result = new TradingAlertEvaluator().evaluate(rule, event(rule, rows));
  assert.equal(result.value, true);
  assert.equal(result.trace[0].left, 331);
  assert.equal(result.trace[0].right, 330);

  rows.at(-1).volume = 330;
  assert.equal(new TradingAlertEvaluator().evaluate(rule, event(rule, rows, "equal-is-not-greater")).value, false);
  assert.equal(new TradingAlertEvaluator().evaluate(rule, event(rule, rows.slice(0, 3), "insufficient-history")).value, UNKNOWN);
});

test("AND OR NOT use fail-closed three-valued logic", () => {
  const trueNode = { type: "condition", condition: { conditionId: "a", contextId: "primary", operator: "gt", left: { type: "field", field: "close" }, right: { type: "constant", value: 1 }, confirmation: "intrabar" } };
  const unknownNode = { type: "condition", condition: { conditionId: "b", contextId: "primary", operator: "gt", left: { type: "field", field: "mark" }, right: { type: "constant", value: 1 }, confirmation: "intrabar" } };
  const allRule = singleRule(trueNode.condition, { type: "all", children: [trueNode, unknownNode] });
  const anyRule = singleRule(trueNode.condition, { type: "any", children: [trueNode, unknownNode] });
  const frame = event(allRule, candles([5]));
  assert.equal(new TradingAlertEvaluator().evaluate(allRule, frame).value, UNKNOWN);
  assert.equal(new TradingAlertEvaluator().evaluate(anyRule, frame).value, true);
});

test("stale or partial multi-context data never triggers", () => {
  const rule = singleRule({ conditionId: "fresh", contextId: "primary", operator: "gt", left: { type: "field", field: "close" }, right: { type: "constant", value: 1 }, confirmation: "intrabar" });
  const rows = candles([5]);
  const partial = event(rule, rows, "partial", { coverage: "partial" });
  const result = new TradingAlertEvaluator().evaluate(rule, partial);
  assert.equal(result.value, UNKNOWN);
  assert.equal(result.reason, "data_unavailable_or_stale");
});

test("drawing line uses exact geometry domain and the candle's plotted timestamp", () => {
  const drawing = { geometryMode: "segment", points: [{ time: 0, price: 100 }, { time: 100, price: 110 }] };
  assert.equal(drawingPriceAtTime(drawing, 50).value, 105);
  assert.equal(drawingPriceAtTime(drawing, 101).value, UNKNOWN);
  const rows = [{ time: 40, closeTime: 50, open: 104, high: 105, low: 103, close: 104, volume: 1 }];
  const rule = singleRule({
    conditionId: "touch-line", contextId: "primary", operator: "touch",
    left: { type: "field", field: "close" }, right: { type: "drawing", drawingId: "line-1", output: "price_at_time" },
    tolerance: { mode: "absolute", value: 0.01 }, confirmation: "intrabar",
  });
  const ev = event(rule, rows);
  ev.frames.primary.drawings = { "line-1": drawing };
  const result = new TradingAlertEvaluator().evaluate(rule, ev);
  assert.equal(result.value, true);
  assert.equal(result.trace[0].right, 104);
});

test("sustain, count and sequence state are event-idempotent and persistable", () => {
  const leaf = { type: "condition", condition: { conditionId: "temporal", contextId: "primary", operator: "gt", left: { type: "field", field: "close" }, right: { type: "constant", value: 10 }, confirmation: "intrabar" } };
  const sustainRule = singleRule(leaf.condition, { type: "sustain", child: leaf, count: 2, unit: "events" });
  const evaluator = new TradingAlertEvaluator();
  const first = event(sustainRule, candles([11]), "one");
  assert.equal(evaluator.evaluate(sustainRule, first).value, false);
  assert.equal(evaluator.evaluate(sustainRule, first).value, false);
  assert.equal(evaluator.evaluate(sustainRule, event(sustainRule, candles([11], 1_700_000_060_000), "two")).value, true);
  const saved = evaluator.exportState();
  const restored = new TradingAlertEvaluator(); restored.importState(saved);
  assert.deepEqual(restored.exportState(), saved);

  const countRule = singleRule(leaf.condition, { type: "count", child: leaf, atLeast: 2, window: { value: 3, unit: "events" } });
  const counter = new TradingAlertEvaluator();
  assert.equal(counter.evaluate(countRule, event(countRule, candles([11]), "c1")).value, false);
  assert.equal(counter.evaluate(countRule, event(countRule, candles([11], 1_700_000_060_000), "c2")).value, true);
});

test("replay input hashes and results are deterministic", () => {
  const rule = singleRule({ conditionId: "deterministic", contextId: "primary", operator: "gt", left: { type: "field", field: "close" }, right: { type: "constant", value: 10 }, confirmation: "intrabar" });
  const events = [event(rule, candles([9]), "a"), event(rule, candles([11], 1_700_000_060_000), "b")];
  assert.deepEqual(evaluateReplay(rule, events), evaluateReplay(rule, events));
});
