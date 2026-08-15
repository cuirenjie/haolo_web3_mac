import { runTradingWyckoffAnalysisPipeline } from "../../trading-analysis/wyckoff-pipeline.mjs";
import {
  buildWyckoffRequestRoutingPrompt,
  normalizeWyckoffRequestRoutingModelResponse,
} from "../../trading-analysis/wyckoff-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const wyckoffStrategyAdapter = createLegacyStrategyAdapter({
  id: "wyckoff",
  routingTask: "wyckoff-request-routing",
  routingTheoryId: "wyckoff",
  buildRoutingPrompt: buildWyckoffRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeWyckoffRequestRoutingModelResponse,
  runPipeline: runTradingWyckoffAnalysisPipeline,
  routingErrorCode: "TRADING_WYCKOFF_ROUTING_FAILED",
  routingFailureMessage: "威科夫请求识别失败",
  routingCancelledMessage: "威科夫请求识别已取消",
  analysisErrorCode: "TRADING_WYCKOFF_ANALYSIS_FAILED",
  analysisFailureMessage: "威科夫分析失败",
  analysisCancelledMessage: "威科夫分析已取消",
  replacementMessage: "A newer Wyckoff analysis replaced this request",
  routingReplacementMessage: "A newer Wyckoff request classification replaced this request",
});
