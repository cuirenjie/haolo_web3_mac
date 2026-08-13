import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  binanceAccountResendCountdown,
  createBinanceAccountUiState,
  renderBinanceAccountDialog,
  renderBinanceAccountPage,
  resetBinanceAccountDialog,
} from "../src/renderer/binance-account-ui.ts";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const preloadSource = readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const desktopMainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const serviceSource = readFile(new URL("../src/main/binance-account/service.mjs", import.meta.url), "utf8");
const uiSource = readFile(new URL("../src/renderer/binance-account-ui.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

test("account navigation replaces the center canvas while preserving both side panels", async () => {
  const source = await rendererSource;
  assert.match(source, /type ViewId[\s\S]*\| "account"/);
  assert.match(source, /function openBinanceAccountPage[\s\S]*state\.activeView = "account"/);
  assert.match(
    source,
    /state\.activeView === "account"[\s\S]*renderChatList\(\)[\s\S]*renderBinanceAccountPage\(state\.binanceAccount\)[\s\S]*renderAgentPanel\(thread\)/,
  );
  assert.match(source, /data-conversation-static-action="account"/);
  assert.match(source, /const accountActive = state\.activeView === "account"/);
  assert.match(
    source,
    /const tradingExpertPanelLayout =\s*tradingExpertLayout \|\|\s*\(state\.activeView === "account"[\s\S]*isTradingExpertThreadId\(thread\?\.id\)\)/,
  );
  assert.match(source, /tradingExpertPanelLayout \? "trading-expert-layout" : ""/);
  assert.match(source, /workspaceHasConversationList \? renderLeftPanelToggle\(\) : ""/);
  assert.doesNotMatch(
    source.slice(source.indexOf("function renderWindowControls"), source.indexOf("function renderLeftPanelToggle")),
    /renderLeftPanelToggle\(\)/,
  );
  assert.match(
    source,
    /function openBinanceAccountPage\(\)[\s\S]*restoreTradingExpertChartFocusLayout\(\)[\s\S]*state\.rightCollapsed = false/,
  );
  assert.match(
    source,
    /function toggleLeftPanelCollapsed\(\)[\s\S]*state\.activeView !== "chat" && state\.activeView !== "account"[\s\S]*state\.leftCollapsed = !state\.leftCollapsed/,
  );
  assert.match(
    source,
    /action === "select-section"[\s\S]*state\.binanceAccount\.activeSection = section;[\s\S]*render\(\)/,
  );
  assert.match(
    source,
    /state\.activeView === "chat" \|\| state\.activeView === "account"\) &&\s*state\.rightCollapsed/,
  );
});

test("unbound state and binding dialog match the complete secure flow", () => {
  const state = createBinanceAccountUiState();
  state.loaded = true;
  state.status = {
    bound: false,
    apiKeyMasked: null,
    boundAt: null,
    updatedAt: null,
    secureStorageAvailable: true,
    emailMasked: "jo****ec@qq.com",
  };
  const page = renderBinanceAccountPage(state);
  assert.match(page, /还未绑定 API/);
  assert.match(page, /data-binance-account-action="open-dialog"/);
  assert.match(page, /查看教程/);
  assert.doesNotMatch(page, /binance-account-page-header|binance-account-brand-mark|binance-account-kicker/);
  assert.match(page, /<rect x="18" y="26" width="84" height="68" rx="16"><\/rect>/);
  assert.match(page, /<path d="M55 60h29M75 60v9M66 60v6"><\/path>/);

  state.dialog.open = true;
  state.dialog.challengeId = "challenge-id";
  state.dialog.emailMasked = "jo****ec@qq.com";
  state.dialog.resendReadyAt = Date.now() + 60_000;
  const dialog = renderBinanceAccountDialog(state);
  assert.match(dialog, /绑定 Binance API/);
  assert.match(dialog, /name="apiKey"/);
  assert.match(dialog, /name="apiSecret" type="password"/);
  assert.match(dialog, /name="code"[\s\S]*autocomplete="one-time-code"/);
  assert.match(dialog, /jo\*\*\*\*ec@qq\.com/);
  assert.match(dialog, /系统安全存储加密保存/);
  assert.match(dialog, /不会进入聊天、日志或数据导出/);
  assert.ok(binanceAccountResendCountdown(Date.now() + 59_500) >= 59);

  state.dialog.apiKey = "temporary-key";
  state.dialog.apiSecret = "temporary-secret";
  state.dialog.code = "123456";
  resetBinanceAccountDialog(state);
  assert.equal(state.dialog.open, false);
  assert.equal(state.dialog.apiKey, "");
  assert.equal(state.dialog.apiSecret, "");
  assert.equal(state.dialog.code, "");
});

test("removal dialog requires email verification and never asks for Binance credentials", () => {
  const state = createBinanceAccountUiState();
  state.loaded = true;
  state.status = {
    bound: true,
    apiKeyMasked: "ABCD••••WXYZ",
    boundAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    secureStorageAvailable: true,
    emailMasked: "jo****ec@qq.com",
  };
  resetBinanceAccountDialog(state, "remove");
  state.dialog.open = true;
  state.dialog.challengeId = "remove-challenge";
  state.dialog.emailMasked = "jo****ec@qq.com";

  const dialog = renderBinanceAccountDialog(state);
  assert.match(dialog, /验证邮箱并解除绑定/);
  assert.match(dialog, /data-binance-account-form-mode="remove"/);
  assert.match(dialog, /当前 Haolo 账号的邮箱/);
  assert.match(dialog, /name="code"[\s\S]*autocomplete="one-time-code"/);
  assert.match(dialog, /jo\*\*\*\*ec@qq\.com/);
  assert.match(dialog, /验证并解除绑定/);
  assert.match(dialog, /此操作无法撤销/);
  assert.doesNotMatch(dialog, /name="apiKey"|name="apiSecret"/);
  assert.match(dialog, /class="binance-account-submit danger" disabled/);

  state.dialog.code = "123456";
  const readyDialog = renderBinanceAccountDialog(state);
  assert.match(readyDialog, /class="binance-account-submit danger" >/);
});

test("bound account separates assets, positions, and real position history into tabs", () => {
  const state = createBinanceAccountUiState();
  state.loaded = true;
  state.status = {
    bound: true,
    apiKeyMasked: "ABCD••••WXYZ",
    boundAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    secureStorageAvailable: true,
  };
  state.snapshot = accountSnapshot();
  const page = renderBinanceAccountPage(state);
  assert.equal(state.activeSection, "assets");
  assert.match(page, /class="trading-alert-filters binance-account-tabs"[^>]*aria-label="账户分类"/);
  assert.match(page, /class="binance-account-toolbar-actions" aria-label="账户操作"/);
  assert.match(page, /data-binance-account-section="assets"[^>]*aria-pressed="true"[^>]*>资产<\/button>/);
  assert.match(page, /data-binance-account-section="positions"[^>]*>持仓<\/button>/);
  assert.match(page, /data-binance-account-section="history"[^>]*>仓位历史<\/button>/);
  assert.match(page, /预估总资产/);
  assert.match(page, /3,938\.95088/);
  assert.match(page, /今日盈亏/);
  assert.match(page, /今日盈亏 <strong class="negative">-\$14\.32 \(-0\.36%\)<\/strong>/);
  assert.match(page, /保证金余额/);
  assert.match(page, /今日已实现盈亏 <strong class="binance-account-realized-value negative">-\$2\.22<\/strong>/);
  assert.match(page, /钱包余额 \(USD\)/);
  assert.match(page, /未实现盈亏 \(USD\)/);
  assert.doesNotMatch(page, /当前持仓|ETHUSDT|投资回报率/);
  assert.doesNotMatch(page, /--0\.36%/);
  assert.doesNotMatch(page, /binance-account-summary-actions/);
  const refreshButton = page.match(/<button[^>]*class="binance-account-action-icon-button refresh"[^>]*data-binance-account-action="refresh"[^>]*>([\s\S]*?)<\/button>/);
  const removeButton = page.match(/<button[^>]*class="binance-account-action-icon-button unlink"[^>]*data-binance-account-action="remove"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(refreshButton);
  assert.ok(removeButton);
  assert.match(refreshButton[0], /aria-label="刷新账户数据"[^>]*aria-busy="false"[^>]*title="刷新"/);
  assert.match(removeButton[0], /aria-label="解除绑定"[^>]*title="解除绑定"/);
  assert.match(refreshButton[1], /<svg[^>]*aria-hidden="true">/);
  assert.match(removeButton[1], /<svg[^>]*aria-hidden="true">/);
  assert.doesNotMatch(refreshButton[1], /刷新/);
  assert.doesNotMatch(removeButton[1], /解除绑定/);
  assert.equal((page.match(/class="binance-account-summary-heading"/g) || []).length, 2);
  assert.match(page, /class="binance-account-summary-heading">\s*<h2>预估总资产<\/h2>\s*<button[^>]*class="binance-account-visibility-button"/s);
  assert.match(page, /class="binance-account-summary-heading">\s*<h2>保证金余额<\/h2>\s*<button[^>]*class="binance-account-visibility-button"/s);
  assert.doesNotMatch(page, /binance-account-page-header|binance-account-brand-mark/);
  assert.doesNotMatch(page, /Binance 钱包总览|USDⓈ-M 合约账户|个 USDⓈ-M 仓位|只读模式 · 数据更新时间|账户当前没有未平仓仓位/);
  assert.doesNotMatch(page, /binance-account-usd-equivalent/);
  assert.doesNotMatch(page, /<footer aria-label="只读账户操作">/);
  assert.doesNotMatch(page, /只读账户连接不支持(?:修改杠杆|设置止盈止损|平仓)/);
  assert.doesNotMatch(page, /apiSecret|temporary-secret/);

  state.activeSection = "positions";
  const positionsPage = renderBinanceAccountPage(state);
  assert.match(positionsPage, /data-binance-account-section="positions"[^>]*aria-pressed="true"/);
  assert.match(positionsPage, /<section class="binance-account-positions" aria-label="持仓">/);
  assert.doesNotMatch(positionsPage, /当前持仓/);
  assert.match(positionsPage, /ETHUSDT/);
  assert.match(positionsPage, /全仓 50X/);
  assert.match(positionsPage, /投资回报率/);
  assert.match(positionsPage, /<span>投资回报率<\/span>\s*<strong>-2\.57%<\/strong>/);
  assert.doesNotMatch(positionsPage, /预估总资产|保证金余额|--2\.57%/);
  assert.match(positionsPage, /class="binance-account-toolbar-actions"/);
  assert.match(positionsPage, /data-binance-account-action="refresh"/);
  assert.match(positionsPage, /data-binance-account-action="remove"/);

  state.activeSection = "history";
  const historyPage = renderBinanceAccountPage(state);
  assert.match(historyPage, /data-binance-account-section="history"[^>]*aria-pressed="true"/);
  assert.match(historyPage, /class="binance-account-scroll history" tabindex="0"/);
  assert.match(historyPage, /<section class="binance-account-position-history" aria-label="仓位历史">/);
  assert.doesNotMatch(historyPage, /binance-account-history-period|U 本位合约/);
  assert.match(historyPage, /TUTUSDT/);
  assert.match(historyPage, /全仓 做空/);
  assert.match(historyPage, /全部平仓/);
  assert.match(historyPage, /已实现盈亏 \(USDT\)/);
  assert.match(historyPage, /收益率/);
  assert.match(historyPage, /已平仓量 \(TUT\)/);
  assert.match(historyPage, /开仓价格/);
  assert.match(historyPage, /平仓均价/);
  assert.match(historyPage, /\+0\.01 USDT/);
  assert.match(historyPage, /\+1\.34%/);
  assert.doesNotMatch(historyPage, /最大未平仓合约量|预估总资产|保证金余额/);

  state.activeSection = "assets";

  const profitableSnapshot = accountSnapshot();
  profitableSnapshot.realizedPnlToday = 0.13;
  state.snapshot = profitableSnapshot;
  const profitablePage = renderBinanceAccountPage(state);
  assert.match(profitablePage, /今日已实现盈亏 <strong class="binance-account-realized-value positive">\+\$0\.13<\/strong>/);

  state.balancesVisible = false;
  const hiddenPage = renderBinanceAccountPage(state);
  assert.match(hiddenPage, /今日已实现盈亏 <strong class="binance-account-realized-value neutral">••••<\/strong>/);
  state.balancesVisible = true;

  state.refreshing = true;
  const refreshingPage = renderBinanceAccountPage(state);
  assert.match(refreshingPage, /class="binance-account-action-icon-button refresh refreshing"[^>]*aria-label="正在刷新账户数据"[^>]*aria-busy="true"[^>]*title="正在刷新"[^>]*disabled/);
  assert.match(refreshingPage, /class="binance-account-action-icon-button unlink"[^>]*data-binance-account-action="remove"[^>]*disabled/);

  state.loading = true;
  const backgroundRefreshPage = renderBinanceAccountPage(state);
  assert.match(backgroundRefreshPage, /预估总资产/);
  assert.doesNotMatch(backgroundRefreshPage, /正在读取 Binance 账户/);
});

test("account re-entry keeps the last successful snapshot and rate-limits automatic refresh", async () => {
  const [renderer, preload, desktopMain] = await Promise.all([
    rendererSource,
    preloadSource,
    desktopMainSource,
  ]);
  const loader = renderer.slice(
    renderer.indexOf("async function loadBinanceAccountPage"),
    renderer.indexOf("async function refreshBinanceAccountSnapshot"),
  );
  assert.match(loader, /const hasCachedView = Boolean\([\s\S]*accountState\.snapshot/);
  assert.match(loader, /hasCachedView && Date\.now\(\) < accountState\.autoRefreshAfter/);
  assert.match(loader, /if \(binanceAccountLoadPromise\) return binanceAccountLoadPromise/);
  assert.match(loader, /accountState\.loading = !hasCachedView/);
  assert.match(loader, /账户数据暂时未更新，仍显示上次成功数据/);
  assert.doesNotMatch(loader, /accountState\.snapshot = null/);
  assert.match(renderer, /getBinanceAccountSnapshot\(\{ force: true \}\)/);
  assert.match(preload, /getBinanceAccountSnapshot: \(params\) => ipcRenderer\.invoke\("binanceAccount:getSnapshot", params\)/);
  assert.match(desktopMain, /snapshot\(owner\.ownerId, \{ force: params\?\.force === true \}\)/);
});

test("renderer bridge reuses Haolo OTP and exposes no order or credential-read IPC", async () => {
  const [renderer, preload, desktopMain, service, ui] = await Promise.all([
    rendererSource,
    preloadSource,
    desktopMainSource,
    serviceSource,
    uiSource,
  ]);
  for (const channel of [
    "binanceAccount:getStatus",
    "binanceAccount:sendOtp",
    "binanceAccount:bind",
    "binanceAccount:getSnapshot",
    "binanceAccount:remove",
  ]) {
    assert.ok(preload.includes(channel), `missing preload channel ${channel}`);
    assert.ok(desktopMain.includes(channel), `missing main channel ${channel}`);
  }
  const binanceHandlers = desktopMain.slice(
    desktopMain.indexOf('ipcMain.handle("binanceAccount:getStatus"'),
    desktopMain.indexOf('ipcMain.handle("youle:completeRegistration"'),
  );
  assert.match(binanceHandlers, /assertExternalModelsIpcSender\(event\)/);
  assert.match(binanceHandlers, /getYouleApiClient\(\)\.sendOtp/);
  assert.match(binanceHandlers, /getYouleApiClient\(\)\.verifyOtp/);
  assert.match(renderer, /sendBinanceAccountOtp\(\)/);
  assert.match(renderer, /bindBinanceAccount\(\{/);
  assert.match(renderer, /confirmBinanceAccountRemoval[\s\S]*confirmInApp[\s\S]*resetBinanceAccountDialog\(state\.binanceAccount, "remove"\)[\s\S]*sendBinanceAccountOtp\(\)/);
  assert.match(renderer, /removeBinanceAccount\(\{[\s\S]*challengeId: dialog\.challengeId,[\s\S]*code: dialog\.code\.trim\(\)/);
  const removalHandler = binanceHandlers.slice(binanceHandlers.indexOf('ipcMain.handle("binanceAccount:remove"'));
  assert.match(removalHandler, /OTP_REQUIRED[\s\S]*OTP_INVALID[\s\S]*verifyOtp\([\s\S]*sameBinanceBindingOwner[\s\S]*getBinanceAccountService\(\)\.remove/);
  assert.ok(removalHandler.indexOf("verifyOtp(") < removalHandler.indexOf("getBinanceAccountService().remove"));
  assert.doesNotMatch(preload, /getBinanceCredentials|binanceAccount:(?:order|trade|closePosition|setLeverage)/i);
  assert.doesNotMatch(binanceHandlers, /console\.(?:log|info|warn|error)[\s\S]*(?:apiKey|apiSecret)/i);
  assert.doesNotMatch(service, /\/order\b|newOrder|closePosition/i);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/);
});

test("account styles cover light and dark surfaces plus every interactive state", async () => {
  const styles = await stylesSource;
  const accountStyles = styles.slice(styles.indexOf("/* Binance account"));
  assert.match(styles, /\.binance-account-page,[\s\S]*--binance-bg: #ffffff/);
  assert.match(styles, /--binance-surface: #ffffff/);
  assert.match(styles, /html\[data-theme="dark"\] \.binance-account-page,[\s\S]*--binance-bg: #101216/);
  assert.match(styles, /--binance-surface: #17191e/);
  assert.match(styles, /\.binance-account-quiet-button:hover:not\(:disabled\)/);
  assert.match(styles, /\.binance-account-quiet-button:active:not\(:disabled\)/);
  assert.match(accountStyles, /\.binance-account-summary-card \{[^}]*padding: 23px 34px 26px;/s);
  assert.match(accountStyles, /\.binance-account-bound-view \{[^}]*padding: 30px 0 0;/s);
  assert.match(accountStyles, /\.binance-account-content \{[^}]*padding: 4px clamp\(20px, 3vw, 42px\) 40px;/s);
  assert.match(accountStyles, /\.binance-account-toolbar \{[^}]*width: min\(1180px, calc\(100% - 68px\)\);[^}]*align-items: center;[^}]*padding: 0 0 8px;/s);
  assert.match(accountStyles, /\.binance-account-toolbar > \.binance-account-tabs \{[^}]*flex: 1 1 auto;[^}]*margin: 0;[^}]*padding: 0;[^}]*color: var\(--binance-text\);/s);
  assert.match(accountStyles, /\.binance-account-toolbar-actions \{[^}]*flex: 0 0 auto;[^}]*align-items: center;[^}]*gap: 8px;[^}]*margin-right: 8px;/s);
  assert.doesNotMatch(accountStyles, /binance-account-history-period/);
  assert.match(accountStyles, /\.binance-account-empty-history \{[^}]*border: 0;/s);
  assert.match(accountStyles, /\.binance-account-empty-history strong \{[^}]*font-size: calc\(14px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.match(styles, /\.trading-alert-filters button \{[^}]*height: 34px;[^}]*gap: 6px;[^}]*border-radius: 14px;[^}]*padding: 0 16px;/s);
  assert.match(styles, /\.trading-alert-filters \{[^}]*gap: 18px;/s);
  assert.doesNotMatch(accountStyles, /binance-account-summary-actions|\.binance-account-summary-card\.total-assets > header/);
  assert.match(accountStyles, /\.binance-account-action-icon-button \{[^}]*width: 32px;[^}]*height: 32px;[^}]*border: 0;[^}]*background: transparent;[^}]*color: var\(--binance-text-secondary\);/s);
  assert.match(accountStyles, /\.binance-account-action-icon-button svg \{[^}]*width: 18px;[^}]*height: 18px;[^}]*stroke: currentColor;/s);
  assert.match(accountStyles, /\.binance-account-action-icon-button:hover:not\(:disabled\)/);
  assert.match(accountStyles, /\.binance-account-action-icon-button:active:not\(:disabled\)/);
  assert.doesNotMatch(accountStyles, /\.binance-account-action-icon-button\.(?:danger|unlink)[^{]*\{[^}]*var\(--binance-negative\)/s);
  assert.match(accountStyles, /\.binance-account-action-icon-button\.refreshing svg \{ animation: binance-account-spin 700ms linear infinite; \}/);
  assert.match(styles, /\.binance-account-page button:focus-visible/);
  assert.match(styles, /\.binance-account-page button:disabled/);
  assert.match(styles, /\.binance-account-dialog input:hover:not\(:disabled\)/);
  assert.match(styles, /\.binance-account-dialog input:focus\s*\{[^}]*border-color: var\(--binance-border-strong\);[^}]*box-shadow: none;/s);
  assert.match(styles, /\.binance-account-dialog input:disabled/);
  assert.match(styles, /\.binance-account-loading-spinner/);
  assert.match(accountStyles, /\.binance-account-loading:not\(\.error\) > strong \{ font-weight: 400; \}/);
  assert.match(styles, /\.binance-account-dialog-backdrop/);
  assert.match(styles, /\.desktop-body > :is\([\s\S]*?\.binance-account-page,[\s\S]*?\.trading-alerts-page,[\s\S]*?\.skills-plaza-page[\s\S]*?\)\s*\{\s*border-top-left-radius: 16px;/s);
  assert.match(accountStyles, /--binance-action: #15171b/);
  assert.match(accountStyles, /--binance-action-text: #ffffff/);
  assert.match(accountStyles, /--binance-label-text: #000000/);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-action: #f4f5f7/);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-action-text: #101216/);
  assert.match(accountStyles, /--binance-danger-action: #c62842/);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-danger-action: #ff5f73/);
  assert.match(accountStyles, /\.binance-account-submit\.danger:hover:not\(:disabled\)/);
  assert.match(accountStyles, /\.binance-account-submit\.danger:active:not\(:disabled\)/);
  assert.match(styles, /footer button\[type="submit"\]:not\(\.thread-dialog-danger\):not\(\.binance-account-submit\):not\(:disabled\)/);
  assert.match(styles, /dialog\[open\] footer button:not\(\.binance-account-submit\)/);
  assert.match(styles, /dialog\[open\] footer button:disabled:not\(\.binance-account-submit\)/);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-label-text: #f4f5f7/);
  assert.match(accountStyles, /\.binance-account-dialog label \{[^}]*color: var\(--binance-label-text\);/s);
  assert.match(accountStyles, /\.binance-account-metric \{ min-width: 0; \}/);
  assert.match(accountStyles, /\.binance-account-summary-card h2 \{[^}]*font-size: calc\(16px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.match(accountStyles, /\.binance-account-summary-heading \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 4px;/s);
  assert.match(accountStyles, /\.binance-account-summary-heading \.binance-account-visibility-button \{[^}]*width: 28px;[^}]*height: 28px;/s);
  assert.match(accountStyles, /\.binance-account-primary-amount \{[^}]*margin-top: 19px;/s);
  assert.doesNotMatch(accountStyles, /\.binance-account-position-card footer/);
  assert.match(accountStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.binance-account-toolbar \{ width: calc\(100% - 40px\); \}[\s\S]*?\.binance-account-content \{ padding: 4px 20px 30px; \}[\s\S]*?\.binance-account-summary-card \{ padding: 19px 20px 22px; \}/s);
  assert.match(accountStyles, /\.binance-account-primary-amount strong \{[^}]*font-size: calc\(31px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 500;[^}]*letter-spacing: -0\.35px;/s);
  assert.match(accountStyles, /\.binance-account-primary-amount\.compact strong \{[^}]*font-size: calc\(31px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(accountStyles, /\.binance-account-pnl-row strong \{[^}]*font-weight: 500;/s);
  assert.match(accountStyles, /\.binance-account-realized-value \{[^}]*font-weight: 500;/s);
  assert.match(accountStyles, /--binance-positive: #0a9d68;[\s\S]*--binance-negative: #e8465b;/s);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-positive: #27c894;[\s\S]*--binance-negative: #ff5f73;/s);
  assert.match(accountStyles, /--binance-history-scrollbar-thumb: rgba\(120, 129, 143, 0\.42\);/);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-history-scrollbar-thumb: rgba\(151, 161, 176, 0\.44\);/s);
  assert.match(accountStyles, /\.binance-account-scroll\.history \{[^}]*scrollbar-color: transparent transparent;/s);
  assert.match(accountStyles, /\.binance-account-scroll\.history::-webkit-scrollbar-button \{[^}]*display: none;[^}]*width: 0;[^}]*height: 0;/s);
  assert.match(accountStyles, /\.binance-account-scroll\.history:hover,[\s\S]*?\.binance-account-scroll\.history:focus-visible \{[^}]*scrollbar-color: var\(--binance-history-scrollbar-thumb\) transparent;/s);
  assert.match(accountStyles, /\.binance-account-scroll\.history:hover::-webkit-scrollbar-thumb,[\s\S]*?\.binance-account-scroll\.history:focus-visible::-webkit-scrollbar-thumb \{[^}]*background-color: var\(--binance-history-scrollbar-thumb\);/s);
  assert.match(accountStyles, /\.binance-account-metric > strong \{[^}]*font-weight: 500;/s);
  assert.match(accountStyles, /\.binance-account-position-list \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*gap: 14px;/s);
  assert.match(accountStyles, /\.binance-account-position-card \{[^}]*border: 1px solid var\(--binance-border\);[^}]*border-radius: 14px;[^}]*background: var\(--binance-surface\);[^}]*padding: 18px 20px 20px;[^}]*color: var\(--binance-text\);/s);
  assert.match(accountStyles, /\.binance-account-position-featured \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*gap: 12px;/s);
  assert.match(accountStyles, /\.binance-account-position-featured > div:first-child \{ grid-column: span 2; \}/);
  assert.match(accountStyles, /\.binance-account-position-featured strong \{[^}]*font-size: calc\(20px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 500;/s);
  assert.match(accountStyles, /\.binance-account-position-metrics \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[^}]*gap: 14px 12px;/s);
  assert.match(accountStyles, /@media \(max-width: 1000px\) \{[\s\S]*?\.binance-account-position-list \{ grid-template-columns: minmax\(0, 1fr\); \}/s);
  assert.match(accountStyles, /\.binance-account-empty-positions strong \{[^}]*font-size: calc\(14px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.match(accountStyles, /\.binance-account-history-list \{[^}]*border: 1px solid var\(--binance-border\);[^}]*background: var\(--binance-surface\);/s);
  assert.match(accountStyles, /\.binance-account-history-body \{[^}]*grid-template-columns: minmax\(0, 1\.35fr\) repeat\(4, minmax\(0, 1fr\)\);/s);
  assert.match(accountStyles, /\.binance-account-history-card\.short \.binance-account-history-symbol > \.binance-account-history-direction/);
  assert.match(accountStyles, /@media \(max-width: 1000px\) \{[\s\S]*?\.binance-account-history-body \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/s);
  assert.doesNotMatch(accountStyles, /#(?:f0b90b|d9a600|c99a00|f8c72b|fff8db|7a5c00|332b10|f3cf55)\b/i);
  assert.doesNotMatch(accountStyles, /\.binance-account-(?:metric|position-list|empty-positions) \{[^}]*border-top:/s);
  assert.doesNotMatch(accountStyles, /binance-account-source-note/);
  assert.doesNotMatch(accountStyles, /binance-account-usd-equivalent/);
  assert.match(accountStyles, /\.binance-account-unbound-icon svg \{[^}]*fill: none;[^}]*stroke: currentColor;/s);
  assert.match(accountStyles, /\.binance-account-unbound-copy h2 \{[^}]*font-size: calc\(25px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.match(accountStyles, /\.binance-account-bind-button \{[^}]*width: 88\.5px;[^}]*min-width: 88\.5px;[^}]*min-height: 38px;[^}]*font-size: calc\(12px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.match(accountStyles, /\.binance-account-tutorial-button \{ min-height: 38px; font-weight: 400; \}/);
  assert.doesNotMatch(accountStyles, /binance-account-page-header|binance-account-brand-mark|binance-account-kicker/);
  assert.doesNotMatch(accountStyles, /#(?:f0b90b|d9a600|c99a00|f8c72b|fff8db|7a5c00|332b10|f3cf55)\b/i);
});

function accountSnapshot() {
  return {
    schemaVersion: 1,
    currency: "USDT",
    estimatedTotalAssets: 3938.95088,
    todayPnl: -14.32,
    todayPnlPercent: -0.36,
    marginBalance: 2842.7,
    walletBalance: 2854.8,
    unrealizedPnl: -12.1,
    realizedPnlToday: -2.22,
    initialMargin: 143.27,
    availableBalance: 2699.43,
    positions: [{
      symbol: "ETHUSDT",
      direction: "SHORT",
      positionSide: "BOTH",
      marginType: "cross",
      leverage: 50,
      amount: 0.038,
      notionalValue: 71.61,
      margin: 1.43,
      unrealizedPnl: -0.01,
      roi: -2.57,
      marginRatio: 10.06,
      entryPrice: 1883.91,
      markPrice: 1884.21,
      liquidationPrice: 1951.3,
      breakEvenPrice: 1883.65,
      marginAsset: "USDT",
      updatedAt: Date.now(),
    }],
    positionHistory: [{
      id: "TUTUSDT:BOTH:history",
      symbol: "TUTUSDT",
      contractType: "PERPETUAL",
      direction: "SHORT",
      positionSide: "BOTH",
      marginType: "cross",
      leverage: 10,
      closeType: "FULL",
      realizedPnl: 0.01,
      unrealizedPnl: null,
      roi: 1.34,
      closedAmount: 169,
      baseAsset: "TUT",
      openTime: Date.parse("2026-08-13T12:20:12.000Z"),
      closeTime: Date.parse("2026-08-13T12:20:50.000Z"),
      entryPrice: 0.05562,
      averageClosePrice: 0.05549,
      updatedAt: Date.parse("2026-08-13T12:20:50.000Z"),
    }],
    walletBreakdown: [],
    sources: {
      totalAssets: "BINANCE_WALLETS_USDT",
      futures: "BINANCE_USDM_ACCOUNT_V3",
      realizedPnl: "BINANCE_USDM_INCOME",
      positionHistory: "BINANCE_USDM_ACCOUNT_TRADES",
    },
    warnings: [],
    fetchedAt: "2026-08-13T04:00:00.000Z",
  };
}
