import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import {
  APP_LANGUAGE_STORAGE_KEY,
  appLanguageLocale,
  appLanguageOptions,
  applyAppLanguage,
  loadAppLanguage,
  normalizeAppLanguage,
  readStoredAppLanguage,
  resolveAppLanguagePreference,
  translateAppText,
  translateTradingAnnotationText,
  translateTradingPeriodLabel,
} from "../src/renderer/app-language.mjs";
import { GENERATED_ENGLISH_UI_PHRASES } from "../src/renderer/app-language-en-generated.mjs";
import { GENERATED_TRADITIONAL_UI_PHRASES } from "../src/renderer/app-language-zh-tw-generated.mjs";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const languageSource = readFile(new URL("../src/renderer/app-language.mjs", import.meta.url), "utf8");
const selectSource = readFile(new URL("../src/renderer/haolo-select.ts", import.meta.url), "utf8");
const workflowCanvasSource = readFile(new URL("../src/renderer/workflow-canvas.ts", import.meta.url), "utf8");
const externalModelSettingsSource = readFile(new URL("../src/renderer/external-model-settings.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const userDataTransferSource = readFile(new URL("../src/main/user-data-transfer.mjs", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");

test("model fallback and exhaustion notices translate in English and Traditional Chinese", () => {
  for (const text of [
    "模型执行异常，正在切换到 GPT-5.5 最高推理模式，保留当前任务进度继续处理。",
    "备用模型暂时不可用，稍后将再次使用 GPT-5.5 最高推理模式继续当前任务。",
    "已尝试 GPT-5.5 最高推理模式，自动恢复仍未完成。任务记录已保留，请稍后重试。",
    "自动恢复未能启动。任务记录已保留，请检查账户和服务状态后重试。",
  ]) {
    assert.doesNotMatch(translateAppText(text, "en"), /\p{Script=Han}/u);
    assert.notEqual(translateAppText(text, "zh-TW"), text);
  }
});
const indexSource = readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8");

test("group selection and encoded UI copy have complete English translations", () => {
  assert.equal(translateAppText("不选择分组", "en"), "No group");
  assert.equal(translateAppText("不選擇分組", "en"), "No group");
  assert.equal(translateAppText("正在加载会话记录...", "en"), "Loading conversation history...");
  assert.equal(translateAppText("不选择分组", "zh-CN"), "不选择分组");
  assert.equal(translateAppText("不选择分组", "zh-TW"), "不選擇分組");
});

test("generic chart drawing progress is localized without naming Chan analysis", () => {
  assert.equal(translateAppText("正在绘制盘面结构", "zh-CN"), "正在绘制盘面结构");
  assert.equal(translateAppText("正在绘制盘面结构", "en"), "Drawing chart structure");
  assert.equal(translateAppText("正在绘制盘面结构", "zh-TW"), "正在繪製盤面結構");
});

test("the WEB3 membership-expired error is localized in all interface languages", () => {
  assert.equal(translateAppText("会员到期", "zh-CN"), "会员到期");
  assert.equal(translateAppText("会员到期", "en"), "Membership expired");
  assert.equal(translateAppText("会员到期", "zh-TW"), "會員到期");
});

test("the recharge amount-after-fees warning is localized in all interface languages", () => {
  const warning = "扣除手续费后，到账金额必须和支付金额一致，精确到三位小数。";
  assert.equal(translateAppText(warning, "zh-CN"), warning);
  assert.equal(
    translateAppText(warning, "en"),
    "After fees are deducted, the amount received must match the payment amount, to exactly three decimal places.",
  );
  assert.equal(
    translateAppText(warning, "zh-TW"),
    "扣除手續費後，到賬金額必須和支付金額一致，精確到三位小數。",
  );
});

test("expired partial-payment review copy is localized without asking for another payment", () => {
  const message = "订单已过期且只收到部分款项，已转入人工核对；请勿继续付款。";
  assert.equal(translateAppText(message, "zh-CN"), message);
  assert.equal(
    translateAppText(message, "en"),
    "The order expired after receiving only part of the payment and is under manual review. Do not send another payment.",
  );
  assert.equal(
    translateAppText(message, "zh-TW"),
    "訂單已到期且只收到部分款項，已轉入人工核對；請勿繼續付款。",
  );
});

test("paid trial and free WEB3 membership copy is localized in all interface languages", () => {
  assert.equal(translateAppText("WEB3免费", "en"), "WEB3 Free");
  assert.equal(translateAppText("WEB3免费", "zh-TW"), "WEB3免費");
  assert.equal(translateAppText("体验版", "en"), "Trial");
  assert.equal(translateAppText("体验版", "zh-TW"), "體驗版");
  assert.equal(translateAppText("3天", "en"), "3 days");
  assert.equal(
    translateAppText("从开通时刻起精确 72 小时有效", "zh-TW"),
    "從開通時刻起精確 72 小時有效",
  );
  assert.equal(
    translateAppText("当前没有可用积分，请开通体验版或其他套餐后再提问", "en"),
    "You have no available points. Activate the trial or another plan before asking the model.",
  );
  assert.equal(
    translateAppText("当前未开通有效体验版或其他套餐，请先开通后再使用盘面分析", "en"),
    "Activate a valid trial or another plan before using market analysis.",
  );
  assert.equal(
    translateAppText("暂时无法验证会员权益，请稍后重试", "zh-TW"),
    "暫時無法驗證會員權益，請稍後重試",
  );
  assert.equal(translateAppText("确认支付信息", "en"), "Confirm payment details");
  assert.equal(translateAppText("生成支付信息", "zh-TW"), "產生支付資訊");
  const planDescriptions = [
    [
      "首次开通专享，体验 AI 行情解读与基础交易分析。",
      "A first-time offer for trying AI market insights and basic trading analysis.",
      "首次開通專享，體驗 AI 行情解讀與基礎交易分析。",
    ],
    [
      "适合日常看盘、行情问答与基础策略分析。",
      "For everyday market monitoring, market Q&A, and basic strategy analysis.",
      "適合日常看盤、行情問答與基礎策略分析。",
    ],
    [
      "适合持续行情研判、多策略分析与交易计划制定。",
      "For ongoing market assessment, multi-strategy analysis, and trading-plan development.",
      "適合持續行情研判、多策略分析與交易計劃制定。",
    ],
    [
      "适合高频行情分析、复杂策略研究与专业交易辅助。",
      "For high-frequency market analysis, advanced strategy research, and professional trading assistance.",
      "適合高頻行情分析、複雜策略研究與專業交易輔助。",
    ],
  ];
  for (const [simplified, english, traditional] of planDescriptions) {
    assert.equal(translateAppText(simplified, "en"), english);
    assert.equal(translateAppText(simplified, "zh-TW"), traditional);
  }
});

test("the composer resource hint translates as a complete phrase in every language", () => {
  const hint = "点击+调用策略、指标、预警和文件";
  const traditional = "點擊+調用策略、指標、預警和檔案";
  const english = "Click + to use strategies, indicators, alerts, and files";
  assert.equal(translateAppText(hint, "zh-CN"), hint);
  assert.equal(translateAppText(hint, "zh-TW"), traditional);
  assert.equal(translateAppText(hint, "en"), english);
  assert.equal(translateAppText(traditional, "en"), english);
});

test("chart annotations translate whole statements without changing prices or polarity", () => {
  for (const [direction, englishDirection, fractal, englishFractal] of [
    ["上", "up", "顶", "top"], ["下", "down", "底", "bottom"],
  ]) {
    assert.equal(
      translateTradingAnnotationText(`末端向${direction}笔：77,600 → 80,499.9；最新确认为${fractal}分型。`, "en"),
      `Latest ${englishDirection} stroke: 77,600 → 80,499.9; confirmed ${englishFractal} fractal.`,
    );
  }
  for (const [position, englishPosition] of [
    ["位于中枢上方", "above"], ["位于中枢下方", "below"], ["仍在中枢内部", "inside"],
  ]) {
    const source = `最近中枢 78,579.7–79,180.2：最新收盘${position}；关注离开后的回抽确认。`;
    assert.equal(translateTradingAnnotationText(source, "en"), `Latest central zone 78,579.7–79,180.2; close ${englishPosition} the zone. Watch the post-breakout retest.`);
    assert.equal(translateTradingAnnotationText(source, "zh-CN"), source);
    assert.match(translateTradingAnnotationText(source, "zh-TW"), /中樞/);
  }
  const reference = "前序关键顶分型 79,180.2：最近结构参照；升回关键高点上方则下行结构转弱。";
  assert.equal(translateTradingAnnotationText(reference, "en"), "Prior top fractal 79,180.2 (structure reference). Above the key high weakens the down structure.");
  assert.equal(translateTradingAnnotationText("盘面结论：The latest stroke is up.", "en"), "Summary: The latest stroke is up.");
  for (const source of ["盘面结论：中枢震荡后反弹，后续笔尚未确认。", "Custom 𠀀 annotation", "Medium枢 still active"]) {
    assert.equal(translateTradingAnnotationText(source, "en"), source);
  }
  assert.equal(translateTradingAnnotationText("Fib 0.618: 79,180.2", "en"), "Fib 0.618: 79,180.2");
  for (const [source, expected] of [
    ["主计数失效 77,600", "main count invalidation 77,600"],
    ["[1H] 上方止损集中区（BSL）", "[1H] buy-side liquidity (BSL)"],
    ["ST · 二次测试", "ST · secondary test"],
    ["顶背离 · RSI确认", "bearish divergence · RSI confirmation"],
    ["低位金叉 · 22.5", "low-zone bullish crossover · 22.5"],
    ["主动买入失衡区（2处）", "buy imbalance zone (2 zones)"],
    ["关键价位：上破 80,499.9 偏多｜跌破 77,600 偏空｜区间内等待", "key levels: above 80,499.9 bullish | below 77,600 bearish | wait inside the range"],
  ]) assert.equal(translateTradingAnnotationText(source, "en"), expected);
});

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("application language safely defaults to Simplified Chinese and exposes three supported locales", () => {
  assert.equal(APP_LANGUAGE_STORAGE_KEY, "haolo.appearance.language");
  assert.equal(translateAppText("设置"), "设置");
  assert.equal(loadAppLanguage({ getItem: () => null }), "zh-CN");
  assert.equal(loadAppLanguage({ getItem: () => "unsupported" }), "zh-CN");
  assert.equal(loadAppLanguage({ getItem: () => "en" }), "en");
  assert.equal(loadAppLanguage({ getItem: () => "zh-CN" }), "zh-CN");
  assert.equal(loadAppLanguage({ getItem: () => "zh-TW" }), "zh-TW");
  assert.equal(loadAppLanguage({ getItem: () => { throw new Error("blocked"); } }), "zh-CN");
  assert.equal(readStoredAppLanguage({ getItem: () => null }), null);
  assert.equal(readStoredAppLanguage({ getItem: () => "unsupported" }), null);
  assert.equal(readStoredAppLanguage({ getItem: () => "zh-CN" }), "zh-CN");
  assert.equal(readStoredAppLanguage({ getItem: () => { throw new Error("blocked"); } }), null);
  assert.equal(resolveAppLanguagePreference({
    currentLanguage: "en",
    mainLanguage: "zh-CN",
    mainPreferenceStored: true,
    rendererLanguage: "en",
  }), "zh-CN");
  assert.equal(resolveAppLanguagePreference({
    currentLanguage: "en",
    mainLanguage: "en",
    mainPreferenceStored: false,
    rendererLanguage: "zh-CN",
  }), "zh-CN");
  assert.equal(resolveAppLanguagePreference({
    currentLanguage: "en",
    mainLanguage: "zh-TW",
    mainPreferenceStored: false,
    rendererLanguage: null,
  }), "zh-TW");
  assert.equal(resolveAppLanguagePreference({
    currentLanguage: "zh-CN",
    mainLanguage: "en",
    mainPreferenceStored: true,
    rendererLanguage: null,
    userSelected: true,
  }), "zh-CN");
  assert.equal(normalizeAppLanguage("en"), "en");
  assert.equal(normalizeAppLanguage("unsupported"), "zh-CN");
  assert.equal(appLanguageLocale("en"), "en-US");
  assert.equal(appLanguageLocale("zh-CN"), "zh-CN");
});

test("language choices always use native names regardless of the active language", () => {
  try {
    for (const language of ["en", "zh-CN", "zh-TW"]) {
      applyAppLanguage(language);
      assert.deepEqual(appLanguageOptions(), [
        { value: "en", label: "English" },
        { value: "zh-CN", label: "简体中文" },
        { value: "zh-TW", label: "繁體中文" },
      ]);
    }
  } finally {
    applyAppLanguage("en");
  }
});

test("selects can protect native option and selected labels without skipping the accessible description", async () => {
  const transpiled = ts.transpileModule(await selectSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const { renderHaoloSelect } = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
  const options = appLanguageOptions();
  for (const { value, label } of options) {
    const config = { id: "settings-language", value, options, ariaLabel: "选择界面语言" };
    const html = renderHaoloSelect({ ...config, translateLabels: false });
    assert.match(html, new RegExp(`data-haolo-select-label data-i18n-skip translate="no">${label}</span>`));
    const optionTags = [...html.matchAll(/<button\b[^>]*role="option"[^>]*>([^<]*)<\/button>/g)];
    assert.deepEqual(optionTags.map((match) => match[1]), options.map((option) => option.label));
    for (const [tag] of optionTags) assert.match(tag, /data-i18n-skip translate="no"/);
    assert.match(html, /<span id="settings-language-label" class="haolo-select-sr-label">选择界面语言<\/span>/);
    assert.doesNotMatch(renderHaoloSelect(config), /data-i18n-skip|translate="no"/);
  }
});

test("shared UI translator covers English and full renderer character conversion for Traditional Chinese", () => {
  assert.equal(translateAppText("通用设置", "en"), "General");
  assert.equal(translateAppText("用户数据", "en"), "User data");
  assert.equal(translateAppText("选择界面语言", "en"), "Select interface language");
  assert.equal(translateAppText("开始", "en"), "Start");
  assert.equal(translateAppText("收", "en"), "Close");
  assert.equal(translateAppText("1日", "en"), "1 day");
  assert.equal(translateTradingPeriodLabel("1周", "en"), "1W");
  assert.equal(translateTradingPeriodLabel("1日", "en"), "1D");
  assert.equal(translateTradingPeriodLabel("5分", "en"), "5M");
  assert.equal(translateTradingPeriodLabel("15分", "en"), "15M");
  assert.equal(translateTradingPeriodLabel("1时", "en"), "1H");
  assert.equal(translateTradingPeriodLabel("1秒", "en"), "1S");
  assert.equal(translateTradingPeriodLabel("4時", "en"), "4H");
  assert.equal(translateTradingPeriodLabel("1月", "en"), "1MO");
  assert.equal(translateTradingPeriodLabel("1年", "en"), "1Y");
  assert.equal(translateTradingPeriodLabel("1时", "zh-TW"), "1時");
  assert.equal(translateAppText("周期已自动应用。", "en"), "Intervals applied automatically.");
  assert.equal(translateAppText("周期已自动应用。", "zh-TW"), "週期已自動套用。");
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
  assert.equal(translateAppText("联系Telegram", "en"), "Contact Telegram");
  assert.equal(translateAppText("联系客服", "en"), "Contact support");
  assert.equal(translateAppText("联系Telegram", "zh-TW"), "聯絡 Telegram");
  assert.equal(translateAppText("联系客服", "zh-TW"), "聯絡客服");
  assert.equal(translateAppText("AI 文字标注字号调节", "en"), "Adjust AI annotation text size");
  assert.equal(
    translateAppText("当前图表全部 AI 标注字号，所在标注当前 16px", "en"),
    "All AI annotation text sizes on the current chart; selected annotation is currently 16px",
  );
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
  const taskbarIndex = dialogBlock.indexOf('renderSettingsSwitchRow("固定在桌面任务栏"');
  const installPathIndex = dialogBlock.indexOf('class="settings-storage-row"');
  assert.ok(languageIndex < taskbarIndex && taskbarIndex < userDataIndex && userDataIndex < installPathIndex);
  assert.match(languageBlock, /<span>语言<\/span>/);
  assert.match(languageBlock, /data-settings-language/);
  assert.match(languageBlock, /appLanguageOptions\(\)/);
  assert.match(languageBlock, /translateLabels: false/);
  assert.match(languageBlock, /ariaLabel: "选择界面语言"/);
  assert.match(languageBlock, /renderHaoloSelect\(/);
  assert.doesNotMatch(languageBlock, /<select\b/);
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
  assert.equal((source.match(/renderRechargeMembershipAgreement\(product, order, network\)/g) || []).length, 2);
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
  assert.match(source, /const tradingExpertRoutingText = isTradingExpertExecutionThreadId\(threadId\)[\s\S]*canonicalizeTradingExpertMentionText\(text\)/);
  assert.match(source, /tradingStrategyMentionedByText\(tradingExpertRoutingText\)/);
  assert.match(source, /tradingAlertMentioned\(tradingExpertRoutingText\)/);
});

test("language initializes before boot and reconciles renderer and main-process persistence without clobbering", async () => {
  const [source, main, preload, index] = await Promise.all([rendererSource, mainSource, preloadSource, indexSource]);
  assert.match(source, /const INITIAL_STORED_APP_LANGUAGE = readStoredAppLanguage\(\);/);
  assert.match(source, /const INITIAL_APP_LANGUAGE = INITIAL_STORED_APP_LANGUAGE \|\| loadAppLanguage\(\);\s*applyAppLanguage\(INITIAL_APP_LANGUAGE\);/s);
  assert.ok(source.indexOf("applyAppLanguage(INITIAL_APP_LANGUAGE);") < source.indexOf("void boot();"));
  assert.match(source, /language: INITIAL_APP_LANGUAGE/);
  assert.doesNotMatch(sourceBlock(source, "ensureBrowserDesktopApi();", 'document.addEventListener("visibilitychange"'), /api\.setAppLanguage/);
  assert.match(source, /reconcileStartupAppLanguage\(defaults\.language, defaults\.languagePreferenceStored === true\)/);
  assert.match(source, /resolveAppLanguagePreference\(\{[\s\S]*mainPreferenceStored,[\s\S]*rendererLanguage: storedRendererLanguage,[\s\S]*userSelected: appLanguageSelectionRevision > 0/);
  assert.match(main, /DEFAULT_APP_PREFERENCES = Object\.freeze\(\{\s*theme: "light",\s*language: "zh-CN"/s);
  assert.match(main, /function normalizeAppLanguage\(value\) \{\s*return value === "en" \|\| value === "zh-TW" \? value : "zh-CN";\s*\}/s);
  assert.match(main, /function appLanguagePreferenceStored\(\)/);
  assert.match(main, /languagePreferenceStored: appLanguagePreferenceStored\(\)/);
  assert.match(main, /ipcMain\.handle\("app:setLanguage"/);
  assert.match(preload, /setAppLanguage: \(params\) => ipcRenderer\.invoke\("app:setLanguage", params\)/);
  assert.match(index, /<html lang="zh-CN" data-language="zh-CN">/);
});

test("language control defines complete light and dark interaction states", async () => {
  const styles = await stylesSource;
  const lightBlock = sourceBlock(styles, ".haolo-select {", ".settings-data-button {");
  const darkBlock = sourceBlock(
    styles,
    'html[data-theme="dark"] .haolo-select-trigger {',
    'html[data-theme="dark"] .settings-switch {',
  );

  assert.match(lightBlock, /\.haolo-select-trigger:hover:not\(:disabled\)/);
  assert.match(lightBlock, /\.haolo-select-trigger:active:not\(:disabled\)/);
  assert.match(lightBlock, /\.haolo-select\.open \.haolo-select-trigger/);
  assert.match(lightBlock, /\.haolo-select-trigger:focus-visible/);
  assert.match(lightBlock, /\.haolo-select-trigger:disabled/);
  assert.match(lightBlock, /\.haolo-select-option\.selected/);
  assert.match(darkBlock, /\.haolo-select-trigger:hover:not\(:disabled\)/);
  assert.match(darkBlock, /\.haolo-select-trigger:active:not\(:disabled\)/);
  assert.match(darkBlock, /\.haolo-select\.open \.haolo-select-trigger/);
  assert.match(darkBlock, /\.haolo-select-trigger:focus-visible/);
  assert.match(darkBlock, /\.haolo-select-trigger:disabled/);
  assert.match(darkBlock, /\.haolo-select-option\.selected/);
  assert.match(darkBlock, /background: #202329/);
  assert.match(darkBlock, /color: #f2f5fa/);
  for (const block of [lightBlock, darkBlock]) {
    assert.match(block, /\.haolo-select-menu\s*\{/);
    assert.match(block, /\.haolo-select-option:focus-visible/);
    assert.match(block, /\.haolo-select-option:active:not\(:disabled\)/);
    assert.match(block, /\.haolo-select-option:disabled/);
  }
});

test("HaoLo select preserves listbox semantics and keyboard interaction", async () => {
  const source = await selectSource;
  assert.match(source, /aria-haspopup="listbox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-selected=/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /menu\.addEventListener\("mousedown"/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /input\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(source, /spaceBelow < menuHeight \+ 6 && spaceAbove > spaceBelow/);
});

test("runtime language audit uses the same pointer interaction as users and verifies reload persistence", async () => {
  const audit = await readFile(new URL("../scripts/audit-i18n-layout.mjs", import.meta.url), "utf8");
  const switchBlock = sourceBlock(audit, "async function switchLanguage", "async function verifyLanguageSurvivesReload");
  assert.match(switchBlock, /data-haolo-select-trigger/);
  assert.match(switchBlock, /data-haolo-select-value/);
  assert.match(switchBlock, /nativeClick/);
  assert.doesNotMatch(switchBlock, /dispatchEvent/);
  assert.match(switchBlock, /storedValue/);
  assert.match(switchBlock, /applied\.selectedLabel !== nativeLabels\[language\]/);
  assert.match(switchBlock, /JSON\.stringify\(applied\.optionLabels\)/);
  const nativeClickBlock = sourceBlock(audit, "async function nativeClick", "async function click");
  assert.match(nativeClickBlock, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(nativeClickBlock, /element\.click\(\)/);
  assert.match(audit, /function verifyLanguageTransitionMatrix/);
  assert.match(audit, /for \(const source of languages\)/);
  assert.match(audit, /for \(const target of languages\)/);
  assert.match(audit, /for \(const language of \["en", "zh-CN", "zh-TW"\]\)/);
  assert.match(audit, /verifyLanguageSurvivesReload\(targetWindow, language\)/);
  assert.match(audit, /targetWindow\.reload\(\)/);
});

test("renderer has no remaining visible native option boxes", async () => {
  const sources = await Promise.all([rendererSource, workflowCanvasSource, externalModelSettingsSource]);
  const selectTags = sources.flatMap((source) => [...source.matchAll(/<select\b[^>]*>/g)].map((match) => match[0]));
  assert.ok(selectTags.length > 0, "expected hidden compatibility selects to remain covered");
  for (const tag of selectTags) assert.match(tag, /\bhidden\b|aria-hidden="true"/);
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
  const reportBlock = sourceBlock(renderer, "function appendTradingExpertReport", "function tradingAlertMentioned");
  const planCardBlock = sourceBlock(renderer, "function renderExecutionPlanCardContent", "function renderMessageExecutionPlan");
  const skipBlock = sourceBlock(language, "function shouldSkipLocalization", "function localizeTextNode");
  assert.match(renderer, /trading-preference-onboarding-bubble[\s\S]*message-text" data-i18n-owned/);
  assert.match(renderer, /multi-model-cluster-planning-bubble[\s\S]*message-text" data-i18n-owned/);
  assert.match(bubbleBlock, /shouldLocalizeAppOwnedMessage\(message, fromUser\)/);
  assert.match(bubbleBlock, /const displayText = text/);
  assert.doesNotMatch(bubbleBlock, /englishSafeAssistantText/);
  assert.match(bubbleBlock, /data-i18n-owned/);
  assert.match(reportBlock, /const visibleText = String\(text \|\| ""\)/);
  assert.doesNotMatch(reportBlock, /englishSafeAssistantText/);
  assert.match(planCardBlock, /const visibleContent = String\(content \|\| ""\)/);
  assert.doesNotMatch(planCardBlock, /englishSafeAssistantText/);
  assert.match(skipBlock, /closest\?\.\(APP_OWNED_LOCALIZATION_SELECTOR\).*return false/s);
  assert.match(language, /\.message-text/);
  assert.match(language, /\.execution-plan-card-content/);
  assert.doesNotMatch(renderer, /This response could not be displayed because it was not generated entirely in English/);
  assert.doesNotMatch(language, /Annotation unavailable in English|Summary unavailable in English/);
});
