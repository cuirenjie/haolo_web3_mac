import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  APP_LANGUAGE_STORAGE_KEY,
  appLanguageLocale,
  appLanguageOptions,
  loadAppLanguage,
  normalizeAppLanguage,
  translateAppText,
} from "../src/renderer/app-language.mjs";
import { GENERATED_ENGLISH_UI_PHRASES } from "../src/renderer/app-language-en-generated.mjs";
import { GENERATED_TRADITIONAL_UI_PHRASES } from "../src/renderer/app-language-zh-tw-generated.mjs";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const languageSource = readFile(new URL("../src/renderer/app-language.mjs", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const userDataTransferSource = readFile(new URL("../src/main/user-data-transfer.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const indexSource = readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("application language safely defaults to English and exposes three supported locales", () => {
  assert.equal(APP_LANGUAGE_STORAGE_KEY, "haolo.appearance.language");
  assert.equal(loadAppLanguage({ getItem: () => null }), "en");
  assert.equal(loadAppLanguage({ getItem: () => "unsupported" }), "en");
  assert.equal(loadAppLanguage({ getItem: () => "zh-CN" }), "zh-CN");
  assert.equal(loadAppLanguage({ getItem: () => "zh-TW" }), "zh-TW");
  assert.equal(loadAppLanguage({ getItem: () => { throw new Error("blocked"); } }), "en");
  assert.equal(normalizeAppLanguage("en"), "en");
  assert.equal(appLanguageLocale("en"), "en-US");
  assert.equal(appLanguageLocale("zh-CN"), "zh-CN");
  assert.deepEqual(appLanguageOptions("en").map((option) => option.label), [
    "English",
    "Simplified Chinese",
    "Traditional Chinese",
  ]);
  assert.deepEqual(appLanguageOptions("zh-CN").map((option) => option.label), ["英语", "简体中文", "繁体中文"]);
  assert.deepEqual(appLanguageOptions("zh-TW").map((option) => option.label), ["英語", "簡體中文", "繁體中文"]);
});

test("shared UI translator covers English and full renderer character conversion for Traditional Chinese", () => {
  assert.equal(translateAppText("通用设置", "en"), "General");
  assert.equal(translateAppText("用户数据", "en"), "User data");
  assert.equal(translateAppText("选择界面语言", "en"), "Select interface language");
  assert.equal(translateAppText("开始", "en"), "Start");
  assert.equal(translateAppText("收", "en"), "Close");
  assert.equal(translateAppText("1日", "en"), "1 day");
  assert.equal(
    translateAppText("天才交易员，你好！我是 Haolo，你的全能交易助理。接下来我们会通过几段简短对话了解你的交易偏好。现在可以开始吗？", "en"),
    "Hello, trader! I'm Haolo, your all-in-one trading assistant. A few short questions will help me understand your trading preferences. Ready to begin?",
  );
  assert.equal(translateAppText("设置", "zh-TW"), "設定");
  assert.equal(translateAppText("用户数据", "zh-TW"), "使用者資料");
  assert.equal(translateAppText("简体中文", "zh-TW"), "簡體中文");
  assert.equal(translateAppText("永續", "en"), "Perpetual");
  assert.equal(translateAppText("使用者資料", "zh-CN"), "用户数据");
  assert.equal(translateAppText("自定義指標", "en"), "Custom indicators");
  assert.equal(translateAppText("Already English", "en"), "Already English");
  assert.equal(translateAppText("请输入任务说明", "en"), "Enter the mission statement");
  assert.equal(translateAppText("缠论", "en"), "Chan Theory");
  assert.equal(translateAppText("订单流", "en"), "Order Flow");
  assert.equal(translateAppText("波浪理论", "en"), "Elliott Wave Theory");
  assert.equal(translateAppText("威科夫", "en"), "Wyckoff Method");
  assert.equal(translateAppText("布林带", "en"), "Bollinger Bands");
  assert.equal(translateAppText("均线", "en"), "Moving Averages");
});

test("generated offline catalogs cover the renderer-owned global UI", () => {
  assert.ok(Object.keys(GENERATED_ENGLISH_UI_PHRASES).length >= 3_500);
  assert.equal(Object.keys(GENERATED_ENGLISH_UI_PHRASES).length, Object.keys(GENERATED_TRADITIONAL_UI_PHRASES).length);
  for (const value of Object.values(GENERATED_ENGLISH_UI_PHRASES)) {
    assert.doesNotMatch(value, /[\u3400-\u9fff]/u);
  }
});

test("general settings renders the language selector in the requested position and switches globally", async () => {
  const source = await rendererSource;
  const dialogBlock = sourceBlock(source, "function renderSettingsDialog", "function renderGitHubSettingsPanel");
  const languageBlock = sourceBlock(source, "function renderSettingsLanguageRow", "function renderSettingsThemeRow");
  const selectionBlock = sourceBlock(source, "function selectAppLanguage", "function selectAppFontSize");

  const userDataIndex = dialogBlock.indexOf("renderSettingsUserDataRow()");
  const languageIndex = dialogBlock.indexOf("renderSettingsLanguageRow()");
  const installPathIndex = dialogBlock.indexOf('class="settings-storage-row"');
  assert.ok(userDataIndex < languageIndex && languageIndex < installPathIndex);
  assert.match(languageBlock, /<span>语言<\/span>/);
  assert.match(languageBlock, /data-settings-language/);
  assert.match(languageBlock, /appLanguageOptions\(language\)/);
  assert.match(languageBlock, /aria-label="选择界面语言"/);
  assert.match(selectionBlock, /state\.settings\.language = language/);
  assert.match(selectionBlock, /applyAppLanguage\(language, \{ persist: true, root: document\.body \}\)/);
  assert.match(selectionBlock, /api\.setAppLanguage\?\.\(\{ language \}\)/);
  assert.match(selectionBlock, /render\(\)/);
  assert.match(selectionBlock, /state\.consumption\.loaded[\s\S]*loadConsumptionData\(\{ quiet: true, suppressError: true \}\)/);
  assert.match(source, /localizeAppTree\(root, state\.settings\.language\)/);
  assert.match(source, /observeAppLanguage\(document\.body\)/);
  assert.match(source, /isAppLanguage\(language\).*selectAppLanguage\(language\)/s);
  assert.match(await languageSource, /textLocalizationSources\.set\(node, \{ source, rendered: translated \}\)/);
  assert.match(await languageSource, /value !== previous\.rendered \? value : previous\.source/);
  assert.match(await languageSource, /function shouldSkipAttributeLocalization[\s\S]*element\?\.matches\?\.\("textarea"\)/);
  assert.match(await languageSource, /function localizeElementAttributes[\s\S]*shouldSkipAttributeLocalization\(element\)/);
});

test("strategy cards and dynamic membership agreements render from the active language", async () => {
  const source = await rendererSource;
  const strategyCards = sourceBlock(source, "function mySkillsPlazaCards", "function strategySkillPlazaCards");
  const indicatorCards = sourceBlock(source, "function indicatorSkillPlazaCards", "function renderMySkillsPage");
  const agreement = sourceBlock(
    source,
    "function renderRechargeMembershipAgreement",
    "function renderRechargePaymentState",
  );
  assert.match(strategyCards, /translateAppText\(strategy\.skill\.displayName, state\.settings\.language\)/);
  assert.match(strategyCards, /translateAppText\(strategy\.skill\.shortDescription, state\.settings\.language\)/);
  assert.match(indicatorCards, /translateAppText\(indicator\.skill\.displayName, state\.settings\.language\)/);
  assert.match(indicatorCards, /translateAppText\(indicator\.skill\.shortDescription, state\.settings\.language\)/);
  const englishAgreement = sourceBlock(agreement, 'if (language === "en")', 'if (language === "zh-TW")');
  assert.doesNotMatch(englishAgreement, /[\u3400-\u9fff]/u);
  assert.match(englishAgreement, /Membership Service Agreement/);
  assert.match(englishAgreement, /Order number/);
  assert.equal((source.match(/renderRechargeMembershipAgreement\(product, order\)/g) || []).length, 2);
  assert.match(source, /rechargePaymentAccountCopyAriaLabel\(network\)/);
  assert.match(source, /rechargePaymentQrAlt\(network\)/);
});

test("localized trading expert mentions stay English in the composer and canonicalize before routing", async () => {
  const source = await rendererSource;
  const mentionHelpers = sourceBlock(
    source,
    "function tradingExpertMentionGroupTokenLabel",
    "const GROUP_CHAT_QUANTITY_MIN",
  );
  assert.match(mentionHelpers, /language === "en"[\s\S]*Strategy[\s\S]*Indicator[\s\S]*Alert/);
  assert.match(mentionHelpers, /function canonicalizeTradingExpertMentionText/);
  assert.match(mentionHelpers, /tradingStrategyCatalog\(\)[\s\S]*tradingIndicatorCatalog\(\)[\s\S]*mentionTokens\[0\]/);
  assert.match(source, /const tradingExpertRoutingText = isTradingExpertThreadId\(threadId\)[\s\S]*canonicalizeTradingExpertMentionText\(text\)/);
  assert.match(source, /tradingStrategyMentionedByText\(tradingExpertRoutingText\)/);
  assert.match(source, /tradingAlertMentioned\(tradingExpertRoutingText\)/);
});

test("language initializes as English before boot and is persisted in renderer and main process", async () => {
  const [source, main, preload, index] = await Promise.all([rendererSource, mainSource, preloadSource, indexSource]);
  assert.match(source, /const INITIAL_APP_LANGUAGE = loadAppLanguage\(\);\s*applyAppLanguage\(INITIAL_APP_LANGUAGE\);/s);
  assert.ok(source.indexOf("applyAppLanguage(INITIAL_APP_LANGUAGE);") < source.indexOf("void boot();"));
  assert.match(source, /language: INITIAL_APP_LANGUAGE/);
  assert.match(main, /DEFAULT_APP_PREFERENCES = Object\.freeze\(\{\s*theme: "dark",\s*language: "en"/s);
  assert.match(main, /function normalizeAppLanguage\(value\)/);
  assert.match(main, /ipcMain\.handle\("app:setLanguage"/);
  assert.match(preload, /setAppLanguage: \(params\) => ipcRenderer\.invoke\("app:setLanguage", params\)/);
  assert.match(index, /<html lang="en-US" data-language="en">/);
});

test("language control defines complete light and dark interaction states", async () => {
  const styles = await stylesSource;
  const lightBlock = sourceBlock(styles, ".settings-language-row {", ".settings-data-button {");
  const darkBlock = sourceBlock(
    styles,
    'html[data-theme="dark"] .settings-language-select-wrap select {',
    'html[data-theme="dark"] .settings-switch {',
  );

  assert.match(lightBlock, /\.settings-language-select-wrap:hover select/);
  assert.match(lightBlock, /select:active/);
  assert.match(lightBlock, /select:open/);
  assert.match(lightBlock, /select:focus-visible/);
  assert.match(lightBlock, /select:disabled/);
  assert.match(lightBlock, /select option/);
  assert.match(darkBlock, /\.settings-language-select-wrap:hover select/);
  assert.match(darkBlock, /select:active/);
  assert.match(darkBlock, /select:open/);
  assert.match(darkBlock, /select:focus-visible/);
  assert.match(darkBlock, /select:disabled/);
  assert.match(darkBlock, /select option/);
  assert.match(darkBlock, /background: #202329/);
  assert.match(darkBlock, /color: #f2f5fa/);
});

test("CSS-generated interface copy switches among all three languages", async () => {
  const styles = await stylesSource;
  const englishVariables = sourceBlock(styles, ":root {", 'html[data-language="zh-CN"]');
  const simplifiedVariables = sourceBlock(styles, 'html[data-language="zh-CN"]', 'html[data-language="zh-TW"]');
  const traditionalVariables = sourceBlock(styles, 'html[data-language="zh-TW"]', 'html[data-font-size="small"]');
  assert.doesNotMatch(englishVariables, /[\u3400-\u9fff]/u);
  assert.match(simplifiedVariables, /--i18n-loading-conversation: "正在加载会话\.\.\."/);
  assert.match(traditionalVariables, /--i18n-loading-conversation: "正在載入對話\.\.\."/);
  assert.doesNotMatch(styles, /content:\s*"[^"\n]*[\u3400-\u9fff]/u);
  assert.equal((styles.match(/content: var\(--i18n-/g) || []).length, 5);
});

test("standalone notifications use the same persisted language", async () => {
  const main = await mainSource;
  const notificationBlock = sourceBlock(main, "function desktopNotificationHtml", "function desktopNotificationIconDataUrl");
  assert.match(main, /title: mainUiText\("taskCompleteTitle"\)/);
  assert.match(main, /body: mainUiText\("taskCompleteBody"\)/);
  assert.match(notificationBlock, /mainUiText\("settings", normalizedLanguage\)/);
  assert.match(notificationBlock, /mainUiText\("close", normalizedLanguage\)/);
  assert.match(notificationBlock, /appLanguageLocale\(normalizedLanguage\)/);
});

test("native dialogs receive localized copy from the persisted application language", async () => {
  const [main, transfer] = await Promise.all([mainSource, userDataTransferSource]);
  const mainCopyBlock = sourceBlock(main, "const MAIN_UI_COPY", "function mainUiText");
  const nativeEnglishCopy = sourceBlock(mainCopyBlock, "en: Object.freeze({", '"zh-CN": Object.freeze({');
  const transferCopyBlock = sourceBlock(main, "function userDataTransferCopy", "function consumptionExportCopy");
  const transferEnglishCopy = sourceBlock(transferCopyBlock, "en: {", '"zh-CN": {');
  assert.doesNotMatch(nativeEnglishCopy, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(transferEnglishCopy, /[\u3400-\u9fff]/u);
  assert.match(main, /function userDataTransferCopy\(language = appLanguage\(\)\)/);
  assert.equal((main.match(/copy: userDataTransferCopy\(\)/g) || []).length, 2);
  assert.match(main, /title: mainUiText\("selectGroupFolder"\)/);
  assert.match(main, /detail: mainUiText\("fileFolderImportDetail"\)/);
  assert.match(main, /title: mainUiText\("selectChromeUploadFile"\)/);
  assert.match(transfer, /copy\.exportLocationTitle \|\| "选择用户数据导出位置"/);
  assert.match(transfer, /copy\.importFileTitle \|\| "选择用户数据备份 ZIP 文件"/);
  assert.match(transfer, /title: copy\.confirmTitle \|\| "导入用户数据"/);
  assert.match(main, /copy: consumptionExportCopy\(\)/);
});

test("client-owned chat notices are localized while user and model content remain protected", async () => {
  const [renderer, language] = await Promise.all([rendererSource, languageSource]);
  const bubbleBlock = sourceBlock(renderer, "function renderTextBubble", "function executionPlanCandidateKey");
  const skipBlock = sourceBlock(language, "function shouldSkipLocalization", "function localizeTextNode");
  assert.match(renderer, /trading-preference-onboarding-bubble[\s\S]*message-text" data-i18n-owned/);
  assert.match(renderer, /multi-model-cluster-planning-bubble[\s\S]*message-text" data-i18n-owned/);
  assert.match(bubbleBlock, /shouldLocalizeAppOwnedMessage\(message, fromUser\)/);
  assert.match(bubbleBlock, /data-i18n-owned/);
  assert.match(skipBlock, /closest\?\.\(APP_OWNED_LOCALIZATION_SELECTOR\).*return false/s);
  assert.match(language, /\.message-text/);
});
