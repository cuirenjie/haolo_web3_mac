import { runTradingChanAnalysisPipeline } from "../../trading-analysis/chan-pipeline.mjs";
import {
  buildChanRequestRoutingPrompt,
  normalizeChanRequestRoutingModelResponse,
} from "../../trading-analysis/chan-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const chanStrategyAdapter = createLegacyStrategyAdapter({
  id: "chan",
  routingTask: "chan-request-routing",
  routingTheoryId: "chan",
  buildRoutingPrompt: buildChanRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeChanRequestRoutingModelResponse,
  runPipeline: runTradingChanAnalysisPipeline,
  routingErrorCode: "TRADING_CHAN_ROUTING_FAILED",
  routingFailureMessage: "缠论请求识别失败",
  routingCancelledMessage: "缠论请求识别已取消",
  analysisErrorCode: "TRADING_CHAN_ANALYSIS_FAILED",
  analysisFailureMessage: "缠论分析失败",
  analysisCancelledMessage: "缠论分析已取消",
  replacementMessage: "A newer Chan analysis replaced this request",
  routingReplacementMessage: "A newer Chan request classification replaced this request",
});
