import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const desktopMainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("appearance preference initializes before desktop boot and safely defaults to light", async () => {
  const [source, desktopMain] = await Promise.all([rendererSource, desktopMainSource]);
  const initialization = sourceBlock(source, "function loadAppTheme", "ensureBrowserDesktopApi();");

  assert.match(source, /const APP_THEME_STORAGE_KEY = "haolo\.appearance\.theme"/);
  assert.match(initialization, /localStorage\.getItem\(APP_THEME_STORAGE_KEY\) === "dark" \? "dark" : "light"/);
  assert.match(initialization, /catch \{\s*return "light";/s);
  assert.match(initialization, /const INITIAL_APP_THEME = loadAppTheme\(\);\s*applyAppTheme\(INITIAL_APP_THEME\);/s);
  assert.match(source, /setAppTheme\?\(params: \{ theme: AppTheme \}\): Promise<\{ theme\?: AppTheme \}>/);
  assert.match(source, /syncAppThemePreference\(INITIAL_APP_THEME\);/);
  assert.match(desktopMain, /DEFAULT_APP_PREFERENCES = Object\.freeze\(\{\s*theme: "light"/s);
  assert.match(desktopMain, /theme: source\.theme === undefined \? DEFAULT_APP_PREFERENCES\.theme : normalizeAppTheme\(source\.theme\)/);
  assert.match(desktopMain, /function normalizeAppTheme\(value\) \{\s*return value === "light" \? "light" : "dark";/s);
  assert.match(desktopMain, /backgroundColor: appTheme\(\) === "dark" \? "#101216" : "#f6f8fa"/);
  assert.ok(source.indexOf("applyAppTheme(INITIAL_APP_THEME);") < source.indexOf("void boot();"));
  assert.ok(source.indexOf("syncAppThemePreference(INITIAL_APP_THEME);") < source.indexOf("void boot();"));
});

test("login and desktop windows share 16px outer corners", async () => {
  const styles = await stylesSource;
  const lightTokens = sourceBlock(styles, ":root {", 'html[data-font-size="small"]');

  assert.match(lightTokens, /--window-radius: 16px;/);
  assert.match(styles, /\.login-shell\s*\{[^}]*border-radius: var\(--window-radius\);[^}]*clip-path: inset\(0 round var\(--window-radius\)\);/s);
  assert.match(styles, /\.login-card\s*\{[^}]*border-radius: var\(--window-radius\);[^}]*clip-path: inset\(0 round var\(--window-radius\)\);/s);
  assert.match(styles, /\.desktop-shell\s*\{[^}]*border-radius: var\(--window-radius\);[^}]*clip-path: inset\(0 round var\(--window-radius\)\);/s);
  assert.match(styles, /\.window-maximized \.desktop-shell\s*\{[^}]*border-radius: 0;[^}]*clip-path: none;/s);
});

test("the composer resource hint uses adaptive gray without inheriting a faded placeholder", async () => {
  const styles = await stylesSource;
  const hint = styles.match(/\.trading-expert-panel \.composer #composerInput::placeholder\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(hint, /color: var\(--text-placeholder\);/);
  assert.match(hint, /opacity: 1;/);
  const light = styles.match(/^:root\s*\{([^}]*)\}/)?.[1] || "";
  const dark = styles.match(/html\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] || "";
  const gray = (tokens) => tokens.match(/--text-placeholder:\s*(#[0-9a-f]{6});/i)?.[1];
  assert.ok(gray(light));
  assert.ok(gray(dark));
  assert.notEqual(gray(light), gray(dark), "The hint must adapt to the dark surface");
});

test("theme application updates the root color scheme and persists an explicit selection", async () => {
  const source = await rendererSource;
  const applyBlock = sourceBlock(source, "function applyAppTheme", "const INITIAL_APP_THEME");
  const selectBlock = sourceBlock(source, "function selectAppTheme", "function showContactRequestSent");

  assert.match(applyBlock, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(applyBlock, /document\.documentElement\.style\.colorScheme = theme/);
  assert.match(applyBlock, /localStorage\.setItem\(APP_THEME_STORAGE_KEY, theme\)/);
  assert.match(selectBlock, /state\.settings\.theme = theme/);
  assert.match(selectBlock, /applyAppTheme\(theme, true\)/);
  assert.match(selectBlock, /syncAppThemePreference\(theme\)/);
  assert.match(selectBlock, /render\(\)/);
});

test("general settings renders the day and night selector in the requested position", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;
  const dialogBlock = sourceBlock(source, "function renderSettingsDialog", "function renderSettingsUserDataRow");
  const selectorBlock = sourceBlock(source, "function renderSettingsThemeRow", "function renderSettingsTaskCompletionPopupRow");
  const optionLabelStyles = sourceBlock(
    styles,
    ".settings-theme-option > span {",
    ".settings-theme-option:hover:not(.active)",
  );
  const activeOptionStyles = sourceBlock(
    styles,
    ".settings-theme-option.active {",
    ".settings-theme-option:focus-visible",
  );
  const themeIconStyles = sourceBlock(
    styles,
    ".settings-theme-icon {",
    ".settings-theme-option:hover:not(.active)",
  );
  const eventBlock = sourceBlock(
    source,
    'querySelectorAll<HTMLButtonElement>("[data-settings-theme]")',
    'querySelectorAll<HTMLElement>("[data-settings-task-popup-row]")',
  );

  const popupIndex = dialogBlock.indexOf("renderSettingsTaskCompletionPopupRow()");
  const themeIndex = dialogBlock.indexOf("renderSettingsThemeRow()");
  const storageIndex = dialogBlock.indexOf('class="settings-storage-row"');
  assert.ok(popupIndex < themeIndex && themeIndex < storageIndex);
  assert.match(selectorBlock, /主题外观/);
  assert.match(selectorBlock, /data-settings-theme="light"[\s\S]*白天模式/);
  assert.match(selectorBlock, /data-settings-theme="dark"[\s\S]*夜间模式/);
  assert.match(selectorBlock, /role="radiogroup"/);
  assert.match(selectorBlock, /role="radio"/);
  assert.match(selectorBlock, /aria-checked=/);
  assert.match(selectorBlock, /data-settings-theme="light"[\s\S]*settings-theme-icon-sun[\s\S]*?<span>白天模式<\/span>/);
  assert.match(selectorBlock, /data-settings-theme="dark"[\s\S]*settings-theme-icon-moon[\s\S]*?<span>夜间模式<\/span>/);
  assert.match(selectorBlock, /settings-theme-icon-sun[\s\S]*?<circle/);
  assert.match(selectorBlock, /settings-theme-icon-moon[\s\S]*?M21 12\.79/);
  assert.match(optionLabelStyles, /transform: translateY\(-1px\)/);
  assert.match(themeIconStyles, /stroke: currentColor/);
  assert.match(themeIconStyles, /opacity: 0\.64/);
  assert.match(activeOptionStyles, /background: #fff/);
  assert.match(activeOptionStyles, /font-weight: 500/);
  assert.match(
    styles,
    /data-settings-theme="light"\]\.active \.settings-theme-icon[\s\S]*color: #646d79;[\s\S]*opacity: 0\.64/,
  );
  assert.match(styles, /data-settings-theme="dark"\]\.active \.settings-theme-icon[\s\S]*color: #a8b8ff/);
  assert.match(eventBlock, /theme === "light" \|\| theme === "dark"/);
  assert.match(eventBlock, /selectAppTheme\(theme\)/);
});

test("check update button keeps the requested reduced bottom padding", async () => {
  const styles = await stylesSource;
  const updateButtonStyles = sourceBlock(
    styles,
    ".settings-update-button {",
    ".settings-update-button:hover",
  );

  assert.match(updateButtonStyles, /padding: 0 18px 2px/);
});

test("highlighted light-theme hover surfaces share the soft gray token", async () => {
  const styles = await stylesSource;
  const lightTokens = sourceBlock(styles, ":root {", 'html[data-font-size="small"]');
  const hoverGroup = sourceBlock(
    styles,
    "/* Keep the highlighted light-theme hover surfaces aligned with the preview toggle. */",
    ".library-file-row.active {",
  );

  assert.match(lightTokens, /--soft: #f5f6f8/);
  for (const selector of [
    ".library-file-row:not(.active):hover",
    ".library-category:not(.active):hover",
    ".my-skill-card:hover",
    ".contact-row-wrap:not(.active):hover",
    ".conversation-row-wrap:not(.active):hover",
  ]) {
    assert.ok(hoverGroup.includes(`html:not([data-theme="dark"]) ${selector}`), selector);
  }
  assert.match(hoverGroup, /background: var\(--soft\)/);
});

test("application chrome preserves the original light gray and dark graphite surfaces", async () => {
  const styles = await stylesSource;
  const lightTokens = sourceBlock(styles, ":root {", 'html[data-font-size="small"]');
  const darkTokens = sourceBlock(styles, 'html[data-theme="dark"] {', "* {");
  const finalDarkPalette = sourceBlock(
    styles,
    "/* Dark graphite palette: neutral black surfaces, blue reserved for interaction and data. */",
    'html[data-theme="dark"] .desktop-shell,',
  );

  assert.match(lightTokens, /--app-chrome-background: #f4f5f6/);
  assert.match(darkTokens, /--app-chrome-background: #0f1115/);
  assert.match(finalDarkPalette, /--app-chrome-background: #0c0d0f/);
  assert.match(styles, /\.app-titlebar\s*\{[^}]*background: var\(--app-chrome-background\)/s);
  assert.match(styles, /\.chat-list\s*\{[^}]*background: var\(--app-chrome-background\)/s);
  assert.match(styles, /\.conversation-list-footer\s*\{[^}]*background: transparent/s);
  assert.match(styles, /\.conversation-list-new-sticky\s*\{[^}]*background: var\(--app-chrome-background\)/s);
});

test("dark appearance defines layered neutral surfaces and broad component coverage", async () => {
  const styles = await stylesSource;
  const darkBlock = sourceBlock(styles, 'html[data-theme="dark"] {', "* {");
  const darkOverrides = sourceBlock(styles, "/* ===== Dark appearance ===== */", "@media (prefers-reduced-motion: no-preference)");

  assert.match(darkBlock, /color-scheme: dark/);
  assert.match(darkBlock, /--bg: #101216/);
  assert.match(darkBlock, /--surface-primary: #1b1e23/);
  assert.match(darkBlock, /--text-primary: #f3f4f6/);
  assert.match(darkOverrides, /html\[data-theme="dark"\] \.desktop-shell/);
  assert.match(darkOverrides, /html\[data-theme="dark"\] \.chat-list/);
  assert.match(darkOverrides, /html\[data-theme="dark"\] \.composer/);
  assert.match(darkOverrides, /html\[data-theme="dark"\] dialog/);
  assert.match(darkOverrides, /html\[data-theme="dark"\] \.settings-theme-options/);
  assert.match(darkOverrides, /html\[data-theme="dark"\] \.message-code-block/);
  assert.doesNotMatch(styles, /prefers-color-scheme/);
});

test("night mode normalizes pale interaction states to the reference graphite gray", async () => {
  const styles = await stylesSource;
  const darkTokens = sourceBlock(styles, 'html[data-theme="dark"] {', "* {");
  const hoverGroup = sourceBlock(
    styles,
    "/* Keep every night-mode interaction surface on the same graphite gray. */",
    'html[data-theme="dark"] .video-expert-select-menu button.selected',
  );
  const buttonGroup = sourceBlock(
    styles,
    'html[data-theme="dark"] .login-card .login-submit,',
    'html[data-theme="dark"] .contact-chat-messages,',
  );
  const nightAudit = styles.slice(styles.indexOf("/* Keep every night-mode interaction surface"));

  assert.match(darkTokens, /--surface-interactive: #222428/);
  assert.match(darkTokens, /--control-primary: var\(--surface-interactive\)/);
  assert.match(hoverGroup, /\.my-skill-card:hover/);
  assert.match(hoverGroup, /\.composer-group-picker \.chat-title-group-button:hover/);
  assert.match(hoverGroup, /\.composer-group-picker\.open \.chat-title-group-button/);
  assert.match(hoverGroup, /\.thread-group-more-button:hover/);
  assert.match(hoverGroup, /\.thread-more-button:hover/);
  assert.match(hoverGroup, /\.contact-more-button:hover/);
  assert.match(hoverGroup, /\.video-expert-select-menu button:hover/);
  assert.match(hoverGroup, /background: var\(--surface-interactive\)/);
  assert.doesNotMatch(hoverGroup, /\.video-expert-select-menu button\.selected/);

  assert.match(buttonGroup, /\.login-card \.login-submit\.loading:disabled/);
  assert.match(buttonGroup, /\.message-actions \.message-recharge-button/);
  assert.match(buttonGroup, /\.skill-detail-dialog footer button/);
  assert.match(buttonGroup, /background: var\(--surface-interactive\)/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.video-expert-select-menu button\.selected\s*\{\s*background: var\(--selection-strong\);/s,
  );
  assert.doesNotMatch(nightAudit, /html\[data-theme="dark"\] \.thread-search-nav-button/);
  assert.match(nightAudit, /html\[data-theme="dark"\] \.auto-task-picker-trigger/);
  assert.match(nightAudit, /html\[data-theme="dark"\] \.auto-task-detail-actions \.primary/);
  assert.match(
    nightAudit,
    /html\[data-theme="dark"\] \.settings-switch\.active\s*\{[\s\S]*background: var\(--surface-interactive\);/,
  );
});

test("night mode separates option hover and selected blue highlights", async () => {
  const styles = await stylesSource;
  const darkTokens = sourceBlock(styles, 'html[data-theme="dark"] {', "* {");
  const highlightStart = styles.indexOf(
    "/* Use a light-blue hover and a stronger blue selection across dark option surfaces. */",
  );
  const highlightRules = styles.slice(highlightStart);

  assert.notEqual(highlightStart, -1);
  assert.match(darkTokens, /--selection-soft: rgba\(91, 157, 255, 0\.2\)/);
  assert.match(darkTokens, /--selection-strong: rgba\(91, 157, 255, 0\.32\)/);
  assert.match(highlightRules, /\[role="menu"\]:not\(\.plugin-marketplace-action-menu\)/);
  assert.match(highlightRules, /\[role="menuitemradio"\]/);
  assert.match(highlightRules, /\[role="listbox"\]/);
  assert.match(highlightRules, /\[role="option"\]/);
  assert.match(highlightRules, /\[role="checkbox"\]/);
  assert.match(highlightRules, /\.auto-task-frequency-panel/);
  assert.match(highlightRules, /\.auto-task-calendar-grid/);
  assert.match(highlightRules, /\.auto-task-time-column/);
  assert.match(highlightRules, /background: var\(--selection-soft\)/);
  assert.match(highlightRules, /background: var\(--selection-strong\)/);
  assert.match(highlightRules, /\.thread-group-add-menu-item:is\(:hover, :focus-within, \.submenu-open\)/);
  assert.match(styles, /\.titlebar-more-action\.menu-open > \.titlebar-primary-action/);
  assert.match(highlightRules, /\.titlebar-more-channel-item:is\(:hover, :focus-within, \.submenu-open\)/);
  assert.match(highlightRules, /\.thread-marker-menu-item:is\(:hover, :focus-within, \.submenu-open\)/);
  assert.match(highlightRules, /\.conversation-row-wrap/);
  assert.match(highlightRules, /\.contact-row-wrap/);
  assert.match(
    highlightRules,
    /:not\(\.active\):is\([\s\S]*?:hover,[\s\S]*?\.menu-open[\s\S]*?background: var\(--selection-soft\)/,
  );
  assert.match(highlightRules, /\.contacts-request-row\)\.active[\s\S]*?background: var\(--selection-strong\)/);
  assert.ok(highlightStart > styles.indexOf('html[data-theme="dark"] .composer-mention-submenu button:hover'));
});
