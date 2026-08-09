import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function cssRuleStartingWith(styles, selector) {
  const start = styles.indexOf(selector);
  assert.notEqual(start, -1, `missing selector: ${selector}`);
  const end = styles.indexOf("}", start);
  assert.notEqual(end, -1, `missing closing brace for: ${selector}`);
  return styles.slice(start, end + 1);
}

test("dark automatic-task fields share the composer's graphite tone", async () => {
  const styles = await stylesSource;
  const fieldRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .auto-task-input-wrap input,',
  );

  assert.match(fieldRule, /\.auto-task-input-wrap textarea/);
  assert.match(fieldRule, /\.auto-task-picker-trigger:hover:not\(:disabled\)/);
  assert.match(fieldRule, /\.auto-task-picker-trigger\.active/);
  assert.match(fieldRule, /border-color: var\(--border-control\);/);
  assert.match(fieldRule, /background: var\(--surface-subtle\);/);
  assert.match(fieldRule, /box-shadow: none;/);
});

test("dark automatic-task pickers use the same muted foreground as composer controls", async () => {
  const styles = await stylesSource;
  const foregroundRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .auto-task-picker-trigger .calendar-icon,',
  );

  assert.match(foregroundRule, /\.auto-task-picker-trigger \.clock-icon/);
  assert.match(foregroundRule, /html\[data-theme="dark"\] \.auto-task-picker-trigger \{/);
  assert.match(foregroundRule, /color: var\(--text-tertiary\);/);
});

test("dark automatic-task character count stays readable", async () => {
  const styles = await stylesSource;
  const countRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .auto-task-input-wrap small {',
  );

  assert.match(countRule, /color: var\(--text-muted\);/);
});
