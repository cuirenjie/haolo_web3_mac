import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { HyperliquidPublicMarketService, normalizeHyperliquidCandleRequest } from "../src/main/hyperliquid-public-market-service.mjs";
import { runTradingIctSmcPipeline } from "../src/main/trading-analysis/ict-smc-pipeline.mjs";
import { runSmtDivergenceEngine } from "../src/main/trading-analysis/smt-divergence-engine.mjs";
import { runTradingSmtDivergencePipeline } from "../src/main/trading-analysis/smt-divergence-pipeline.mjs";
import { normalizeTradingMarketSnapshot } from "../src/main/trading-analysis/protocol.mjs";

const START = 1_720_000_000;
const STEP = 900;

function candles({ count = 140, scale = 1, lastPeakAdjustment = 0, noise = 0 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const lateAdjustment = index >= 100 && index <= 110
      ? lastPeakAdjustment * (1 - Math.abs(105 - index) / 6)
      : 0;
    const close = (100 + Math.sin(index * Math.PI / 10) * 5 + index * 0.005 + lateAdjustment + Math.sin(index * 1.7) * noise) * scale;
    const open = (100 + Math.sin((index - 0.4) * Math.PI / 10) * 5 + index * 0.005 + lateAdjustment) * scale;
    return {
      time: START + index * STEP,
      open,
      high: Math.max(open, close) + 0.3 * scale,
      low: Math.min(open, close) - 0.3 * scale,
      close,
      volume: 100 + index,
    };
  });
}

function params() {
  const primary = candles({ lastPeakAdjustment: 1.5 });
  const comparison = candles({ scale: 20, lastPeakAdjustment: -1.5, noise: 0.02 });
  const venue = candles({ scale: 1.001, lastPeakAdjustment: 1.48, noise: 0.005 });
  return {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "15",
    snapshotTime: (primary.at(-1).time + STEP + 1) * 1_000,
    candles: primary,
    contextCandles: [],
    comparisonMarkets: [
      { marketId: "HYPERLIQUID:PERP:BTC", symbol: "BTC", source: "hyperliquid-public", kind: "venue-confirmation", candles: venue },
      { marketId: "HYPERLIQUID:PERP:ETH", symbol: "ETH", source: "hyperliquid-public", kind: "correlated-market", candles: comparison },
    ],
  };
}

test("independent ICT/SMC pipeline reuses deterministic structure without writing the order-flow layer", async () => {
  const result = await runTradingIctSmcPipeline(params());
  assert.equal(result.ok, true);
  assert.equal(result.theoryResult.engineId, "ict_smc");
  assert.ok(result.analysisPlan.drawingPatch.operations.length > 0);
  assert.ok(result.analysisPlan.drawingPatch.operations.every(({ drawing }) => drawing.strategyId === "ict-smc" && drawing.layer === "ai/strategy/ict-smc"));
  assert.match(result.analysisPlan.report, /本 Skill 不读取逐笔成交或深度/);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
});

test("SMT engine requires synchronized correlation and identifies one-market higher-high non-confirmation", () => {
  const input = params();
  const snapshot = normalizeTradingMarketSnapshot(input);
  const first = runSmtDivergenceEngine(snapshot, input.comparisonMarkets);
  const second = runSmtDivergenceEngine(snapshot, input.comparisonMarkets);
  assert.deepEqual(first, second);
  assert.equal(first.status, "succeeded");
  assert.ok(first.statistics.alignedCandleCount >= 100);
  assert.ok(first.statistics.correlation >= 0.45);
  assert.equal(first.currentSignal?.type, "bearish");
  assert.match(first.currentSignal?.explanation || "", /更高高点/);

  const uncorrelated = input.comparisonMarkets.map((item) => item.kind === "correlated-market"
    ? { ...item, candles: item.candles.map((candle, index) => ({ ...candle, close: (index % 2 ? 40 : 10) + index * 0.01, open: (index % 2 ? 39 : 11) + index * 0.01, high: (index % 2 ? 41 : 12) + index * 0.01, low: (index % 2 ? 38 : 9) + index * 0.01 })) }
    : item);
  assert.equal(runSmtDivergenceEngine(snapshot, uncorrelated).status, "insufficient_data");
});

test("SMT pipeline draws only primary-market evidence and remains confirmation-only", async () => {
  const result = await runTradingSmtDivergencePipeline(params());
  assert.equal(result.ok, true);
  assert.equal(result.theoryResult.currentSignal.type, "bearish");
  assert.ok(result.analysisPlan.drawingPatch.operations.every(({ drawing }) => drawing.strategyId === "smt-divergence" && drawing.layer === "ai/strategy/smt-divergence"));
  assert.match(result.analysisPlan.report, /SMT 是方向确认线索，不是独立入场信号/);
  assert.match(result.analysisPlan.report, /Hyperliquid/);
  assert.equal(result.analysisPlan.actionPlan.disposition, "wait");
});

test("ICT/SMT pipelines ignore an unclosed primary candle and fingerprint comparison-market changes", async () => {
  const ictInput = params();
  const lastClosed = ictInput.candles.at(-1);
  ictInput.candles.push({
    time: lastClosed.time + STEP,
    open: lastClosed.close,
    high: lastClosed.close * 1.25,
    low: lastClosed.close * 0.75,
    close: lastClosed.close * 1.2,
    volume: 1_000_000,
  });
  ictInput.snapshotTime = (lastClosed.time + STEP + 1) * 1_000;
  const ictResult = await runTradingIctSmcPipeline(ictInput);
  assert.equal(ictResult.snapshot.lastClosedBarTime, lastClosed.time);

  const firstInput = params();
  const secondInput = params();
  const comparison = secondInput.comparisonMarkets.find((item) => item.kind === "correlated-market");
  comparison.candles = comparison.candles.map((candle, index) => index === 70
    ? { ...candle, open: candle.open * 1.01, high: candle.high * 1.01, low: candle.low * 1.01, close: candle.close * 1.01 }
    : candle);
  const first = await runTradingSmtDivergencePipeline(firstInput);
  const second = await runTradingSmtDivergencePipeline(secondInput);
  assert.notEqual(first.snapshot.inputHash, second.snapshot.inputHash);
  assert.notEqual(first.snapshot.snapshotId, second.snapshot.snapshotId);
});

test("Hyperliquid gateway is fixed to read-only candleSnapshot and caches snapshots", async () => {
  assert.deepEqual(normalizeHyperliquidCandleRequest({ coin: "btc", interval: "15m", startTime: 1, endTime: 2 }), { coin: "BTC", interval: "15m", startTime: 1, endTime: 2 });
  assert.throws(() => normalizeHyperliquidCandleRequest({ coin: "BTC", interval: "7m", startTime: 1, endTime: 2 }), /interval/);
  let calls = 0;
  let captured = null;
  const service = new HyperliquidPublicMarketService({
    fetch: async (url, init) => {
      calls += 1;
      captured = { url, init };
      return new Response(JSON.stringify([{ t: 1_000, T: 2_000, s: "BTC", i: "15m", o: "100", h: "102", l: "99", c: "101", v: "5" }]), { status: 200 });
    },
    now: () => 5_000,
  });
  const request = { coin: "BTC", interval: "15m", startTime: 1, endTime: 2 };
  const first = await service.candles(request);
  const second = await service.candles(request);
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(captured.url, "https://api.hyperliquid.xyz/info");
  assert.deepEqual(JSON.parse(captured.init.body), { type: "candleSnapshot", req: request });
});

test("SMT wiring is read-only, dual-theme, and cannot create an order-flow dependency", async () => {
  const [main, preload, renderer, styles, orderFlowPipeline, smtPipeline, ictPipeline] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/order-flow-pipeline.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/smt-divergence-pipeline.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/ict-smc-pipeline.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /hyperliquidMarket:candles[\s\S]*assertExternalModelsIpcSender/);
  assert.match(preload, /getHyperliquidPublicCandles/);
  assert.match(renderer, /fetchTradingSmtComparisonMarkets/);
  assert.match(renderer, /kind: "venue-confirmation"/);
  assert.match(renderer, /kind: "correlated-market"/);
  assert.match(styles, /\.trading-strategy-icon-smt-divergence/);
  assert.match(styles, /html\[data-theme="dark"\] \.trading-strategy-icon-smt-divergence/);
  assert.doesNotMatch(orderFlowPipeline, /smt-divergence|ict-smc-pipeline/);
  assert.doesNotMatch(smtPipeline, /order-flow/);
  assert.doesNotMatch(ictPipeline, /order-flow/);
});
