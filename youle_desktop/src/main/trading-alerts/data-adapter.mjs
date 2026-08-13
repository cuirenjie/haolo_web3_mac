import { TradingAlertError } from "./errors.mjs";

const MANIFEST_KEYS = new Set(["schemaVersion", "adapterId", "providerId", "displayName", "version", "capabilities", "markets", "intervals", "minFrequencyMs", "typicalLatencyMs", "historyLimit", "permissions", "rateLimit", "connectionState", "health", "setup"]);
const text = (value, field, max = 200) => {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new TradingAlertError(`${field} is invalid`, { code: "TRADING_ALERT_ADAPTER_MANIFEST_INVALID", category: "protocol" });
  return result;
};
const list = (value, field, max = 256) => {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new TradingAlertError(`${field} is invalid`, { code: "TRADING_ALERT_ADAPTER_MANIFEST_INVALID", category: "protocol" });
  return Object.freeze([...new Set(value.map((entry) => text(entry, field))) ]);
};

export function normalizeDataAdapterManifest(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TradingAlertError("adapter manifest must be an object", { code: "TRADING_ALERT_ADAPTER_MANIFEST_INVALID", category: "protocol" });
  for (const key of Object.keys(value)) if (!MANIFEST_KEYS.has(key)) throw new TradingAlertError(`adapter manifest contains unknown field: ${key}`, { code: "TRADING_ALERT_ADAPTER_MANIFEST_INVALID", category: "protocol" });
  if (Number(value.schemaVersion) !== 1) throw new TradingAlertError("unsupported adapter manifest schemaVersion", { code: "TRADING_ALERT_ADAPTER_VERSION_UNSUPPORTED", category: "protocol" });
  const rateLimit = value.rateLimit || {};
  const setup = value.setup || {};
  return Object.freeze({
    schemaVersion: 1,
    adapterId: text(value.adapterId, "adapterId").toLowerCase(),
    providerId: text(value.providerId, "providerId").toLowerCase(),
    displayName: text(value.displayName || value.providerId, "displayName"),
    version: text(value.version, "version", 40),
    capabilities: list(value.capabilities, "capabilities"),
    markets: list(value.markets || ["*"], "markets").map((entry) => entry.toUpperCase()),
    intervals: list(value.intervals || ["*"], "intervals", 64),
    minFrequencyMs: Math.max(1, Math.floor(Number(value.minFrequencyMs) || 1_000)),
    typicalLatencyMs: Math.max(0, Math.floor(Number(value.typicalLatencyMs) || 0)),
    historyLimit: Math.max(0, Math.floor(Number(value.historyLimit) || 0)),
    permissions: list(value.permissions || ["public"], "permissions", 32),
    rateLimit: Object.freeze({ requestsPerMinute: Math.max(1, Math.floor(Number(rateLimit.requestsPerMinute) || 60)), maxConnections: Math.max(1, Math.floor(Number(rateLimit.maxConnections) || 1)), maxSubscriptions: Math.max(1, Math.floor(Number(rateLimit.maxSubscriptions) || 1)) }),
    connectionState: ["connected", "disconnected", "degraded"].includes(value.connectionState) ? value.connectionState : "disconnected",
    health: ["healthy", "degraded", "offline", "unknown"].includes(value.health) ? value.health : "unknown",
    setup: Object.freeze({ route: text(setup.route || "settings/data-providers", "setup.route", 240), docsUrl: String(setup.docsUrl || "").slice(0, 1_000), requiresCredential: setup.requiresCredential === true, minimumScope: String(setup.minimumScope || "public/read-only").slice(0, 120) }),
  });
}

export function validateAdapterSamples(samples, { now = Date.now(), maxLatencyMs = 30_000 } = {}) {
  if (!Array.isArray(samples) || !samples.length) return Object.freeze({ valid: false, errors: ["没有可验证样本"], duplicateCount: 0, nullCount: 0, maxObservedLatencyMs: null });
  const errors = [];
  const ids = new Set();
  let duplicateCount = 0;
  let nullCount = 0;
  let maxObservedLatencyMs = 0;
  for (const [index, sample] of samples.entries()) {
    if (!sample || typeof sample !== "object") { errors.push(`sample[${index}] 不是对象`); continue; }
    const eventTime = Number(sample.eventTime);
    const receivedAt = Number(sample.receivedAt || now);
    if (!Number.isFinite(eventTime) || eventTime <= 0 || eventTime > receivedAt + 5_000) errors.push(`sample[${index}] 时间无效`);
    const latency = receivedAt - eventTime;
    if (Number.isFinite(latency)) maxObservedLatencyMs = Math.max(maxObservedLatencyMs, latency);
    if (latency > maxLatencyMs) errors.push(`sample[${index}] 延迟超限`);
    const id = String(sample.eventId || "");
    if (!id) errors.push(`sample[${index}] 缺少 eventId`); else if (ids.has(id)) duplicateCount += 1; else ids.add(id);
    for (const [field, value] of Object.entries(sample.fields || {})) if (value === null || value === undefined || !Number.isFinite(Number(value))) { nullCount += 1; errors.push(`sample[${index}].fields.${field} 无效`); }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), duplicateCount, nullCount, maxObservedLatencyMs });
}

export class TradingAlertDataAdapterRegistry {
  constructor() { this.records = new Map(); }
  register({ manifest, adapter = null, discoveredBy = "builtin" } = {}) {
    const normalized = normalizeDataAdapterManifest(manifest);
    if (this.records.has(normalized.adapterId)) throw new TradingAlertError(`duplicate adapter: ${normalized.adapterId}`, { code: "TRADING_ALERT_ADAPTER_DUPLICATE", category: "protocol" });
    const executable = Boolean(adapter && typeof adapter.loadHistory === "function" && typeof adapter.subscribe === "function");
    const record = Object.freeze({ manifest: normalized, adapter, discoveredBy: String(discoveredBy), installed: true, executable, connected: executable && normalized.connectionState === "connected" && normalized.health !== "offline" });
    this.records.set(normalized.adapterId, record);
    return record;
  }
  inventory() { return [...this.records.values()].map((record) => ({ ...record, adapter: undefined })); }
  executable(providerId) { return [...this.records.values()].find((record) => record.manifest.providerId === providerId && record.executable && record.connected)?.adapter || null; }
}

export function createMockExternalDataAdapter({ providerId = "mock-chain", field = "exchange_inflow" } = {}) {
  let listener = null;
  return Object.freeze({
    providerId,
    manifest: normalizeDataAdapterManifest({ schemaVersion: 1, adapterId: `${providerId}-adapter`, providerId, displayName: "Mock 外部数据", version: "1.0.0", capabilities: [`external.${field}`], markets: ["*"], intervals: ["1m"], minFrequencyMs: 1_000, typicalLatencyMs: 10, historyLimit: 100, permissions: ["public"], rateLimit: { requestsPerMinute: 1_000, maxConnections: 1, maxSubscriptions: 100 }, connectionState: "connected", health: "healthy", setup: { route: "settings/data-providers", requiresCredential: false } }),
    async loadHistory() { return []; },
    async subscribe(_subscription, onEvent) { listener = onEvent; return async () => { listener = null; }; },
    emit(value, eventTime = Date.now()) { listener?.({ eventId: `${providerId}:${field}:${eventTime}`, eventTime, receivedAt: eventTime, fields: { [field]: value } }); },
  });
}
