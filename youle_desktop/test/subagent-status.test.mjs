import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applySubagentActivityLifecycle,
  buildSubagentStatusEntries,
  directSubagentThreadIdsFromItem,
  isSubagentProcessItem,
  persistedSubagentStatusEntry,
  pruneSubagentActivityItems,
  resolveSubagentPanelThreadId,
  selectPersistedSubagentThreadIds,
  selectSubagentOwnedSnapshotTurns,
  shouldShowSubagentStatusEntry,
  subagentOutputFingerprint,
  subagentProcessPresentation,
  subagentProfessionForTask,
  subagentThreadIdsFromItem,
} from "../src/renderer/subagent-status.ts";

test("forked sub-agent snapshots keep only child-owned turns and normalize duplicate final output", () => {
  const turns = [
    { id: "parent-old", startedAt: 1_000, status: "completed", items: [{ id: "parent-message-old" }] },
    { id: "parent-current", startedAt: 2_000, status: "running", items: [{ id: "parent-message-current" }] },
    { id: "child-first", startedAt: 2_010, status: "completed", items: [{ id: "child-final" }] },
    { id: "child-follow-up", startedAt: 2_030, status: "completed", items: [{ id: "child-final-2" }] },
  ];
  assert.deepEqual(
    selectSubagentOwnedSnapshotTurns(turns, {
      parentTurnId: "parent-current",
      startedAtMs: 2_009_000,
    }).map((turn) => turn.id),
    ["child-first", "child-follow-up"],
  );
  assert.deepEqual(
    selectSubagentOwnedSnapshotTurns(turns.slice(0, 2), { parentTurnId: "parent-current" }),
    [],
  );
  assert.deepEqual(
    selectSubagentOwnedSnapshotTurns(turns, { parentTurnId: "parent-current" }).map((turn) => turn.id),
    ["child-follow-up"],
  );

  const finalText = "创意草稿如下\n\n标题备选：\n1. 示例";
  const wrappedFinalText = `Message Type: FINAL_ANSWER\nTask name: /root\nSender: /root/writer\nPayload:\n${finalText.replace(/\n/g, "\r\n")}`;
  assert.equal(subagentOutputFingerprint(wrappedFinalText), subagentOutputFingerprint(finalText));
  assert.equal(subagentOutputFingerprint(` ${finalText}\u200B `), subagentOutputFingerprint(finalText));
});

test("sub-agent process presentation exposes safe progress without leaking private reasoning or command text", () => {
  assert.deepEqual(
    subagentProcessPresentation({
      type: "reasoning",
      status: "completed",
      summary: ["先核验来源，再整理结论。"],
      encrypted_content: "private-chain-of-thought",
    }),
    {
      kind: "reasoning",
      label: "思考摘要",
      text: "先核验来源，再整理结论。",
      phase: "completed",
    },
  );

  const encryptedOnly = subagentProcessPresentation({
    type: "reasoning",
    status: "inProgress",
    summary: [],
    encrypted_content: "private-chain-of-thought",
  });
  assert.equal(encryptedOnly?.label, "思考中");
  assert.match(encryptedOnly?.text || "", /正在分析任务/);
  assert.doesNotMatch(encryptedOnly?.text || "", /private-chain-of-thought/);

  const command = subagentProcessPresentation({
    type: "commandExecution",
    status: "inProgress",
    command: "curl -H 'Authorization: secret-token' https://example.com",
    aggregatedOutput: "secret response",
  });
  assert.deepEqual(command, {
    kind: "activity",
    label: "本地执行",
    text: "正在执行本地任务步骤。",
    phase: "running",
  });
  assert.doesNotMatch(JSON.stringify(command), /secret-token|secret response/);

  assert.deepEqual(
    subagentProcessPresentation({ type: "webSearch", status: "completed", query: "AI 圈近期新闻" }),
    {
      kind: "activity",
      label: "资料检索",
      text: "已完成联网检索：AI 圈近期新闻",
      phase: "completed",
    },
  );
  assert.equal(subagentProcessPresentation({ type: "userMessage", text: "hidden prompt" }), null);
});

test("resolves the active sub-agent panel without stealing a valid selection", () => {
  assert.equal(resolveSubagentPanelThreadId("agent-a", ["agent-b"]), "agent-b");
  assert.equal(resolveSubagentPanelThreadId("agent-b", ["agent-a", "agent-b"]), "agent-b");
  assert.equal(resolveSubagentPanelThreadId("agent-b", ["agent-b", "agent-a"]), "agent-b");

  for (const savedThreadId of [null, undefined, "", "agent-only", "stale-agent"]) {
    assert.equal(resolveSubagentPanelThreadId(savedThreadId, ["agent-only"]), "agent-only");
  }
  assert.equal(resolveSubagentPanelThreadId("agent-a", []), null);
});

test("aggregates real collaboration states and keeps the latest task for each sub-agent", () => {
  const entries = buildSubagentStatusEntries([
    {
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      status: "completed",
      receiverThreadIds: ["agent-a"],
      prompt: "检查客户端状态展示",
      agentsStates: { "agent-a": { status: "running", message: null } },
    },
    {
      type: "collabAgentToolCall",
      tool: "sendInput",
      status: "completed",
      receiverThreadIds: ["agent-a"],
      prompt: "补充复核暗色模式",
      agentsStates: { "agent-a": { status: "running", message: null } },
    },
    {
      type: "collabAgentToolCall",
      tool: "wait",
      status: "completed",
      receiverThreadIds: ["agent-a"],
      prompt: null,
      agentsStates: { "agent-a": { status: "completed", message: "done" } },
    },
    {
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      status: "failed",
      receiver_thread_ids: ["agent-b"],
      prompt: "检查异常状态",
      agents_states: {},
    },
  ]);

  assert.deepEqual(entries, [
    {
      threadId: "agent-a",
      task: "补充复核暗色模式",
      stage: "completed",
      statusLabel: "已完成",
      progressSegments: 12,
      output: "done",
    },
    {
      threadId: "agent-b",
      task: "检查异常状态",
      stage: "failed",
      statusLabel: "遇到问题",
      progressSegments: 12,
      output: null,
    },
  ]);
});

test("supports nested sub-agent activity and hides encrypted task payloads", () => {
  assert.equal(isSubagentProcessItem({ type: "subAgentActivity" }), true);
  assert.equal(isSubagentProcessItem({ type: "reasoning" }), false);

  const [nested, encrypted] = buildSubagentStatusEntries([
    {
      type: "subAgentActivity",
      kind: "started",
      agentThreadId: "nested-agent",
      agentPath: "/root/layout_review",
    },
    {
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      status: "inProgress",
      receiverThreadIds: ["encrypted-agent"],
      prompt: `gAAAA${"x".repeat(60)}`,
      agentsStates: { "encrypted-agent": { status: "pendingInit", message: null } },
    },
  ]);

  assert.equal(nested.task, "协同处理 layout review");
  assert.equal(nested.stage, "working");
  assert.equal(encrypted.task, "协同推进关联任务");
  assert.equal(encrypted.stage, "starting");
  assert.equal(encrypted.progressSegments, 2);
  assert.equal(encrypted.output, null);
});

test("extracts child thread ids from both collaboration event shapes", () => {
  assert.deepEqual(
    subagentThreadIdsFromItem({
      type: "subAgentActivity",
      agent_thread_id: "child-from-activity",
    }),
    ["child-from-activity"],
  );
  assert.deepEqual(
    subagentThreadIdsFromItem({
      type: "collabAgentToolCall",
      receiverThreadIds: ["child-a"],
      receiver_thread_ids: ["child-b", "child-a"],
      agentsStates: { "child-c": { status: "running" } },
    }),
    ["child-a", "child-b", "child-c"],
  );
});

test("direct child identity accepts spawn receivers and excludes later collaboration participants", () => {
  assert.deepEqual(
    directSubagentThreadIdsFromItem({
      type: "sub_agent_activity",
      agent_thread_id: "direct-child",
    }),
    ["direct-child"],
  );
  assert.deepEqual(
    directSubagentThreadIdsFromItem({
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      receiverThreadIds: ["spawned-child"],
      agentsStates: { "another-participant": { status: "running" } },
    }),
    ["spawned-child"],
  );
  assert.deepEqual(
    directSubagentThreadIdsFromItem({
      type: "collabAgentToolCall",
      tool: "wait",
      receiverThreadIds: ["parent-or-peer"],
      agentsStates: { "another-participant": { status: "running" } },
    }),
    [],
  );
});

test("child lifecycle snapshots keep all cards and override parent started-only activity", () => {
  const entries = buildSubagentStatusEntries(["a", "b", "c"].map((threadId) => ({
    type: "subAgentActivity",
    kind: "started",
    agentThreadId: threadId,
    agentPath: `/root/${threadId}`,
  })));
  const effective = entries.map((entry, index) => applySubagentActivityLifecycle(entry, {
    busy: index === 2,
    failed: false,
    completedAtMs: index < 2 ? 1234 + index : null,
  }));

  assert.deepEqual(effective.map((entry) => entry.threadId), ["a", "b", "c"]);
  assert.deepEqual(effective.map((entry) => entry.stage), ["completed", "completed", "working"]);
  assert.deepEqual(effective.map((entry) => entry.progressSegments), [12, 12, 7]);
});

test("persisted sub-agent activity restores a completed dashboard entry", () => {
  const completed = persistedSubagentStatusEntry({
    threadId: "completed-child",
    task: "review the finished copy",
  });
  assert.equal(completed.threadId, "completed-child");
  assert.equal(completed.task, "review the finished copy");
  assert.equal(completed.stage, "completed");
  assert.equal(completed.progressSegments, 12);

  const running = persistedSubagentStatusEntry({
    threadId: "running-child",
    task: null,
    busy: true,
  });
  assert.equal(running.stage, "working");
  assert.ok(running.task);

  const failed = persistedSubagentStatusEntry({
    threadId: "failed-child",
    failed: true,
  });
  assert.equal(failed.stage, "failed");
  assert.equal(failed.progressSegments, 12);
});

test("persisted dashboard recovery keeps only the latest task cohort", () => {
  const activities = [
    { threadId: "old-a", parentTurnId: "turn-old", startedAtMs: 100 },
    { threadId: "current-a", parentTurnId: "turn-current", startedAtMs: 300 },
    { threadId: "current-b", parentTurnId: "turn-current", startedAtMs: 320 },
  ];
  assert.deepEqual(
    selectPersistedSubagentThreadIds(activities, "turn-current", true),
    ["current-a", "current-b"],
  );
  assert.deepEqual(
    selectPersistedSubagentThreadIds(activities, null, true),
    ["current-a", "current-b"],
  );
  assert.deepEqual(
    selectPersistedSubagentThreadIds(activities, "missing-turn", false),
    [],
  );

  assert.deepEqual(
    selectPersistedSubagentThreadIds(
      [
        { threadId: "legacy-old", startedAtMs: 1 },
        { threadId: "legacy-current-a", startedAtMs: 600_000 },
        { threadId: "legacy-current-b", startedAtMs: 600_500 },
      ],
      "turn-current",
      true,
    ),
    ["legacy-current-a", "legacy-current-b"],
  );
});

test("assigns realistic professions from each sub-agent task", () => {
  assert.equal(subagentProfessionForTask("audit client UI interactions", 0), "前端工程师");
  assert.equal(subagentProfessionForTask("review main IPC protocol", 1), "系统架构师");
  assert.equal(subagentProfessionForTask("inspect tests and risk coverage", 2), "测试工程师");
  assert.equal(subagentProfessionForTask("analyze sales data and metrics", 3), "数据分析师");
  assert.equal(subagentProfessionForTask("coordinate the remaining work", 0), "项目顾问");
});

test("keeps the latest non-empty child output across later status events", () => {
  const [entry] = buildSubagentStatusEntries([
    {
      type: "collabAgentToolCall",
      tool: "wait",
      status: "completed",
      receiverThreadIds: ["agent-output"],
      agentsStates: { "agent-output": { status: "completed", message: "子 Agent 的完整审计结论" } },
    },
    {
      type: "collabAgentToolCall",
      tool: "closeAgent",
      status: "completed",
      receiverThreadIds: ["agent-output"],
      agentsStates: { "agent-output": { status: "shutdown", message: null } },
    },
  ]);

  assert.equal(entry.output, "子 Agent 的完整审计结论");
  assert.equal(entry.stage, "completed");
});

test("keeps a completed child card when a leaked top-level row has the same id", () => {
  assert.equal(shouldShowSubagentStatusEntry({
    parentThreadId: "parent",
    childThreadId: "child",
    confirmedParentThreadId: "parent",
    isListedTopLevel: true,
  }), true);
  assert.equal(shouldShowSubagentStatusEntry({
    parentThreadId: "parent",
    childThreadId: "child",
    isKnownInternal: true,
    isListedTopLevel: true,
  }), true);
  assert.equal(shouldShowSubagentStatusEntry({
    parentThreadId: "parent",
    childThreadId: "top-level-peer",
    isListedTopLevel: true,
  }), false);
  assert.equal(shouldShowSubagentStatusEntry({
    parentThreadId: "parent",
    childThreadId: "starting-child",
    isListedTopLevel: false,
  }), true);
  assert.equal(shouldShowSubagentStatusEntry({
    parentThreadId: "parent",
    childThreadId: "nested-child",
    confirmedParentThreadId: "other-parent",
    isKnownInternal: true,
    isListedTopLevel: false,
  }), false);
  assert.equal(shouldShowSubagentStatusEntry({
    parentThreadId: "parent",
    childThreadId: "parent",
    isKnownInternal: true,
  }), false);
});

test("activity pruning never removes rendered sub-agent replies", () => {
  const itemOrder = ["reply-1", "reasoning-1", "command-1", "reply-2", "reasoning-2"];
  const items = {
    "reply-1": { type: "agentMessage" },
    "reasoning-1": { type: "reasoning" },
    "command-1": { type: "commandExecution" },
    "reply-2": { type: "agentMessage" },
    "reasoning-2": { type: "reasoning" },
  };

  pruneSubagentActivityItems(itemOrder, items, 3);

  assert.deepEqual(itemOrder, ["reply-1", "reply-2", "reasoning-2"]);
  assert.ok(items["reply-1"]);
  assert.ok(items["reply-2"]);
  assert.equal(items["reasoning-1"], undefined);
  assert.equal(items["command-1"], undefined);

  const replyOnlyOrder = ["reply-1", "reply-2", "reply-3"];
  const replyOnlyItems = Object.fromEntries(replyOnlyOrder.map((id) => [id, { type: "agentMessage" }]));
  pruneSubagentActivityItems(replyOnlyOrder, replyOnlyItems, 1);
  assert.deepEqual(replyOnlyOrder, ["reply-1", "reply-2", "reply-3"]);
});

test("renderer replaces thinking with the branded cluster but lets compaction win", async () => {
  const [renderer, styles] = await Promise.all([
    readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  ]);

  const thinkingStart = renderer.indexOf("function activeSubagentUiEntries");
  const thinkingEnd = renderer.indexOf("function hasActiveFinalAnswerMessage", thinkingStart);
  const thinkingSection = renderer.slice(thinkingStart, thinkingEnd);
  assert.match(thinkingSection, /buildSubagentStatusEntries\(processItems\)/);
  assert.match(thinkingSection, /shouldShowSubagentStatusEntry\(\{/);
  assert.match(thinkingSection, /confirmedParentThreadId: subagentActivityByThreadId\.get\(agent\.threadId\)\?\.parentThreadId/);
  assert.match(thinkingSection, /turnId === activeTurnId/);
  assert.ok(
    thinkingSection.indexOf("hasActiveContextCompaction(threadId)") < thinkingSection.indexOf("activeSubagentUiEntries(threadId)"),
    "context compaction must suppress the sub-agent cluster",
  );
  assert.match(thinkingSection, /subagents,/);

  assert.match(renderer, /const SUBAGENT_PERSONA_NAMES = \["岑知", "林序", "苏澄", "沈川"/);
  assert.match(renderer, /haolo-avatar-researcher\.jpg/);
  assert.match(renderer, /renderSubagentCluster\(/);
  const clusterRenderer = renderer.slice(renderer.indexOf("function renderSubagentCluster"), renderer.indexOf("function renderSubagentClusterRow"));
  assert.doesNotMatch(clusterRenderer, /协作小队|<strong>/);
  assert.match(clusterRenderer, /subagent-cluster-summary/);
  assert.match(renderer, /subagentProfessionForTask\(agent\.task, index\)/);
  assert.match(renderer, /subagent-cluster-profession/);
  assert.match(renderer, /subagent-status-row/);
  assert.match(renderer, /data-open-subagent-thread="\$\{escapeAttr\(agent\.threadId\)\}"/);
  assert.match(renderer, /const name = englishSafeAssistantText\(agent\.name, "Agent"\)/);
  assert.match(renderer, /aria-label="\$\{escapeAttr\(english \? `View \$\{name\} in the system board`/);
  assert.match(renderer, /renderSubagentOutputBoard\(/);
  assert.match(renderer, /function persistedSubagentStatusEntriesForParent\(/);
  assert.match(renderer, /activity\.parentThreadId === parentThreadId/);
  assert.match(renderer, /selectPersistedSubagentThreadIds\(/);
  assert.match(renderer, /const persistedEntries = persistedSubagentStatusEntriesForParent\(/);
  assert.match(renderer, /processEntries\.length === 0/);
  assert.match(renderer, /entries\.push\(entry\)/);
  assert.match(renderer, /parentTurnId: firstString\(record\.parentTurnId\)/);
  assert.match(renderer, /task: firstString\(record\.task\)/);
  assert.match(renderer, /JSON\.stringify\(\{ version: 3, activities \}\)/);
  assert.match(renderer, /ownershipReconciled: record\.ownershipReconciled === true/);
  assert.match(renderer, /selectSubagentOwnedSnapshotTurns\(turns,/);
  assert.match(renderer, /!activity\.ownershipReconciled && ownedTurns\.length && activity\.itemOrder\.length/);
  assert.match(renderer, /activity\.itemOrder = \[\];\s*activity\.items = \{\};/);
  assert.match(renderer, /allSnapshotItemIds\.has\(itemId\)/);
  assert.match(renderer, /activity\.ownershipReconciled = true/);
  assert.match(renderer, /data-subagent-panel-tab/);
  assert.match(renderer, /class="workflow-scroll-area subagent-output-area"/);
  assert.match(renderer, /data-action="scroll-workflow-bottom"/);
  assert.match(renderer, /function updateWorkflowScrollBottomButton/);
  assert.match(renderer, /function syncSubagentOutputScrollbarInset/);
  assert.match(renderer, /scroller\.offsetWidth - scroller\.clientWidth/);
  assert.match(renderer, /--subagent-output-scrollbar-width/);
  assert.match(renderer, /messageScrollerDistanceToBottom\(scroller\) > MESSAGE_SCROLL_BOTTOM_THRESHOLD_PX/);
  assert.match(renderer, /scrollWorkflowToBottom\(scroller, \{ smooth: true \}\)/);
  assert.match(renderer, /workflowScroller\.addEventListener\([\s\S]*?"scroll"[\s\S]*?updateWorkflowScrollBottomButton/);
  assert.match(renderer, /function subagentTurnResultMeta/);
  assert.match(renderer, /const completed = agent\.stage === "completed" \|\| Boolean\(activity\?\.completedAtMs && !activity\.busy && !activity\.failed\)/);
  assert.match(renderer, /if \(!completed \|\| outputs\.length < 2\) return null/);
  assert.match(renderer, /const visibleOutputs = turnResult && !turnResult\.expanded \? outputs\.slice\(-1\) : outputs/);
  assert.match(renderer, /renderSubagentOutputMessage\(agent, output, index === visibleOutputs\.length - 1 \? turnResult : null\)/);
  assert.match(renderer, /turnResult \? renderTurnResultToggle\(turnResult\) : ""/);
  assert.match(renderer, /subagentOutputElapsedLabel\(agent\.threadId\)/);
  assert.match(renderer, /patchActiveSubagentOutputPanel\(parentThreadId, childThreadId\) \|\| render\(\)/);
  assert.match(renderer, /const subagentActivityByThreadId = loadSubagentActivityStore\(\)/);
  assert.match(renderer, /localStorage\.getItem\(SUBAGENT_ACTIVITY_STORAGE_KEY\)/);
  assert.match(renderer, /localStorage\.setItem\(SUBAGENT_ACTIVITY_STORAGE_KEY/);
  assert.match(renderer, /schedulePersistSubagentActivityStore\(message\.method === "turn\/completed" \|\| message\.method === "turn\/failed"\)/);
  assert.match(renderer, /persistSubagentActivityStore\(\);\s*\}\);/);
  const tabRenderer = renderer.slice(renderer.indexOf("function renderSubagentPanelTab"), renderer.indexOf("function renderSubagentOutputPanel"));
  const outputRenderer = renderer.slice(renderer.indexOf("function renderSubagentOutputPanel"), renderer.indexOf("function patchActiveAgentPanel"));
  assert.doesNotMatch(tabRenderer, /<strong>|<small>/);
  assert.match(tabRenderer, /<img src=/);
  assert.doesNotMatch(outputRenderer, /subagent-output-head/);
  assert.doesNotMatch(outputRenderer, /subagentActivityTask\(agent\)/);
  assert.doesNotMatch(outputRenderer, /renderTaskTimeline\(task\)/);
  assert.match(outputRenderer, /subagent-output-stream/);
  assert.match(outputRenderer, /if \(selected\) scheduleMissingSubagentProcessHistoryHydration\(agent\)/);
  assert.match(outputRenderer, /subagentActivityItems\(agent\.threadId\)\.some\(\(item\) => Boolean\(subagentProcessPresentation\(item\)\)\)/);
  assert.match(outputRenderer, /subagentProcessPresentation\(item\)/);
  assert.match(outputRenderer, /previous\.kind !== "message"/);
  assert.match(outputRenderer, /subagentOutputFingerprint\(output\.text\)/);
  assert.match(outputRenderer, /subagentOutputFingerprint\(candidate\.text\) === fingerprint/);
  assert.match(outputRenderer, /renderSubagentProcessUpdate\(output, turnResult\)/);
  assert.match(outputRenderer, /subagent-process-update/);
  assert.match(outputRenderer, /subagent-process-marker/);
  assert.match(outputRenderer, /subagent-process-body/);
  assert.match(outputRenderer, /turnResult && !turnResult\.expanded \? outputs\.slice\(-1\) : outputs/);
  assert.match(outputRenderer, /renderSubagentOutputMessage\(agent, output,/);
  assert.match(outputRenderer, /subagent-output-identity/);
  assert.match(outputRenderer, /subagent-output-name/);
  assert.match(outputRenderer, /subagent-output-profession/);
  assert.match(outputRenderer, /message-bubble agent-bubble subagent-output-bubble/);
  assert.match(outputRenderer, /data-subagent-thread-id/);
  assert.match(outputRenderer, /data-subagent-message-id/);
  assert.match(outputRenderer, /subagent-output-actions/);
  assert.match(outputRenderer, /data-action="quote-message"/);
  assert.match(outputRenderer, /data-action="copy-message"/);
  assert.match(outputRenderer, /output\.time/);
  assert.doesNotMatch(outputRenderer, /subagent-output-card/);
  assert.match(outputRenderer, /<div class="subagent-output-empty"><span>/);
  assert.doesNotMatch(outputRenderer, /<i aria-hidden="true"><\/i>/);
  assert.doesNotMatch(styles, /\.subagent-output-empty(?:\.working)? i/);
  assert.doesNotMatch(renderer, /subagent-cluster-context/);
  assert.match(renderer, /if \(isSubagentProcessItem\(item\)\) return true/);
  assert.match(renderer, /rememberInternalSubagentThreadsFromItem\(threadId, item\)/);
  assert.match(renderer, /internalSubagentThreadIds\.has\(threadId\)/);
  assert.match(renderer, /captureInternalSubagentNotification\(threadId, message\)/);
  assert.match(renderer, /item\/reasoning\/summaryTextDelta/);
  assert.match(renderer, /item\/commandExecution\/outputDelta/);
  assert.match(renderer, /pendingSubagentPanelPatchChildThreadIds\.add\(childThreadId\)/);
  const scheduledPanelPatch = renderer.slice(
    renderer.indexOf("function scheduleSubagentPanelPatch"),
    renderer.indexOf("function upsertSubagentActivityItem"),
  );
  assert.match(scheduledPanelPatch, /patchActiveSubagentOutputPanel\(pendingParentThreadId, pendingChildThreadId\)/);
  assert.doesNotMatch(scheduledPanelPatch, /pendingSubagentPanelPatchThreadIds|\.replaceWith\(/);
  const localizedPanelPatch = renderer.slice(
    renderer.indexOf("function patchActiveSubagentOutputPanel"),
    renderer.indexOf("function patchActiveAgentPanel"),
  );
  const panelSelection = renderer.slice(
    renderer.indexOf("function selectedPanelSubagent"),
    renderer.indexOf("function renderSubagentPanelTab"),
  );
  assert.match(panelSelection, /resolveSubagentPanelThreadId/);
  assert.match(localizedPanelPatch, /selectedPanelSubagent\(parentThreadId, agents\)\.threadId === childThreadId/);
  assert.doesNotMatch(localizedPanelPatch, /state\.subagentPanelSelection\[parentThreadId\]\s*\?/);
  assert.match(localizedPanelPatch, /currentOutputPanel\.replaceWith\(nextOutputPanel\)/);
  assert.doesNotMatch(localizedPanelPatch, /panel\.replaceWith\(/);
  const signatureSection = renderer.slice(
    renderer.indexOf("function messageRenderSignature"),
    renderer.indexOf("function messageSignatureText"),
  );
  assert.doesNotMatch(signatureSection, /agent\.output/);
  assert.match(styles, /\.subagent-cluster\s*\{/);
  const clusterStyles = styles.slice(styles.indexOf(".subagent-cluster {"), styles.indexOf(".subagent-cluster-header"));
  assert.match(clusterStyles, /margin-top: 3px;/);
  assert.match(clusterStyles, /border: 0;/);
  assert.match(clusterStyles, /background: transparent;/);
  assert.match(clusterStyles, /box-shadow: none;/);
  assert.doesNotMatch(styles, /\.subagent-cluster::after/);
  assert.match(styles, /\.subagent-cluster-progress-track/);
  assert.match(styles, /\.subagent-cluster-header\s*\{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.subagent-cluster-name\s*\{[\s\S]*?font-size: calc\(11px \+ var\(--app-font-size-offset\)\);[\s\S]*?font-weight: 400;/);
  assert.match(styles, /\.subagent-cluster-row\s*\{[\s\S]*?cursor: pointer;/);
  assert.match(styles, /\.subagent-cluster-row:focus-visible/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.subagent-cluster-row\.starting::before,\s*html\[data-theme="dark"\] \.subagent-cluster-row\.working::before\s*\{[^}]*content: none;/,
  );
  assert.match(
    styles,
    /html:not\(\[data-theme="dark"\]\) \.subagent-cluster-row\.starting::before,\s*html:not\(\[data-theme="dark"\]\) \.subagent-cluster-row\.working::before\s*\{[^}]*content: none;/,
  );
  assert.match(styles, /\.subagent-panel-tabs/);
  assert.match(styles, /\.subagent-output-area\s*\{[\s\S]*?position: relative;[\s\S]*?flex: 1;/);
  assert.match(styles, /\.workflow-scroll-bottom-button/);
  const avatarFreeClusterRenderer = renderer.slice(
    renderer.indexOf("function renderSubagentClusterRow"),
    renderer.indexOf("function subagentStageIcon"),
  );
  assert.doesNotMatch(avatarFreeClusterRenderer, /subagent-cluster-avatar|avatarUrl|<img/);
  assert.doesNotMatch(avatarFreeClusterRenderer, /subagent-cluster-index/);
  const avatarFreeCardStyles = styles.slice(styles.indexOf("/* Avatar-free parallel task cards"));
  assert.match(avatarFreeCardStyles, /\.subagent-cluster-row\s*\{[^}]*display: block;[^}]*grid-template-columns: minmax\(0, 1fr\);/s);
  assert.match(avatarFreeCardStyles, /\.subagent-cluster-identity\s*\{[^}]*justify-content: space-between;/s);
  assert.match(avatarFreeCardStyles, /html:not\(\[data-theme="dark"\]\) \.subagent-cluster-row:(?:hover|active|focus-visible)/);
  assert.match(avatarFreeCardStyles, /html\[data-theme="dark"\] \.subagent-cluster-row:(?:hover|active|focus-visible)/);
  assert.match(avatarFreeCardStyles, /html:not\(\[data-theme="dark"\]\) \.subagent-cluster-row\.failed/);
  assert.match(avatarFreeCardStyles, /html\[data-theme="dark"\] \.subagent-cluster-row\.interrupted/);
  assert.match(styles, /\.subagent-panel-tab\s*\{[^}]*border: 0;[^}]*border-radius: 50%;[^}]*background: transparent;/);
  assert.doesNotMatch(styles, /\.subagent-panel-tab\.active\s*\{[^}]*border-color:/);
  assert.match(styles, /\.subagent-panel-tab img\s*\{[^}]*border-radius: 50%;[^}]*filter: saturate\(0\.55\) brightness\(1\.08\);[^}]*opacity: 0\.38;/);
  assert.match(styles, /\.subagent-panel-tab\.active img\s*\{[\s\S]*?filter: none;[\s\S]*?opacity: 1;/);
  assert.match(styles, /\.subagent-output-bubble/);
  assert.match(styles, /\.subagent-process-update\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*18px minmax\(0, 1fr\);/s);
  assert.match(styles, /\.subagent-process-update\.running \.subagent-process-marker::before\s*\{[^}]*animation:\s*subagent-process-pulse/s);
  assert.match(styles, /html\[data-theme="dark"\] \.subagent-process-body\s*\{[^}]*background:/s);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.subagent-process-body\s*\{[^}]*background:/s);
  assert.match(styles, /html\[data-theme="dark"\] \.subagent-process-update:hover \.subagent-process-body/s);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.subagent-process-update:hover \.subagent-process-body/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.subagent-process-update\.running \.subagent-process-marker::before/s);
  assert.match(styles, /\.subagent-output-bubble\s*\{[\s\S]*?font-size: calc\(12px \+ var\(--app-font-size-offset\)\);/);
  assert.match(styles, /\.subagent-output-identity\s*\{[^}]*margin: 0 4px 5px;[^}]*font-size: calc\(11px \+ var\(--app-font-size-offset\)\);/);
  assert.match(styles, /\.subagent-output-bubble \.message-inline-code/);
  assert.match(styles, /\.subagent-output-bubble \.message-code-block code/);
  assert.match(styles, /\.subagent-output-message:hover \.subagent-output-actions/);
  assert.match(styles, /\.subagent-output-actions\s*\{[^}]*font-size: calc\(9px \+ var\(--app-font-size-offset\)\);/);
  assert.doesNotMatch(styles, /\.subagent-output-card/);
  assert.match(styles, /html\[data-theme="dark"\] \.subagent-cluster/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("sub-agent cards expand the system dashboard and select their matching output", async () => {
  const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const opener = renderer.slice(
    renderer.indexOf("function openSubagentInSystemDashboard"),
    renderer.indexOf("function workflowScrollBottomButtonFor"),
  );
  assert.match(opener, /state\.subagentPanelSelection\[parentThreadId\] = agentThreadId/);
  assert.match(opener, /state\.rightCollapsed = false/);
  assert.match(opener, /syncAgentPanelState\(\)/);
  assert.match(opener, /tab\.dataset\.subagentPanelTab === agentThreadId/);
  assert.match(opener, /selectSubagentPanelTab\(matchingTab\)/);

  const selector = renderer.slice(
    renderer.indexOf("function selectSubagentPanelTab"),
    renderer.indexOf("function openSubagentInSystemDashboard"),
  );
  assert.match(selector, /scheduleMissingSubagentProcessHistoryHydration\(selectedAgent\)/);

  const bindings = renderer.slice(
    renderer.indexOf("function bindMessageContentEvents"),
    renderer.indexOf("async function writeTextToClipboard"),
  );
  assert.match(bindings, /querySelectorAll<HTMLElement>\("\[data-open-subagent-thread\]"\)/);
  assert.match(bindings, /card\.addEventListener\("click", openSubagent\)/);
  assert.match(bindings, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(bindings, /openSubagentInSystemDashboard\(agentThreadId\)/);
});

test("sub-agent message actions copy and quote the original child-thread output", async () => {
  const renderer = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const quoteBuilder = renderer.slice(
    renderer.indexOf("function composerQuoteFromSubagentOutputMessage"),
    renderer.indexOf("function composerQuoteSenderFromMessageRow"),
  );
  assert.match(quoteBuilder, /subagentActivityOutputs\(agent\)\.find/);
  assert.match(quoteBuilder, /sourceThreadId/);
  assert.match(quoteBuilder, /`\$\{agent\.name\}（\$\{agent\.profession\}）`/);

  const bindings = renderer.slice(
    renderer.indexOf("function bindMessageContentEvents"),
    renderer.indexOf("async function writeTextToClipboard"),
  );
  assert.match(bindings, /data-action='copy-message'/);
  assert.match(bindings, /composerQuoteFromSubagentOutputMessage/);
  assert.match(
    bindings,
    /copyPayloadToClipboard\(\{\s*kind: "text",\s*text: subagentQuote\.text,?\s*\}\)/,
  );
  assert.match(
    bindings,
    /applyComposerQuotePayload\(\s*subagentQuote \|\|\s*composerQuoteFromMessageRow/,
  );

  const quoteRecord = renderer.slice(
    renderer.indexOf("function composerQuoteContextRecord"),
    renderer.indexOf("function composerQuoteFromChannelPayload"),
  );
  assert.match(quoteRecord, /source_thread_id: quote\.sourceThreadId/);
});
