import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildGeneralRequestRoutingPrompt,
  deterministicGeneralRequestRouting,
  normalizeGeneralRequestRoutingModelResponse,
} from "../src/main/trading-analysis/general-request-router.mjs";
import { runPriceActionEngine } from "../src/main/trading-analysis/price-action-engine.mjs";
import { runTradingPriceActionAnalysisPipeline } from "../src/main/trading-analysis/price-action-pipeline.mjs";
import { normalizeTradingMarketSnapshot } from "../src/main/trading-analysis/protocol.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixtureCandles(count = 120) {
  const start = 1_785_000_000;
  let previous = 62_000;
  return Array.from({ length: count }, (_, index) => {
    const drift = index < count * 0.45 ? 32 : index < count * 0.7 ? -20 : 24;
    const wave = Math.sin(index / 3.2) * 95 + Math.sin(index / 8.5) * 55;
    const close = Math.max(1, previous + drift + wave * 0.18);
    const open = previous;
    const high = Math.max(open, close) + 80 + (index % 5) * 9;
    const low = Math.min(open, close) - 75 - (index % 4) * 8;
    previous = close;
    return {
      time: start + index * 3_600,
      open,
      high,
      low,
      close,
      volume: 900 + (index % 11) * 45,
    };
  });
}

function fixtureSnapshot() {
  return normalizeTradingMarketSnapshot({
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_785_500_000_000,
    candles: fixtureCandles(),
  });
}

test("general semantic router deterministically routes a bare analysis request to the current chart", () => {
  const routed = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
  }), "分析下");
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.instruction, "分析下");
  assert.equal(routed.request.symbol, null);
  assert.equal(routed.request.interval, null);
  assert.equal(routed.request.lookbackMs, null);
  assert.equal(routed.request.drawingRequested, true);
  assert.match(buildGeneralRequestRoutingPrompt({ text: "分析下" }), /必须 mode=chart-analysis/);
});

test("general market intent deterministically routes explicit symbols, intervals, live decisions, and drawing defaults", () => {
  const reportedIncident = deterministicGeneralRequestRouting("帮我分析SNDK一小时走势");
  assert.equal(reportedIncident?.request.mode, "chart-analysis");
  assert.equal(reportedIncident?.request.symbol, "SNDKUSDT");
  assert.equal(reportedIncident?.request.interval, "60");

  const defaultInterval = deterministicGeneralRequestRouting("帮我分析SNDK走势");
  assert.equal(defaultInterval?.request.symbol, "SNDKUSDT");
  assert.equal(defaultInterval?.request.interval, null);

  const exactIncident = deterministicGeneralRequestRouting("分析SNDK 15min这个盘\r面并绘图");
  assert.equal(exactIncident?.request.mode, "chart-analysis");
  assert.equal(exactIncident?.request.symbol, "SNDKUSDT");
  assert.equal(exactIncident?.request.interval, "15");
  assert.equal(exactIncident?.request.drawingRequested, true);
  assert.equal(exactIncident?.classification.source, "deterministic-market-analysis");

  const liveDecision = deterministicGeneralRequestRouting("那我现在做多可以吗", {
    hasCurrentAnalysis: true,
  });
  assert.equal(liveDecision?.request.mode, "chart-analysis");
  assert.equal(liveDecision?.request.drawingRequested, true);

  const positionHealth = deterministicGeneralRequestRouting("我目前的仓位健康吗，该怎么操作", {
    hasCurrentAnalysis: true,
  });
  assert.equal(positionHealth?.request.mode, "chart-analysis");
  assert.equal(positionHealth?.request.drawingRequested, true);
  const positionWeight = deterministicGeneralRequestRouting("我这笔仓位重不重？");
  assert.equal(positionWeight?.request.mode, "chart-analysis");
  assert.equal(positionWeight?.classification.intent, "position-management");

  const noDrawing = deterministicGeneralRequestRouting("刷新最新行情，只告诉我是否还能做多，不用重画", {
    hasCurrentAnalysis: true,
  });
  assert.equal(noDrawing?.request.mode, "chart-analysis");
  assert.equal(noDrawing?.request.drawingRequested, false);
  assert.match(buildGeneralRequestRoutingPrompt({ text: "帮我分析SNDK一小时走势" }), /SNDKUSDT、60/);
});

test("position management intent reads the named market before combining account context", () => {
  const text = "SKHYNIX我在1240做空 强平价1462我在哪里平仓?";
  const routed = deterministicGeneralRequestRouting(text);
  assert.equal(routed?.request.mode, "chart-analysis");
  assert.equal(routed?.request.symbol, "SKHYNIXUSDT");
  assert.equal(routed?.request.interval, null);
  assert.equal(routed?.request.positionManagementRequested, true);
  assert.equal(routed?.classification.intent, "position-management");

  const normalized = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "conversation",
    intent: "general-question",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.2,
  }), text);
  assert.equal(normalized.request.mode, "chart-analysis");
  assert.equal(normalized.request.symbol, "SKHYNIXUSDT");
  assert.equal(normalized.request.positionManagementRequested, true);
  assert.equal(normalized.classification.intent, "position-management");
});

test("general semantic router preserves an official Han-character Binance symbol", () => {
  const routed = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-analysis",
    symbol: "币安人生USDT",
    interval: "60",
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.98,
  }), "分析币安人生的 1 小时 K 线");
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.symbol, "币安人生USDT");
  assert.equal(routed.request.interval, "60");
});

test("general semantic router preserves conceptual questions as normal conversation", () => {
  const routed = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "conversation",
    intent: "general-question",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.94,
  }), "什么是移动止损");
  assert.equal(routed.request.mode, "conversation");
  assert.equal(routed.request.symbol, null);
  assert.equal(routed.request.drawingRequested, false);
});

test("a chart-analysis model result cannot be downgraded by low confidence or an old-analysis flag", () => {
  const routed = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-analysis",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.2,
  }), "这个位置需要重新确认吗", { hasCurrentAnalysis: true });
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.drawingRequested, true);
});

test("deterministic semantic guard keeps education and strategy recommendations off the chart", () => {
  const text = "我是一个币圈新手小白，我想系统的学习简单点的交易理论，你一步步教我，给我推荐一个最适合我的交易策略";
  const guarded = deterministicGeneralRequestRouting(text, { hasCurrentAnalysis: true });
  assert.ok(guarded);
  assert.equal(guarded.request.mode, "conversation");
  assert.equal(guarded.request.drawingRequested, false);
  assert.equal(guarded.request.analysisFollowup, false);
  assert.equal(guarded.classification.source, "deterministic-semantic-guard");

  // Even if a stale/incorrect model response says chart-analysis, the same
  // semantic guard is applied at the normalization boundary.
  const normalized = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-drawing",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.99,
  }), text, { hasCurrentAnalysis: true });
  assert.equal(normalized.request.mode, "conversation");
  assert.equal(normalized.request.drawingRequested, false);

  const explainChart = deterministicGeneralRequestRouting("请解释什么是 K 线", { hasCurrentAnalysis: true });
  assert.equal(explainChart?.request.mode, "conversation");
  const nonMarket = deterministicGeneralRequestRouting("你能做什么？", { hasCurrentAnalysis: true });
  assert.equal(nonMarket?.classification.intent, "non-market-request");
});

test("only concrete prior-analysis questions receive the follow-up marker", () => {
  const followup = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "conversation",
    intent: "general-question",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
  }), "你凭什么认为第一目标会到 0.4", { hasCurrentAnalysis: true });
  assert.equal(followup.request.analysisFollowup, true);

  const unrelated = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "conversation",
    intent: "general-question",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.96,
  }), "推荐一个最适合新手的交易策略", { hasCurrentAnalysis: true });
  assert.equal(unrelated.request.analysisFollowup, false);
});

test("general semantic router sends static account and memory questions to the agent but position-market reviews to chart analysis", () => {
  const prompt = buildGeneralRequestRoutingPrompt({ text: "我目前的仓位健康吗，该怎么操作" });
  assert.match(prompt, /只查询账户余额、订单、交易记录、风险偏好或长期记忆时用 conversation/);
  assert.match(prompt, /我目前的仓位健康吗，该怎么操作.*chart-analysis\/chart-drawing/);
  assert.match(prompt, /记住以后单笔最多亏本金的 3%.*conversation\/general-question/);
});

test("chart-analysis can refresh an answer without replacing existing drawings", () => {
  const routed = normalizeGeneralRequestRoutingModelResponse(JSON.stringify({
    schemaVersion: 1,
    mode: "chart-analysis",
    intent: "chart-analysis",
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    confidence: 0.93,
  }), "刷新最新行情，只告诉我现在是否还能做多，不用重画", {
    hasCurrentAnalysis: true,
  });
  assert.equal(routed.request.mode, "chart-analysis");
  assert.equal(routed.request.drawingRequested, false);
});

test("general semantic router reuses explanatory follow-ups but refreshes current-action questions", () => {
  const prompt = buildGeneralRequestRoutingPrompt({
    text: "你凭什么认为第一目标会到 0.4，那我现在能做多吗",
    hasCurrentAnalysis: true,
  });
  assert.match(prompt, /"hasCurrentAnalysis":true/);
  assert.match(prompt, /仅解释上一轮既有结论或价位含义/);
  assert.match(prompt, /现在还能买吗\/现在能做多吗\/最新行情是否改变条件/);
  assert.match(prompt, /必须重新 chart-analysis 并默认绘图/);
  assert.match(prompt, /你凭什么认为第一目标会到 0\.4/);
  assert.match(prompt, /那我现在做多可以吗/);
});

test("price-action engine produces deterministic actionable levels around the current price", () => {
  const snapshot = fixtureSnapshot();
  const first = runPriceActionEngine(snapshot);
  const second = runPriceActionEngine(snapshot);
  assert.deepEqual(first, second);
  assert.equal(first.status, "succeeded");
  assert.ok(first.levels.shortTrigger < first.levels.currentPrice);
  assert.ok(first.levels.longTrigger > first.levels.currentPrice);
  assert.ok(first.levels.shortTarget < first.levels.shortTrigger);
  assert.ok(first.levels.longTarget > first.levels.longTrigger);
  assert.equal(first.riseWeight + first.fallWeight, 100);
});

test("general analysis pipeline stays provider-neutral and emits a small isolated drawing patch", async () => {
  let capturedRequest = null;
  const result = await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_785_500_000_000,
    instruction: "分析下",
    userRiskProfile: {
      maxLossPerTradePercent: 10,
      // Legacy clients may still send this deprecated field; it must be ignored.
      absoluteMaxLossPerTradePercent: 3,
      minimumRiskRewardRatio: 2,
      moveStopToBreakEven: true,
      breakEvenTriggerR: 1,
      analysisStyle: "concise",
      entries: [{ scope: "trading.discipline", key: "user_custom_rules", value: "不允许亏损加仓" }],
    },
    candles: fixtureCandles(),
  }, {
    providerId: "fixture-provider",
    modelRegistry: {
      async analyze(providerId, request) {
        capturedRequest = { providerId, request };
        return {
          providerId,
          modelId: "fixture-model",
          requestId: request.requestId,
          latencyMs: 8,
          usage: null,
          finishReason: "completed",
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "当前先等区间突破，确认后再跟随方向。",
            marketBias: "neutral",
            rationale: "价格仍靠近近期支撑与压力之间，等待收盘确认更稳妥。",
            confidence: 0.74,
          }),
        };
      },
    },
  });
  assert.equal(capturedRequest.providerId, "fixture-provider");
  assert.equal(capturedRequest.request.theoryId, "price_action");
  assert.match(capturedRequest.request.prompt, /用户已保存的交易配置/);
  assert.match(capturedRequest.request.prompt, /不允许亏损加仓/);
  assert.equal(result.ok, true);
  assert.equal(result.analysisPlan.drawingPatch.operations.length, 6);
  assert.ok(result.analysisPlan.drawingPatch.operations.length <= 10);
  assert.ok(result.analysisPlan.drawingPatch.operations.every(({ drawing }) => (
    drawing.theory === "price-action"
    && drawing.layer === "ai/price-action"
    && drawing.colorToken.startsWith("price-action-")
  )));
  assert.match(result.analysisPlan.report, /新手执行清单/);
  assert.match(result.analysisPlan.report, /想做多/);
  assert.match(result.analysisPlan.report, /想做空/);
  assert.match(result.analysisPlan.report, /当前账户净值的 10%/);
  assert.doesNotMatch(result.analysisPlan.report, /绝对不超过 3%/);
  assert.match(result.analysisPlan.report, /最低净盈亏比为 1:2/);
  assert.match(result.analysisPlan.report, /浮盈达到 1R/);
});

test("general Binance futures analysis merges a fresh account snapshot locally without exposing it to the model", async () => {
  let capturedPrompt = "";
  let accountLoads = 0;
  const result = await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    instruction: "结合我的实盘仓位分析",
    responseMode: "direct",
    userRiskProfile: {
      maxLossPerTradePercent: 2,
      maxLeverage: 5,
      minimumRiskRewardRatio: 1,
    },
    candles: fixtureCandles(),
    async loadBinanceAccountContext() {
      accountLoads += 1;
      return {
        bound: true,
        available: true,
        snapshot: {
          fetchedAt: new Date().toISOString(),
          marginBalance: 20_000,
          availableBalance: 10_000,
          positions: [{
            symbol: "BTCUSDT",
            direction: "LONG",
            leverage: 5,
            amount: 0.15677,
            notionalValue: 9_876.54,
            markPrice: 64_000,
            entryPrice: 62_000,
            unrealizedPnl: 123.45,
          }],
          warnings: [],
        },
      };
    },
  }, {
    providerId: "fixture-provider",
    modelRegistry: {
      async analyze(providerId, request) {
        capturedPrompt = request.prompt;
        return {
          providerId,
          modelId: "fixture-model",
          requestId: request.requestId,
          latencyMs: 8,
          usage: null,
          finishReason: "completed",
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "等待多头条件确认。",
            answer: "多头结构仍在，但现在不要重复加仓。",
            marketBias: "bullish",
            rationale: "结构保持偏多。",
            confidence: 0.75,
          }),
        };
      },
    },
  });

  assert.equal(accountLoads, 1);
  assert.doesNotMatch(capturedPrompt, /9[,_]?876\.54|123\.45/);
  assert.equal(result.executionPlan.positionSizing.accountPlan.mode, "manage_existing");
  assert.match(result.analysisPlan.narrative, /^账户校验：当前已有 9876\.54 USDT 的多单，按现有仓位管理，不重复开仓。/);
  assert.match(result.analysisPlan.narrative, /多头结构仍在，但现在不要重复加仓。/);
  assert.match(result.analysisPlan.report, /已有 9876\.54 USDT 的多单，按现有仓位执行，不重复开仓/);
  assert.match(result.analysisPlan.report, /未实现盈亏 \+123\.45 USDT/);
});

test("position-management prompt requires market bias before account advice", async () => {
  let capturedPrompt = "";
  await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:SKHYNIXUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    instruction: "SKHYNIX我在1240做空，强平价1462，我在哪里平仓？",
    positionManagementRequested: true,
    candles: fixtureCandles(),
  }, {
    providerId: "fixture-provider",
    modelRegistry: {
      async analyze(providerId, request) {
        capturedPrompt = request.prompt;
        return {
          providerId,
          modelId: "fixture-model",
          requestId: request.requestId,
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "盘面偏空，先控制风险。",
            marketBias: "bearish",
            rationale: "结构走弱。",
            confidence: 0.8,
          }),
        };
      },
    },
  });
  assert.match(capturedPrompt, /这是仓位管理分析/);
  assert.match(capturedPrompt, /必须先根据本次目标交易对和周期/);
  assert.match(capturedPrompt, /禁止只根据仓位数量或用户给出的价格直接判断/);
  assert.match(capturedPrompt, /回答必须第一句直接回应用户问的具体动作/);
  assert.match(capturedPrompt, /不要输出通用多空开仓计划、杠杆、仓位大小/);
});

test("position-management direct narrative leads with the market conclusion", async () => {
  const result = await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:SKHYNIXUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    instruction: "SKHYNIX我在1240做空，强平价1462，我在哪里平仓？",
    positionManagementRequested: true,
    responseMode: "direct",
    candles: fixtureCandles(),
    async loadBinanceAccountContext() {
      return {
        bound: true,
        available: true,
        snapshot: {
          fetchedAt: new Date().toISOString(),
          marginBalance: 20_000,
          availableBalance: 10_000,
          positions: [{
            symbol: "SKHYNIXUSDT",
            direction: "SHORT",
            leverage: 3,
            amount: 8,
            notionalValue: 9_000,
            markPrice: 1_300,
            entryPrice: 1_240,
            unrealizedPnl: -480,
          }],
          warnings: [],
        },
      };
    },
  }, {
    providerId: "fixture-provider",
    modelRegistry: {
      async analyze(providerId, request) {
        return {
          providerId,
          modelId: "fixture-model",
          requestId: request.requestId,
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "盘面偏空，先减仓控制风险。",
            answer: "根据盘面偏空，先减仓一半，再观察支撑位。",
            marketBias: "bearish",
            rationale: "高点下移且收盘走弱。",
            confidence: 0.82,
          }),
        };
      },
    },
  });
  const narrative = result.analysisPlan.narrative;
  assert.match(narrative, /^根据盘面偏空，先减仓一半，再观察支撑位。/);
  assert.match(narrative, /账户校验：/);
  assert.ok(narrative.indexOf("根据盘面偏空") < narrative.indexOf("账户校验："));
});

test("position-management keeps chart drawings but renders a targeted answer instead of a trading plan", async () => {
  let capturedPrompt = "";
  const answer = "先在关键压力附近平掉一半空单，若继续上破则再平剩余仓位。";
  const result = await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:SKHYNIXUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    instruction: "SKHYNIX我在1240做空，强平价1462，我在哪里平仓？",
    // The renderer normally supplies this flag; infer it from the literal
    // position question as a compatibility guard for older callers.
    candles: fixtureCandles(),
    async loadBinanceAccountContext() {
      return {
        bound: true,
        available: true,
        snapshot: {
          fetchedAt: new Date().toISOString(),
          marginBalance: 20_000,
          availableBalance: 10_000,
          positions: [],
          warnings: [],
        },
      };
    },
  }, {
    providerId: "fixture-provider",
    modelRegistry: {
      async analyze(providerId, request) {
        capturedPrompt = request.prompt;
        return {
          providerId,
          modelId: "fixture-model",
          requestId: request.requestId,
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "盘面偏空，先控制空单风险。",
            answer,
            marketBias: "bearish",
            rationale: "反弹接近压力后再决定是否继续持有。",
            confidence: 0.84,
          }),
        };
      },
    },
  });

  assert.match(capturedPrompt, /本次保留受控画线动作，同时直接回答用户的具体仓位问题/);
  assert.match(result.analysisPlan.narrative, new RegExp(`^${answer}`));
  assert.match(result.analysisPlan.narrative, /账户校验：未发现与本次问题对应的当前仓位/);
  assert.ok(result.analysisPlan.drawingPatch.operations.length > 0);
  assert.match(result.analysisPlan.report, /### 直接回答/);
  assert.match(result.analysisPlan.report, new RegExp(answer));
  assert.match(result.analysisPlan.report, /### 盘面依据/);
  assert.match(result.analysisPlan.report, /### 账户仓位校验/);
  assert.doesNotMatch(result.analysisPlan.report, /新手执行清单|想做多|想做空|候选仓位|杠杆不超过/);
});

test("general Binance futures analysis safely disables sizing when the refreshed account snapshot fails", async () => {
  const result = await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: Date.now(),
    instruction: "分析下",
    candles: fixtureCandles(),
    async loadBinanceAccountContext() {
      throw new Error("private transport unavailable");
    },
  }, {
    providerId: "fixture-provider",
    modelRegistry: {
      async analyze(providerId, request) {
        return {
          providerId,
          modelId: "fixture-model",
          requestId: request.requestId,
          latencyMs: 8,
          usage: null,
          finishReason: "completed",
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "等待条件确认。",
            marketBias: "bullish",
            rationale: "结构保持偏多。",
            confidence: 0.7,
          }),
        };
      },
    },
  });

  assert.equal(result.executionPlan.positionSizing.accountStatus, "unavailable");
  assert.equal(result.executionPlan.positionSizing.accountPlan, null);
  assert.match(result.analysisPlan.report, /实盘账户快照不可用或已过期/);
  assert.doesNotMatch(result.analysisPlan.report, /推荐下单 [0-9]/);
});

test("direct analysis mode returns the model's question-specific answer without removing the guarded patch", async () => {
  const result = await runTradingPriceActionAnalysisPipeline({
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "60",
    snapshotTime: 1_785_500_000_000,
    instruction: "刷新最新行情，只告诉我现在是否还能做多，不用重画",
    responseMode: "direct",
    candles: fixtureCandles(),
  }, {
    providerId: "fixture-provider",
    modelRegistry: {
      async analyze(providerId, request) {
        assert.match(request.prompt, /answer 必须第一句直接作答/);
        assert.match(request.prompt, /不得套用完整盘面报告或固定章节/);
        return {
          providerId,
          modelId: "fixture-model",
          requestId: request.requestId,
          latencyMs: 8,
          usage: null,
          finishReason: "completed",
          text: JSON.stringify({
            schemaVersion: 1,
            verdict: "approve",
            summary: "暂时不要追多。",
            answer: "暂时不要追多。最新价格仍未收盘站稳确定性多头触发位，原计划继续等待确认。",
            marketBias: "neutral",
            rationale: "价格仍在等待区。",
            confidence: 0.72,
          }),
        };
      },
    },
  });
  assert.equal(result.analysisPlan.narrative, "暂时不要追多。最新价格仍未收盘站稳确定性多头触发位，原计划继续等待确认。");
  assert.ok(result.analysisPlan.drawingPatch.operations.length > 0);
  assert.match(result.analysisPlan.report, /新手执行清单/);
});

test("renderer route prioritizes explicit targets, verifies the loaded chart, and preserves visible-range analysis", () => {
  const mainSource = fs.readFileSync(path.join(root, "src/renderer/main.ts"), "utf8");
  const marketSource = fs.readFileSync(path.join(root, "src/renderer/trading-expert-market.ts"), "utf8");
  const drawingSource = fs.readFileSync(path.join(root, "src/renderer/trading-expert-drawing.ts"), "utf8");
  const preloadSource = fs.readFileSync(path.join(root, "src/main/preload.mjs"), "utf8");
  assert.match(mainSource, /tradingGeneralCandidateAtSend/);
  assert.match(mainSource, /await classifyTradingGeneralRequestForSend\(/);
  assert.match(mainSource, /hasTradingExpertCurrentAnalysis\(\)/);
  assert.match(mainSource, /generalRequest\?\.analysisFollowup === true/);
  assert.match(mainSource, /buildTradingAnalysisFollowupPrompt\(baseAgentText\)/);
  assert.match(mainSource, /hasCurrentAnalysis,/);
  assert.match(mainSource, /drawingRequested: chartAnalysis && !explicitNoDrawingRequested\(fallback\.instruction\)/);
  assert.match(mainSource, /runTradingExpertGeneralConversation\(\{/);
  assert.match(mainSource, /positionManagementRequested: request\.positionManagementRequested/);
  assert.match(mainSource, /request\.positionManagementRequested === true \? "plain" : "execution-plan"/);
  assert.doesNotMatch(mainSource, /general(?:Analysis)?Mentioned/);
  assert.match(mainSource, /symbol: chartAnalysis \? fallback\.symbol : null/);
  assert.match(mainSource, /interval: chartAnalysis \? fallback\.interval : null/);
  assert.match(mainSource, /正在由大模型识别问题意图；需要盘面时将进入行情分析与画线智能体/);
  assert.doesNotMatch(mainSource, /routeTradingExpertFastChatForSend\(\{/);
  assert.match(marketSource, /selectTradingAnalysisMarket\(this\.markets/);
  assert.match(marketSource, /selectTradingAnalysisInterval\(\{/);
  assert.match(marketSource, /this\.loadedMarketId !== targetMarket\.id/);
  assert.match(marketSource, /this\.loadedInterval !== targetInterval/);
  assert.match(marketSource, /await this\.restartMarketData\(\)/);
  assert.match(marketSource, /explicit symbol is an immutable analysis target/);
  assert.match(marketSource, /positionManagementRequested: request\.positionManagementRequested === true/);
  assert.match(marketSource, /const directResponseRequested = request\.drawingRequested === false[\s\S]*?request\.positionManagementRequested === true/);
  assert.match(marketSource, /responseMode: directResponseRequested \? "direct" : "full"/);
  assert.match(marketSource, /request\.positionManagementRequested === true\s*\n\s*\? ""/);
  assert.match(marketSource, /request\.positionManagementRequested === true[\s\S]*?response\.analysisPlan\.report/);
  assert.match(marketSource, /visibleCandlesInLogicalRange\(this\.candles, visibleRange\)/);
  assert.match(marketSource, /canvasCandles\.length\s*\? canvasCandles/);
  assert.match(marketSource, /canvasCandles\.slice\(-\(visibleCandlesOnly \? 600 : analysisWindowCount\)\)/);
  assert.match(marketSource, /runTradingAnalysisWithAutoExpansion\(\{/);
  assert.match(marketSource, /TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE/);
  assert.match(marketSource, /自动扩大画布到 \$\{event\.toCount\} 根再计算\$\{analysisName\}/);
  assert.match(marketSource, /focusAnalysisCandles[\s\S]*timeScale\(\)\.setVisibleRange/);
  assert.match(marketSource, /if \(request\.drawingRequested !== false\)[\s\S]*?commitTradingAnalysisDrawingPatch/);
  assert.match(marketSource, /patch\.marketId !== currentJob\.marketId \|\| patch\.interval !== currentJob\.interval/);
  assert.match(marketSource, /绘图目标与任务快照不一致/);
  assert.match(marketSource, /activeWorkspace\?\.drawingStorageSessionMatches\(currentJob\.storageSessionId\)/);
  assert.match(marketSource, /const applied = await targetWorkspace\.acceptAnalysisDrawingPatch/);
  assert.match(marketSource, /if \(applied !== true\)[\s\S]*?translateAppText\("Drawing Patch 未能应用到目标会话", currentJob\.language\)/);
  assert.match(marketSource, /persistTradingAiDrawingPatch\(storageSessionId, patch\)/);
  assert.match(marketSource, /request\.drawingRequested === false[\s\S]*?response\.analysisPlan\.narrative/);
  assert.match(marketSource, /左侧原画线保持不变/);
  assert.match(marketSource, /buildRecoverableTradingAnalysis\(\{/);
  assert.match(marketSource, /本地确定性价格结构分析/);
  assert.match(marketSource, /hasCurrentAnalysis\([\s\S]*?hasAiAnalysisForCurrentContext\(theory\)/);
  assert.match(drawingSource, /hasAiAnalysisForCurrentContext\([\s\S]*?tradingAiDrawingMatchesContext\(drawing, this\.getSymbol\(\), this\.getInterval\(\)\)/);
  assert.match(preloadSource, /classifyTradingGeneralRequest/);
  assert.match(preloadSource, /runTradingGeneralAnalysis/);
});

test("follow-up prompts answer the actual question while initial analysis templates stay available", () => {
  const generalRequest = fs.readFileSync(path.join(root, "src/renderer/trading-expert-general-request.ts"), "utf8");
  const mainSource = fs.readFileSync(path.join(root, "src/renderer/main.ts"), "utf8");
  const theoryPrompts = [
    "trading-expert-chan-request.ts",
    "trading-expert-order-flow-request.ts",
    "trading-expert-wave-request.ts",
    "trading-expert-wyckoff-request.ts",
  ].map((name) => fs.readFileSync(path.join(root, "src/renderer", name), "utf8")).join("\n");
  assert.match(generalRequest, /第一句话直接回答用户真正问的内容/);
  assert.match(generalRequest, /学习交易理论、选择策略、询问账户\/记忆/);
  assert.match(generalRequest, /不要机械复述完整盘面报告/);
  assert.match(generalRequest, /不要固定套用.*先看结论.*新手执行清单.*为什么这样判断/);
  assert.match(theoryPrompts, /若用户是在追问上一轮分析/);
  assert.match(theoryPrompts, /不要机械套用固定章节/);
  assert.match(mainSource, /\["<haolo_trading_analysis_followup_prompt>", "<\/haolo_trading_analysis_followup_prompt>"\]/);
});

test("all theory routers preserve drawings for follow-ups and refresh only when needed", () => {
  const routers = [
    "chan-request-router.mjs",
    "order-flow-request-router.mjs",
    "wave-request-router.mjs",
    "wyckoff-request-router.mjs",
  ].map((name) => fs.readFileSync(path.join(root, "src/main/trading-analysis", name), "utf8"));
  for (const source of routers) {
    assert.match(source, /hasCurrentAnalysis: params\.hasCurrentAnalysis === true/);
    assert.match(source, /复用既有分析直接回答/);
    assert.match(source, /只有.*更新\/重画|只有明确更新\/重画/);
    assert.match(source, /drawingRequested: acceptedMode === "chart-analysis" && \([\s\S]*?intent === "chart-drawing" \|\| context\.hasCurrentAnalysis !== true/);
  }
});

test("price-action AI colors are defined and validated in both light and dark themes", () => {
  const styles = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  const drawing = fs.readFileSync(path.join(root, "src/renderer/trading-expert-drawing.ts"), "utf8");
  for (const token of ["trend", "support", "resistance", "note"]) {
    const variable = `--trading-ai-price-action-${token}:`;
    assert.equal(styles.split(variable).length - 1, 2, `${variable} must exist in light and dark themes`);
    assert.match(drawing, new RegExp(`price-action-${token}`));
  }
  assert.match(drawing, /drawing\.theory === "price-action"/);
  assert.match(drawing, /drawing\.layer === "ai\/price-action"/);
});

test("general engine and pipeline are decoupled from model vendors", () => {
  const source = [
    fs.readFileSync(path.join(root, "src/main/trading-analysis/price-action-engine.mjs"), "utf8"),
    fs.readFileSync(path.join(root, "src/main/trading-analysis/price-action-pipeline.mjs"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /gpt|deepseek|openai/i);
  assert.match(source, /modelRegistry\.analyze/);
});
