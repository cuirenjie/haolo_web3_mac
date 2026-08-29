import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMPOSER_FOLDER_MIME,
  composerFolderAttachment,
  composerFolderContextInstruction,
  isComposerFolderAttachment,
} from "../src/renderer/composer-folder.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("folder attachments stay local and are immediately ready to send", () => {
  const attachment = composerFolderAttachment(
    { path: "C:\\Users\\Joie\\Desktop\\资料\\", name: "资料" },
    "folder-1",
  );

  assert.equal(attachment.mime, COMPOSER_FOLDER_MIME);
  assert.equal(attachment.local_path, "C:\\Users\\Joie\\Desktop\\资料\\");
  assert.equal(attachment.path, attachment.local_path);
  assert.equal(attachment.uploadStatus, "uploaded");
  assert.equal(attachment.url, null);
  assert.equal(attachment.object_key, null);
  assert.equal(isComposerFolderAttachment(attachment), true);
  assert.equal(isComposerFolderAttachment({ mime: "text/plain" }), false);
});

test("folder context explicitly requires recursive reading before task execution", () => {
  const instruction = composerFolderContextInstruction(2);

  assert.match(instruction, /2 个本地文件夹/);
  assert.match(instruction, /递归读取/);
  assert.match(instruction, /所有子文件夹/);
  assert.match(instruction, /全部可读文件内容/);
  assert.match(instruction, /作为本次任务的上下文/);
});

test("folder drops queue into every analysis composer instead of importing a thread group", async () => {
  const source = await rendererSource;
  const dropHandler = sourceBlock(source, "async function handleComposerDrop", "function focusComposerInputAfterDrop");
  const folderHandler = sourceBlock(source, "async function queueDroppedFolders", "async function filesFromDroppedLocalPaths");

  assert.match(dropHandler, /queueDroppedFolders\(dropped\.paths\)/);
  assert.doesNotMatch(dropHandler, /importDroppedThreadGroupFolder/);
  assert.match(folderHandler, /queueFolders\(folders\)/);
  assert.doesNotMatch(folderHandler, /isQuestionAnswerThreadId\(threadId\)/);
  assert.doesNotMatch(folderHandler, /计划模式暂不支持上传文件夹/);
  assert.doesNotMatch(folderHandler, /importThreadGroupFolderPath|导入文件夹分组成功/);
});

test("question-answer mode preserves and sends a queued folder", async () => {
  const source = await rendererSource;
  const modeSwitch = sourceBlock(source, "async function switchNewThreadMode", "function renderBlankThreadHero");
  const sendHandler = sourceBlock(source, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");

  assert.match(modeSwitch, /const supportedAttachments = draft\.attachments/);
  assert.doesNotMatch(modeSwitch, /attachments\.filter\(\(attachment\) => !isComposerFolderAttachment\(attachment\)\)/);
  assert.doesNotMatch(sendHandler, /isQuestionAnswerThreadId\(threadId\) && state\.attachments\.some\(isComposerFolderAttachment\)/);
  assert.match(source, /explicitPaths:\s*params\.readyAttachments/);
});

test("folder attachments can be pasted globally without restoring a folder picker", async () => {
  const [renderer, main] = await Promise.all([rendererSource, mainSource]);
  const pasteHandler = sourceBlock(renderer, "async function pasteIntoComposer", "async function pasteIntoComposerFromContextMenu");
  const mainClipboard = sourceBlock(main, "async function readClipboardForComposer", "function clipboardFilePaths");
  const clipboardFolders = sourceBlock(renderer, "function composerClipboardFolders", "function hasComposerClipboardAttachments");
  const clipboardAttachments = sourceBlock(renderer, "function hasComposerClipboardAttachments", "function fileFromComposerClipboardFile");

  assert.match(pasteHandler, /const folders = composerClipboardFolders\(payload\)/);
  assert.match(pasteHandler, /const handledFolders = queueComposerFolders\(folders\)/);
  assert.match(pasteHandler, /if \(handledFolders \|\| files\.length\)/);
  assert.match(pasteHandler, /focusComposerInputAfterDrop\(\)/);
  assert.doesNotMatch(pasteHandler, /isQuestionAnswerThreadId|isLocalGroupChatThread|isClusterModeThread/);
  assert.match(clipboardFolders, /folderNameFromPath\(folderPath\)/);
  assert.match(clipboardAttachments, /composerClipboardFolders\(payload\)\.length > 0/);
  assert.match(mainClipboard, /localPathInfo\(\{ path: filePath \}\)/);
  assert.match(mainClipboard, /if \(info\.isDirectory\) \{\s*folders\.push\(\{ path: info\.path, name: info\.name \}\)/);
  assert.match(mainClipboard, /return \{ type: "files", files, folders \}/);
});

test("the composer attachment picker routes selected files and folders through the normal queues", async () => {
  const source = await rendererSource;
  const picker = sourceBlock(
    source,
    "async function pickComposerFilesAndFolders",
    "function queueComposerFolders",
  );

  assert.match(source, /data-action="pick-composer-files-and-folders"/);
  assert.match(picker, /api\.pickComposerFilesAndFolders\(\)/);
  assert.match(picker, /queueDroppedFolders\(paths\)/);
  assert.match(picker, /filesFromDroppedLocalPaths\(paths\)/);
  assert.match(picker, /if \(files\.length\) queueFiles\(files\)/);
  assert.match(picker, /focusComposerInputAfterDrop\(\)/);
});

test("composer folder card follows the compact reference layout", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const pendingAttachment = sourceBlock(source, "function renderPendingAttachment", "function renderAgentPanel");

  assert.match(pendingAttachment, /pending-file pending-folder/);
  assert.match(pendingAttachment, /pending-folder-icon/);
  assert.match(pendingAttachment, /COMPOSER_FOLDER_TYPE_LABEL/);
  assert.match(styles, /\.pending-folder\s*\{[^}]*width:\s*180px;[^}]*height:\s*52px;[^}]*border-radius:\s*12px;/s);
  assert.doesNotMatch(styles, /\.pending-folder > \[data-remove-attachment\]/);
  assert.match(styles, /\.pending-file button\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
});
