import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));
const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
).then((source) => source.replace(/\r\n/g, "\n"));

test("composer mode is a static ordinary serial-execution indicator", async () => {
  const [styles, renderer] = await Promise.all([stylesSource, rendererSource]);
  const pickerStart = renderer.indexOf("function renderComposerModePicker");
  const pickerEnd = renderer.indexOf("\nfunction activeComposerDraftSnapshot", pickerStart);
  assert.notEqual(pickerStart, -1);
  assert.notEqual(pickerEnd, -1);
  const picker = renderer.slice(pickerStart, pickerEnd);

  assert.match(picker, /class="composer-mode-trigger serial-only"/);
  assert.match(picker, /aria-label="执行模式，已固定为串行执行"/);
  assert.match(picker, /renderComposerModeIcon\("execution"\)/);
  assert.doesNotMatch(picker, /data-composer-cluster-mode|data-new-thread-mode|composer-mode-menu/);
  assert.doesNotMatch(
    picker,
    /composer-mode-submenu|composer-mode-menu-chevron|data-composer-mode-cascade/,
  );
  assert.doesNotMatch(styles, /composer-mode-submenu|composer-mode-menu-chevron|composer-mode-menu-item/);
});

test("shared cascade hover handling no longer targets the composer mode menu", async () => {
  const renderer = await rendererSource;
  const bindingStart = renderer.indexOf("function bindCascadeMenuHoverEvents()");
  const bindingEnd = renderer.indexOf("\nfunction bindEvents()", bindingStart);
  assert.notEqual(bindingStart, -1);
  assert.notEqual(bindingEnd, -1);
  const binding = renderer.slice(bindingStart, bindingEnd);

  assert.doesNotMatch(binding, /composer-mode-menu-item|composer-mode-submenu/);
  assert.match(binding, /item\.addEventListener\("pointerenter", keepOpen\)/);
  assert.match(binding, /item\.addEventListener\("pointerleave", scheduleClose\)/);
  assert.match(binding, /CASCADE_MENU_CLOSE_DELAY_MS/);
});
