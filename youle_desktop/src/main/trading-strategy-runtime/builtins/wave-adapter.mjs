import { runTradingWaveAnalysisPipeline } from "../../trading-analysis/wave-pipeline.mjs";
import {
  buildWaveRequestRoutingPrompt,
  normalizeWaveRequestRoutingModelResponse,
} from "../../trading-analysis/wave-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const waveStrategyAdapter = createLegacyStrategyAdapter({
  id: "wave",
  routingTask: "wave-request-routing",
  routingTheoryId: "elliott_wave",
  buildRoutingPrompt: buildWaveRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeWaveRequestRoutingModelResponse,
  runPipeline: runTradingWaveAnalysisPipeline,
  routingErrorCode: "TRADING_WAVE_ROUTING_FAILED",
  routingFailureMessage: "波浪理论请求识别失败",
  routingCancelledMessage: "波浪理论请求识别已取消",
  analysisErrorCode: "TRADING_WAVE_ANALYSIS_FAILED",
  analysisFailureMessage: "波浪理论分析失败",
  analysisCancelledMessage: "波浪理论分析已取消",
  replacementMessage: "A newer wave analysis replaced this request",
  routingReplacementMessage: "A newer wave request classification replaced this request",
});
