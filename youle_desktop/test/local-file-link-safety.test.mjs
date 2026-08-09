import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { messageLocalPathContinuationLooksLikeProse } from "../src/renderer/message-local-path.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rendererSource = await fs.readFile(path.resolve(testDir, "../src/renderer/main.ts"), "utf8");
const stylesSource = await fs.readFile(path.resolve(testDir, "../src/renderer/styles.css"), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

test("generated file attachments are shown only after the file is verified", () => {
  assert.match(rendererSource, /if \(info\?\.status !== "ready"\) return false;/);
  assert.match(rendererSource, /url: info\.path \|\| url/);
  assert.match(rendererSource, /const info = ensureLocalFileInfo\(url\)/);
});

test("message paths accept directories without weakening generated-file verification", () => {
  const messageLookup = sourceBlock(
    rendererSource,
    "function ensureLocalMessagePathInfo",
    "function generatedFileMimeFromPath",
  );
  const messageRender = sourceBlock(
    rendererSource,
    "function renderMessageLocalPath",
    "function isMarkdownTableStart",
  );

  assert.match(messageLookup, /api\.localPathInfo/);
  assert.match(messageLookup, /message-path:\$\{url\}/);
  assert.match(messageRender, /ensureLocalMessagePathInfo\(normalizedPath\)/);
  assert.match(rendererSource, /function ensureLocalFileInfo[\s\S]*?api\s*\.localFileInfo/);
});

test("missing or overmatched message paths fall back to neutral text", () => {
  const messageRender = sourceBlock(
    rendererSource,
    "function renderMessageLocalPath",
    "function isMarkdownTableStart",
  );

  assert.match(messageRender, /if \(info\?\.status === "error"\) return escapeHtml\(displayText \|\| pathText\)/);
  assert.match(messageRender, /class="\$\{escapeAttr\(`\$\{classes\} is-checking`\)\}"/);
  assert.match(rendererSource, /data-message-local-path="\$\{escapeAttr\(info\.path \|\| normalizedPath\)\}"/);
  assert.doesNotMatch(messageRender, /is-missing/);
  assert.doesNotMatch(stylesSource, /message-local-path\.is-missing/);
});

test("unquoted paths stop before colon-style natural-language instructions", () => {
  const continuation = sourceBlock(
    rendererSource,
    "function messageLocalPathContinuationEnd",
    "function cleanMessageLocalPath",
  );

  assert.match(
    continuation,
    /messageLocalPathContinuationLooksLikeProse\(cleanMessageLocalPath\(parts\[trailingIndex\]\.token\)\)/,
  );
  assert.equal(messageLocalPathContinuationLooksLikeProse("读取这个剧本："), true);
  assert.equal(messageLocalPathContinuationLooksLikeProse("读取这个剧本：一张图纸的力量，继续处理"), true);
  assert.equal(messageLocalPathContinuationLooksLikeProse("阶段：二"), false);
  assert.equal(messageLocalPathContinuationLooksLikeProse("角色提示词"), false);
});

test("local file actions include the active workspace for relocation recovery", () => {
  assert.match(rendererSource, /\.localFileInfo\(\{ path: url, cwd: threadWorkspaceCwd\(state\.currentThreadId\) \}\)/);
  assert.match(rendererSource, /\.localPathInfo\(\{ path: url, cwd: threadWorkspaceCwd\(state\.currentThreadId\) \}\)/);
  assert.match(rendererSource, /\.openLocalFile\(\{ path: file\.url, cwd: threadWorkspaceCwd\(state\.currentThreadId\) \}\)/);
  assert.match(rendererSource, /\.revealLocalFile\(\{ path: localPath, cwd: threadWorkspaceCwd\(state\.currentThreadId\) \}\)/);
});

test("checking paths keep a distinct non-interactive state in light and dark themes", () => {
  assert.match(stylesSource, /\.message-local-path\.is-checking\s*\{[^}]*cursor:\s*default;[^}]*opacity:\s*0\.72;/s);
  assert.match(
    stylesSource,
    /html\[data-theme="dark"\] \.message-local-path\.is-checking,\s*html\[data-theme="dark"\] \.message-local-path\.is-checking:hover\s*\{[^}]*background:[^;]+;[^}]*color:\s*var\(--text-tertiary\);/s,
  );
});
