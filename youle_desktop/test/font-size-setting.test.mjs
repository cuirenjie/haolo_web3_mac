import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("font size preference restores before desktop boot and defaults safely", async () => {
  const source = await rendererSource;
  const initialization = sourceBlock(source, "function loadAppFontSize", "ensureBrowserDesktopApi();");

  assert.match(source, /const APP_FONT_SIZE_STORAGE_KEY = "haolo\.appearance\.font_size"/);
  assert.match(source, /type AppFontSize = "small" \| "default" \| "medium" \| "large"/);
  assert.match(initialization, /localStorage\.getItem\(APP_FONT_SIZE_STORAGE_KEY\)/);
  assert.match(initialization, /return isAppFontSize\(value\) \? value : "default"/);
  assert.match(initialization, /catch \{\s*return "default";/s);
  assert.match(initialization, /const INITIAL_APP_FONT_SIZE = loadAppFontSize\(\);\s*applyAppFontSize\(INITIAL_APP_FONT_SIZE\);/s);
  assert.ok(source.indexOf("applyAppFontSize(INITIAL_APP_FONT_SIZE);") < source.indexOf("void boot();"));
});

test("selecting a font size applies it globally, persists it, and updates settings state", async () => {
  const source = await rendererSource;
  const applyBlock = sourceBlock(source, "function applyAppFontSize", "const INITIAL_APP_THEME");
  const selectBlock = sourceBlock(source, "function selectAppFontSize", "function showContactRequestSent");

  assert.match(applyBlock, /document\.documentElement\.dataset\.fontSize = fontSize/);
  assert.match(applyBlock, /localStorage\.setItem\(APP_FONT_SIZE_STORAGE_KEY, fontSize\)/);
  assert.match(selectBlock, /state\.settings\.fontSize = fontSize/);
  assert.match(selectBlock, /applyAppFontSize\(fontSize, true\)/);
  assert.match(selectBlock, /render\(\)/);
});

test("general settings renders four clickable nodes below theme appearance", async () => {
  const source = await rendererSource;
  const dialogBlock = sourceBlock(source, "function renderSettingsDialog", "function renderSettingsUserDataRow");
  const selectorBlock = sourceBlock(source, "function renderSettingsFontSizeRow", "function renderSettingsTaskCompletionPopupRow");
  const eventBlock = sourceBlock(source, "function bindEvents", "function openChannelDialog");

  const themeIndex = dialogBlock.indexOf("renderSettingsThemeRow()");
  const fontSizeIndex = dialogBlock.indexOf("renderSettingsFontSizeRow()");
  const storageIndex = dialogBlock.indexOf('class="settings-storage-row"');
  assert.ok(themeIndex < fontSizeIndex && fontSizeIndex < storageIndex);
  assert.match(source, /value: "small", label: "小"/);
  assert.match(source, /value: "default", label: "默认"/);
  assert.match(source, /value: "medium", label: "中"/);
  assert.match(source, /value: "large", label: "大"/);
  assert.match(selectorBlock, /role="radiogroup"/);
  assert.match(selectorBlock, /role="radio"/);
  assert.match(selectorBlock, /aria-checked=/);
  assert.match(eventBlock, /data-settings-font-size/);
  assert.match(eventBlock, /isAppFontSize\(fontSize\)/);
  assert.match(eventBlock, /selectAppFontSize\(fontSize\)/);
});

test("all fixed pixel font sizes share the selected additive offset", async () => {
  const styles = await stylesSource;
  const adjustedDeclarations = styles.match(/font-size:\s*calc\([0-9.]+px \+ var\(--app-font-size-offset\)\);/g) || [];

  assert.match(styles, /--app-font-size-offset: 0px/);
  assert.match(styles, /html\[data-font-size="small"\][\s\S]*--app-font-size-offset: -1px/);
  assert.match(styles, /html\[data-font-size="medium"\][\s\S]*--app-font-size-offset: 1px/);
  assert.match(styles, /html\[data-font-size="large"\][\s\S]*--app-font-size-offset: 2px/);
  assert.ok(adjustedDeclarations.length >= 400, `expected broad font-size coverage, found ${adjustedDeclarations.length}`);
  assert.doesNotMatch(styles, /font-size:\s*[0-9.]+px;/);
  assert.match(styles, /\.settings-font-size-options::before[\s\S]*\.settings-font-size-node/);
  assert.match(
    styles,
    /\.settings-font-size-options\s*\{[^}]*width:\s*224px;[^}]*margin-left:\s*auto;[^}]*transform:\s*translateX\(12\.5%\)/,
  );
  assert.match(
    styles,
    /\.settings-font-size-node\s*\{[^}]*width:\s*1px;[^}]*height:\s*5px;[^}]*margin-top:\s*3px;[^}]*background:\s*var\(--text-tertiary\);/,
  );
  assert.doesNotMatch(styles, /\.settings-font-size-option:hover:not\(\.active\) \.settings-font-size-node/);
  assert.match(styles, /\.settings-font-size-option\.active \.settings-font-size-node/);
  assert.match(
    styles,
    /\.settings-font-size-option\.active \.settings-font-size-label\s*\{[\s\S]*font-weight: 500;/,
  );
  assert.match(styles, /\.settings-dialog \{[\s\S]*height: min\(550px, calc\(100vh - 36px\)\)/);
  assert.match(styles, /\.settings-main \{[\s\S]*min-height: 0;[\s\S]*overflow-y: auto;/);
});

test("settings dialog typography stays one pixel below each global font size", async () => {
  const styles = await stylesSource;

  assert.match(styles, /--settings-font-size-offset: -1px/);
  assert.match(
    styles,
    /html\[data-font-size="small"\]\s*\{[^}]*--app-font-size-offset:\s*-1px;[^}]*--settings-font-size-offset:\s*-2px;/,
  );
  assert.match(
    styles,
    /html\[data-font-size="medium"\]\s*\{[^}]*--app-font-size-offset:\s*1px;[^}]*--settings-font-size-offset:\s*0px;/,
  );
  assert.match(
    styles,
    /html\[data-font-size="large"\]\s*\{[^}]*--app-font-size-offset:\s*2px;[^}]*--settings-font-size-offset:\s*1px;/,
  );
  assert.match(
    styles,
    /\.settings-dialog\s*\{[^}]*--app-font-size-offset:\s*var\(--settings-font-size-offset\);/,
  );
});
