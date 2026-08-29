import { runTradingChartPatternAnalysisPipeline } from "../../trading-analysis/chart-pattern-pipeline.mjs";
import {
  buildChartPatternRequestRoutingPrompt,
  normalizeChartPatternRequestRoutingModelResponse,
  stripTradingChartPatternMentionLiteral,
} from "../../trading-analysis/chart-pattern-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const chartPatternsStrategyAdapter = createLegacyStrategyAdapter({
  id: "chart-patterns",
  routingTask: "chart-pattern-request-routing",
  routingTheoryId: "traditional-chart-patterns",
  buildRoutingPrompt: buildChartPatternRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeChartPatternRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripTradingChartPatternMentionLiteral(text)) return null;
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
  runPipeline: runTradingChartPatternAnalysisPipeline,
  routingErrorCode: "TRADING_CHART_PATTERN_ROUTING_FAILED",
  routingFailureMessage: "图表形态请求识别失败",
  routingCancelledMessage: "图表形态请求识别已取消",
  analysisErrorCode: "TRADING_CHART_PATTERN_ANALYSIS_FAILED",
  analysisFailureMessage: "图表形态分析失败",
  analysisCancelledMessage: "图表形态分析已取消",
  replacementMessage: "A newer chart-pattern analysis replaced this request",
  routingReplacementMessage: "A newer chart-pattern request classification replaced this request",
});
