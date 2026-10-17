import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADING_PREFERENCE_CHOICE_FIELDS as fields, createTradingPreferenceChoiceDraft as draftFor,
  buildTradingPreferenceChoiceAnswer as answer, updateTradingPreferenceChoice as select,
} from "../src/renderer/trading-preference-choices.ts";
import { createHarness } from "./helpers/trading-preference-harness.mjs";
import { translateAppText } from "../src/renderer/app-language.mjs";

function custom(draft, id, text) { draft[id] = { selected: ["custom"], custom: text }; return draft; }

test("each existing preference is a separate choice and defaults retain current recommendations", () => {
  assert.deepEqual(answer(1, draftFor(1)).answers, { maxLossPerTradePercent: 2 });
  assert.deepEqual(answer(2, draftFor(2)).answers, { moveStopToBreakEven: true, breakEvenTriggerR: 1, minimumRiskRewardRatio: 0.4 });
  assert.deepEqual(answer(3, draftFor(3)).answers, { analysisStyle: "concise", requiredSections: "fixed", customRules: "" });
  for (const group of Object.values(fields)) for (const field of group) {
    assert.ok(field.placeholder);
    assert.ok(field.options.length >= 2);
    for (const text of [field.title, field.placeholder, ...field.options.map(option => option.label)]) {
      assert.doesNotMatch(translateAppText(text, "en"), /\p{Script=Han}/u, text);
    }
  }
});

test("numeric custom choices validate the explicit value and keep accompanying details", () => {
  const risk = answer(1, custom(draftFor(1), "risk", "1.25%，每日最多两次交易"));
  assert.equal(risk.answers.maxLossPerTradePercent, 1.25);
  assert.match(risk.answers.customPreferences, /每日最多两次交易/);
  for (const value of ["", "-2%", "0%", "0.001%", "101%", "1.2.3%", "不要超过", "2%或5%", "1e2%", "1/2%", "2%" + "字".repeat(281)]) {
    assert.equal(answer(1, custom(draftFor(1), "risk", value)).ok, false, value);
  }
  for (const value of ["0.01%", "100%", "百分之 0.5", "1.5%, signal confirmed"]) {
    assert.equal(answer(1, custom(draftFor(1), "risk", value)).ok, true, value);
  }
  const stage2 = custom(custom(draftFor(2), "breakEven", "1.2R，覆盖交易成本"), "ratio", "1:1.8，仅考虑净盈利");
  const result = answer(2, stage2);
  assert.equal(result.answers.breakEvenTriggerR, 1.2);
  assert.equal(result.answers.minimumRiskRewardRatio, 1.8);
  assert.match(result.answers.customPreferences, /覆盖交易成本[\s\S]*仅考虑净盈利/);
  assert.equal(answer(2, custom(stage2, "ratio", "-1:2")).ok, false);
  assert.equal(answer(2, custom(stage2, "ratio", "1:0")).ok, false);
  assert.equal(answer(2, custom(custom(stage2, "ratio", "1:0.2"), "breakEven", "不移动保本，保留原止损")).answers.moveStopToBreakEven, false);
});

test("discipline supports several choices plus arbitrary custom text without keyword filtering", () => {
  const draft = draftFor(3);
  const discipline = fields[3].find(field => field.id === "discipline");
  select(draft, discipline, "no-add", true);
  select(draft, discipline, "news", true);
  select(draft, discipline, "custom", true);
  draft.discipline.custom = "每天最多两笔，周末休息";
  const result = answer(3, draft);
  assert.equal(result.answers.customRules, "不允许亏损加仓；不在重大数据公布前开仓；每天最多两笔，周末休息");
  select(draft, discipline, "none", true);
  assert.deepEqual(draft.discipline.selected, ["none"]);
  select(draft, discipline, "custom", true);
  assert.equal(draft.discipline.custom, "每天最多两笔，周末休息");
  select(draft, discipline, "custom", false);
  assert.equal(answer(3, draft).ok, false);
});

test("custom style, structure and notes survive the production memory payload and completion summary", async () => {
  const h = createHarness();
  h.startLegacyFixture();
  const flow = h.flows.get("qa-thread");
  const draft = custom(custom(custom(draftFor(3), "style", "先给结论，再给三个理由"), "sections", "只列止损、止盈和失效条件"), "discipline", "每天最多两次");
  Object.assign(flow.answers, answer(1, custom(draftFor(1), "risk", "1.25%，每日评估风险")).answers, answer(2, draftFor(2)).answers, answer(3, draft).answers);
  flow.userStatements.push("请保存以上选项与自定义说明");
  await h.saveTradingPreferenceOnboarding("qa-thread", flow);
  assert.equal(h.runtime.saves.length, 1);
  const entries = new Map(h.runtime.saves[0].entries.map(entry => [entry.key, entry.value]));
  assert.equal(entries.get("max_loss_per_trade_percent"), 1.25);
  assert.equal(entries.get("trading_analysis_style"), "先给结论，再给三个理由");
  assert.equal(entries.get("required_analysis_sections"), "只列止损、止盈和失效条件");
  assert.equal(entries.get("user_custom_rules"), "每天最多两次");
  assert.match(entries.get("user_preference_notes"), /先给结论/);
  assert.match(h.tradingPreferenceCompletionText(flow.answers), /只列止损、止盈和失效条件/);
  assert.equal(h.flows.has("qa-thread"), false);
  assert.equal(h.runtime.transcripts.length, 1);
});

test("only the active question renders controls and legacy text replies advance the same flow", async () => {
  const h = createHarness();
  h.startLegacyFixture();
  const flow = h.flows.get("qa-thread");
  const firstId = flow.questionItemId;
  assert.match(h.renderTradingPreferenceChoices({ id: firstId, conversation_id: "qa-thread" }), /type="radio"/);
  assert.equal(h.renderTradingPreferenceChoices({ id: firstId, conversation_id: "another-thread" }), "");
  await h.handleTradingPreferenceOnboardingReply("qa-thread", "1.5%", null);
  assert.equal(flow.stage, 2);
  assert.deepEqual(flow.choiceDraft, draftFor(2));
  assert.equal(h.renderTradingPreferenceChoices({ id: firstId, conversation_id: "qa-thread" }), "");
  await h.handleTradingPreferenceOnboardingReply("qa-thread", "1.5R后保本，最低盈亏比1:2", null);
  assert.equal(flow.stage, 3);
  assert.match(h.renderTradingPreferenceChoices({ id: flow.questionItemId, conversation_id: "qa-thread" }), /type="checkbox"/);
});

test("a failed save retains all answers and exposes a retry that saves the same payload", async () => {
  const h = createHarness();
  h.startLegacyFixture();
  const flow = h.flows.get("qa-thread");
  flow.answers = { maxLossPerTradePercent: 1.25, moveStopToBreakEven: false, minimumRiskRewardRatio: 1.8, analysisStyle: "先结论", requiredSections: "止损止盈", customRules: "周末休息", customPreferences: "保留说明" };
  h.runtime.failSave = true;
  await h.saveTradingPreferenceOnboarding("qa-thread", flow);
  assert.equal(flow.stage, "save-error");
  assert.match(h.renderTradingPreferenceChoices({ id: flow.questionItemId, conversation_id: "qa-thread" }), />重试保存</);
  h.runtime.failSave = false;
  await h.saveTradingPreferenceOnboarding("qa-thread", flow);
  assert.deepEqual(h.runtime.saves[1], h.runtime.saves[0]);
  assert.equal(h.runtime.transcripts.length, 1);
});
