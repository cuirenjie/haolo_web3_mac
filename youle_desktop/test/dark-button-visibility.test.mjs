import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

function darkDeclarationsFor(styles, selector) {
  const target = `html[data-theme="dark"] ${selector}`;
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/gs)]
    .filter(([, selectors]) =>
      selectors
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((item) => item.trim())
        .includes(target),
    )
    .map(([, , declarations]) => declarations)
    .join("\n");
}

test("dark profile and settings actions remain distinct from their surfaces", async () => {
  const [styles, renderer] = await Promise.all([stylesSource, rendererSource]);
  const recharge = darkDeclarationsFor(styles, ".profile-recharge-button:not(:disabled)");
  const rechargeHover = darkDeclarationsFor(styles, ".profile-recharge-button:hover:not(:disabled)");
  const rechargeActive = darkDeclarationsFor(styles, ".profile-recharge-button:active:not(:disabled)");
  const logout = darkDeclarationsFor(styles, ".settings-logout-button");
  const logoutHover = darkDeclarationsFor(styles, ".settings-logout-button:hover:not(:disabled)");
  const logoutActive = darkDeclarationsFor(styles, ".settings-logout-button:active:not(:disabled)");
  const logoutFocus = darkDeclarationsFor(styles, ".settings-logout-button:focus-visible");

  assert.doesNotMatch(renderer, /class="profile-config-button"[^>]*>我的配置<\/button>/);
  assert.match(renderer, /class="profile-recharge-button" data-action="profile-quota">充值<\/button>/);
  assert.match(renderer, /class="settings-logout-button" data-action="logout"/);
  assert.match(recharge, /border-color: rgba\(255, 255, 255, 0\.24\);/);
  assert.match(recharge, /background: transparent;/);
  assert.match(recharge, /color: var\(--text-primary-soft\);/);
  assert.match(recharge, /box-shadow: none;/);
  assert.match(rechargeHover, /background: var\(--surface-hover\);/);
  assert.match(rechargeHover, /border-color: rgba\(255, 255, 255, 0\.38\);/);
  assert.match(rechargeActive, /background: var\(--surface-active-translucent\);/);
  assert.match(logout, /border-color: rgba\(248, 113, 113, 0\.22\);/);
  assert.match(logout, /background: rgba\(239, 68, 68, 0\.08\);/);
  assert.match(logout, /color: #fca5a5;/);
  assert.match(logoutHover, /background: rgba\(239, 68, 68, 0\.14\);/);
  assert.match(logoutActive, /background: rgba\(239, 68, 68, 0\.2\);/);
  assert.match(logoutFocus, /box-shadow: 0 0 0 3px rgba\(248, 113, 113, 0\.2\);/);
});

test("dark primary actions share a visible edge without changing the graphite palette", async () => {
  const styles = await stylesSource;
  const selectors = [
    ".contact-primary-action:not(:disabled)",
    ".contact-request-primary:not(:disabled)",
    ".send-button:not(:disabled)",
    ".auto-task-primary:not(:disabled)",
    ".auto-task-confirm:not(:disabled)",
    ".thread-dialog-primary:not(:disabled)",
    ".settings-update-button:not(:disabled)",
    ".primary-button:not(:disabled)",
    ".channel-search-button:not(:disabled)",
  ];

  for (const selector of selectors) {
    const declarations = darkDeclarationsFor(styles, selector);
    assert.match(declarations, /background: var\(--surface-interactive\);/, selector);
    assert.match(declarations, /color: #f7f8fa;/, selector);
    assert.match(declarations, /box-shadow: inset 0 0 0 1px rgba\(255, 255, 255, 0\.1\);/, selector);
  }
});

test("dark secondary and toolbar controls no longer blend into their panels", async () => {
  const styles = await stylesSource;
  const selectors = [
    ".contact-secondary-action",
    ".contact-request-secondary",
    ".auto-task-view-button",
    ".telegram-channel-login-secondary",
    ".thread-dialog-secondary",
    ".secondary-button",
    ".thread-group-select-button",
    ".skills-sort-button:not(.active)",
    ".skills-my-button:not(.active)",
    ".skills-import-button",
    '.skills-plaza-categories button:not(.active):not([aria-pressed="true"])',
  ];

  for (const selector of selectors) {
    const declarations = darkDeclarationsFor(styles, selector);
    assert.match(declarations, /background: var\(--surface-interactive\);/, selector);
    assert.match(declarations, /border-color: var\(--line-strong\);/, selector);
    assert.match(declarations, /box-shadow: inset 0 0 0 1px rgba\(255, 255, 255, 0\.1\);/, selector);
  }
});

test("dark button hover and text-action overrides replace light-theme colors", async () => {
  const styles = await stylesSource;
  const skillsHover = darkDeclarationsFor(styles, ".skills-plaza-tabs button:hover");
  const addFriendHover = darkDeclarationsFor(styles, ".contacts-add-friend-toggle:hover");
  const pinHover = darkDeclarationsFor(styles, ".window-control.pin.active:hover");
  const iconHover = darkDeclarationsFor(styles, ".dialog-icon-button:hover");
  const createAction = darkDeclarationsFor(styles, ".thread-group-select-menu button.create");

  assert.match(skillsHover, /background: var\(--surface-hover-translucent\);/);
  assert.match(addFriendHover, /background: var\(--surface-hover-translucent\);/);
  assert.match(pinHover, /background: var\(--surface-active-translucent\);/);
  assert.match(iconHover, /background: var\(--surface-interactive-hover\);/);
  assert.match(createAction, /color: var\(--brand-blue\);/);
});
