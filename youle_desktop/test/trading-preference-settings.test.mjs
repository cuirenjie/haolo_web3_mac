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
  assert.equal((field.match(/type="radio"/g) || []).length, 3);
  assert.match(field, /value="right" checked/);
  assert.doesNotMatch(field, /textarea|value="custom"/);
  assert.match(field, /产品默认值/);
  assert.equal(tradingPreferenceSettingsDraft({entryMode:'right'}).entryMode, 'right');
  const saved = controller({load:async()=>({ok:true,profile:{entryMode:'auto',fieldSources:{entryMode:'user_saved'}}})});
  await saved.load();
  assert.match(saved.render(), /name="settings-preference-entryMode" value="auto" checked/);
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
