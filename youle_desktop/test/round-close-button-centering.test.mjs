import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = await readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = await readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);
const mainProcessSource = await readFile(
  new URL("../src/main/main.mjs", import.meta.url),
  "utf8",
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssRule(source, selector) {
  const match = source.match(
    new RegExp(`${escapeRegExp(selector)}\\s*\\{([^{}]*)\\}`, "u"),
  );
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

function buttonsWith(source, marker) {
  return [
    ...source.matchAll(
      new RegExp(
        `<button\\b[^>]*${escapeRegExp(marker)}[^>]*>[\\s\\S]*?<\\/button>`,
        "gu",
      ),
    ),
  ].map((match) => match[0]);
}

test("round renderer close buttons use the shared geometric SVG", () => {
  const expectedButtons = [
    ['data-action="clear-add-friend-search"', 1],
    ['data-action="clear-contacts-search"', 1],
    ['data-action="close-skill-detail"', 2],
    ['data-action="close-external-channel-login"', 2],
  ];

  for (const [marker, expectedCount] of expectedButtons) {
    const buttons = buttonsWith(rendererSource, marker);
    assert.equal(buttons.length, expectedCount, marker);
    for (const button of buttons) {
      assert.match(
        button,
        /<img class="button-close-icon" src="\$\{escapeAttr\(HOME_ICON_URL\.close\)\}" alt="" \/>/u,
        marker,
      );
      assert.doesNotMatch(button, /×|&times;/u, marker);
    }
  }

  const closeAssetImages = [
    ...rendererSource.matchAll(/<img\b[^>]*HOME_ICON_URL\.close[^>]*>/gu),
  ].map((match) => match[0]);
  assert.ok(
    closeAssetImages.length >= 11,
    "Expected all renderer close icon usages",
  );
  for (const image of closeAssetImages) {
    assert.match(image, /class="button-close-icon"/u);
  }
});

test("round renderer close button boxes center a zero-line-height icon", () => {
  for (const selector of [
    ".add-friend-search-box button",
    ".contacts-search-clear",
    ".skill-detail-dialog-close",
    ".dialog-icon-button",
  ]) {
    const rule = cssRule(stylesSource, selector);
    assert.match(rule, /display:\s*grid;/u, selector);
    assert.match(rule, /place-items:\s*center;/u, selector);
    assert.match(rule, /border-radius:\s*(?:50%|999px);/u, selector);
    assert.match(rule, /appearance:\s*none;/u, selector);
    assert.match(rule, /padding:\s*0;/u, selector);
    assert.match(rule, /line-height:\s*0;/u, selector);

    const width = rule.match(/width:\s*([\d.]+)px;/u)?.[1];
    const height = rule.match(/height:\s*([\d.]+)px;/u)?.[1];
    assert.ok(width && height, `${selector} must have a fixed box`);
    assert.equal(width, height, `${selector} must remain circular`);
  }

  const iconRule = cssRule(stylesSource, ".button-close-icon");
  assert.match(iconRule, /display:\s*block;/u);
  assert.match(iconRule, /object-fit:\s*contain;/u);
  assert.match(iconRule, /pointer-events:\s*none;/u);
});

test("notification close button uses a centered geometric SVG", () => {
  const buttons = buttonsWith(mainProcessSource, 'data-action="close"');
  const notificationButton = buttons.find((button) =>
    button.includes("notification-close-button"),
  );
  assert.ok(notificationButton, "Missing notification close button");
  assert.match(
    notificationButton,
    /<svg viewBox="0 0 16 16" aria-hidden="true">/u,
  );
  assert.match(notificationButton, /<path d="M4 4l8 8M12 4l-8 8" \/>/u);
  assert.doesNotMatch(notificationButton, /×|&times;/u);

  const buttonRule = cssRule(mainProcessSource, ".notification-close-button");
  assert.match(buttonRule, /display:\s*grid;/u);
  assert.match(buttonRule, /place-items:\s*center;/u);
  assert.match(buttonRule, /appearance:\s*none;/u);
  assert.match(buttonRule, /padding:\s*0;/u);
  assert.match(buttonRule, /line-height:\s*0;/u);

  const iconRule = cssRule(mainProcessSource, ".notification-close-button svg");
  assert.match(iconRule, /display:\s*block;/u);
  assert.match(iconRule, /width:\s*14px;/u);
  assert.match(iconRule, /height:\s*14px;/u);
});

test("desktop notification window follows the dark app theme", () => {
  assert.match(mainProcessSource, /desktopNotificationHtml\(\{ title, body, theme: appTheme\(\) \}\)/u);
  assert.match(mainProcessSource, /<html data-theme="\$\{htmlEscape\(normalizedTheme\)\}">/u);

  const darkCardRule = cssRule(mainProcessSource, 'html[data-theme="dark"] .card');
  assert.match(darkCardRule, /background:\s*#1b1e23;/u);
  assert.match(darkCardRule, /color:\s*#f3f4f6;/u);
  assert.match(darkCardRule, /border-color:\s*rgba\(255,\s*255,\s*255,\s*0\.12\);/u);

  const darkBodyRule = cssRule(mainProcessSource, 'html[data-theme="dark"] p');
  assert.match(darkBodyRule, /color:\s*#d7dce4;/u);

  const darkSettingsRule = cssRule(mainProcessSource, 'html[data-theme="dark"] .notification-settings-button');
  assert.match(darkSettingsRule, /background:\s*#222428;/u);
  assert.match(darkSettingsRule, /color:\s*#d7dce4;/u);
});
