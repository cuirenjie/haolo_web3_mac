import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const mainSource = fs.readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("prepared group context validates the public group id before an internal Agent thread id", async () => {
  const source = await mainSource;
  const validator = sourceBlock(
    source,
    "function preparedGroupChatContextForRequest",
    'ipcMain.handle("youle:prepareGroupChatContext"',
  );

  assert.match(
    validator,
    /params\.groupChatThreadId[\s\S]*params\.conversationId[\s\S]*params\.threadId/,
  );
});

test("Haolo semantically plans and prepares an isolated context for every group member", async () => {
  const source = await mainSource;
  const validator = sourceBlock(
    source,
    "function preparedGroupChatContextForRequest",
    'ipcMain.handle("youle:prepareGroupChatContext"',
  );
  const preparation = sourceBlock(
    source,
    'ipcMain.handle("youle:prepareGroupChatContext"',
    'ipcMain.handle("youle:sendProviderChat"',
  );

  assert.match(validator, /prepared\.memberContexts\.get\(memberId\)/);
  assert.match(validator, /allowedHistoryMemberIds/);
  assert.match(validator, /requiredHistoryTurnIds/);
  assert.match(validator, /currentText:\s*assignment\.taskPrompt/);
  assert.match(
    validator,
    /providerMessagesWithQuestionAnswerConversationPlan\([\s\S]*requiredTurnIds:\s*requiredHistoryTurnIds/,
  );
  assert.match(validator, /groupChatMemberIdentitySystemMessage\(/);
  assert.match(
    validator,
    /groupChatCoordinatorContextText\(\s*groupChatMessagesWithoutCurrentUser\(memberProviderMessages\)/,
  );
  assert.match(preparation, /getGroupChatTaskPlanner\(\)\.plan\(/);
  assert.match(preparation, /taskPlan\.assignments\.map\(async \(taskAssignment\)/);
  assert.match(preparation, /currentText:\s*taskAssignment\.taskPrompt/);
  assert.match(preparation, /requiredHistoryTurnIds:\s*taskAssignment\.historyTurnIds/);
  assert.match(preparation, /text:\s*taskAssignment\.taskPrompt/);
  assert.match(preparation, /prepareQuestionAnswerFileContext\(questionAnswerParams,\s*cwd\)/);
  assert.match(preparation, /memberContexts:\s*new Map/);
  assert.doesNotMatch(preparation, /params\.includeOtherMemberHistory/);
  assert.doesNotMatch(preparation, /coordinatorContextText:\s*groupChatCoordinatorContextText\(providerMessages\)/);
});

test("provider and Haolo sends are bound to the stored semantic member prompt", async () => {
  const source = await mainSource;
  const providerSend = sourceBlock(
    source,
    'ipcMain.handle("youle:sendProviderChat"',
    'ipcMain.handle("youle:interruptProviderChat"',
  );
  const codexSend = sourceBlock(
    source,
    'ipcMain.handle("codex:sendMessage"',
    'ipcMain.handle("codex:interruptTurn"',
  );

  assert.match(
    providerSend,
    /text:\s*groupChatContext[\s\S]*groupChatContext\.assignment\.taskPrompt/,
  );
  assert.match(
    codexSend,
    /groupChatContext\?\.assignment\?\.taskPrompt \|\| params\.text/,
  );
});

test("question-answer, local group, and cluster context preparation reuse the isolated Haolo source agent", async () => {
  const source = await mainSource;
  const collector = sourceBlock(
    source,
    "async function runInternalHaoloReadOnlyContextStep",
    "async function executeClusterRootFinal",
  );

  assert.match(source, /contextCollector:\s*runInternalHaoloReadOnlyContextStep/g);
  assert.match(collector, /Haolo's existing local source-context agent/);
  assert.match(collector, /Presentations, documents, spreadsheets, and PDF skills/);
  assert.match(collector, /Recursively inspect an authorized folder/);
  assert.match(collector, /createHaoloContextScratchWorkspace/);
  assert.match(collector, /sandboxPolicy:\s*"workspace-write"/);
  assert.match(collector, /PresentationFile\.importPptx plus presentation\.inspect/);
  assert.match(collector, /Do not replace the Presentations skill with Python zipfile/);
  assert.match(collector, /parseHaoloContextEnvelope/);
  assert.match(
    collector,
    /internalCleanup\s*=\s*scheduleWorkflowInternalCodexCleanup[\s\S]*await internalCleanup[\s\S]*await cleanupHaoloContextScratchWorkspace/,
  );
  assert.match(
    collector,
    /async function cleanupHaoloContextScratchWorkspace[\s\S]*fs\.promises\.rm[\s\S]*errorMessageText\(error\)/,
  );
  assert.doesNotMatch(collector, /errorText\(error\)/);
  assert.match(collector, /Do not answer the user's task/);
  assert.match(collector, /Runtime workflow dependency outputs[\s\S]*are not local files/);
  assert.match(collector, /runtimeDependencies:[\s\S]*excludedFromAuthorizedLocalSource:\s*true/);
  assert.match(collector, /Do not look for runtime dependency outputs or conversation messages in the source root/);
});
