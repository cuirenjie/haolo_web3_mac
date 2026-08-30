import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TRADING_ALERT_SCHEMA_VERSION,
  TradingAlertProtocolError,
  alertRuleHash,
  createAlertRuleRevision,
  normalizeAlertDraft,
  normalizeAlertRule,
} from "../src/main/trading-alerts/protocol.mjs";
import { ALERT_DRAFT_JSON_SCHEMA, ALERT_RULE_JSON_SCHEMA } from "../src/main/trading-alerts/schema.mjs";
import { parseTradingAlertFeatureFlag, tradingAlertFeatureState } from "../src/main/trading-alerts/feature-flag.mjs";
import { TradingAlertStore, createInitialAlertInstance } from "../src/main/trading-alerts/store.mjs";

const fixturePath = path.resolve("test/fixtures/trading-alerts/ma-macd-rule.v1.json");

async function fixture() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

async function tempDir(name) {
  const dir = path.join(os.tmpdir(), `haolo-trading-alert-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

test("AlertRule normalizes a strict nested MA and MACD rule with stable hash", async () => {
  const input = await fixture();
  const first = normalizeAlertRule(input);
  const second = normalizeAlertRule(JSON.parse(JSON.stringify(input)));
  assert.equal(first.schemaVersion, TRADING_ALERT_SCHEMA_VERSION);
  assert.equal(first.root.type, "all");
  assert.equal(first.root.children.length, 2);
  assert.equal(first.ruleHash, second.ruleHash);
  assert.equal(first.ruleHash, alertRuleHash(first));
  assert.equal(first.contexts[0].marketSelector.marketIds[0], "BINANCE:FUTURES:BTCUSDT");
  assert.ok(Object.isFrozen(first));
});

test("AlertRule accepts canonical Han-character Binance market IDs without relaxing the identifier character set", async () => {
  const input = await fixture();
  input.contexts[0].marketSelector.marketIds = ["BINANCE:FUTURES:龙虾USDT"];
  input.ruleHash = undefined;
  const rule = normalizeAlertRule(input);
  assert.equal(rule.contexts[0].marketSelector.marketIds[0], "BINANCE:FUTURES:龙虾USDT");

  for (const marketId of ["BINANCE:FUTURES:龙虾?USDT", "BINANCE:FUTURES:龙 虾USDT", "BINANCE:FUTURES:龙虾\nUSDT"]) {
    const invalid = structuredClone(input);
    invalid.contexts[0].marketSelector.marketIds = [marketId];
    assert.throws(() => normalizeAlertRule(invalid), /invalid identifier format/);
  }
});

test("AlertRule normalizes bounded lag and rolling value expressions", async () => {
  const input = await fixture();
  input.ruleId = "volume-rolling-rule";
  input.root = { type: "condition", condition: {
    conditionId: "volume-spike",
    contextId: "primary",
    operator: "gt",
    left: { type: "field", field: "volume" },
    right: { type: "math", op: "mul", args: [
      { type: "constant", value: 3 },
      { type: "rolling", op: "max", expr: { type: "field", field: "volume" }, period: 3, offset: 1 },
    ] },
    confirmation: "bar_close",
  } };
  input.ruleHash = undefined;
  const rule = normalizeAlertRule(input);
  assert.equal(rule.root.condition.right.args[1].period, 3);
  assert.equal(rule.root.condition.right.args[1].offset, 1);

  const invalid = structuredClone(input);
  invalid.root.condition.right.args[1].period = 0;
  assert.throws(() => normalizeAlertRule(invalid), /must be between 1 and 5000/);
});

test("AlertRule rejects unknown fields, duplicate condition IDs, and stale hashes", async () => {
  const input = await fixture();
  assert.throws(() => normalizeAlertRule({ ...input, arbitraryScript: "process.exit()" }), TradingAlertProtocolError);
  const duplicate = structuredClone(input);
  duplicate.root.children[1].condition.conditionId = "ma_cross";
  assert.throws(() => normalizeAlertRule(duplicate), /conditionId values must be unique/);
  assert.throws(() => normalizeAlertRule({ ...input, ruleHash: "0".repeat(64) }), /does not match normalized rule/);
});

test("drawing bindings fail closed when market or interval can fan out", async () => {
  const input = await fixture();
  input.contexts[0].drawingBinding = {
    drawingId: "drawing_1",
    drawingRevision: 1,
    marketId: "BINANCE:FUTURES:BTCUSDT",
    interval: "1h",
    geometryMode: "segment",
  };
  assert.doesNotThrow(() => normalizeAlertRule(input));
  input.contexts[0].intervals = ["1h", "4h"];
  assert.throws(() => normalizeAlertRule(input), /exactly its fixed interval/);
});

test("rule revisions preserve identity and invalidate the semantic hash", async () => {
  const first = normalizeAlertRule(await fixture());
  const nextValue = structuredClone(first);
  delete nextValue.ruleHash;
  nextValue.title = "更新后的组合预警";
  const second = createAlertRuleRevision(first, nextValue);
  assert.equal(second.ruleId, first.ruleId);
  assert.equal(second.revision, 2);
  assert.notEqual(second.ruleHash, first.ruleHash);
});

test("AlertDraft preserves clarification state without requiring a rule", () => {
  const draft = normalizeAlertDraft({
    schemaVersion: 1,
    draftId: "draft_1",
    sourceText: "放量后突破就提醒我",
    status: "awaiting_clarification",
    rule: null,
    missingFields: ["volume_threshold", "breakout_level"],
    ambiguities: ["放量没有数学定义"],
    questions: ["你希望成交量达到多少才算放量？"],
    conversation: [
      { role: "user", text: "放量后突破就提醒我" },
      { role: "assistant", text: "你希望成交量达到多少才算放量？" },
    ],
    dataRequirements: [],
    createdAt: 1000,
    updatedAt: 1000,
  });
  assert.equal(draft.rule, null);
  assert.equal(draft.questions.length, 1);
  assert.deepEqual(draft.conversation.map((turn) => turn.role), ["user", "assistant"]);
});

test("exported JSON schemas are strict and versioned", () => {
  assert.equal(ALERT_RULE_JSON_SCHEMA.additionalProperties, false);
  assert.equal(ALERT_RULE_JSON_SCHEMA.properties.schemaVersion.const, 1);
  assert.equal(ALERT_DRAFT_JSON_SCHEMA.additionalProperties, false);
  assert.equal(ALERT_DRAFT_JSON_SCHEMA.properties.conversation.maxItems, 32);
  assert.match(ALERT_RULE_JSON_SCHEMA.$id, /alert-rule\.v1/);
});

test("trading alerts are enabled by default and retain an explicit kill switch", () => {
  assert.equal(tradingAlertFeatureState({}).enabled, true);
  assert.equal(tradingAlertFeatureState({}).reason, "enabled_by_default");
  assert.equal(parseTradingAlertFeatureFlag("TRUE"), true);
  assert.equal(parseTradingAlertFeatureFlag("0"), false);
  assert.equal(tradingAlertFeatureState({ HAOLO_TRADING_ALERTS_ENABLED: "0" }).enabled, false);
  assert.equal(tradingAlertFeatureState({ HAOLO_TRADING_ALERTS_ENABLED: "0" }).reason, "disabled_by_environment");
});

test("TradingAlertStore persists confirmed alerts without a draft collection", async () => {
  const dir = await tempDir("store");
  try {
    const now = 1786464000000;
    const rule = normalizeAlertRule(await fixture());
    const store = new TradingAlertStore({ dataDir: dir, now: () => now });
    const alert = createInitialAlertInstance({
      alertId: "alert_store",
      draftId: "draft_store",
      rule,
      simulationId: "simulation_store",
      confirmationId: "confirmation_store",
      now,
    });
    await store.createAlert(alert);
    assert.equal((await store.getAlert(alert.alertId)).ruleHash, rule.ruleHash);
    assert.equal("drafts" in await store.load(), false);
    assert.ok((await store.listEvents({ alertId: alert.alertId })).some((event) => event.type === "alert.created"));

    const reopened = new TradingAlertStore({ dataDir: dir, now: () => now + 1 });
    assert.equal((await reopened.listAlerts()).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TradingAlertStore migration removes legacy drafts and unconfirmed simulations from disk", async () => {
  const dir = await tempDir("legacy-draft-cleanup");
  try {
    const now = 1786464000000;
    const legacyDraft = normalizeAlertDraft({
      schemaVersion: 1,
      draftId: "legacy-draft",
      sourceText: "legacy unconfirmed alert",
      status: "awaiting_clarification",
      rule: null,
      missingFields: ["rule"],
      ambiguities: [],
      questions: ["clarify"],
      dataRequirements: [],
      createdAt: now,
      updatedAt: now,
    });
    const filePath = path.join(dir, "trading-alert-store.json");
    await writeFile(filePath, `${JSON.stringify({
      version: 1,
      drafts: [legacyDraft],
      alerts: [],
      simulations: [{
        simulationId: "legacy-unconfirmed-simulation",
        draftId: legacyDraft.draftId,
        ruleHash: "a".repeat(64),
        proof: { triggered: true },
      }],
      events: [{ type: "draft.created", time: now, draftId: legacyDraft.draftId }],
    }, null, 2)}\n`, "utf8");

    const store = new TradingAlertStore({ dataDir: dir, now: () => now + 1 });
    const migrated = await store.load();
    assert.equal("drafts" in migrated, false);
    assert.deepEqual(migrated.simulations, []);
    assert.deepEqual(migrated.events, []);

    await store.purgeUnconfirmedArtifacts();
    const persisted = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.equal("drafts" in persisted, false);
    assert.deepEqual(persisted.simulations, []);
    assert.deepEqual(persisted.events, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TradingAlertStore trigger evidence is idempotent and completes one-shot alerts", async () => {
  const dir = await tempDir("evidence");
  try {
    const now = 1786464000000;
    const rule = normalizeAlertRule(await fixture());
    const store = new TradingAlertStore({ dataDir: dir, now: () => now });
    await store.createAlert(createInitialAlertInstance({
      alertId: "alert_evidence",
      draftId: "draft_evidence",
      rule,
      simulationId: "simulation_evidence",
      confirmationId: "confirmation_evidence",
      now,
    }));
    const evidence = {
      schemaVersion: 1,
      evidenceId: "evidence_1",
      alertId: "alert_evidence",
      ruleRevision: rule.revision,
      ruleHash: rule.ruleHash,
      triggerEventId: "event_close_1",
      triggeredAt: now + 1000,
      contexts: [{
        marketId: "BINANCE:FUTURES:BTCUSDT",
        interval: "1h",
        eventTime: now + 1000,
        candle: { close: 64000 },
        source: "fixture",
        coverage: { candles: "available" },
      }],
      conditionResults: [
        { conditionId: "ma_cross", result: true, previousValues: { left: 2, right: 1 }, currentValues: { left: 0, right: 1 } },
        { conditionId: "macd_zero", result: true, previousValues: { left: 1, right: 0 }, currentValues: { left: -1, right: 0 } },
      ],
      inputHash: "a".repeat(64),
    };
    assert.equal((await store.appendEvidence(evidence)).created, true);
    assert.equal((await store.appendEvidence({ ...evidence, evidenceId: "evidence_duplicate" })).created, false);
    assert.equal((await store.listEvidence({ alertId: "alert_evidence" })).length, 1);
    const alert = await store.getAlert("alert_evidence");
    assert.equal(alert.status, "completed");
    assert.equal(alert.enabled, false);
    assert.equal(alert.triggerCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("TradingAlertStore quarantines malformed persisted data instead of silently overwriting it", async () => {
  const dir = await tempDir("corrupt");
  try {
    await writeFile(path.join(dir, "trading-alert-store.json"), "{not-json", "utf8");
    const store = new TradingAlertStore({ dataDir: dir, now: () => 1786464000000 });
    assert.equal((await store.listAlerts()).length, 0);
    const names = await readdir(dir);
    assert.ok(names.some((name) => name.startsWith("trading-alert-store.json.corrupt-")));
    assert.ok(names.includes("trading-alert-store.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
