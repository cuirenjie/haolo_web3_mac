import { runTradingOrderFlowAnalysisPipeline } from "../../trading-analysis/order-flow-pipeline.mjs";
import {
  buildOrderFlowRequestRoutingPrompt,
  deterministicOrderFlowChartRequest,
  normalizeOrderFlowRequestRoutingModelResponse,
} from "../../trading-analysis/order-flow-request-router.mjs";
import { createLegacyStrategyAdapter } from "../legacy-adapter.mjs";

export const orderFlowStrategyAdapter = createLegacyStrategyAdapter({
  id: "order-flow",
  routingTask: "order-flow-request-routing",
  routingTheoryId: "order_flow",
  buildRoutingPrompt: buildOrderFlowRequestRoutingPrompt,
  normalizeRoutingResponse: normalizeOrderFlowRequestRoutingModelResponse,
  deterministicRouting: deterministicOrderFlowChartRequest,
  runPipeline: runTradingOrderFlowAnalysisPipeline,
  routingErrorCode: "TRADING_ORDER_FLOW_ROUTING_FAILED",
  routingFailureMessage: "订单流请求识别失败",
  routingCancelledMessage: "订单流请求识别已取消",
  analysisErrorCode: "TRADING_ORDER_FLOW_ANALYSIS_FAILED",
  analysisFailureMessage: "订单流分析失败",
  analysisCancelledMessage: "订单流分析已取消",
  replacementMessage: "A newer order-flow analysis replaced this request",
  routingReplacementMessage: "A newer order-flow request classification replaced this request",
});
