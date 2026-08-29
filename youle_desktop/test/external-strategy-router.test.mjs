import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExternalTradingRoutingPrompt,
  normalizeExternalTradingRoutingModelResponse,
  repairExternalTradingRoutingFromText,
} from "../src/main/trading-analysis/external-strategy-router.mjs";

const strategies = [
  { id: "chan", enabled: true, display: { name: "缠论" }, mentions: { canonical: "缠论", aliases: [] } },
  { id: "wave", enabled: true, display: { name: "波浪理论" }, mentions: { canonical: "波浪理论", aliases: ["波浪"] } },
];

function response(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    mode: "analysis",
    strategyId: "chan",
    symbol: "BTC",
    interval: "1h",
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
    clarificationQuestion: null,
    ...overrides,
  });
}

test("external router prompt explicitly supports fuzzy natural-language requests", () => {
  const prompt = buildExternalTradingRoutingPrompt({
    text: "帮我看下BTC 1h的K线用缠论来分析",
    strategies,
  });
  assert.match(prompt, /没有固定格式/);
  assert.match(prompt, /BTC 1h/);
  assert.match(prompt, /缠论/);
});

test("external router normalizes a base asset and hour interval for analysis", () => {
  const route = normalizeExternalTradingRoutingModelResponse(response(), strategies);
  assert.deepEqual(route, {
    mode: "analysis",
    strategyId: "chan",
    symbol: "BTCUSDT",
    interval: "60",
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
    clarificationQuestion: null,
  });
});

test("external router accepts a strategy display name returned by the model", () => {
  const route = normalizeExternalTradingRoutingModelResponse(response({ strategyId: "缠论" }), strategies);
  assert.equal(route.mode, "analysis");
  assert.equal(route.strategyId, "chan");
});

test("explicit natural language repairs an over-cautious clarification", () => {
  const route = repairExternalTradingRoutingFromText({
    text: "用缠论分析eth 1h级别的K线",
    strategies,
    route: {
      mode: "clarification",
      strategyId: null,
      symbol: null,
      interval: null,
      lookbackMs: null,
      lookbackLabel: null,
      confidence: 0.2,
      clarificationQuestion: "请补充策略、交易对和周期。",
    },
  });
  assert.equal(route.mode, "analysis");
  assert.equal(route.strategyId, "chan");
  assert.equal(route.symbol, "ETHUSDT");
  assert.equal(route.interval, "60");
  assert.equal(route.confidence, 0.96);
});

test("external router keeps the known strategy while asking for missing market context", () => {
  const route = normalizeExternalTradingRoutingModelResponse(response({
    symbol: null,
    interval: null,
    confidence: 0.91,
    mode: "analysis",
    clarificationQuestion: "请补充交易对和周期。",
  }), strategies);
  assert.equal(route.mode, "clarification");
  assert.equal(route.strategyId, "chan");
  assert.equal(route.symbol, null);
  assert.equal(route.interval, null);
  assert.equal(route.clarificationQuestion, "请补充交易对和周期。");
});

test("external router downgrades low-confidence analysis to clarification", () => {
  const route = normalizeExternalTradingRoutingModelResponse(response({ confidence: 0.4 }), strategies);
  assert.equal(route.mode, "clarification");
  assert.equal(route.strategyId, "chan");
});
