import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("plan-mode text and attachments remain linked to the visible blank session", async () => {
  const source = await rendererSource;
  const draftSnapshot = sourceBlock(
    source,
    "function activeComposerDraftSnapshot",
    "function applyQuestionAnswerDefaultModelToDraft",
  );
  const modeSwitch = sourceBlock(
    source,
    "async function switchNewThreadMode",
    "async function switchComposerClusterMode",
  );
  const threadSelection = sourceBlock(
    source,
    "async function selectThread",
    "function selectAutoTaskThread",
  );
  const providerSelection = sourceBlock(
    source,
    "function selectProviderThread",
    "function providerChatRecordsFromState",
  );

  assert.match(draftSnapshot, /text:\s*composerInputTextForThread\(threadId\)/);
  assert.match(draftSnapshot, /attachments:\s*cloneLocalAttachments\(state\.attachments\)/);
  assert.match(
    modeSwitch,
    /linkProviderDraftToBlankThread\(sourceThreadId,\s*targetThreadId\)[\s\S]*setComposerDraft\(targetThreadId,\s*providerDraft\)[\s\S]*restoreComposerDraftForThread\(targetThreadId\)/,
  );
  assert.match(
    threadSelection,
    /if \(isBlankNewThread\(threadId\)\) \{[\s\S]*providerDraftForBlankThread\(threadId\)[\s\S]*selectProviderThread\(providerDraftThreadId\)/,
  );
  assert.match(providerSelection, /restoreComposerDraftForThread\(threadId\)/);
});

test("blank sessions retain their selected mode instead of resetting on return", async () => {
  const source = await rendererSource;
  const threadSelection = sourceBlock(
    source,
    "async function selectThread",
    "function selectAutoTaskThread",
  );
  const startNewThread = sourceBlock(
    source,
    "async function startNewThread",
    "async function createBlankThreadForList",
  );
  const modeSwitch = sourceBlock(
    source,
    "async function switchNewThreadMode",
    "async function switchComposerClusterMode",
  );

  assert.doesNotMatch(
    threadSelection,
    /newThreadModeByThreadId\.set\(threadId,\s*"execution"\)/,
  );
  assert.doesNotMatch(
    startNewThread,
    /newThreadModeByThreadId\.set\([^,]+,\s*"execution"\)/,
  );
  assert.match(
    startNewThread,
    /providerDraftForBlankThread\(blankThread\.id\)[\s\S]*selectProviderThread\(providerDraftThreadId\)/,
  );
  assert.match(
    modeSwitch,
    /newThreadModeByThreadId\.set\(sourceThreadId,\s*mode\)[\s\S]*saveThreadPreferences\(\)/,
  );
});

test("plan draft links drive row selection and are cleared when the draft is consumed", async () => {
  const source = await rendererSource;
  const activeRow = sourceBlock(
    source,
    "function isActiveThreadRow",
    "function renderContactRequestList",
  );
  const providerUpsert = sourceBlock(
    source,
    "function upsertProviderThread",
    "async function restoreProviderChatThreads",
  );
  const hideThread = sourceBlock(
    source,
    "function hideUnavailableThread",
    "async function startNewThread",
  );

  assert.match(
    activeRow,
    /blankThreadIdByProviderDraftThreadId\.get\(state\.currentThreadId\) === threadId/,
  );
  assert.match(
    providerUpsert,
    /if \(materialized\) \{[\s\S]*providerDraftThreadIds\.delete\(threadId\)[\s\S]*unlinkProviderDraftFromBlankThread\(threadId\)/,
  );
  assert.match(hideThread, /unlinkBlankThreadFromProviderDraft\(threadId\)/);
  assert.match(hideThread, /unlinkProviderDraftFromBlankThread\(threadId\)/);
});

test("inactive draft text is retained without adding a preview line to the sticky new-conversation action", async () => {
  const [source, styles] = await Promise.all([rendererSource, stylesSource]);
  const row = sourceBlock(
    source,
    "function renderThreadRow(thread: ConversationSummary)",
    "function threadComposerDraftPreview",
  );
  const draftPreview = sourceBlock(
    source,
    "function threadComposerDraftPreview",
    "function renderThreadHistoryPopover",
  );
  const actions = sourceBlock(
    source,
    "function renderConversationListActions",
    "function renderChatList",
  );

  assert.match(
    row,
    /const draftPreview = active \? null : threadComposerDraftPreview\(thread\.id\)/,
  );
  assert.match(
    draftPreview,
    /const draftThreadId = providerDraftForBlankThread\(threadId\) \|\| threadId/,
  );
  assert.match(draftPreview, /state\.composerDrafts\[draftThreadId\]/);
  assert.match(draftPreview, /const plain = `\[草稿\]\$\{text\}\$\{attachmentLabel\}`/);
  assert.match(actions, /<span>新任务<\/span>/);
  assert.doesNotMatch(actions, /draftPreview|row-preview|草稿/);
  assert.doesNotMatch(styles, /row-preview-draft-label/);
});
