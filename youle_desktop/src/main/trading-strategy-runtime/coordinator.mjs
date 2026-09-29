import { createStrategyResultEnvelope } from "./contracts.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "./execution-plan-builder.mjs";
import { containsHanCharacters } from "../assistant-output-language.mjs";
import { personalRiskModelRegistry, personalRiskUnavailable, withPersonalRiskNotice } from "../trading-analysis/personal-risk-context.mjs";
import {
  deterministicStrategyRequestRouting,
  explicitNoDrawingRequested,
  extractExplicitTradingParameters,
  normalizeTradingRoutingText,
} from "../trading-analysis/request-routing-policy.mjs";
import {
  buildGeneralRequestRoutingPrompt,
  normalizeGeneralRequestRoutingModelResponse,
} from "../trading-analysis/general-request-router.mjs";

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

  async classify(strategyId, params = {}, { signal, requestId, modelRegistry, providerId } = {}) {
    const strategy = this.#registry.require(strategyId);
    const adapter = this.#registry.adapter(strategyId);
    if (!adapter) {
      const error = new Error("This strategy implementation is not available in the current host");
      error.code = "TRADING_STRATEGY_IMPLEMENTATION_UNAVAILABLE";
      throw error;
    }
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

  async run(strategyId, params = {}, { signal, modelRegistry, providerId, onStageTiming, onTheoryReady } = {}) {
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
    const exposesExecutionPlan = strategy.manifest.capabilities.includes("execution-plan");
    const accountSnapshotPromise = exposesExecutionPlan
      && !personalRiskUnavailable(params)
      && typeof loadBinanceAccountContext === "function"
      ? Promise.resolve().then(() => {
        const startedAt = Date.now();
        return Promise.resolve().then(loadBinanceAccountContext).then((context) => {
          onStageTiming?.({ stage: "account_snapshot", status: "completed", durationMs: Date.now() - startedAt });
          return context;
        }).catch((error) => {
          onStageTiming?.({ stage: "account_snapshot", status: "failed", durationMs: Date.now() - startedAt });
          return { bound: true, available: false, snapshot: null, errorCode: String(error?.code || "ACCOUNT_SNAPSHOT_UNAVAILABLE") };
        });
      })
      : null;
    const analysisStartedAt = Date.now();
    let legacyResult;
    let analysisStatus = "completed";
    try {
      legacyResult = await adapter.run(analysisParams, {
        modelRegistry: modelRegistry || personalRiskModelRegistry(this.#modelRegistry, analysisParams),
        executionPlanManaged: true,
        providerId: providerId || this.#providerId,
        signal,
        onTheoryReady,
      });
    } catch (error) {
      analysisStatus = "failed";
      throw error;
    } finally {
      onStageTiming?.({ stage: "analysis_pipeline", status: analysisStatus, durationMs: Date.now() - analysisStartedAt });
    }
    const legacyAnalysisPlan = legacyResult.analysisPlan || {};
    let binanceAccountContext = providedBinanceAccountContext;
    if (accountSnapshotPromise) binanceAccountContext = await accountSnapshotPromise;
    const executionPlan = buildExecutionPlanV1(strategy.manifest, legacyResult, {
      ...analysisParams,
      binanceAccountContext,
    });
    const legacyReportWithoutExecutionPlan = stripLegacyExecutionPlanSection(legacyAnalysisPlan.report);
    const defaultReport = params?.responseMode === "direct" || !exposesExecutionPlan
      ? legacyAnalysisPlan.report
      : `${formatExecutionPlanMarkdown(executionPlan)}\n\n---\n\n${legacyReportWithoutExecutionPlan}`.trim();
    const englishLegacyReport = String(legacyReportWithoutExecutionPlan || "").trim();
    const englishReport = params?.responseMode === "direct" || !exposesExecutionPlan
      ? containsHanCharacters(defaultReport)
        ? "The market analysis is complete. Review the chart annotations for the detected structure and risk levels."
        : defaultReport
      : [
          formatExecutionPlanMarkdown(executionPlan, { language: "en" }),
          ...(!containsHanCharacters(englishLegacyReport) ? ["---", englishLegacyReport] : []),
        ].filter(Boolean).join("\n\n");
    const englishNarrative = containsHanCharacters(legacyAnalysisPlan.narrative)
      ? "The analysis is complete. Review the chart annotations and conditional levels for the detected structure."
      : legacyAnalysisPlan.narrative;
    const decoratedResult = {
      ...legacyResult,
      strategy: Object.freeze({ id: strategy.manifest.id, version: strategy.manifest.version }),
      analysisPlan: {
        ...legacyAnalysisPlan,
        executionPlan,
        report: params?.language === "en" ? englishReport : defaultReport,
        narrative: params?.language === "en" ? englishNarrative : legacyAnalysisPlan.narrative,
      },
    };
    return withPersonalRiskNotice(createStrategyResultEnvelope(strategy.manifest, decoratedResult, executionPlan), params);
  }
}
