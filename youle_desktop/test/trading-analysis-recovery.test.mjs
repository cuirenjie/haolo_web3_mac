import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { validateTradingDrawingPatch } from "../src/main/trading-analysis/protocol.mjs";

const root = path.resolve(import.meta.dirname, "..");
const recoveryPath = path.join(root, "src/renderer/trading-analysis-recovery.ts");
const policyUrl = pathToFileURL(
  path.join(root, "src/main/trading-analysis/request-routing-policy.mjs"),
).href;

async function recoveryModule() {
  const source = (await readFile(recoveryPath, "utf8"))
    .replace("../main/trading-analysis/request-routing-policy.mjs", policyUrl);
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));
}

const candles = Array.from({ length: 40 }, (_, index) => {
  const close = 100 + index * 0.35;
  return {
    time: 1_800_000_000 + index * 3_600,
    open: close - 0.2,
    high: close + 0.6,
    low: close - 0.7,
    close,
    volume: 1_000 + index,
  };
});

test("local recovery returns a question-aligned answer and a renderer-valid safe drawing patch", async () => {
  const recovery = await recoveryModule();
  const result = recovery.buildRecoverableTradingAnalysis({
    analysisId: "fault-injection",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    symbol: "BTCUSDT",
    interval: "60",
    instruction: "现在能做多吗，给出入场、止损和目标",
    candles,
    reason: new Error("model provider offline"),
  });
  assert.ok(result);
  assert.match(result.report, /^基于当前 1小时 已收盘 K 线，盘面暂时偏多/);
  assert.match(result.report, /做多需等待收盘站上/);
  assert.doesNotMatch(result.report, /model provider offline/);
  assert.equal(result.degraded, true);
  assert.equal(result.drawingPatch.operations.length, 3);
  for (const operation of result.drawingPatch.operations) {
    assert.equal(operation.drawing.symbol, "BINANCE:FUTURES:BTCUSDT");
    assert.equal(operation.drawing.layer, "ai/price-action");
    assert.equal(operation.drawing.locked, true);
  }
  assert.doesNotThrow(() => validateTradingDrawingPatch(result.drawingPatch, {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
  }));
});

test("question lead uses validated action levels while short-data recovery stays honest", async () => {
  const recovery = await recoveryModule();
  const lead = recovery.buildQuestionAlignedTradingLead({
    instruction: "支撑和阻力在哪里",
    interval: "15",
    candles,
    actionPlan: {
      primaryBias: "bearish",
      shortTrigger: 98,
      shortInvalidation: 102,
      shortTarget: 94,
    },
  });
  assert.match(lead, /关键支撑/);
  assert.match(lead, /关键压力/);
  assert.equal(recovery.buildRecoverableTradingAnalysis({
    analysisId: "too-short",
    marketId: "BINANCE:FUTURES:BTCUSDT",
    symbol: "BTCUSDT",
    interval: "15",
    instruction: "多还是空",
    candles: candles.slice(0, 1),
  }), null);
});
