import { TradingAlertError } from "./errors.mjs";

function text(value, field, max = 160) {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new TypeError(`${field} is invalid`);
  return result;
}

export function normalizeMarketDataSubscription(value = {}) {
  return Object.freeze({
    providerId: text(value.providerId || "binance-public", "providerId").toLowerCase(),
    marketId: text(value.marketId, "marketId").toUpperCase(),
    interval: text(value.interval, "interval", 32).toLowerCase(),
    fields: Object.freeze([...new Set((Array.isArray(value.fields) ? value.fields : ["ohlcv"]).map((entry) => text(entry, "field")))]),
  });
}

export function marketSubscriptionKey(value) {
  const item = normalizeMarketDataSubscription(value);
  return `${item.providerId}|${item.marketId}|${item.interval}|${item.fields.join(",")}`;
}

function intervalMs(interval) {
  const match = /^(\d+)(s|m|h|d|w)$/i.exec(String(interval || ""));
  if (!match) return 0;
  return Number(match[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase()];
}

function normalizeCandle(value, field = "candle") {
  const candle = {
    time: Math.floor(Number(value?.time)),
    closeTime: Math.floor(Number(value?.closeTime ?? value?.time)),
    open: Number(value?.open), high: Number(value?.high), low: Number(value?.low), close: Number(value?.close),
    volume: Math.max(0, Number(value?.volume || 0)),
  };
  if (![candle.time, candle.closeTime, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    || candle.time <= 0 || candle.closeTime < candle.time || candle.low <= 0
    || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
    throw new TradingAlertError(`${field} is invalid`, { code: "TRADING_ALERT_MARKET_DATA_INVALID", category: "protocol" });
  }
  return Object.freeze(candle);
}

export function normalizeMarketDataEvent(value = {}) {
  const subscription = normalizeMarketDataSubscription(value);
  const candle = normalizeCandle(value.candle);
  return Object.freeze({
    ...subscription,
    eventId: text(value.eventId || `${subscription.marketId}:${subscription.interval}:${candle.closeTime}:${value.closed ? "close" : "update"}`, "eventId", 240),
    eventTime: Math.floor(Number(value.eventTime || candle.closeTime)),
    receivedAt: Math.floor(Number(value.receivedAt || Date.now())),
    candle,
    closed: value.closed === true,
    source: text(value.source || subscription.providerId, "source"),
    coverage: ["available", "delayed", "partial", "unavailable"].includes(value.coverage) ? value.coverage : "available",
  });
}

export class TradingAlertMarketDataHub {
  constructor({ historyLimit = 1_500 } = {}) {
    this.adapters = new Map();
    this.channels = new Map();
    this.history = new Map();
    this.historyInflight = new Map();
    this.historyGeneration = new Map();
    this.historyLimit = Math.max(100, Number(historyLimit) || 1_500);
    this.seenEventIds = new Set();
    this.closedBars = new Set();
    this.latestEventTime = new Map();
    this.healthByChannel = new Map();
    this.healthListeners = new Set();
    this.metrics = { received: 0, emitted: 0, duplicates: 0, late: 0, gaps: 0, historyLoads: 0, historyCoalesced: 0 };
  }

  registerAdapter(adapter) {
    const id = text(adapter?.providerId, "providerId").toLowerCase();
    if (typeof adapter.subscribe !== "function" || typeof adapter.loadHistory !== "function") throw new TypeError(`Market adapter ${id} must implement subscribe() and loadHistory()`);
    if (this.adapters.has(id)) throw new TypeError(`Duplicate market adapter: ${id}`);
    this.adapters.set(id, adapter);
    return adapter;
  }

  async loadHistory(subscriptionValue, limit = 500) {
    const subscription = normalizeMarketDataSubscription(subscriptionValue);
    const key = marketSubscriptionKey(subscription);
    const requestedLimit = Math.min(this.historyLimit, Math.max(2, Number(limit) || 500));
    const cached = this.history.get(key);
    if (cached?.length) return structuredClone(cached.slice(-requestedLimit));
    const pending = this.historyInflight.get(key);
    if (pending) {
      this.metrics.historyCoalesced += 1;
      const rows = await pending.promise;
      if (pending.limit >= requestedLimit || rows.length >= requestedLimit) {
        return structuredClone(rows.slice(-requestedLimit));
      }
    }
    const adapter = this.adapters.get(subscription.providerId);
    if (!adapter) throw new TradingAlertError(`行情 Provider 不可用：${subscription.providerId}`, { code: "TRADING_ALERT_MARKET_PROVIDER_UNAVAILABLE", category: "provider" });
    const generation = Number(this.historyGeneration.get(key) || 0);
    const operation = {
      limit: requestedLimit,
      promise: Promise.resolve().then(async () => {
        this.metrics.historyLoads += 1;
        const rows = await adapter.loadHistory(subscription, requestedLimit);
        const normalized = rows.map((row, index) => normalizeCandle(row, `history[${index}]`)).sort((a, b) => a.time - b.time);
        const retained = normalized.slice(-this.historyLimit);
        if (Number(this.historyGeneration.get(key) || 0) === generation) this.history.set(key, retained);
        return retained;
      }),
    };
    this.historyInflight.set(key, operation);
    try {
      return structuredClone((await operation.promise).slice(-requestedLimit));
    } finally {
      if (this.historyInflight.get(key) === operation) this.historyInflight.delete(key);
    }
  }

  seedHistory(subscriptionValue, rows = []) {
    const subscription = normalizeMarketDataSubscription(subscriptionValue);
    const key = marketSubscriptionKey(subscription);
    const normalized = (Array.isArray(rows) ? rows : [])
      .map((row, index) => normalizeCandle(row, `seedHistory[${index}]`));
    const mergedByTime = new Map((this.history.get(key) || []).map((row) => [row.time, row]));
    for (const row of normalized) mergedByTime.set(row.time, row);
    const merged = [...mergedByTime.values()].sort((left, right) => left.time - right.time).slice(-this.historyLimit);
    if (merged.length) this.history.set(key, merged);
    return structuredClone(merged);
  }

  async subscribe(subscriptionValue, listener) {
    const subscription = normalizeMarketDataSubscription(subscriptionValue);
    const key = marketSubscriptionKey(subscription);
    let channel = this.channels.get(key);
    if (!channel) {
      const adapter = this.adapters.get(subscription.providerId);
      if (!adapter) throw new TradingAlertError(`行情 Provider 不可用：${subscription.providerId}`, { code: "TRADING_ALERT_MARKET_PROVIDER_UNAVAILABLE", category: "provider" });
      channel = { subscription, listeners: new Set(), dispose: null };
      this.channels.set(key, channel);
      channel.dispose = await adapter.subscribe(subscription, (event) => this.ingest({ ...event, ...subscription }), (health) => this.reportHealth(key, subscription, health));
    }
    channel.listeners.add(listener);
    return async () => {
      channel.listeners.delete(listener);
      if (!channel.listeners.size) {
        await channel.dispose?.();
        this.channels.delete(key);
        this.healthByChannel.delete(key);
      }
    };
  }

  ingest(value) {
    let event = normalizeMarketDataEvent(value);
    const key = marketSubscriptionKey(event);
    this.metrics.received += 1;
    const closedKey = `${key}|${event.candle.time}`;
    if (this.seenEventIds.has(event.eventId) || (event.closed && this.closedBars.has(closedKey))) {
      this.metrics.duplicates += 1;
      return event;
    }
    this.seenEventIds.add(event.eventId);
    if (this.seenEventIds.size > 20_000) this.seenEventIds.delete(this.seenEventIds.values().next().value);
    if (event.closed) {
      this.closedBars.add(closedKey);
      if (this.closedBars.size > 20_000) this.closedBars.delete(this.closedBars.values().next().value);
    }
    const latestTime = Number(this.latestEventTime.get(key) || 0);
    if (latestTime && event.eventTime < latestTime) {
      this.metrics.late += 1;
      event = Object.freeze({ ...event, coverage: "delayed" });
    }
    const rows = this.history.get(key) || [];
    const previousLast = rows.at(-1);
    const stepMs = intervalMs(event.interval);
    if (previousLast && stepMs && event.candle.time > previousLast.time + stepMs) {
      this.metrics.gaps += 1;
      event = Object.freeze({ ...event, coverage: "partial" });
    }
    const existingIndex = rows.findIndex((row) => row.time === event.candle.time);
    if (existingIndex >= 0) rows[existingIndex] = event.candle; else rows.push(event.candle);
    rows.sort((a, b) => a.time - b.time);
    this.history.set(key, rows.slice(-this.historyLimit));
    this.latestEventTime.set(key, Math.max(latestTime, event.eventTime));
    const channel = this.channels.get(key);
    for (const listener of channel?.listeners || []) listener(event);
    this.metrics.emitted += 1;
    return event;
  }

  snapshot(subscriptionValue) {
    return structuredClone(this.history.get(marketSubscriptionKey(subscriptionValue)) || []);
  }

  clearHistory(subscriptionValue) {
    if (subscriptionValue) {
      const key = marketSubscriptionKey(subscriptionValue);
      this.history.delete(key);
      this.historyGeneration.set(key, Number(this.historyGeneration.get(key) || 0) + 1);
    } else {
      this.history.clear();
      for (const key of new Set([...this.historyGeneration.keys(), ...this.historyInflight.keys()])) {
        this.historyGeneration.set(key, Number(this.historyGeneration.get(key) || 0) + 1);
      }
    }
  }

  onHealth(listener) {
    this.healthListeners.add(listener);
    return () => this.healthListeners.delete(listener);
  }

  reportHealth(key, subscription, value = {}) {
    const status = ["connected", "reconnecting", "disconnected"].includes(value.status) ? value.status : "disconnected";
    const record = Object.freeze({ providerId: subscription.providerId, marketId: subscription.marketId, interval: subscription.interval, status, at: Math.floor(Number(value.at || Date.now())), reason: String(value.reason || "") });
    this.healthByChannel.set(key, record);
    const allHealthy = [...this.healthByChannel.values()].every((entry) => entry.status === "connected");
    for (const listener of this.healthListeners) listener(Object.freeze({ ...record, allHealthy }));
  }

  stats() {
    return Object.freeze({ adapters: this.adapters.size, subscriptions: this.channels.size, cachedSeries: this.history.size, inflightHistoryLoads: this.historyInflight.size, healthySubscriptions: [...this.healthByChannel.values()].filter((entry) => entry.status === "connected").length, ...this.metrics });
  }

  async close() {
    const disposers = [...this.channels.values()].map((channel) => channel.dispose?.());
    this.channels.clear();
    this.healthByChannel.clear();
    await Promise.allSettled(disposers);
  }
}
