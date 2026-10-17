import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PersonalMemoryStore, tradingRiskProfileFromEntries } from "../src/main/personal-context/memory-store.mjs";
import { PersonalContextService } from "../src/main/personal-context/service.mjs";
import { DEFAULT_TRADING_PREFERENCE_ENTRIES } from "../src/main/personal-context/trading-preference-defaults.mjs";
import { createHarness } from "./helpers/trading-preference-harness.mjs";
import { createTradingPreferenceSettings, tradingPreferenceSettingsDraft } from "../src/renderer/trading-preference-settings.ts";
import { createTradingPreferenceChoiceDraft, buildTradingPreferenceChoiceAnswer } from "../src/renderer/trading-preference-choices.ts";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from([...Buffer.from(text)].map(byte => byte ^ 0xa5)),
  decryptString: bytes => Buffer.from([...bytes].map(byte => byte ^ 0xa5)).toString(),
};

test("new accounts receive the same effective defaults as the settings choices without opening or saving settings", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-default-preferences-"));
  try {
    const storagePath = path.join(directory, "memory.json");
    const store = new PersonalMemoryStore({ storagePath, safeStorage });
    const profile = await store.tradingRiskProfile("new-user");
    assert.equal(profile.maxLossPerTradePercent, 2);
    assert.equal(profile.minimumRiskRewardRatio, 0.4);
    assert.equal(profile.moveStopToBreakEven, true);
    assert.equal(profile.breakEvenTriggerR, 1);
    assert.equal(profile.analysisStyle, "concise");
    assert.match(profile.requiredAnalysisSections, /仓位健康度.*失效条件/);
    assert.equal(profile.onboardingCompleted, false);
    assert.equal(profile.entries.every(entry => entry.source === "product_default"), true);
    assert.equal((await store.list("new-user")).entries.length, 0);
    assert.equal(fs.existsSync(storagePath), false);

    const { tradingPreferenceMemoryEntries } = createHarness();
    const answers = Object.assign({}, ...[1, 2, 3].map(stage => buildTradingPreferenceChoiceAnswer(stage, createTradingPreferenceChoiceDraft(stage)).answers));
    const explicitDefaults = tradingPreferenceMemoryEntries(answers);
    for (const entry of DEFAULT_TRADING_PREFERENCE_ENTRIES) {
      assert.equal(entry.value, explicitDefaults.find(value => value.scope === entry.scope && value.key === entry.key)?.value, entry.key);
    }

    const service = new PersonalContextService({ memoryStore: store, accountService: {}, resolveOwner: async () => ({ ownerId: "new-user" }) });
    const memory = await service.invoke({ tool: "read_user_memory", arguments: { scopes: ["trading.risk"], keys: ["max_loss_per_trade_percent"] } });
    assert.equal(memory.entries.length, 1);
    assert.equal(memory.entries[0].value, 2);
    assert.equal(memory.entries[0].source, "product_default");
    assert.equal(fs.existsSync(storagePath), false);

    let writes = 0;
    const settings = createTradingPreferenceSettings({ load: async () => ({ ok: true, profile }), save: async () => { writes++; return { ok: true, completed: true }; }, memoryEntries: tradingPreferenceMemoryEntries, render() {}, onSaved() {} });
    await settings.load();
    assert.match(settings.render(), /默认交易偏好生效/);
    assert.match(settings.render(), /data-preference-save disabled/);
    assert.equal(writes, 0);
    assert.deepEqual(tradingPreferenceSettingsDraft(profile).choices.discipline.selected, ["none"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("saved preferences replace defaults, survive restart, and remain isolated by account", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-default-overrides-"));
  try {
    const storagePath = path.join(directory, "memory.json");
    let store = new PersonalMemoryStore({ storagePath, safeStorage });
    await store.upsert("owner-a", [
      { scope: "trading.risk", kind: "constraint", key: "max_loss_per_trade_percent", value: 10, strength: "hard" },
      { scope: "trading.risk", kind: "constraint", key: "minimum_risk_reward_ratio", value: 0.2, strength: "hard" },
      { scope: "trading.exit", kind: "preference", key: "move_stop_to_break_even", value: false },
      { scope: "trading.discipline", kind: "constraint", key: "user_custom_rules", value: "不在周末交易", strength: "hard" },
    ]);
    store = new PersonalMemoryStore({ storagePath, safeStorage });
    const profile = await store.tradingRiskProfile("owner-a");
    assert.equal(profile.maxLossPerTradePercent, 10);
    assert.equal(profile.minimumRiskRewardRatio, 0.2);
    assert.equal(profile.moveStopToBreakEven, false);
    assert.equal(profile.analysisStyle, "concise");
    assert.equal(profile.entries.find(entry => entry.key === "user_custom_rules").value, "不在周末交易");
    assert.equal(profile.entries.filter(entry => entry.key === "max_loss_per_trade_percent").length, 1);
    assert.equal(profile.entries.find(entry => entry.key === "max_loss_per_trade_percent").source, "user_explicit");
    assert.equal((await store.tradingRiskProfile("owner-b")).maxLossPerTradePercent, 2);
    await store.remove("owner-a", { keys: ["max_loss_per_trade_percent"] });
    assert.equal((await store.tradingRiskProfile("owner-a")).maxLossPerTradePercent, 2);
    const contents = fs.readFileSync(storagePath, "utf8");
    assert.doesNotMatch(contents, /product_default|不在周末交易|max_loss_per_trade_percent/);
    fs.writeFileSync(storagePath, "corrupt");
    await assert.rejects(store.tradingRiskProfile("owner-a"), error => error.code === "MEMORY_STORE_INVALID");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("legacy keys and explicit false values are never masked by canonical defaults", () => {
  const profile = tradingRiskProfileFromEntries([
    { scope: "trading", key: "max_loss_per_trade_percent", value: 8 },
    { scope: "trading", key: "move_stop_to_break_even", value: false },
    { scope: "trading", key: "minimum_risk_reward_ratio", value: 0.25 },
  ]);
  assert.equal(profile.maxLossPerTradePercent, 8);
  assert.equal(profile.moveStopToBreakEven, false);
  assert.equal(profile.minimumRiskRewardRatio, 0.25);
});

test("conversation Start navigates to trading settings without questions, messages, or writes", () => {
  const h = createHarness();
  const threads = structuredClone(h.state.threads);
  h.startTradingPreferenceOnboarding();
  assert.deepEqual(h.runtime.openedSettings, ["trading"]);
  assert.equal(h.flows.size, 0);
  assert.deepEqual(h.state.items, {});
  assert.deepEqual(h.state.threads, threads);
  assert.equal(h.runtime.saves.length, 0);
  assert.equal(h.runtime.transcripts.length, 0);
});
