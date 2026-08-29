import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [rendererSource, stylesSource, languageSource, packageSource, auditSource] = await Promise.all([
  readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../src/renderer/app-language.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../scripts/audit-i18n-layout.mjs", import.meta.url), "utf8"),
]);

test("language-sensitive account surfaces prevent long labels from overlapping", () => {
  assert.match(stylesSource, /\.profile-menu\s*\{[^}]*width:\s*min\(360px, calc\(100vw - 30px\)\);/s);
  assert.match(stylesSource, /\.profile-level-row,[\s\S]*?grid-template-columns:\s*104px minmax\(0, 1fr\);/s);
  assert.match(stylesSource, /\.profile-subscription-label > span\s*\{[^}]*white-space:\s*normal;/s);
  assert.match(stylesSource, /\.profile-subscription-row > strong\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(stylesSource, /\.profile-name-row > strong\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(stylesSource, /\.settings-nav-item\s*\{[^}]*box-sizing:\s*border-box;/s);
  assert.match(stylesSource, /\.settings-side\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.match(stylesSource, /\.consumption-profile-card\s*\{[^}]*display:\s*grid;[^}]*repeat\(4, minmax\(96px, 1fr\)\)/s);
  assert.match(stylesSource, /\.consumption-profile-person\s*\{[^}]*min-height:\s*88px;/s);
  assert.match(stylesSource, /\.consumption-profile-name-row > strong\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(stylesSource, /\.consumption-day span\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(stylesSource, /html\[data-theme="dark"\] \.consumption-day\.selected/);
});

test("English action buttons remain single-line and expand beyond legacy CJK widths", () => {
  assert.match(languageSource, /button\.toggleAttribute\("data-i18n-single-line", isSingleEnglishLabel\)/);
  assert.match(stylesSource, /html\[data-language="en"\] button\[data-i18n-single-line\]\s*\{[^}]*min-inline-size:\s*max-content;[^}]*word-break:\s*normal;[^}]*white-space:\s*nowrap;/s);
  assert.match(stylesSource, /\.settings-profile-submit\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*132px;[^}]*height:\s*42px;[^}]*padding:\s*0 22px;/s);
  assert.match(stylesSource, /\.settings-data-button\s*\{[^}]*display:\s*inline-flex;[^}]*min-width:\s*72px;[^}]*padding:\s*0 12px;[^}]*white-space:\s*nowrap;/s);
  assert.match(stylesSource, /\.trading-alert-card:is\(:hover, :focus-within\) \.trading-alert-card-copy small\s*\{[^}]*opacity:\s*0;/s);
  assert.match(stylesSource, /@media \(hover: none\)[\s\S]*?\.trading-alert-card-copy small\s*\{[^}]*opacity:\s*0;/s);
});

test("dynamic consumption copy is formatted for the active locale before rendering", () => {
  assert.match(rendererSource, /new Intl\.NumberFormat\("en-US",\s*\{[\s\S]*?notation:\s*"compact"/s);
  assert.match(rendererSource, /function consumptionWeekdayLabels\(\)[\s\S]*?\["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"\]/s);
  assert.match(rendererSource, /function formatConsumptionLoginDays[\s\S]*?days === 1 \? "day" : "days"/s);
  assert.match(rendererSource, /Intl\.DateTimeFormat\(appLanguageLocale\(state\.settings\.language\)/);
  for (const translation of [
    '"充值": "Top up"',
    '"积分余额": "Points balance"',
    '"最高单日消耗": "Highest daily usage"',
    '"每日 Token 消耗": "Daily token usage"',
    '"任务与计费说明": "Task and billing details"',
    '"HaoLo号：": "HaoLo ID: "',
    '"MA5/MA20 死叉且 MACD 下穿零轴": "MA5/MA20 bearish crossover + MACD below zero"',
  ]) assert.ok(languageSource.includes(translation), `missing curated translation ${translation}`);
});

test("the packaged geometry audit covers languages, themes, zooms and large text", () => {
  assert.equal(JSON.parse(packageSource).scripts["audit:i18n-layout"], "electron ./scripts/audit-i18n-layout.cjs");
  assert.match(auditSource, /\["en", "zh-CN", "zh-TW"\]/);
  assert.match(auditSource, /\["light", "dark"\]/);
  assert.match(auditSource, /\[1, 1\.25, 1\.5\]/);
  assert.match(auditSource, /\["small", "default", "medium", "large"\]/);
  assert.match(auditSource, /text overlap:/);
  assert.match(auditSource, /container overflow:/);
  assert.match(auditSource, /child escaped:/);
  assert.match(auditSource, /English button layout:/);
  assert.match(auditSource, /data-i18n-single-line/);
  assert.match(auditSource, /style\.transform !== "none" && style\.clipPath !== "none"/);
  assert.match(auditSource, /language state mismatch:/);
  assert.match(auditSource, /surface hidden/);
  assert.match(auditSource, /English UI residue:/);
  assert.match(auditSource, /transitionSource = language === "en" \? "zh-TW"/);
  assert.match(auditSource, /glyph clipped:/);
  assert.match(auditSource, /await verifyTextClippingDetector\(targetWindow\)/);
  assert.match(auditSource, /await inspectSelectStates\(targetWindow/);
  assert.match(auditSource, /states\.at\(-1\)\.expanded !== "true"/);
});

test("ellipsis controls reserve a font-relative line box for descenders at every font size", () => {
  for (const selector of ["haolo-select-trigger", "auto-task-picker-trigger"]) {
    const block = stylesSource.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))[1];
    assert.match(block, /line-height:\s*1\.5;/, selector);
  }
  assert.match(stylesSource, /\.haolo-select-trigger > span\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(stylesSource, /\.haolo-select-option\s*\{[^}]*line-height:\s*max\(20px, 1\.5em\);/s);
  for (const selector of ["pending-media-label", "trading-alert-status", "execution-plan-card-status"]) {
    const block = stylesSource.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))[1];
    assert.match(block, /line-height:\s*max\([\d.]+px, 1\.5em\);/, selector);
  }
  const ticker = stylesSource.match(/\.trading-market-favorite-ticker\s*\{([^}]+)\}/)[1];
  assert.match(ticker, /height:\s*36px;/);
  assert.match(ticker, /gap:\s*0;/);
  assert.match(ticker, /padding:\s*0 8px;/);
});

test("text-clipping audit measures ink inside labels without ignoring untranslated language names", async () => {
  const source = await readFile(new URL("../scripts/text-clipping-audit.mjs", import.meta.url), "utf8");
  const detector = source.slice(0, source.indexOf("export function inspectClippedLabelStyles"));
  assert.match(detector, /metrics\.actualBoundingBoxDescent/);
  assert.match(detector, /metrics\.actualBoundingBoxAscent/);
  assert.match(detector, /ancestor = ancestor\.parentElement/);
  assert.doesNotMatch(detector, /closest\([^)]*data-i18n-skip/);
  assert.match(source, /"English gjpqy", "Ångström café", "简体中文", "繁體中文"/);
  assert.match(auditSource, /inspectClippedLabelStyles\.toString\(\)/);
});
