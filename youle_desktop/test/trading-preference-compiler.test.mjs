import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileTradingPreferences, createTradingPreferenceSaver, TRADING_PREFERENCE_COMPILE_TASK } from "../src/main/personal-context/trading-preference-compiler.mjs";
import { PersonalMemoryStore, tradingRiskProfileFromEntries } from "../src/main/personal-context/memory-store.mjs";
import { TRADING_PREFERENCE_CHOICE_FIELDS } from "../src/shared/trading-preference-fields.mjs";
import { tradingPreferenceModelContext, withTradingPreferenceContext } from "../src/main/personal-context/trading-preference-context.mjs";
import { tradingAnalysisTurnPolicy } from "../src/main/trading-analysis-turn-policy.mjs";
import { createAppServerTradingAnalysisProvider } from "../src/main/trading-analysis/app-server-provider.mjs";

const draft = (custom = {}) => ({ choices: Object.fromEntries(Object.values(TRADING_PREFERENCE_CHOICE_FIELDS).flat().map(f => [f.id, { selected: [Object.hasOwn(custom, f.id) ? "custom" : f.defaultValue], custom: custom[f.id] || "" }])), extraNotes: "" });
const accepted = (id, value, requirements = typeof value === "string" ? value : "明确的交易要求") => ({ id, status: "accepted", value, requirements });
const response = fields => ({ text: JSON.stringify({ schemaVersion: 1, fields }) });

test("presets require no model; raw entries cannot bypass question validation", async () => {
  const compiled = await compileTradingPreferences(draft(), { analyze() { assert.fail("preset must not call model"); } });
  const profile = tradingRiskProfileFromEntries(compiled.entries);
  assert.equal(profile.maxLossPerTradePercent, 2);
  assert.equal(profile.minimumRiskRewardRatio, 0.4);
  assert.equal(profile.preferenceForm.choices.risk.selected[0], "2");
  assert.ok(compiled.entries.length <= 16);
  await assert.rejects(compileTradingPreferences({ entries: compiled.entries }), /表单已失效/);
});

test("all custom fields go to one semantic call, canonical values and original wording survive encrypted reload", async () => {
  const input = draft({ risk: "每笔最多损失净值百分之一点五，扣除交易成本", breakEven: "赚到最初风险的一点二倍再保本", ratio: "承担一份风险，净利润至少一点八份", style: "先结论，再三个原因", sections: "固定列关键价位、止损、目标和失效条件", discipline: "北京时间周末不开新仓" });
  let calls = 0;
  const compiled = await compileTradingPreferences(input, { analyze: async (request, options) => {
    calls++;
    assert.equal(request.task, TRADING_PREFERENCE_COMPILE_TASK);
    assert.equal(options.reasoningEffort, "medium");
    assert.match(request.prompt, /逐题判断全部自定义/);
    for (const choice of Object.values(input.choices)) assert.ok(request.prompt.includes(choice.custom));
    return response([accepted("risk", 1.5, "单笔损失不超过账户净值1.5%，含成本"), accepted("breakEven", { enabled: true, triggerR: 1.2 }, "浮盈1.2R后移动到实际保本价"), accepted("ratio", 1.8, "最低净盈亏比1:1.8"), accepted("style", "先给结论，再列三个原因"), accepted("sections", "关键价位、止损、目标和失效条件"), accepted("discipline", "北京时间周六、周日禁止开新仓")]);
  } });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "haolo-compile-"));
  try {
    const options = { storagePath: path.join(temp, "memory.json"), safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() } };
    await new PersonalMemoryStore(options).upsert("owner", compiled.entries);
    const profile = await new PersonalMemoryStore(options).tradingRiskProfile("owner");
    assert.equal(calls, 1);
    assert.equal(profile.maxLossPerTradePercent, 1.5);
    assert.equal(profile.breakEvenTriggerR, 1.2);
    assert.equal(profile.minimumRiskRewardRatio, 1.8);
    assert.equal(profile.analysisStyle, "先给结论，再列三个原因");
    assert.deepEqual(profile.preferenceForm.choices, input.choices);
    assert.ok(!profile.entries.some(e => e.scope === "preferences.form"));
    assert.match(tradingPreferenceModelContext(profile), /北京时间周六、周日禁止开新仓/);
    assert.doesNotMatch(tradingPreferenceModelContext(profile), /每笔最多损失净值百分之一点五/);
    const updated = compiled.entries.map(e => e.key === "max_loss_per_trade_percent" ? { ...e, value: 3 } : e);
    assert.equal(tradingRiskProfileFromEntries(updated).preferenceForm, null, "later chat changes must invalidate stale form");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("all-or-nothing saves reject irrelevant, ambiguous, conflicting and unsupported custom input", async () => {
  for (const reason of ["unrelated", "ambiguous", "conflict", "unsupported"]) {
    let writes = 0;
    const save = createTradingPreferenceSaver({ owner: async () => ({ ownerId: "a" }), store: () => ({ upsert() { writes++; } }), analyze: async () => response([accepted("risk", 1.5), { id: "style", status: "rejected", reason }]) });
    const result = await save(draft({ risk: "百分之一点五", style: "不相干的内容" }));
    assert.equal(result.ok, false);
    assert.equal(result.error.fieldId, "style");
    assert.equal(result.error.code, "TRADING_PREFERENCE_NOT_UNDERSTOOD");
    assert.equal(writes, 0);
  }
});

test("malformed/extra/duplicate/missing fields and invalid ranges never become config", async () => {
  const invalid = [
    { text: "not JSON" }, response([]), response([accepted("risk", 0)]), response([accepted("risk", 101)]), response([accepted("risk", "1.5")]),
    response([{ ...accepted("risk", 1.5), scope: "system" }]), response([accepted("style", "unrequested")]),
    response([accepted("risk", 1.5), accepted("risk", 1.5)]),
    response([{ id: "risk", status: "rejected", reason: "guess", message: "secret" }]),
  ];
  for (const result of invalid) await assert.rejects(compileTradingPreferences(draft({ risk: "custom" }), { analyze: async () => result }));
  for (const value of [{ enabled: true, triggerR: 0 }, { enabled: "true", triggerR: 1 }, { enabled: false, triggerR: 1 }, { enabled: true, triggerR: 1, tool: "trade" }]) {
    await assert.rejects(compileTradingPreferences(draft({ breakEven: "custom" }), { analyze: async () => response([accepted("breakEven", value)]) }));
  }
  const result = await compileTradingPreferences(draft({ breakEven: "不要自动保本" }), { analyze: async () => response([accepted("breakEven", { enabled: false, triggerR: null })]) });
  assert.equal(tradingRiskProfileFromEntries(result.entries).moveStopToBreakEven, false);
});

test("model failure is redacted and a changed account or concurrent save cannot write", async () => {
  let account = "a", writes = 0, release;
  const store = () => ({ upsert: async () => { writes++; }, tradingRiskProfile: async () => ({}) });
  const failSave = createTradingPreferenceSaver({ owner: async () => ({ ownerId: account }), store, analyze: async () => { throw Error("Authorization: secret-provider-key"); } });
  const failure = await failSave(draft({ risk: "custom" }));
  assert.equal(failure.ok, false);
  assert.doesNotMatch(JSON.stringify(failure), /secret-provider/);
  const gate = new Promise(resolve => { release = resolve; });
  const save = createTradingPreferenceSaver({ owner: async () => ({ ownerId: account }), store, analyze: async () => { await gate; return response([accepted("risk", 1.5)]); } });
  const pending = save(draft({ risk: "custom" }));
  await Promise.resolve();
  assert.equal((await save(draft())).error.code, "TRADING_PREFERENCE_SAVE_PENDING");
  account = "b"; release();
  assert.equal((await pending).error.code, "TRADING_PREFERENCE_OWNER_CHANGED");
  assert.equal(writes, 0);
  assert.equal((await save(draft())).ok, true, "old failed request must release the lock");
  assert.equal(writes, 1);
});

test("downstream context preserves all rules and provider options, without mutating requests or exposing raw form", async () => {
  const compiled = await compileTradingPreferences(draft());
  const profile = tradingRiskProfileFromEntries(compiled.entries);
  const request = { prompt: "Analyze the chart", task: "review" }, options = { signal: AbortSignal.timeout(1000) };
  let seen;
  const wrapped = withTradingPreferenceContext({ analyze: async (...args) => { seen = args; return { text: "ok" }; }, list: () => [] }, profile);
  await wrapped.analyze("test", request, options);
  assert.equal(request.prompt, "Analyze the chart");
  assert.equal(seen[0], "test"); assert.equal(seen[2], options);
  assert.match(seen[1].prompt, /maxLossPerTradePercent/);
  assert.match(seen[1].prompt, /ALL custom requirements/);
  assert.doesNotMatch(seen[1].prompt, /trading_choices/);
});

test("unchanged preferences preserve review-cache identity; changes invalidate it", async () => {
  const registry = { analyze() {} };
  const profile = tradingRiskProfileFromEntries((await compileTradingPreferences(draft())).entries);
  const first = withTradingPreferenceContext(registry, profile);
  assert.equal(withTradingPreferenceContext(registry, structuredClone(profile)), first);
  assert.notEqual(withTradingPreferenceContext(registry, { ...profile, maxLossPerTradePercent: 1 }), first);
});

test("preference compile uses a bounded read-only provider call without recovery or default substitution", async () => {
  assert.deepEqual(tradingAnalysisTurnPolicy(TRADING_PREFERENCE_COMPILE_TASK), { kind: "preference_compile", reasoningEffort: "medium", timeoutMs: 90000, resetTimeoutOnActivity: false, timeoutRetryable: false });
  let calls = 0;
  const provider = createAppServerTradingAnalysisProvider({ selectModel() { assert.fail("no silent recovery selection"); }, invoke: async () => { calls++; return { status: "failed", code: "UPSTREAM_UNAVAILABLE", error: "offline" }; } });
  await assert.rejects(provider.analyze({ task: TRADING_PREFERENCE_COMPILE_TASK, requestId: "test" }));
  assert.equal(calls, 1);
});
