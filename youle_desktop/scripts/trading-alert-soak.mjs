import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createBinanceMarketAdapter } from "../src/main/trading-alerts/binance-market-adapter.mjs";
import { TradingAlertEngine } from "../src/main/trading-alerts/engine.mjs";
import { createHyperliquidMarketAdapter } from "../src/main/trading-alerts/hyperliquid-market-adapter.mjs";
import { TradingAlertMarketDataHub } from "../src/main/trading-alerts/market-data-hub.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { createInitialAlertInstance } from "../src/main/trading-alerts/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOUR = 3_600_000;

export function parseSoakOptions(argv = []) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new TypeError(`未知参数：${token}`);
    const [name, inline] = token.slice(2).split("=", 2);
    const value = inline ?? argv[++index];
    if (value === undefined || value.startsWith("--")) throw new TypeError(`参数 --${name} 缺少值`);
    values.set(name, value);
  }
  const provider = String(values.get("provider") || "hyperliquid").toLowerCase();
  if (!new Set(["hyperliquid", "binance", "synthetic"]).has(provider)) throw new TypeError(`不支持的 provider：${provider}`);
  const durationMs = Number(values.get("duration-ms") || 24 * HOUR);
  const sampleMs = Number(values.get("sample-ms") || 60_000);
  const alerts = Number(values.get("alerts") || 100);
  if (!Number.isFinite(durationMs) || durationMs < 1_000 || durationMs > 7 * 24 * HOUR) throw new TypeError("duration-ms 必须在 1 秒到 7 天之间");
  if (!Number.isFinite(sampleMs) || sampleMs < 250 || sampleMs > HOUR) throw new TypeError("sample-ms 必须在 250ms 到 1h 之间");
  if (!Number.isInteger(alerts) || alerts < 1 || alerts > 1_000) throw new TypeError("alerts 必须是 1..1000 的整数");
  const defaults = provider === "hyperliquid"
    ? { marketId: "HYPERLIQUID:PERPETUAL:BTC", interval: "1m" }
    : { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1m" };
  return Object.freeze({
    provider,
    providerId: provider === "hyperliquid" ? "hyperliquid-public" : "binance-public",
    marketId: String(values.get("market") || defaults.marketId).toUpperCase(),
    interval: String(values.get("interval") || defaults.interval),
    durationMs,
    sampleMs,
    alerts,
    output: path.resolve(values.get("output") || path.join(ROOT, ".tmp", "trading-alert-soak")),
  });
}

export function summarizeSoakSamples(samples, durationMs) {
  if (!Array.isArray(samples) || !samples.length) return Object.freeze({ sampleCount: 0, heapSlopeMiBPerHour: 0, rssSlopeMiBPerHour: 0 });
  const slope = (field) => {
    if (samples.length < 2) return 0;
    const xs = samples.map((sample) => (sample.elapsedMs - samples[0].elapsedMs) / HOUR);
    const ys = samples.map((sample) => Number(sample[field]) / 1024 / 1024);
    const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
    const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
    const denominator = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
    return denominator ? xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0) / denominator : 0;
  };
  const values = (field) => samples.map((sample) => Number(sample[field]));
  return Object.freeze({
    sampleCount: samples.length,
    observedDurationMs: durationMs,
    heapSlopeMiBPerHour: Number(slope("heapUsed").toFixed(4)),
    rssSlopeMiBPerHour: Number(slope("rss").toFixed(4)),
    heapMinMiB: Number((Math.min(...values("heapUsed")) / 1024 / 1024).toFixed(2)),
    heapMaxMiB: Number((Math.max(...values("heapUsed")) / 1024 / 1024).toFixed(2)),
    rssMinMiB: Number((Math.min(...values("rss")) / 1024 / 1024).toFixed(2)),
    rssMaxMiB: Number((Math.max(...values("rss")) / 1024 / 1024).toFixed(2)),
  });
}

class SoakStore {
  constructor(alerts) {
    this.alerts = new Map(alerts.map((entry) => [entry.alertId, entry]));
    this.states = new Map();
    this.evidence = [];
    this.evidenceKeys = new Set();
    this.gaps = [];
    this.lastHeartbeatAt = null;
    this.lastShutdownAt = null;
  }
  async load() { return { alerts: structuredClone([...this.alerts.values()]), metadata: { lastHeartbeatAt: this.lastHeartbeatAt, lastShutdownAt: this.lastShutdownAt } }; }
  async getAlert(id) { return structuredClone(this.alerts.get(id) || null); }
  async updateAlert(id, patch) { const current = this.alerts.get(id); const next = { ...current, ...structuredClone(patch), updatedAt: Math.max(Date.now(), current.createdAt) }; this.alerts.set(id, next); return structuredClone(next); }
  async getRuntimeState(id) { return structuredClone(this.states.get(id) || null); }
  async setRuntimeState(id, value) { this.states.set(id, structuredClone(value)); return value; }
  async listEvidence({ alertId } = {}) { return structuredClone(alertId ? this.evidence.filter((entry) => entry.alertId === alertId) : this.evidence); }
  async appendEvidence(value) { const key = `${value.alertId}|${value.triggerEventId}`; if (this.evidenceKeys.has(key)) return { evidence: value, created: false }; this.evidenceKeys.add(key); this.evidence.push(structuredClone(value)); return { evidence: value, created: true }; }
  async appendGap(value) { this.gaps.push(structuredClone(value)); return value; }
  async writeHeartbeat(value) { this.lastHeartbeatAt = value; }
  async writeShutdown(value) { this.lastShutdownAt = value; }
}

class SyntheticAdapter {
  constructor() { this.providerId = "binance-public"; this.sequence = 0; }
  async loadHistory() { const now = Date.now(); return Array.from({ length: 60 }, (_, index) => this.candle(now - (60 - index) * 60_000, 60_000 + index)); }
  candle(time, close) { return { time, closeTime: time + 60_000, open: close - 1, high: close + 2, low: close - 2, close, volume: 100 }; }
  async subscribe(_subscription, onEvent, onHealth) {
    onHealth({ status: "connected", at: Date.now() });
    const timer = setInterval(() => {
      const time = Date.now(); const close = 60_000 + (this.sequence++ % 20);
      onEvent({ eventId: `synthetic-${this.sequence}`, candle: this.candle(time, close), closed: this.sequence % 4 === 0, eventTime: time, receivedAt: time, coverage: "available", source: "soak-synthetic" });
    }, 250);
    return async () => clearInterval(timer);
  }
}

function soakRule(index, options) {
  return normalizeAlertRule({
    schemaVersion: 1,
    ruleId: `soak-rule-${index}`,
    revision: 1,
    title: `24h soak ${index + 1}`,
    root: { type: "condition", condition: { conditionId: "never-trigger", contextId: "primary", operator: "gt", left: { type: "field", field: "close" }, right: { type: "constant", value: 1_000_000_000 }, confirmation: "intrabar" } },
    contexts: [{ contextId: "primary", marketSelector: { kind: "fixed", marketIds: [options.marketId] }, intervals: [options.interval] }],
    evaluationPolicy: { clock: "bar_update", anchorContextId: "primary", joinMode: "latest_closed", maxDataAgeMs: 300_000, unknownPolicy: "do_not_trigger" },
    triggerPolicy: { mode: "repeat", edge: "false_to_true", rearm: "must_become_false", resumePolicy: "baseline_only_no_catch_up" },
    dataRequirements: [], sourceText: "24h stability soak", normalizedSummary: "长稳验收专用，不应触发", createdAt: Date.now(),
  });
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function markdown(report) {
  return `# Trading Alert 真实长稳报告\n\n- 状态：${report.status}\n- Provider：${report.options.provider}\n- 市场 / 周期：${report.options.marketId} / ${report.options.interval}\n- 预警数：${report.options.alerts}\n- 开始：${report.startedAt}\n- 结束：${report.endedAt || "运行中"}\n- 墙钟时长：${Math.round(report.elapsedMs / 1000)} 秒（目标 ${Math.round(report.options.durationMs / 1000)} 秒）\n- 行情接收 / 发出：${report.hub?.received || 0} / ${report.hub?.emitted || 0}\n- 重复行情 / 迟到 / 缺口：${report.hub?.duplicates || 0} / ${report.hub?.late || 0} / ${report.hub?.gaps || 0}\n- 物理订阅：${report.hub?.subscriptions || 0}\n- Evidence / 重复 Evidence：${report.evidence || 0} / ${report.duplicateEvidence || 0}\n- MonitoringGap：${report.monitoringGaps || 0}\n- Heap 斜率：${report.resources?.heapSlopeMiBPerHour || 0} MiB/h\n- RSS 斜率：${report.resources?.rssSlopeMiBPerHour || 0} MiB/h\n- 错误：${report.error || "无"}\n`;
}

export async function runSoak(options) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const reportPath = path.join(options.output, `${runId}.json`);
  const runningPath = path.join(options.output, "current.json");
  const markdownPath = path.join(options.output, `${runId}.md`);
  const rules = Array.from({ length: options.alerts }, (_, index) => soakRule(index, options));
  const alerts = rules.map((rule, index) => createInitialAlertInstance({ alertId: `soak-alert-${index}`, draftId: `soak-draft-${index}`, rule, simulationId: `soak-simulation-${index}`, confirmationId: `soak-confirmation-${index}`, now: Date.now() }));
  const store = new SoakStore(alerts);
  const adapter = options.provider === "synthetic" ? new SyntheticAdapter() : options.provider === "binance" ? createBinanceMarketAdapter() : createHyperliquidMarketAdapter();
  const hub = new TradingAlertMarketDataHub({ historyLimit: 1_500 }); hub.registerAdapter(adapter);
  let notifications = 0;
  const engine = new TradingAlertEngine({ store, dataHub: hub, heartbeatMs: 10_000, runtimeFlushMs: 1_000, notify: async () => { notifications += 1; } });
  const started = Date.now(); const cpuStart = process.cpuUsage(); const performanceStart = performance.now(); const samples = [];
  let status = "running"; let error = null; let sampleTimer = null;
  const snapshot = () => {
    globalThis.gc?.();
    const memory = process.memoryUsage(); const cpu = process.cpuUsage(cpuStart); const elapsedMs = Date.now() - started;
    const sample = { at: new Date().toISOString(), elapsedMs, heapUsed: memory.heapUsed, rss: memory.rss, external: memory.external, cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, hub: hub.stats(), evidence: store.evidence.length, gaps: store.gaps.length };
    samples.push(sample); return sample;
  };
  const buildReport = () => {
    const elapsedMs = Date.now() - started;
    const evidenceKeys = store.evidence.map((entry) => `${entry.alertId}|${entry.triggerEventId}`);
    return { schemaVersion: 1, runId, processId: process.pid, status, startedAt: new Date(started).toISOString(), checkpointedAt: new Date().toISOString(), endedAt: status === "running" ? null : new Date().toISOString(), elapsedMs, performanceElapsedMs: Number((performance.now() - performanceStart).toFixed(2)), options, hub: hub.stats(), notifications, evidence: store.evidence.length, duplicateEvidence: evidenceKeys.length - new Set(evidenceKeys).size, monitoringGaps: store.gaps.length, resources: summarizeSoakSamples(samples, elapsedMs), samples, error };
  };
  const checkpoint = async () => atomicJson(runningPath, buildReport());
  try {
    await engine.start(); snapshot(); await checkpoint();
    sampleTimer = setInterval(() => { snapshot(); void checkpoint().catch(() => {}); }, options.sampleMs);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, options.durationMs);
      const stop = (signal) => { clearTimeout(timer); status = `stopped:${signal}`; resolve(); };
      process.once("SIGINT", () => stop("SIGINT")); process.once("SIGTERM", () => stop("SIGTERM"));
      engine.queue.catch(reject);
    });
    if (status === "running") status = "passed";
  } catch (value) {
    status = "failed"; error = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  } finally {
    clearInterval(sampleTimer); snapshot();
    await engine.shutdown().catch((value) => { error ||= String(value); status = "failed"; });
    await hub.close().catch((value) => { error ||= String(value); status = "failed"; });
  }
  const report = buildReport();
  await atomicJson(reportPath, report); await atomicJson(runningPath, report); await writeFile(markdownPath, markdown(report), "utf8");
  return Object.freeze({ report, reportPath, markdownPath });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseSoakOptions(process.argv.slice(2));
  const result = await runSoak(options);
  process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, markdownPath: result.markdownPath, status: result.report.status, elapsedMs: result.report.elapsedMs }, null, 2)}\n`);
  if (result.report.status !== "passed" || result.report.duplicateEvidence !== 0 || result.report.notifications !== result.report.evidence) process.exitCode = 1;
}
