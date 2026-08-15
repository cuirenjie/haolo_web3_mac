import { runMovingAverageAnalysisPipeline } from "../../trading-analysis/moving-average-analysis-pipeline.mjs";
import {
  buildMovingAverageAnalysisRequestRoutingPrompt,
  normalizeMovingAverageAnalysisRequestRoutingModelResponse,
  stripMovingAverageAnalysisMentionLiteral,
} from "../../trading-analysis/moving-average-analysis-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const movingAverageAnalysisStrategyAdapter = createLegacyStrategyAdapter({
  id: "moving-average-analysis",
  routingTask: "moving-average-analysis-request-routing",
  routingTheoryId: "moving-average-analysis",
  buildRoutingPrompt: buildMovingAverageAnalysisRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeMovingAverageAnalysisRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripMovingAverageAnalysisMentionLiteral(text)) return null;
    return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true });
  },
  runPipeline: runMovingAverageAnalysisPipeline,
  routingErrorCode: "TRADING_MOVING_AVERAGE_ANALYSIS_ROUTING_FAILED",
  routingFailureMessage: "均线指标请求识别失败",
  routingCancelledMessage: "均线指标请求识别已取消",
  analysisErrorCode: "TRADING_MOVING_AVERAGE_ANALYSIS_FAILED",
  analysisFailureMessage: "均线指标分析失败",
  analysisCancelledMessage: "均线指标分析已取消",
  replacementMessage: "A newer moving average analysis replaced this request",
  routingReplacementMessage: "A newer moving average request classification replaced this request",
});
