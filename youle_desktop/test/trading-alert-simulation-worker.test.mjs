import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { planAlertSimulationIsolated } from "../src/main/trading-alerts/simulation-worker-client.mjs";

const fixture = normalizeAlertRule(JSON.parse(await readFile(
  new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url),
  "utf8",
)));

function priceRule() {
  return normalizeAlertRule({
    ...fixture,
    ruleId: "worker-price-cross",
    title: "工作线程价格突破测试",
    root: {
      type: "condition",
      condition: {
        conditionId: "price-cross",
        contextId: "primary",
        operator: "cross_over",
        left: { type: "field", field: "close" },
        right: { type: "constant", value: 110 },
        confirmation: "bar_close",
      },
    },
    dataRequirements: [],
    ruleHash: undefined,
  });
}

function frames(count = 3) {
  const start = 1_700_000_000_000;
  const values = Array.from({ length: count }, (_, index) => 100 + index * 0.4);
  return {
    primary: {
      interval: "1h",
      closed: true,
      coverage: "available",
      candles: values.map((close, index) => ({
        time: start + index * 3_600_000,
        closeTime: start + (index + 1) * 3_600_000,
        open: index ? values[index - 1] : close,
        high: Math.max(index ? values[index - 1] : close, close) + 2,
        low: Math.min(index ? values[index - 1] : close, close) - 2,
        close,
        volume: 1_000,
      })),
    },
  };
}

function marketRows({ count, start, stepMs, initialPrice, drift = 0.02 }) {
  const values = Array.from({ length: count }, (_, index) => initialPrice + index * drift);
  return values.map((close, index) => {
    const open = index ? values[index - 1] : close;
    return {
      time: start + index * stepMs,
      closeTime: start + (index + 1) * stepMs,
      open,
      high: Math.max(open, close) + initialPrice * 0.002,
      low: Math.min(open, close) - initialPrice * 0.002,
      close,
      volume: 1_000 + index,
    };
  });
}

function multiContextDrawingRule() {
  const drawingContext = (contextId, drawingId) => ({
    contextId,
    marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] },
    intervals: ["4h"],
    drawingBinding: {
      drawingId,
      drawingRevision: 1,
      marketId: "BINANCE:FUTURES:BTCUSDT",
      interval: "4h",
      geometryMode: "extended",
    },
  });
  const drawingTouch = (contextId, drawingId, prefix) => ({ type: "all", children: [
    { type: "condition", condition: { conditionId: `${prefix}-high`, contextId, operator: "gte", left: { type: "field", field: "high" }, right: { type: "drawing", drawingId, output: "price_at_time" }, confirmation: "intrabar" } },
    { type: "condition", condition: { conditionId: `${prefix}-low`, contextId, operator: "lte", left: { type: "field", field: "low" }, right: { type: "drawing", drawingId, output: "price_at_time" }, confirmation: "intrabar" } },
  ] });
  return normalizeAlertRule({
    ...fixture,
    ruleId: "worker-multi-context-drawing-volume",
    contexts: [
      { ...fixture.contexts[0], marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:ETHUSDT"] }, intervals: ["1h"] },
      drawingContext("trend_line_1", "line-1"),
      drawingContext("trend_line_2", "line-2"),
    ],
    root: { type: "all", children: [
      { type: "any", children: [
        drawingTouch("trend_line_1", "line-1", "line-1"),
        drawingTouch("trend_line_2", "line-2", "line-2"),
      ] },
      { type: "condition", condition: {
        conditionId: "volume-up",
        contextId: "primary",
        operator: "gt",
        left: { type: "field", field: "volume" },
        right: { type: "lag", expr: { type: "field", field: "volume" }, bars: 1 },
        confirmation: "bar_close",
      } },
    ] },
    evaluationPolicy: { ...fixture.evaluationPolicy, joinMode: "latest_closed" },
    dataRequirements: [],
    ruleHash: undefined,
  });
}

function multiContextDrawingFrames(count = 500) {
  const start = 1_700_000_000_000;
  const drawingFrame = (drawingId, targetPrice) => {
    const candles = marketRows({ count, start, stepMs: 4 * 3_600_000, initialPrice: 100, drift: 0.002 });
    const last = candles.at(-1);
    return {
      interval: "4h",
      closed: true,
      coverage: "available",
      candles,
      drawings: {
        [drawingId]: {
          drawingId,
          geometryMode: "extended",
          points: [
            { time: last.closeTime - 4 * 3_600_000, price: targetPrice - 0.1 },
            { time: last.closeTime, price: targetPrice },
          ],
        },
      },
    };
  };
  return {
    primary: {
      interval: "1h",
      closed: true,
      coverage: "available",
      candles: marketRows({ count, start, stepMs: 3_600_000, initialPrice: 1_850, drift: 0.05 }),
    },
    trend_line_1: drawingFrame("line-1", 106),
    trend_line_2: drawingFrame("line-2", 108),
  };
}

test("isolated alert simulation leaves the Electron event loop responsive", async () => {
  let completed = false;
  const operation = planAlertSimulationIsolated({
    rule: priceRule(),
    frames: frames(),
    maxBars: 12,
    beamWidth: 32,
  }).finally(() => { completed = true; });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(completed, false, "the main event loop must run while the worker is calculating");
  const simulation = await operation;
  assert.equal(simulation.proof.triggered, true);
});

test("multi-context drawing touch plus volume is solved directly without exhausting the worker", async () => {
  const startedAt = Date.now();
  const simulation = await planAlertSimulationIsolated({
    rule: multiContextDrawingRule(),
    frames: multiContextDrawingFrames(),
    maxBars: 48,
    beamWidth: 160,
    timeoutMs: 5_000,
  });
  assert.equal(simulation.proof.triggered, true);
  assert.ok(simulation.triggerPoints.some((point) => point.kind === "drawing"));
  assert.ok(Date.now() - startedAt < 5_000);
});

test("a runaway alert simulation is terminated by a hard timeout", async () => {
  await assert.rejects(
    () => planAlertSimulationIsolated({
      rule: fixture,
      frames: frames(500),
      maxBars: 48,
      beamWidth: 160,
      timeoutMs: 1,
    }),
    (error) => error?.code === "TRADING_ALERT_SIMULATION_TIMEOUT" && error?.retryable === true,
  );
});

test("an aborted alert simulation terminates its worker and reports cancellation", async () => {
  const controller = new AbortController();
  const operation = planAlertSimulationIsolated({
    rule: fixture,
    frames: frames(500),
    maxBars: 48,
    beamWidth: 160,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    () => operation,
    (error) => error?.code === "TRADING_ALERT_SIMULATION_CANCELLED",
  );
});
