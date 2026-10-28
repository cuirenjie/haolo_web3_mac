import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {rendererImports} from './support/renderer-imports.mjs';
import { businessPresentationItems, businessPresentationResult } from "../src/shared/codex-business-presentation.mjs";
import { completedTradingAnalysisReport, isCompletedTradingAnalysisReport, tradingAnalysisDeliveryItems } from "../src/renderer/trading-analysis-completion.ts";
import { turnResultFoldTargets } from "../src/renderer/turn-result-fold.ts";
import { pureAnalysisPresentationGroups } from "../src/renderer/pure-analysis-presentation.ts";
import { rememberTradingPlanDrawingHistory } from "../src/renderer/trading-plan-drawing-history.ts";
import { activeThinkingResponseId, isFinalAnswerForThinkingResponse } from "../src/renderer/thinking-indicator.ts";
import { compactActiveThreadReadResult, compactBackgroundThreadReadResult } from "../src/main/background-thread-hydration.mjs";
import { isObsoletePlanRecoveryNotice } from "../src/renderer/saved-plan-source.ts";
import * as businessErrors from "../src/shared/business-tool-error.mjs";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const imported = await rendererImports(ast, ['preserveIncompletePartial']);
const functions = [
  "isCloudTaskThread",
  "orderedThreadItems", "flattenThreadItemRows", "incomingTurnIndexById",
  "preservedExistingThreadItemRow", "preservedSameTurnItemIndex", "compareThreadItemRows",
  "shouldPreserveExistingThreadItem", "shouldPreserveLocalHistoryAheadItem", "latestSortTime", "itemStableId",
  "upsertItem", "appendTradingExpertReport", "isThreadBusy", "isProviderThreadBusy",
  "activeWorkflowRunForThread", "completedTradingAnalysisForTurn", "hasActiveCompletedTradingAnalysis",
  "isConversationThreadWorking", "isComposerThreadBusy", "isPureTradingAnalysisThread", "isTradingExpertConversationCollapseLocked",
  "hasActiveFinalAnswerMessage", "isFinalAnswerAgentItem", "withThinkingMessage",
  "isTurnResultGroupComplete", "turnResultDisplayStatus", "turnResultElapsedLabel",
  "turnIdFromResultKey", "normalizedTurnResultStatus", "minFinite", "maxFinite",
  "isConversationSupplementWindowOpen", "hasThreadCodexWork",
  "renderComposerSubmitButton",
  "messagesForThread", "withPacedTradingPrelude", "withCollapsedTurnResults", "turnResultGroups", "turnResultProcessIndexes",
  "turnResultStateKey", "isTurnResultOutputMessage", "isStreamingAssistantMessage",
  "queueCodexStreamDelta", "codexStreamDeltaKey", "flushPendingCodexStreamDeltas", "appendDelta",
];
const compiled = ts.transpileModule(
  ast.statements.filter(node => ts.isFunctionDeclaration(node) && functions.includes(node.name?.text))
    .map(node => node.getText(ast)).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;
const toolsSource = fs.readFileSync(new URL("../src/renderer/codex-trading-tools.ts", import.meta.url), "utf8");
const toolsJs = ts.transpileModule(toolsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const toolsExports = {};
vm.runInNewContext(toolsJs, {
  exports: toolsExports, AbortController,
  require: name => name.includes("business-tool-error") ? businessErrors : ({ rebindTradingExpertAnalysisTargetStorageSession: () => null }),
});

function harness() {
  let turnId = "turn-1", finishPresentation;
  const resolved = [];
  const state = { currentThreadId: "origin", activeView: "chat", auth: { authenticated: false }, providerBusy: {}, items: { origin: {} },
    itemOrder: { origin: [] }, artifacts: [], threadRoles: {}, voiceInput: { status: "idle" }, resultProcessExpanded: {} };
  const noop = () => {};
  const context = {
    ...imported,
    state, businessPresentationItems, businessPresentationResult, rememberTradingPlanDrawingHistory, isObsoletePlanRecoveryNotice,
    completedTradingAnalysisReport, isCompletedTradingAnalysisReport, tradingAnalysisDeliveryItems, turnResultFoldTargets, pureAnalysisPresentationGroups,
    activeThinkingResponseId, isFinalAnswerForThinkingResponse,
    activeTurnIdForThread: () => turnId,
    activeCodexThreadIds: new Set(["origin"]),
    activeProviderInteractionByThreadId: new Map(),
    workflowRunsByThreadId: new Map(),
    localGroupChatBusyThreadIds: new Set(),
    submittingComposerThreadIds: new Set(),
    pureTradingAnalysisThreads: new Set(),
    resolveTradingExpertAnalysisThreadId: id => id,
    tradingExpertThinkingStateByThreadId: new Map(),
    tradingPreludePacer: { isWaiting: () => false },
    localHistoryAheadThreadIds: new Set(),
    liveConversationSupplementIds: new Set(),
    itemSequence: () => null,
    firstFiniteNumber: values => values.find(Number.isFinite) ?? null,
    preserveLiveConversationSupplementOrder: noop,
    isContextCompactionItem: () => false, isExternalChannelBridgeUserMessageId: () => false,
    isExternalChannelAgentThreadId: () => false, isSubagentProcessItem: () => false,
    isMatchingAgentMessage: (left, right) => left.id === right.id,
    isPreservableLocalHistoryItem: item => item.type === "agentMessage",
    matchingIncomingThreadItem: (item, incoming) => incoming.find(candidate => candidate.id === item.id),
    localHistoryContentScore: item => item.text?.length || 0,
    isInFlightSnapshotItem: () => false, activeTradingExpertAnalysisJobIds: () => [],
    compareUnmatchedExternalChannelBridgeRowsByTime: () => 0,
    conversationSupplementIdFromItem: () => null,
    internalSubagentThreadIds: new Set(),
    groupBlankThreadIds: new Set(),
    suppressCreatedAtStamp: false, codexItemLocalSequence: 0,
    api: {},
    rememberInternalSubagentThreadsFromItem: noop,
    ensureThreadState: id => { state.items[id] ??= {}; state.itemOrder[id] ??= []; },
    discardCachedThreadMessageSurface: noop,
    sanitizeIncomingThreadItem: item => item,
    isUserSideThreadItem: item => item?.type === "userMessage",
    isOptimisticUserItemId: () => false,
    firstString: (...values) => values.find(value => typeof value === "string" && value.trim()) || null,
    assistantProviderFromItem: () => null,
    isQuestionAnswerThreadId: () => false,
    conversationSupplementIdFromRecord: () => null,
    updateThreadRoleFromItem: noop, syncThreadMembersForRole: noop,
    inferItemRole: () => "assistant",
    shouldHideChatItem: () => false,
    patchThreadPreviewFromItem: noop,
    setMessageStreamFollow: noop, patchConversationRow: noop,
    refreshTradingExpertConversationSurface: noop, recordRendererTranscriptDiagnostic: noop,
    itemTurnId: item => item?.turnId || item?.turn_id || null,
    agentMessagePhase: item => item?.phase || item?.message_phase || item?.messagePhase,
    itemText: item => item?.text || "",
    itemAttachments: () => [], messageActionsFromItem: () => [],
    isThinkingNoiseMessage: () => false,
    localGroupChatRecord: () => null,
    hasActiveContextCompaction: () => false, hasActiveVideoGenerationState: () => false,
    latestQuestionAnswerProgressForThread: () => null,
    isGptPlanQuestionAnswerProgress: () => false,
    questionAnswerProgressFromMessage: () => null,
    isMultiModelClusterThread: () => false,
    activeSubagentUiEntries: () => [],
    activeCodexThinkingStage: () => ({ label: "智能体正在执行" }),
    activeThinkingElapsedLabel: () => "1m",
    inferActiveThinkingRole: () => "assistant", effectiveProviderForThread: () => null,
    isTradingExpertSurfaceThreadId: () => true,
    composerSubmitActionForThread: () => "interrupt",
    canInterruptThread: () => true, canSendComposer: () => true,
    hasGptPlanProcessForInteraction: () => false,
    cachedConsumptionStatusForTurn: () => "pending",
    interruptedCodexTurnIds: new Set(),
    turnTiming: () => ({ startedAtMs: 1000, completedAtMs: 100000 }),
    turnResultProcessIndexes: () => [],
    turnItemStartMs: item => item?.createdAt ? Date.parse(item.createdAt) : null,
    turnItemEndMs: item => item?.createdAt ? Date.parse(item.createdAt) : null,
    sortTimeFromValues: (...values) => {
      const value = values.find(value => value != null);
      return value == null ? null : typeof value === "number" ? value : Date.parse(value);
    },
    itemSortTime: item => item?.createdAt ? Date.parse(item.createdAt) : null,
    formatElapsedDuration: ms => ms,
    previousTurnResultUserStartMs: () => null,
    shouldOpenConversationSupplementWindow: () => true,
    conversationSupplementRoutingStateForThread: () => ({}),
    ensureVisibleInsufficientQuotaAgentMessage: noop,
    itemToMessage: (threadId, id, item) => ({ id, conversation_id: threadId,
      kind: item.type === "userMessage" ? "user_text" : "agent_text", text: item.text,
      attachments: item.attachments, executionPlanPresentation: item.__youleExecutionPlanPresentation }),
    hasRenderableMessageContent: item => Boolean(item.text?.trim() || item.attachments?.length),
    withPendingChannelAgentReply: (_, messages) => messages,
    dedupeRenderedOptimisticUserMessages: messages => messages,
    dedupeExternalChannelInternalPromptEchoes: (_, messages) => messages,
    preserveLiveConversationSupplementMessageOrder: (_, messages) => messages,
    withWorkflowRelayMessages: (_, messages) => messages,
    isRenderedUserSideMessage: message => message.kind === "user_text",
    isThinkingMessage: message => message.id?.startsWith("thinking-"),
    isMediaGenerationMessage: () => false, isContextCompactionMessage: () => false,
    isLocalStatusThreadItem: () => false, isExternalChannelStatusOutputMessage: () => false,
    pendingCodexStreamDeltas: new Map(), scheduleCodexStreamUiPatch: noop,
    isRenderableAgentMessageItem: item => Boolean(item?.text?.trim()),
    assistantVisibleText: text => text, applySupplementResolutionBlocks: noop,
    moveNewAgentMessageAfterLiveSupplements: noop, shouldUpdateThreadPreviewForStreamDelta: () => true,
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  const tools = new toolsExports.CodexTradingTools({
    api: { resolveBusinessTool: value => resolved.push(value) },
    responseId: () => context.activeProviderInteractionByThreadId.get("origin") || turnId,
    pending: () => ({}),
    present: async () => {
      const item = context.appendTradingExpertReport("origin", "SNDK 1h plan", "report", undefined, "execution-plan");
      tools.collect("origin", [item]);
      await new Promise(resolve => { finishPresentation = resolve; });
    },
  });
  context.codexTradingTools = tools;
  return { context, state, tools, resolved, setTurn: id => { turnId = id; }, finish: () => finishPresentation(),
    present: (metadata = {}) => tools.handle({ requestId: "present", threadId: "origin", turnId,
      arguments: { action: "present", artifact: {}, metadata } }) };
}

test("visible native plan is an artifact; working state remains until the root answers the request", async () => {
  const h = harness(), c = h.context;
  assert.equal(c.withThinkingMessage("origin", []).at(-1).text, "智能体正在执行");
  assert.equal(c.isConversationThreadWorking("origin"), true);
  assert.match(c.renderComposerSubmitButton({ id: "origin" }), /stop-button/);
  const pending = h.present();
  assert.equal(h.resolved.length, 0);
  assert.equal(h.state.items.origin.report.turnId, "turn-1");
  assert.equal(h.state.items.origin.report.__youleNativeResponseComplete, false);
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), false);
  assert.equal(c.withThinkingMessage("origin", []).length, 1);
  assert.equal(c.isConversationThreadWorking("origin"), true);
  assert.equal(c.isComposerThreadBusy("origin"), true);
  const button = c.renderComposerSubmitButton({ id: "origin" });
  assert.match(button, /stop-button/);
  assert.equal(c.isTradingExpertConversationCollapseLocked("origin"), true);
  assert.equal(c.isThreadBusy("origin"), true, "transport ownership remains active until its terminal event");
  assert.equal(c.hasThreadCodexWork("origin"), true, "the actual send path still queues follow-ups until turn/completed");
  assert.equal(c.activeCodexThreadIds.has("origin"), true);
  h.finish(); await pending;
  assert.equal(h.resolved[0].result.presentationItems[0].turnId, "turn-1", "durable MCP result retains the same identity");
  assert.equal(h.tools.bindPresentation("origin", { type: "agentMessage" }).turnId, undefined);
  c.upsertItem("origin", { id: "answer", type: "agentMessage", phase: "final_answer", turnId: "turn-1",
    text: "结论：等待确认。用户要求的说明和非交易问题也已在这份回答中覆盖。" });
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), true);
});

test("pure report reveal hides the thinking bubble only after the current request starts displaying text", () => {
  const h=harness(),c=h.context;
  c.pureTradingAnalysisThreads.add('origin');
  c.tradingExpertThinkingStateByThreadId.set('origin',{phase:'drawing',message:'Drawing'});
  c.tradingExpertThinkingStage=()=>({label:'Drawing'});
  const user={id:'user',kind:'user_text',text:'@策略:裸K'};
  assert.equal(c.withThinkingMessage('origin',[user]).at(-1).id,'thinking-origin');
  const report={id:'pure-trading-price-action-progress-1792584000000-abc-report',kind:'agent_text',text:'正在增长的报告正文'};
  assert.deepEqual(Array.from(c.withThinkingMessage('origin',[user,report]),m=>m.id),['user',report.id]);
  assert.equal(c.withThinkingMessage('origin',[user,report,{...user,id:'next-user'}]).at(-1).id,'thinking-origin');
  c.pureTradingAnalysisThreads.clear();
  assert.equal(c.withThinkingMessage('origin',[user,report]).at(-1).id,'thinking-origin');
});

test("streamed final answers survive native presentation, terminal events and history replay", async () => {
  const h = harness(), c = h.context;
  const pending = h.present(); h.finish(); await pending;
  const initial = c.messagesForThread("origin");
  assert.deepEqual(Array.from(initial, item => item.id), ["report", "thinking-origin"]);
  assert.equal(c.isStreamingAssistantMessage(initial[0], initial), false, "plan actions must be available while Codex acknowledges");
  c.upsertItem("origin", { id: "closing", type: "agentMessage", phase: "final_answer", turnId: "turn-1", text: "" });
  for (const delta of ["结论：BTC 1h ", "入场 80681.26，", "止损 80046.30，", "止盈 81687.40。"]) {
    c.queueCodexStreamDelta("origin", "closing", delta, "agentMessage", "turn-1");
    c.flushPendingCodexStreamDeltas("origin");
    assert.ok(c.messagesForThread("origin").some(item => item.id === "closing"));
    assert.ok(c.messagesForThread("origin").some(item => item.id === "report"));
  }
  assert.match(h.state.items.origin.closing.text, /80681.26/, "keep original model text for transcript/audit");
  const card = h.resolved[0].result.presentationItems[0];
  c.upsertItem("origin", { id: "tool", type: "mcpToolCall", tool: "haolo_plan_present", turnId: "turn-1",
    result: { content: [{ type: "text", text: JSON.stringify({ presentationItems: [card] }) }] } });
  c.activeCodexThreadIds.clear();
  h.setTurn(null);
  assert.deepEqual(Array.from(c.messagesForThread("origin"), item => item.id), ["report", "closing"]);
  h.setTurn("turn-2"); c.activeCodexThreadIds.add("origin");
  c.upsertItem("origin", { id: "next", type: "agentMessage", phase: "final_answer", turnId: "turn-2", text: "新的回复" });
  assert.ok(c.messagesForThread("origin").some(item => item.id === "next"), "the next response is never suppressed");
});

test("mixed tasks retain their requested answer without parsing a second plan or hiding earlier strategy cards", async () => {
  const h = harness(), c = h.context;
  const pending = h.present({ hasRemainingWork: true });
  assert.equal(h.state.items.origin.report.__youleNativeResponseComplete, false);
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), false);
  assert.equal(c.hasActiveCompletedTradingAnalysis("origin"), false);
  h.finish(); await pending;
  c.upsertItem("origin", { ...h.state.items.origin.report, id: "second-strategy" });
  c.upsertItem("origin", { id: "comparison", type: "agentMessage", phase: "final_answer", turnId: "turn-1",
    text: "两种策略比较：入场 80681.26，止损 80046.30，止盈 81687.40。另有用户要求的说明。" });
  const live = c.messagesForThread("origin");
  assert.equal(live.find(item => item.id === "comparison").executionPlanPresentation, "plain");
  c.activeCodexThreadIds.clear(); h.setTurn(null);
  const finished = c.messagesForThread("origin");
  assert.deepEqual(Array.from(finished, item => item.id), ["report", "second-strategy", "comparison"]);
  assert.equal(finished.filter(item => item.executionPlanPresentation === "execution-plan").length, 2);
  assert.equal(h.resolved[0].result.presentationItems[0].__youleNativeResponseComplete, false);
});

test("native delivery projection preserves attachments, errors, prior commentary and unrelated turns", () => {
  const card = { id: "report", type: "agentMessage", phase: "final_answer", text: "verified report",
    turnId: "turn-1", __youleExecutionPlanPresentation: "execution-plan" };
  const items = [
    { id: "progress", type: "agentMessage", phase: "commentary", text: "正在读取", turnId: "turn-1" },
    card,
    { id: "closing", type: "agentMessage", text: "重复总结", turnId: "turn-1" },
    { id: "file", type: "agentMessage", text: "requested file", turnId: "turn-1", attachments: [{ path: "report.pdf" }] },
    { id: "error", type: "agentMessage", phase: "final_answer", text: "failed", turnId: "turn-1", __youleExecutionPlanPresentation: "plain" },
    { id: "other", type: "agentMessage", text: "another answer", turn_id: "turn-2" },
  ];
  const result = tradingAnalysisDeliveryItems(items);
  assert.deepEqual(result.map(item => item.id), ["progress", "report", "file", "error", "other"]);
  assert.equal(result.find(item => item.id === "report"), card);
  assert.equal(items[2].text, "重复总结");
  assert.equal(items[3].__youleExecutionPlanPresentation, undefined, "projection never rewrites persisted items");
});

for (const hydration of [compactActiveThreadReadResult, compactBackgroundThreadReadResult]) {
  for (const warm of [false, true]) {
    for (const lateCard of [false, true]) {
    test(`${hydration.name} ${warm ? "warm refresh" : "cold reopen"} ${lateCard ? "late card" : "ordered card"} retains long cards and the requested final explanation`, () => {
      const h = harness(), c = h.context;
      const card = { id: "plan", type: "agentMessage", phase: "final_answer", text: `conditional plan ${"x".repeat(30_000)}`,
        turnId: "turn-1", __youleExecutionPlanPresentation: "execution-plan", __youleNativeResponseComplete: false,
        __youleCloudReports: [{ entryPrice: 83157.9, stopLoss: 83775.7 }] };
      const progress = { id: "progress", type: "agentMessage", phase: "commentary", text: "checking candles", turnId: "turn-1" };
      const answer = { id: "answer", type: "agentMessage", phase: "final_answer", text: "The rally and continuation conditions explained.", turnId: "turn-1" };
      const tool = { id: "tool", type: "mcpToolCall", tool: "haolo_plan_present", status: "completed", turnId: "turn-1",
        result: { content: [{ type: "text", text: JSON.stringify({
          result: { analysisJobId: "run-1", diagnostic: "z".repeat(200_000) }, presentationItems: [card],
        }) }] } };
      const snapshot = { thread: { turns: [{ id: "turn-1", status: "completed", items: lateCard
        ? [progress, answer, tool] : [progress, tool, answer] }] } };
      c.activeCodexThreadIds.clear(); h.setTurn(null);
      if (warm) c.localHistoryAheadThreadIds.add("origin");
      const existing = warm ? [progress, card, answer] : [];
      const compacted = hydration(snapshot);
      const ordered = c.orderedThreadItems(compacted.thread, existing, { threadId: "origin", preserveUnmatched: true });
      for (const item of ordered) c.upsertItem("origin", item);
      const visible = c.messagesForThread("origin");
      assert.deepEqual(Array.from(visible, item => item.id), ["plan", "answer"]);
      assert.equal(visible[0].text, card.text, "native text must survive even when it alone exceeds the process limit");
      assert.equal(visible[1].executionPlanPresentation, "plain");
      assert.equal(visible[0].turnResult.expanded, false);
      assert.equal(visible[1].turnResult, undefined);
      assert.deepEqual(c.state.items.origin.plan.__youleCloudReports, card.__youleCloudReports);
      assert.equal(c.state.items.origin.plan.__youleNativeResponseComplete, false);
      assert.equal(c.state.items.origin.plan.turnId, "turn-1");
      assert.equal(tool.result.content[0].text.includes("process output truncated"), false);
    });
    }
  }
}

test("a recovered card or late commentary cannot fold an earlier final answer", () => {
  for (const late of [
    { id: "late-card", __youleExecutionPlanPresentation: "execution-plan", __youleNativeResponseComplete: false, phase: "final_answer" },
    { id: "late-progress", phase: "commentary" },
  ]) {
    const h = harness(), c = h.context;
    c.activeCodexThreadIds.clear(); h.setTurn(null);
    for (const item of [
      { id: "progress", phase: "commentary", text: "checking" },
      { id: "answer", phase: "final_answer", text: "requested explanation" },
      { ...late, text: "late output" },
    ]) c.upsertItem("origin", { ...item, type: "agentMessage", turnId: "turn-1" });
    const visible = c.messagesForThread("origin");
    assert.equal(visible.find(item => item.id === "answer")?.text, "requested explanation");
    assert.equal(visible.some(item => item.id === "progress"), false);
    assert.equal(visible.some(item => item.id === "late-progress"), false, "late progress belongs in the collapsed process");
    assert.equal(visible.at(-1).id, "answer", "the direct answer follows the recovered card");
    const anchor = visible.find(item => item.turnResult);
    assert.equal(anchor.id, late.id === "late-card" ? "late-card" : "answer", "processed precedes all answers");
    assert.equal(anchor.turnResult?.expanded, false);
    h.state.resultProcessExpanded[anchor.turnResult.key] = true;
    const expanded = c.messagesForThread("origin");
    assert.equal(expanded.some(item => item.id === "progress"), true, "expanding restores the process");
    if (late.phase === "commentary") assert.equal(expanded.some(item => item.id === "late-progress"), true);
  }
});

test("processed precedes every plan and the direct answer remains last, even without progress", () => {
  const h = harness(), c = h.context;
  c.activeCodexThreadIds.clear(); h.setTurn(null);
  const original = [
    { id: "answer", phase: "final_answer", text: "净赚 10 USDT 需要逐笔累积。" },
    ...["first-plan", "second-plan"].map(id => ({ id, phase: "final_answer", text: `${id} report`,
      __youleExecutionPlanPresentation: "execution-plan", __youleNativeResponseComplete: false })),
  ].map(item => ({ ...item, type: "agentMessage", turnId: "turn-1" }));
  for (const item of original) c.upsertItem("origin", item);
  for (const expanded of [false, true, false]) {
    // Use the actual key so this test also exercises production key creation.
    const initial = c.messagesForThread("origin");
    h.state.resultProcessExpanded[initial[0].turnResult.key] = expanded;
    const visible = c.messagesForThread("origin");
    assert.deepEqual(Array.from(visible, item => item.id), ["first-plan", "second-plan", "answer"]);
    assert.equal(visible.at(-1).text, original[0].text);
    assert.equal(visible[0].turnResult.expanded, expanded);
    assert.equal(visible[0].turnResult.collapsedCount, 0);
    assert.equal(visible.at(-1).turnResult, undefined);
    assert.deepEqual(Array.from(visible.slice(0, 2), item => item.text), original.slice(1).map(item => item.text));
  }
  assert.deepEqual(Array.from(h.state.itemOrder.origin), original.map(item => item.id), "persisted order is untouched");
  assert.equal(h.state.items.origin["first-plan"].turnResult, undefined);
});

test("plan ordering stays inside its request and leaves ordinary answers and unidentified history alone", () => {
  const answer = (id, turnId) => ({ id, turnId, type: "agentMessage", phase: "final_answer", text: id });
  const plan = (id, turnId) => ({ ...answer(id, turnId),
    __youleExecutionPlanPresentation: "execution-plan", __youleNativeResponseComplete: false });
  const items = [
    answer("earlier-answer", "first"), { id: "user-next", type: "userMessage", turnId: "next", text: "next request" },
    plan("late-first-plan", "first"), answer("ordinary", "next"),
    answer("unknown-answer"), plan("unknown-plan"), answer("live-answer", "live"),
    plan("live-plan", "live"), answer("followup", "followup"),
  ];
  assert.deepEqual(tradingAnalysisDeliveryItems(items).map(item => item.id), [
    "earlier-answer", "user-next", "late-first-plan", "ordinary", "unknown-answer",
    "unknown-plan", "live-plan", "live-answer", "followup",
  ]);
});

for (const hydrate of [false, true]) {
  test(`native ETH plan folds trailing tool progress during ${hydrate ? "history hydration" : "live delivery"}`, () => {
    const h = harness(), c = h.context;
    const turnId = "turn-1";
    const progress = [
      { id: "preparing", text: "正在读取行情", createdAt: "2026-10-20T15:41:46.238Z" },
      { id: "complete", text: "price-action-ohlc-engine-v1 已完成 ETHUSDT 0 根 K 线的裸K分析分析与绘图。",
        createdAt: "2026-10-20T15:41:53.811Z" },
    ].map(item => ({ ...item, type: "agentMessage", phase: "commentary", turnId, __youleExecutionPlanPresentation: "plain" }));
    const card = { id: "eth-plan", type: "agentMessage", phase: "final_answer", text: "ETHUSDT 条件交易计划",
      createdAt: "2026-10-20T15:42:16.729Z", turnId, __youleExecutionPlanPresentation: "execution-plan" };
    if (hydrate) {
      c.activeCodexThreadIds.clear(); h.setTurn(null);
      const tool = { id: "present", type: "mcpToolCall", tool: "haolo_plan_present", turnId, status: "completed",
        result: { content: [{ type: "text", text: JSON.stringify({ presentationItems: [card] }) }] } };
      // A partial snapshot contains the report tool; older local analysis
      // progress is preserved at the end of that same turn.
      const snapshot = compactActiveThreadReadResult({ thread: { turns: [{ id: turnId, status: "completed", items: [tool] }] } });
      c.localHistoryAheadThreadIds.add("origin");
      for (const item of c.orderedThreadItems(snapshot.thread, progress, { threadId: "origin", preserveUnmatched: true })) {
        c.upsertItem("origin", item);
      }
    } else {
      c.upsertItem("origin", card);
      for (const item of progress) c.upsertItem("origin", item);
    }
    const visible = c.messagesForThread("origin");
    assert.deepEqual(Array.from(visible, item => item.id), ["eth-plan"]);
    assert.equal(visible[0].turnResult.collapsedCount, 2);
    assert.equal(visible[0].turnResult.status, "handled");
    h.state.resultProcessExpanded[visible[0].turnResult.key] = true;
    assert.deepEqual(Array.from(c.messagesForThread("origin"), item => item.id), ["eth-plan", "preparing", "complete"]);
    h.setTurn("turn-2");
    c.activeCodexThreadIds.add("origin");
    c.upsertItem("origin", { id: "next-progress", type: "agentMessage", phase: "commentary", text: "new request", turnId: "turn-2" });
    h.state.resultProcessExpanded[visible[0].turnResult.key] = false;
    assert.ok(c.messagesForThread("origin").some(item => item.id === "next-progress"));
  });
}

test("trailing commentary with a requested file or action remains visible", () => {
  const h = harness(), c = h.context;
  c.activeCodexThreadIds.clear(); h.setTurn(null);
  for (const item of [
    { id: "report", phase: "final_answer", __youleExecutionPlanPresentation: "execution-plan" },
    { id: "progress", phase: "commentary" },
    { id: "attachment", phase: "commentary", attachments: [{ path: "report.pdf" }] },
    { id: "action", phase: "commentary", actions: [{ type: "retry" }] },
  ]) c.upsertItem("origin", { type: "agentMessage", text: item.id, turnId: "turn-1", ...item });
  assert.deepEqual(Array.from(c.messagesForThread("origin"), item => item.id), ["report", "attachment", "action"]);
  c.upsertItem("origin", { id: "error", type: "agentMessage", text: "failed", turnId: "turn-1",
    phase: "final_answer", __youleExecutionPlanPresentation: "plain" });
  assert.ok(c.messagesForThread("origin").some(item => item.id === "error"));
  const targets = turnResultFoldTargets([0, 1, 2, 3], index => [
    h.state.items.origin.report, h.state.items.origin.progress,
    h.state.items.origin.attachment, h.state.items.origin.action,
  ][index]);
  assert.equal(targets.finalIndex, 0);
  assert.deepEqual(targets.lateProcessIndexes, [1]);
});

test("a fast completed request cannot fold the prelude before its display cadence finishes", () => {
  const h = harness(), c = h.context;
  c.activeCodexThreadIds.clear(); h.setTurn(null);
  for (const id of ["first", "last"]) c.upsertItem("origin", {
    id, type: "agentMessage", phase: "commentary", text: id, turnId: "turn-1",
  });
  c.tradingPreludePacer.isWaiting = () => true;
  assert.deepEqual(Array.from(c.messagesForThread("origin"), item => item.id), ["first", "last"]);
  c.tradingPreludePacer.isWaiting = () => false;
  assert.deepEqual(Array.from(c.messagesForThread("origin"), item => item.id), ["last"]);
});

test("a process-only turn retains its last progress message until it has a final answer", () => {
  const h = harness(), c = h.context;
  c.activeCodexThreadIds.clear(); h.setTurn(null);
  for (const id of ["first", "last"]) c.upsertItem("origin", {
    id, type: "agentMessage", phase: "commentary", text: id, turnId: "turn-1",
  });
  const visible = c.messagesForThread("origin");
  assert.deepEqual(Array.from(visible, item => item.id), ["last"]);
  assert.equal(visible[0].turnResult.status, "pending");
});

test("tool replay restores completed grouping and frozen elapsed time despite pending consumption", () => {
  const h = harness(), c = h.context;
  const card = { id: "plan", type: "agentMessage", phase: "final_answer", text: "SNDK plan",
    __youleExecutionPlanPresentation: "execution-plan", createdAt: new Date(61000).toISOString(), turnId: "old-turn",
    __youleTurnCompletedAt: new Date(100000).toISOString() };
  const tool = { id: "tool", type: "mcpToolCall", tool: "haolo_plan_present", status: "completed", turnId: "turn-1",
    result: { content: [{ type: "text", text: JSON.stringify({ presentationItems: [card] }) }] } };
  c.upsertItem("origin", tool);
  const messages = [{ id: "plan", kind: "agent_text" }];
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), true);
  assert.equal(c.isTurnResultGroupComplete("origin", "turn:turn-1", true), true);
  assert.equal(c.turnResultDisplayStatus("origin", "turn:turn-1", [0], messages), "handled");
  assert.equal(c.turnResultElapsedLabel("origin", "turn:turn-1", [0], messages), 60000);
  c.turnTiming = () => ({ startedAtMs: 1000, completedAtMs: 500000 });
  c.turnItemEndMs = () => 500000;
  assert.equal(c.turnResultElapsedLabel("origin", "turn:turn-1", [0], messages), 60000);
  assert.equal(card.turnId, "old-turn", "display adaptation never mutates the stored report");
  h.setTurn("turn-2");
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), false);
  assert.equal(c.withThinkingMessage("origin", []).length, 1);
  assert.equal(c.isConversationThreadWorking("origin"), true);
  assert.equal(c.isComposerThreadBusy("origin"), true);
});

test("late reports use the captured response, never another conversation or a newer turn", async () => {
  const h = harness();
  const pending = h.present();
  h.setTurn("turn-2");
  h.state.currentThreadId = "other";
  const late = h.tools.bindPresentation("origin", { id: "late", type: "agentMessage", phase: "final_answer", text: "plan",
    __youleExecutionPlanPresentation: "execution-plan" });
  h.context.upsertItem("origin", late);
  assert.equal(late.turnId, "turn-1");
  assert.equal(h.context.hasActiveFinalAnswerMessage("origin"), false);
  assert.equal(h.context.hasActiveCompletedTradingAnalysis("other"), false);
  h.finish(); await pending;
});

test("provider response identities stay separate and independent runners keep their busy ownership", async () => {
  const h = harness(), c = h.context;
  h.state.providerBusy.origin = true;
  c.activeProviderInteractionByThreadId.set("origin", "provider-1");
  const pending = h.present();
  assert.equal(h.state.items.origin.report.turnId, "provider-1");
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), false);
  assert.equal(c.isComposerThreadBusy("origin"), true, "provider runner cannot queue parallel sends");
  c.activeProviderInteractionByThreadId.set("origin", "provider-2");
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), false);
  h.finish(); await pending;
});

test("new analysis and workflow progress retain working state; empty or non-final cards never complete analysis", async () => {
  const h = harness(), c = h.context;
  const pending = h.present(); h.finish(); await pending;
  c.tradingExpertThinkingStateByThreadId.set("origin", { phase: "analyzing" });
  assert.equal(c.isConversationThreadWorking("origin"), true);
  assert.equal(c.isTurnResultGroupComplete("origin", "turn:turn-1", true), false);
  c.tradingExpertThinkingStateByThreadId.clear();
  c.workflowRunsByThreadId.set("origin", { id: "workflow", status: "running" });
  assert.equal(c.isComposerThreadBusy("origin"), true);
  for (const item of [
    { type: "plan", phase: "final_answer", text: "steps" },
    { type: "agentMessage", phase: "commentary", text: "working", __youleExecutionPlanPresentation: "execution-plan" },
    { type: "agentMessage", phase: "final_answer", text: " ", __youleExecutionPlanPresentation: "execution-plan" },
    { type: "agentMessage", phase: "final_answer", text: "alert draft", __youleExecutionPlanPresentation: "plain" },
  ]) assert.equal(isCompletedTradingAnalysisReport(item), false);
  const position = { type: "agentMessage", phase: "final_answer", text: "position plan",
    __youleExecutionPlanPresentation: "position-plan", turn_id: "position" };
  assert.equal(completedTradingAnalysisReport([position], "position"), position);
  assert.equal(completedTradingAnalysisReport([position], null), null);
});
