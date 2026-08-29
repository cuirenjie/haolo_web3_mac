import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { TradingAlertMarketDataHub } from "../src/main/trading-alerts/market-data-hub.mjs";
import { TradingAlertEngine } from "../src/main/trading-alerts/engine.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { createInitialAlertInstance } from "../src/main/trading-alerts/store.mjs";

const START = 1_786_464_000_000;
const template = JSON.parse(await readFile(new URL("../test/fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url), "utf8"));

function candle(close, index) {
  const time = START + index * 3_600_000;
  return { time, closeTime: time + 3_600_000, open: close, high: close + 1, low: close - 1, close, volume: 100 };
}

function benchmarkRule(index) {
  return normalizeAlertRule({
    ...template,
    ruleId: `benchmark-rule-${index}`,
    title: `Benchmark ${index}`,
    contexts: [{ contextId: "primary", marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] }, intervals: ["1h"] }],
    evaluationPolicy: { ...template.evaluationPolicy, clock: "bar_close", maxDataAgeMs: 7_200_000 },
    root: { type: "condition", condition: { conditionId: "price", contextId: "primary", operator: "gt", left: { type: "field", field: "close" }, right: { type: "constant", value: 1_000_000 }, confirmation: "bar_close" } },
    triggerPolicy: { mode: "repeat", edge: "false_to_true", rearm: "must_become_false", resumePolicy: "baseline_only_no_catch_up" },
    dataRequirements: [],
    sourceText: "benchmark",
    normalizedSummary: "benchmark",
    ruleHash: undefined,
  });
}

class MemoryStore {
  constructor(alerts) { this.alerts = new Map(alerts.map((entry) => [entry.alertId, entry])); this.states = new Map(); this.evidence = []; this.gaps = []; }
  async load() { return { alerts: [...this.alerts.values()], metadata: {} }; }
  async getAlert(id) { return structuredClone(this.alerts.get(id) || null); }
  async updateAlert(id, patch) { const next = { ...this.alerts.get(id), ...patch, updatedAt: Math.max(Date.now(), this.alerts.get(id).createdAt) }; this.alerts.set(id, next); return structuredClone(next); }
  async getRuntimeState(id) { return structuredClone(this.states.get(id) || null); }
  async setRuntimeState(id, value) { this.states.set(id, structuredClone(value)); return value; }
  async listEvidence({ alertId } = {}) { return structuredClone(alertId ? this.evidence.filter((entry) => entry.alertId === alertId) : this.evidence); }
  async appendEvidence(value) { this.evidence.push(value); return { evidence: value, created: true }; }
  async appendGap(value) { this.gaps.push(value); return value; }
  async writeHeartbeat() {}
  async writeShutdown() {}
}

class BenchmarkAdapter {
  constructor() { this.providerId = "binance-public"; this.listener = null; this.subscribeCalls = 0; this.historyCalls = 0; }
  async loadHistory() { this.historyCalls += 1; return [candle(100, 0), candle(101, 1)]; }
  async subscribe(_subscription, listener) { this.subscribeCalls += 1; this.listener = listener; return async () => { this.listener = null; }; }
  emit(index) { const row = candle(100 + (index % 10), index + 2); this.listener?.({ eventId: `soak-${index}`, eventTime: row.closeTime, receivedAt: row.closeTime, candle: row, closed: true, source: "benchmark", coverage: "available" }); }
}

const rules = Array.from({ length: 100 }, (_, index) => benchmarkRule(index));
const alerts = rules.map((rule, index) => createInitialAlertInstance({
  alertId: `benchmark-alert-${index}`, draftId: `benchmark-draft-${index}`, rule,
  simulationId: `benchmark-simulation-${index}`, confirmationId: `benchmark-confirmation-${index}`, now: START,
}));
const store = new MemoryStore(alerts);
const adapter = new BenchmarkAdapter();
const hub = new TradingAlertMarketDataHub({ historyLimit: 2_000 }); hub.registerAdapter(adapter);
const engine = new TradingAlertEngine({ store, dataHub: hub, now: () => Date.now(), heartbeatMs: 3_600_000, runtimeFlushMs: 60_000 });
globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const startMs = performance.now();
await engine.start();
const startupMs = performance.now() - startMs;
const latencies = [];
for (let index = 0; index < 24; index += 1) {
  const began = performance.now();
  adapter.emit(index);
  await engine.queue;
  latencies.push(performance.now() - began);
}
const burstEvents = 200;
const burstStarted = performance.now();
for (let index = 24; index < 24 + burstEvents; index += 1) adapter.emit(index);
await engine.queue;
const burstMs = performance.now() - burstStarted;
globalThis.gc?.();
const heapAfter = process.memoryUsage().heapUsed;
latencies.sort((a, b) => a - b);
const percentile = (value) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * value))];
const report = {
  generatedAt: new Date().toISOString(),
  scenario: "100 alerts, one market/interval, 24 closed bars (accelerated 24h at 1h)",
  alerts: 100,
  events: latencies.length,
  logicalEvaluations: 100 * latencies.length,
  burst: { events: burstEvents, logicalEvaluations: burstEvents * 100, durationMs: Number(burstMs.toFixed(2)), eventsPerSecond: Number((burstEvents * 1_000 / burstMs).toFixed(2)) },
  physicalSubscriptions: adapter.subscribeCalls,
  historyRequests: adapter.historyCalls,
  startupMs: Number(startupMs.toFixed(2)),
  eventLatencyMs: { p50: Number(percentile(0.5).toFixed(2)), p95: Number(percentile(0.95).toFixed(2)), max: Number(latencies.at(-1).toFixed(2)) },
  heapDeltaMiB: Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)),
  duplicateTriggers: store.evidence.length,
  hub: hub.stats(),
};
await engine.shutdown();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.physicalSubscriptions !== 1 || report.historyRequests !== 1 || report.duplicateTriggers !== 0 || report.eventLatencyMs.p95 >= 100) process.exitCode = 1;
