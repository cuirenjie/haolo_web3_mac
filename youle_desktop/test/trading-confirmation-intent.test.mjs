import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { alertConfirmationIntentPrompt, parseAlertConfirmationIntent } from "../src/main/trading-confirmation-intent.mjs";

test("confirmation policy distinguishes current consent from questions, revisions and quoted approval", () => {
  const prompt = alertConfirmationIntentPrompt({ userText: "按刚才展示的条件帮我设好吧", sourceText: "收盘突破 100",
    lastAssistantMessage: "模拟的是收盘突破 100；是否创建？" });
  assert.ok(prompt.includes("按刚才展示的条件帮我设好吧"));
  assert.match(prompt, /no required keyword/);
  assert.match(prompt, /Negation and requested changes take precedence/);
  assert.match(prompt, /Acknowledging receipt or understanding alone is not consent/);
  assert.match(prompt, /Only the latest user reply/);
});

test("malformed and low-confidence decisions fail closed without affirmative-word fallback", () => {
  for (const value of ["确认", "yes", '{"intent":"confirm"}', '{"intent":"confirm","confidence":"1"}',
    '{"intent":"confirm","confidence":2}', '{"intent":"approve","confidence":1}', "```json\n{}\n```"]) {
    assert.equal(parseAlertConfirmationIntent(value).ok, false);
  }
  assert.equal(parseAlertConfirmationIntent('{"intent":"confirm","confidence":0.7}').intent, "unclear");
  for (const intent of ["confirm", "cancel", "revise", "unclear"]) {
    assert.equal(parseAlertConfirmationIntent(JSON.stringify({ intent, confidence: 0.95 })).intent, intent);
  }
});

test("long replies retain late negation and all preview conditions", () => {
  const actualUserReply = "确认。".repeat(2000) + "但最后不要创建，先改条件。";
  const displayedPreview = "条件。".repeat(2500) + "收盘突破 200 才触发";
  const prompt = alertConfirmationIntentPrompt({ userText: actualUserReply, lastAssistantMessage: displayedPreview });
  const data = JSON.parse(prompt.split("\n\n").at(-1));
  assert.equal(data.actualUserReply, actualUserReply);
  assert.equal(data.displayedPreview, displayedPreview);
});

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
function load(name, globals) {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node);
  const js = ts.transpileModule(node.getText(ast) + `\nexports.run=${name};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, ...globals });
  return exports.run;
}

test("actual confirmation bridge uses the latest reply and pending preview in a read-only internal call", async () => {
  const calls = [];
  let response = '{"intent":"confirm","confidence":0.99}';
  const classify = load("classifyTradingConfirmationIntent", {
    api: { sendProviderChat: async params => { calls.push(params); return { text: response }; } },
    personalStrategyUnderstandingModels: () => [{ provider: "fixture", model: "semantic-model" }],
    confirmInsufficientAvailableBalanceBeforeSend: async () => false,
    alertConfirmationIntentPrompt, parseAlertConfirmationIntent,
    PERSONAL_STRATEGY_MAX_RETRIES: 0,
    crypto: { randomUUID: () => "semantic-turn" },
    PROVIDER_CHAT_META: {},
    threadWorkspaceCwd: () => "fixture-workspace",
    updateTradingExpertThinkingState() {}, refreshTradingExpertConversationSurface() {},
    personalStrategyProviderResultError: () => null,
    firstString: (...values) => values.find(value => typeof value === "string" && value),
    personalStrategyPipelineError: (code, message) => Object.assign(new Error(message), { code }),
    classifyPersonalStrategyFailure: error => ({ retryable: false, userMessage: error.message }),
  });
  const previous = { sourceText: "收盘突破 200",
    conversation: [{ role: "assistant", text: "旧模拟" }, { role: "assistant", text: "当前模拟：突破 200 后通知。" }] };
  assert.equal((await classify("t", "照这个设好吧", previous, "alert")).intent, "confirm");
  const sent = calls[0];
  const quoted = JSON.parse(sent.text.split("\n\n").at(-1));
  assert.equal(quoted.actualUserReply, "照这个设好吧");
  assert.equal(quoted.displayedPreview, previous.conversation.at(-1).text);
  assert.equal(quoted.originalRule, previous.sourceText);
  assert.equal(sent.sourceType, "personal-strategy-understanding-confirmation-intent");
  assert.equal(sent.modelCapability, "question_answer");
  assert.equal(sent.stream, false);
  assert.equal(sent.messages[0].content, sent.text);
  response = '{"intent":"confirm","confidence":0.1}';
  assert.equal((await classify("t", "确认", previous, "alert")).intent, "unclear");
  response = "确认";
  assert.equal((await classify("t", "确认", previous, "alert")).ok, false);
});

function harness(decide) {
  const calls = [], states = new Map(), runs = new Map();
  const previous = { stage: "confirmation", draftId: "draft", simulationId: "sim", confirmationId: "binding",
    sourceText: "close above 100", conversation: [{ role: "assistant", text: "preview" }] };
  states.set("t", previous);
  const globals = {
    state: { tradingAlerts: { loaded: true }, currentThreadId: "t" },
    api: {
      tradingAlertsCompile: async () => { throw new Error("confirm must not compile"); },
      tradingAlertsSimulate: async () => { throw new Error("confirm must not simulate"); },
      tradingAlertsConfirm: async input => { calls.push(input); return { alert: { alertId: "created", rule: {} } }; },
      tradingAlertsSnapshot: async () => ({}),
    },
    tradingAlertConversationByThreadId: states, tradingAlertConversationRunByThreadId: runs,
    tradingAlertConversationStateForThread: id => states.get(id), stripTradingAlertMention: t => t,
    classifyTradingConfirmationIntent: async (thread, text, context, kind) => {
      assert.equal(kind, "alert"); assert.equal(context, previous);
      return decide(text);
    },
    updateTradingExpertThinkingState: () => {}, refreshTradingExpertConversationSurface: () => {},
    clearTradingExpertThinkingState: () => false, clearTradingExpertAlertSimulation: () => {},
    persistTradingAlertAssistantItem: async () => {}, persistTradingAlertCreationSuccessItem: async () => {},
    tradingAlertResponseData: r => r, firstString: (...v) => v.find(x => typeof x === "string" && x),
    refreshTradingAlertsAndRequireAlert: async () => ({ status: "monitoring" }),
    isInsufficientQuotaError: () => false, errorMessage: e => e.message,
  };
  return { calls, states, runs, run: load("runTradingAlertConversation", globals) };
}

for (const text of ["按刚才展示的条件帮我设好吧", "就照这个模拟开始监控", "Please go ahead with the conditions shown", "照剛才的條件設定即可"]) {
  test(`semantic acceptance reaches original version-bound alert commit: ${text}`, async () => {
    const h = harness(actual => { assert.equal(actual, text); return { ok: true, intent: "confirm", confidence: 0.99 }; });
    const result = await h.run("t", text, { skillOperation: "confirm" });
    assert.equal(result.confirmed, true);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { draftId: "draft", simulationId: "sim", confirmationId: "binding" });
  });
}
for (const [text, intent] of [["先别建了", "cancel"], ["可以，但改成 200", "revise"], ["这个会怎么提醒我？", "unclear"]]) {
  test(`a model choosing confirm cannot override actual reply intent: ${text}`, async () => {
    const h = harness(() => ({ ok: true, intent, confidence: 0.99 }));
    const result = await h.run("t", text, { skillOperation: "confirm" });
    assert.equal(result.confirmed, false); assert.equal(h.calls.length, 0);
    if (intent === "cancel") assert.equal(h.states.has("t"), false);
    if (intent === "revise") { assert.equal(result.needsRevision, true); assert.equal(h.states.get("t").simulationId, undefined); }
  });
}
test("semantic outage and cancellation during understanding never commit", async () => {
  let h = harness(() => ({ ok: false, intent: "unclear" }));
  assert.equal((await h.run("t", "确认", { skillOperation: "confirm" })).confirmed, false);
  assert.equal(h.calls.length, 0);
  h = harness(() => { h.runs.delete("t"); return { ok: true, intent: "confirm" }; });
  assert.equal((await h.run("t", "照这个设好吧", { skillOperation: "confirm" })).confirmed, false);
  assert.equal(h.calls.length, 0);
});
