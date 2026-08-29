import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const styleSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("blank-thread title includes the selected non-default group", async () => {
  const source = await rendererSource;
  const hero = sourceBlock(source, "function renderBlankThreadHero", "function renderMessage");

  assert.match(hero, /function renderBlankThreadHero\(threadId: string\)/);
  assert.match(hero, /groupIdForThreadContext\(threadId\)/);
  assert.match(hero, /!isDefaultThreadGroup\(activeGroup\.id\)/);
  assert.match(hero, /\u6211\u4eec\u8981\u505a\u4e9b\u4ec0\u4e48？/);
  assert.match(hero, /class="new-thread-hero-group"/);
  assert.match(hero, /data-new-thread-group-picker-anchor="hero"/);
  assert.match(hero, /data-new-thread-group-picker-thread-id="\$\{escapeAttr\(threadId\)\}"/);
  assert.match(hero, /renderNewThreadGroupPickerMenuContent\(selectedGroup\)/);
  assert.match(hero, /state\.newThreadGroupPickerAnchor === "hero"/);
  assert.match(hero, /aria-label="\$\{escapeHtml\(heroLabel\)\}"/);
});

test("selected group name is clickable and its picker opens above the text", async () => {
  const source = await styleSource;
  const groupStyle = sourceBlock(source, ".new-thread-hero-group {", "@media (max-width: 760px)");

  assert.match(groupStyle, /cursor:\s*pointer/);
  assert.match(groupStyle, /text-decoration-line:\s*underline/);
  assert.match(groupStyle, /text-decoration-style:\s*dotted/);
  assert.match(groupStyle, /text-underline-offset:\s*5px/);
  assert.match(groupStyle, /\.new-thread-hero-group-menu\s*\{[^}]*bottom:\s*calc\(100% \+ 10px\)/s);
  assert.match(groupStyle, /\.new-thread-hero-group-menu\s*\{[^}]*left:\s*50%/s);
  assert.match(groupStyle, /transform:\s*translateX\(-50%\)/);
  assert.match(
    groupStyle,
    /\.new-thread-hero-group-menu \.thread-group-add-submenu\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*-7px;[^}]*transform:\s*none;/s,
  );
});

test("blank-thread mode shortcuts move from the hero into the composer toolbar", async () => {
  const source = await rendererSource;
  const hero = sourceBlock(source, "function renderBlankThreadHero", "function renderMessage");
  const composer = sourceBlock(source, "function renderComposer(thread", "function renderVideoExpertComposer");

  assert.doesNotMatch(hero, /new-thread-mode-switch|data-new-thread-mode/);
  assert.match(
    composer,
    /const composerModePicker = blankNewThread\s*\? renderComposerModePicker\(thread\.id\)/,
  );
  assert.match(
    composer,
    /data-action="pick-files"[\s\S]*\$\{composerModePicker\}[\s\S]*renderImageGenerationParameterPickers/,
  );
});

test("new-thread title uses the reduced desktop and narrow-width sizes", async () => {
  const source = await styleSource;
  const desktopTitleStyle = sourceBlock(source, ".new-thread-hero-title {", ".new-thread-hero-title > span");
  const narrowLayoutStart = source.indexOf("@media (max-width: 760px)", source.indexOf(".new-thread-hero-title {"));
  assert.notEqual(narrowLayoutStart, -1, "missing narrow new-thread layout");
  const narrowLayout = source.slice(narrowLayoutStart, source.indexOf(".message-avatar", narrowLayoutStart));

  assert.match(desktopTitleStyle, /font-size:\s*calc\(24px \+ var\(--app-font-size-offset\)\)/);
  assert.match(narrowLayout, /\.new-thread-hero-title\s*\{[^}]*font-size:\s*calc\(20px \+ var\(--app-font-size-offset\)\)/s);
});

test("composer mode selector keeps long first-level and second-level labels compact", async () => {
  const source = await styleSource;
  const pickerStyle = sourceBlock(source, ".composer-mode-trigger {", ".composer-mode-trigger:hover");

  assert.match(pickerStyle, /max-width:\s*196px/);
  assert.match(pickerStyle, /height:\s*28px/);
  assert.match(source, /\.composer-mode-trigger > span\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
});
