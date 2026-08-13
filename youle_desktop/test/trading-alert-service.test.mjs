import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TradingAlertService } from "../src/main/trading-alerts/service.mjs";
import { normalizeAlertRule } from "../src/main/trading-alerts/protocol.mjs";
import { createInitialAlertInstance } from "../src/main/trading-alerts/store.mjs";
import { createConfirmationBinding } from "../src/main/trading-alerts/intent-workflow.mjs";
import { TradingAlertError } from "../src/main/trading-alerts/errors.mjs";

const fixture = normalizeAlertRule(JSON.parse(await readFile(new URL("./fixtures/trading-alerts/ma-macd-rule.v1.json", import.meta.url), "utf8")));
const NOW = 1_786_464_000_000;
const adapter = { providerId: "binance-public", async loadHistory() { return []; }, async subscribe() { return async () => {}; } };
const invokeIntentModel = async () => { throw new Error("intent model is not used by this service test"); };

function drawingIntentRule(drawing) {
  const drawingValue = { type: "drawing", drawingId: drawing.drawingId, output: "price_at_time" };
  const condition = (conditionId, operator, field) => ({
    type: "condition",
    condition: { conditionId, contextId: "primary", operator, left: { type: "field", field }, right: drawingValue, confirmation: "intrabar" },
  });
  return {
    title: "趋势线触碰或突破预警",
    root: {
      type: "any",
      children: [
        { type: "all", children: [condition("touch_high", "gte", "high"), condition("touch_low", "lte", "low")] },
        condition("break_above", "break_above", "close"),
        condition("break_below", "break_below", "close"),
      ],
    },
    contexts: [{
      contextId: "primary",
      marketSelector: { kind: "fixed", marketIds: ["BINANCE:FUTURES:BTCUSDT"] },
      intervals: ["15m"],
      drawingBinding: {
        drawingId: drawing.drawingId,
        drawingRevision: drawing.revision,
        marketId: "BINANCE:FUTURES:BTCUSDT",
        interval: "15m",
        geometryMode: drawing.geometryMode,
      },
    }],
    evaluationPolicy: { clock: "bar_update", anchorContextId: "primary", joinMode: "latest_closed", maxDataAgeMs: 5000, unknownPolicy: "do_not_trigger" },
    triggerPolicy: { mode: "once", edge: "false_to_true", rearm: "must_become_false", maxTriggersTotal: 1, resumePolicy: "baseline_only_no_catch_up" },
    dataRequirements: [],
    normalizedSummary: "BTCUSDT 15m 盘中触碰或向任一方向突破绑定趋势线时提醒一次",
  };
}

async function seed(service, rule, alertId) {
  await service.store.createAlert(createInitialAlertInstance({ alertId, draftId: `draft-${alertId}`, rule, simulationId: `simulation-${alertId}`, confirmationId: `confirmation-${alertId}`, now: NOW }));
}

test("editing generic scope accepts multiple markets and intervals but requires a new simulation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-service-"));
  try {
    const service = new TradingAlertService({ dataDir, enabled: false, marketAdapter: adapter, invokeIntentModel, now: () => NOW + 1_000 });
    await service.start(); await seed(service, fixture, "multi-edit");
    const result = await service.revise({ alertId: "multi-edit", contextId: "primary", marketIds: "BINANCE:FUTURES:BTCUSDT, BINANCE:FUTURES:ETHUSDT", intervals: "15m, 1h, 4h", mode: "repeat", clock: "mixed" });
    assert.equal(result.requiresSimulation, true);
    assert.equal(result.draft.rule.revision, fixture.revision + 1);
    assert.deepEqual(result.draft.rule.contexts[0].marketSelector.marketIds, ["BINANCE:FUTURES:BTCUSDT", "BINANCE:FUTURES:ETHUSDT"]);
    assert.deepEqual(result.draft.rule.contexts[0].intervals, ["15m", "1h", "4h"]);
    assert.equal((await service.store.getAlert("multi-edit")).rule.revision, fixture.revision);
    await service.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("a generic revision persists the exact single market and interval selected by the editor", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-exact-edit-"));
  try {
    const service = new TradingAlertService({ dataDir, enabled: false, marketAdapter: adapter, invokeIntentModel, now: () => NOW + 1_000 });
    await service.start();
    await seed(service, fixture, "exact-edit");
    const result = await service.revise({
      alertId: "exact-edit",
      contextId: "primary",
      marketIds: "BINANCE:FUTURES:ETHUSDT",
      intervals: "1h",
      selectorKind: "fixed",
      mode: "once",
      clock: "bar_close",
    });
    assert.deepEqual(result.draft.rule.contexts[0].marketSelector.marketIds, ["BINANCE:FUTURES:ETHUSDT"]);
    assert.deepEqual(result.draft.rule.contexts[0].intervals, ["1h"]);
    assert.match(result.draft.sourceText, /BINANCE:FUTURES:ETHUSDT \/ 1h/);
    await service.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("service refuses a success response when the new alert cannot be read back from the persisted list", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-readback-gate-"));
  try {
    const service = new TradingAlertService({ dataDir, enabled: false, marketAdapter: adapter, invokeIntentModel, now: () => NOW + 1_000 });
    await service.start();
    await seed(service, fixture, "readback-gate");
    const listAlerts = service.store.listAlerts.bind(service.store);
    service.store.listAlerts = async () => [];
    await assert.rejects(
      () => service.requirePersistedAlert("readback-gate"),
      (error) => error?.code === "TRADING_ALERT_PERSISTENCE_NOT_VERIFIED",
    );
    service.store.listAlerts = listAlerts;
    await service.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("unconfirmed alert state is discarded on service restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-pending-restart-"));
  const draftId = "draft-pending-restart";
  const simulationId = "simulation-pending-restart";
  try {
    let service = new TradingAlertService({ dataDir, enabled: false, marketAdapter: adapter, invokeIntentModel, now: () => NOW });
    await service.start();
    const pending = {
      schemaVersion: 1,
      draftId,
      sourceText: fixture.sourceText,
      status: "awaiting_confirmation",
      rule: fixture,
      missingFields: [],
      ambiguities: [],
      questions: [],
      dataRequirements: fixture.dataRequirements,
      createdAt: NOW,
      updatedAt: NOW,
      originThreadId: "thread-pending-restart",
    };
    const confirmation = createConfirmationBinding({ draftId, ruleHash: fixture.ruleHash, simulationId, now: NOW });
    const simulation = {
      simulationId,
      draftId,
      ruleHash: fixture.ruleHash,
      proof: { triggered: true },
      confirmation,
    };
    service.pendingDrafts.set(draftId, pending);
    service.pendingSimulations.set(simulationId, simulation);
    await service.shutdown();
    assert.equal(service.pendingDrafts.size, 0);
    assert.equal(service.pendingSimulations.size, 0);

    service = new TradingAlertService({ dataDir, enabled: false, marketAdapter: adapter, invokeIntentModel, now: () => NOW + 1_000 });
    const snapshot = await service.start();
    assert.equal("drafts" in snapshot, false);
    assert.equal("pendingConfirmations" in snapshot, false);
    assert.equal(service.pendingDrafts.size, 0);
    assert.equal(service.pendingSimulations.size, 0);
    assert.equal((await service.store.listSimulations()).length, 0);
    await service.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("saved alert simulations can be reloaded for the source conversation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-simulation-read-"));
  try {
    const service = new TradingAlertService({ dataDir, enabled: false, marketAdapter: adapter, invokeIntentModel, now: () => NOW });
    await service.start();
    const simulationId = "simulation-source-conversation";
    const draftId = "draft-source-conversation";
    const confirmation = createConfirmationBinding({ draftId, ruleHash: fixture.ruleHash, simulationId, now: NOW });
    const simulationRecord = {
      simulationId,
      draftId,
      ruleHash: fixture.ruleHash,
      generated: { primary: [{ time: NOW, closeTime: NOW + 60_000, open: 1, high: 2, low: 0.5, close: 1.5 }] },
      proof: { triggered: true, trace: [] },
      confirmation,
    };
    await service.store.createAlert(createInitialAlertInstance({
      alertId: "alert-source-conversation",
      draftId,
      rule: fixture,
      simulationId,
      confirmationId: confirmation.confirmationId,
      now: NOW,
    }), { simulation: simulationRecord });
    const simulation = await service.getSimulation({ simulationId });
    assert.equal(simulation.simulationId, simulationId);
    assert.equal(simulation.generated.primary.length, 1);
    await assert.rejects(
      () => service.getSimulation({}),
      (error) => error?.code === "TRADING_ALERT_SIMULATION_ID_REQUIRED",
    );
    await assert.rejects(
      () => service.getSimulation({ simulationId: "missing-simulation" }),
      (error) => error?.code === "TRADING_ALERT_SIMULATION_NOT_FOUND",
    );
    await service.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("drawing scope is locked and deleting the persisted drawing pauses affected alerts", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-drawing-service-"));
  try {
    const service = new TradingAlertService({ dataDir, enabled: false, marketAdapter: adapter, invokeIntentModel, now: () => NOW + 1_000 });
    await service.start();
    const rule = normalizeAlertRule({ ...fixture, ruleId: "drawing-service", contexts: [{ ...fixture.contexts[0], drawingBinding: { drawingId: "locked-line", drawingRevision: 1, marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1h", geometryMode: "extended" } }], root: { type: "condition", condition: { conditionId: "line", contextId: "primary", operator: "touch", left: { type: "field", field: "close" }, right: { type: "drawing", drawingId: "locked-line", output: "price_at_time" }, confirmation: "intrabar" } }, dataRequirements: [], ruleHash: undefined });
    await seed(service, rule, "drawing-service");
    await assert.rejects(
      () => service.revise({ alertId: "drawing-service", marketIds: "BINANCE:FUTURES:ETHUSDT" }),
      (error) => error?.code === "TRADING_ALERT_DRAWING_REVISION_LOCKED" && /原 K 线图/.test(error.message),
    );
    await service.syncDrawings({ marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1h", drawings: [{ drawingId: "locked-line", revision: 1, geometryMode: "extended", points: [{ time: NOW, price: 100 }, { time: NOW + 3_600_000, price: 100 }] }] });
    await service.syncDrawings({ marketId: "BINANCE:FUTURES:BTCUSDT", interval: "1h", drawings: [] });
    const paused = await service.store.getAlert("drawing-service");
    assert.equal(paused.status, "paused");
    assert.match(paused.failure, /已删除/);
    await service.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("service compile exposes the exact requestId to the intent model and survives one stale echo", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-request-id-service-"));
  let attempts = 0;
  try {
    const service = new TradingAlertService({
      dataDir,
      enabled: false,
      marketAdapter: adapter,
      now: () => NOW + 1_000,
      invokeIntentModel: async ({ request }) => {
        attempts += 1;
        const input = JSON.parse(String(request.prompt).split("INPUT_JSON=")[1].split("\n")[0]);
        assert.equal(input.requestId, request.requestId);
        return {
          status: "success",
          text: JSON.stringify({
            schemaVersion: 1,
            requestId: attempts === 1 ? "stale-intent-response" : input.requestId,
            candidateRule: null,
            missingFields: ["rule"],
            ambiguities: [],
            questions: ["请确认画线触碰还是突破。"],
            dataRequirements: [],
          }),
        };
      },
    });
    await service.start();
    const result = await service.compile({
      threadId: "thread-request-id",
      sourceText: fixture.sourceText,
      currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15m" },
      drawings: [],
    });
    assert.equal(attempts, 2);
    assert.equal(result.draft.status, "awaiting_clarification");
    assert.match(result.draft.questions.join(" "), /画线触碰还是突破/);
    assert.equal(service.pendingDrafts.get(result.draft.draftId)?.originThreadId, "thread-request-id");
    assert.equal("drafts" in await service.store.load(), false);
    await service.shutdown();
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("drawing alert chain compiles through the model, simulates, confirms, and enters monitoring", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-full-drawing-chain-"));
  const intervalMs = 15 * 60_000;
  const start = NOW - 40 * intervalMs;
  const history = Array.from({ length: 40 }, (_, index) => {
    const close = 100 + index * 0.05;
    return {
      time: start + index * intervalMs,
      closeTime: start + (index + 1) * intervalMs,
      open: close - 0.02,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000,
    };
  });
  const last = history.at(-1);
  const drawing = {
    drawingId: "trend-line-chain",
    revision: 2,
    geometryMode: "extended",
    points: [
      { time: last.closeTime - intervalMs, price: 106 },
      { time: last.closeTime, price: 104 },
    ],
  };
  let modelAttempts = 0;
  let subscriptionCount = 0;
  let historyRequestCount = 0;
  const chainAdapter = {
    providerId: "binance-public",
    async loadHistory() { historyRequestCount += 1; return history; },
    async subscribe() {
      subscriptionCount += 1;
      return async () => { subscriptionCount -= 1; };
    },
  };
  try {
    const service = new TradingAlertService({
      dataDir,
      enabled: true,
      marketAdapter: chainAdapter,
      now: () => NOW + 1_000,
      invokeIntentModel: async ({ request }) => {
        modelAttempts += 1;
        return {
          status: "success",
          text: JSON.stringify({
            schemaVersion: 1,
            requestId: request.requestId,
            candidateRule: drawingIntentRule(drawing),
            missingFields: [],
            ambiguities: [],
            questions: [],
            dataRequirements: [],
          }),
        };
      },
    });
    await service.start();
    await service.syncDrawings({
      marketId: "BINANCE:FUTURES:BTCUSDT",
      interval: "15m",
      drawings: [drawing],
    });
    const compiled = await service.compile({
      threadId: "thread-drawing-chain",
      sourceText: "当K线触碰或者突破我画的趋势线时预警",
      currentChart: { marketId: "BINANCE:FUTURES:BTCUSDT", interval: "15m" },
      drawings: [drawing],
    });
    assert.equal(modelAttempts, 1);
    assert.equal(compiled.provider.modelId, "gpt-5.6-sol");
    assert.equal(compiled.draft.status, "ready_to_simulate");
    assert.equal(compiled.draft.rule.contexts[0].drawingBinding.drawingId, drawing.drawingId);

    const simulated = await service.simulate({
      draftId: compiled.draft.draftId,
      frames: {
        primary: {
          interval: "15m",
          candles: history,
          closed: true,
          coverage: "available",
          drawings: { [drawing.drawingId]: drawing },
        },
      },
      maxBars: 4,
      beamWidth: 48,
    });
    assert.equal(simulated.simulation.proof.triggered, true);
    assert.equal(simulated.simulation.visualization.anchorContextId, "primary");
    assert.equal(simulated.simulation.visualization.candles.length, history.length);
    const triggerCandle = simulated.simulation.generated.primary[simulated.simulation.triggerBarIndex];
    const triggerPoint = simulated.simulation.triggerPoint;
    const triggerLinePrice = drawing.points[0].price
      + (triggerPoint.time - drawing.points[0].time)
        / (drawing.points[1].time - drawing.points[0].time)
        * (drawing.points[1].price - drawing.points[0].price);
    assert.ok(Math.abs(triggerPoint.price - triggerLinePrice) < 1e-9);
    if (triggerPoint.time === triggerCandle.time) {
      assert.ok(triggerCandle.low <= triggerPoint.price && triggerPoint.price <= triggerCandle.high);
    } else {
      const previousCandle = simulated.simulation.triggerBarIndex > 0
        ? simulated.simulation.generated.primary[simulated.simulation.triggerBarIndex - 1]
        : last;
      const progress = (triggerPoint.time - previousCandle.time) / (triggerCandle.time - previousCandle.time);
      const crossingPrice = previousCandle.close + (triggerCandle.close - previousCandle.close) * progress;
      assert.ok(triggerPoint.time > previousCandle.time && triggerPoint.time < triggerCandle.time);
      assert.ok(Math.abs(triggerPoint.price - crossingPrice) < 1e-9);
    }
    assert.equal(simulated.draft.status, "awaiting_confirmation");
    const pendingSnapshot = await service.snapshot();
    assert.equal("drafts" in pendingSnapshot, false);
    assert.equal("pendingConfirmations" in pendingSnapshot, false);
    assert.equal(service.pendingDrafts.get(compiled.draft.draftId)?.originThreadId, "thread-drawing-chain");
    assert.equal(service.pendingSimulations.get(simulated.simulation.simulationId)?.confirmation.confirmationId,
      simulated.simulation.confirmation.confirmationId);
    assert.equal((await service.store.listSimulations()).length, 0);

    const confirmed = await service.confirm({
      draftId: compiled.draft.draftId,
      simulationId: simulated.simulation.simulationId,
      confirmationId: simulated.simulation.confirmation.confirmationId,
      alertId: "alert-drawing-chain",
    });
    assert.equal(confirmed.alert.status, "monitoring");
    assert.equal(confirmed.monitoringReady, true);
    assert.equal(confirmed.alert.originThreadId, "thread-drawing-chain");
    assert.equal(historyRequestCount, 0);
    assert.equal(subscriptionCount, 1);
    const snapshot = await service.snapshot();
    assert.equal(snapshot.engine.running, true);
    assert.equal(snapshot.engine.alerts, 1);
    assert.equal(snapshot.engine.subscriptions, 1);
    assert.equal(snapshot.alerts[0].alertId, "alert-drawing-chain");
    assert.equal(snapshot.alerts[0].status, "monitoring");
    assert.equal(service.pendingDrafts.has(compiled.draft.draftId), false);
    assert.equal(service.pendingSimulations.has(simulated.simulation.simulationId), false);
    assert.equal((await service.store.getSimulation(simulated.simulation.simulationId))?.confirmation.confirmationId,
      simulated.simulation.confirmation.confirmationId);
    const retried = await service.confirm({
      draftId: compiled.draft.draftId,
      simulationId: simulated.simulation.simulationId,
      confirmationId: simulated.simulation.confirmation.confirmationId,
      alertId: "a-different-id-must-not-be-created",
    });
    assert.equal(retried.idempotent, true);
    assert.equal(retried.alert.alertId, "alert-drawing-chain");
    assert.equal((await service.store.listAlerts()).length, 1);
    assert.equal(subscriptionCount, 1);
    await service.shutdown();
    assert.equal(subscriptionCount, 0);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test("a retryable arm failure keeps one persisted card and confirmation retry recovers it", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "haolo-alert-confirm-recovery-"));
  let service;
  let providerAvailable = false;
  const recoveryAdapter = {
    providerId: "binance-public",
    async loadHistory() {
      if (!providerAvailable) throw new TradingAlertError("fetch failed", { code: "TRADING_ALERT_MARKET_HISTORY_FAILED", category: "transport", retryable: true });
      return Array.from({ length: 4 }, (_, index) => ({
        time: NOW - (4 - index) * 60_000,
        closeTime: NOW - (3 - index) * 60_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 10,
      }));
    },
    async subscribe() { return async () => {}; },
  };
  try {
    service = new TradingAlertService({ dataDir, enabled: true, marketAdapter: recoveryAdapter, invokeIntentModel, now: () => NOW });
    await service.start();
    const draftId = "draft-confirm-recovery";
    const simulationId = "simulation-confirm-recovery";
    service.pendingDrafts.set(draftId, {
      schemaVersion: 1,
      draftId,
      sourceText: fixture.sourceText,
      status: "awaiting_confirmation",
      rule: fixture,
      missingFields: [],
      ambiguities: [],
      questions: [],
      dataRequirements: fixture.dataRequirements,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const confirmation = createConfirmationBinding({ draftId, ruleHash: fixture.ruleHash, simulationId, now: NOW });
    service.pendingSimulations.set(simulationId,
      { simulationId, draftId, ruleHash: fixture.ruleHash, proof: { triggered: true }, confirmation });
    const params = { draftId, simulationId, confirmationId: confirmation.confirmationId, alertId: "alert-confirm-recovery" };
    const first = await service.confirm(params);
    assert.equal(first.monitoringReady, false);
    assert.equal(first.alert.status, "reconnecting");
    assert.match(first.warning, /fetch failed/);
    assert.equal((await service.store.listAlerts()).length, 1);

    await service.shutdown();
    service = new TradingAlertService({ dataDir, enabled: true, marketAdapter: recoveryAdapter, invokeIntentModel, now: () => NOW + 1_000 });
    const restarted = await service.start();
    assert.equal(restarted.alerts.length, 1);
    assert.equal(restarted.alerts[0].status, "reconnecting");
    assert.equal(restarted.engine.running, true);

    providerAvailable = true;
    const recovered = await service.confirm({ ...params, alertId: "duplicate-must-not-exist" });
    assert.equal(recovered.idempotent, true);
    assert.equal(recovered.monitoringReady, true);
    assert.equal(recovered.alert.alertId, "alert-confirm-recovery");
    assert.equal(recovered.alert.status, "monitoring");
    assert.equal((await service.store.listAlerts()).length, 1);
    await service.shutdown();
    service = null;
  } finally {
    await service?.shutdown().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  }
});
