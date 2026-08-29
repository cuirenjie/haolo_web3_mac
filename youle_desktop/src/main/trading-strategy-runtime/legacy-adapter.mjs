export function createLegacyStrategyAdapter(config) {
  const id = String(config?.id || "").trim();
  if (!id) throw new TypeError("Legacy strategy adapter id is required");
  if (typeof config?.runPipeline !== "function") throw new TypeError(`${id} runPipeline is required`);
  if (typeof config?.buildRoutingPrompt !== "function") throw new TypeError(`${id} buildRoutingPrompt is required`);
  if (typeof config?.normalizeRoutingResponse !== "function") {
    throw new TypeError(`${id} normalizeRoutingResponse is required`);
  }
  return Object.freeze({
    id,
    routing: Object.freeze({
      task: String(config.routingTask || `${id}-request-routing`),
      theoryId: String(config.routingTheoryId || id),
      buildPrompt: config.buildRoutingPrompt,
      normalizeResponse: config.normalizeRoutingResponse,
      deterministic: typeof config.deterministicRouting === "function" ? config.deterministicRouting : null,
    }),
    errors: Object.freeze({
      routingCode: String(config.routingErrorCode || "TRADING_STRATEGY_ROUTING_FAILED"),
      routingFailureMessage: String(config.routingFailureMessage || "策略请求识别失败"),
      routingCancelledMessage: String(config.routingCancelledMessage || "策略请求识别已取消"),
      analysisCode: String(config.analysisErrorCode || "TRADING_STRATEGY_ANALYSIS_FAILED"),
      analysisFailureMessage: String(config.analysisFailureMessage || "策略分析失败"),
      analysisCancelledMessage: String(config.analysisCancelledMessage || "策略分析已取消"),
      replacementMessage: String(config.replacementMessage || "A newer strategy analysis replaced this request"),
      routingReplacementMessage: String(config.routingReplacementMessage || "A newer strategy request classification replaced this request"),
    }),
    run(params, options) {
      return config.runPipeline(params, options);
    },
  });
}
