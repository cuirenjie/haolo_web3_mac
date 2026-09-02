import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadClusterModeModule() {
  const source = await readFile(new URL("../src/renderer/cluster-mode.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

const clusterModeModule = loadClusterModeModule();
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const businessModelPoolsSource = readFile(
  new URL("../src/renderer/business-model-pools.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("cluster mode defaults to the existing subagent behavior", async () => {
  const { clusterModeVariantLabel, normalizeClusterModeVariant } = await clusterModeModule;

  assert.equal(normalizeClusterModeVariant(undefined), "subagent");
  assert.equal(normalizeClusterModeVariant("unexpected"), "subagent");
  assert.equal(normalizeClusterModeVariant("multi-model"), "multi-model");
  assert.equal(clusterModeVariantLabel("subagent"), "并行");
  assert.equal(clusterModeVariantLabel("multi-model"), "画布");
});

test("UUID v7 timestamps expose the conversation creation time", async () => {
  const { uuidV7Timestamp } = await clusterModeModule;
  const createdAtMs = Date.parse("2026-07-29T05:33:17.284Z");
  const prefix = createdAtMs.toString(16).padStart(12, "0");
  const threadId = `${prefix.slice(0, 8)}-${prefix.slice(8)}-7000-8000-000000000001`;

  assert.equal(uuidV7Timestamp(threadId), createdAtMs);
  assert.equal(uuidV7Timestamp("not-a-uuid-v7"), null);
});

test("workflow event ordering compares sequence numbers only within the same run", async () => {
  const { shouldApplyWorkflowRunSnapshot } = await clusterModeModule;
  const firstRun = {
    id: "workflow-first",
    sequence: 1_381,
    createdAt: "2026-07-29T05:33:17.284Z",
  };
  const laterRun = {
    id: "workflow-later",
    sequence: 1,
    createdAt: "2026-07-29T05:44:07.673Z",
  };

  assert.equal(
    shouldApplyWorkflowRunSnapshot(firstRun, { ...firstRun, sequence: 1_380 }),
    false,
  );
  assert.equal(
    shouldApplyWorkflowRunSnapshot(firstRun, { ...firstRun, sequence: 1_382 }),
    true,
  );
  assert.equal(shouldApplyWorkflowRunSnapshot(firstRun, laterRun), true);
  assert.equal(shouldApplyWorkflowRunSnapshot(laterRun, firstRun), false);
});

test("multi-model membership status deduplicates streamed model names", async () => {
  const {
    MULTI_MODEL_CLUSTER_AVATAR_MAX_MEMBERS,
    dedupeMultiModelClusterAvatarMembers,
    multiModelClusterAvatarRowSizes,
    multiModelClusterMemberStatus,
    multiModelClusterMembersJoined,
  } = await clusterModeModule;

  assert.equal(multiModelClusterMemberStatus([]), "正在邀请模型加入画布");
  assert.equal(
    multiModelClusterMemberStatus(["Claude", " GPT-5 ", "Claude", ""]),
    "Claude、GPT-5 加入画布",
  );
  assert.equal(multiModelClusterMembersJoined(undefined), false);
  assert.equal(multiModelClusterMembersJoined({ status: "planning", nodes: [] }), false);
  assert.equal(multiModelClusterMembersJoined({
    status: "running",
    nodes: [{ kind: "model", status: "pending" }],
  }), false);
  assert.equal(multiModelClusterMembersJoined({
    status: "running",
    planCommittedAt: "2026-07-22T12:00:00.000Z",
    nodes: [{ kind: "model", status: "pending" }, { kind: "model", status: "pending" }],
  }), true);
  assert.equal(multiModelClusterMembersJoined({
    status: "running",
    nodes: [{ kind: "model", status: "running" }],
  }), true);
  assert.equal(MULTI_MODEL_CLUSTER_AVATAR_MAX_MEMBERS, 9);
  assert.deepEqual(
    Array.from({ length: 10 }, (_, count) => multiModelClusterAvatarRowSizes(count)),
    [[], [1], [2], [1, 2], [2, 2], [2, 3], [3, 3], [1, 3, 3], [2, 3, 3], [3, 3, 3]],
  );
  assert.deepEqual(multiModelClusterAvatarRowSizes(12), [3, 3, 3]);
  const duplicateAvatarMembers = [
    { key: "claude-avatar", name: "Claude first" },
    { key: "gpt-avatar", name: "GPT" },
    { key: "claude-avatar", name: "Claude retry" },
    ...Array.from({ length: 9 }, (_, index) => ({ key: `extra-${index}`, name: `Extra ${index}` })),
  ];
  assert.deepEqual(
    dedupeMultiModelClusterAvatarMembers(duplicateAvatarMembers).map((member) => member.name),
    ["Claude first", "GPT", ...Array.from({ length: 7 }, (_, index) => `Extra ${index}`)],
  );
});

test("the legacy canvas dedupe helper is not applied to persisted conversation history", async () => {
  const {
    MULTI_MODEL_CLUSTER_CONVERSATION_DEDUPE_WINDOW_MS,
    dedupeMultiModelClusterConversationThreads,
  } = await clusterModeModule;
  const uuidAt = (timestampMs, suffix) => {
    const prefix = timestampMs.toString(16).padStart(12, "0");
    return `${prefix.slice(0, 8)}-${prefix.slice(8)}-7000-8000-${suffix.padStart(12, "0")}`;
  };
  const createdAtMs = Date.parse("2026-07-26T04:26:27.893Z");
  const first = {
    id: uuidAt(createdAtMs, "1"),
    groupId: "test",
    title: "帮我派出 3 个并行的模型",
    cluster: true,
  };
  const activeDuplicate = {
    id: uuidAt(createdAtMs + 6 * 60_000, "2"),
    groupId: "test",
    title: "  帮我派出 3 个并行的模型  ",
    cluster: true,
  };
  const ordinaryConversation = {
    id: uuidAt(createdAtMs + 7 * 60_000, "3"),
    groupId: "test",
    title: first.title,
    cluster: false,
  };
  const otherGroup = {
    id: uuidAt(createdAtMs + 8 * 60_000, "4"),
    groupId: "other",
    title: first.title,
    cluster: true,
  };
  const laterRepeat = {
    id: uuidAt(
      createdAtMs + MULTI_MODEL_CLUSTER_CONVERSATION_DEDUPE_WINDOW_MS + 1,
      "5",
    ),
    groupId: "test",
    title: first.title,
    cluster: true,
  };
  const threads = [
    first,
    activeDuplicate,
    ordinaryConversation,
    otherGroup,
    laterRepeat,
  ];

  const visible = dedupeMultiModelClusterConversationThreads(threads, {
    activeThreadId: activeDuplicate.id,
    groupIdForThread: (thread) => thread.groupId,
    isMultiModelClusterThread: (thread) => thread.cluster,
    titleForThread: (thread) => thread.title,
  });

  assert.deepEqual(
    visible.map((thread) => thread.id),
    [
      activeDuplicate.id,
      ordinaryConversation.id,
      otherGroup.id,
      laterRepeat.id,
    ],
  );

  const source = await rendererSource;
  const visibleConversationThreads = sourceBlock(
    source,
    "function visibleConversationThreadsForChatList",
    "function renderThreadGroupSetDialog",
  );
  assert.match(visibleConversationThreads, /return visibleThreads;/);
  assert.doesNotMatch(visibleConversationThreads, /dedupeMultiModelClusterConversationThreads/);
});

test("multi-model planning progress reveals safe stage summaries until the plan is committed", async () => {
  const {
    multiModelClusterPlanningActive,
    multiModelClusterPlanningCompleted,
    multiModelClusterPlanningProgress,
  } = await clusterModeModule;
  const createdAt = "2026-07-26T10:00:00.000Z";
  const createdAtMs = Date.parse(createdAt);
  const planningRun = {
    id: "workflow-random-reply-test",
    createdAt,
    status: "planning",
    nodes: [{ kind: "root", status: "running" }],
  };

  assert.equal(multiModelClusterPlanningCompleted(planningRun), false);
  assert.equal(multiModelClusterPlanningActive(planningRun), true);
  assert.equal(multiModelClusterPlanningProgress(planningRun, createdAtMs + 4_999).length, 0);
  const revealOffsets = [];
  let previousUpdateCount = 0;
  for (let elapsedMs = 5_000; elapsedMs <= 28_000 && revealOffsets.length < 4; elapsedMs += 1) {
    const updateCount = multiModelClusterPlanningProgress(planningRun, createdAtMs + elapsedMs).length;
    if (updateCount > previousUpdateCount) revealOffsets.push(elapsedMs);
    previousUpdateCount = updateCount;
  }
  assert.equal(revealOffsets.length, 4);
  const replyDelays = revealOffsets.map((offset, index) => offset - (revealOffsets[index - 1] || 0));
  assert.ok(replyDelays.every((delay) => delay >= 5_000 && delay <= 7_000));

  const planCommittedOffset = revealOffsets[1] + 500;
  const completedRun = {
    ...planningRun,
    status: "running",
    planCommittedAt: new Date(createdAtMs + planCommittedOffset).toISOString(),
    complexityAssessment: { strategy: "parallel_review" },
    nodes: [
      { kind: "model", status: "pending" },
      { kind: "model", status: "pending" },
      { kind: "agent", executorType: "codex_subagent", status: "pending" },
    ],
  };
  const updatesAtCommit = multiModelClusterPlanningProgress(
    completedRun,
    createdAtMs + planCommittedOffset,
  );
  const completedUpdates = multiModelClusterPlanningProgress(completedRun, createdAtMs + 40_000);

  assert.equal(multiModelClusterPlanningCompleted(completedRun), true);
  assert.equal(multiModelClusterPlanningActive(completedRun), false);
  assert.deepEqual(updatesAtCommit.map((update) => update.id), ["goal", "models"]);
  assert.deepEqual(completedUpdates.map((update) => update.id), ["goal", "models", "completed"]);
  assert.match(completedUpdates.at(-1).text, /编排完成/);
  assert.match(completedUpdates.at(-1).text, /3 个执行节点/);
  assert.match(completedUpdates.at(-1).text, /并行/);
  assert.equal(completedUpdates.at(-1).completed, true);
});

test("multi-model history rows use the agent collage before task-anchor avatars", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const avatarMembers = sourceBlock(
    source,
    "function multiModelClusterAvatarMembers",
    "function renderThreadAvatar",
  );
  const threadAvatar = sourceBlock(source, "function renderThreadAvatar", "function renderThreadRowAvatar");
  const workflowEvents = sourceBlock(source, "function applyWorkflowEvent", "function presentWorkflowFailure");

  assert.match(avatarMembers, /node\.kind === "model"/);
  assert.match(avatarMembers, /const isExecutableAgent = node\.kind === "agent"/);
  assert.match(avatarMembers, /const avatarUrl = isExecutableAgent \? APP_AVATAR_URL : meta\?\.avatarUrl \|\| ""/);
  assert.match(avatarMembers, /key: isExecutableAgent \? `haolo-agent:\$\{node\.id\}` : avatarUrl \|\| provider \|\| name\.toLowerCase\(\)/);
  assert.match(avatarMembers, /dedupeMultiModelClusterAvatarMembers\(members\)/);
  assert.match(avatarMembers, /multiModelClusterAvatarRowSizes\(members\.length\)/);
  assert.match(avatarMembers, /cluster-group-avatar member-count-/);
  assert.ok(threadAvatar.indexOf("renderMultiModelClusterThreadAvatar") < threadAvatar.indexOf("taskAnchorAvatarText"));
  assert.match(workflowEvents, /patchMultiModelClusterThreadAvatar\(threadId\)/);
  assert.match(styles, /:root\s*\{[^}]*--avatar-radius:\s*24%;/s);
  assert.match(styles, /\.cluster-group-avatar\s*\{[^}]*border-radius:\s*var\(--avatar-radius\);[^}]*background:\s*#e7eaee;/s);
  assert.match(styles, /\.cluster-group-avatar\s*\{[^}]*box-shadow:\s*inset 0 0 0 0\.5px rgb\(218 222 227 \/ 60%\);/s);
  assert.match(styles, /\.cluster-group-avatar\.member-count-1 \.cluster-group-avatar-cell\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
  assert.match(styles, /\.cluster-group-avatar:is\(\.member-count-2, \.member-count-3, \.member-count-4\) \.cluster-group-avatar-cell\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s);
  assert.match(styles, /\.cluster-group-avatar:is\(\.member-count-5, \.member-count-6, \.member-count-7, \.member-count-8, \.member-count-9\) \.cluster-group-avatar-cell\s*\{[^}]*width:\s*9px;[^}]*height:\s*9px;/s);
});

test("persisted workflows clear stale cluster execution metadata", async () => {
  const source = await rendererSource;
  const workflowEvents = sourceBlock(source, "function applyWorkflowEvent", "function presentWorkflowFailure");
  const restoration = sourceBlock(
    source,
    "function restoreMultiModelClusterIdentity",
    "function presentWorkflowFailure",
  );
  const avatar = sourceBlock(
    source,
    "function renderMultiModelClusterThreadAvatar",
    "function renderThreadAvatar",
  );
  const panel = sourceBlock(source, "function renderAgentPanel", "function renderComposerThreadMentionSearch");

  assert.match(workflowEvents, /restoreMultiModelClusterIdentity\(threadId\)/);
  assert.match(workflowEvents, /clusterIdentityRestored \|\| membersJustJoined/);
  assert.match(restoration, /newThreadModeByThreadId\.set\(threadId, "execution"\)/);
  assert.match(restoration, /clusterModeByThreadId\.delete\(threadId\)/);
  assert.match(restoration, /saveThreadPreferences\(\)/);
  assert.ok(
    avatar.indexOf("hydrateLatestWorkflowRun(threadId)") <
      avatar.indexOf("isActiveMultiModelClusterConversation(threadId)"),
  );
  assert.match(panel, /!cachedWorkflowRun && !workflowHydratedThreadIds\.has\(threadId\)/);
  assert.match(panel, /isMultiModelClusterThread\(threadId\) \|\| Boolean\(cachedWorkflowRun\)/);
});

test("composer mode picker exposes only a static ordinary execution mode", async () => {
  const source = await rendererSource;
  const picker = sourceBlock(
    source,
    "function renderComposerModePicker",
    "function activeComposerDraftSnapshot",
  );
  const composer = sourceBlock(source, "function renderComposer(thread", "function renderVideoExpertComposer");
  const clusterSwitch = sourceBlock(
    source,
    "async function switchComposerClusterMode",
    "function renderBlankThreadHero",
  );

  assert.match(picker, /class="composer-mode-trigger serial-only"/);
  assert.match(picker, /role="status"/);
  assert.match(picker, /执行模式，已固定为串行执行/);
  assert.match(picker, /renderComposerModeIcon\("execution"\)/);
  assert.doesNotMatch(picker, /composer-mode-menu|data-new-thread-mode|data-composer-cluster-mode/);
  assert.doesNotMatch(picker, /计划模式|集群模式|role="menuitemradio"/);
  assert.match(
    composer,
    /const composerModePicker = blankNewThread\s*\? renderComposerModePicker\(thread\.id\)/,
  );
  assert.match(composer, /renderComposerModePicker\(thread\.id\)/);
  assert.match(
    composer,
    /const composerTrailingPicker = multiAgentMode[\s\S]*\? ""[\s\S]*: renderComposerModelPicker\(thread\.id\)/,
  );
  assert.doesNotMatch(composer, /multiAgentMode \|\| isTradingExpertThreadId\(thread\.id\)/);
  assert.match(composer, /const groupPicker = showEditableGroupPicker/);
  assert.match(
    composer,
    /data-action="pick-files"[\s\S]*\$\{composerModePicker\}[\s\S]*<\/div>\s*\$\{composerTrailingPicker\}/,
  );
  assert.ok(
    composer.indexOf("${groupPicker}") <
      composer.indexOf("${renderWorkflowComposerInputSlots(thread.id, workflowInputContract)}"),
  );
  assert.equal((composer.match(/renderComposerModelPicker\(thread\.id\)/g) || []).length, 1);
  assert.match(clusterSwitch, /newThreadModeByThreadId\.set\(threadId, "execution"\)/);
  assert.match(clusterSwitch, /clusterModeByThreadId\.delete\(threadId\)/);
  assert.match(clusterSwitch, /已固定为普通串行执行模式/);
  assert.doesNotMatch(clusterSwitch, /switchNewThreadMode\("multi-agent"\)|selectClusterModeForThread/);
});

test("parallel subagent mode cannot inherit a DeepSeek root model", async () => {
  const [source, businessModelPools] = await Promise.all([
    rendererSource,
    businessModelPoolsSource,
  ]);
  const modelFallback = sourceBlock(
    source,
    "function supportsNativeMultiAgent",
    "function selectedChatModelOption",
  );
  const capability = sourceBlock(
    businessModelPools,
    "export function supportsCodexToolExecutionModel",
    "export function codexToolExecutionModelOption",
  );
  const requestOptions = sourceBlock(
    source,
    "function selectedChatModelRequestOptions",
    "function hydrateSelectedChatModel",
  );

  assert.match(capability, /provider !== DEEPSEEK_EXECUTION_PROVIDER_ID/);
  assert.match(capability, /startsWith\("gpt-"\)/);
  assert.match(modelFallback, /defaultNativeMultiAgentModelOption/);
  assert.doesNotMatch(modelFallback, /rememberThreadModelSelection/);
  assert.match(requestOptions, /conversationMode === "multi-agent"/);
  assert.doesNotMatch(requestOptions, /clusterModeForThread\(threadId\) === "subagent"/);
  assert.match(requestOptions, /defaultNativeMultiAgentModelOption\(\)/);
  assert.match(requestOptions, /selectedChatModelReasoningEffortsForRequest/);
});

test("composer cluster option and sidebar both omit group-chat creation", async () => {
  const source = await rendererSource;
  const picker = sourceBlock(
    source,
    "function renderComposerModePicker",
    "function activeComposerDraftSnapshot",
  );

  assert.doesNotMatch(picker, /data-action="open-group-chat-dialog"|<span>群聊<\/span>/);
  assert.doesNotMatch(source, /data-action="open-group-chat-dialog"|function openGroupChatDialog/);
  assert.doesNotMatch(source, /local-group-chat:\$\{crypto\.randomUUID/);
  assert.match(source, /function openAddGroupMembersDialog/);
});

test("composer mode picker keeps a two-column direct menu beside the upload plus", async () => {
  const styles = await stylesSource;
  const pickerStyles = sourceBlock(
    styles,
    ".composer-mode-picker {",
    ".composer-model-picker {",
  );
  const toolsStyles = sourceBlock(styles, ".composer-tools {", ".composer-icon-btn {");

  assert.match(pickerStyles, /position:\s*relative/);
  assert.match(pickerStyles, /\.composer-mode-trigger\s*\{[^}]*height:\s*28px;/s);
  assert.match(pickerStyles, /\.composer-mode-menu\s*\{[^}]*bottom:\s*calc\(100% \+ 8px\);[^}]*width:\s*152px;[^}]*padding:\s*6px;/s);
  assert.match(pickerStyles, /\.composer-mode-menu-button\s*\{[^}]*height:\s*36px;[^}]*font-size:\s*calc\(13px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(pickerStyles, /grid-template-columns:\s*20px minmax\(0, 1fr\);/);
  assert.match(pickerStyles, /\.composer-mode-menu-button \.composer-mode-icon\s*\{[^}]*width:\s*19px;[^}]*height:\s*19px;/s);
  assert.match(
    pickerStyles,
    /\.composer-mode-menu-button\.selected\s*\{[^}]*background:\s*var\(--selection-strong\);[^}]*color:\s*var\(--text-primary\);/s,
  );
  assert.doesNotMatch(
    pickerStyles,
    /composer-mode-submenu|composer-mode-menu-item|composer-mode-menu-chevron|data-composer-mode-cascade/,
  );
  assert.match(toolsStyles, /gap:\s*6px/);
});

test("multi-model presentation omits the invite bubble and keeps a clean presence line", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const planning = sourceBlock(
    source,
    "function multiModelClusterPlanningProgressPresentation",
    "function multiModelClusterPresencePresentation",
  );
  const presence = sourceBlock(source, "function multiModelClusterPresencePresentation", "function renderMultiModelClusterPrelude");
  const prelude = sourceBlock(source, "function renderMultiModelClusterPrelude(threadId", "function renderMultiModelClusterPreludeAfterMessage");
  const patchPresence = sourceBlock(source, "function patchMultiModelClusterPresence", "function renderChatPanel");
  const elapsedTimer = sourceBlock(source, "function syncThinkingElapsedTimer", "function patchActiveThinkingElapsed");

  assert.doesNotMatch(source, /收到，我先拉个群|multi-model-cluster-invite/);
  assert.doesNotMatch(styles, /multi-model-cluster-invite/);
  assert.match(prelude, /data-multi-model-cluster-planning-progress/);
  assert.match(prelude, /data-multi-model-cluster-presence-text/);
  assert.match(prelude, /memberStatus\.visible \? "" : " hidden"/);
  assert.match(prelude, /multiModelClusterPresencePresentation\(threadId\)/);
  assert.match(presence, /multi-model-cluster-presence-suffix">加入画布/);
  assert.match(prelude, /class="multi-model-cluster-presence/);
  assert.doesNotMatch(prelude, /multi-model-cluster-presence-mark|<i><\/i>/);
  assert.match(planning, /multiModelClusterPlanningProgress\(run\)/);
  assert.match(planning, /data-multi-model-cluster-planning-update/);
  assert.match(planning, /renderMessageAvatar\(progressMessage, "ceo_assistant"\)/);
  assert.match(planning, /multi-model-cluster-planning-row/);
  assert.match(presence, /multiModelClusterPlanningCompleted\(workflowRunsByThreadId\.get\(threadId\)\)/);
  assert.match(presence, /visible: false/);
  assert.match(presence, /multiModelClusterMembers\(threadId\)/);
  assert.match(presence, /multi-model-cluster-presence-member/);
  assert.match(presence, /multi-model-cluster-presence-avatar/);
  assert.match(presence, /member\.avatarUrl/);
  assert.match(patchPresence, /patchMultiModelClusterPlanningProgress\(threadId\)/);
  assert.match(patchPresence, /presence\.classList\.toggle\("hidden", !nextStatus\.visible\)/);
  assert.match(patchPresence, /label\.innerHTML = nextStatus\.markup/);
  assert.match(elapsedTimer, /patchMultiModelClusterPlanningProgress\(state\.currentThreadId\)/);
  assert.match(styles, /\.multi-model-cluster-planning-progress\s*\{[^}]*display:\s*grid;[^}]*gap:\s*12px;/s);
  assert.match(styles, /\.multi-model-cluster-planning-row\s*\{[^}]*margin:\s*0;/s);
  assert.match(styles, /\.multi-model-cluster-planning-progress\.hidden,\s*\.multi-model-cluster-presence\.hidden\s*\{[^}]*display:\s*none;/s);
  assert.match(source, /workflowRunsByThreadId\.get\(threadId\)\?\.nodes/);
  assert.match(source, /node\.kind === "model"/);
  assert.doesNotMatch(source, /renderMultiModelClusterTitleMark|multi-model-cluster-title-mark|>\[群\]</);
});

test("multi-model cluster keeps the conversation list open until the dashboard has at least three parallel nodes", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const expansion = sourceBlock(source, "function expandSystemDashboardForNewMessage", "function conversationSupplementSteerText");
  const workflowEvents = sourceBlock(source, "function applyWorkflowEvent", "function restoreMultiModelClusterIdentity");
  const nodeDeletion = sourceBlock(source, "function confirmWorkflowNodeDelete", "function workflowCanvasDialogSkills");
  const nodeDraftUpdate = sourceBlock(source, "function updateWorkflowNodeRevisionDraft", "function renderMessageScrollBottomButton");

  assert.doesNotMatch(expansion, /state\.leftCollapsed = true/);
  assert.match(expansion, /state\.rightCollapsed = false/);
  assert.match(workflowEvents, /maybeAutoCollapseLeftPanelForWorkflow\(run\)/);
  assert.match(workflowEvents, /workflowCanvasMaxParallelNodeCount\(run\.nodes \|\| \[\]\)/);
  assert.match(source, /WORKFLOW_LEFT_PANEL_AUTO_COLLAPSE_MIN_PARALLEL_NODES = 3/);
  assert.match(workflowEvents, /workflowLeftPanelAutoCollapseRunIds\.delete\(run\.id\)/);
  assert.match(workflowEvents, /workflowLeftPanelAutoCollapseRunIds\.add\(run\.id\)/);
  assert.match(workflowEvents, /if \(state\.leftCollapsed\) return false/);
  assert.match(workflowEvents, /state\.leftCollapsed = true/);
  assert.match(
    nodeDeletion,
    /state\.activeView === "chat"[\s\S]*state\.currentThreadId === selection\.threadId[\s\S]*maybeAutoCollapseLeftPanelForWorkflow\(nextDraft\)/,
  );
  assert.match(
    nodeDraftUpdate,
    /state\.activeView === "chat"[\s\S]*state\.currentThreadId === threadId[\s\S]*maybeAutoCollapseLeftPanelForWorkflow\(applied\)/,
  );
  assert.match(source, /--workflow-panel-width:\$\{layoutSnapshot\?\.width \|\| workflowCanvasPreferredPanelWidth\(workflowRun\.nodes \|\| \[\]\)\}px/);
  assert.match(styles, /\.desktop-body\.multi-model-cluster-layout:not\(\.right-panel-collapsed\) > \.chat-panel\s*\{[^}]*flex:\s*1 1 0;/s);
  assert.match(styles, /\.desktop-body\.multi-model-cluster-layout:not\(\.right-panel-collapsed\) > \.agent-panel\s*\{[^}]*width:\s*var\(--workflow-panel-width, 360px\);[^}]*flex:\s*0 1 var\(--workflow-panel-width, 360px\);/s);
});

test("executed canvas exit stays available while the blank-canvas shortcut is fully removed", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const exit = sourceBlock(
    source,
    "async function exitWorkflowCanvas",
    "async function createBlankThreadForList",
  );
  const toolbar = sourceBlock(
    await readFile(new URL("../src/renderer/workflow-canvas.ts", import.meta.url), "utf8"),
    "export function renderWorkflowToolbar",
    "export function workflowCanvasPreferredPanelWidth",
  );

  assert.doesNotMatch(source, /createBlankWorkflowCanvas|create-workflow-canvas|blankWorkflowCanvas|isBlankWorkflowCanvas/);
  assert.match(source, /workspaceHasConversationList \? renderLeftPanelToggle\(\) : ""/);
  assert.match(source, /function shouldRenderBlankThreadHero\(threadId: string\)[\s\S]*return isBlankNewThread\(threadId\);/);
  assert.match(toolbar, /<div class="cluster-workflow-toolbar">/);
  assert.match(toolbar, /class="cluster-workflow-toolbar-title" role="heading" aria-level="2">画布<\/span>/);
  assert.match(toolbar, /options\.showExit[\s\S]*data-action="exit-workflow-canvas"[\s\S]*退出画布/);
  assert.match(source, /renderWorkflowToolbar\(workflowRun, \{[\s\S]*showExit: Boolean\(threadId\)/);
  assert.match(source, /data-action="exit-workflow-canvas"[\s\S]*void exitWorkflowCanvas\(\)/);
  assert.match(exit, /if \(!threadId \|\| !workflowCanvasRunWithDraft\(threadId\)\) return/);
  assert.match(exit, /await startNewThread\(\)/);
  assert.match(exit, /state\.leftCollapsed = false/);
  assert.match(exit, /state\.rightCollapsed = true/);
  assert.doesNotMatch(toolbar, /<h2|<header/);
  assert.doesNotMatch(toolbar, /执行未达成|cluster-workflow-progress|cluster-workflow-run-state/);
  assert.match(styles, /\.chat-header\s*\{[^}]*height:\s*46px;/s);
  assert.doesNotMatch(styles, /blank-workflow-canvas-title/);
  assert.match(styles, /\.cluster-workflow-toolbar\s*\{[^}]*height:\s*46px;/s);
  assert.match(styles, /\.cluster-workflow-toolbar-title\s*\{[^}]*font-size:\s*calc\(13px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(styles, /\.cluster-workflow-toolbar-title\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.cluster-workflow-toolbar/);
  assert.match(styles, /\.cluster-workflow-exit:hover/);
  assert.match(styles, /\.cluster-workflow-exit:focus-visible/);
  assert.match(styles, /\.cluster-workflow-exit:active/);
  assert.match(styles, /\.cluster-workflow-exit:disabled/);
  assert.match(styles, /html\[data-theme="dark"\] \.cluster-workflow-exit:hover/);
  assert.match(styles, /html\[data-theme="dark"\] \.cluster-workflow-exit:focus-visible/);
  assert.match(styles, /html\[data-theme="dark"\] \.cluster-workflow-exit:active/);
  assert.match(styles, /html\[data-theme="dark"\] \.cluster-workflow-exit:disabled/);
});

test("multi-model cluster conversation boundary resizes without taking over the message scrollbar", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const panel = sourceBlock(source, "function renderAgentPanel", "function renderComposerThreadMentionSearch");
  const resizing = sourceBlock(source, "function bindWorkflowChatPanelResize", "function bindWorkflowCanvasContextMenu");

  assert.match(
    panel,
    /<aside class="agent-panel[\s\S]*data-workflow-chat-resize[\s\S]*role="separator"[\s\S]*<div class="agent-panel-inner">/,
  );
  assert.match(panel, /aria-label="调整左侧会话宽度"/);
  assert.match(source, /workflowChatPanelWidthsByThreadId = new Map<string, number>\(\)/);
  assert.match(source, /--workflow-chat-panel-width:\$\{workflowChatPanelWidth\}px/);
  assert.match(resizing, /handle\.closest<HTMLElement>\("\.agent-panel"\)/);
  assert.match(resizing, /handle\.setPointerCapture\(pointerId\)/);
  assert.match(resizing, /startWidth \+ moveEvent\.clientX - startX/);
  assert.match(resizing, /event\.key === "ArrowLeft"/);
  assert.match(resizing, /event\.key === "ArrowRight"/);
  assert.match(source, /bindWorkflowChatPanelResize\(container\)/);
  assert.match(
    styles,
    /\.workflow-chat-resize-handle\s*\{[^}]*left:\s*0;[^}]*width:\s*12px;[^}]*cursor:\s*ew-resize;[^}]*touch-action:\s*none;/s,
  );
  assert.match(
    styles,
    /\.desktop-body\.multi-model-cluster-layout\.workflow-chat-panel-resized:not\(\.right-panel-collapsed\) > \.chat-panel\s*\{[^}]*--workflow-chat-panel-width[^}]*flex:\s*0 1 clamp/s,
  );
  assert.match(
    styles,
    /\.desktop-body\.multi-model-cluster-layout\.workflow-chat-panel-resized:not\(\.right-panel-collapsed\) > \.agent-panel\s*\{[^}]*min-width:\s*360px;[^}]*flex:\s*1 1 0;/s,
  );
  assert.match(styles, /\.workflow-chat-resize-handle:hover::after,/);
  assert.match(styles, /\.workflow-chat-resize-handle:focus-visible::after,/);
  assert.match(styles, /\.workflow-chat-resize-handle\.active::after/);
  assert.match(
    styles,
    /\.workflow-chat-resize-handle::after\s*\{[^}]*width:\s*1px;[^}]*background:\s*rgba\(128, 135, 145, 0\.68\);/s,
  );
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-chat-resize-handle::after/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-chat-resize-handle:focus-visible::after/);
  assert.doesNotMatch(
    styles,
    /\.workflow-chat-resize-handle(?:\.[\w-]+|:[\w-]+|::after|\s)*\s*\{[^}]*(?:#4777ed|#8cabff|80,\s*126,\s*238|124,\s*160,\s*255)/s,
  );
});

test("multi-model cluster suppresses native Codex subagent progress cards", async () => {
  const source = await rendererSource;
  const activeSubagents = sourceBlock(source, "function activeSubagentUiEntries", "function withThinkingMessage");
  const renderMessage = sourceBlock(source, "function renderMessage(message: Message", "function messageRenderSignature");

  assert.match(activeSubagents, /isMultiModelClusterThread\(threadId\)\) return \[\]/);
  assert.match(renderMessage, /!isMultiModelClusterThread\(message\.conversation_id\)/);
});

test("multi-model thinking is replaced by the live workflow relay after invited models join", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const thinking = sourceBlock(source, "function withThinkingMessage", "function hasActiveContextCompaction");
  const workflowEvents = sourceBlock(source, "function applyWorkflowEvent", "function presentWorkflowFailure");
  const relayMessages = sourceBlock(source, "function withWorkflowRelayMessages", "function withThinkingMessage");

  assert.match(thinking, /isMultiModelClusterThread\(threadId\)[\s\S]*!multiModelClusterMembersJoined\(run\)/);
  assert.match(thinking, /workflowRelayEntries\(run as WorkflowCanvasRun\)\.length\) return visible/);
  assert.match(source, /const messagesWithWorkflowRelay = withWorkflowRelayMessages\(threadId, orderedMessages\)/);
  assert.match(source, /withCollapsedTurnResults\(threadId, messagesWithWorkflowRelay\)/);
  assert.match(source, /withThinkingMessage\(threadId, collapsedMessages\)/);
  assert.match(source, /renderWorkflowRelayBubble\(workflowRelay\)/);
  assert.match(relayMessages, /entry\.nodeKind === "agent"\s*\?\s*"Haolo子Agent"/);
  assert.match(relayMessages, /entry\.nodeKind === "context"\s*\?\s*"本地材料"/);
  assert.match(relayMessages, /modelMeta\?\.name \|\| entry\.model \|\| entry\.nodeTitle/);
  assert.match(workflowEvents, /const membersJustJoined = !membersWereJoined && multiModelClusterMembersJoined\(run\)/);
  assert.match(workflowEvents, /const conversationPatched = updateActiveMessageScroller\(\)/);
  assert.match(workflowEvents, /membersJustJoined \|\| !conversationPatched \|\| !panelPatched/);
  assert.match(styles, /\.multi-model-cluster-presence\s*\{[^}]*width:\s*100%;[^}]*font-size:\s*calc\(11px \+ var\(--app-font-size-offset\)\);[^}]*text-align:\s*center;/s);
  assert.match(styles, /\.multi-model-cluster-presence-avatar\s*\{[^}]*width:\s*15px;[^}]*min-width:\s*15px;[^}]*max-width:\s*15px;[^}]*height:\s*15px;[^}]*min-height:\s*15px;[^}]*max-height:\s*15px;[^}]*flex:\s*0 0 15px;[^}]*border-radius:\s*var\(--avatar-radius\);/s);
  assert.match(styles, /\.workflow-relay-chat-bubble\s*\{/);
  assert.match(styles, /\.workflow-relay-chat-bubble\.active\s*\{/);
  assert.match(styles, /\.workflow-relay-chat-mention\s*\{/);
  assert.match(styles, /\.multi-model-cluster-prelude\.collapsed\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(styles, /\.multi-model-cluster-presence-mark/);
});

test("completed cluster turns fold planning prompts and every workflow bubble with the final result", async () => {
  const source = await rendererSource;
  const messages = sourceBlock(source, "function messagesForThread", "function isFinalAgentTurnResultMessage");
  const folding = sourceBlock(source, "function withCollapsedTurnResults", "function isTurnResultGroupComplete");
  const prelude = sourceBlock(source, "function multiModelClusterPreludeCollapsed", "function patchMultiModelClusterPlanningProgress");
  const scrollerPatch = sourceBlock(source, "function patchMessageScrollerContent", "function patchStreamingAssistantMessageRow");

  assert.ok(
    messages.indexOf("withWorkflowRelayMessages(threadId, orderedMessages)") <
      messages.indexOf("withCollapsedTurnResults(threadId, messagesWithWorkflowRelay)"),
    "workflow relay bubbles must join the turn before its process range is collapsed",
  );
  assert.match(folding, /const collapsedIndexes = turnResultProcessIndexes\(messages, finalIndex\)/);
  assert.match(folding, /if \(!collapsedIndexes\.length\) continue/);
  assert.match(
    folding,
    /function turnResultProcessIndexes[\s\S]*isRenderedUserSideMessage\(messages\[index\]\)[\s\S]*slice\(firstProcessIndex, finalIndex\)/,
  );
  assert.match(prelude, /isRenderedUserSideMessage\(messages\[index\]\)/);
  assert.match(prelude, /turnResult && !turnResult\.expanded/);
  assert.match(prelude, /multi-model-cluster-prelude\$\{collapsed \? " collapsed" : ""\}/);
  assert.match(prelude, /aria-hidden="\$\{collapsed \? "true" : "false"\}"/);
  assert.match(prelude, /patchMultiModelClusterPreludeCollapsedState/);
  assert.match(scrollerPatch, /patchMultiModelClusterPreludeCollapsedState\(thread\.id, messages\)/);
});

test("an active cluster workflow blocks Enter and direct sends until completion or stop", async () => {
  const source = await rendererSource;
  const busyState = sourceBlock(source, "function activeWorkflowRunForThread", "function hasCachedVisibleThreadContent");
  const send = sourceBlock(source, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  const keydown = sourceBlock(
    source,
    '.querySelector<HTMLTextAreaElement>("#composerInput")\n    ?.addEventListener("keydown"',
    '?.addEventListener("input",',
  );
  const workflowEvents = sourceBlock(source, "function applyWorkflowEvent", "function maybeAutoCollapseLeftPanelForWorkflow");

  assert.match(busyState, /activeWorkflowRunForThread\(threadId\)/);
  assert.match(send, /if \(activeWorkflowRunForThread\(threadId\)\)[\s\S]*WORKFLOW_RUNNING_SEND_BLOCKED_TOAST/);
  assert.match(keydown, /event\.key === "Enter" && !event\.shiftKey[\s\S]*activeWorkflowRunForThread\(threadId\)[\s\S]*return/);
  assert.match(workflowEvents, /shouldApplyWorkflowRunSnapshot\(current, run\)/);
});

test("successful workflow delivery replaces an invalid streamed final and binds result artifacts", async () => {
  const source = await rendererSource;
  const workflowEvents = sourceBlock(
    source,
    "function applyWorkflowEvent",
    "function presentWorkflowFailure",
  );
  const delivery = sourceBlock(
    source,
    "function bindWorkflowSuccessDelivery",
    "function presentWorkflowFailure",
  );
  const upsert = sourceBlock(source, "function upsertItem", "function removeMatchingLocalUserItem");
  const artifactAttachment = sourceBlock(
    source,
    "function attachmentFromArtifact",
    "function isJsonArtifact",
  );

  assert.match(workflowEvents, /run\.status === "succeeded"/);
  assert.match(workflowEvents, /bindWorkflowSuccessDelivery\(run\)/);
  assert.match(delivery, /run\.finalResult\?\.output\?\.text/);
  assert.match(delivery, /run\.finalResult\?\.output\?\.artifacts/);
  assert.match(delivery, /itemTurnId\(item\) === finalTurnId/);
  assert.match(delivery, /attachmentFromArtifact/);
  assert.match(upsert, /bindWorkflowSuccessDelivery\(completedWorkflow\)/);
  assert.match(artifactAttachment, /\(artifact as any\)\.uri/);
});

test("all agent response bubbles share the Haolo coordinator light-blue background", async () => {
  const styles = await stylesSource;

  assert.match(styles, /:root\s*\{[^}]*--bubble-agent:\s*#f2f4f8;/s);
  assert.match(styles, /\.agent-bubble\s*\{[^}]*background:\s*var\(--bubble-agent\);/s);
  for (const variant of ["active", "coordinator", "failed"]) {
    assert.match(
      styles,
      new RegExp(`\\.workflow-relay-chat-bubble\\.${variant}\\s*\\{[^}]*background:\\s*var\\(--bubble-agent\\);`, "s"),
    );
  }
  assert.match(
    styles,
    /html:not\(\[data-theme="dark"\]\) \.subagent-output-bubble\s*\{[^}]*background:\s*var\(--bubble-agent\);/s,
  );
  assert.match(styles, /html\[data-theme="dark"\]\s*\{[^}]*--bubble-agent:\s*#20242b;/s);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.subagent-output-bubble\s*\{[^}]*background:\s*var\(--bubble-agent\);/s,
  );
  assert.doesNotMatch(styles, /\.workflow-relay-chat-bubble\.failed\s*\{[^}]*#fff1f1/s);
});

test("composer group and cluster labels share the one-pixel optical alignment", async () => {
  const styles = await stylesSource;

  assert.match(
    styles,
    /\.composer-group-picker \.chat-title-group-button span\s*\{[^}]*transform:\s*translateY\(-1px\);/s,
  );
});

test("serial composer indicator uses the execution icon in both themes", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const icon = sourceBlock(source, "function renderComposerModeIcon", "function composerModeLabel");
  const picker = sourceBlock(source, "function renderComposerModePicker", "function activeComposerDraftSnapshot");

  assert.match(icon, /icon === "cluster"/);
  assert.match(icon, /<circle cx="12" cy="5"/);
  assert.match(picker, /renderComposerModeIcon\("execution"\)/);
  assert.doesNotMatch(picker, /renderComposerModeIcon\("cluster"\)/);
  assert.doesNotMatch(picker, /renderComposerModeCheck|composer-mode-check/);
  assert.doesNotMatch(styles, /\.composer-mode-check/);
  assert.match(styles, /\.composer-mode-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
  assert.match(styles, /\.composer-mode-trigger\.serial-only[\s\S]*color:\s*var\(--text-secondary\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-mode-trigger\.serial-only[\s\S]*color:\s*var\(--text-tertiary\)/);
});

test("thread titles remove every legacy group mark and trim surrounding whitespace", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const cleaner = sourceBlock(source, "function cleanThreadDisplayTitle", "function threadListDisplayName");
  const listTitle = sourceBlock(source, "function threadListDisplayName", "function withFixedConnectionThreadName");
  const chatTitle = sourceBlock(source, "function chatHeaderTitle", "function renderNewThreadGroupPicker");

  assert.match(cleaner, /stripConversationTitleMentionTokens\(/);
  assert.match(cleaner, /\.replace\(\/\\s\*\\\[群\\\]\\s\*\/g, ""\)/);
  assert.match(cleaner, /TRADING_EXPERT_TITLE_MENTION_TOKENS/);
  assert.match(listTitle, /cleanThreadDisplayTitle\(/);
  assert.match(chatTitle, /cleanThreadDisplayTitle\(/);
  assert.doesNotMatch(styles, /multi-model-cluster-title-mark/);
});

test("only canvas avatars use a type-owned border that renaming cannot edit", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const avatarBorder = sourceBlock(
    source,
    "function conversationAvatarBorderClass",
    "function renderThreadRow",
  );
  const threadRow = sourceBlock(source, "function renderThreadRow", "function threadComposerDraftPreview");
  const chatHeader = sourceBlock(source, "function renderChatHeader", "function formatContextTokens");
  const threadAvatar = sourceBlock(
    source,
    "function renderThreadRowAvatar",
    "function patchMultiModelClusterThreadAvatar",
  );
  const avatarPatch = sourceBlock(
    source,
    "function patchMultiModelClusterThreadAvatar",
    "function threadFallbackAvatarUrl",
  );
  const renameFlow = sourceBlock(
    source,
    "function openThreadRenameDialog",
    "function openThreadGroupSetDialog",
  );

  assert.match(avatarBorder, /isActiveMultiModelClusterConversation\(thread\.id\)\) return " canvas-avatar-border"/);
  assert.doesNotMatch(avatarBorder, /isLocalGroupChatThread|group-chat-avatar-border/);
  assert.doesNotMatch(avatarBorder, /threadNameOverride|threadListDisplayName|thread\.name/);
  assert.doesNotMatch(threadRow, /conversationAvatarBorderClass/);
  assert.doesNotMatch(chatHeader, /conversationAvatarBorderClass/);
  assert.match(threadAvatar, /conversation-avatar-wrap\$\{conversationAvatarBorderClass\(thread\)\}/);
  assert.match(avatarPatch, /avatarWrap\.className = `conversation-avatar-wrap\$\{conversationAvatarBorderClass\(thread\)\}/);

  assert.match(renameFlow, /name: threadNameOverride\(threadId\) \|\| threadListDisplayName\(target\)/);
  assert.match(renameFlow, /const name = dialog\.name\.trim\(\)/);
  assert.doesNotMatch(renameFlow, /conversationAvatarBorderClass/);

  assert.doesNotMatch(source, /conversation-mode-mark/);
  assert.doesNotMatch(styles, /conversation-mode-mark/);
  assert.doesNotMatch(styles, /group-chat-avatar-border/);
  assert.match(styles, /\.conversation-avatar-wrap\.canvas-avatar-border > \.avatar\s*\{[^}]*border:\s*0\.5px solid #5b9dff;/s);
});
