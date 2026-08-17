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

test("general semantic router lets the model route a bare analysis request to the current chart", () => {
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
  assert.match(buildGeneralRequestRoutingPrompt({ text: "分析下" }), /优先读取左侧当前 K 线/);
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

test("general semantic router sends personal account and memory questions to the context-capable agent", () => {
  const prompt = buildGeneralRequestRoutingPrompt({ text: "我目前的仓位健康吗，该怎么操作" });
  assert.match(prompt, /账户、资产、持仓、订单、交易记录、风险偏好、长期记忆/);
  assert.match(prompt, /我目前的仓位健康吗，该怎么操作.*conversation\/general-question/);
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

test("general semantic router reuses a current analysis for direct follow-up answers", () => {
  const prompt = buildGeneralRequestRoutingPrompt({
    text: "你凭什么认为第一目标会到 0.4，那我现在能做多吗",
    hasCurrentAnalysis: true,
  });
  assert.match(prompt, /"hasCurrentAnalysis":true/);
  assert.match(prompt, /复用既有分析直接回答/);
  assert.match(prompt, /不得仅因出现.*现在、目标、做多、做空、能买吗.*重新分析或重画/);
  assert.match(prompt, /重新分析、刷新行情、更新结论、重画/);
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
  assert.match(result.analysisPlan.report, /最低净盈亏比为 2:1/);
  assert.match(result.analysisPlan.report, /浮盈达到 1R/);
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

test("renderer route inherits the selected symbol, interval and visible candle range", () => {
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
  assert.match(mainSource, /drawingRequested: chartAnalysis && request\.drawingRequested === true/);
  assert.match(mainSource, /runTradingExpertGeneralConversation\(\{/);
  assert.doesNotMatch(mainSource, /general(?:Analysis)?Mentioned/);
  assert.match(marketSource, /request\.symbol \|\| this\.selectedSymbol/);
  assert.match(marketSource, /request\.interval \|\| this\.activeInterval/);
  assert.match(marketSource, /visibleCandlesInLogicalRange\(this\.candles, visibleRange\)/);
  assert.match(marketSource, /canvasCandles\.length\s*\? canvasCandles/);
  assert.match(marketSource, /canvasCandles\.slice\(-\(visibleCandlesOnly \? 600 : analysisWindowCount\)\)/);
  assert.match(marketSource, /runTradingAnalysisWithAutoExpansion\(\{/);
  assert.match(marketSource, /TRADING_CANDLE_WINDOW_INSUFFICIENT_DATA_CODE/);
  assert.match(marketSource, /自动扩大画布到 \$\{event\.toCount\} 根再计算\$\{analysisName\}/);
  assert.match(marketSource, /focusAnalysisCandles[\s\S]*timeScale\(\)\.setVisibleRange/);
  assert.match(marketSource, /if \(request\.drawingRequested !== false\)[\s\S]*?commitTradingAnalysisDrawingPatch/);
  assert.match(marketSource, /request\.drawingRequested === false[\s\S]*?response\.analysisPlan\.narrative/);
  assert.match(marketSource, /左侧原画线保持不变/);
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
