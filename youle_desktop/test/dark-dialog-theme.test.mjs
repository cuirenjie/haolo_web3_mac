import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("every rendered dialog inherits the unified dark surface", async () => {
  const [renderer, styles] = await Promise.all([rendererSource, stylesSource]);
  const dialogCount = [...renderer.matchAll(/<dialog\s+class=/g)].length;

  assert.ok(dialogCount >= 18, `expected the full dialog inventory, found ${dialogCount}`);
  assert.match(styles, /html\[data-theme="dark"\] dialog\[open\]\s*\{[\s\S]*?background: var\(--dialog-surface\)/);
  assert.match(styles, /--dialog-surface: #1c1e22/);
  assert.match(styles, /--dialog-border: #34363c/);
  assert.match(styles, /--dialog-field: #111317/);
});

test("dark dialog fields and composite controls share the marker-dialog treatment", async () => {
  const styles = await stylesSource;

  assert.match(styles, /html\[data-theme="dark"\] \.thread-group-dialog input,[\s\S]*?\.auto-task-input-wrap textarea\s*\{[\s\S]*?border: 1px solid var\(--dialog-field-border\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.thread-group-select-button,[\s\S]*?\.auto-task-picker-trigger\.active\s*\{[\s\S]*?background: var\(--dialog-field\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.add-friend-search-form:focus-within\s*\{[\s\S]*?border-color: #5b9dff;[\s\S]*?box-shadow: none/);
  assert.match(styles, /html\[data-theme="dark"\] dialog\[open\] input:focus-visible,[\s\S]*?textarea:focus-visible\s*\{[\s\S]*?outline: 0/);
});

test("dark dialog focus uses one blue border without stacked rings", async () => {
  const styles = await stylesSource;
  const unifiedStart = styles.indexOf("/* Unified dark dialogs:");
  const unifiedStyles = styles.slice(unifiedStart);

  assert.notEqual(unifiedStart, -1);
  assert.match(unifiedStyles, /\.auto-task-input-wrap textarea:focus\s*\{[\s\S]*?border-color: #5b9dff;[\s\S]*?box-shadow: none/);
  assert.match(unifiedStyles, /\.auto-task-picker-trigger\.active\s*\{[\s\S]*?border-color: #5b9dff;[\s\S]*?box-shadow: none/);
  assert.doesNotMatch(
    unifiedStyles,
    /dialog\[open\] input:focus-visible,[^{]*\{[^}]*outline: 2px solid/,
  );
});

test("dark dialog actions use blue primary, graphite secondary, and red danger states", async () => {
  const styles = await stylesSource;

  assert.match(styles, /--dialog-primary: #2563eb/);
  assert.match(styles, /html\[data-theme="dark"\] dialog\[open\] footer button\s*,[\s\S]*?background: var\(--dialog-secondary\)/);
  assert.match(styles, /dialog\[open\] \.thread-dialog-primary:not\(:disabled\),[\s\S]*?background: var\(--dialog-primary\)/);
  assert.match(styles, /dialog\[open\] \.thread-dialog-danger:not\(:disabled\)\s*\{[\s\S]*?background: #c9363e/);
  assert.match(styles, /dialog\[open\] footer button:disabled,[\s\S]*?background: var\(--dialog-disabled\)/);
});

test("mandatory update dialogs keep themed text, notes, progress and action states", async () => {
  const styles = await stylesSource;
  const start = styles.indexOf(".update-dialog {");
  const updateStyles = styles.slice(start, styles.indexOf(".update-download-dock {", start));
  assert.match(updateStyles, /background: var\(--surface-primary\)/);
  assert.match(updateStyles, /\.update-dialog h2\s*\{[^}]*color: var\(--text-primary\)/);
  assert.match(updateStyles, /\.update-dialog-notes\s*\{[^}]*color: var\(--text-secondary-strong\)/);
  assert.match(updateStyles, /\.secondary-button\s*\{[^}]*background: var\(--surface-hover\);[^}]*color: var\(--text-primary\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.update-dialog-notes\s*\{[^}]*background: var\(--surface-interactive\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.update-dialog-version,[^{]*\{[^}]*color: #a7adb7/);
  assert.match(styles, /html\[data-theme="dark"\] \.update-dialog-progress\s*\{[^}]*background: var\(--line\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.update-dialog-progress > span,[^{]*\{[^}]*background: var\(--brand-blue\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.update-dialog-error\s*\{[^}]*background: rgba\(255, 107, 107, 0\.12\);[^}]*color: #ff8a8a/);
  for (const [selector, token] of [
    [".update-dialog-actions button,", "--dialog-secondary"],
    [".update-dialog-actions button:hover:not(:disabled),", "--dialog-secondary-hover"],
    [".update-dialog-actions button:disabled,", "--dialog-disabled"],
  ]) {
    const start = styles.lastIndexOf(`html[data-theme="dark"] ${selector}`);
    assert.notEqual(start, -1, selector);
    assert.ok(styles.slice(start, styles.indexOf("}", start)).includes(`var(${token})`), selector);
  }
  assert.match(styles, /html\[data-theme="dark"\] dialog\[open\] button:focus-visible\s*\{[^}]*outline:/);
});
