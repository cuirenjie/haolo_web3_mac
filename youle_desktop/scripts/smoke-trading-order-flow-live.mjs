import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
import { runTradingOrderFlowAnalysisPipeline } from "../src/main/trading-analysis/order-flow-pipeline.mjs";

const execFileAsync = promisify(execFile);
const BINANCE_FUTURES_URL = "https://fapi.binance.com";

async function fetchJson(path) {
  const url = new URL(path, BINANCE_FUTURES_URL).toString();
  const { stdout } = await execFileAsync("curl.exe", [
    "--connect-timeout",
    "10",
    "--max-time",
    "30",
    "--silent",
    "--show-error",
    "--fail",
    "--location",
    url,
  ], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const [klines, fourHourKlines, dailyKlines, aggregateTrades, depth, openInterestHistory] = await Promise.all([
  fetchJson("/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=300"),
  fetchJson("/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=240"),
  fetchJson("/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=240"),
  fetchJson("/fapi/v1/aggTrades?symbol=BTCUSDT&limit=1000"),
  fetchJson("/fapi/v1/depth?symbol=BTCUSDT&limit=100"),
  fetchJson("/futures/data/openInterestHist?symbol=BTCUSDT&period=15m&limit=30").catch(() => []),
]);

const trades = aggregateTrades.map((trade) => ({
  id: String(trade.a),
  time: Number(trade.T) / 1_000,
  price: Number(trade.p),
  quantity: Number(trade.q),
  side: trade.m === true ? "sell" : "buy",
}));
const modelRegistry = createTradingAnalysisModelProviderRegistry([{
  providerId: "live-smoke-provider",
  modelId: "contract-check-model",
  capabilities: { json: true, theoryReview: true },
  async analyze() {
    return {
      text: JSON.stringify({
        schemaVersion: 1,
        verdict: "approve",
        summary: "真实订单流数据已完成确定性计算与候选复核。",
        report: "烟测复核器只验证模型中立协议，不添加确定性候选之外的事实。",
        marketBias: "neutral",
        strategyRationale: "以实时 Delta、POC 与深度快照的同向变化作为后续确认条件。",
        selectedClusterIds: [],
        selectedPressureEventIds: [],
        selectedMarketStructureIds: [],
        showPointOfControl: true,
        showDealingRange: true,
        showLiquidity: true,
        confidence: 0.5,
      }),
    };
  },
}]);

const result = await runTradingOrderFlowAnalysisPipeline({
  marketId: "BINANCE:FUTURES:BTCUSDT",
  interval: "15",
  snapshotTime: Date.now(),
  instruction: "真实订单流纵向链路烟测",
  candles: klines.map((bar) => ({
    time: Number(bar[0]) / 1_000,
    open: Number(bar[1]),
    high: Number(bar[2]),
    low: Number(bar[3]),
    close: Number(bar[4]),
    volume: Number(bar[5]),
  })),
  contextCandles: [
    { interval: "240", candles: fourHourKlines },
    { interval: "1D", candles: dailyKlines },
  ].map((context) => ({
    interval: context.interval,
    candles: context.candles.map((bar) => ({
      time: Number(bar[0]) / 1_000,
      open: Number(bar[1]),
      high: Number(bar[2]),
      low: Number(bar[3]),
      close: Number(bar[4]),
      volume: Number(bar[5]),
    })),
  })),
  orderFlow: {
    source: "binance-rest",
    windowStart: trades.at(0)?.time || 0,
    windowEnd: trades.at(-1)?.time || 0,
    trades,
    depth: {
      snapshotTime: Number(depth.T || depth.E || Date.now()),
      lastUpdateId: Number(depth.lastUpdateId || 0),
      bids: depth.bids.map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) })),
      asks: depth.asks.map(([price, quantity]) => ({ price: Number(price), quantity: Number(quantity) })),
    },
    openInterest: {
      current: null,
      history: openInterestHistory.map((point) => ({
        time: Number(point.timestamp) / 1_000,
        value: Number(point.sumOpenInterest),
      })),
    },
    coverage: {
      trades: trades.length >= 50 ? "available" : trades.length ? "partial" : "unavailable",
      depth: depth.bids.length >= 5 && depth.asks.length >= 5 ? "partial" : "unavailable",
      openInterest: openInterestHistory.length >= 2 ? "available" : "unavailable",
      liquidations: "unavailable",
    },
  },
}, {
  modelRegistry,
  providerId: "live-smoke-provider",
});

console.log(JSON.stringify({
  marketId: result.snapshot.marketId,
  tradeCount: result.theoryResult.statistics.tradeCount,
  depthLevels: result.theoryResult.structures.depthSnapshot.levelCount,
  openInterestPoints: openInterestHistory.length,
  coverage: result.snapshot.orderFlowCoverage,
  direction: result.theoryResult.statistics.direction,
  deltaRatio: result.theoryResult.statistics.deltaRatio,
  pointOfControl: result.theoryResult.structures.pointOfControl?.price,
  marketStructureTimeframes: result.theoryResult.marketStructure.statistics.timeframeCount,
  structureEvents: result.theoryResult.marketStructure.statistics.structureEventCount,
  orderBlocks: result.theoryResult.marketStructure.statistics.orderBlockCount,
  fairValueGaps: result.theoryResult.marketStructure.statistics.fairValueGapCount,
  liquidityPools: result.theoryResult.marketStructure.statistics.liquidityPoolCount,
  sweeps: result.theoryResult.marketStructure.statistics.sweepCount,
  structureFlowAlignment: result.theoryResult.marketStructure.orderFlowConfirmation.state,
  drawingOperations: result.analysisPlan.drawingPatch.operations.length,
  actionPlan: result.analysisPlan.actionPlan,
  drawingLabels: result.analysisPlan.drawingPatch.operations
    .filter(({ drawing }) => drawing.tool === "note")
    .map(({ drawing }) => drawing.text),
  microDrawingPoints: result.analysisPlan.drawingPatch.operations
    .filter(({ drawing }) => ["order-flow-buy", "order-flow-sell", "order-flow-poc"].includes(drawing.colorToken))
    .map(({ drawing }) => ({
      id: drawing.id,
      tool: drawing.tool,
      text: drawing.text,
      points: drawing.points,
    })),
  drawingLayer: result.analysisPlan.drawingPatch.operations[0]?.drawing.layer,
}, null, 2));
