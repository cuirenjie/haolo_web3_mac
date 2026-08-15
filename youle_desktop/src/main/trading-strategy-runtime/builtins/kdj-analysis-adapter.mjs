import { runKdjAnalysisPipeline } from "../../trading-analysis/kdj-analysis-pipeline.mjs";
import { buildKdjAnalysisRequestRoutingPrompt, normalizeKdjAnalysisRequestRoutingModelResponse, stripKdjAnalysisMentionLiteral } from "../../trading-analysis/kdj-analysis-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const kdjAnalysisStrategyAdapter = createLegacyStrategyAdapter({
  id: "kdj-analysis",
  routingTask: "kdj-analysis-request-routing",
  routingTheoryId: "kdj-analysis",
  buildRoutingPrompt: buildKdjAnalysisRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeKdjAnalysisRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripKdjAnalysisMentionLiteral(text)) return null;
    return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true });
  },
  runPipeline: runKdjAnalysisPipeline,
  routingErrorCode: "TRADING_KDJ_ANALYSIS_ROUTING_FAILED",
  routingFailureMessage: "KDJ 指标请求识别失败",
  routingCancelledMessage: "KDJ 指标请求识别已取消",
  analysisErrorCode: "TRADING_KDJ_ANALYSIS_FAILED",
  analysisFailureMessage: "KDJ 指标分析失败",
  analysisCancelledMessage: "KDJ 指标分析已取消",
  replacementMessage: "A newer KDJ analysis replaced this request",
  routingReplacementMessage: "A newer KDJ request classification replaced this request",
});
