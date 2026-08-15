import { runTradingIctSmcPipeline } from "../../trading-analysis/ict-smc-pipeline.mjs";
import { buildIctSmcRequestRoutingPrompt, normalizeIctSmcRequestRoutingModelResponse, stripTradingIctSmcMentionLiteral } from "../../trading-analysis/ict-smc-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const ictSmcStrategyAdapter = createLegacyStrategyAdapter({
  id: "ict-smc",
  routingTask: "ict-smc-request-routing",
  routingTheoryId: "ict-smc",
  buildRoutingPrompt: buildIctSmcRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeIctSmcRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripTradingIctSmcMentionLiteral(text)) return null;
    return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true });
  },
  runPipeline: runTradingIctSmcPipeline,
  routingFailureMessage: "ICT/SMC 请求识别失败",
  analysisFailureMessage: "ICT/SMC 分析失败",
  replacementMessage: "A newer ICT/SMC analysis replaced this request",
});
