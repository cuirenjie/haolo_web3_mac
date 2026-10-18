import {OFFICIAL_TRADING_CATALOG} from '../../shared/official-trading-catalog.mjs';
import {deterministicStrategyRequestRouting, explicitNoDrawingRequested, extractExplicitTradingParameters, normalizeTradingRoutingText} from '../trading-analysis/request-routing-policy.mjs';
import {buildGeneralRequestRoutingPrompt, normalizeGeneralRequestRoutingModelResponse} from '../trading-analysis/general-request-router.mjs';
function boundedText(value, max = 12_000) {
  return String(value || "").replace(/\u0000/g, "").slice(0, max);
}

function stripInstalledStrategyMentions(value, registry) {
  let source = normalizeTradingRoutingText(value);
  for (const strategy of registry.list({ includeDisabled: true })) {
    const names = [
      strategy?.display?.name,
      strategy?.mentions?.canonical,
      ...(Array.isArray(strategy?.mentions?.aliases) ? strategy.mentions.aliases : []),
    ].map((name) => String(name || "").trim()).filter(Boolean);
    for (const name of names) {
      source = source
        .split(`@策略:${normalizeTradingRoutingText(name)}`).join("")
        .split(`@策略：${normalizeTradingRoutingText(name)}`).join("");
    }
  }
  return normalizeTradingRoutingText(source);
}

// Routes user intent only. This catalog cannot evaluate or run any strategy.
export class CloudTradingCatalog {
  #modelRegistry; #providerId;
  #registry={list:()=>OFFICIAL_TRADING_CATALOG,require:id=>{
    const manifest=OFFICIAL_TRADING_CATALOG.find(item=>item.id===id);
    if(!manifest)throw Object.assign(new Error('Unknown official strategy'),{code:'TRADING_STRATEGY_NOT_FOUND'});
    return {manifest};
  }};
  constructor({modelRegistry,providerId}) {this.#modelRegistry=modelRegistry;this.#providerId=providerId;}
  listStrategies(){return {schemaVersion:1,strategies:OFFICIAL_TRADING_CATALOG,diagnostics:[],runtime:{mode:'cloud',enabled:true,shadow:false,disabledStrategyIds:[]}};}
  strategyErrors(id){this.#registry.require(id);return {
    routingCode:'TRADING_STRATEGY_ROUTING_FAILED',routingFailureMessage:'Strategy request classification failed',
    routingCancelledMessage:'Strategy request classification cancelled',routingReplacementMessage:'A newer strategy request replaced this request'};}
  async classify(strategyId, params = {}, { signal, requestId, modelRegistry, providerId } = {}) {
    const strategy = this.#registry.require(strategyId);
    const instruction = normalizeTradingRoutingText(boundedText(params?.text));
    const rawInstruction = boundedText(params?.text);
    if (signal?.aborted) throw signal.reason || new DOMException("Analysis cancelled", "AbortError");
    // Once the user has explicitly asked for a chart analysis and the
    // renderer has already resolved the strategy, the deterministic parser
    // has all routing information needed by the strategy pipeline. Avoid a
    // second semantic model turn for this hot path. Conceptual questions and
    // image-assisted requests still use model routing below.
    const hasExplicitStrategyMention = [
      strategy.manifest?.mentions?.canonical,
      ...(Array.isArray(strategy.manifest?.mentions?.aliases) ? strategy.manifest.mentions.aliases : []),
    ].filter(Boolean).some((name) => rawInstruction.includes(`@策略:${name}`) || rawInstruction.includes(`@策略：${name}`));
    const explicitRequest = deterministicStrategyRequestRouting(
      hasExplicitStrategyMention ? stripInstalledStrategyMentions(rawInstruction, this.#registry) : instruction,
      strategy.manifest,
    );
    if (hasExplicitStrategyMention && !params?.hasImageAttachment && explicitRequest.mode === "chart-analysis") {
      return Object.freeze({
        ok: true, strategyId: strategy.manifest.id, request: explicitRequest,
        classification: Object.freeze({ schemaVersion: 1, mode: "chart-analysis",
          intent: explicitRequest.drawingRequested ? "chart-drawing" : "chart-analysis",
          confidence: 1, source: "deterministic-explicit-strategy" }),
        model: null,
      });
    }
    try {
      const modelResponse = await (modelRegistry || this.#modelRegistry).analyze(providerId || this.#providerId, {
        schemaVersion: 1,
        requestId: String(requestId || `${strategyId}-intent-route`),
        task: "trading-turn-intent-routing",
        theoryId: strategy.manifest.id,
        snapshotId: String(requestId || `${strategyId}-intent-route`),
        prompt: buildGeneralRequestRoutingPrompt({
          text: instruction,
          hasImageAttachment: params?.hasImageAttachment === true,
          hasCurrentAnalysis: params?.hasCurrentAnalysis === true,
        }),
        responseFormat: "json",
      }, { signal, reasoningEffort: "low" });
      const routed = normalizeGeneralRequestRoutingModelResponse(
        modelResponse.text,
        instruction,
        { hasCurrentAnalysis: params?.hasCurrentAnalysis === true },
      );
      const fallback = deterministicStrategyRequestRouting(instruction, strategy.manifest);
      // Bind chart targets directly from the literal instruction after the
      // model decides the semantic mode. Do not depend on fallback.mode:
      // older or narrower deterministic classifiers may label an otherwise
      // valid “分析4小时” request as conversation and clear its interval.
      const literal = extractExplicitTradingParameters(fallback.instruction);
      const chartAnalysis = fallback.mode === "chart-analysis" || routed.request.mode === "chart-analysis";
      const request = Object.freeze({
        ...fallback,
        mode: chartAnalysis ? "chart-analysis" : "conversation",
        symbol: chartAnalysis ? literal.symbol : null,
        interval: chartAnalysis ? literal.interval : null,
        lookbackMs: chartAnalysis ? literal.lookbackMs : null,
        lookbackLabel: chartAnalysis ? literal.lookbackLabel : null,
        forecastHorizonMs: chartAnalysis ? literal.forecastHorizonMs : null,
        ...(chartAnalysis && (
          fallback.positionManagementRequested === true
          || routed.request.positionManagementRequested === true
        ) ? { positionManagementRequested: true } : {}),
        drawingRequested: chartAnalysis && !explicitNoDrawingRequested(fallback.instruction),
      });
      const classification = {
        ...routed.classification,
        mode: request.mode,
        intent: request.mode === "chart-analysis"
          ? request.positionManagementRequested
            ? "position-management"
            : request.drawingRequested ? "chart-drawing" : "chart-analysis"
          : "expert-question",
        source: "model-first-unified-intent",
      };
      const model = {
        providerId: modelResponse.providerId,
        modelId: modelResponse.modelId,
        latencyMs: modelResponse.latencyMs,
      };
      return Object.freeze({
        ok: true,
        strategyId: strategy.manifest.id,
        request,
        classification: Object.freeze(classification),
        model: Object.freeze(model),
      });
    } catch (error) {
      if (signal?.aborted || String(error?.name || "") === "AbortError") throw error;
      // The model owns the first semantic decision, but never availability.
      // A local result keeps the turn routable during provider/JSON failures.
      const request = deterministicStrategyRequestRouting(instruction, strategy.manifest);
      const classification = {
        schemaVersion: 1,
        mode: request.mode,
        intent: request.mode === "chart-analysis"
          ? request.positionManagementRequested
            ? "position-management"
            : request.drawingRequested ? "chart-drawing" : "chart-analysis"
          : "expert-question",
        confidence: 1,
        source: "deterministic-recovery",
      };
      return Object.freeze({
        ok: true,
        strategyId: strategy.manifest.id,
        request,
        classification: Object.freeze(classification),
        model: null,
      });
    }
  }

}
