import { runTradingPriceActionStrategyPipeline } from "../../trading-analysis/price-action-strategy-pipeline.mjs";
import {
  buildPriceActionRequestRoutingPrompt,
  normalizePriceActionRequestRoutingModelResponse,
  stripTradingPriceActionMentionLiteral,
} from "../../trading-analysis/price-action-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const priceActionStrategyAdapter = createLegacyStrategyAdapter({
  id: "price-action",
  routingTask: "price-action-request-routing",
  routingTheoryId: "ohlc-price-action",
  buildRoutingPrompt: buildPriceActionRequestRoutingPrompt,
  normalizeRoutingResponse: normalizePriceActionRequestRoutingModelResponse,
  deterministicRouting(text) {
    if (stripTradingPriceActionMentionLiteral(text)) return null;
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
  runPipeline: runTradingPriceActionStrategyPipeline,
  routingErrorCode: "TRADING_PRICE_ACTION_ROUTING_FAILED",
  routingFailureMessage: "裸K分析请求识别失败",
  routingCancelledMessage: "裸K分析请求识别已取消",
  analysisErrorCode: "TRADING_PRICE_ACTION_ANALYSIS_FAILED",
  analysisFailureMessage: "裸K分析失败",
  analysisCancelledMessage: "裸K分析已取消",
  replacementMessage: "A newer price-action analysis replaced this request",
  routingReplacementMessage: "A newer price-action request classification replaced this request",
});

