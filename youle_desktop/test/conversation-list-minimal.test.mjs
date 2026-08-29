import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { translateAppText } from "../src/renderer/app-language.mjs";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const desktopMainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const groupDeletionRuntime = rendererSource.then((source) => {
  const names = new Set([
    "groupedThreadsForList", "threadGroupConversations", "isThreadGroupConversationDeletionBlocked",
    "deleteThreadGroupConversations", "renderThreadGroupContextMenu", "runThreadGroupMenuCommand",
    "threadGroupMenuStyle", "listThreadGroupHistory",
  ]);
  const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
  assert.equal(functions.length, names.size);
  return ts.transpileModule(functions.map((node) => node.getText(parsed)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
});

async function groupDeletionHarness({ threads, confirm = async () => true, remove } = {}) {
  const groups = [{ id: "recent", name: "最近" }, { id: "project", name: "Project <test>" }, { id: "other", name: "Other" }];
  const state = { threads: threads ?? [{ id: "a" }, { id: "b" }], currentThreadId: "a", threadGroupMenu: null };
  const deleted = [];
  const toasts = [];
  const confirmations = [];
  const busy = new Set();
  const context = {
    state, groups, deleted, toasts, confirmations, busy,
    authenticatedWorkspaceGeneration: 1,
    loadThreads: async (options) => { assert.equal(options.allPages, true); return true; },
    firstString: (...values) => values.find((value) => typeof value === "string" && value.trim()) || null,
    DEFAULT_THREAD_GROUP_ID: "recent",
    THREAD_CONTEXT_MENU_ROW_HEIGHT: 28,
    THREAD_CONTEXT_MENU_CHROME_HEIGHT: 14,
    THREAD_CONTEXT_MENU_LIST_GAP: 4,
    hiddenThreadIds: new Set(),
    pendingThreadGroupDeletions: new Set(),
    submittingComposerThreadIds: new Set(),
    threadGroupByThreadId: {},
    threadGroupById: (id) => groups.find((group) => group.id === id),
    isDefaultThreadGroup: (id) => id === "recent",
    isBlankNewThread: (id) => id === "blank",
    isTopLevelConversationThread: (thread) => thread.id === "blank",
    isDefaultAssignableThread: (thread) => !thread.unassigned,
    conversationListThreadGroups: () => groups,
    filteredThreads: () => state.threads.filter((thread) => !thread.internal),
    isConversationThreadWorking: (id) => busy.has(id),
    isThreadContinuationCreationActive: () => false,
    isAutoTaskThread: (thread) => Boolean(thread.autoTask),
    autoTaskIdFromThreadId: () => null,
    threadGroupDisplayLabel: (group) => group.name,
    threadListDisplayName: (thread) => thread.name || "",
    threadListPreviewText: (thread) => thread.preview || "",
    tradingLastAnalysisLabelForThread: (id) => state.threads.find((thread) => thread.id === id)?.analysisLabel || "",
    NEW_THREAD_TITLE: "新任务",
    escapeAttr: (value) => String(value).replaceAll('"', "&quot;"),
    isThreadGroupPickerMenuSource: (source) => source === "select",
    root: { querySelector: () => null },
    window: { innerWidth: 1024 },
    floatingMenuTop: (top, height) => Math.min(top, 600 - height - 8),
    render: () => {},
    showToast: (message) => toasts.push(message),
    confirmSelectionInApp: async (options, items) => {
      confirmations.push({ ...options, items });
      const result = await confirm(context);
      return result === true ? items.map((item) => item.id) : result === false ? null : result;
    },
    deleteThread: async (id) => {
      deleted.push(id);
      if (remove) await remove(id, context);
      else state.threads = state.threads.filter((thread) => thread.id !== id);
    },
  };
  runInNewContext(await groupDeletionRuntime, context);
  return context;
}

test("group deletion offers all project conversations including pinned and unexpanded rows", async () => {
  const threads = Array.from({ length: 9 }, (_, index) => ({ id: `project-${index}`, pinned: index === 0 }));
  const runtime = await groupDeletionHarness({ threads: [...threads, { id: "other" }, { id: "blank" }, { id: "internal", internal: true }, { id: "hidden" }] });
  Object.assign(runtime.threadGroupByThreadId, Object.fromEntries(threads.map((thread) => [thread.id, "project"])));
  Object.assign(runtime.threadGroupByThreadId, { other: "other", blank: "project", internal: "project", hidden: "project" });
  runtime.hiddenThreadIds.add("hidden");
  runtime.state.currentThreadId = "project-0";
  await runtime.deleteThreadGroupConversations("project");
  assert.equal(runtime.deleted.length, 9);
  assert.equal(runtime.deleted.at(-1), "project-0", "the current conversation is removed last");
  assert.deepEqual(runtime.state.threads.map((thread) => thread.id), ["other", "blank", "internal", "hidden"]);
  assert.equal(runtime.groups.length, 3, "deleting conversations must retain the group");
  assert.match(runtime.confirmations[0].message, /Project <test>\n会话数量：9/);
  assert.equal(runtime.confirmations[0].tone, "danger");
  assert.deepEqual(Array.from(runtime.confirmations[0].items, (item) => item.id), threads.map((thread) => thread.id));
  assert.match(runtime.confirmations[0].detail, /不可恢复.*分组及文件夹将保留/);
  assert.equal(runtime.toasts.at(-1), "所选会话已删除");
});

test("group deletion removes only checked conversations and retains unselected conversations", async () => {
  const runtime = await groupDeletionHarness({
    threads: [{ id: "a", name: "帮我分析", analysisLabel: "ETH1H" }, { id: "b", preview: "消息预览" }, { id: "c", pinned: true }, { id: "other" }],
    confirm: async () => ["a", "c", "c", "other", "unknown"],
  });
  runtime.threadGroupByThreadId.other = "other";
  runtime.busy.add("b");
  await runtime.deleteThreadGroupConversations("recent");
  assert.deepEqual(runtime.deleted, ["c", "a"], "only selected in-group IDs are deleted, once, with the open conversation last");
  assert.deepEqual(runtime.state.threads.map((thread) => thread.id), ["b", "other"]);
  assert.equal(runtime.confirmations[0].items[0].label, "ETH1H 帮我分析");
  assert.equal(runtime.confirmations[0].items[1].label, "消息预览");
  assert.equal(runtime.confirmations[0].items[2].label, "新任务");
  assert.equal(runtime.toasts.at(-1), "所选会话已删除", "unselected and busy conversations must not count as failures");
});

test("empty or invalid selections cannot fall back to deleting the entire group", async () => {
  for (const selection of [null, [], ["unknown"]]) {
    const runtime = await groupDeletionHarness({ confirm: async () => selection });
    await runtime.deleteThreadGroupConversations("recent");
    assert.deepEqual(runtime.deleted, []);
    assert.equal(runtime.pendingThreadGroupDeletions.size, 0);
  }
});

test("recent-group deletion excludes other groups, unassigned channels and blank drafts", async () => {
  const runtime = await groupDeletionHarness({ threads: [{ id: "default" }, { id: "pinned", pinned: true }, { id: "project" }, { id: "blank" }, { id: "channel", unassigned: true }] });
  runtime.threadGroupByThreadId.project = "project";
  await runtime.deleteThreadGroupConversations("recent");
  assert.deepEqual(runtime.deleted, ["default", "pinned"]);
  assert.deepEqual(runtime.state.threads.map((thread) => thread.id), ["project", "blank", "channel"]);
});

test("cancelling or repeatedly requesting group deletion never bypasses confirmation", async () => {
  let resolve;
  const runtime = await groupDeletionHarness({ confirm: () => new Promise((done) => { resolve = done; }) });
  const pending = runtime.deleteThreadGroupConversations("recent");
  await runtime.deleteThreadGroupConversations("recent");
  await Promise.resolve();
  assert.equal(runtime.confirmations.length, 1);
  assert.deepEqual(runtime.deleted, []);
  resolve(false);
  await pending;
  assert.deepEqual(runtime.deleted, []);
  assert.equal(runtime.pendingThreadGroupDeletions.size, 0);
});

test("confirmation keeps a stable scope if conversations move or arrive in the meantime", async () => {
  const runtime = await groupDeletionHarness({ confirm: async (context) => {
    context.threadGroupByThreadId.b = "other";
    context.state.threads.push({ id: "new" });
    return true;
  } });
  await runtime.deleteThreadGroupConversations("recent");
  assert.deepEqual(runtime.deleted, ["a"]);
  assert.deepEqual(runtime.state.threads.map((thread) => thread.id), ["b", "new"]);
  assert.match(runtime.toasts.at(-1), /部分所选会话未删除/);
});

test("selected running conversations block deletion without partially removing idle selections", async () => {
  const runtime = await groupDeletionHarness();
  runtime.busy.add("b");
  await runtime.deleteThreadGroupConversations("recent");
  assert.equal(runtime.confirmations.length, 1);
  assert.deepEqual(runtime.deleted, []);
  assert.match(runtime.toasts.at(-1), /正在运行/);
  assert.equal(runtime.pendingThreadGroupDeletions.size, 0);
});

test("group deletion rechecks membership and continues after an individual deletion fails", async () => {
  const runtime = await groupDeletionHarness({ threads: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], remove: async (id, context) => {
    if (id === "b") {
      context.threadGroupByThreadId.c = "other";
      throw new Error("archive failed");
    }
    context.state.threads = context.state.threads.filter((thread) => thread.id !== id);
  } });
  await runtime.deleteThreadGroupConversations("recent");
  assert.deepEqual(runtime.deleted, ["b", "d", "a"]);
  assert.deepEqual(runtime.state.threads.map((thread) => thread.id), ["b", "c"]);
  assert.match(runtime.toasts.at(-1), /部分所选会话未删除/);
  assert.equal(runtime.pendingThreadGroupDeletions.size, 0);
});

test("a selected conversation that starts working during deletion is kept", async () => {
  const runtime = await groupDeletionHarness({
    threads: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "unselected" }],
    confirm: async () => ["a", "b", "c"],
    remove: async (id, context) => {
      context.state.threads = context.state.threads.filter((thread) => thread.id !== id);
      if (id === "b") context.busy.add("c");
    },
  });
  await runtime.deleteThreadGroupConversations("recent");
  assert.deepEqual(runtime.deleted, ["b", "a"]);
  assert.deepEqual(runtime.state.threads.map((thread) => thread.id), ["c", "unselected"]);
  assert.equal(runtime.toasts.at(-1), "部分所选会话未删除，请稍后重试");
});

test("group menu appends the bulk action, guards pending requests and fits every row", async () => {
  const runtime = await groupDeletionHarness();
  for (const groupId of ["recent", "project"]) {
    runtime.state.threadGroupMenu = { groupId, x: 200, y: 590 };
    runtime.threadGroupByThreadId.a = groupId;
    const html = runtime.renderThreadGroupContextMenu();
    const actions = Array.from(html.matchAll(/data-thread-group-action="([^"]+)"/g), (match) => match[1]);
    assert.equal(actions.at(-1), "delete-conversations");
    assert.equal(actions.length, groupId === "recent" ? 3 : 5);
    assert.match(html, /role="menuitem" aria-busy="false" >\s*删除指定会话/);
    const expectedTop = 600 - (actions.length * 28 + 14) - 8;
    assert.match(runtime.threadGroupMenuStyle(runtime.state.threadGroupMenu), new RegExp(`top:${expectedTop}px`));
    runtime.pendingThreadGroupDeletions.add(groupId);
    assert.match(runtime.renderThreadGroupContextMenu(), /aria-busy="true" disabled>\s*处理中…/);
  }
  runtime.state.threads = [];
  runtime.pendingThreadGroupDeletions.clear();
  assert.match(runtime.renderThreadGroupContextMenu(), /aria-busy="false" >/, "an empty first page must still allow checking older history");
  runtime.runThreadGroupMenuCommand({ disabled: true, dataset: { threadGroupAction: "delete-conversations", groupId: "project" } });
  assert.equal(runtime.confirmations.length, 0);
  await runtime.deleteThreadGroupConversations("project");
  assert.equal(runtime.confirmations.length, 0);
  assert.match(runtime.toasts.at(-1), /暂无可删除/);
});

test("bulk deletion warns about scheduled tasks and translates all new dialog copy", async () => {
  const runtime = await groupDeletionHarness({ threads: [{ id: "task", autoTask: true }] });
  await runtime.deleteThreadGroupConversations("recent");
  assert.match(runtime.confirmations[0].detail, /如勾选自动任务，对应任务也将停止执行/);
  const options = runtime.confirmations[0];
  for (const copy of [options.title, options.detail, "会话数量：1\n请选择要删除的会话，可多选。", "已选择：1 / 3", ...runtime.toasts]) {
    assert.doesNotMatch(translateAppText(copy, "en"), /\p{Script=Han}/u);
  }
  assert.equal(translateAppText(options.title, "en"), "Delete selected conversations");
  assert.equal(translateAppText(options.title, "zh-TW"), "刪除指定會話");
});

test("unselected scheduled tasks keep running after deleting an ordinary conversation", async () => {
  const runtime = await groupDeletionHarness({ threads: [{ id: "a" }, { id: "task", autoTask: true }], confirm: async () => ["a"] });
  await runtime.deleteThreadGroupConversations("recent");
  assert.deepEqual(runtime.deleted, ["a"]);
  assert.deepEqual(runtime.state.threads.map((thread) => thread.id), ["task"]);
  assert.equal(runtime.toasts.at(-1), "所选会话已删除");
});

test("bulk deletion reads history beyond the sidebar page and rejects incomplete results", async () => {
  const runtime = await groupDeletionHarness();
  const requests = [];
  runtime.api = { listThreads: async (params) => {
    requests.push(params);
    return params.cursor ? { data: [{ id: "older" }], nextCursor: null } : { data: Array.from({ length: 40 }, (_, index) => ({ id: `recent-${index}` })), nextCursor: "older-page" };
  } };
  assert.equal((await runtime.listThreadGroupHistory("/project", true)).length, 41);
  assert.equal(requests[1].cursor, "older-page");
  assert.equal(requests[1].cwd, "/project");
  requests.length = 0;
  assert.equal((await runtime.listThreadGroupHistory("/project")).length, 40);
  assert.equal(requests.length, 1, "normal sidebar loads remain paginated");
  runtime.api.listThreads = async () => ({ data: [], nextCursor: "loop" });
  await assert.rejects(runtime.listThreadGroupHistory("/project", true), /Repeated/);
  runtime.api.listThreads = async () => ({});
  await assert.rejects(runtime.listThreadGroupHistory("/project", true), /Invalid/);
  runtime.loadThreads = async () => { throw new Error("offline"); };
  await runtime.deleteThreadGroupConversations("recent");
  assert.equal(runtime.confirmations.length, 0);
  assert.equal(runtime.deleted.length, 0);
  assert.match(runtime.toasts.at(-1), /无法读取完整会话列表/);
});

test("changing accounts while confirming group deletion cancels the pending removal", async () => {
  const runtime = await groupDeletionHarness({ confirm: async (context) => {
    context.authenticatedWorkspaceGeneration += 1;
    return true;
  } });
  await runtime.deleteThreadGroupConversations("recent");
  assert.deepEqual(runtime.deleted, []);
  assert.equal(runtime.pendingThreadGroupDeletions.size, 0);
});

test("changing accounts while loading history never opens a deletion picker in the new account", async () => {
  const runtime = await groupDeletionHarness();
  runtime.loadThreads = async () => { runtime.authenticatedWorkspaceGeneration += 1; return true; };
  await runtime.deleteThreadGroupConversations("recent");
  assert.equal(runtime.confirmations.length, 0);
  assert.deepEqual(runtime.deleted, []);
});

test("group menu destructive, hover, active, focus and disabled states use both theme tokens", async () => {
  const styles = await stylesSource;
  const states = sourceBlock(styles, ".thread-group-context-menu button.danger {", ".thread-menu-icon {");
  assert.match(states, /color-mix\(in srgb, var\(--danger\) 80%, var\(--text-primary\)\)/);
  assert.match(states, /:is\(:hover, :focus-visible\):not\(:disabled\)/);
  assert.match(states, /:focus-visible\s*\{[^}]*outline: 2px solid var\(--brand-blue\)/s);
  assert.match(states, /:active:not\(:disabled\)\s*\{[^}]*var\(--surface-hover-strong\)/s);
  assert.match(states, /:disabled\s*\{[^}]*background: transparent;[^}]*color: var\(--text-muted\)/s);
  assert.doesNotMatch(states, /#[0-9a-f]{3,8}|rgba?\(/i);
  for (const theme of [sourceBlock(styles, ":root {", 'html[data-font-size="small"]'), sourceBlock(styles, 'html[data-theme="dark"] {', "* {")]) {
    for (const token of ["danger", "text-primary", "surface-hover", "surface-hover-strong", "brand-blue", "text-muted"]) {
      assert.ok(theme.includes(`--${token}:`), `${token} must be defined in both themes`);
    }
  }
});

test("history conversations render as one-line titles and the blank thread is not duplicated as a row", async () => {
  const source = await rendererSource;
  const rowBlock = sourceBlock(
    source,
    "function renderThreadRow(thread: ConversationSummary)",
    "function threadComposerDraftPreview",
  );

  assert.match(rowBlock, /const minimalTitle = rawRowName\.trim\(\) \|\| preview\.trim\(\) \|\| NEW_THREAD_TITLE;/);
  assert.match(rowBlock, /conversation-row-wrap conversation-row-minimal/);
  assert.match(rowBlock, /conversation-copy conversation-copy-minimal/);
  assert.match(rowBlock, /const analysisContextLabel = tradingLastAnalysisLabelForThread\(thread\.id\);/);
  assert.match(rowBlock, /class="conversation-analysis-context" title="最后分析画布/);
  assert.match(
    rowBlock,
    /class="row-name" title="\$\{escapeAttr\(minimalTitle\)\}"><span class="row-name-text">\$\{escapeHtml\(minimalTitle\)\}<\/span><\/span>/,
  );
  assert.doesNotMatch(rowBlock, /renderThreadRowAvatar|row-preview|<time/);

  const sections = sourceBlock(source, "function renderThreadSections", "function conversationGroupSectionsForList");
  assert.match(sections, /threads\.filter\(\(thread\) => !isBlankNewThread\(thread\.id\)\)/);
});

test("sidebar actions follow Codex order, with settings moved from the titlebar to the bottom-left icon", async () => {
  const source = await rendererSource;
  const actions = sourceBlock(source, "function renderConversationListActions", "function renderChatList");
  const titlebarActions = sourceBlock(source, "function renderTitlebarPrimaryActions", "function renderWindowControls");
  const footer = sourceBlock(source, "function renderConversationListFooter", "function renderChatList");
  const chatList = sourceBlock(source, "function renderChatList", "function isHaoloContact");
  const labels = ["新任务", "账户", "计划", "策略"];
  let cursor = -1;
  for (const label of labels) {
    const index = actions.indexOf(`<span>${label}</span>`);
    assert.ok(index > cursor, `${label} should appear in the requested order`);
    cursor = index;
  }
  assert.match(actions, /data-action="new-chat"/);
  assert.match(actions, /renderConversationListIcon\("account"\)/);
  assert.match(actions, /renderConversationListIcon\("plans"\)/);
  assert.doesNotMatch(actions, /data-conversation-static-action="knowledge"|renderConversationListIcon\("knowledge"\)|<span>知识库<\/span>/);
  assert.match(actions, /data-conversation-static-action="skills"/);
  assert.match(actions, /renderConversationListIcon\("skills"\)/);
  assert.doesNotMatch(actions, /data-trading-expert-panel-tab|role="tab"|aria-selected/);
  assert.match(titlebarActions, /data-action="toggle-external-channel-menu"/);
  assert.doesNotMatch(titlebarActions, /自动化|open-auto-tasks/);
  assert.match(titlebarActions, /titlebar-icon-action[^>]*toggle-external-channel-menu[^>]*aria-label="更多"[\s\S]*renderTitlebarMoreIcon\(\)/);
  assert.match(titlebarActions, /data-titlebar-channel-trigger[\s\S]*renderTitlebarPlugIcon\(\)[\s\S]*<span>连接渠道<\/span>/);
  assert.match(titlebarActions, /data-action="open-auto-task-dialog"[\s\S]*renderTitlebarAlarmIcon\(\)[\s\S]*<span>自动任务<\/span>/);
  assert.ok(titlebarActions.indexOf("data-titlebar-channel-trigger") < titlebarActions.indexOf('data-action="open-auto-task-dialog"'));
  assert.doesNotMatch(titlebarActions, /title="连接"|data-action="open-settings"|>设置<|renderConversationListIcon/);
  assert.doesNotMatch(actions, /data-action="open-auto-task-dialog"|renderTitlebarAlarmIcon/);
  assert.match(footer, /class="conversation-list-footer"/);
  assert.match(footer, /class="conversation-list-settings-button/);
  assert.match(footer, /data-action="open-settings"/);
  assert.match(footer, /title="设置"[^]*aria-label="设置"[^]*aria-haspopup="dialog"/);
  assert.match(footer, /aria-expanded="\$\{state\.settingsOpen \? "true" : "false"\}"/);
  assert.match(footer, /renderConversationListIcon\("settings"\)/);
  assert.ok(chatList.indexOf("renderUpdateDownloadDock()") < chatList.indexOf("renderConversationListFooter()"));
  assert.doesNotMatch(actions, /open-group-chat-dialog|renderConversationListIcon\("group-chat"\)|创建群聊/);
  assert.doesNotMatch(source, /renderChatNewMenu|CHAT_NEW_PLUS|create-workflow-canvas|createBlankWorkflowCanvas/);
  assert.doesNotMatch(source, /renderAppSidebar|renderNavIcon|class="app-sidebar"|data-nav=/);
});

test("the sidebar skills action opens the existing skills and plugins page", async () => {
  const source = await rendererSource;
  const actions = sourceBlock(source, "function renderConversationListActions", "function renderChatList");
  const openSkillsPage = sourceBlock(source, "function openMyConfigPage", "function openSettingsDialog");
  const eventBindings = source.slice(source.indexOf("function bindEvents()"));

  assert.match(actions, /data-conversation-static-action="plans"[\s\S]*data-conversation-static-action="skills"/);
  assert.match(actions, /data-conversation-static-action="skills"[\s\S]*<span>策略<\/span>/);
  assert.match(openSkillsPage, /state\.activeView = "skillsPlaza"/);
  assert.match(openSkillsPage, /state\.skillsPlazaTab = "mySkills"/);
  assert.match(openSkillsPage, /refreshSkills\(\{ forceReload: true, reason: "my-config", renderAfter: false \}\)/);
  assert.match(openSkillsPage, /loadMyMarketplaceSkills\(\)/);
  assert.match(
    eventBindings,
    /\[data-conversation-static-action="skills"\][\s\S]*openMyConfigPage\(\)/,
  );
});

test("the bottom-left settings icon blends into its sidebar and covers themed interaction states", async () => {
  const styles = await stylesSource;

  assert.match(styles, /\.conversation-list-footer\s*\{[^}]*flex:\s*0 0 auto;[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.conversation-list-settings-button\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-secondary\);/s);
  assert.match(styles, /\.conversation-list-settings-button:is\(:hover, :focus-visible\),[\s\S]*?\.conversation-list-settings-button\.active\s*\{[^}]*background:\s*var\(--conversation-action-hover\);[^}]*color:\s*var\(--text-primary\);/);
  assert.match(styles, /\.conversation-list-settings-button:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.conversation-list-settings-button:active:not\(:disabled\)\s*\{[^}]*background:\s*var\(--surface-active-translucent\);/s);
  assert.match(styles, /\.conversation-list-settings-button:disabled\s*\{[^}]*color:\s*var\(--text-muted\);/s);
});

test("the titlebar more menu nests channel connections and preserves the automatic-task dialog", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const actions = sourceBlock(source, "function renderConversationListActions", "function renderChatList");
  const titlebarActions = sourceBlock(source, "function renderTitlebarPrimaryActions", "function renderWindowControls");
  const titlebarIcons = sourceBlock(source, "function renderTitlebarPlugIcon", "function renderTitlebarPrimaryActions");
  const eventBindings = source.slice(source.indexOf("function bindEvents()"));

  assert.match(actions, /class="conversation-list-new-row"/);
  assert.match(actions, /data-action="new-chat"[\s\S]*<span>新任务<\/span>/);
  assert.doesNotMatch(actions, /data-action="open-auto-task-dialog"|renderTitlebarAlarmIcon/);
  assert.match(titlebarActions, /aria-label="更多"[\s\S]*renderTitlebarMoreIcon\(\)/);
  assert.match(titlebarActions, /data-titlebar-channel-trigger[\s\S]*aria-haspopup="menu"[\s\S]*renderTitlebarPlugIcon\(\)[\s\S]*连接渠道/);
  assert.match(titlebarActions, /data-action="open-auto-task-dialog"[\s\S]*aria-haspopup="dialog"[\s\S]*renderTitlebarAlarmIcon\(\)[\s\S]*自动任务/);
  assert.match(titlebarIcons, /class="titlebar-action-icon titlebar-plug-icon"[\s\S]*class="titlebar-action-icon titlebar-alarm-icon"[\s\S]*class="titlebar-action-icon titlebar-more-icon"/);
  assert.match(styles, /\.conversation-list-new-row\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;/s);
  assert.match(styles, /\.conversation-list-new-action\s*\{[^}]*width:\s*auto;[^}]*flex:\s*1 1 auto;/s);
  assert.match(styles, /\.titlebar-primary-action\.titlebar-icon-action\s*\{[^}]*width:\s*30px;[^}]*flex:\s*0 0 30px;[^}]*padding:\s*0;/s);
  assert.match(styles, /\.titlebar-action-icon\s*\{[^}]*width:\s*18px;[^}]*fill:\s*none;[^}]*stroke:\s*currentColor;/s);
  assert.match(styles, /\.titlebar-more-icon\s*\{[^}]*fill:\s*currentColor;[^}]*stroke:\s*none;/s);
  assert.doesNotMatch(styles, /\.titlebar-(?:plug|alarm)-icon\s*\{[^}]*transform:/s);
  assert.match(styles, /\.titlebar-primary-action:hover:not\(:disabled\),[\s\S]*?\.titlebar-more-action\.menu-open > \.titlebar-primary-action,[\s\S]*?\.titlebar-primary-action:is\(\.active, :active\):not\(:disabled\)\s*\{[^}]*background:\s*transparent;/s);
  assert.doesNotMatch(styles, /\.titlebar-primary-action\s*\{[^}]*transition:[^;}]*background/s);
  assert.match(styles, /\.titlebar-primary-action:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--conversation-action-focus\);/s);
  assert.match(styles, /\.titlebar-primary-action:disabled\s*\{[^}]*color:\s*var\(--text-muted\);/s);
  assert.match(styles, /\.titlebar-more-action\.menu-open > \.titlebar-more-menu-overlay\s*\{[^}]*display:\s*block;/s);
  assert.match(styles, /\.titlebar-more-channel-item:hover > \.external-channel-menu,[\s\S]*?\.titlebar-more-channel-item\.submenu-open > \.external-channel-menu\s*\{[^}]*display:\s*block;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.titlebar-more-menu,/);
  assert.doesNotMatch(styles, /\.conversation-list-auto-task-action|\.conversation-list-alarm-icon/);
  assert.match(
    eventBindings,
    /\.querySelectorAll<HTMLElement>\(\s*'\[data-action="open-auto-task-dialog"\]',\s*\)/,
  );
  assert.doesNotMatch(eventBindings, /open-auto-tasks/);
  assert.match(eventBindings, /state\.autoTaskDraft = createAutoTaskDraft\(state\.activeNewThreadGroupId\);/);
  assert.match(eventBindings, /state\.autoTaskPicker = null;/);
  assert.match(eventBindings, /state\.autoTaskCalendarMonth = state\.autoTaskDraft\.date;/);
  assert.match(eventBindings, /state\.autoTaskDialogOpen = true;/);
  assert.match(eventBindings, /state\.externalChannels\.menuOpen = false;/);
});

test("pinned conversations are global and projects use folders with a five-row preview", async () => {
  const source = await rendererSource;
  const sections = sourceBlock(source, "function renderThreadSections", "function conversationGroupSectionsForList");
  const projectSection = sourceBlock(source, "function renderThreadGroupSection", "function renderUngroupedConversationProject");
  const projectRows = sourceBlock(source, "function renderConversationProjectThreads", "function groupedThreadsForList");

  assert.match(sections, /const pinnedThreads = conversations\.filter\(\(thread\) => Boolean\(thread\.pinned\)\)/);
  assert.match(sections, /const projectThreads = conversations\.filter\(\(thread\) => !thread\.pinned\)/);
  assert.ok(sections.indexOf("renderPinnedThreadSection") < sections.indexOf("conversation-projects-section"));
  assert.match(source, /renderConversationListIcon\("folder"\)/);
  assert.match(source, /const DEFAULT_THREAD_GROUP_CONVERSATION_LABEL = "最近";/);
  assert.doesNotMatch(source, /TRADING_EXPERT_GROUP_DISPLAY_NAME|历史任务/);
  assert.match(projectSection, /const displayName = storedDisplayName;/);
  assert.match(projectRows, /threads\.slice\(0, CONVERSATION_PROJECT_PREVIEW_LIMIT\)/);
  assert.match(projectRows, /data-conversation-project-expand/);
  assert.match(projectRows, />展开显示<\/button>/);
});

test("collapsing a project resets only its temporary expanded-all view", async () => {
  const source = await rendererSource;
  const toggleBlock = sourceBlock(
    source,
    "function toggleThreadGroupCollapsed",
    "async function toggleThreadPin",
  );
  assert.match(
    toggleBlock,
    /collapsedThreadGroupIds\.has\(groupId\)[\s\S]*collapsedThreadGroupIds\.delete\(groupId\)[\s\S]*else\s*\{[\s\S]*collapsedThreadGroupIds\.add\(groupId\)[\s\S]*expandedConversationProjectIds\.delete\(groupId\)/,
  );
  assert.ok(
    toggleBlock.indexOf("expandedConversationProjectIds.delete(groupId)")
      < toggleBlock.indexOf("render()"),
  );
});

test("minimal rows retain accessible status, unread, working, and overflow-menu behavior", async () => {
  const source = await rendererSource;
  const rowBlock = sourceBlock(
    source,
    "function renderThreadRow(thread: ConversationSummary)",
    "function threadComposerDraftPreview",
  );

  assert.match(rowBlock, /const finalResultUnviewed = hasUnviewedFinalResult\(thread\.id\);/);
  assert.match(rowBlock, /finalResultUnviewed \? "has-final-result-unviewed" : ""/);
  assert.match(rowBlock, /pinned \? "已置顶" : ""/);
  assert.match(rowBlock, /working \? "AI 正在工作" : ""/);
  assert.match(rowBlock, /aria-label="\$\{escapeAttr\(minimalAriaLabel\)\}"/);
  assert.match(rowBlock, /thread\.unread \? `<span class="unread-dot">/);
  assert.match(rowBlock, /working \? `<span class="conversation-row-spinner"/);
  assert.match(rowBlock, /data-thread-more="\$\{escapeAttr\(thread\.id\)\}"/);
  const reportBlock = sourceBlock(
    source,
    "function appendTradingExpertReport",
    "async function runTradingGeneralChartRequest",
  );
  assert.match(reportBlock, /patchConversationRow\(threadId\);/);
});

test("minimal conversation rows use compact single-line geometry and trailing actions", async () => {
  const styles = await stylesSource;
  const desktopMain = await desktopMainSource;
  const minimalStyles = styles.slice(styles.indexOf("/* Codex-like conversation history:"));

  assert.match(styles, /--conversation-list-width:\s*192px;/);
  assert.match(desktopMain, /const APP_CHAT_LIST_WIDTH = 192;/);
  assert.match(
    styles,
    /\.chat-list\s*\{[^}]*width:\s*var\(--conversation-list-width\);[^}]*max-width:\s*var\(--conversation-list-width\);/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-action\s*\{[^}]*height:\s*32px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal\s*\{[^}]*width:\s*calc\(100% - 12px\);[^}]*height:\s*32px;[^}]*margin:\s*0 6px;[^}]*border-radius:\s*7px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal \.conversation-row\s*\{[^}]*padding:\s*0 12px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal\.has-final-result-unviewed[\s\S]*\.conversation-row\s*\{[^}]*padding-right:\s*28px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal:is\([\s\S]*:hover,[\s\S]*:focus-within,[\s\S]*\.menu-open,[\s\S]*\.has-unread,[\s\S]*\.is-working[\s\S]*\)[\s\S]*\.conversation-row\s*\{[^}]*padding-right:\s*36px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal\.has-unread\.is-working[\s\S]*\.conversation-row\s*\{[^}]*padding-right:\s*54px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal \.unread-dot\s*\{[^}]*top:\s*8px;/s,
  );
  assert.match(minimalStyles, /> \.conversation-row-minimal\s*\+ \.conversation-row-minimal\s*\{[^}]*margin-top:\s*2px;/s);
  assert.match(
    minimalStyles,
    /\.conversation-row-minimal \.conversation-copy-minimal \.row-name\s*\{[^}]*container-type:\s*inline-size;[^}]*font-weight:\s*400;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*nowrap;[^}]*mask-image:\s*linear-gradient/s,
  );
  assert.match(
    minimalStyles,
    /black calc\(100% - 12px\),[\s\S]*black 82%[\s\S]*calc\(100% - 8px\),[\s\S]*black 48%[\s\S]*calc\(100% - 3px\),[\s\S]*transparent 100%/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-minimal \.thread-marker-dot\s*\{[^}]*left:\s*-2px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-minimal \.row-name-text\s*\{[^}]*width:\s*max-content;[^}]*text-overflow:\s*clip;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal:is\([\s\S]*:hover,[\s\S]*:focus-within,[\s\S]*\.menu-open[\s\S]*\)[\s\S]*\.row-name-text\s*\{[^}]*animation:\s*conversation-title-scroll-left 2s ease-in-out 0\.2s both;/s,
  );
  assert.match(
    minimalStyles,
    /@keyframes conversation-title-scroll-left\s*\{[\s\S]*translateX\(min\(0px, calc\(100cqw - 100%\)\)\)/s,
  );
  assert.match(
    minimalStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.row-name-text\s*\{[^}]*animation:\s*none;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-row-wrap\.conversation-row-minimal \.thread-more-button\s*\{[^}]*right:\s*4px;[^}]*width:\s*28px;[^}]*height:\s*28px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-sticky\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*12;[^}]*padding:\s*0 6px;[^}]*background:\s*var\(--app-chrome-background\);[^}]*backdrop-filter:\s*none;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-sticky,\s*\.conversation-list-secondary-actions,\s*\.conversation-list-heading\s*\{[^}]*margin-right:\s*5px;[^}]*margin-left:\s*-5px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-action\.active\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-list-new-action\.active:is\(:hover, :focus-visible\),[\s\S]*background:\s*var\(--conversation-action-hover\);/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-thread-list > \.conversation-row-wrap\.conversation-row-minimal\s*\{[^}]*width:\s*calc\(100% - 19px\);[^}]*margin-right:\s*4px;[^}]*margin-left:\s*15px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-expand\s*\{[^}]*width:\s*calc\(100% - 19px\);[^}]*height:\s*32px;[^}]*margin:\s*0 4px 0 15px;[^}]*align-items:\s*center;[^}]*justify-content:\s*flex-start;[^}]*padding:\s*7px 12px;[^}]*line-height:\s*18px;[^}]*text-align:\s*left;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-section\s*\{[^}]*position:\s*relative;[^}]*left:\s*-6px;[^}]*padding-top:\s*0;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-section \.conversation-group-title\s*\{[^}]*position:\s*relative;[^}]*left:\s*2px;[^}]*height:\s*32px;/s,
  );
  assert.match(
    minimalStyles,
    /\.conversation-project-section \.conversation-group-toggle\s*\{[^}]*height:\s*32px;/s,
  );
});

test("minimal row hover, selected, focus, menu, and status states share light-dark tokens", async () => {
  const styles = await stylesSource;
  const lightTokens = sourceBlock(styles, ":root {", 'html[data-font-size="small"]');
  const darkTokens = sourceBlock(styles, 'html[data-theme="dark"] {', "* {");
  const minimalStyles = styles.slice(styles.indexOf("/* Codex-like conversation history:"));

  assert.match(lightTokens, /--surface-hover-translucent:/);
  assert.match(lightTokens, /--surface-active-translucent:/);
  assert.match(lightTokens, /--conversation-row-selected:\s*rgba\(17, 24, 39, 0\.05\)/);
  assert.match(lightTokens, /--border-translucent:/);
  assert.match(darkTokens, /--surface-hover-translucent:/);
  assert.match(darkTokens, /--surface-active-translucent:/);
  assert.match(darkTokens, /--conversation-row-selected:\s*rgba\(130, 159, 194, 0\.11\)/);
  assert.match(lightTokens, /--conversation-analysis-context:\s*#9a6700/);
  assert.match(darkTokens, /--conversation-analysis-context:\s*#ffd43b/);
  assert.match(darkTokens, /--border-translucent:/);
  assert.match(minimalStyles, /\.conversation-analysis-context\s*\{[^}]*color:\s*var\(--conversation-analysis-context\);[^}]*font-weight:\s*650;/s);
  assert.match(minimalStyles, /:hover,[\s\S]*:focus-within,[\s\S]*\.menu-open[\s\S]*background:\s*var\(--surface-hover-translucent\);/);
  assert.match(minimalStyles, /\.conversation-row-wrap\.conversation-row-minimal\.active\s*\{[^}]*background:\s*var\(--conversation-row-selected\);[^}]*box-shadow:\s*none;/s);
  assert.match(minimalStyles, /html\[data-theme="dark"\] \.conversation-row-wrap\.conversation-row-minimal\.active\s*\{[^}]*background:\s*var\(--conversation-row-selected\);/s);
  assert.match(minimalStyles, /\.conversation-row-wrap\.conversation-row-minimal\.active[\s\S]*\.conversation-copy-minimal[\s\S]*\.row-name\s*\{[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(minimalStyles, /\.conversation-row:focus-visible\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--border-translucent\);/s);
  assert.match(styles, /\.conversation-row-wrap:focus-within \.thread-more-button/);
  assert.match(minimalStyles, /\.thread-more-button:is\(:hover, :focus-visible, \.active\)\s*\{[^}]*background:\s*var\(--surface-hover-translucent\);[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(minimalStyles, /has-final-result-unviewed[\s\S]*background:\s*var\(--brand-blue\);/);
  assert.doesNotMatch(minimalStyles, /#[0-9a-f]{3,8}|rgba?\(/i);
});
