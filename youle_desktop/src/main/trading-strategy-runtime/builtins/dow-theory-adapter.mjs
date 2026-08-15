import { runTradingDowTheoryPipeline } from "../../trading-analysis/dow-theory-pipeline.mjs";
import {
  buildDowTheoryRequestRoutingPrompt,
  normalizeDowTheoryRequestRoutingModelResponse,
  stripTradingDowTheoryMentionLiteral,
} from "../../trading-analysis/dow-theory-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const dowTheoryStrategyAdapter = createLegacyStrategyAdapter({
  id: "dow-theory",
  routingTask: "dow-theory-request-routing",
  routingTheoryId: "dow-theory",
  buildRoutingPrompt: buildDowTheoryRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeDowTheoryRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripTradingDowTheoryMentionLiteral(text)) return null;
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
  runPipeline: runTradingDowTheoryPipeline,
  routingErrorCode: "TRADING_DOW_THEORY_ROUTING_FAILED",
  routingFailureMessage: "道氏理论请求识别失败",
  routingCancelledMessage: "道氏理论请求识别已取消",
  analysisErrorCode: "TRADING_DOW_THEORY_ANALYSIS_FAILED",
  analysisFailureMessage: "道氏理论分析失败",
  analysisCancelledMessage: "道氏理论分析已取消",
  replacementMessage: "A newer Dow Theory analysis replaced this request",
  routingReplacementMessage: "A newer Dow Theory request classification replaced this request",
});
