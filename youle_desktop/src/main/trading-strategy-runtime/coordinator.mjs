import crypto from "node:crypto";
import { createStrategyResultEnvelope } from "./contracts.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "./execution-plan-builder.mjs";
import { containsHanCharacters } from "../assistant-output-language.mjs";

function boundedText(value, max = 12_000) {
  return String(value || "").replace(/\u0000/g, "").slice(0, max);
}

// A strategy mention followed by a short imperative such as “帮我分析” is
// an explicit request to inspect the active chart, not an open-ended strategy
// question.  Leaving this small, unambiguous command to the model router is
// unsafe: when a prior analysis exists, the model may classify it as a
// conversation follow-up and the Renderer then skips both market-data reads
// and Drawing Gateway playback.  Keep parameterised or conceptual messages
// on the strategy-specific model router; only handle the no-parameter canvas
// commands deterministically here.
function stripStrategyMention(text, manifest) {
  let source = String(text || "");
  const names = [manifest?.mentions?.canonical, ...(manifest?.mentions?.aliases || [])]
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  for (const name of names) {
    source = source
      .split(`@策略:${name}`).join("")
      .split(`@策略：${name}`).join("");
  }
  return source.replace(/\s+/gu, " ").trim();
}

function deterministicShortChartRequest(text, manifest, { hasImageAttachment = false } = {}) {
  if (hasImageAttachment) return null;
  const instruction = stripStrategyMention(text, manifest);
  if (!instruction) return null;
  // Keep this intentionally narrow so “什么是…”/“如何理解…” and requests
  // containing explicit symbols or periods still receive their full strategy
  // router/model treatment.
  const shortCanvasAction = /^(?:(?:请|麻烦|劳驾|帮我|帮忙)\s*)?(?:分析(?:下|一下|看看)?|看盘|看(?:下|一下|看)?(?:盘面|行情|走势|图表|K\s*线)?|复盘(?:下|一下)?|重新分析|刷新(?:下|一下)?|更新(?:下|一下)?|画(?:下|一下)?(?:线|图)?|绘图)(?:\s*(?:当前|现在)?(?:盘面|行情|走势|图表|K\s*线)?)?(?:\s*(?:并|然后)?\s*(?:画线|画图|绘图))?(?:吧|呗|谢谢)?[。！!]*$/iu;
  if (!shortCanvasAction.test(instruction)) return null;
  return Object.freeze({
    mode: "chart-analysis",
    instruction,
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: true,
  });
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
    const deterministicShortAction = deterministicShortChartRequest(
      text,
      strategy.manifest,
      routingContext,
    );
    if (deterministicShortAction) {
      return Object.freeze({
        ok: true,
        strategyId: strategy.manifest.id,
        request: deterministicShortAction,
        classification: Object.freeze({
          schemaVersion: 1,
          mode: "chart-analysis",
          intent: "chart-drawing",
          confidence: 1,
          source: "deterministic-short-chart-action",
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
    const defaultReport = params?.responseMode === "direct" || !exposesExecutionPlan
      ? legacyAnalysisPlan.report
      : `${formatExecutionPlanMarkdown(executionPlan)}\n\n---\n\n${legacyReportWithoutExecutionPlan}`.trim();
    const englishLegacyReport = String(legacyReportWithoutExecutionPlan || "").trim();
    const englishReport = exposesExecutionPlan
      ? [
          formatExecutionPlanMarkdown(executionPlan, { language: "en" }),
          ...(!containsHanCharacters(englishLegacyReport) ? ["---", englishLegacyReport] : []),
        ].filter(Boolean).join("\n\n")
      : containsHanCharacters(defaultReport)
        ? "The market analysis is complete. Review the chart annotations for the detected structure and risk levels."
        : defaultReport;
    const decoratedResult = {
      ...legacyResult,
      strategy: Object.freeze({ id: strategy.manifest.id, version: strategy.manifest.version }),
      analysisPlan: {
        ...legacyAnalysisPlan,
        executionPlan,
        report: params?.language === "en" ? englishReport : defaultReport,
      },
    };
    return createStrategyResultEnvelope(strategy.manifest, decoratedResult, executionPlan);
  }
}
