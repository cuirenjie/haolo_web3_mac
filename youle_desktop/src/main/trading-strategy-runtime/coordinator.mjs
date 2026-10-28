import { vietnameseText } from '../../shared/vietnamese.mjs';
import { japaneseText } from '../../shared/japanese.mjs';
import { koreanText, localizedChoice } from '../../shared/korean.mjs';
import { createStrategyResultEnvelope } from "./contracts.mjs";
import { withTradingPreferenceContext } from "../personal-context/trading-preference-context.mjs";
import { buildExecutionPlanV1, formatExecutionPlanMarkdown } from "./execution-plan-builder.mjs";
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

function stripLegacyExecutionPlanSection(value, language) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\s*#{1,6}\s+(?:标准执行方案|標準執行方案|Standard execution plan)\s*$/u.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s*#{1,6}\s+\S/u.test(line)) skipping = false;
    if (!skipping) output.push(line.replace(/^(\s*#{1,6}\s+)(?:当前执行方案|當前執行方案|Current execution plan|条件式执行|條件式執行|Conditional execution)\s*$/u,
      (_, prefix) => prefix + (language === "vi" ? vietnameseText("構造シナリオ") : language === "ja" ? "構造シナリオ" : language === "ko" ? "구조적 시나리오" : language === "en" ? "Structural scenario" : language === "zh-TW" || language === "zh-Hant" ? "結構場景" : "结构场景")));
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function structuralReferenceNotice(language) {
  if (language === "vi") return vietnameseText(structuralReferenceNotice("zh-CN"));
if (language === "ja") return japaneseText(structuralReferenceNotice("zh-CN"));
  if (language === "ko") return koreanText(structuralReferenceNotice("zh-CN"));
  if (language === "en") return "### Structural reference\n\nThe analysis and chart annotations below describe the original market structure and its conditional scenarios. Their trigger and projection levels are structural references. The execution plan above applies the configured entry-distance limit, staged targets and risk rules, so its planned prices may differ. Use that plan for execution levels; its risk/reward ratios include estimated fees and slippage. The plan uses price-touch entry: a market-entry action means its price condition is already met, and the displayed trigger is then an entry reference. The candle-close confirmation and retest criteria below describe the original structural scenario. No order has been submitted.";
  if (language === "zh-TW" || language === "zh-Hant") return "### 結構參考\n\n下方分析與圖表標註描述原始市場結構及其條件場景，觸發價和投射目標屬於結構參考。上方執行方案已套用設定的入場距離限制、分批目標及風險規則，因此計畫價格可能不同；執行價位以上方方案為準，盈虧比已計入預估手續費與滑點。執行方案採用價格觸達入場；市價入場動作表示計畫價格條件已滿足，此時顯示的觸發價為入場參考。下方收盤突破與回踩條件描述原始結構場景。尚未提交任何訂單。";
  return "### 结构参考\n\n下方分析与图表标注描述原始市场结构及其条件场景，触发价和投射目标属于结构参考。上方执行方案已应用设置的入场距离限制、分批目标及风险规则，因此计划价格可能不同；执行价位以上方方案为准，盈亏比已计入预估手续费与滑点。执行方案采用价格触达入场；市价入场动作表示计划价格条件已满足，此时显示的触发价为入场参考。下方收盘突破与回踩条件描述原始结构场景。尚未提交任何订单。";
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
    if (
      hasExplicitStrategyMention
      && !params?.hasImageAttachment
      && (strategy.manifest.id !== "price-action" || !params?.hasCurrentAnalysis)
      && explicitRequest.mode === "chart-analysis"
    ) {
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
        modelRegistry: personalRiskUnavailable(analysisParams)
          ? personalRiskModelRegistry(modelRegistry || this.#modelRegistry, analysisParams)
          : withTradingPreferenceContext(modelRegistry || this.#modelRegistry, analysisParams.userRiskProfile),
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
    const legacyReportWithoutExecutionPlan = stripLegacyExecutionPlanSection(legacyAnalysisPlan.report, params?.language);
    const combined = params?.responseMode !== "direct" && exposesExecutionPlan && !personalRiskUnavailable(params);
    const english = params?.language === "en";
    const traditional = params?.language === "zh-TW" || params?.language === "zh-Hant";
    const planHeading = params?.language === 'vi' ? vietnameseText("### 指定価格への到達を条件とする取引計画") : params?.language === 'ja' ? '### 指定価格への到達を条件とする取引計画' : params?.language === 'ko' ? '### 가격 도달 조건에 따른 실행 계획' : english ? "### Configured price-touch plan" : traditional ? "### 價格觸達執行方案" : "### 价格触达执行方案";
    const structuralSummary = params?.language === 'vi' ? vietnameseText("元の相場構造の評価（以下の確認価格は、設定した取引計画のエントリー価格とは別のものです）：") : params?.language === 'ja' ? '元の相場構造の評価（以下の確認価格は、設定した取引計画のエントリー価格とは別のものです）：' : params?.language === 'ko' ? '원래 시장 구조 평가(아래 확인 가격은 설정된 실행 계획의 진입 가격과 별개입니다): ' : english
      ? "Original structural assessment (confirmation levels below are separate from the configured plan's entry prices): "
      : traditional ? "原始結構判斷（下列確認價位與執行方案的入場價分開）：" : "原始结构判断（下列确认价位与执行方案的入场价分开）：";
    // Localization belongs to the formatter/pipeline. Never discard analysis
    // evidence because a proper name or a model response contains another script.
    const report = !combined
      ? legacyAnalysisPlan.report
      : [planHeading + "\n\n" + formatExecutionPlanMarkdown(executionPlan, { language: params?.language }), structuralReferenceNotice(params?.language), legacyReportWithoutExecutionPlan]
        .filter(Boolean).join("\n\n---\n\n").trim();
    const decoratedResult = {
      ...legacyResult,
      strategy: Object.freeze({ id: strategy.manifest.id, version: strategy.manifest.version }),
      analysisPlan: {
        ...legacyAnalysisPlan,
        executionPlan,
        report,
        narrative: combined && legacyAnalysisPlan.narrative ? structuralSummary + legacyAnalysisPlan.narrative : legacyAnalysisPlan.narrative,
      },
    };
    return withPersonalRiskNotice(createStrategyResultEnvelope(strategy.manifest, decoratedResult, executionPlan), params);
  }
}
