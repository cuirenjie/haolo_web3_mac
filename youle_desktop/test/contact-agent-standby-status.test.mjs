import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source block start: ${start}`);
  assert.notEqual(endIndex, -1, `missing source block end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("unavailable model contacts display standby instead of a connection error", async () => {
  const source = await rendererSource;
  const statusBlock = sourceBlock(
    source,
    "function effectiveContactStatus",
    "function authenticatedProviderAvailable",
  );
  const toneBlock = sourceBlock(
    source,
    "function contactStatusTone",
    "function isStandbyAgentContact",
  );

  assert.match(
    statusBlock,
    /state\.providerModelCatalog\.loading \|\| !state\.providerModelCatalog\.loaded[\s\S]*\? "检测中"[\s\S]*: "待机"/,
  );
  assert.match(
    statusBlock,
    /entry\.status === "error"[\s\S]*entry\.models\.length > 0 \? "在线" : "待机"/,
  );
  assert.match(statusBlock, /status === "连接异常" \? "待机" : status/);
  assert.doesNotMatch(statusBlock, /return "连接异常"/);
  assert.match(
    toneBlock,
    /normalized === "待机" \|\| normalized === "连接异常"\) return "standby"/,
  );
  assert.doesNotMatch(toneBlock, /return "error"/);
});

test("standby dots use theme-aware yellow in contact and group-chat lists", async () => {
  const styles = await stylesSource;

  assert.match(styles, /:root\s*\{[\s\S]*--contact-status-standby:\s*#c18400/);
  assert.match(
    styles,
    /html\[data-theme="dark"\]\s*\{[\s\S]*--contact-status-standby:\s*#facc15/,
  );
  assert.match(
    styles,
    /\.contact-row small i\.standby,\s*\.contact-row small i\.error\s*\{[\s\S]*background:\s*var\(--contact-status-standby\)/,
  );
  assert.match(
    styles,
    /\.group-chat-option-copy small i\.standby,\s*\.group-chat-option-copy small i\.error\s*\{[\s\S]*background:\s*var\(--contact-status-standby\)/,
  );
});
