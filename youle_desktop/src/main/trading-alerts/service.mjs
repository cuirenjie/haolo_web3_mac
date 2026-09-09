import { normalizeTradingAlertInterval } from "./interval.mjs";
import crypto from "node:crypto";
import { TradingAlertStore, createInitialAlertInstance } from "./store.mjs";
import { TradingAlertMarketDataHub } from "./market-data-hub.mjs";
import { createBinanceMarketAdapter } from "./binance-market-adapter.mjs";
import { createHyperliquidMarketAdapter } from "./hyperliquid-market-adapter.mjs";
import { TradingAlertEngine } from "./engine.mjs";
import { planRuleSubscriptions } from "./subscription-planner.mjs";
import { createAlertIntentProviderRegistry, createAppServerAlertIntentProvider } from "./intent-provider.mjs";
import { compileAlertDraft, createConfirmationBinding, resumeDraftAfterCapabilities, summarizeAlertRule, verifyConfirmationBinding } from "./intent-workflow.mjs";
import { createBuiltinCapabilityRegistry } from "./capabilities.mjs";
import { chartSwitchRequest } from "./simulation-planner.mjs";
import { planAlertSimulationIsolated } from "./simulation-worker-client.mjs";
import { createAlertRuleRevision, normalizeAlertDraft, TRADING_ALERT_SCHEMA_VERSION } from "./protocol.mjs";
import { TradingAlertError, tradingAlertErrorEnvelope } from "./errors.mjs";
import {
  buildExecutionPlanAlertRule,
  executionPlanAlertIds,
  parseExecutionPlanAlertInput,
} from "./execution-plan-alert.mjs";

export class TradingAlertService {
  constructor({ dataDir, invokeIntentModel, notify, enabled = false, now = () => Date.now(), marketAdapter, marketFetch, marketSubscribeMode, shadowMode = false, planSimulation = planAlertSimulationIsolated } = {}) {
    this.enabled = enabled;
    this.now = now;
    this.store = new TradingAlertStore({ dataDir, now });
    this.dataHub = new TradingAlertMarketDataHub();
    this.dataHub.registerAdapter(marketAdapter || createBinanceMarketAdapter({ fetchImpl: marketFetch, subscribeMode: marketSubscribeMode }));
    this.dataHub.registerAdapter(createHyperliquidMarketAdapter());
    this.capabilities = createBuiltinCapabilityRegistry();
    this.intentProviderId = "openai-codex";
    this.confirmationOperations = new Map();
    this.pendingDrafts = new Map();
    this.pendingSimulations = new Map();
    this.planSimulation = planSimulation;
    this.intentRegistry = createAlertIntentProviderRegistry([createAppServerAlertIntentProvider({ invoke: invokeIntentModel })]);
    this.engine = new TradingAlertEngine({ store: this.store, dataHub: this.dataHub, now, notify, shadowMode });
  }

  async start() {
    await this.store.load();
    await this.store.purgeUnconfirmedArtifacts();
    this.engine.syncDrawings(await this.store.listDrawings());
    if (this.enabled) await this.engine.start();
    return this.snapshot();
  }

  async snapshot() {
    const [alerts, gaps, evidence] = await Promise.all([
      this.store.listAlerts(), this.store.listGaps(), this.store.listEvidence(),
    ]);
    return Object.freeze({ schemaVersion: 1, enabled: this.enabled, engine: this.engine.status(), providers: this.capabilities.list(), alerts, gaps, evidence });
  }

  async getSimulation(params = {}) {
    const simulationId = String(params.simulationId || "").trim();
    if (!simulationId) throw new TradingAlertError("缺少模拟标识", { code: "TRADING_ALERT_SIMULATION_ID_REQUIRED", category: "validation" });
    const simulation = await this.store.getSimulation(simulationId);
    if (!simulation) throw new TradingAlertError("预警模拟记录不存在", { code: "TRADING_ALERT_SIMULATION_NOT_FOUND", category: "storage" });
    return simulation;
  }

  async requirePersistedAlert(alertId) {
    const [alert, listedAlerts] = await Promise.all([
      this.store.getAlert(alertId),
      this.store.listAlerts(),
    ]);
    if (!alert || !listedAlerts.some((entry) => entry.alertId === alert.alertId)) {
      throw new TradingAlertError("预警写入后未能从持久化列表读回，未返回创建成功", {
        code: "TRADING_ALERT_PERSISTENCE_NOT_VERIFIED",
        category: "storage",
      });
    }
    return alert;
  }

  async syncExecutionPlan(params = {}) {
    if (!this.enabled) {
      throw new TradingAlertError("智能预警仍处于功能开关关闭状态，无法监控执行计划", {
        code: "TRADING_ALERT_FEATURE_DISABLED",
        category: "validation",
      });
    }
    const spec = parseExecutionPlanAlertInput(params);
    const ids = executionPlanAlertIds(spec.planId);
    const alerts = await this.store.listAlerts();
    const requested = spec.alertId ? alerts.find((entry) => entry.alertId === spec.alertId) : null;
    const linked = alerts.find((entry) => entry.draftId === ids.draftId) || null;
    if (requested && requested.draftId !== ids.draftId) {
      throw new TradingAlertError("该预警不属于当前执行计划，已拒绝覆盖", {
        code: "TRADING_ALERT_EXECUTION_PLAN_LINK_MISMATCH",
        category: "validation",
      });
    }
    const current = requested || linked;
    const rule = buildExecutionPlanAlertRule(spec, {
      previousRule: current?.rule || null,
      now: this.now(),
    });
    const paused = spec.status === "ended";
    let alert;
    if (current) {
      await this.engine.disarm(current.alertId, { updateStore: false });
      alert = await this.store.updateAlert(current.alertId, {
        rule,
        ruleHash: rule.ruleHash,
        enabled: !paused,
        status: paused ? "paused" : "arming",
        rearmState: "unarmed",
        triggerCount: 0,
        armedAt: null,
        lastEvaluatedAt: null,
        lastTriggeredAt: null,
        latestEvidenceId: undefined,
        failure: paused ? "执行计划已结束，预警已自动暂停" : null,
        ...(spec.originThreadId ? { originThreadId: spec.originThreadId } : {}),
      });
    } else {
      const initial = createInitialAlertInstance({
        alertId: ids.alertId,
        draftId: ids.draftId,
        rule,
        simulationId: ids.simulationId,
        confirmationId: ids.confirmationId,
        originThreadId: spec.originThreadId,
        now: this.now(),
      });
      alert = await this.store.createAlert(paused ? {
        ...initial,
        enabled: false,
        status: "paused",
        failure: "执行计划已结束，预警已自动暂停",
      } : initial);
    }
    if (!paused) {
      const armResult = await this.engine.armWithRecovery(alert.alertId);
      alert = armResult.alert || alert;
      return {
        alert: await this.requirePersistedAlert(alert.alertId),
        phase: spec.status,
        monitoringReady: armResult.monitoringReady,
        created: !current,
        ...(armResult.error ? { warning: String(armResult.error.message || armResult.error) } : {}),
      };
    }
    return {
      alert: await this.requirePersistedAlert(alert.alertId),
      phase: spec.status,
      monitoringReady: false,
      created: !current,
    };
  }

  async compile(params = {}) {
    const sourceText = String(params.sourceText || "").trim();
    if (!sourceText) throw new TradingAlertError("请输入预警条件", { code: "TRADING_ALERT_INTENT_EMPTY", category: "validation" });
    const draftId = String(params.draftId || `draft-${crypto.randomUUID()}`);
    const result = await compileAlertDraft({
      registry: this.intentRegistry,
      providerId: this.intentProviderId,
      capabilityRegistry: this.capabilities,
      now: this.now,
      signal: params.signal,
      onReasoningSummaryDelta: typeof params.onReasoningSummaryDelta === "function"
        ? params.onReasoningSummaryDelta
        : undefined,
      input: {
        schemaVersion: 1,
        requestId: `intent-${crypto.randomUUID()}`,
        draftId,
        sourceText,
        conversation: params.conversation || [],
        currentChart: params.currentChart || null,
        drawings: params.drawings || [],
        originThreadId: params.threadId ? String(params.threadId) : undefined,
        availableCapabilities: this.capabilities.list().filter((entry) => entry.connectionState === "connected").map((entry) => entry.capabilityId),
        locale: "zh-CN",
      },
    });
    this.pendingDrafts.set(result.draft.draftId, result.draft);
    for (const [simulationId, simulation] of this.pendingSimulations) {
      if (simulation.draftId === result.draft.draftId) this.pendingSimulations.delete(simulationId);
    }
    return { ...result, chartSwitch: result.draft.rule ? chartSwitchRequest(result.draft.rule) : null };
  }

  async resumeDraft(draftId) {
    const draft = this.pendingDrafts.get(String(draftId));
    if (!draft) throw new TradingAlertError("本次未确认预警已失效，请重新提交条件", { code: "TRADING_ALERT_PENDING_NOT_FOUND", category: "validation" });
    const result = resumeDraftAfterCapabilities({ draft, capabilityRegistry: this.capabilities, now: this.now });
    this.pendingDrafts.set(result.draft.draftId, result.draft);
    return result;
  }

  async simulate(params = {}) {
    const draft = this.pendingDrafts.get(String(params.draftId));
    if (!draft?.rule) throw new TradingAlertError("本次未确认预警尚未形成完整规则", { code: "TRADING_ALERT_PENDING_NOT_EXECUTABLE", category: "validation" });
    if (draft.status !== "ready_to_simulate" && draft.status !== "awaiting_confirmation") {
      throw new TradingAlertError("请先补齐澄清项和数据能力", { code: "TRADING_ALERT_PENDING_NOT_READY", category: "validation" });
    }
    this.pendingDrafts.set(draft.draftId, normalizeAlertDraft({ ...draft, status: "simulating", updatedAt: this.now() }));
    try {
      const simulation = await this.planSimulation({
        rule: draft.rule,
        frames: params.frames,
        maxBars: params.maxBars,
        beamWidth: params.beamWidth,
        timeoutMs: params.timeoutMs,
      });
      this.seedSimulationHistory(draft.rule, params.frames);
      const binding = createConfirmationBinding({ draftId: draft.draftId, ruleHash: draft.rule.ruleHash, simulationId: simulation.simulationId, now: this.now() });
      const replacesAlertId = params.replacesAlertId ? String(params.replacesAlertId) : null;
      if (replacesAlertId && !(await this.store.getAlert(replacesAlertId))) {
        throw new TradingAlertError("要更新的预警不存在", { code: "TRADING_ALERT_NOT_FOUND", category: "storage" });
      }
      const anchorContextId = String(draft.rule.evaluationPolicy.anchorContextId || "");
      const anchorFrame = params.frames?.[anchorContextId];
      const anchorCandles = Array.isArray(anchorFrame?.candles)
        ? anchorFrame.candles.slice(-500).map((candle) => ({
            time: Number(candle.time),
            closeTime: Number(candle.closeTime),
            open: Number(candle.open),
            high: Number(candle.high),
            low: Number(candle.low),
            close: Number(candle.close),
            volume: Number(candle.volume || 0),
          }))
        : [];
      const record = {
        ...simulation,
        draftId: draft.draftId,
        confirmation: binding,
        ...(anchorCandles.length ? {
          visualization: {
            schemaVersion: 1,
            anchorContextId,
            marketId: String(anchorFrame?.marketId || ""),
            interval: String(anchorFrame?.interval || ""),
            candles: anchorCandles,
          },
        } : {}),
        ...(replacesAlertId ? { replacesAlertId } : {}),
      };
      const updatedDraft = normalizeAlertDraft({ ...draft, status: "awaiting_confirmation", updatedAt: this.now() });
      this.pendingDrafts.set(draft.draftId, updatedDraft);
      this.pendingSimulations.set(record.simulationId, record);
      return { draft: updatedDraft, simulation: record, question: `我已按“${summarizeAlertRule(draft.rule)}”模拟并标注触发。是否就是这种情况？` };
    } catch (error) {
      this.pendingDrafts.set(draft.draftId, normalizeAlertDraft({ ...draft, status: "ready_to_simulate", error: String(error?.message || error), updatedAt: this.now() }));
      throw error;
    }
  }

  seedSimulationHistory(rule, frames = {}) {
    const subscriptions = planRuleSubscriptions(rule);
    const subscriptionsByContext = new Map();
    for (const subscription of subscriptions) {
      const current = subscriptionsByContext.get(subscription.contextId) || [];
      current.push(subscription);
      subscriptionsByContext.set(subscription.contextId, current);
    }
    let seeded = 0;
    for (const subscription of subscriptions) {
      const frame = frames?.[subscription.contextId];
      const frameMarketId = String(frame?.marketId || "").trim().toUpperCase();
      const frameInterval = normalizeTradingAlertInterval(frame?.interval);
      const candidates = subscriptionsByContext.get(subscription.contextId) || [];
      const unambiguousMarket = frameMarketId || candidates.filter((entry) => entry.interval === subscription.interval).length === 1;
      if (!frame || frame.coverage !== "available" || frameInterval !== subscription.interval
        || !unambiguousMarket || (frameMarketId && frameMarketId !== subscription.marketId)
        || !Array.isArray(frame.candles) || frame.candles.length < 2) continue;
      this.dataHub.seedHistory(subscription, frame.candles);
      seeded += 1;
    }
    return seeded;
  }

  async confirm(params = {}) {
    const key = `${String(params.draftId || "")}\u0000${String(params.simulationId || "")}\u0000${String(params.confirmationId || "")}`;
    const active = this.confirmationOperations.get(key);
    if (active) return active;
    const operation = this.confirmOnce(params).finally(() => {
      if (this.confirmationOperations.get(key) === operation) this.confirmationOperations.delete(key);
    });
    this.confirmationOperations.set(key, operation);
    return operation;
  }

  async confirmOnce(params = {}) {
    if (!this.enabled) throw new TradingAlertError("智能预警仍处于功能开关关闭状态，无法开始后台监控", { code: "TRADING_ALERT_FEATURE_DISABLED", category: "validation" });
    const existing = (await this.store.listAlerts()).find((entry) => (
      entry.draftId === String(params.draftId || "")
      || (
        entry.simulationId === String(params.simulationId || "")
        && entry.confirmationId === String(params.confirmationId || "")
      )
    ));
    if (existing) {
      if (existing.simulationId !== String(params.simulationId || "")
        || existing.confirmationId !== String(params.confirmationId || "")) {
        throw new TradingAlertError("已创建预警与本次确认不一致，请重新模拟", { code: "TRADING_ALERT_CONFIRMATION_STALE", category: "validation" });
      }
      const armResult = existing.enabled && existing.status !== "completed" && existing.status !== "monitoring"
        ? await this.engine.armWithRecovery(existing.alertId)
        : { alert: existing, monitoringReady: existing.status === "monitoring", error: null };
      const persisted = await this.requirePersistedAlert(existing.alertId);
      return {
        alert: persisted,
        summary: summarizeAlertRule(persisted.rule),
        monitoringReady: armResult.monitoringReady,
        idempotent: true,
        ...(armResult.error ? { warning: String(armResult.error.message || armResult.error) } : {}),
      };
    }
    const draft = this.pendingDrafts.get(String(params.draftId));
    const simulation = this.pendingSimulations.get(String(params.simulationId));
    if (!draft?.rule || !simulation) throw new TradingAlertError("本次未确认预警已失效，请重新提交条件并模拟", { code: "TRADING_ALERT_CONFIRMATION_MISSING", category: "validation" });
    if (params.confirmationId !== simulation.confirmation.confirmationId) throw new TradingAlertError("确认标识不匹配", { code: "TRADING_ALERT_CONFIRMATION_STALE", category: "validation" });
    verifyConfirmationBinding(simulation.confirmation, { draft, simulationId: params.simulationId, now: this.now() });
    if (simulation.replacesAlertId) {
      const current = await this.store.getAlert(simulation.replacesAlertId);
      if (!current) throw new TradingAlertError("要更新的预警不存在", { code: "TRADING_ALERT_NOT_FOUND", category: "storage" });
      await this.engine.disarm(current.alertId, { updateStore: false });
      const updated = await this.store.updateAlert(current.alertId, {
        rule: draft.rule,
        ruleHash: draft.rule.ruleHash,
        simulationId: simulation.simulationId,
        confirmationId: simulation.confirmation.confirmationId,
        status: current.enabled ? "arming" : "paused",
        rearmState: "unarmed",
        lastEvaluatedAt: null,
        failure: null,
        ...(draft.originThreadId ? { originThreadId: draft.originThreadId } : {}),
      }, { simulation });
      this.pendingDrafts.delete(draft.draftId);
      this.pendingSimulations.delete(simulation.simulationId);
      const armResult = updated.enabled
        ? await this.engine.armWithRecovery(updated.alertId)
        : { alert: updated, monitoringReady: false, error: null };
      return {
        alert: await this.requirePersistedAlert(updated.alertId),
        summary: summarizeAlertRule(updated.rule),
        revised: true,
        monitoringReady: armResult.monitoringReady,
        ...(armResult.error ? { warning: String(armResult.error.message || armResult.error) } : {}),
      };
    }
    const alertId = String(params.alertId || `alert-${crypto.randomUUID()}`);
    const alert = await this.store.createAlert(createInitialAlertInstance({
      alertId, draftId: draft.draftId, rule: draft.rule, simulationId: simulation.simulationId,
      confirmationId: simulation.confirmation.confirmationId, originThreadId: draft.originThreadId, now: this.now(),
    }), { simulation });
    this.pendingDrafts.delete(draft.draftId);
    this.pendingSimulations.delete(simulation.simulationId);
    const armResult = await this.engine.armWithRecovery(alert.alertId);
    return {
      alert: await this.requirePersistedAlert(alert.alertId),
      summary: summarizeAlertRule(alert.rule),
      monitoringReady: armResult.monitoringReady,
      ...(armResult.error ? { warning: String(armResult.error.message || armResult.error) } : {}),
    };
  }

  async revise(params = {}) {
    const alert = await this.store.getAlert(params.alertId);
    if (!alert) throw new TradingAlertError("预警不存在", { code: "TRADING_ALERT_NOT_FOUND", category: "storage" });
    if (alert.rule.contexts.some((context) => context.drawingBinding)) {
      throw new TradingAlertError("含画线条件的预警不能编辑或迁移，请回到原 K 线图操作", {
        code: "TRADING_ALERT_DRAWING_REVISION_LOCKED",
        category: "validation",
      });
    }
    const contextId = String(params.contextId || alert.rule.evaluationPolicy.anchorContextId);
    const parseList = (value, fallback = []) => {
      const source = Array.isArray(value) ? value : String(value || "").split(/[,，\s]+/u);
      const result = [...new Set(source.map((entry) => String(entry).trim()).filter(Boolean))];
      return result.length ? result : fallback;
    };
    const contexts = alert.rule.contexts.map((context) => {
      if (context.contextId !== contextId) return context;
      if (context.drawingBinding && (params.marketId || params.marketIds || params.interval || params.intervals || params.selectorKind)) throw new TradingAlertError("画线预警不能切换交易对或周期", { code: "TRADING_ALERT_DRAWING_SCOPE_LOCKED", category: "validation" });
      const markets = parseList(params.marketIds || params.marketId, context.marketSelector.marketIds || context.marketSelector.frozenMarketIds || []).map((entry) => entry.toUpperCase());
      const intervals = parseList(params.intervals || params.interval, context.intervals).map(normalizeTradingAlertInterval);
      const selectorKind = params.selectorKind === "universe" ? "universe" : "fixed";
      const marketSelector = selectorKind === "universe" ? {
        kind: "universe",
        provider: String(params.provider || context.marketSelector.provider || "binance").toLowerCase(),
        venue: String(params.venue || context.marketSelector.venue || "binance").toLowerCase(),
        marketType: String(params.marketType || context.marketSelector.marketType || "perpetual").toLowerCase(),
        ...(params.quoteAsset ? { quoteAsset: String(params.quoteAsset).toUpperCase() } : {}),
        frozenMarketIds: markets,
      } : { kind: "fixed", marketIds: markets };
      return {
        ...context,
        ...((params.marketId || params.marketIds || params.selectorKind) ? { marketSelector } : {}),
        ...((params.interval || params.intervals) ? { intervals } : {}),
      };
    });
    const triggerPolicy = params.mode ? {
      ...alert.rule.triggerPolicy,
      mode: params.mode,
      ...(params.mode === "once" ? { maxTriggersTotal: 1 } : { maxTriggersTotal: undefined }),
    } : alert.rule.triggerPolicy;
    const evaluationPolicy = params.clock ? { ...alert.rule.evaluationPolicy, clock: params.clock } : alert.rule.evaluationPolicy;
    const rule = createAlertRuleRevision(alert.rule, { ...alert.rule, contexts, triggerPolicy, evaluationPolicy, ruleHash: undefined });
    const time = this.now();
    const draft = normalizeAlertDraft({
      schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
      draftId: `draft-revision-${crypto.randomUUID()}`,
      sourceText: `修改预警：${summarizeAlertRule(rule)}`,
      status: "ready_to_simulate",
      rule,
      missingFields: [], ambiguities: [], questions: [], dataRequirements: rule.dataRequirements,
      createdAt: time, updatedAt: time,
      ...(alert.originThreadId ? { originThreadId: alert.originThreadId } : {}),
    });
    this.pendingDrafts.set(draft.draftId, draft);
    return { draft, requiresSimulation: true, message: "修改已生成新 revision；重新模拟并确认前，原预警继续按旧规则监控。" };
  }

  async pause(alertId) { return this.engine.pause(String(alertId)); }
  async resume(alertId) {
    if (!this.enabled) throw new TradingAlertError("功能开关关闭，不能恢复监控", { code: "TRADING_ALERT_FEATURE_DISABLED", category: "validation" });
    return this.engine.resume(String(alertId));
  }
  async delete(alertId) { await this.engine.disarm(String(alertId)); return this.store.deleteAlert(String(alertId)); }
  async syncDrawings(params = {}) {
    const result = await this.store.replaceDrawings(params);
    this.engine.syncDrawings(result.drawings);
    if (result.removedDrawingIds.length) {
      for (const alert of await this.store.listAlerts()) {
        const missing = alert.rule.contexts.find((context) => context.drawingBinding && result.removedDrawingIds.includes(context.drawingBinding.drawingId));
        if (missing && alert.enabled) await this.engine.pause(alert.alertId, `绑定画线 ${missing.drawingBinding.drawingId} 已删除；请恢复画线并重新确认。`);
      }
    }
    return { count: result.drawings.length, removedDrawingIds: result.removedDrawingIds };
  }
  async lifecycle(params = {}) {
    const phase = String(params.phase || "");
    const reason = String(params.reason || "unknown");
    if (phase === "suspend") return this.engine.suspend(reason);
    if (phase === "resume") return this.engine.resumeMonitoring(reason);
    throw new TradingAlertError("未知的预警生命周期事件", { code: "TRADING_ALERT_LIFECYCLE_INVALID", category: "validation" });
  }
  async subscribeMarket(params = {}, onEvent) {
    const subscription = {
      providerId: String(params.providerId || "binance-public"),
      marketId: String(params.marketId || ""),
      interval: String(params.interval || ""),
      fields: ["ohlcv"],
    };
    const history = await this.dataHub.loadHistory(subscription, Math.min(1_500, Math.max(2, Number(params.limit) || 500)));
    const dispose = await this.dataHub.subscribe(subscription, onEvent);
    return { subscription, history, dispose };
  }
  async shutdown() {
    await this.engine.shutdown();
    await this.dataHub.close();
    this.pendingDrafts.clear();
    this.pendingSimulations.clear();
  }

  async safeCall(method, ...args) {
    try { return { ok: true, data: await this[method](...args) }; }
    catch (error) { return { ok: false, error: tradingAlertErrorEnvelope(error) }; }
  }
}
