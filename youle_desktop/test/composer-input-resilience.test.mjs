import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("composer keyboard shortcuts ignore active IME composition", async () => {
  const source = await rendererSource;
  const keydown = sourceBlock(
    source,
    '.querySelector<HTMLTextAreaElement>("#composerInput")\n    ?.addEventListener("keydown"',
    '?.addEventListener("input", (event) => {',
  );

  assert.match(
    keydown,
    /if \(event\.isComposing \|\| composerComposing \|\| event\.keyCode === 229\)/,
  );
  assert.ok(
    keydown.indexOf("event.isComposing") <
      keydown.indexOf("handleComposerSkillMentionKeydown(event)"),
    "IME guard must run before mention and Enter shortcuts",
  );
  assert.ok(
    keydown.indexOf("event.isComposing") <
      keydown.indexOf('event.key === "Enter" && !event.shiftKey'),
    "IME guard must run before the send shortcut",
  );
});

test("async composer paste revalidates and reacquires its target input", async () => {
  const source = await rendererSource;
  const paste = sourceBlock(
    source,
    "async function pasteIntoComposer",
    "async function pasteIntoComposerFromContextMenu",
  );

  assert.match(paste, /const targetThreadId = firstString\(/);
  assert.match(paste, /const payload = await readComposerClipboardPayload/);
  assert.match(
    paste,
    /const currentInput = root\.querySelector<HTMLTextAreaElement>\("#composerInput"\)/,
  );
  assert.match(paste, /if \(!currentInput \|\| currentThreadId !== targetThreadId\)/);
  assert.match(paste, /if \(currentInput !== input && currentInput\.value === targetValue\)/);
  assert.match(paste, /insertTextIntoComposer\(currentInput, text\)/);
});

test("late send completion cannot clear a newer composer draft", async () => {
  const source = await rendererSource;
  const supplement = sourceBlock(
    source,
    "async function sendConversationSupplementFromComposer",
    "async function steerConversationSupplement",
  );
  const video = sourceBlock(
    source,
    "async function sendCurrentVideoExpertMessage",
    "function videoAttachmentFromGenerationResult",
  );

  assert.match(
    supplement,
    /const submittedComposerValue = input\?\.value \?\? state\.composerText/,
  );
  assert.match(
    supplement,
    /const composerStillShowsSubmission =[\s\S]*\(activeInput\?\.value \?\? state\.composerText\) === submittedComposerValue/,
  );
  assert.match(
    supplement,
    /else if \(composerStillShowsSubmission\)[\s\S]*state\.composerText = ""/,
  );
  assert.match(supplement, /else \{\s*rememberActiveComposerDraft\(\)/);
  assert.match(
    video,
    /if \(!params\.pendingLocalItemId\) \{[\s\S]*state\.composerText = ""/,
  );
});
