import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("auto task detail cards show the owning folder group with the composer pill style", async () => {
  const source = await mainSource;
  const pageBlock = sourceBlock(
    source,
    "function renderAutoTaskDetailPage",
    "function renderAutoTaskDetailMessages",
  );
  const chatCardBlock = sourceBlock(
    source,
    "function renderAutoTaskChatCard",
    "function renderAutoTaskGroupPill",
  );
  const pillBlock = sourceBlock(
    source,
    "function renderAutoTaskGroupPill",
    "function renderMessageScrollerContent",
  );

  assert.match(pageBlock, /renderAutoTaskGroupPill\(task\)/);
  assert.match(chatCardBlock, /renderAutoTaskGroupPill\(task\)/);
  assert.match(pillBlock, /knownThreadGroupId\(task\.groupId\)/);
  assert.match(pillBlock, /threadGroupDisplayLabel\(selectedGroup\)/);
  assert.match(
    pillBlock,
    /composer-group-picker readonly auto-task-group-pill/,
  );
  assert.match(pillBlock, /HOME_ICON_URL\.folder/);

  const styles = await stylesSource;
  assert.match(
    styles,
    /\.auto-task-detail-meta\s*\{[\s\S]*display: flex;[\s\S]*align-items: center;/,
  );
  assert.match(
    styles,
    /\.auto-task-detail-meta \.auto-task-group-pill\s*\{[\s\S]*margin-left: 0;[\s\S]*transform: none;/,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.composer-group-picker \.chat-title-group-button img/,
  );
});

test("confirming a created or edited auto task expands only its owning group", async () => {
  const source = await mainSource;
  const submitBlock = sourceBlock(
    source,
    "async function submitAutoTaskForm",
    "function startChatPreviewResize",
  );

  assert.match(
    submitBlock,
    /const existing = draft\.id \? state\.autoTaskItems\.find/,
  );
  assert.match(
    submitBlock,
    /const savedTask = state\.autoTaskItems\.find[\s\S]*focusThreadGroupInConversationList\(savedTask\.groupId\);[\s\S]*saveThreadPreferences\(\);/,
  );
});
