import crypto from "node:crypto";
import { TradingAlertEvaluator, UNKNOWN } from "./evaluator.mjs";
import { marketSubscriptionKey } from "./market-data-hub.mjs";
import { planRuleSubscriptions } from "./subscription-planner.mjs";
import { TRADING_ALERT_SCHEMA_VERSION } from "./protocol.mjs";
import { TradingAlertError } from "./errors.mjs";

function bindingKey(binding) {
  return Object.entries(binding).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => `${id}:${value.marketId}:${value.interval}`).join("|");
}

export function tradingAlertArmRetryDelayMs(alertId, attemptValue, error = null) {
  const attempt = Math.max(1, Math.floor(Number(attemptValue) || 1));
  const exponential = Math.min(60_000, 2_000 * 2 ** Math.min(attempt - 1, 5));
  const retryAfterMs = Math.max(0, Number(error?.details?.retryAfterMs) || 0);
  const digest = crypto.createHash("sha256").update(`${String(alertId)}:${attempt}`).digest();
  const jitterMs = digest.readUInt32BE(0) % 1_001;
  return Math.max(exponential, retryAfterMs ? retryAfterMs + 500 : 0) + jitterMs;
}

export function materializeRuleBindings(rule, maxBindings = 256) {
  let bindings = [{}];
  for (const context of rule.contexts) {
    const markets = context.marketSelector.kind === "fixed" ? context.marketSelector.marketIds : context.marketSelector.frozenMarketIds || [];
    const choices = markets.flatMap((marketId) => context.intervals.map((interval) => ({ marketId, interval })));
    if (!choices.length) throw new TradingAlertError(`Context ${context.contextId} 没有冻结的市场/周期`, { code: "TRADING_ALERT_CONTEXT_NOT_FROZEN", category: "validation" });
    bindings = bindings.flatMap((binding) => choices.map((choice) => ({ ...binding, [context.contextId]: choice })));
    if (bindings.length > maxBindings) throw new TradingAlertError(`规则展开超过 ${maxBindings} 个监控组合`, { code: "TRADING_ALERT_BINDING_LIMIT", category: "validation" });
  }
  return Object.freeze(bindings.map((entry) => Object.freeze(entry)));
}

function evidenceFromResult(alert, variant, result, event) {
  const contexts = Object.entries(variant.frames).map(([contextId, frame]) => {
    const binding = variant.binding[contextId];
    const candle = frame.candles.at(-1);
    return {
      marketId: binding.marketId,
      interval: binding.interval,
      eventTime: candle.closeTime || candle.time,
      candle,
      source: frame.source || event.source || "market-data-hub",
      coverage: { status: frame.coverage || "available", receivedAt: frame.receivedAt },
      drawings: Object.values(frame.drawings || {}).filter((drawing) => drawing.marketId === binding.marketId && drawing.interval === binding.interval),
    };
  });
  return {
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    evidenceId: `evidence-${crypto.randomUUID()}`,
    alertId: alert.alertId,
    ruleRevision: alert.rule.revision,
    ruleHash: alert.ruleHash,
    triggerEventId: `${event.eventId}:${bindingKey(variant.binding)}`.slice(0, 160),
    triggeredAt: event.receivedAt,
    contexts,
    conditionResults: result.trace.map((entry) => ({
      conditionId: entry.conditionId,
      result: entry.value,
      previousValues: { left: entry.previousLeft, right: entry.previousRight },
      currentValues: { left: entry.left, right: entry.right, tolerance: entry.tolerance },
    })),
    inputHash: result.inputHash,
  };
}

export class TradingAlertEngine {
  constructor({ store, dataHub, now = () => Date.now(), notify = async () => {}, heartbeatMs = 10_000, historyLimit = 500, runtimeFlushMs = 1_000, shadowMode = false } = {}) {
    if (!store || !dataHub) throw new TypeError("TradingAlertEngine requires store and dataHub");
    this.store = store;
    this.dataHub = dataHub;
    this.now = now;
    this.notify = notify;
    this.heartbeatMs = heartbeatMs;
    this.historyLimit = historyLimit;
    this.runtimeFlushMs = Math.max(10, Number(runtimeFlushMs) || 1_000);
    this.shadowMode = shadowMode === true;
    this.runtimes = new Map();
    this.channels = new Map();
    this.started = false;
    this.queue = Promise.resolve();
    this.heartbeatTimer = null;
    this.runtimeFlushTimer = null;
    this.dirtyRuntimeIds = new Set();
    this.suspension = null;
    this.drawings = {};
    this.disposeHealthListener = null;
    this.armRetryTimers = new Map();
    this.armRetryAttempts = new Map();
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.disposeHealthListener ||= this.dataHub.onHealth?.((health) => {
      void this.enqueue(() => health.status !== "connected"
        ? this.suspend("provider_disconnected", { preserveSubscriptions: true })
        : health.allHealthy ? this.resumeMonitoring("provider_disconnected") : null).catch(() => {});
    });
    const snapshot = await this.store.load();
    const resumedAt = this.now();
    const lastSeen = snapshot.metadata.lastShutdownAt || snapshot.metadata.lastHeartbeatAt;
    const alerts = snapshot.alerts.filter((alert) => alert.enabled && alert.status !== "completed");
    if (lastSeen && resumedAt > lastSeen + this.heartbeatMs * 2) {
      for (const alert of alerts) await this.store.appendGap({
        gapId: `gap-${alert.alertId}-${resumedAt}`,
        alertId: alert.alertId,
        startedAt: lastSeen,
        endedAt: resumedAt,
        reason: "app_stopped",
        lastGoodEventAt: alert.lastEvaluatedAt,
        resumedAt,
        catchUpEvaluated: false,
      });
    }
    await Promise.all(alerts.map((alert) => this.armWithRecovery(alert.alertId)));
    await this.store.writeHeartbeat(resumedAt);
    this.heartbeatTimer = setInterval(() => void this.store.writeHeartbeat(this.now()).catch(() => {}), this.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  clearArmRetry(alertId, { resetAttempt = true } = {}) {
    const timer = this.armRetryTimers.get(alertId);
    if (timer) clearTimeout(timer);
    this.armRetryTimers.delete(alertId);
    if (resetAttempt) this.armRetryAttempts.delete(alertId);
  }

  scheduleArmRetry(alertId, error = null) {
    if (!this.started || this.armRetryTimers.has(alertId)) return;
    const attempt = Number(this.armRetryAttempts.get(alertId) || 0) + 1;
    this.armRetryAttempts.set(alertId, attempt);
    const delay = tradingAlertArmRetryDelayMs(alertId, attempt, error);
    const timer = setTimeout(() => {
      this.armRetryTimers.delete(alertId);
      void this.enqueue(async () => {
        const alert = await this.store.getAlert(alertId);
        if (!alert?.enabled || alert.status === "completed" || this.suspension) return;
        await this.armWithRecovery(alertId);
      }).catch(() => {});
    }, delay);
    timer.unref?.();
    this.armRetryTimers.set(alertId, timer);
  }

  async armWithRecovery(alertId) {
    this.clearArmRetry(alertId, { resetAttempt: false });
    try {
      const alert = await this.arm(alertId);
      this.clearArmRetry(alertId);
      return { alert, monitoringReady: alert?.status === "monitoring", error: null };
    } catch (error) {
      await this.disarm(alertId, { updateStore: false, clearRetry: false });
      const current = await this.store.getAlert(alertId);
      if (!current?.enabled || current.status === "completed") throw error;
      const retryable = error?.retryable === true || ["transport", "provider"].includes(error?.category);
      const alert = await this.store.updateAlert(alertId, {
        status: retryable ? "reconnecting" : "failed",
        rearmState: "unarmed",
        failure: String(error?.message || error || "行情初始化失败").slice(0, 1_000),
      });
      if (retryable) this.scheduleArmRetry(alertId, error);
      return { alert, monitoringReady: false, error };
    }
  }

  async arm(alertId) {
    const alert = await this.store.getAlert(alertId);
    if (!alert || !alert.enabled || alert.status === "completed") return null;
    await this.disarm(alertId, { updateStore: false, clearRetry: false });
    const subscriptions = planRuleSubscriptions(alert.rule);
    const histories = new Map();
    for (const subscription of subscriptions) {
      const key = marketSubscriptionKey(subscription);
      if (!histories.has(key)) histories.set(key, await this.dataHub.loadHistory(subscription, this.historyLimit));
    }
    const saved = await this.store.getRuntimeState(alertId);
    const variants = materializeRuleBindings(alert.rule).map((binding) => {
      const evaluator = new TradingAlertEvaluator({ drawings: this.drawings });
      const key = bindingKey(binding);
      if (saved?.variants?.[key]?.evaluator) evaluator.importState(saved.variants[key].evaluator);
      const frames = {};
      for (const [contextId, choice] of Object.entries(binding)) {
        const subscription = subscriptions.find((entry) => entry.contextId === contextId && entry.marketId === choice.marketId && entry.interval === choice.interval);
        frames[contextId] = {
          candles: structuredClone(histories.get(marketSubscriptionKey(subscription)) || []),
          closed: true, coverage: "available", source: subscription.providerId,
          receivedAt: this.now(), interval: choice.interval,
          drawings: this.drawings,
        };
      }
      return { binding, frames, evaluator, previous: saved?.variants?.[key]?.previous ?? UNKNOWN, baseline: false };
    });
    const runtime = { alert, variants, subscriptions, disposers: [], processed: new Set() };
    this.runtimes.set(alertId, runtime);
    for (const variant of variants) this.establishBaseline(runtime, variant);
    for (const subscription of subscriptions) {
      const dispose = await this.subscribeShared(subscription, (event) => this.enqueue(() => this.processEvent(alertId, event)));
      runtime.disposers.push(dispose);
    }
    const waitingFalse = variants.some((variant) => variant.previous === true);
    runtime.alert = await this.store.updateAlert(alertId, {
      status: "monitoring", armedAt: this.now(), lastEvaluatedAt: this.now(),
      rearmState: waitingFalse ? "waiting_false" : "armed",
    });
    await this.persistRuntime(runtime);
    return runtime.alert;
  }

  establishBaseline(runtime, variant) {
    if (Object.values(variant.frames).some((frame) => !frame.candles.length)) return;
    const time = Math.max(...Object.values(variant.frames).map((frame) => frame.candles.at(-1).closeTime));
    for (const frame of Object.values(variant.frames)) frame.receivedAt = time;
    const result = variant.evaluator.evaluate(runtime.alert.rule, { eventId: `baseline-${runtime.alert.alertId}-${bindingKey(variant.binding)}`, time, frames: variant.frames });
    variant.previous = result.value;
    variant.baseline = true;
  }

  async subscribeShared(subscription, listener) {
    const key = marketSubscriptionKey(subscription);
    let channel = this.channels.get(key);
    if (!channel) {
      channel = { listeners: new Set(), dispose: null };
      this.channels.set(key, channel);
      channel.dispose = await this.dataHub.subscribe(subscription, (event) => {
        for (const current of channel.listeners) current(event);
      });
    }
    channel.listeners.add(listener);
    return async () => {
      channel.listeners.delete(listener);
      if (!channel.listeners.size) {
        await channel.dispose?.();
        this.channels.delete(key);
      }
    };
  }

  enqueue(task) {
    const operation = this.queue.then(task);
    this.queue = operation.catch(() => {});
    return operation;
  }

  async processEvent(alertId, event) {
    const runtime = this.runtimes.get(alertId);
    if (!runtime || this.suspension || runtime.processed.has(event.eventId)) return;
    runtime.processed.add(event.eventId);
    if (runtime.processed.size > 5_000) runtime.processed.delete(runtime.processed.values().next().value);
    let storeAlert = runtime.alert;
    if (!storeAlert?.enabled) return;
    for (const variant of runtime.variants) {
      let affected = false;
      for (const [contextId, choice] of Object.entries(variant.binding)) {
        if (choice.marketId !== event.marketId || choice.interval !== event.interval) continue;
        const frame = variant.frames[contextId];
        const index = frame.candles.findIndex((candle) => candle.time === event.candle.time);
        if (index >= 0) frame.candles[index] = event.candle; else frame.candles.push(event.candle);
        frame.candles.sort((a, b) => a.time - b.time);
        frame.candles = frame.candles.slice(-this.historyLimit);
        Object.assign(frame, { closed: event.closed, coverage: event.coverage, source: event.source, receivedAt: event.receivedAt });
        affected = true;
      }
      if (!affected) continue;
      const result = variant.evaluator.evaluate(storeAlert.rule, { eventId: `${event.eventId}:${bindingKey(variant.binding)}`, time: event.receivedAt, frames: variant.frames });
      const previous = variant.previous;
      variant.previous = result.value;
      if (!variant.baseline) { variant.baseline = true; continue; }
      const policy = storeAlert.rule.triggerPolicy;
      const cooldownReady = !storeAlert.lastTriggeredAt || event.receivedAt - storeAlert.lastTriggeredAt >= (policy.cooldownMs || 0);
      const maxReady = !policy.maxTriggersTotal || storeAlert.triggerCount < policy.maxTriggersTotal;
      const dayStart = new Date(event.receivedAt); dayStart.setUTCHours(0, 0, 0, 0);
      const dailyCount = policy.maxTriggersPerDay
        ? (await this.store.listEvidence({ alertId })).filter((entry) => entry.triggeredAt >= dayStart.getTime()).length
        : 0;
      const dailyReady = !policy.maxTriggersPerDay || dailyCount < policy.maxTriggersPerDay;
      const edgeReady = previous === false && result.value === true;
      const nextBarReady = policy.rearm === "next_bar" && result.value === true && event.closed === true
        && (!storeAlert.lastTriggeredAt || event.candle.closeTime > storeAlert.lastTriggeredAt);
      const cooldownRearmReady = policy.rearm === "after_cooldown" && result.value === true && cooldownReady;
      const shouldTrigger = (edgeReady || nextBarReady || cooldownRearmReady) && cooldownReady && maxReady && dailyReady
        && storeAlert.rearmState !== "waiting_false";
      if ((storeAlert.status === "triggered" || storeAlert.status === "cooling_down") && cooldownReady && !shouldTrigger) {
        storeAlert = await this.store.updateAlert(alertId, { status: "monitoring", rearmState: storeAlert.rearmState === "cooldown" ? "armed" : storeAlert.rearmState, lastEvaluatedAt: event.receivedAt });
      }
      if (storeAlert.rearmState === "waiting_false" && result.value === false) {
        storeAlert = await this.store.updateAlert(alertId, { status: "monitoring", rearmState: "armed", lastEvaluatedAt: event.receivedAt });
      }
      if (shouldTrigger) {
        const appended = await this.store.appendEvidence(evidenceFromResult(storeAlert, variant, result, event));
        storeAlert = await this.store.getAlert(alertId);
        if (appended.created && !this.shadowMode) await this.notify({ alert: storeAlert, evidence: appended.evidence, deepLink: `haolo://alerts/${alertId}/evidence/${appended.evidence.evidenceId}` });
        if (!storeAlert.enabled) break;
      }
    }
    runtime.alert = storeAlert;
    this.scheduleRuntimePersist(runtime);
  }

  scheduleRuntimePersist(runtime) {
    this.dirtyRuntimeIds.add(runtime.alert.alertId);
    if (this.runtimeFlushTimer) return;
    this.runtimeFlushTimer = setTimeout(() => {
      this.runtimeFlushTimer = null;
      void this.flushRuntimeStates().catch(() => {});
    }, this.runtimeFlushMs);
    this.runtimeFlushTimer.unref?.();
  }

  async flushRuntimeStates() {
    const ids = [...this.dirtyRuntimeIds];
    this.dirtyRuntimeIds.clear();
    for (const alertId of ids) {
      const runtime = this.runtimes.get(alertId);
      if (runtime) await this.persistRuntime(runtime);
    }
  }

  async suspend(reason = "unknown", { preserveSubscriptions = false } = {}) {
    if (!this.started || this.suspension) return this.status();
    const allowed = new Set(["system_sleep", "network_offline", "provider_disconnected", "unknown"]);
    const normalizedReason = allowed.has(reason) ? reason : "unknown";
    const startedAt = this.now();
    const alertSnapshots = [...this.runtimes.values()].map((runtime) => ({
      alertId: runtime.alert.alertId,
      lastGoodEventAt: runtime.alert.lastEvaluatedAt || undefined,
    }));
    await this.flushRuntimeStates();
    for (const { alertId } of alertSnapshots) {
      if (!preserveSubscriptions) await this.disarm(alertId, { updateStore: false });
      await this.store.updateAlert(alertId, { status: "reconnecting", failure: null });
    }
    if (!preserveSubscriptions) this.dataHub.clearHistory?.();
    this.suspension = { reason: normalizedReason, startedAt, alertSnapshots, preserveSubscriptions };
    return this.status();
  }

  async resumeMonitoring(reason) {
    if (!this.started || !this.suspension) return this.status();
    const suspension = this.suspension;
    if (reason && suspension.reason !== reason && suspension.reason !== "unknown") return this.status();
    this.suspension = null;
    const resumedAt = this.now();
    if (suspension.preserveSubscriptions) {
      for (const { alertId } of suspension.alertSnapshots) await this.disarm(alertId, { updateStore: false });
      this.dataHub.clearHistory?.();
    }
    const rearmAlertIds = [];
    for (const item of suspension.alertSnapshots) {
      const alert = await this.store.getAlert(item.alertId);
      if (!alert?.enabled || alert.status === "completed") continue;
      await this.store.appendGap({
        gapId: `gap-${item.alertId}-${suspension.startedAt}`,
        alertId: item.alertId,
        startedAt: suspension.startedAt,
        endedAt: resumedAt,
        reason: suspension.reason,
        ...(item.lastGoodEventAt ? { lastGoodEventAt: Math.min(item.lastGoodEventAt, resumedAt) } : {}),
        resumedAt,
        catchUpEvaluated: false,
      });
      rearmAlertIds.push(item.alertId);
    }
    await Promise.all(rearmAlertIds.map((alertId) => this.armWithRecovery(alertId)));
    return this.status();
  }

  async persistRuntime(runtime) {
    const variants = {};
    for (const variant of runtime.variants) variants[bindingKey(variant.binding)] = { previous: variant.previous, evaluator: variant.evaluator.exportState() };
    await this.store.setRuntimeState(runtime.alert.alertId, { schemaVersion: 1, variants, savedAt: this.now() });
  }

  async pause(alertId, reason = "用户暂停") {
    await this.disarm(alertId, { updateStore: false });
    return await this.store.updateAlert(alertId, { enabled: false, status: "paused", failure: reason });
  }

  syncDrawings(drawings = []) {
    for (const key of Object.keys(this.drawings)) delete this.drawings[key];
    for (const drawing of drawings) this.drawings[drawing.drawingId] = Object.freeze(structuredClone(drawing));
    return Object.freeze({ count: Object.keys(this.drawings).length });
  }

  async resume(alertId) {
    const alert = await this.store.updateAlert(alertId, { enabled: true, status: "arming", failure: null });
    return (await this.armWithRecovery(alert.alertId)).alert;
  }

  async disarm(alertId, { updateStore = false, clearRetry = true } = {}) {
    if (clearRetry) this.clearArmRetry(alertId);
    const runtime = this.runtimes.get(alertId);
    if (runtime) {
      await Promise.allSettled(runtime.disposers.map((dispose) => dispose()));
      this.runtimes.delete(alertId);
    }
    if (updateStore) return await this.store.updateAlert(alertId, { enabled: false, status: "paused" });
    return null;
  }

  async shutdown() {
    if (!this.started) return;
    clearInterval(this.heartbeatTimer);
    this.disposeHealthListener?.();
    this.disposeHealthListener = null;
    clearTimeout(this.runtimeFlushTimer);
    this.runtimeFlushTimer = null;
    for (const alertId of [...this.armRetryTimers.keys()]) this.clearArmRetry(alertId);
    await this.flushRuntimeStates();
    for (const alertId of [...this.runtimes.keys()]) await this.disarm(alertId, { updateStore: false });
    await this.store.writeShutdown(this.now());
    this.started = false;
  }

  status() {
    return Object.freeze({ running: this.started, suspended: Boolean(this.suspension), shadowMode: this.shadowMode, alerts: this.runtimes.size, subscriptions: this.channels.size });
  }
}
