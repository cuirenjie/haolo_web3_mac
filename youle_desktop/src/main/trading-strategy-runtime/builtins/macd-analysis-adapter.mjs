import { runMacdAnalysisPipeline } from "../../trading-analysis/macd-analysis-pipeline.mjs";
import { buildMacdAnalysisRequestRoutingPrompt, normalizeMacdAnalysisRequestRoutingModelResponse, stripMacdAnalysisMentionLiteral } from "../../trading-analysis/macd-analysis-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const macdAnalysisStrategyAdapter = createLegacyStrategyAdapter({
  id: "macd-analysis", routingTask: "macd-analysis-request-routing", routingTheoryId: "macd-analysis",
  buildRoutingPrompt: buildMacdAnalysisRequestRoutingPrompt, normalizeRoutingResponse: normalizeMacdAnalysisRequestRoutingModelResponse,
  deterministicRouting(text) { if (stripMacdAnalysisMentionLiteral(text)) return null; return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true }); },
  runPipeline: runMacdAnalysisPipeline,
  routingErrorCode: "TRADING_MACD_ANALYSIS_ROUTING_FAILED", routingFailureMessage: "MACD 指标请求识别失败", routingCancelledMessage: "MACD 指标请求识别已取消",
  analysisErrorCode: "TRADING_MACD_ANALYSIS_FAILED", analysisFailureMessage: "MACD 指标分析失败", analysisCancelledMessage: "MACD 指标分析已取消",
  replacementMessage: "A newer MACD analysis replaced this request", routingReplacementMessage: "A newer MACD request classification replaced this request",
});
