import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8").then((source) => source.replace(/\r\n/g, "\n"));
const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8").then((source) => source.replace(/\r\n/g, "\n"));

function cssRuleStartingWith(styles, selector, occurrence = 1) {
  let start = -1;
  for (let index = 0; index < occurrence; index += 1) {
    start = styles.indexOf(selector, start + 1);
  }
  assert.notEqual(start, -1, `missing selector: ${selector}`);
  const end = styles.indexOf("}", start);
  assert.notEqual(end, -1, `missing closing brace for: ${selector}`);
  return styles.slice(start, end + 1);
}

test("dark composer auxiliary controls use a muted shared tone", async () => {
  const styles = await stylesSource;
  const toneRule = cssRuleStartingWith(styles, 'html[data-theme="dark"] .composer-group-picker .chat-title-group-button,');

  assert.match(toneRule, /\.composer-group-picker \.chat-title-group-button/);
  assert.match(toneRule, /\.auto-task-group-trigger/);
  assert.match(toneRule, /\.composer-model-picker \.chat-title-group-button/);
  assert.match(toneRule, /\.video-expert-select-button:hover/);
  assert.match(toneRule, /\.video-expert-select\.open \.video-expert-select-button/);
  assert.match(toneRule, /color: var\(--text-tertiary\);/);
});

test("expanded conversation model picker covers focus, pressed, disabled, and catalog states in both themes", async () => {
  const styles = await stylesSource;
  for (const selector of [".composer-model-group-title", ".composer-model-menu-empty", ".composer-model-menu.grouped .composer-model-option-price"]) {
    const rule = cssRuleStartingWith(styles, `${selector} {`);
    assert.match(rule, /color: var\(--text-secondary\);/);
    assert.doesNotMatch(rule, /color:\s*#[0-9a-f]+/i);
  }
  assert.match(cssRuleStartingWith(styles, ".composer-model-picker .chat-title-group-button:active:not(:disabled) {"), /background: var\(--selection-soft\);/);
  assert.match(cssRuleStartingWith(styles, ".composer-model-picker .chat-title-group-button:focus-visible {"), /outline: 2px solid var\(--brand-blue\);/);
  assert.match(cssRuleStartingWith(styles, ".composer-model-picker .chat-title-group-button:disabled {"), /color: var\(--text-muted\);[\s\S]*opacity: 0\.6;/);
  assert.match(cssRuleStartingWith(styles, 'html[data-theme="dark"] .composer-model-group-title {'), /color: var\(--text-secondary\);/);
  assert.match(cssRuleStartingWith(styles, 'html[data-theme="dark"] .composer-model-menu.grouped .composer-model-option-price {'), /color: var\(--text-secondary\);/);
  assert.match(styles, /\.composer\.media-creation-composer\s*\.composer-tools\s*\{[^}]*bottom: 44px;/);
});

test("dark video expert selectors use the dark control border", async () => {
  const styles = await stylesSource;
  const selectorRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"]\n  .video-expert-select:not(.video-expert-select-model)\n  > .video-expert-select-button {',
  );
  const hoverRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"]\n  .video-expert-select:not(.video-expert-select-model)\n  > .video-expert-select-button:hover:not(:disabled),',
  );

  assert.match(selectorRule, /border: 1px solid var\(--border-control\);/);
  assert.match(selectorRule, /background: var\(--surface-interactive\);/);
  assert.match(selectorRule, /color: var\(--text-secondary\);/);
  assert.match(hoverRule, /\.video-expert-select:not\(\.video-expert-select-model\)\.open/);
  assert.match(hoverRule, /background: var\(--surface-interactive-hover\);/);
  assert.doesNotMatch(selectorRule, /#f[0-9a-f]{2,5}|white/i);
});

test("dark composer mode picker covers resting, hover, open, and selected states", async () => {
  const styles = await stylesSource;
  const restingRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-mode-trigger {',
  );
  const hoverRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-mode-trigger:hover,',
  );
  const menuInteractionRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-mode-menu-button:hover,',
  );
  const selectedRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-mode-menu-button.selected {',
    2,
  );

  assert.match(restingRule, /border-color: transparent;/);
  assert.match(restingRule, /background: transparent;/);
  assert.match(hoverRule, /\.composer-mode-picker\.open \.composer-mode-trigger/);
  assert.match(hoverRule, /border-color: var\(--border-control\);/);
  assert.match(hoverRule, /background: var\(--surface-interactive\);/);
  assert.match(menuInteractionRule, /\.composer-mode-menu-button:focus-visible/);
  assert.match(menuInteractionRule, /background: var\(--surface-interactive-hover\);/);
  assert.match(selectedRule, /background: var\(--selection-strong\);/);
  assert.match(selectedRule, /color: var\(--text-primary-soft\);/);
  assert.doesNotMatch(styles, /composer-mode-submenu|composer-mode-menu-chevron|composer-mode-menu-item/);
  for (const rule of [restingRule, hoverRule, menuInteractionRule]) {
    assert.doesNotMatch(rule, /#f[0-9a-f]{2,5}|white/i);
  }
});

test("dark media upload guide keeps its label legible on hover and focus", async () => {
  const styles = await stylesSource;
  const restingRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .media-upload-guide-slot {',
  );
  const interactionRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .media-upload-guide-slot:hover:not(:disabled),',
  );

  assert.match(restingRule, /background: var\(--surface-subtle\);/);
  assert.match(restingRule, /color: var\(--text-tertiary\);/);
  assert.match(interactionRule, /\.media-upload-guide-slot:focus-visible:not\(:disabled\)/);
  assert.match(interactionRule, /border-color: var\(--brand-blue\);/);
  assert.match(interactionRule, /background: var\(--selection-soft\);/);
  assert.match(interactionRule, /color: #8fbdff;/);
});

test("dark auto-task cancel action remains subtly visible", async () => {
  const styles = await stylesSource;
  const cancelRule = cssRuleStartingWith(styles, 'html[data-theme="dark"] .auto-task-cancel {');
  const hoverRule = cssRuleStartingWith(styles, 'html[data-theme="dark"] .auto-task-cancel:hover {');

  assert.match(cancelRule, /background: var\(--surface-hover\);/);
  assert.match(cancelRule, /box-shadow: inset 0 0 0 1px rgba\(255, 255, 255, 0\.06\);/);
  assert.match(hoverRule, /background: var\(--surface-interactive-hover\);/);
});

test("composer upload button covers light and dark interaction states", async () => {
  const styles = await stylesSource;
  const lightHoverRule = cssRuleStartingWith(styles, ".composer-icon-btn:hover:not(:disabled) {");
  const lightActiveRule = cssRuleStartingWith(styles, ".composer-icon-btn:active:not(:disabled) {");
  const lightFocusRule = cssRuleStartingWith(styles, ".composer-icon-btn:focus-visible {");
  const lightDisabledRule = cssRuleStartingWith(styles, ".composer-icon-btn:disabled {");
  const darkHoverRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-icon-btn:hover:not(:disabled),',
  );
  const darkActiveRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-icon-btn:active:not(:disabled) {',
  );
  const darkFocusRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-icon-btn:focus-visible {',
  );
  const darkDisabledRule = cssRuleStartingWith(
    styles,
    'html[data-theme="dark"] .composer-icon-btn:disabled {',
  );

  assert.match(lightHoverRule, /background: var\(--surface-soft\);/);
  assert.match(lightActiveRule, /background: var\(--surface-hover\);/);
  assert.match(lightFocusRule, /outline: 2px solid rgba\(7, 93, 255, 0\.42\);/);
  assert.match(lightDisabledRule, /opacity: 0\.45;/);
  assert.match(darkHoverRule, /background: rgba\(129, 158, 193, 0\.09\);/);
  assert.match(darkActiveRule, /background: var\(--surface-interactive-hover\);/);
  assert.match(darkFocusRule, /outline-color: rgba\(117, 169, 255, 0\.7\);/);
  assert.match(darkDisabledRule, /opacity: 0\.62;/);
});

test("DeepSeek model option omits the text-only capability badge in both themes", async () => {
  const [styles, main] = await Promise.all([stylesSource, mainSource]);

  assert.doesNotMatch(main, /composer-model-option-capability/);
  assert.doesNotMatch(main, />仅文本</);
  assert.doesNotMatch(styles, /composer-model-option-capability/);
});
