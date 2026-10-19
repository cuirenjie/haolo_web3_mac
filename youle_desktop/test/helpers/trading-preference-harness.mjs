import fs from "node:fs";
import ts from "typescript";
import { TRADING_PREFERENCE_CHOICE_FIELDS } from "../../src/shared/trading-preference-fields.mjs";

const renderer = fs.readFileSync(new URL("../../src/renderer/main.ts", import.meta.url), "utf8");
const block = renderer.slice(renderer.indexOf("const TRADING_PREFERENCE_ONBOARDING_GREETING ="), renderer.indexOf("function workflowRevisionNodePayload"));
const choices = fs.readFileSync(new URL("../../src/renderer/trading-preference-choices.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const choiceJavascript = ts.transpileModule(choices, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const settingsSource = fs.readFileSync(new URL("../../src/renderer/trading-preference-settings.ts", import.meta.url), "utf8");
const settingsJavascript = ts.transpileModule(settingsSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

// Production flow and choice logic with only application I/O replaced. This
// bootstrap runs both under node:test and inside an isolated Electron renderer.
export const harnessSource = `
function createHarness(overrides = {}) {
  const choices = (() => { const exports = {}; const require = () => ({ TRADING_PREFERENCE_CHOICE_FIELDS: ${JSON.stringify(TRADING_PREFERENCE_CHOICE_FIELDS)} }); ${choiceJavascript}; return exports; })();
  const { createTradingPreferenceSettings } = (() => { const exports = {}; const require = () => choices; ${settingsJavascript}; return exports; })();
  const runtime = { saves: [], transcripts: [], cleared: [], openedSettings: [], failSave: false, saveGate: null };
  const state = { currentThreadId: "qa-thread", items: {}, threads: [{ id: "qa-thread" }], attachments: [], auth: { authenticated: true }, binanceAccount: { status: { bound: false } } };
  const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const deps = {
    ...choices, createTradingPreferenceSettings, state, escapeHtml, escapeAttr: escapeHtml, threadNameOverrides: {}, binanceAccountLoadPromise: null,
    threadById: id => state.threads.find(thread => thread.id === id),
    isTradingExpertThreadId: () => true, isThreadBusy: () => false,
    messagesForThread: id => Object.values(state.items[id] || {}),
    sortThreadsForList: threads => threads,
    upsertItem: (id, item) => { (state.items[id] ??= {})[item.id] = item; },
    render() {}, scheduleScrollMessagesToBottom() {}, setMessageStreamFollow() {},
    openSettingsDialog: tab => runtime.openedSettings.push(tab),
    window: { requestAnimationFrame() {} },
    clearTradingExpertComposerAfterSend: id => runtime.cleared.push(id), showToast() {}, errorMessage: error => error.message,
    persistCompletedTradingExpertTranscript: async (...args) => runtime.transcripts.push(args),
    api: {
      getBinanceAccountStatus: async () => state.binanceAccount.status,
      saveTradingPreferenceProfile: async payload => {
        runtime.saves.push(payload);
        if (runtime.saveGate) await runtime.saveGate;
        if (runtime.failSave) throw new Error("QA save failure");
        return { ok: true, completed: true };
      },
    },
    ...overrides,
  };
  const h = new Function(...Object.keys(deps), ${JSON.stringify(javascript + `
    // Preserve coverage of existing in-flight legacy questionnaire handling.
    // New conversations now enter settings and never create this flow.
    function startLegacyFixture() {
      const threadId = state.currentThreadId;
      const questionItemId = "trading-preference-legacy-question-1";
      upsertItem(threadId, {id:questionItemId,type:"agentMessage",text:TRADING_PREFERENCE_QUESTION_ONE});
      tradingPreferenceOnboardingByThreadId.set(threadId, {
        stage:1, answers:{}, itemIds:[questionItemId], userStatements:[], questionItemId,
        choiceDraft:createTradingPreferenceChoiceDraft(1),
      });
      render();
    }
    return { startTradingPreferenceOnboarding, startLegacyFixture, renderTradingPreferenceChoices, bindTradingPreferenceChoiceForm,
      handleTradingPreferenceOnboardingReply, saveTradingPreferenceOnboarding, tradingPreferenceMemoryEntries,
      tradingPreferenceCompletionText, tradingPreferenceSettings, flows: tradingPreferenceOnboardingByThreadId };
  `)})(...Object.values(deps));
  return Object.assign(h, { state, runtime, choices });
}
`;

export const createHarness = new Function(`${harnessSource}; return createHarness;`)();
