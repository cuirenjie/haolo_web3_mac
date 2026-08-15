import { runTradingSmtDivergencePipeline } from "../../trading-analysis/smt-divergence-pipeline.mjs";
import { buildSmtDivergenceRequestRoutingPrompt, normalizeSmtDivergenceRequestRoutingModelResponse, stripTradingSmtMentionLiteral } from "../../trading-analysis/smt-divergence-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const smtDivergenceStrategyAdapter = createLegacyStrategyAdapter({
  id: "smt-divergence", routingTask: "smt-divergence-request-routing", routingTheoryId: "smt-divergence",
  buildRoutingPrompt: buildSmtDivergenceRequestRoutingPrompt, normalizeRoutingResponse: normalizeSmtDivergenceRequestRoutingModelResponse,
  deterministicRouting(text) { if (stripTradingSmtMentionLiteral(text)) return null; return Object.freeze({ mode: "chart-analysis", instruction: "", symbol: null, interval: null, lookbackMs: null, lookbackLabel: null, drawingRequested: true }); },
  runPipeline: runTradingSmtDivergencePipeline,
  routingFailureMessage: "SMT 背离请求识别失败", analysisFailureMessage: "SMT 背离分析失败",
  replacementMessage: "A newer SMT divergence analysis replaced this request",
});
