import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { businessPresentationItems, businessPresentationResult } from "../src/shared/codex-business-presentation.mjs";
import { completedTradingAnalysisReport, isCompletedTradingAnalysisReport, tradingAnalysisDeliveryItems } from "../src/renderer/trading-analysis-completion.ts";
import { activeThinkingResponseId, isFinalAnswerForThinkingResponse } from "../src/renderer/thinking-indicator.ts";
import { compactActiveThreadReadResult, compactBackgroundThreadReadResult } from "../src/main/background-thread-hydration.mjs";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const functions = [
  "orderedThreadItems", "flattenThreadItemRows", "incomingTurnIndexById",
  "preservedExistingThreadItemRow", "preservedSameTurnItemIndex", "compareThreadItemRows",
  "shouldPreserveExistingThreadItem", "shouldPreserveLocalHistoryAheadItem", "latestSortTime", "itemStableId",
  "upsertItem", "appendTradingExpertReport", "isThreadBusy", "isProviderThreadBusy",
  "activeWorkflowRunForThread", "completedTradingAnalysisForTurn", "hasActiveCompletedTradingAnalysis",
  "isConversationThreadWorking", "isComposerThreadBusy", "isTradingExpertConversationCollapseLocked",
  "hasActiveFinalAnswerMessage", "isFinalAnswerAgentItem", "withThinkingMessage",
  "isTurnResultGroupComplete", "turnResultDisplayStatus", "turnResultElapsedLabel",
  "turnIdFromResultKey", "normalizedTurnResultStatus", "minFinite", "maxFinite",
  "isConversationSupplementWindowOpen", "hasThreadCodexWork",
  "renderComposerSubmitButton",
  "messagesForThread", "withCollapsedTurnResults", "turnResultGroups", "turnResultProcessIndexes",
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
  require: () => ({ rebindTradingExpertAnalysisTargetStorageSession: () => null }),
});

function harness() {
  let turnId = "turn-1", finishPresentation;
  const resolved = [];
  const state = { currentThreadId: "origin", activeView: "chat", providerBusy: {}, items: { origin: {} },
    itemOrder: { origin: [] }, artifacts: [], threadRoles: {}, voiceInput: { status: "idle" }, resultProcessExpanded: {} };
  const noop = () => {};
  const context = {
    state, businessPresentationItems, businessPresentationResult,
    completedTradingAnalysisReport, isCompletedTradingAnalysisReport, tradingAnalysisDeliveryItems,
    activeThinkingResponseId, isFinalAnswerForThinkingResponse,
    activeTurnIdForThread: () => turnId,
    activeCodexThreadIds: new Set(["origin"]),
    activeProviderInteractionByThreadId: new Map(),
    workflowRunsByThreadId: new Map(),
    localGroupChatBusyThreadIds: new Set(),
    submittingComposerThreadIds: new Set(),
    tradingExpertThinkingStateByThreadId: new Map(),
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

test("visible native plan completes analysis immediately, before tool acknowledgement or root final text", async () => {
  const h = harness(), c = h.context;
  assert.equal(c.withThinkingMessage("origin", []).at(-1).text, "智能体正在执行");
  assert.equal(c.isConversationThreadWorking("origin"), true);
  assert.match(c.renderComposerSubmitButton({ id: "origin" }), /stop-button/);
  const pending = h.present();
  assert.equal(h.resolved.length, 0);
  assert.equal(h.state.items.origin.report.turnId, "turn-1");
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), true);
  assert.equal(c.withThinkingMessage("origin", []).length, 0);
  assert.equal(c.isConversationThreadWorking("origin"), false);
  assert.equal(c.isComposerThreadBusy("origin"), false);
  const button = c.renderComposerSubmitButton({ id: "origin" });
  assert.match(button, /title="发送"/);
  assert.doesNotMatch(button, /stop-button|interrupt-turn/);
  assert.equal(c.isTradingExpertConversationCollapseLocked("origin"), false);
  assert.equal(c.isConversationSupplementWindowOpen("origin"), false, "follow-up must queue, not steer the completed analysis");
  assert.equal(c.isThreadBusy("origin"), true, "transport ownership remains active until its terminal event");
  assert.equal(c.hasThreadCodexWork("origin"), true, "the actual send path still queues follow-ups until turn/completed");
  assert.equal(c.activeCodexThreadIds.has("origin"), true);
  h.finish(); await pending;
  assert.equal(h.resolved[0].result.presentationItems[0].turnId, "turn-1", "durable MCP result retains the same identity");
  assert.equal(h.tools.bindPresentation("origin", { type: "agentMessage" }).turnId, undefined);
});

test("late closing deltas and terminal/history replay keep the same completed native report on screen", async () => {
  const h = harness(), c = h.context;
  const pending = h.present(); h.finish(); await pending;
  const initial = c.messagesForThread("origin");
  assert.deepEqual(Array.from(initial, item => item.id), ["report"]);
  assert.equal(c.isStreamingAssistantMessage(initial[0], initial), false, "plan actions must be available while Codex acknowledges");
  c.upsertItem("origin", { id: "closing", type: "agentMessage", phase: "final_answer", turnId: "turn-1", text: "" });
  for (const delta of ["结论：BTC 1h ", "入场 80681.26，", "止损 80046.30，", "止盈 81687.40。"]) {
    c.queueCodexStreamDelta("origin", "closing", delta, "agentMessage", "turn-1");
    c.flushPendingCodexStreamDeltas("origin");
    assert.deepEqual(Array.from(c.messagesForThread("origin"), item => item.id), ["report"]);
  }
  assert.match(h.state.items.origin.closing.text, /80681.26/, "keep original model text for transcript/audit");
  const card = h.resolved[0].result.presentationItems[0];
  c.upsertItem("origin", { id: "tool", type: "mcpToolCall", tool: "haolo_plan_present", turnId: "turn-1",
    result: { content: [{ type: "text", text: JSON.stringify({ presentationItems: [card] }) }] } });
  c.activeCodexThreadIds.clear();
  h.setTurn(null);
  assert.deepEqual(Array.from(c.messagesForThread("origin"), item => item.id), ["report"]);
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
    test(`${hydration.name} ${warm ? "warm refresh" : "cold reopen"} retains long cards and the requested final explanation`, () => {
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
      const snapshot = { thread: { turns: [{ id: "turn-1", status: "completed", items: [progress, tool, answer] }] } };
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
      assert.deepEqual(c.state.items.origin.plan.__youleCloudReports, card.__youleCloudReports);
      assert.equal(c.state.items.origin.plan.__youleNativeResponseComplete, false);
      assert.equal(c.state.items.origin.plan.turnId, "turn-1");
      assert.equal(tool.result.content[0].text.includes("process output truncated"), false);
    });
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
  }
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
  assert.equal(c.hasActiveFinalAnswerMessage("origin"), true);
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
