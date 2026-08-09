import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPOSER_PASTE_TEXT_FILE_NAME,
  COMPOSER_PASTE_TEXT_FILE_NOTICE,
  COMPOSER_PASTE_TEXT_FILE_THRESHOLD_CHARS,
  createComposerPastedTextFile,
  shouldConvertComposerPastedTextToFile,
} from "../src/renderer/composer-paste.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, "missing start marker: " + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, "missing end marker: " + endMarker);
  return source.slice(start, end);
}

test("large composer paste threshold is conservative and inclusive", () => {
  assert.equal(COMPOSER_PASTE_TEXT_FILE_THRESHOLD_CHARS, 10_000);
  assert.equal(shouldConvertComposerPastedTextToFile("a".repeat(9_999)), false);
  assert.equal(shouldConvertComposerPastedTextToFile("a".repeat(10_000)), true);
});

test("large pasted text becomes an exact UTF-8 text attachment", async () => {
  const text = "第一行\nconst answer = 42;\n最后一行";
  const file = createComposerPastedTextFile(text, 123);

  assert.equal(COMPOSER_PASTE_TEXT_FILE_NAME, "用户粘贴内容.txt");
  assert.equal(COMPOSER_PASTE_TEXT_FILE_NOTICE, "粘贴内容过多，已转为TXT文档");
  assert.equal(file.name, COMPOSER_PASTE_TEXT_FILE_NAME);
  assert.equal(file.type, "text/plain");
  assert.equal(file.lastModified, 123);
  assert.equal(await file.text(), text);
});

test("composer intercepts a large paste before native insertion and also covers async clipboard reads", async () => {
  const source = await rendererSource;
  const handler = sourceBlock(source, "function handleComposerPaste", "function canQueuePastedTextAttachment");
  const asyncPaste = sourceBlock(source, "async function pasteIntoComposer", "async function pasteIntoComposerFromContextMenu");

  assert.match(handler, /clipboardData\?\.getData\("text\/plain"\)/);
  assert.match(handler, /shouldConvertComposerPastedTextToFile\(pastedText\)/);
  assert.match(handler, /event\.preventDefault\(\);\s*queueLargePastedTextAsAttachment\(pastedText\)/);
  assert.ok(
    handler.indexOf("shouldConvertComposerPastedTextToFile(pastedText)") < handler.indexOf("if (!api.readClipboardForComposer)"),
    "large text should be intercepted before the native/API fallback",
  );

  assert.match(asyncPaste, /queueLargePastedTextAsAttachment\(pastedText\)/);
  assert.ok(
    asyncPaste.indexOf("queueLargePastedTextAsAttachment(pastedText)") < asyncPaste.indexOf("insertTextIntoComposer(currentInput, text)"),
    "async clipboard text should be converted before textarea insertion",
  );
});

test("composer attachment upload area has ten more pixels of top spacing", async () => {
  const styles = await stylesSource;
  assert.match(
    styles,
    /\.pending-attachments-wrap\s*\{[^}]*margin-top:\s*3px;/,
  );
  assert.doesNotMatch(
    styles,
    /\.pending-attachments-wrap\s*\{[^}]*margin-top:\s*-7px;/,
  );
});
