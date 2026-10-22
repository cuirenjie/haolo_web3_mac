import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const functionSource = name => {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(ast);
};
// Execute the production send pipeline from optimistic user-message creation
// through dispatch/finally. Only surrounding app state and asynchronous I/O
// are replaced, so a fast classifier followed by slow preflight is reproducible.
const send = functionSource("sendCurrentMessage");
const pipeline = send.slice(send.indexOf("  const composerGroupIdForSend ="));
const javascript = ts.transpileModule(`
async function submit() {
  let threadId = state.currentThreadId;
  const text = "@策略:裸K分析", tradingExpertRoutingText = text, input = null;
  const workflowContractAtSend = null, workflowMainTextAtSend = text;
  const tradingStrategyAtSend = general ? null : strategy;
  const tradingStrategiesToRunAtSend = general ? [] : [strategy];
  const tradingGeneralCandidateAtSend = general;
  const personalStrategyCandidateAtSend = false, tradingAlertCandidateAtSend = false;
  const businessContextId = "frozen-context";
  let businessContextHandedOff = false;
  let tradingAnalysisTargetAtSend = {};
  let tradingStrategyRequestAtSend = null, tradingGeneralRequestAtSend = null;
  const tradingStrategyRequestsAtSend = [];
  ${pipeline}
${["updateTradingExpertThinkingState", "clearTradingExpertThinkingState", "tradingExpertThinkingStage", "withThinkingMessage"].map(functionSource).join("\n")}
`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness({ general = false, mode = "chart-analysis", access = "available", promoteFailure = false, persistFailure = false, budgetOk = true } = {}) {
  const gates = Object.fromEntries(["classify", "access", "promote", "persist", "analyze", "context"].map(name => [name, { entered: deferred(), release: deferred() }]));
  const frames = [], calls = [], aliases = new Map(), thinking = new Map();
  const state = { currentThreadId: "draft", items: {}, attachments: [], composerQuote: null, settings: {} };
  const noop = () => {}, identity = value => value;
  const resolveThread = id => aliases.has(id) ? resolveThread(aliases.get(id)) : id;
  async function stage(name, result) {
    calls.push(name);
    gates[name].entered.resolve();
    await gates[name].release.promise;
    return result;
  }
  function replaceThread(from, to) {
    aliases.set(from, to);
    if (thinking.has(from)) { thinking.set(to, thinking.get(from)); thinking.delete(from); }
    state.items[to] = state.items[from];
    state.currentThreadId = to;
    return to;
  }
  const strategy = { id: "price-action", ui: { classificationMessage: "正在识别裸K分析请求", preparingMessage: "正在准备裸K分析" } };
  const deps = {
    businessModelPoolsState: { configured: false },
    hasThreadCodexWork: () => false, threadsAwaitingAgentReply: new Set(), setCodexThreadBusy: noop,
    beginCodexSend: () => "send", prepareThreadReferencesForSend: async () => ({ ok: true }),
    sendAgentText: async (...args) => { calls.push({ root: args }); await stage("analyze"); },
    codexTradingTools: { updateAttachments: noop, release: id => calls.push({ released: id }) },
    state, general, strategy, console: { warn: noop }, api: {},
    tradingExpertThinkingStateByThreadId: thinking,
    submittingComposerThreadIds: new Set(), localHistoryAheadThreadIds: new Set(),
    tradingStrategyAnalysisTargetByRequest: new Map(),
    groupIdForThreadContext: () => null, isDefaultThreadGroup: () => true,
    syncTradingExpertCollapseControlsState: noop, expandSystemDashboardForNewMessage: noop, cloneLocalAttachments: identity,
    mediaCreationSubmissionAttachments: (_id, attachments) => attachments,
    cloneComposerQuote: identity, activeComposerThreadReferences: () => [],
    clearTradingExpertComposerAfterSend: noop, commitSelectedNewThreadGroupForSend: noop,
    revealThreadGroupForComposerSend: () => false, isImageAttachment: () => false,
    hasTradingExpertCurrentAnalysis: () => false, selectedChatModelValue: () => "gpt-5.6-sol",
    threadModelSelection: () => null, syncThinkingElapsedTimer: noop,
    classifyTradingStrategyForSend: () => stage("classify", { mode }),
    classifyTradingGeneralRequestForSend: () => stage("classify", { mode }),
    confirmPremiumTradingAccessBeforeSend: () => stage("access", access),
    async promoteLocalBlankThreadForSend(id) {
      await stage("promote");
      if (promoteFailure) throw new Error("create failed");
      return replaceThread(id, "promoted");
    },
    async persistTradingExpertTranscriptItems(id) {
      await stage("persist");
      // A recovered thread can be adopted before persistence finally fails.
      const next = replaceThread(id, "recovered");
      if (persistFailure) throw new Error("store unavailable");
      return { threadId: next };
    },
    queueTradingExpertTranscriptPersistenceRetry: () => calls.push("retry"),
    recordRendererTranscriptDiagnostic: noop,
    rebindTradingExpertAnalysisTargetStorageSession: identity,
    beginPendingComposerSend(id) {
      const item = { id: "user", type: "userMessage", text: "@策略:裸K分析" };
      state.items[id] = { [item.id]: item };
      return { threadId: id, itemId: item.id, attachments: [], threadReferences: [] };
    },
    setPendingComposerSendStatus: () => null, movePendingComposerSend: () => null,
    pendingComposerSendForThread: () => null, clearPendingComposerSend: noop,
    failPendingComposerSend: () => calls.push("failed"),
    showToast: noop, errorMessage: error => error.message,
    INSUFFICIENT_QUOTA_MESSAGE: "quota", appendInsufficientQuotaAgentMessage: noop,
    messageAttachmentFromLocal: identity, consumptionVisibleQuestion: identity,
    channelIdFromThreadId: () => null, providerFromThreadId: () => null,
    composerAgentText: identity, tradingExpertAgentTextForSend: identity,
    isMultiModelClusterThread: () => false, setMessageStreamFollow: noop,
    conversationTitleFromText: identity, userMessageDisplayText: item => item.text,
    firstString: (...values) => values.find(value => typeof value === "string" && value),
    itemStableId: item => item.id, scheduleThreadListRefresh: noop,
    resolvedTradingAlertThreadId: resolveThread, resolveTradingExpertAnalysisThreadId: resolveThread,
    releaseTradingExpertAnalysisTarget: noop, syncComposerSendButton: noop,
    isTradingExpertThreadId: () => true, syncTradingExpertCollapseControlsState: noop,
    isThinkingNoiseMessage: () => false, localGroupChatRecord: () => null,
    activeThinkingElapsedLabel: () => "0s", isThreadBusy: () => false,
    prepareContextBudgetForSend: () => stage("context", { ok: budgetOk }),
  };
  const context = vm.createContext(deps);
  const draw = () => frames.push(context.withThinkingMessage(state.currentThreadId, Object.values(state.items[state.currentThreadId] || {})));
  deps.render = deps.refreshTradingExpertConversationSurface = draw;
  // vm exposes newly added context properties to the production functions.
  Object.assign(context, { render: draw, refreshTradingExpertConversationSurface: draw });
  const analyze = async id => {
    assert.ok(thinking.has(id), "feedback must still be visible when analysis starts");
    context.updateTradingExpertThinkingState(id, "analyzing", "正在分析盘面");
    draw();
    await stage("analyze");
  };
  Object.assign(context, { runTradingStrategyChartRequest: analyze, runTradingGeneralChartRequest: analyze });
  vm.runInContext(javascript, context);
  return {
    state, thinking, frames, calls, submit: () => context.submit(),
    at: name => gates[name].entered.promise,
    release: name => gates[name].release.resolve(),
    visible: () => context.withThinkingMessage(state.currentThreadId, []),
  };
}

for (const general of [false, true]) {
  test(`${general ? "general chart" : "strategy"} shows the user bubble during preparation and reaches root Codex`, { timeout: 3000 }, async () => {
    const h = harness({ general });
    const pending = h.submit();
    assert.equal(h.state.items.draft.user.text, "@策略:裸K分析");
    await h.at("context");
    assert.ok(!h.calls.includes("classify"));
    h.release("context");
    await h.at("promote");
    h.release("promote");
    await h.at("analyze");
    const dispatch = h.calls.find(c => c?.root)?.root;
    assert.equal(dispatch[0], "promoted");
    assert.equal(dispatch[6].businessContextId, "frozen-context");
    assert.ok(!h.calls.includes("persist"));
    h.release("analyze");
    await pending;
    assert.ok(!h.calls.some(c => c?.released));
  });
}

test("blocked context preparation retains the user bubble and releases the frozen chart", { timeout: 3000 }, async () => {
  const h = harness({ budgetOk: false });
  const pending = h.submit();
  h.release("context");
  await pending;
  assert.equal(h.state.items.draft.user.type, "userMessage");
  assert.ok(h.calls.includes("failed"));
  assert.ok(h.calls.some(c => c?.released === "frozen-context"));
  assert.ok(!h.calls.includes("promote"));
});

test("thread creation failure does not invoke Codex or a trading runner", { timeout: 3000 }, async () => {
  const h = harness({ promoteFailure: true });
  const pending = h.submit();
  h.release("context");
  await h.at("promote");
  h.release("promote");
  await pending;
  assert.ok(h.calls.includes("failed"));
  assert.ok(h.calls.some(c => c?.released === "frozen-context"));
  assert.ok(!h.calls.includes("analyze"));
});
