import { normalizeTradingAlertInterval } from "./interval.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  TRADING_ALERT_SCHEMA_VERSION,
  TRADING_ALERT_STORE_VERSION,
  normalizeAlertInstance,
  normalizeMonitoringGap,
  normalizeTriggerEvidence,
} from "./protocol.mjs";
import { TradingAlertError } from "./errors.mjs";

const STORE_FILE = "trading-alert-store.json";
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

function emptyData() {
  return {
    version: TRADING_ALERT_STORE_VERSION,
    alerts: [],
    evidence: [],
    simulations: [],
    gaps: [],
    drawings: [],
    events: [],
    runtimeStates: {},
    idempotencyKeys: [],
    metadata: { lastHeartbeatAt: null, lastShutdownAt: null },
  };
}

function boundedText(value, max = 1_000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeStoredDrawing(value = {}) {
  const drawingId = boundedText(value.drawingId, 160);
  const marketId = boundedText(value.marketId, 160).toUpperCase();
  const interval = normalizeTradingAlertInterval(boundedText(value.interval, 32));
  const geometryMode = ["segment", "ray", "extended"].includes(value.geometryMode) ? value.geometryMode : "segment";
  const points = (Array.isArray(value.points) ? value.points : []).slice(0, 16).map((point) => ({ time: Math.floor(Number(point?.time)), price: Number(point?.price) }));
  if (!drawingId || !marketId || !interval || points.length < 2 || points.some((point) => !Number.isFinite(point.time) || point.time <= 0 || !Number.isFinite(point.price) || point.price <= 0)) {
    throw new TradingAlertError("Drawing snapshot is invalid", { code: "TRADING_ALERT_DRAWING_INVALID", category: "protocol" });
  }
  return Object.freeze({ drawingId, marketId, interval, geometryMode, points: Object.freeze(points.map(Object.freeze)), revision: Math.max(1, Math.floor(Number(value.revision || value.drawingRevision) || 1)) });
}

function normalizeEvent(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TradingAlertError(`events[${index}] must be an object`, { code: "TRADING_ALERT_STORE_INVALID", category: "storage" });
  }
  const time = Number(value.time);
  if (!Number.isFinite(time) || time <= 0) {
    throw new TradingAlertError(`events[${index}].time must be valid`, { code: "TRADING_ALERT_STORE_INVALID", category: "storage" });
  }
  return Object.freeze({
    eventId: boundedText(value.eventId || `event-${randomUUID()}`, 160),
    type: boundedText(value.type, 120),
    time: Math.floor(time),
    alertId: value.alertId ? boundedText(value.alertId, 160) : null,
    draftId: value.draftId ? boundedText(value.draftId, 160) : null,
    traceId: value.traceId ? boundedText(value.traceId, 160) : null,
    payload: value.payload && typeof value.payload === "object" ? structuredClone(value.payload) : null,
  });
}

function migrateData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyData();
  const version = Number(value.version || 1);
  if (version > TRADING_ALERT_STORE_VERSION) {
    throw new TradingAlertError(`Unsupported trading alert store version ${version}`, {
      code: "TRADING_ALERT_STORE_VERSION_UNSUPPORTED",
      category: "storage",
    });
  }
  const data = { ...emptyData(), ...value, version: TRADING_ALERT_STORE_VERSION };
  const alerts = (Array.isArray(data.alerts) ? data.alerts : []).map(normalizeAlertInstance);
  const confirmedSimulationIds = new Set(alerts.map((alert) => alert.simulationId));
  return {
    version: TRADING_ALERT_STORE_VERSION,
    alerts,
    evidence: (Array.isArray(data.evidence) ? data.evidence : []).map(normalizeTriggerEvidence),
    simulations: (Array.isArray(data.simulations) ? data.simulations : [])
      .filter((simulation) => confirmedSimulationIds.has(String(simulation?.simulationId || "")))
      .map((simulation) => structuredClone(simulation)),
    gaps: (Array.isArray(data.gaps) ? data.gaps : []).map(normalizeMonitoringGap),
    drawings: (Array.isArray(data.drawings) ? data.drawings : []).map(normalizeStoredDrawing),
    events: (Array.isArray(data.events) ? data.events : [])
      .filter((event) => !String(event?.type || "").startsWith("draft."))
      .map(normalizeEvent),
    runtimeStates: data.runtimeStates && typeof data.runtimeStates === "object" && !Array.isArray(data.runtimeStates)
      ? structuredClone(data.runtimeStates)
      : {},
    idempotencyKeys: [...new Set((Array.isArray(data.idempotencyKeys) ? data.idempotencyKeys : []).map((entry) => boundedText(entry, 512)).filter(Boolean))],
    metadata: {
      lastHeartbeatAt: Number.isFinite(Number(data.metadata?.lastHeartbeatAt)) ? Number(data.metadata.lastHeartbeatAt) : null,
      lastShutdownAt: Number.isFinite(Number(data.metadata?.lastShutdownAt)) ? Number(data.metadata.lastShutdownAt) : null,
    },
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class TradingAlertStore {
  constructor({ dataDir, now = () => Date.now() } = {}) {
    if (!dataDir) throw new TypeError("TradingAlertStore requires dataDir");
    this.dataDir = path.resolve(String(dataDir));
    this.filePath = path.join(this.dataDir, STORE_FILE);
    this.lockPath = `${this.filePath}.lock`;
    this.now = now;
    this.loaded = false;
    this.data = emptyData();
    this.queue = Promise.resolve();
  }

  async load() {
    if (!this.loaded) await this.reload();
    return this.snapshot();
  }

  async reload() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = migrateData(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.data = emptyData();
      } else if (error instanceof SyntaxError) {
        const quarantinePath = `${this.filePath}.corrupt-${this.now()}`;
        await rename(this.filePath, quarantinePath).catch(() => {});
        this.data = emptyData();
        await this.persist();
      } else {
        throw error;
      }
    }
    this.loaded = true;
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.data);
  }

  async listAlerts() {
    await this.load();
    return structuredClone([...this.data.alerts].sort((a, b) => b.updatedAt - a.updatedAt));
  }

  async getAlert(alertId) {
    await this.load();
    const alert = this.data.alerts.find((entry) => entry.alertId === String(alertId));
    return alert ? structuredClone(alert) : null;
  }

  async createAlert(input, { simulation = null } = {}) {
    return await this.writeLocked((data) => {
      const normalized = normalizeAlertInstance(input);
      if (data.alerts.some((entry) => entry.alertId === normalized.alertId)) {
        throw new TradingAlertError(`Alert already exists: ${normalized.alertId}`, { code: "TRADING_ALERT_EXISTS", category: "storage" });
      }
      if (data.alerts.some((entry) => entry.draftId === normalized.draftId)) {
        throw new TradingAlertError(`Draft already created an alert: ${normalized.draftId}`, { code: "TRADING_ALERT_DRAFT_ALREADY_CONFIRMED", category: "storage" });
      }
      if (simulation) this.upsertConfirmedSimulation(data, normalized, simulation);
      data.alerts.push(normalized);
      data.events.push(normalizeEvent({
        type: "alert.created",
        time: this.now(),
        alertId: normalized.alertId,
        draftId: normalized.draftId,
        payload: { ruleHash: normalized.ruleHash, status: normalized.status },
      }));
      return normalized;
    });
  }

  async updateAlert(alertId, patch, { simulation = null } = {}) {
    return await this.writeLocked((data) => {
      const index = data.alerts.findIndex((entry) => entry.alertId === String(alertId));
      if (index < 0) throw new TradingAlertError(`Alert not found: ${alertId}`, { code: "TRADING_ALERT_NOT_FOUND", category: "storage" });
      const current = data.alerts[index];
      const normalized = normalizeAlertInstance({
        ...current,
        ...structuredClone(patch),
        alertId: current.alertId,
        draftId: current.draftId,
        createdAt: current.createdAt,
        updatedAt: this.now(),
      });
      if (simulation) this.upsertConfirmedSimulation(data, normalized, simulation);
      data.alerts[index] = normalized;
      data.events.push(normalizeEvent({
        type: "alert.updated",
        time: this.now(),
        alertId: current.alertId,
        payload: { previousStatus: current.status, status: normalized.status, enabled: normalized.enabled },
      }));
      return normalized;
    });
  }

  async deleteAlert(alertId) {
    return await this.writeLocked((data) => {
      const id = String(alertId);
      const removed = data.alerts.find((entry) => entry.alertId === id);
      const before = data.alerts.length;
      data.alerts = data.alerts.filter((entry) => entry.alertId !== id);
      if (data.alerts.length === before) return { ok: false, deleted: false };
      data.simulations = data.simulations.filter((entry) => entry.simulationId !== removed?.simulationId);
      data.events.push(normalizeEvent({ type: "alert.deleted", time: this.now(), alertId: id }));
      delete data.runtimeStates[id];
      return { ok: true, deleted: true };
    });
  }

  async appendGap(input) {
    return await this.writeLocked((data) => {
      const gap = normalizeMonitoringGap(input);
      if (data.gaps.some((entry) => entry.gapId === gap.gapId)) return gap;
      const alertIndex = data.alerts.findIndex((entry) => entry.alertId === gap.alertId);
      if (alertIndex < 0) throw new TradingAlertError(`Alert not found: ${gap.alertId}`, { code: "TRADING_ALERT_NOT_FOUND", category: "storage" });
      data.gaps.push(gap);
      const current = data.alerts[alertIndex];
      data.alerts[alertIndex] = normalizeAlertInstance({
        ...current,
        status: current.enabled ? "gap_detected" : current.status,
        latestGapId: gap.gapId,
        updatedAt: this.now(),
      });
      data.events.push(normalizeEvent({
        type: "monitoring.gap_recorded",
        time: this.now(),
        alertId: gap.alertId,
        payload: { gapId: gap.gapId, reason: gap.reason, catchUpEvaluated: false },
      }));
      return gap;
    });
  }

  async listGaps({ alertId } = {}) {
    await this.load();
    const rows = alertId ? this.data.gaps.filter((entry) => entry.alertId === String(alertId)) : this.data.gaps;
    return structuredClone([...rows].sort((a, b) => b.startedAt - a.startedAt));
  }

  async listDrawings() {
    await this.load();
    return structuredClone(this.data.drawings);
  }

  async replaceDrawings({ marketId, interval, drawings } = {}) {
    const market = boundedText(marketId, 160).toUpperCase();
    const period = normalizeTradingAlertInterval(boundedText(interval, 32));
    const normalized = (Array.isArray(drawings) ? drawings : []).map((entry) => normalizeStoredDrawing({ ...entry, marketId: market, interval: period }));
    return await this.writeLocked((data) => {
      const previous = data.drawings.filter((entry) => entry.marketId === market && entry.interval === period);
      const incomingIds = new Set(normalized.map((entry) => entry.drawingId));
      data.drawings = data.drawings.filter((entry) => entry.marketId !== market || entry.interval !== period).concat(normalized);
      const removedDrawingIds = previous.filter((entry) => !incomingIds.has(entry.drawingId)).map((entry) => entry.drawingId);
      data.events.push(normalizeEvent({ type: "drawings.synced", time: this.now(), payload: { marketId: market, interval: period, count: normalized.length, removedDrawingIds } }));
      return { drawings: data.drawings, removedDrawingIds };
    });
  }

  async appendEvidence(input) {
    return await this.writeLocked((data) => {
      const evidence = normalizeTriggerEvidence(input);
      const idempotencyKey = `${evidence.alertId}:${evidence.ruleRevision}:${evidence.triggerEventId}`;
      const existing = data.evidence.find((entry) => entry.evidenceId === evidence.evidenceId)
        || (data.idempotencyKeys.includes(idempotencyKey)
          ? data.evidence.find((entry) => `${entry.alertId}:${entry.ruleRevision}:${entry.triggerEventId}` === idempotencyKey)
          : null);
      if (existing) return { evidence: existing, created: false };
      const alertIndex = data.alerts.findIndex((entry) => entry.alertId === evidence.alertId);
      if (alertIndex < 0) throw new TradingAlertError(`Alert not found: ${evidence.alertId}`, { code: "TRADING_ALERT_NOT_FOUND", category: "storage" });
      const current = data.alerts[alertIndex];
      if (current.rule.revision !== evidence.ruleRevision || current.ruleHash !== evidence.ruleHash) {
        throw new TradingAlertError("Evidence does not match current rule revision", { code: "TRADING_ALERT_EVIDENCE_STALE", category: "validation" });
      }
      data.evidence.push(evidence);
      data.idempotencyKeys.push(idempotencyKey);
      const oneShot = current.rule.triggerPolicy.mode === "once";
      const nextTriggerCount = current.triggerCount + 1;
      const limitReached = oneShot || (current.rule.triggerPolicy.maxTriggersTotal && nextTriggerCount >= current.rule.triggerPolicy.maxTriggersTotal);
      const rearmState = limitReached ? "unarmed"
        : current.rule.triggerPolicy.rearm === "must_become_false" ? "waiting_false"
          : current.rule.triggerPolicy.rearm === "after_cooldown" ? "cooldown" : "armed";
      data.alerts[alertIndex] = normalizeAlertInstance({
        ...current,
        status: limitReached ? "completed" : current.rule.triggerPolicy.rearm === "after_cooldown" ? "cooling_down" : "triggered",
        enabled: limitReached ? false : current.enabled,
        lastTriggeredAt: evidence.triggeredAt,
        triggerCount: nextTriggerCount,
        latestEvidenceId: evidence.evidenceId,
        rearmState,
        updatedAt: this.now(),
      });
      data.events.push(normalizeEvent({
        type: "alert.triggered",
        time: this.now(),
        alertId: evidence.alertId,
        payload: { evidenceId: evidence.evidenceId, idempotencyKey },
      }));
      return { evidence, created: true };
    });
  }

  async listEvidence({ alertId } = {}) {
    await this.load();
    const rows = alertId ? this.data.evidence.filter((entry) => entry.alertId === String(alertId)) : this.data.evidence;
    return structuredClone([...rows].sort((a, b) => b.triggeredAt - a.triggeredAt));
  }

  upsertConfirmedSimulation(data, alert, record) {
    const simulation = structuredClone(record);
    const simulationId = boundedText(simulation?.simulationId, 160);
    const draftId = boundedText(simulation?.draftId, 160);
    if (!simulationId || !draftId || !simulation?.ruleHash || simulation?.proof?.triggered !== true) {
      throw new TradingAlertError("Simulation record is invalid", { code: "TRADING_ALERT_SIMULATION_INVALID", category: "storage" });
    }
    if (
      simulationId !== alert.simulationId
      || (draftId !== alert.draftId && simulation.replacesAlertId !== alert.alertId)
      || simulation.ruleHash !== alert.ruleHash
      || simulation.confirmation?.confirmationId !== alert.confirmationId
    ) {
      throw new TradingAlertError("Simulation does not match the confirmed alert", { code: "TRADING_ALERT_CONFIRMATION_STALE", category: "validation" });
    }
    if (JSON.stringify(simulation).length > 2_000_000) {
      throw new TradingAlertError("Simulation record exceeds 2 MiB", { code: "TRADING_ALERT_SIMULATION_TOO_LARGE", category: "storage" });
    }
    data.simulations = data.simulations.filter((entry) => entry.simulationId !== simulationId);
    data.simulations.push(simulation);
    if (data.simulations.length > 100) data.simulations = data.simulations.slice(-100);
    return simulation;
  }

  async saveSimulation(record) {
    const simulationId = boundedText(record?.simulationId, 160);
    return await this.writeLocked((data) => {
      const alert = data.alerts.find((entry) => entry.simulationId === simulationId);
      if (!alert) {
        throw new TradingAlertError("Unconfirmed simulations are not persisted", { code: "TRADING_ALERT_CONFIRMATION_REQUIRED", category: "validation" });
      }
      return this.upsertConfirmedSimulation(data, alert, record);
    });
  }

  async getSimulation(simulationId) {
    await this.load();
    const result = this.data.simulations.find((entry) => entry.simulationId === String(simulationId));
    return result ? structuredClone(result) : null;
  }

  async listSimulations() {
    await this.load();
    return structuredClone(this.data.simulations);
  }

  async purgeUnconfirmedArtifacts() {
    return await this.writeLocked((data) => {
      const confirmedSimulationIds = new Set(data.alerts.map((alert) => alert.simulationId));
      const beforeSimulations = data.simulations.length;
      const beforeEvents = data.events.length;
      data.simulations = data.simulations.filter((simulation) => confirmedSimulationIds.has(simulation.simulationId));
      data.events = data.events.filter((event) => !String(event.type || "").startsWith("draft."));
      return {
        removedSimulations: beforeSimulations - data.simulations.length,
        removedDraftEvents: beforeEvents - data.events.length,
      };
    });
  }

  async listEvents({ alertId, draftId, limit = 500 } = {}) {
    await this.load();
    let rows = this.data.events;
    if (alertId) rows = rows.filter((entry) => entry.alertId === String(alertId));
    if (draftId) rows = rows.filter((entry) => entry.draftId === String(draftId));
    return structuredClone(rows.slice(-Math.max(1, Math.min(Number(limit) || 500, 5_000))));
  }

  async getRuntimeState(alertId) {
    await this.load();
    return structuredClone(this.data.runtimeStates[String(alertId)] || null);
  }

  async setRuntimeState(alertId, state) {
    const id = boundedText(alertId, 160);
    const payload = structuredClone(state || {});
    if (JSON.stringify(payload).length > 262_144) {
      throw new TradingAlertError("Alert runtime state exceeds 256 KiB", { code: "TRADING_ALERT_RUNTIME_STATE_TOO_LARGE", category: "storage" });
    }
    return await this.writeLocked((data) => {
      if (!data.alerts.some((entry) => entry.alertId === id)) {
        throw new TradingAlertError(`Alert not found: ${id}`, { code: "TRADING_ALERT_NOT_FOUND", category: "storage" });
      }
      data.runtimeStates[id] = payload;
      return payload;
    });
  }

  async writeHeartbeat(time = this.now()) {
    return await this.writeLocked((data) => {
      data.metadata.lastHeartbeatAt = Math.floor(Number(time));
      return structuredClone(data.metadata);
    });
  }

  async writeShutdown(time = this.now()) {
    return await this.writeLocked((data) => {
      data.metadata.lastShutdownAt = Math.floor(Number(time));
      return structuredClone(data.metadata);
    });
  }

  async writeLocked(mutator) {
    const operation = this.queue.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      const release = await this.acquireFileLock();
      try {
        await this.reload();
        const result = await mutator(this.data);
        await this.persist();
        return structuredClone(result);
      } finally {
        await release();
      }
    });
    this.queue = operation.catch(() => {});
    return await operation;
  }

  async persist() {
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    await writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, this.filePath);
  }

  async acquireFileLock() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
        return async () => {
          await handle.close().catch(() => {});
          await rm(this.lockPath, { force: true }).catch(() => {});
        };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        try {
          const info = await stat(this.lockPath);
          if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
            await rm(this.lockPath, { force: true });
            continue;
          }
        } catch {}
        await sleep(LOCK_RETRY_MS);
      }
    }
    throw new TradingAlertError("Timed out waiting for trading alert store lock", {
      code: "TRADING_ALERT_STORE_LOCK_TIMEOUT",
      category: "storage",
      retryable: true,
    });
  }
}

export function createInitialAlertInstance({ alertId, draftId, rule, simulationId, confirmationId, originThreadId, now = Date.now() }) {
  return normalizeAlertInstance({
    schemaVersion: TRADING_ALERT_SCHEMA_VERSION,
    alertId,
    draftId,
    rule,
    ruleHash: rule.ruleHash,
    simulationId,
    confirmationId,
    ...(originThreadId ? { originThreadId } : {}),
    status: "arming",
    enabled: true,
    createdAt: now,
    updatedAt: now,
    triggerCount: 0,
    rearmState: "unarmed",
  });
}
