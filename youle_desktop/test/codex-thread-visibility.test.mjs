import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  internalSubagentThreadIdsFromProcessItem,
  isInternalSubagentThreadRecord,
  isInternalSubagentThreadStartedNotification,
  subagentActivityThreadIdsFromProcessItem,
} from "../src/main/codex-thread-visibility.mjs";

const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("recognizes every internal subagent thread source shape", () => {
  const records = [
    { id: "child-1", source: "subAgent" },
    { id: "child-2", sourceKind: "subAgentThreadSpawn" },
    { id: "child-3", source_kind: "sub_agent_review" },
    { id: "child-4", thread_source: "subagent" },
    { id: "child-5", source: { subagent: { thread_spawn: { parent_thread_id: "root" } } } },
    { id: "child-6", source: { kind: "subAgentCompact" } },
    { id: "child-7", parentThreadId: "root" },
    { id: "child-8", parent_thread_id: "root" },
    { id: "child-9", source: { parentThreadId: "root" } },
    { id: "child-10", source: { parent_thread_id: "root" } },
    {
      id: "child-11",
      source: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: "root" } } }),
    },
    { id: "child-12", source: { subAgent: { thread_spawn: { parent_thread_id: "root" } } } },
  ];

  for (const record of records) assert.equal(isInternalSubagentThreadRecord(record), true, record.id);
});

test("keeps user-created top-level threads visible", () => {
  const records = [
    { id: "root-1", source: "vscode" },
    { id: "root-2", sourceKind: "appServer" },
    { id: "root-3", thread_source: "user", source: { user: {} } },
    { id: "root-4" },
    { id: "root-5", receiverThreadIds: ["root-1", "root-2"] },
    { id: "root-6", agents_states: { "root-1": { status: "running" } } },
    { id: "root-7", source: JSON.stringify({ vscode: {} }) },
  ];

  for (const record of records) assert.equal(isInternalSubagentThreadRecord(record), false, record.id);
});

test("only classifies thread/started notifications with a subagent thread record", () => {
  assert.equal(
    isInternalSubagentThreadStartedNotification({
      method: "thread/started",
      params: { thread: { id: "child", source: "subAgent" } },
    }),
    true,
  );
  assert.equal(
    isInternalSubagentThreadStartedNotification({
      method: "thread/started",
      params: { thread: { id: "root", source: "vscode" } },
    }),
    false,
  );
  assert.equal(
    isInternalSubagentThreadStartedNotification({
      method: "thread/started",
      params: { thread: { id: "child-with-parent", parentThreadId: "root" } },
    }),
    true,
  );
  assert.equal(
    isInternalSubagentThreadStartedNotification({
      method: "item/completed",
      params: { thread: { id: "child", source: "subAgent" } },
    }),
    false,
  );
});

test("treats collaboration process ids as activity hints, not authoritative thread records", () => {
  assert.deepEqual(
    subagentActivityThreadIdsFromProcessItem({
      type: "sub_agent_activity",
      agent_thread_id: "child-activity",
    }),
    ["child-activity"],
  );
  const participantIds = subagentActivityThreadIdsFromProcessItem({
    type: "collabAgentToolCall",
    receiverThreadIds: ["parent-thread"],
    receiver_thread_ids: ["peer-thread", "parent-thread"],
    agents_states: { "peer-state-thread": { status: "running" } },
  });
  assert.deepEqual(participantIds, ["parent-thread", "peer-thread", "peer-state-thread"]);
  for (const threadId of participantIds) {
    assert.equal(isInternalSubagentThreadRecord({ id: threadId }), false, threadId);
  }
});

test("direct sub-agent activity and spawn receivers establish child identity before thread/started", () => {
  assert.deepEqual(
    internalSubagentThreadIdsFromProcessItem({
      type: "sub_agent_activity",
      agent_thread_id: "child-direct",
      kind: "started",
    }),
    ["child-direct"],
  );
  assert.deepEqual(
    internalSubagentThreadIdsFromProcessItem({
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      receiverThreadIds: ["spawned-child"],
      agentsStates: { "another-participant": { status: "running" } },
    }),
    ["spawned-child"],
  );
  assert.deepEqual(
    internalSubagentThreadIdsFromProcessItem({
      type: "collabAgentToolCall",
      tool: "sendInput",
      receiverThreadIds: ["parent-or-peer"],
      agentsStates: { "another-participant": { status: "running" } },
    }),
    [],
  );
});

test("main learns hidden thread ids from thread records and direct parent activity", async () => {
  const source = await mainSource;
  const notificationHandler = sourceBlock(
    source,
    "function handleClientNotification",
    "function recordArtifactAgentMessageNotification",
  );

  assert.match(notificationHandler, /isInternalSubagentThreadStartedNotification\(message\)/);
  assert.match(notificationHandler, /internalSubagentThreadIdsFromProcessItem\(message\?\.params\?\.item\)/);
  assert.match(notificationHandler, /internalSubagentThreads\.rememberInternal\(serverClient, childThreadId\)/);
  const childNotificationBranch = sourceBlock(
    notificationHandler,
    "if (threadId && internalSubagentThreads.has(serverClient, String(threadId)))",
    "if (!threadId && turnId && automationTurnThreadIds.has(turnId))",
  );
  assert.match(childNotificationBranch, /sendToRenderer\("codex:notification", boundedCodexNotificationForRenderer\(message\)\)/);
  assert.match(childNotificationBranch, /return;/);
});

test("main list visibility depends only on authoritative thread records", async () => {
  const source = await mainSource;
  const listHandler = sourceBlock(source, 'ipcMain.handle("codex:listThreads"', 'ipcMain.handle("codex:modelList"');

  assert.match(listHandler, /isInternalSubagentThreadRecord\(thread\)/);
  assert.match(listHandler, /internalSubagentThreads\.has\(serverClient, threadId\)/);
  assert.doesNotMatch(listHandler, /internalSubagentThreadIdsFromProcessItem/);
  assert.doesNotMatch(listHandler, /internalSubagentThreadIds\.has\(/);
  assert.doesNotMatch(source, /codex:searchThreads/);
});

test("renderer trusts only direct child activity while keeping parent and peer conversations visible", async () => {
  const source = await rendererSource;
  const processItemVisibility = sourceBlock(
    source,
    "function rememberInternalSubagentThreadsFromItem",
    "function upsertItem",
  );

  assert.match(processItemVisibility, /directSubagentThreadIdsFromItem\(item\)/);
  assert.match(processItemVisibility, /rememberSubagentParentThread\(/);
  assert.match(processItemVisibility, /directChildThreadIds\.has\(threadId\) \|\| internalSubagentThreadIds\.has\(threadId\)/);
  assert.match(processItemVisibility, /internalSubagentThreadIds\.add\(childThreadId\)/);
  assert.match(processItemVisibility, /hideConfirmedInternalSubagentThread\([\s\S]*childThreadId,[\s\S]*parentThreadId/);
});

test("renderer only hides authoritative child records and repairs the current selection", async () => {
  const source = await rendererSource;
  const notificationHandler = sourceBlock(source, "function handleNotification", "function handleAutomationThreadNotification");
  const authoritativeHide = sourceBlock(
    source,
    "function hideConfirmedInternalSubagentThread",
    "function subagentParentThreadIdFromRecord",
  );

  assert.match(notificationHandler, /startedThreadId[\s\S]*confirmInternalSubagentThreadRecord\(message\.params\.thread\)/);
  assert.doesNotMatch(notificationHandler, /internalSubagentThreadIds\.delete/);
  assert.doesNotMatch(source, /function hasAuthoritativeThreadVisibilityRecord/);
  assert.match(source, /function threadSourceRecordForRenderer[\s\S]*JSON\.parse\(serialized\)/);
  assert.match(authoritativeHide, /invalidateThreadSwitchTransition\(threadId\)/);
  assert.match(authoritativeHide, /ensureTopLevelBlankThreadForList\(\{ activateIfMissingSelection: true \}\)/);
});

test("renderer ingests internal read/resume snapshots before the top-level merge boundary", async () => {
  const source = await rendererSource;
  const loadThread = sourceBlock(source, "function loadThread(thread:", "function loadThreadInBackground");
  const confirmRecord = sourceBlock(
    source,
    "function confirmInternalSubagentThreadRecord",
    "function ensureSubagentActivity",
  );
  const ingestSnapshot = sourceBlock(
    source,
    "function ingestInternalSubagentThreadSnapshot",
    "function clearLeakedSubagentTopLevelTurnTracking",
  );
  const completionHydration = sourceBlock(
    source,
    "async function hydrateInternalSubagentThreadSnapshot",
    "function loadSubagentActivityStore",
  );

  assert.match(loadThread, /if \(confirmInternalSubagentThreadRecord\(thread\)\) return;/);
  assert.ok(
    loadThread.indexOf("confirmInternalSubagentThreadRecord(thread)") < loadThread.indexOf("threadDetailSnapshotSignature(thread)"),
    "classification must happen before any ordinary thread state is loaded",
  );
  assert.match(confirmRecord, /isInternalSubagentThreadRecordForRenderer\(thread\)/);
  assert.match(confirmRecord, /adoptLeakedSubagentActivityItems\(threadId\)/);
  assert.match(confirmRecord, /ingestInternalSubagentThreadSnapshot\(threadId, thread\)/);
  assert.match(confirmRecord, /hideConfirmedInternalSubagentThread\(threadId, parentThreadId\)/);
  assert.match(ingestSnapshot, /orderedThreadItems\(thread, \[\], \{ threadId \}\)/);
  assert.match(ingestSnapshot, /item\.type === "agentMessage"/);
  assert.match(ingestSnapshot, /activity\.completedAtMs/);
  assert.match(ingestSnapshot, /clearLeakedSubagentTopLevelTurnTracking/);
  assert.match(completionHydration, /resumeThreadForBackgroundHydration\(threadId, hydrationSession, \{ displayCache: true \}\)/);
  assert.match(completionHydration, /confirmInternalSubagentThreadRecord\(result\.thread\)/);
  assert.match(completionHydration, /scheduleInternalSubagentThreadHydration\(threadId\)/);
});

test("renderer has final sidebar and preference defenses for confirmed children", async () => {
  const source = await rendererSource;
  const filtered = sourceBlock(source, "function filteredThreads", "function threadById");
  const visible = sourceBlock(source, "function visibleConversationThreadsForChatList", "function renderThreadGroupSetDialog");
  const assign = sourceBlock(source, "function assignThreadToDefaultGroup", "function assignThreadsToDefaultGroup");
  const persist = sourceBlock(source, "function shouldPersistThreadPreferenceId", "function loadContactPreferences");

  for (const block of [filtered, visible, assign, persist]) {
    assert.match(block, /internalSubagentThreadIds\.has/);
  }
});

test("renderer keeps confirmed children hidden across completion snapshots", async () => {
  const source = await rendererSource;
  const loadThreads = sourceBlock(source, "async function loadThreads", "async function reconcilePersistedThreadContinuations");

  assert.match(loadThreads, /recordIsInternalSubagent \|\| internalSubagentThreadIds\.has\(recordThreadId\)/);
  assert.doesNotMatch(source, /prepareServerConversationSearchResults|queueConversationSearchHydrations/);
  assert.doesNotMatch(source, /internalSubagentThreadIds\.delete\(/);
});

test("sparse list records are transient and logout clears account-scoped subagent state", async () => {
  const source = await rendererSource;
  const loadThreads = sourceBlock(source, "async function loadThreads", "async function reconcilePersistedThreadContinuations");
  const sparsePolicy = sourceBlock(source, "function isSparseBlankThreadListRecord", "function hasVisibleThreadRecordContent");
  const resetBlock = sourceBlock(source, "function resetAuthenticatedWorkspace", "function revokeAttachmentPreviews");

  assert.match(loadThreads, /if \(isSparseBlankThreadListRecord\(entry\.record, thread\)\) return false;/);
  assert.doesNotMatch(loadThreads, /hiddenThreadIds\.add\(thread\.id\)/);
  assert.match(loadThreads, /workspaceGeneration === authenticatedWorkspaceGeneration && state\.auth\.authenticated/);
  assert.match(loadThreads, /if \(!isCurrentWorkspace\(\)\) return false;/);
  assert.match(sparsePolicy, /summary\.id === state\.currentThreadId/);
  assert.match(sparsePolicy, /hasCachedVisibleThreadContent\(summary\.id\)/);
  assert.match(resetBlock, /authenticatedWorkspaceGeneration \+= 1/);
  assert.match(resetBlock, /clearTimeout\(deferredThreadListRefreshTimer\)/);
  assert.match(resetBlock, /internalSubagentThreadIds\.clear\(\)/);
  assert.match(resetBlock, /subagentActivityByThreadId\.clear\(\)/);
});
