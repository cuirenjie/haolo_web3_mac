import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as lifecycle from "../src/renderer/context-compaction-lifecycle.ts";
import { GENERATED_ENGLISH_UI_PHRASES } from "../src/renderer/app-language-en-generated.mjs";
import { GENERATED_TRADITIONAL_UI_PHRASES } from "../src/renderer/app-language-zh-tw-generated.mjs";

const source = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set([
  "isContextCompactionItem", "contextCompactionUiStatusFromItem", "contextCompactionUiErrorFromItem",
  "withContextCompactionUiStatus", "setActiveContextCompactionUiStatus", "replaceActiveContextCompactionItemId",
  "beginLocalContextCompactionItem", "beginContextCompactionFromNotification", "markContextCompactionSucceeded",
  "completeContextCompactionFromNotification", "failContextCompaction", "contextCompactionTurnResult",
  "settledContextCompactionNotificationItem", "settleUnfinishedContextCompactions",
  "restoreThreadContextCompactionsFromItems", "rememberTurnResultStatus", "setCodexThreadBusy",
  "automaticTurnRecoveryMeta", "automaticTurnRecoveryIsQueued", "announceAutomaticTurnRecovery",
  "formatTurnFailureMessage", "handleNotification", "notificationItemWithTurnId", "hasActiveContextCompaction",
  "renderContextCompactionBubble", "requestAutomaticThreadContextCompaction", "finishInterruptedTurnLocally",
]);
const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const externalCalls = new Set();
for (const fn of functions) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) externalCalls.add(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(fn);
}
const code = ts.transpileModule(functions.map((node) => node.getText(parsed)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const calls = [];
  const state = {
    settings: { language: "zh-CN" }, currentThreadId: "thread", activeTurnIds: {}, activeTurnId: null,
    items: {}, itemOrder: {}, threadContextUsage: {}, queuedSends: [],
  };
  const context = Object.fromEntries([...externalCalls].filter((name) => !names.has(name) && !["String", "Boolean", "Number"].includes(name))
    .map((name) => [name, (...args) => { calls.push({ name, args }); return false; }]));
  Object.assign(context, lifecycle, {
    state, calls, api: {}, HANDLED_STATUS_LABEL: "已处理",
    contextCompactionPromises: new Map(), contextCompactionStartedAtMs: new Map(),
    contextCompactionTerminalTurns: new Map(), activeCodexThreadIds: new Set(), pendingCodexTurns: new Map(),
    threadsAwaitingAgentReply: new Set(), contextWindowRecoveryReplays: new Map(), internalSubagentThreadIds: new Set(),
    interruptedCodexTurnIds: new Set(), automaticTurnRecoveryNoticeKeys: new Set(),
    activeCodexSendSequences: new Map(), interruptedCodexSendSequences: new Map(), localHistoryAheadThreadIds: new Set(),
    firstString: (...values) => values.find((value) => typeof value === "string" && value.trim()) || null,
    errorMessage: (error) => error?.message || String(error || ""),
    itemTurnId: (item) => item?.turnId || item?.turn_id || null,
    notificationThreadId: (message) => message.params?.threadId || null,
    notificationTurnId: (message) => message.params?.turnId || message.params?.turn?.id || null,
    notificationFailureReason: (message) => message.params?.turn?.error?.message || message.params?.error?.message || null,
    activeTurnIdForThread: (id) => state.activeTurnIds[id] || null,
    ensureThreadContextUsage: (id) => state.threadContextUsage[id] ||= {
      compactionStatus: "idle", compactionCount: 0, activeCompactionItemId: null,
      lastCompactionTurnId: null, lastCompactionError: null, lastCompactedAt: null, seenCompactionKeys: [],
    },
    upsertItem: (id, item) => {
      state.items[id] ||= {}; state.itemOrder[id] ||= [];
      state.items[id][item.id] = { ...state.items[id][item.id], ...item };
      if (!state.itemOrder[id].includes(item.id)) state.itemOrder[id].push(item.id);
    },
    beginContextCompactionTiming: (id) => context.contextCompactionStartedAtMs.set(id, Date.now()),
    finishContextCompactionTiming: (id) => context.contextCompactionStartedAtMs.delete(id),
    escapeHtml: (value) => String(value || "").replaceAll("<", "&lt;"),
    escapeAttr: (value) => String(value || ""),
    englishSafeAssistantText: (value) => value || "",
    isThreadBusy: (id) => context.activeCodexThreadIds.has(id),
    isDuplicateContextCompactionEvent: ({ keys, seenKeys }) => keys.some((key) => seenKeys.includes(key)),
    contextCompactionEventKeys: (message, item) => [message.params?.turnId || message.params?.turn?.id, item?.id].filter(Boolean),
    rememberContextCompactionKeys: (usage, keys) => { usage.seenCompactionKeys.push(...keys); },
  });
  vm.runInNewContext(code, context);
  context.emit = (method, turn = "turn-1", extra = {}) => context.handleNotification({
    method, params: { threadId: "thread", turnId: turn, ...extra },
  });
  context.start = (turn = "turn-1", id = "compact-1") => {
    context.emit("turn/started", turn);
    context.emit("item/started", turn, { item: { id, type: "contextCompaction" } });
  };
  context.finish = (status, turn = "turn-1", recovery) => context.emit("turn/completed", turn, {
    turn: { id: turn, status, ...(status === "failed" ? { error: { message: "stream disconnected before completion" } } : {}) },
    ...(recovery ? { haoloAutoRecovery: recovery } : {}),
  });
  return context;
}

function assertStopped(h, status = "failed", id = "compact-1") {
  assert.equal(h.state.items.thread[id].__youleContextCompactionStatus, status);
  assert.equal(h.state.threadContextUsage.thread.compactionStatus, status);
  assert.equal(h.hasActiveContextCompaction("thread"), false);
  assert.equal(h.contextCompactionStartedAtMs.has("thread"), false);
  assert.equal(h.activeCodexThreadIds.has("thread"), false);
  assert.equal(h.state.activeTurnIds.thread, undefined);
}

test("real notification handler closes failed pre-sampling compaction and exhausts recovery visibly once", () => {
  const h = harness();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const turn = `turn-${attempt}`;
    h.start(turn, `compact-${attempt}`);
    h.finish("failed", turn, { status: attempt === 3 ? "exhausted" : "scheduled", chainId: "chain" });
    assertStopped(h, "failed", `compact-${attempt}`);
  }
  h.emit("haolo/turnAutoRecovery", "turn-3", { haoloAutoRecovery: { status: "exhausted", chainId: "chain" } });
  const exhausted = h.calls.filter((call) => call.name === "appendAgentNotice" && call.args[1].includes("自动恢复仍未完成"));
  assert.equal(exhausted.length, 1);
  assert.equal(h.state.threadContextUsage.thread.compactionCount, 0);
});

test("recovery exhaustion alone closes compaction if the terminal turn notification was lost", () => {
  const h = harness(); h.start();
  h.emit("haolo/turnAutoRecovery", "turn-1", { haoloAutoRecovery: { status: "exhausted", chainId: "chain" } });
  assertStopped(h);
  h.start("turn-2", "compact-2");
  h.emit("haolo/turnAutoRecovery", "turn-1", { haoloAutoRecovery: { status: "exhausted", chainId: "chain" } });
  assert.equal(h.state.activeTurnIds.thread, "turn-2");
  assert.equal(h.state.threadContextUsage.thread.compactionStatus, "compacting");
});

for (const status of ["interrupted", "cancelled", "canceled"]) {
  test(`${status} cannot be reported as compaction success`, () => {
    const h = harness(); h.start(); h.finish(status);
    assertStopped(h);
    assert.equal(h.state.threadContextUsage.thread.compactionCount, 0);
  });
}

test("legacy turn/failed and confirmed local stop settle compaction", () => {
  const h = harness(); h.start();
  h.emit("turn/failed", "turn-1", { error: { message: "timeout" } });
  assertStopped(h);
  h.start("turn-2", "compact-2");
  h.finishInterruptedTurnLocally("thread", "turn-2", "user");
  assertStopped(h, "failed", "compact-2");
});

test("successful terminal fallback completes compaction without an item completion event", () => {
  const h = harness(); h.start(); h.finish("completed");
  assertStopped(h, "completed");
  assert.equal(h.state.threadContextUsage.thread.compactionCount, 1);
});

test("an item without a turn id inherits the current turn and closes on failure", () => {
  const h = harness();
  h.emit("turn/started");
  h.emit("item/started", null, { item: { id: "compact-1", type: "contextCompaction" } });
  h.finish("failed");
  assertStopped(h);
});

test("an error-only terminal cannot accidentally complete compaction", () => {
  const h = harness(); h.start();
  h.emit("turn/completed", "turn-1", { turn: { id: "turn-1", error: { message: "timeout" } } });
  assertStopped(h);
});

test("a later answer failure preserves an already successful compaction", () => {
  const h = harness(); h.start();
  h.emit("item/completed", "turn-1", { item: { id: "compact-1", type: "contextCompaction" } });
  h.finish("failed");
  assertStopped(h, "completed");
  assert.equal(h.state.threadContextUsage.thread.compactionCount, 1);
});

test("late notifications cannot reopen a failed compaction or stop a new turn", () => {
  const h = harness(); h.start(); h.finish("failed");
  h.emit("item/started", "turn-1", { item: { id: "compact-1", type: "contextCompaction" } });
  h.emit("item/completed", "turn-1", { item: { id: "compact-1", type: "contextCompaction" } });
  h.emit("thread/compacted", "turn-1");
  assertStopped(h);
  h.start("turn-2", "compact-2");
  h.finish("failed", "turn-1");
  h.emit("item/started", "turn-1", { item: { id: "compact-late", type: "contextCompaction" } });
  h.emit("thread/compacted", "turn-1");
  assert.equal(h.state.activeTurnIds.thread, "turn-2");
  assert.equal(h.state.threadContextUsage.thread.compactionStatus, "compacting");
  assert.equal(h.state.threadContextUsage.thread.activeCompactionItemId, "compact-2");
  assert.equal(h.hasActiveContextCompaction("thread"), true);
  h.finish("completed", "turn-2");
  assertStopped(h, "completed", "compact-2");
});

for (const method of ["item/failed", "item/completed"]) {
  test(`${method} carrying a failure cannot increment the success count`, () => {
    const h = harness(); h.start();
    h.emit(method, "turn-1", { item: { id: "compact-1", type: "contextCompaction", status: "failed", error: { message: "timeout" } } });
    h.finish("failed");
    assertStopped(h);
    assert.equal(h.state.threadContextUsage.thread.compactionCount, 0);
  });
}

test("history reconciliation terminates orphaned active items, preserves live work and does not count failures", () => {
  const h = harness(); h.start();
  h.restoreThreadContextCompactionsFromItems("thread", { turns: [{ id: "turn-1", status: "inProgress" }] });
  assert.equal(h.state.threadContextUsage.thread.compactionStatus, "compacting");
  h.activeCodexThreadIds.clear(); delete h.state.activeTurnIds.thread;
  h.restoreThreadContextCompactionsFromItems("thread", { turns: [{ id: "turn-1", status: "failed" }] });
  assertStopped(h);
  assert.equal(h.state.threadContextUsage.thread.compactionCount, 0);
  const incoming = { id: "compact-1", type: "contextCompaction", status: "inProgress" };
  assert.equal(lifecycle.mergeCompactionItem(h.state.items.thread["compact-1"], incoming).__youleContextCompactionStatus, "failed");
  h.start("turn-2", "compact-2");
  h.activeCodexThreadIds.clear(); delete h.state.activeTurnIds.thread;
  h.restoreThreadContextCompactionsFromItems("thread", { turns: [] });
  assertStopped(h, "failed", "compact-2");
});

test("restart closes orphaned inProgress history while an authoritative active snapshot stays live", () => {
  const h = harness(); h.start();
  h.activeCodexThreadIds.clear(); delete h.state.activeTurnIds.thread;
  h.restoreThreadContextCompactionsFromItems("thread", { status: { type: "active" }, turns: [{ id: "turn-1", status: "inProgress" }] });
  assert.equal(h.hasActiveContextCompaction("thread"), true);
  h.restoreThreadContextCompactionsFromItems("thread", { status: { type: "idle" }, turns: [{ id: "turn-1", status: "inProgress" }] });
  assertStopped(h);
});

test("manual pre-send compaction cannot dispatch after a failed terminal even if IPC resolves", async () => {
  const h = harness();
  let resolve;
  h.api.compactThread = () => new Promise((done) => { resolve = done; });
  const pending = h.requestAutomaticThreadContextCompaction("thread");
  h.start(); h.finish("failed");
  resolve({});
  assert.equal(await pending, false);
  assertStopped(h);
  assert.equal(h.contextCompactionPromises.size, 0);
});

test("a rejected compaction bridge releases busy state even without a terminal notification", async () => {
  const h = harness();
  let reject;
  h.api.compactThread = () => new Promise((resolve, fail) => { reject = fail; });
  const pending = h.requestAutomaticThreadContextCompaction("thread");
  h.start();
  reject(new Error("Thread compaction interrupted: app server stopped"));
  assert.equal(await pending, false);
  assertStopped(h);
  assert.equal(h.contextCompactionPromises.size, 0);
});

test("an error-only compaction item is terminal and does not count as success", () => {
  const h = harness(); h.start();
  h.emit("item/completed", "turn-1", { item: { id: "compact-1", type: "contextCompaction", error: { message: "timeout" } } });
  h.finish("failed");
  assertStopped(h);
  assert.equal(h.state.threadContextUsage.thread.compactionCount, 0);
});

test("both themes render terminal bubbles without animation or elapsed timer", () => {
  const h = harness();
  const css = fs.readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  for (const theme of ["light", "dark"]) {
    h.state.settings.theme = theme;
    for (const status of ["failed", "completed"]) {
      const html = h.renderContextCompactionBubble({ status, error: "<error>", elapsedLabel: "99s" });
      assert.doesNotMatch(html, /thinking-dots|context-compaction-elapsed/);
      assert.match(html, /role="status"/);
      const prefix = theme === "dark" ? 'html\\[data-theme="dark"\\] ' : "";
      assert.match(css, new RegExp(`${prefix}\\.context-compaction-bubble\\.${status} \\.context-compaction-text\\s*\\{[^}]*color:`));
    }
  }
});

test("interruption guidance has complete English and Traditional Chinese translations", () => {
  const message = "上下文压缩已中断，请重试。";
  assert.equal(GENERATED_ENGLISH_UI_PHRASES[message], "Context compaction was interrupted. Please try again.");
  assert.equal(GENERATED_TRADITIONAL_UI_PHRASES[message], "上下文壓縮已中斷，請重試。");
});

test("the main process always forwards recovery exhaustion with its turn identity", () => {
  const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
  const ast = ts.createSourceFile("main.mjs", main, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "handleAutomaticTurnRecoveryEvent");
  const messages = [];
  const runtime = { appendAppServerLogLine() {}, safeLogToken: String, sendToRenderer: (channel, message) => messages.push({ channel, message }) };
  vm.runInNewContext(fn.getText(ast), runtime);
  runtime.handleAutomaticTurnRecoveryEvent({ event: "exhausted", threadId: "thread", failedTurnId: "turn", failedToStart: false });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.params.turnId, "turn");
  assert.equal(messages[0].message.params.haoloAutoRecovery.status, "exhausted");
});
