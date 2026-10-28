import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTradingPreferenceSettings, tradingPreferenceSettingsDraft, NO_CUSTOM_TRADING_RULES, NO_CUSTOM_TRADING_NOTES } from "../src/renderer/trading-preference-settings.ts";
import { createTradingPreferenceChoiceDraft, buildTradingPreferenceChoiceAnswer } from "../src/renderer/trading-preference-choices.ts";
import { PersonalMemoryStore, tradingRiskProfileFromEntries } from "../src/main/personal-context/memory-store.mjs";
import { createHarness } from "./helpers/trading-preference-harness.mjs";
import { compileTradingPreferences } from "../src/main/personal-context/trading-preference-compiler.mjs";

const { tradingPreferenceMemoryEntries: entriesFor } = createHarness();
const profileFor = answers => tradingRiskProfileFromEntries(entriesFor(answers));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const controller = overrides => createTradingPreferenceSettings({ load: async () => ({ ok: true, profile: profileFor({}) }), save: async () => ({ ok: true, completed: true }), memoryEntries: entriesFor, render() {}, onSaved() {}, ...overrides });

test("entry approach is the first question, defaults to right and has no custom answer", async () => {
  const editor = controller();
  await editor.load();
  const view = editor.render();
  assert.ok(view.indexOf('data-preference-field="entryMode"') < view.indexOf('data-preference-field="risk"'));
  const field = view.match(/<fieldset data-preference-field="entryMode"[\s\S]*?<\/fieldset>/)[0];
  assert.equal((field.match(/type="radio"/g) || []).length, 2);
  assert.match(field, /value="right" checked/);
  assert.doesNotMatch(field, /textarea|value="custom"/);
  assert.match(field, /产品默认值/);
  assert.equal(tradingPreferenceSettingsDraft({entryMode:'right'}).entryMode, 'right');
  const saved = controller({load:async()=>({ok:true,profile:{entryMode:'auto',fieldSources:{entryMode:'user_saved'}}})});
  await saved.load();
  assert.match(saved.render(), /name="settings-preference-entryMode" value="right" checked/);
  assert.doesNotMatch(saved.render(), /value="auto"|自动判断/);
  assert.match(saved.render(), /data-preference-source="entryMode">已保存的偏好/);
});

test("saved onboarding answers restore preset, custom and multiple selections", () => {
  const answers = {
    maxLossPerTradePercent: 1.25, moveStopToBreakEven: false, breakEvenTriggerR: 1,
    minimumRiskRewardRatio: 1.8, analysisStyle: "先给结论，再解释", requiredSections: "adaptive",
    customRules: "不允许亏损加仓；不在重大数据公布前开仓；每天最多两笔；周末休息",
    customPreferences: "单笔最大亏损占账户净值的比例：1.25%，信号充分时交易\n何时将止损移动到保本位置？：不移动保本，保留原止损\n最低可接受的净盈亏比：1:1.8，仅考虑净盈利",
  };
  const draft = tradingPreferenceSettingsDraft(profileFor(answers));
  assert.deepEqual(draft.choices.risk, { selected: ["custom"], custom: "1.25%，信号充分时交易" });
  assert.deepEqual(draft.choices.discipline, { selected: ["no-add", "news", "custom"], custom: "每天最多两笔；周末休息" });
  assert.equal(draft.extraNotes, "");
  const rebuilt = Object.assign({}, ...[1, 2, 3].map(stage => buildTradingPreferenceChoiceAnswer(stage, draft.choices).answers));
  for (const [key, value] of Object.entries(answers)) if (key !== "customPreferences") assert.equal(rebuilt[key], value, key);
  const standard = tradingPreferenceSettingsDraft(profileFor({ maxLossPerTradePercent: 3, minimumRiskRewardRatio: 2, analysisStyle: "detailed" }));
  assert.deepEqual(standard.choices.risk.selected, ["3"]);
  assert.deepEqual(standard.choices.ratio.selected, ["2"]);
  assert.deepEqual(standard.choices.style.selected, ["detailed"]);
  assert.deepEqual(standard.choices.sections.selected, ["fixed"]);
});

test("custom explanations matching presets and multiline content survive reload", () => {
  const choices = Object.assign({}, ...[1, 2, 3].map(createTradingPreferenceChoiceDraft));
  choices.risk = { selected: ["custom"], custom: "2%，确认趋势\n等待回踩" };
  choices.style = { selected: ["custom"], custom: "先给结论\n再列理由" };
  const answers = {};
  const notes = [];
  for (const stage of [1, 2, 3]) {
    const result = buildTradingPreferenceChoiceAnswer(stage, choices);
    Object.assign(answers, result.answers);
    if (result.answers.customPreferences) notes.push(result.answers.customPreferences);
  }
  answers.customPreferences = notes.join("\n");
  const loaded = tradingPreferenceSettingsDraft(profileFor(answers));
  assert.deepEqual(loaded.choices.risk, choices.risk);
  assert.deepEqual(loaded.choices.style, choices.style);
  assert.equal(loaded.extraNotes, "");
});

test("settings saves through the encrypted store, replacing cleared optional memories and preserving unrelated entries", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-preferences-settings-"));
  const storagePath = path.join(directory, "memory.json");
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: buffer => buffer.toString() };
  try {
    const store = new PersonalMemoryStore({ storagePath, safeStorage });
    const oldEntries = entriesFor({ customRules: "只在周一交易", customPreferences: "原有说明" });
    await store.upsert("qa-owner", [...oldEntries, { scope: "trading.risk", kind: "constraint", key: "max_leverage", value: 4, strength: "hard" }]);
    // The UI produces explicit empty selections, while the database still has
    // the previous custom values. Saving must replace, not merely omit them.
    const editor = controller({
      save: async payload => {
        await store.upsert("qa-owner", (await compileTradingPreferences(payload)).entries);
        const profile = await store.tradingRiskProfile("qa-owner");
        return { ok: true, completed: profile.onboardingCompleted, profile };
      },
    });
    await editor.load();
    await editor.save();
    const reopened = new PersonalMemoryStore({ storagePath, safeStorage });
    const profile = await reopened.tradingRiskProfile("qa-owner");
    assert.equal(profile.entries.find(entry => entry.key === "user_custom_rules").value, NO_CUSTOM_TRADING_RULES);
    assert.equal(profile.entries.find(entry => entry.key === "user_preference_notes").value, NO_CUSTOM_TRADING_NOTES);
    assert.equal(profile.maxLeverage, 4);
    assert.deepEqual(tradingPreferenceSettingsDraft(profile).choices.discipline.selected, ["none"]);
    assert.equal(tradingPreferenceSettingsDraft(profile).extraNotes, "");
    assert.match(editor.render(), /交易偏好已保存/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("failed load cannot overwrite an existing profile with defaults; retry loads the saved answers", async () => {
  let fail = true;
  let saves = 0;
  const editor = controller({
    load: async () => { if (fail) throw new Error("offline"); return { ok: true, profile: profileFor({ maxLossPerTradePercent: 0.5 }) }; },
    save: async () => { saves++; return { ok: true, completed: true }; },
  });
  await editor.load();
  assert.match(editor.render(), /data-preference-retry/);
  assert.doesNotMatch(editor.render(), /data-preference-save/);
  await editor.save();
  assert.equal(saves, 0);
  fail = false;
  await editor.load();
  assert.match(editor.render(), /name="settings-preference-risk" value="0.5" checked/);
});

test("save failure retains choices, suppresses duplicate saves, and can retry", async () => {
  const gate = deferred();
  const payloads = [];
  let fail = true;
  const editor = controller({
    load: async () => ({ ok: true, profile: profileFor({ maxLossPerTradePercent: 1.5, customRules: "<img src=x onerror=alert(1)>" }) }),
    save: async payload => { payloads.push(payload); await gate.promise; if (fail) throw new Error("offline"); return { ok: true, completed: true }; },
  });
  await editor.load();
  assert.doesNotMatch(editor.render(), /<img src=x/);
  const pending = editor.save();
  await editor.save();
  assert.equal(payloads.length, 1);
  gate.resolve();
  await pending;
  assert.match(editor.render(), /已保留你的修改/);
  fail = false;
  await editor.save();
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal(payloads[1].choices.risk.custom, "1.5%");
});

test("successful cloud saves do not require the legacy onboarding completion flag", async () => {
  for (const entryMode of ["left", "right", "auto"]) {
    for (const completed of [false, undefined]) {
      let completions = 0;
      const profile = {
        entryMode, onboardingCompleted: false,
        fieldSources: { entryMode: "user_saved", risk: "product_default" },
      };
      const editor = controller({
        save: async () => ({ ok: true, profile, ...(completed === undefined ? {} : { completed }) }),
        onSaved: () => { completions++; },
      });
      await editor.load();
      await editor.save();
      assert.equal(completions, 1);
      const view = editor.render();
      assert.match(view, /交易偏好已保存/);
      assert.match(view, /role="alert" hidden/);
      assert.match(view, /data-preference-save disabled/);
      assert.match(view, new RegExp(`name="settings-preference-entryMode" value="${entryMode === "auto" ? "right" : entryMode}" checked`));
      assert.match(view, /data-preference-source="entryMode">已保存的偏好/);
      assert.match(view, /data-preference-source="risk">产品默认值/);
    }
  }
});

test("legacy onboarding completion cannot turn a rejected save into success", async () => {
  let completions = 0;
  const editor = controller({
    save: async () => ({ ok: false, completed: true, error: { message: "云端保存失败" } }),
    onSaved: () => { completions++; },
  });
  await editor.load();
  await editor.save();
  assert.equal(completions, 0);
  assert.match(editor.render(), /云端保存失败/);
  assert.doesNotMatch(editor.render(), /交易偏好已保存/);
});

test("account reset ignores stale load/save completions", async () => {
  const read = deferred();
  let completions = 0;
  let renders = 0;
  const editor = controller({ load: () => read.promise, render: () => { renders++; }, onSaved: () => { completions++; } });
  const pending = editor.load();
  editor.reset();
  read.resolve({ ok: true, profile: profileFor({ maxLossPerTradePercent: 3 }) });
  await pending;
  assert.equal(renders, 1);
  assert.doesNotMatch(editor.render(), /data-trading-settings/);
  const write = deferred();
  const savingEditor = controller({ save: () => write.promise, onSaved: () => { completions++; } });
  await savingEditor.load();
  const saving = savingEditor.save();
  savingEditor.reset();
  write.resolve({ ok: true, completed: true });
  await saving;
  assert.equal(completions, 0);
  assert.doesNotMatch(savingEditor.render(), /交易偏好已保存/);
});

test("natural-language custom answers reach the model boundary and rejected fields retain the draft", async () => {
  const form = { choices: Object.assign({}, ...[1, 2, 3].map(createTradingPreferenceChoiceDraft)), extraNotes: "" };
  form.choices.risk = { selected: ["custom"], custom: "每笔止损最多亏账户净值百分之一点五" };
  let received, completions = 0;
  const editor = controller({ load: async () => ({ ok: true, profile: { ...profileFor({}), preferenceForm: form } }),
    save: async payload => { received = payload; return { ok: false, error: { fieldId: "risk", message: "无法明确理解自定义要求，请补充清晰的数值、口径或条件。" } }; },
    onSaved: () => { completions++; } });
  await editor.load(); await editor.save();
  assert.deepEqual(received.choices.risk, form.choices.risk);
  assert.equal(completions, 0);
  assert.match(editor.render(), /保存失败/);
  assert.match(editor.render(), /每笔止损最多亏账户净值百分之一点五/);
});

test("migration conflict displays both answers, escapes content and blocks ordinary saves", async () => {
  let saves = 0;
  const editor = controller({
    load: async () => ({ ok: true, profile: profileFor({}), migration: {
      code: "PREFERENCE_IMPORT_CONFLICT", fields: [{ fieldId: "risk",
        local: { selected: ["custom"], custom: '<img src=x onerror="bad()">' }, cloud: { selected: ["2"], custom: "" } }],
    } }),
    save: async () => { saves++; return { ok: true, completed: true }; },
  });
  await editor.load();
  const view = editor.render();
  assert.match(view, /核对本地与云端/);
  assert.match(view, /本地保存的答案/);
  assert.match(view, /云端保存的答案/);
  assert.doesNotMatch(view, /<img src=x/);
  assert.match(view, /data-migration-resolve disabled/);
  assert.doesNotMatch(view, /data-migration-field="risk"[^>]+checked/);
  await editor.save();
  assert.equal(saves, 0);
});

test("unknown legacy provenance stays reviewable and never preselects import", async () => {
  const editor = controller({ load: async () => ({ ok: true, profile: profileFor({}), migration: {
    code: "PREFERENCE_IMPORT_REVIEW_REQUIRED", fields: [], localEntries: [{ key: "max_leverage", value: 3 }],
  } }) });
  await editor.load();
  const view = editor.render();
  assert.match(view, /max_leverage：3/);
  assert.match(view, /原始记录仍保留在本机/);
  assert.match(view, /data-migration-keep-cloud/);
  assert.doesNotMatch(view, /data-migration-resolve/);
});

test("settings carry the displayed cloud revision through saves and reload on reopening", async () => {
  let remoteRevision = 3;
  const payloads = [];
  const editor = controller({
    load: async () => ({ ok: true, revision: remoteRevision, profile: profileFor({ maxLossPerTradePercent: 1 }) }),
    save: async payload => {
      payloads.push(payload);
      return { ok: true, completed: true, revision: ++remoteRevision, profile: profileFor({ maxLossPerTradePercent: 1 }) };
    },
  });
  await editor.load();
  await editor.save();
  await editor.save();
  assert.deepEqual(payloads.map(p => p.expectedRevision), [3, 4]);
  remoteRevision = 9;
  editor.beginSession();
  await editor.load();
  await editor.save();
  assert.equal(payloads.at(-1).expectedRevision, 9);
});

test("restore defaults saves all fields, clears custom content and survives reopening", async () => {
  let stored = { ...profileFor({ maxLossPerTradePercent: 1.25, minimumRiskRewardRatio: 2,
    moveStopToBreakEven: false, analysisStyle: "detailed", requiredSections: "adaptive",
    customRules: "只在周一交易", customPreferences: "仅交易熟悉的币种" }), entryMode: "left" };
  const payloads = [];
  let notifications = 0;
  const editor = controller({
    load: async () => ({ ok: true, revision: 7, profile: stored }),
    save: async payload => {
      payloads.push(payload);
      stored = { ...tradingRiskProfileFromEntries((await compileTradingPreferences(payload)).entries), entryMode: payload.entryMode };
      return { ok: true, revision: 8, profile: stored };
    },
    onSaved: () => { notifications++; },
  });
  await editor.load();
  await editor.restoreDefaults();
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].expectedRevision, 7);
  assert.deepEqual(payloads[0].changedFields.slice().sort(), ["breakEven", "discipline", "entryMode", "extraNotes", "ratio", "risk", "sections", "style"]);
  assert.deepEqual(payloads[0].choices, tradingPreferenceSettingsDraft().choices);
  assert.equal(payloads[0].extraNotes, "");
  assert.equal(stored.entryMode, "right");
  assert.equal(stored.maxLossPerTradePercent, 2);
  assert.equal(stored.minimumRiskRewardRatio, 0.4);
  assert.equal(stored.moveStopToBreakEven, true);
  assert.equal(stored.breakEvenTriggerR, 1);
  assert.equal(stored.analysisStyle, "concise");
  assert.equal(stored.entries.find(entry => entry.key === "user_custom_rules").value, NO_CUSTOM_TRADING_RULES);
  assert.equal(stored.entries.find(entry => entry.key === "user_preference_notes").value, NO_CUSTOM_TRADING_NOTES);
  assert.equal(notifications, 1);
  editor.beginSession();
  await editor.load();
  assert.match(editor.render(), /name="settings-preference-risk" value="2" checked/);
  assert.doesNotMatch(editor.render(), /仅交易熟悉的币种|只在周一交易/);
});

test("restore defaults prevents duplicate saves and retains the full default draft for retry", async () => {
  const gate = deferred();
  const payloads = [];
  let fail = true;
  const editor = controller({
    load: async () => ({ ok: true, revision: 4, profile: profileFor({ maxLossPerTradePercent: 3 }) }),
    save: async payload => {
      payloads.push(payload); await gate.promise;
      if (fail) throw Error("offline");
      return { ok: true, revision: 5 };
    },
  });
  await editor.load();
  const restoring = editor.restoreDefaults();
  await editor.restoreDefaults(); await editor.save();
  assert.equal(payloads.length, 1);
  assert.match(editor.render(), /data-preference-restore disabled/);
  gate.resolve(); await restoring;
  assert.match(editor.render(), /已保留你的修改/);
  assert.match(editor.render(), /name="settings-preference-risk" value="2" checked/);
  fail = false;
  await editor.save();
  assert.deepEqual(payloads[1], payloads[0]);
  assert.match(editor.render(), /交易偏好已保存/);
});

test("restore defaults cannot overwrite unread, migrating or unconfirmed preferences", async () => {
  let writes = 0;
  const editor = controller({ load: async () => { throw Error("offline"); }, save: async () => { writes++; } });
  await editor.restoreDefaults(); await editor.load(); await editor.restoreDefaults();
  assert.equal(writes, 0);
  const migrating = controller({
    load: async () => ({ ok: true, profile: profileFor({}), migration: { code: "PREFERENCE_IMPORT_CONFLICT", fields: [] } }),
    save: async () => { writes++; },
  });
  await migrating.load(); await migrating.restoreDefaults();
  assert.equal(writes, 0);
  assert.match(migrating.render(), /data-preference-restore disabled/);
  for (const code of ["TRADING_PREFERENCE_SAVE_UNCONFIRMED", "TRADING_PREFERENCE_CONFIRMATION_PENDING", "PREFERENCE_UPDATED_AFTER_SAVE"]) {
    const pending = controller({ save: async () => { writes++; return { ok: false, error: { code, message: "请核对" } }; } });
    await pending.load(); await pending.save();
    const before = writes;
    await pending.restoreDefaults();
    assert.equal(writes, before);
    assert.match(pending.render(), /data-preference-restore disabled/);
  }
});
