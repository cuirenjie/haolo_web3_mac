import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesPath = new URL("../src/renderer/styles.css", import.meta.url);

test("automatic-task dialog uses the prompt editor's readable field treatment", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /\.auto-task-dialog\s*\{[\s\S]*?width: min\(520px, calc\(100vw - 44px\)\);/);
  assert.match(styles, /\.auto-task-dialog form\s*\{[\s\S]*?gap: 16px;[\s\S]*?padding: 24px;/);
  assert.match(
    styles,
    /\.auto-task-dialog label,[\s\S]*?\.auto-task-dialog \.auto-task-field\s*\{[\s\S]*?font-size: calc\(13px \+ var\(--app-font-size-offset\)\);/,
  );
  assert.match(
    styles,
    /\.auto-task-input-wrap input,[\s\S]*?\.auto-task-input-wrap textarea\s*\{[\s\S]*?border: 1px solid var\(--border-field\);[\s\S]*?background: var\(--surface-soft\);[\s\S]*?font-size: calc\(13px \+ var\(--app-font-size-offset\)\);/,
  );
  assert.match(
    styles,
    /\.auto-task-picker-trigger\s*\{[\s\S]*?height: 42px;[\s\S]*?border: 1px solid var\(--border-field\);[\s\S]*?background-color: var\(--surface-soft\);[\s\S]*?font-size: calc\(13px \+ var\(--app-font-size-offset\)\);/,
  );
});

test("automatic-task dialog actions match the prompt editor", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(
    styles,
    /\.auto-task-cancel,[\s\S]*?\.auto-task-confirm\s*\{[\s\S]*?height: 38px;[\s\S]*?font-size: calc\(13px \+ var\(--app-font-size-offset\)\);/,
  );
  assert.match(styles, /\.auto-task-cancel\s*\{[\s\S]*?background: var\(--surface-soft\);/);
  assert.match(styles, /\.auto-task-confirm\s*\{[\s\S]*?background: #050505;/);
});
