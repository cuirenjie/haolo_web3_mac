import { runRsiAnalysisPipeline } from "../../trading-analysis/rsi-analysis-pipeline.mjs";
import { buildRsiAnalysisRequestRoutingPrompt, normalizeRsiAnalysisRequestRoutingModelResponse, stripRsiAnalysisMentionLiteral } from "../../trading-analysis/rsi-analysis-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const rsiAnalysisStrategyAdapter = createLegacyStrategyAdapter({
  id: "rsi-analysis",
  routingTask: "rsi-analysis-request-routing",
  routingTheoryId: "rsi-analysis",
  buildRoutingPrompt: buildRsiAnalysisRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeRsiAnalysisRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripRsiAnalysisMentionLiteral(text)) return null;
    return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true });
  },
  runPipeline: runRsiAnalysisPipeline,
  routingErrorCode: "TRADING_RSI_ANALYSIS_ROUTING_FAILED",
  routingFailureMessage: "RSI 指标请求识别失败",
  routingCancelledMessage: "RSI 指标请求识别已取消",
  analysisErrorCode: "TRADING_RSI_ANALYSIS_FAILED",
  analysisFailureMessage: "RSI 指标分析失败",
  analysisCancelledMessage: "RSI 指标分析已取消",
  replacementMessage: "A newer RSI analysis replaced this request",
  routingReplacementMessage: "A newer RSI request classification replaced this request",
});
