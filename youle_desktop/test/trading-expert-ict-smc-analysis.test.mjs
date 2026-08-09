import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runIctSmcTheoryEngine } from "../src/main/trading-analysis/ict-smc-engine.mjs";
import { createTradingAnalysisModelProviderRegistry } from "../src/main/trading-analysis/model-provider.mjs";
import { runTradingOrderFlowAnalysisPipeline } from "../src/main/trading-analysis/order-flow-pipeline.mjs";
import {
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "../src/main/trading-analysis/protocol.mjs";

const STRUCTURE_ANCHORS = [
  [0, 100], [10, 110], [20, 104], [30, 114], [40, 108], [50, 116],
  [55, 106], [65, 100], [72, 110], [80, 102], [88, 110.05], [96, 102.05],
  [104, 109.7], [112, 104], [120, 108], [130, 101], [140, 109], [150, 103], [159, 107],
];

function anchorPrice(index) {
  for (let anchorIndex = 1; anchorIndex < STRUCTURE_ANCHORS.length; anchorIndex += 1) {
    const [rightIndex, rightPrice] = STRUCTURE_ANCHORS[anchorIndex];
    const [leftIndex, leftPrice] = STRUCTURE_ANCHORS[anchorIndex - 1];
    if (index > rightIndex) continue;
    const progress = (index - leftIndex) / (rightIndex - leftIndex);
    return leftPrice + (rightPrice - leftPrice) * progress;
  }
  return STRUCTURE_ANCHORS.at(-1)[1];
}

function fixtureCandles(count = 160, intervalSeconds = 900, priceScale = 1) {
  return Array.from({ length: count }, (_, index) => {
    let close = anchorPrice(index) * priceScale;
    const previous = anchorPrice(Math.max(0, index - 1)) * priceScale;
    let open = previous + (close - previous) * 0.3;
    let high = Math.max(open, close) + 0.24 * priceScale;
    let low = Math.min(open, close) - 0.24 * priceScale;
    if (index === 55) {
      open = 115 * priceScale;
      close = 106 * priceScale;
      high = 115.3 * priceScale;
      low = 105.6 * priceScale;
    }
    if (index === 104) {
      close = 109.7 * priceScale;
      high = 111.2 * priceScale;
      low = Math.min(open, close) - 0.2 * priceScale;
    }
    if (index === 112) {
      open = 101.5 * priceScale;
      close = 104 * priceScale;
      high = 104.3 * priceScale;
      low = 98.8 * priceScale;
    }
    return {
      time: 1_720_000_000 + index * intervalSeconds,
      open,
      high,
      low,
      close,
      volume: index === 55 ? 900 : index === 112 ? 700 : 100 + (index % 11) * 12,
    };
  });
}

function fixtureOrderFlow() {
  const trades = Array.from({ length: 240 }, (_, index) => ({
    id: String(100_000 + index),
    time: 1_720_143_400 + index,
    price: 106.8 + (index % 9) * 0.01,
    quantity: index % 4 === 0 ? 0.7 : 2.1,
    side: index % 4 === 0 ? "sell" : "buy",
  }));
  return {
    source: "binance-rest",
    windowStart: trades[0].time,
    windowEnd: trades.at(-1).time,
    trades,
    depth: {
      snapshotTime: 1_720_144_000_000,
      lastUpdateId: 12345,
      bids: Array.from({ length: 30 }, (_, index) => ({ price: 106.8 - index * 0.01, quantity: 8 + index * 0.2 })),
      asks: Array.from({ length: 30 }, (_, index) => ({ price: 106.81 + index * 0.01, quantity: 4 + index * 0.1 })),
    },
    openInterest: { current: 1_010_000, history: [] },
    coverage: {
      trades: "available",
      depth: "partial",
      openInterest: "partial",
      liquidations: "unavailable",
    },
  };
}

function fixtureParams() {
  return {
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "15",
    snapshotTime: 1_720_200_000_000,
    instruction: "绘制 ICT/SMC 与真实订单流证据",
    candles: fixtureCandles(),
    contextCandles: [
      { interval: "240", candles: fixtureCandles(160, 14_400, 1.05) },
      { interval: "1D", candles: fixtureCandles(160, 86_400, 1.1) },
    ],
    orderFlow: fixtureOrderFlow(),
  };
}

test("ICT/SMC engine deterministically identifies structure, zones, liquidity, and multi-timeframe context", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const first = runIctSmcTheoryEngine(snapshot);
  const second = runIctSmcTheoryEngine(snapshot);

  assert.deepEqual(first, second);
  assert.equal(first.engineId, "ict_smc");
  assert.equal(first.status, "succeeded");
  assert.equal(first.statistics.timeframeCount, 3);
  assert.ok(first.structures.structureEvents.some((event) => event.kind === "MSS"));
  assert.ok(first.structures.structureEvents.some((event) => event.kind === "BOS" || event.kind === "CHoCH"));
  assert.ok(first.structures.fairValueGaps.length > 0);
  assert.ok(first.structures.orderBlocks.length > 0);
  assert.ok(first.structures.breakers.length > 0);
  assert.ok(first.structures.liquidityPools.some((pool) => pool.side === "BSL"));
  assert.ok(first.structures.liquidityPools.some((pool) => pool.side === "SSL"));
  assert.ok(first.structures.sweeps.length > 0);
  assert.equal(first.structures.dealingRanges.length, 3);
  assert.ok(first.structures.dealingRanges.every((range) => (
    range.low < range.equilibrium
    && range.equilibrium < range.high
    && range.ote.lower < range.ote.upper
  )));
});

test("combined pipeline lets the model select fixed candidates and emits clear ICT/SMC labels", async () => {
  const calls = [];
  const registry = createTradingAnalysisModelProviderRegistry([{
    providerId: "fixture-provider",
    modelId: "fixture-model",
    capabilities: { json: true, theoryReview: true },
    async analyze(request) {
      calls.push(request);
      return {
        text: JSON.stringify({
          schemaVersion: 1,
          verdict: "approve",
          summary: "多周期结构与当前主动买盘同向，但历史区域仍按 OHLCV 候选处理。",
          report: "只选择确定性引擎提供的结构候选，不补造历史逐笔证据。",
          marketBias: "buying",
          strategyRationale: "等待有效 OB/FVG 回踩与 MSS/BOS 延续，跌破失效位则取消。",
          selectedClusterIds: [],
          selectedPressureEventIds: [],
          selectedMarketStructureIds: [],
          showPointOfControl: true,
          showDealingRange: true,
          showLiquidity: true,
          confidence: 0.74,
        }),
      };
    },
  }]);
  const result = await runTradingOrderFlowAnalysisPipeline(fixtureParams(), {
    modelRegistry: registry,
    providerId: "fixture-provider",
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /BOS、CHoCH、MSS、OB、FVG、Breaker、EQ、OTE、BSL\/SSL 与 Sweep/);
  assert.ok(result.theoryResult.marketStructure);
  assert.ok(result.analysisPlan.drawingPatch.operations.length >= 24);
  assert.ok(result.analysisPlan.drawingPatch.operations.length <= 32);
  assert.ok(result.analysisPlan.drawingPatch.operations.every(({ drawing }) => (
    drawing.theory === "order-flow" && drawing.layer === "ai/order-flow"
  )));
  const labels = result.analysisPlan.drawingPatch.operations
    .map(({ drawing }) => drawing.text || "")
    .join("\n");
  assert.match(labels, /OB/);
  assert.match(labels, /FVG/);
  assert.match(labels, /BOS|CHoCH|MSS/);
  assert.match(labels, /趋势转|上破关键高点|跌破关键低点/);
  assert.match(labels, /支撑|压力/);
  assert.match(labels, /关键价位：上破 .* 偏多｜跌破 .* 偏空/);
  assert.match(labels, /EQ 50%/);
  assert.match(labels, /OTE 0\.618–0\.786/);
  assert.ok(labels.split("\n").filter(Boolean).length <= 16);
  assert.match(result.analysisPlan.report, /### 先看结论/);
  assert.match(result.analysisPlan.report, /多周期价格结构：15m.*4H.*1D/);
  assert.match(result.analysisPlan.report, /图上只保留最近的趋势转折、主要支撑\/压力/);
  assert.doesNotMatch(result.analysisPlan.report, /大额主动买入|大额主动卖出|成交密集价（POC）/);
});

test("Drawing Gateway accepts only order-flow-owned ICT/SMC tokens", () => {
  const snapshot = normalizeTradingMarketSnapshot(fixtureParams());
  const base = {
    schemaVersion: 1,
    analysisId: "ict-smc-gateway",
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations: [{
      op: "upsert",
      drawing: {
        id: "bearish-ob",
        theory: "order-flow",
        tool: "rectangle",
        colorToken: "order-flow-ob-bear",
        points: [
          { time: snapshot.candles[30].time, price: snapshot.candles[30].high },
          { time: snapshot.candles[80].time, price: snapshot.candles[30].open },
        ],
      },
    }],
  };
  assert.equal(validateTradingDrawingPatch(base, snapshot).operations[0].drawing.layer, "ai/order-flow");
  assert.throws(
    () => validateTradingDrawingPatch({
      ...base,
      operations: [{
        ...base.operations[0],
        drawing: { ...base.operations[0].drawing, theory: "wave" },
      }],
    }, snapshot),
    /unsupported drawing style/,
  );
});

test("renderer fetches higher-timeframe context and defines ICT/SMC colors in both themes", async () => {
  const [marketSource, playbackSource, drawingSource, stylesSource, expertSource, routerSource] = await Promise.all([
    readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-ai-playback.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-drawing.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/trading-expert-order-flow-request.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/trading-analysis/order-flow-request-router.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(marketSource, /fetchTradingMarketStructureContexts/);
  assert.match(marketSource, /return \["60", "240", "1D"\]/);
  assert.match(marketSource, /contextCandles: contextCandles\.map/);
  assert.match(playbackSource, /"order-flow-ob-bear"/);
  assert.match(drawingSource, /--trading-ai-order-flow-ob-bear/);
  assert.match(expertSource, /不要把 BOS、CHoCH、MSS、OB、FVG、Breaker、EQ、BSL\/SSL、Sweep、OTE 全部堆到图上/);
  assert.match(expertSource, /上破哪个确定性价位后偏多、跌破哪个价位后偏空/);
  assert.match(routerSource, /OB、FVG、BOS、CHoCH、MSS、EQ、BSL\/SSL、Sweep、Breaker、OTE/);
  assert.match(stylesSource, /--trading-ai-order-flow-ob-bear: #bd3f58;/);
  assert.match(stylesSource, /--trading-ai-order-flow-fvg-bull: #0f8a72;/);
  assert.match(
    stylesSource,
    /html\[data-theme="dark"\] \.trading-expert-market[\s\S]*?--trading-ai-order-flow-ob-bear: #ff718e;[\s\S]*?--trading-ai-order-flow-fvg-bull: #54d6b6;/,
  );
});
