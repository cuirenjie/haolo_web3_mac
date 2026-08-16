import crypto from "node:crypto";
import { createStrategyResultEnvelope } from "./contracts.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "./execution-plan-builder.mjs";

function boundedText(value, max = 12_000) {
  return String(value || "").replace(/\u0000/g, "").slice(0, max);
}

function stripLegacyExecutionPlanSection(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\s*#{1,6}\s+标准执行方案\s*$/u.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s*#{1,6}\s+\S/u.test(line)) skipping = false;
    if (!skipping) output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export class TradingStrategyCoordinator {
  #registry;
  #modelRegistry;
  #providerId;

  constructor({ registry, modelRegistry, providerId }) {
    if (!registry) throw new TypeError("TradingStrategyCoordinator registry is required");
    if (!modelRegistry || typeof modelRegistry.analyze !== "function") {
      throw new TypeError("TradingStrategyCoordinator modelRegistry is required");
    }
    this.#registry = registry;
    this.#modelRegistry = modelRegistry;
    this.#providerId = String(providerId || "").trim();
  }

  listStrategies() {
    return Object.freeze({
      schemaVersion: 1,
      strategies: this.#registry.list(),
      diagnostics: Object.freeze(this.#registry.diagnostics().map((item) => Object.freeze({
        id: item.id,
        message: item.message,
      }))),
      runtime: this.#registry.runtimeStatus(),
    });
  }

  strategyErrors(strategyId) {
    const adapter = this.#registry.adapter(strategyId);
    return adapter?.errors || Object.freeze({
      routingCode: "TRADING_STRATEGY_ROUTING_FAILED",
      routingFailureMessage: "策略请求识别失败",
      routingCancelledMessage: "策略请求识别已取消",
      analysisCode: "TRADING_STRATEGY_ANALYSIS_FAILED",
      analysisFailureMessage: "策略分析失败",
      analysisCancelledMessage: "策略分析已取消",
      replacementMessage: "A newer strategy analysis replaced this request",
      routingReplacementMessage: "A newer strategy request classification replaced this request",
    });
  }

  async classify(strategyId, params = {}, { signal, requestId = null } = {}) {
    const strategy = this.#registry.require(strategyId);
    const adapter = this.#registry.adapter(strategyId);
    if (!adapter) {
      const error = new Error("This strategy implementation is not available in the current host");
      error.code = "TRADING_STRATEGY_IMPLEMENTATION_UNAVAILABLE";
      throw error;
    }
    const text = boundedText(params?.text);
    const routingContext = {
      hasImageAttachment: params?.hasImageAttachment === true,
      hasCurrentAnalysis: params?.hasCurrentAnalysis === true,
    };
    const deterministic = adapter.routing.deterministic?.(text, routingContext);
    if (deterministic) {
      const mode = deterministic.mode === "chart-analysis" ? "chart-analysis" : "conversation";
      return Object.freeze({
        ok: true,
        strategyId: strategy.manifest.id,
        request: deterministic,
        classification: Object.freeze({
          schemaVersion: 1,
          mode,
          intent: mode === "chart-analysis" ? "chart-drawing" : "conversation",
          confidence: 1,
          source: "deterministic-short-action",
        }),
        model: null,
      });
    }
    const normalizedRequestId = boundedText(requestId || `${strategy.manifest.id}-route-${crypto.randomUUID()}`, 200);
    const model = await this.#modelRegistry.analyze(this.#providerId, {
      schemaVersion: 1,
      requestId: normalizedRequestId,
      task: adapter.routing.task,
      theoryId: adapter.routing.theoryId,
      snapshotId: normalizedRequestId,
      prompt: adapter.routing.buildPrompt({ text, ...routingContext }),
      responseFormat: "json",
    }, { signal });
    const routed = adapter.routing.normalizeResponse(model.text, text, {
      hasCurrentAnalysis: routingContext.hasCurrentAnalysis,
    });
    return Object.freeze({
      ok: true,
      strategyId: strategy.manifest.id,
      request: routed.request,
      classification: routed.classification,
      model: Object.freeze({
        providerId: model.providerId,
        modelId: model.modelId,
        latencyMs: model.latencyMs,
      }),
    });
  }

  async run(strategyId, params = {}, { signal } = {}) {
    const strategy = this.#registry.require(strategyId);
    const adapter = this.#registry.adapter(strategyId);
    if (!adapter) {
      const error = new Error("This strategy implementation is not available in the current host");
      error.code = "TRADING_STRATEGY_IMPLEMENTATION_UNAVAILABLE";
      throw error;
    }
    const {
      binanceAccountContext: providedBinanceAccountContext,
      loadBinanceAccountContext,
      ...analysisParams
    } = params;
    const legacyResult = await adapter.run(analysisParams, {
      modelRegistry: this.#modelRegistry,
      providerId: this.#providerId,
      signal,
    });
    const legacyAnalysisPlan = legacyResult.analysisPlan || {};
    const exposesExecutionPlan = strategy.manifest.capabilities.includes("execution-plan");
    let binanceAccountContext = providedBinanceAccountContext;
    if (exposesExecutionPlan && typeof loadBinanceAccountContext === "function") {
      try {
        binanceAccountContext = await loadBinanceAccountContext();
      } catch {
        binanceAccountContext = { bound: true, available: false, snapshot: null };
      }
    }
    const executionPlan = buildExecutionPlanV1(strategy.manifest, legacyResult, {
      ...analysisParams,
      binanceAccountContext,
    });
    const legacyReportWithoutExecutionPlan = stripLegacyExecutionPlanSection(legacyAnalysisPlan.report);
    const decoratedResult = {
      ...legacyResult,
      strategy: Object.freeze({ id: strategy.manifest.id, version: strategy.manifest.version }),
      analysisPlan: {
        ...legacyAnalysisPlan,
        executionPlan,
        report: params?.responseMode === "direct" || !exposesExecutionPlan
          ? legacyAnalysisPlan.report
          : `${formatExecutionPlanMarkdown(executionPlan)}\n\n---\n\n${legacyReportWithoutExecutionPlan}`.trim(),
      },
    };
    return createStrategyResultEnvelope(strategy.manifest, decoratedResult, executionPlan);
  }
}
