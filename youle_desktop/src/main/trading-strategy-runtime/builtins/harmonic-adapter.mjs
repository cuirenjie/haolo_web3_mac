import { runTradingHarmonicAnalysisPipeline } from "../../trading-analysis/harmonic-pipeline.mjs";
import {
  buildHarmonicRequestRoutingPrompt,
  normalizeHarmonicRequestRoutingModelResponse,
} from "../../trading-analysis/harmonic-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const harmonicStrategyAdapter = createLegacyStrategyAdapter({
  id: "harmonic",
  routingTask: "harmonic-request-routing",
  routingTheoryId: "harmonic-xabcd",
  buildRoutingPrompt: buildHarmonicRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeHarmonicRequestRoutingModelResponse,
  runPipeline: runTradingHarmonicAnalysisPipeline,
  routingErrorCode: "TRADING_HARMONIC_ROUTING_FAILED",
  routingFailureMessage: "谐波形态请求识别失败",
  routingCancelledMessage: "谐波形态请求识别已取消",
  analysisErrorCode: "TRADING_HARMONIC_ANALYSIS_FAILED",
  analysisFailureMessage: "谐波形态分析失败",
  analysisCancelledMessage: "谐波形态分析已取消",
  replacementMessage: "A newer harmonic analysis replaced this request",
  routingReplacementMessage: "A newer harmonic request classification replaced this request",
});
