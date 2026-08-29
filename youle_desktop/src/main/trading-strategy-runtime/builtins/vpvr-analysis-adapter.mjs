import { runVpvrAnalysisPipeline } from "../../trading-analysis/vpvr-analysis-pipeline.mjs";
import {
  buildVpvrAnalysisRequestRoutingPrompt,
  normalizeVpvrAnalysisRequestRoutingModelResponse,
  stripVpvrAnalysisMentionLiteral,
} from "../../trading-analysis/vpvr-analysis-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const vpvrAnalysisStrategyAdapter = createLegacyStrategyAdapter({
  id: "vpvr-analysis",
  routingTask: "vpvr-analysis-request-routing",
  routingTheoryId: "vpvr-analysis",
  buildRoutingPrompt: buildVpvrAnalysisRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeVpvrAnalysisRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripVpvrAnalysisMentionLiteral(text)) return null;
    return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true });
  },
  runPipeline: runVpvrAnalysisPipeline,
  routingErrorCode: "TRADING_VPVR_ANALYSIS_ROUTING_FAILED",
  routingFailureMessage: "VPVR 指标请求识别失败",
  routingCancelledMessage: "VPVR 指标请求识别已取消",
  analysisErrorCode: "TRADING_VPVR_ANALYSIS_FAILED",
  analysisFailureMessage: "VPVR 指标分析失败",
  analysisCancelledMessage: "VPVR 指标分析已取消",
  replacementMessage: "A newer VPVR analysis replaced this request",
  routingReplacementMessage: "A newer VPVR request classification replaced this request",
});
