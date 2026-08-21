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

test("all CSS cascade menus share the same hover grace behavior", async () => {
  const source = await rendererSource;
  const bindings = sourceBlock(source, "function bindCascadeMenuHoverEvents", "function bindEvents");

  assert.match(source, /const CASCADE_MENU_CLOSE_DELAY_MS = 180;/);
  assert.match(bindings, /\.thread-group-add-menu-item, \.thread-marker-menu-item, \.thread-group-move-menu-item, \.titlebar-more-channel-item/);
  assert.match(bindings, /\.trading-expert-mention-group/);
  assert.match(bindings, /:scope > button\[aria-haspopup='menu'\]/);
  assert.match(bindings, /:scope > \[role='menu'\]/);
  assert.match(bindings, /item\.classList\.add\("submenu-open"\)/);
  assert.match(bindings, /item\.classList\.remove\("submenu-open"\)/);
  assert.match(bindings, /item\.addEventListener\("pointerenter", keepOpen\)/);
  assert.match(bindings, /item\.addEventListener\("pointerleave", scheduleClose\)/);
  assert.match(bindings, /trigger\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(bindings, /trigger\.setAttribute\("aria-expanded", "false"\)/);

  assert.match(source, /data-action="toggle-external-channel-menu" aria-haspopup="menu"/);
  assert.match(source, /data-titlebar-channel-trigger role="menuitem" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(source, /class="create thread-group-add-trigger"[\s\S]*?aria-haspopup="menu"/);
  assert.doesNotMatch(source, /thread-group-add-trigger-quick/);
  assert.match(source, /thread-marker-menu-trigger[\s\S]*?aria-haspopup="menu" aria-expanded="false"/);
  assert.match(source, /data-composer-mention-root[\s\S]*?aria-haspopup="menu" aria-expanded="\$\{active \? "true" : "false"\}"/);
});

test("second- and third-level menus expose forgiving pointer bridges", async () => {
  const styles = await stylesSource;

  for (const selector of [
    ".thread-group-add-submenu::before",
    ".thread-marker-submenu::before",
    ".composer-mention-submenu::before",
    ".titlebar-more-channel-item > .external-channel-menu::before",
  ]) {
    const start = styles.lastIndexOf(`${selector} {`);
    assert.notEqual(start, -1, `missing bridge selector: ${selector}`);
    const rule = styles.slice(start, styles.indexOf("}", start) + 1);
    assert.match(rule, /top:\s*-8px/);
    assert.match(rule, /height:\s*calc\(100% \+ 16px\)/);
    assert.match(rule, /pointer-events:\s*auto/);
  }

  const detailBridge = sourceBlock(
    styles,
    ".composer-thread-detail-hover-bridge {",
    ".composer-thread-detail-search-row {",
  );
  assert.match(detailBridge, /top:\s*-8px/);
  assert.match(detailBridge, /bottom:\s*-8px/);
  assert.match(detailBridge, /width:\s*12px/);
  assert.match(detailBridge, /pointer-events:\s*auto/);

  assert.match(styles, /\.thread-group-add-menu-item\.submenu-open > \.thread-group-add-submenu[\s\S]*?display:\s*grid/);
  assert.match(styles, /\.titlebar-more-channel-item\.submenu-open > \.external-channel-menu[\s\S]*?display:\s*block/);
  assert.match(styles, /\.thread-marker-menu-item\.submenu-open \.thread-marker-submenu[\s\S]*?display:\s*grid/);
  assert.match(styles, /\.trading-expert-mention-group\.submenu-open[\s\S]*?> \.trading-expert-mention-submenu[\s\S]*?display:\s*block/);
  assert.doesNotMatch(styles, /\.thread-group-add-menu-item\.quick/);
  assert.match(
    styles,
    /\.thread-group-add-submenu::before\s*\{[\s\S]*?width:\s*var\(--thread-group-add-submenu-offset\)/,
  );
  assert.doesNotMatch(styles, /chat-new-menu/);
});

test("compact option menus use one shared surface treatment", async () => {
  const styles = await stylesSource;
  const shared = styles.slice(styles.indexOf("/* Shared surface treatment for compact first-, second-, and third-level option menus. */"));

  for (const className of [
    "thread-group-add-submenu",
    "thread-marker-submenu",
    "titlebar-more-menu",
    "external-channel-menu",
    "thread-context-menu",
    "chat-title-group-menu",
    "composer-skill-popover",
    "composer-mention-submenu",
    "composer-thread-detail-submenu",
    "thread-group-select-menu",
  ]) {
    assert.match(shared, new RegExp(`\\.${className.replaceAll("-", "\\-")}`));
  }

  assert.match(shared, /border-radius:\s*10px/);
  assert.match(shared, /box-shadow:\s*0 16px 42px rgba\(17, 24, 39, 0\.14\)/);
  assert.match(shared, /html\[data-theme="dark"\][\s\S]*?background:\s*#1b1e23/);
  assert.match(shared, /html:not\(\[data-theme="dark"\]\)[\s\S]*?background:\s*var\(--surface-hover\)/);
  assert.match(styles, /\.external-channel-menu\s*\{[\s\S]*?border-radius:\s*10px/);
  assert.doesNotMatch(styles, /\.thread-group-add-menu-item\.quick/);
});
