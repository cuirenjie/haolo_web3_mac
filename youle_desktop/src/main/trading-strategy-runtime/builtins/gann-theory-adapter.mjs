import { runTradingGannTheoryPipeline } from "../../trading-analysis/gann-theory-pipeline.mjs";
import {
  buildGannTheoryRequestRoutingPrompt,
  normalizeGannTheoryRequestRoutingModelResponse,
  stripTradingGannTheoryMentionLiteral,
} from "../../trading-analysis/gann-theory-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const gannTheoryStrategyAdapter = createLegacyStrategyAdapter({
  id: "gann-theory",
  routingTask: "gann-theory-request-routing",
  routingTheoryId: "gann-theory",
  buildRoutingPrompt: buildGannTheoryRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeGannTheoryRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripTradingGannTheoryMentionLiteral(text)) return null;
    return Object.freeze({
      mode: "chart-analysis",
      instruction: "",
      symbol: null,
      interval: null,
      lookbackMs: null,
      lookbackLabel: null,
      drawingRequested: true,
    });
  },
  runPipeline: runTradingGannTheoryPipeline,
  routingErrorCode: "TRADING_GANN_THEORY_ROUTING_FAILED",
  routingFailureMessage: "江恩理论请求识别失败",
  routingCancelledMessage: "江恩理论请求识别已取消",
  analysisErrorCode: "TRADING_GANN_THEORY_ANALYSIS_FAILED",
  analysisFailureMessage: "江恩理论分析失败",
  analysisCancelledMessage: "江恩理论分析已取消",
  replacementMessage: "A newer Gann Theory analysis replaced this request",
  routingReplacementMessage: "A newer Gann Theory request classification replaced this request",
});
