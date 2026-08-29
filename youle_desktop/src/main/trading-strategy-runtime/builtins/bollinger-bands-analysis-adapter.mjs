import { runBollingerBandsAnalysisPipeline } from "../../trading-analysis/bollinger-bands-analysis-pipeline.mjs";
import {
  buildBollingerBandsAnalysisRequestRoutingPrompt,
  normalizeBollingerBandsAnalysisRequestRoutingModelResponse,
  stripBollingerBandsAnalysisMentionLiteral,
} from "../../trading-analysis/bollinger-bands-analysis-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const bollingerBandsAnalysisStrategyAdapter = createLegacyStrategyAdapter({
  id: "bollinger-bands-analysis",
  routingTask: "bollinger-bands-analysis-request-routing",
  routingTheoryId: "bollinger-bands-analysis",
  buildRoutingPrompt: buildBollingerBandsAnalysisRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeBollingerBandsAnalysisRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripBollingerBandsAnalysisMentionLiteral(text)) return null;
    return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true });
  },
  runPipeline: runBollingerBandsAnalysisPipeline,
  routingErrorCode: "TRADING_BOLLINGER_BANDS_ANALYSIS_ROUTING_FAILED",
  routingFailureMessage: "布林带指标请求识别失败",
  routingCancelledMessage: "布林带指标请求识别已取消",
  analysisErrorCode: "TRADING_BOLLINGER_BANDS_ANALYSIS_FAILED",
  analysisFailureMessage: "布林带指标分析失败",
  analysisCancelledMessage: "布林带指标分析已取消",
  replacementMessage: "A newer Bollinger Bands analysis replaced this request",
  routingReplacementMessage: "A newer Bollinger Bands request classification replaced this request",
});
