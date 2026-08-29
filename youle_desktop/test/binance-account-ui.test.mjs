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

test("account navigation uses the same full-width workspace layout as strategy", async () => {
  const source = await rendererSource;
  const accountBranch = source.slice(
    source.indexOf(': state.activeView === "account"'),
    source.indexOf(': state.activeView === "contacts"'),
  );
  const openAccountBlock = source.slice(
    source.indexOf("function openBinanceAccountPage"),
    source.indexOf("function currentBinanceAccountProfitCalendarMonth"),
  );
  assert.match(source, /type ViewId[\s\S]*\| "account"/);
  assert.match(source, /function openBinanceAccountPage[\s\S]*state\.activeView = "account"/);
  assert.match(accountBranch, /renderChatList\(\)[\s\S]*renderBinanceAccountPage\(state\.binanceAccount\)/);
  assert.doesNotMatch(accountBranch, /renderAgentPanel|renderChatPanel|agent-panel/);
  assert.match(source, /data-conversation-static-action="account"/);
  assert.match(source, /const accountActive = state\.activeView === "account"/);
  assert.match(source, /tradingExpertLayout \? "trading-expert-layout" : ""/);
  assert.doesNotMatch(source, /tradingExpertPanelLayout/);
  assert.match(source, /workspaceHasConversationList \? renderLeftPanelToggle\(\) : ""/);
  assert.doesNotMatch(
    source.slice(source.indexOf("function renderWindowControls"), source.indexOf("function renderLeftPanelToggle")),
    /renderLeftPanelToggle\(\)/,
  );
  assert.match(openAccountBlock, /restoreTradingExpertChartFocusLayout\(\)[\s\S]*state\.activeView = "account"/);
  assert.doesNotMatch(openAccountBlock, /state\.(?:rightCollapsed|tradingExpertChartCollapsed)\s*=/);
  assert.doesNotMatch(source, /renderBinanceAccountExpansionControl|data-trading-expert-account-expansion|binanceAccountPageToggleLabel/);
  assert.match(
    source,
    /function toggleLeftPanelCollapsed\(\)[\s\S]*state\.activeView !== "chat" && state\.activeView !== "account"[\s\S]*state\.leftCollapsed = !state\.leftCollapsed/,
  );
  assert.match(
    source,
    /action === "select-section"[\s\S]*state\.binanceAccount\.activeSection = section;[\s\S]*render\(\)/,
  );
  assert.match(source, /section === "assets" \|\| section === "positions" \|\| section === "open-orders" \|\| section === "history" \|\| section === "profit-calendar"/);
  assert.match(source, /section === "profit-calendar" && !state\.binanceAccount\.profitCalendar/);
  assert.match(source, /state\.activeView === "chat" && state\.rightCollapsed && !state\.chatPreview/);
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
  assert.match(dialog, /class="binance-account-dialog-backdrop" aria-hidden="true"/);
  assert.equal((dialog.match(/data-binance-account-action="close-dialog"/g) || []).length, 1);
  assert.match(dialog, /class="binance-account-dialog-close" data-binance-account-action="close-dialog"/);
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

test("binding dialog ignores backdrop clicks and Escape so only its close button dismisses it", async () => {
  const source = await rendererSource;
  const bindingBlock = source.slice(
    source.indexOf("function bindBinanceAccountEvents"),
    source.indexOf("function bindExecutionPlanEvents"),
  );

  assert.match(
    bindingBlock,
    /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/,
  );
  assert.doesNotMatch(bindingBlock, /event\.key === "Escape"[\s\S]*?closeBinanceAccountDialog\(\)/);
});

test("initial account load uses the account layout skeleton instead of a centered spinner", () => {
  const state = createBinanceAccountUiState();
  state.loading = true;

  const page = renderBinanceAccountPage(state);
  assert.match(page, /class="binance-account-page"[^>]*aria-busy="true"/);
  assert.match(page, /class="binance-account-bound-view binance-account-skeleton-view"[^>]*role="status"/);
  assert.match(page, /binance-account-skeleton-toolbar/);
  assert.equal((page.match(/class="binance-account-summary-card/g) || []).length, 2);
  assert.equal((page.match(/binance-account-skeleton-metric-label/g) || []).length, 4);
  assert.doesNotMatch(page, /binance-account-loading-spinner|正在读取 Binance 账户|凭据只在主进程解密/);
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

test("bound account separates assets, positions, open orders, and real position history into tabs", () => {
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
  assert.match(page, /data-binance-account-section="open-orders"[^>]*>当前委托<\/button>/);
  assert.match(page, /data-binance-account-section="history"[^>]*>仓位历史<\/button>/);
  assert.match(page, /data-binance-account-section="profit-calendar"[^>]*>收益日历<\/button>/);
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
  assert.doesNotMatch(page, /binance-account-profit-calendar/);
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
  assert.equal((page.match(/data-binance-account-action="toggle-balances"/g) || []).length, 1);
  assert.match(page, /class="binance-account-summary-heading">\s*<h2>预估总资产<\/h2>\s*<button[^>]*class="binance-account-visibility-button"/s);
  assert.match(page, /class="binance-account-summary-heading">\s*<h2>保证金余额<\/h2>\s*<\/div>/s);
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
  assert.match(positionsPage, /<span class="binance-account-position-side">空<\/span>/);
  assert.doesNotMatch(positionsPage, /<span class="binance-account-position-side">(?:买|卖)<\/span>/);
  assert.match(positionsPage, /全仓 50X/);
  assert.match(positionsPage, /投资回报率/);
  assert.match(positionsPage, /<span>投资回报率<\/span>\s*<strong>-2\.57%<\/strong>/);
  assert.match(positionsPage, /<span>保证金比率<\/span>\s*<strong>3\.50%<\/strong>/);
  assert.doesNotMatch(positionsPage, /预估总资产|保证金余额|--2\.57%/);
  assert.match(positionsPage, /class="binance-account-toolbar-actions"/);
  assert.match(positionsPage, /data-binance-account-action="refresh"/);
  assert.match(positionsPage, /data-binance-account-action="remove"/);

  state.activeSection = "open-orders";
  const openOrdersPage = renderBinanceAccountPage(state);
  assert.match(openOrdersPage, /data-binance-account-section="open-orders"[^>]*aria-pressed="true"/);
  assert.match(openOrdersPage, /<section class="binance-account-open-orders" aria-label="当前委托">/);
  assert.match(openOrdersPage, /限价 \/ 做多/);
  assert.match(openOrdersPage, /限价 \/ 做空/);
  assert.match(openOrdersPage, /成交数量 \/ 数量 \(USDT\)/);
  assert.match(openOrdersPage, /role="progressbar"[^>]*aria-valuenow="0"/);
  assert.match(openOrdersPage, /0%/);
  assert.match(openOrdersPage, /13\.37000/);
  assert.match(openOrdersPage, /市价止损 \/ 平多/);
  assert.match(openOrdersPage, /市价止盈 \/ 平空/);
  assert.match(openOrdersPage, /限价止损 \/ 平空/);
  assert.match(openOrdersPage, /限价止盈 \/ 平多/);
  assert.match(openOrdersPage, /条件委托 \/ 限价做空/);
  assert.match(openOrdersPage, /最新价格≤0\.079000/);
  assert.match(openOrdersPage, /最新价格≥0\.830000/);
  assert.doesNotMatch(openOrdersPage, /<span>只减仓<\/span>/);
  assert.match(openOrdersPage, /<span>价格<\/span>\s*<strong>市价<\/strong>/);
  assert.doesNotMatch(openOrdersPage, /状态 新建|有效方式|价格匹配|价格保护|持仓方向/);
  assert.doesNotMatch(openOrdersPage, /binance-account-open-order-card[^>]*>[\s\S]*?<footer>/);
  assert.doesNotMatch(openOrdersPage, /分享|追单|撤单|编辑|open-order[^>]*(?:button|action)|<button[^>]*data-binance-order/);

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
  const historyTime = historyPage.match(/<div class="binance-account-history-time">\s*<span>([^<]+)<\/span>\s*<\/div>/)?.[1] || "";
  assert.match(historyTime, /^2026-08-13 \d{2}:20:12 → 2026-08-13 \d{2}:20:50&nbsp;&nbsp;\(0分\)$/);
  assert.doesNotMatch(historyTime, /开仓时间|最后平仓时间|持续|\d{2}\/\d{2}\/\d{4}/);
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

test("profit calendar renders monthly PnL semantics, navigation, privacy, loading, and errors", () => {
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
  state.activeSection = "profit-calendar";
  state.profitCalendarMonth = "2026-07";
  state.profitCalendar = {
    schemaVersion: 1,
    month: "2026-07",
    currency: "USDT",
    days: [
      { date: "2026-07-01", pnl: 500.3 },
      { date: "2026-07-03", pnl: -256.23 },
      { date: "2026-07-04", pnl: 0 },
    ],
    source: "USD_M_INCOME_REALIZED_PNL+COMMISSION_ACTIVITY",
    warnings: [],
    fetchedAt: "2026-08-14T04:00:00.000Z",
  };

  const page = renderBinanceAccountPage(state);
  assert.doesNotMatch(page, /每日已实现盈亏 \(USDT\)/);
  assert.match(page, /class="binance-account-profit-month-total positive"[^>]*>[\s\S]*?<span>本月<\/span>[\s\S]*?<strong>\+244\.07<\/strong>[\s\S]*?<small>USDT<\/small>/);
  assert.doesNotMatch(page, /binance-account-profit-legend|收益颜色说明|无交易 \/ 0 盈亏/);
  assert.match(page, /data-binance-account-action="previous-profit-month"/);
  assert.match(page, /data-binance-account-action="next-profit-month"/);
  assert.match(page, /2026年 7月/);
  assert.match(page, /style="--leading-days:2"/);
  assert.match(page, /binance-account-profit-day profit[^>]*>[\s\S]*?<strong>01<\/strong>[\s\S]*?<span>\+500\.3<\/span>/);
  assert.match(page, /binance-account-profit-day empty[^>]*>[\s\S]*?<strong>02<\/strong>[\s\S]*?<span>--<\/span>/);
  assert.match(page, /binance-account-profit-day loss[^>]*>[\s\S]*?<strong>03<\/strong>[\s\S]*?<span>-256\.23<\/span>/);
  assert.match(page, /binance-account-profit-day zero[^>]*>[\s\S]*?<strong>04<\/strong>[\s\S]*?<span>0\.00<\/span>/);
  assert.equal((page.match(/class="binance-account-profit-day/g) || []).length, 31);

  state.profitCalendarMonth = "2026-06";
  state.profitCalendar = {
    ...state.profitCalendar,
    month: "2026-06",
    days: [{ date: "2026-06-02", pnl: -12.345 }],
  };
  const previousMonthPage = renderBinanceAccountPage(state);
  assert.match(previousMonthPage, /class="binance-account-profit-month-total negative"[^>]*>[\s\S]*?<span>本月<\/span>[\s\S]*?<strong>-12\.35<\/strong>[\s\S]*?<small>USDT<\/small>/);

  state.profitCalendarMonth = "2026-07";
  state.profitCalendar = {
    ...state.profitCalendar,
    month: "2026-07",
    days: [
      { date: "2026-07-01", pnl: 500.3 },
      { date: "2026-07-03", pnl: -256.23 },
      { date: "2026-07-04", pnl: 0 },
    ],
  };

  state.balancesVisible = false;
  const hiddenPage = renderBinanceAccountPage(state);
  assert.equal((hiddenPage.match(/class="binance-account-profit-day concealed"/g) || []).length, 31);
  assert.doesNotMatch(hiddenPage, /\+500\.3|-256\.23|class="binance-account-profit-day (?:profit|loss)"/);
  assert.match(hiddenPage, /class="binance-account-profit-month-total neutral"[^>]*>[\s\S]*?<strong>••••<\/strong>/);

  state.balancesVisible = true;
  state.profitCalendar = null;
  state.profitCalendarLoading = true;
  const loadingPage = renderBinanceAccountPage(state);
  assert.equal((loadingPage.match(/binance-account-profit-calendar-skeleton/g) || []).length, 35);
  assert.match(loadingPage, /role="status" aria-label="正在加载收益日历"/);
  assert.match(loadingPage, /class="binance-account-profit-month-total neutral"[^>]*>[\s\S]*?<strong>--<\/strong>/);

  state.profitCalendarLoading = false;
  state.profitCalendarError = "收益日历暂时不可用";
  const errorPage = renderBinanceAccountPage(state);
  assert.match(errorPage, /role="alert"[\s\S]*收益日历暂时不可用/);
  assert.match(errorPage, /data-binance-account-action="retry-profit-calendar"/);
});

test("bound account never renders refresh or partial-data warnings in any section", () => {
  const state = createBinanceAccountUiState();
  state.loaded = true;
  state.status = {
    bound: true,
    apiKeyMasked: "ABCD••••WXYZ",
    boundAt: "2026-08-13T04:00:00.000Z",
    updatedAt: "2026-08-13T04:00:00.000Z",
    secureStorageAvailable: true,
  };
  state.snapshot = accountSnapshot();
  state.error = "账户数据暂时未更新，仍显示上次成功数据";
  state.snapshot.warnings = [
    "部分仓位历史暂时无法读取",
    "当前委托暂时无法读取",
    "Binance 暂时连接不稳定，当前展示上次成功读取的数据",
  ];

  for (const section of ["assets", "positions", "open-orders", "history", "profit-calendar"]) {
    state.activeSection = section;
    const page = renderBinanceAccountPage(state);
    assert.doesNotMatch(page, /binance-account-warning/);
    assert.doesNotMatch(page, /暂时未更新|暂时无法读取|暂时连接不稳定|上次成功读取的数据/);
  }
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
  assert.match(loader, /Date\.now\(\) < accountState\.autoRefreshAfter[\s\S]*\(hasCachedView \|\| Boolean\(accountState\.error\)\)/);
  assert.match(loader, /if \(binanceAccountLoadPromise\) return binanceAccountLoadPromise/);
  assert.match(loader, /accountState\.loading = !hasCachedView/);
  assert.match(loader, /else \{[\s\S]*accountState\.loaded = false;[\s\S]*accountState\.error = errorMessage\(error\);[\s\S]*accountState\.autoRefreshAfter = Date\.now\(\) \+ Math\.max\(BINANCE_ACCOUNT_AUTO_RETRY_INTERVAL_MS, retryDelay\)/);
  assert.match(loader, /账户数据暂时未更新，仍显示上次成功数据/);
  assert.doesNotMatch(loader, /accountState\.snapshot = null/);
  assert.match(renderer, /tradingExpertLayout[\s\S]*!state\.binanceAccount\.loaded[\s\S]*!state\.binanceAccount\.loading[\s\S]*!binanceAccountLoadPromise[\s\S]*Date\.now\(\) >= state\.binanceAccount\.autoRefreshAfter/);
  assert.match(renderer, /getBinanceAccountSnapshot\(\{[\s\S]*force: true,[\s\S]*live: true,[\s\S]*summary: true,[\s\S]*\}\)/);
  assert.match(renderer, /progressivelyRefreshBinanceAccountSnapshot[\s\S]*\{ force: true, live: true \}[\s\S]*\{ force: true, live: false \}/);
  assert.match(renderer, /accountState\.refreshing = false;[\s\S]*renderBinanceAccountLiveUpdate\(\);[\s\S]*progressivelyRefreshBinanceAccountSnapshot/);
  assert.match(preload, /async function invokeBinanceAccountSnapshot[\s\S]*ipcRenderer\.invoke\("binanceAccount:getSnapshot", params\)[\s\S]*error\.retryAfterMs = retryAfterMs/);
  assert.match(preload, /getBinanceAccountSnapshot: \(params\) => invokeBinanceAccountSnapshot\(params\)/);
  assert.match(desktopMain, /const requestOptions = \{[\s\S]*force: params\?\.force === true,[\s\S]*live: params\?\.live === true,[\s\S]*summary: params\?\.summary === true/);
  assert.match(desktopMain, /snapshot\(owner\.ownerId, requestOptions\)[\s\S]*elapsedMs: Date\.now\(\) - startedAt/);
  assert.match(desktopMain, /error\?\.code !== "BINANCE_RATE_LIMITED"[\s\S]*retryAfterMs: Number\.isFinite\(error\?\.retryAfterMs\)/);
});

test("visible account surfaces refresh at scoped intervals and honor bootstrap plus failure backoff", async () => {
  const renderer = await rendererSource;
  const liveRefresh = renderer.slice(
    renderer.indexOf("function stopBinanceAccountLiveRefresh"),
    renderer.indexOf("function stopBinanceAccountOtpCountdown"),
  );

  assert.match(renderer, /const BINANCE_ACCOUNT_AUTO_REFRESH_INTERVAL_MS = 5 \* 60_000;/);
  assert.match(renderer, /const BINANCE_ACCOUNT_LIVE_REFRESH_INTERVAL_MS = 30_000;/);
  assert.match(renderer, /const BINANCE_ACCOUNT_TRADING_LIVE_REFRESH_INTERVAL_MS = 60_000;/);
  assert.match(liveRefresh, /function binanceAccountReadOnlyDataVisible\(\)[\s\S]*state\.activeView === "account"[\s\S]*isTradingExpertThreadId\(state\.currentThreadId\)/);
  assert.match(liveRefresh, /function binanceAccountLiveRefreshInterval\(\)[\s\S]*state\.activeView === "account"[\s\S]*BINANCE_ACCOUNT_LIVE_REFRESH_INTERVAL_MS[\s\S]*BINANCE_ACCOUNT_TRADING_LIVE_REFRESH_INTERVAL_MS/);
  assert.match(liveRefresh, /function binanceAccountRetryDelay\(error: unknown, failureCount: number\)[\s\S]*retryAfterMs \+ 500/);
  assert.match(liveRefresh, /!binanceAccountReadOnlyDataVisible\(\)[\s\S]*document\.hidden/);
  assert.match(liveRefresh, /const bootstrapDelay = state\.binanceAccount\.autoRefreshAfter - Date\.now\(\)[\s\S]*Math\.max\(1_000, bootstrapDelay\)/);
  assert.match(liveRefresh, /const retryDelay = Math\.max\(0, binanceAccountLiveRetryAfter - Date\.now\(\)\)[\s\S]*Math\.max\(0, delayMs, retryDelay\)/);
  assert.match(liveRefresh, /function resumeBinanceAccountLiveRefresh\(\)[\s\S]*Math\.max\(0, binanceAccountLiveRetryAfter - Date\.now\(\)\)/);
  assert.match(liveRefresh, /window\.setTimeout\([\s\S]*silentlyRefreshBinanceAccountSnapshot/);
  assert.match(liveRefresh, /binanceAccountLoadPromise[\s\S]*state\.binanceAccount\.refreshing[\s\S]*state\.binanceAccount\.dialog\.open/);
  assert.match(liveRefresh, /const calendarVisible = accountState\.activeSection === "profit-calendar"[\s\S]*const liveOnly = calendarVisible \|\| Date\.now\(\) < binanceAccountFullRefreshAfter/);
  assert.match(liveRefresh, /getBinanceAccountSnapshot!\(\{ force: true, live: liveOnly \}\)/);
  assert.match(liveRefresh, /if \(!liveOnly && !reusedStaleSnapshot\)[\s\S]*binanceAccountFullRefreshAfter = Date\.now\(\) \+ BINANCE_ACCOUNT_AUTO_REFRESH_INTERVAL_MS/);
  assert.match(liveRefresh, /BINANCE_ACCOUNT_LIVE_RETRY_MAX_INTERVAL_MS[\s\S]*BINANCE_ACCOUNT_LIVE_RETRY_BASE_INTERVAL_MS/);
  assert.match(liveRefresh, /renderBinanceAccountPage\(state\.binanceAccount\)[\s\S]*currentPage\.replaceWith\(nextPage\)[\s\S]*bindBinanceAccountEvents\(nextPage\)/);
  assert.match(liveRefresh, /scrollTop[\s\S]*nextScroll\.scrollTop = scrollTop/);
  assert.match(liveRefresh, /focusedAction[\s\S]*focusedSection[\s\S]*focus\(\{ preventScroll: true \}\)/);
  assert.match(liveRefresh, /reusedStaleSnapshot[\s\S]*binanceAccountLiveRefreshFailures \+ 1/);
  assert.match(liveRefresh, /binanceAccountLiveRefreshFailures > 0 \? retryDelay : binanceAccountLiveRefreshInterval\(\)/);
  assert.doesNotMatch(liveRefresh, /\.refreshing = true|showToast\(/);
  assert.match(renderer, /window\.addEventListener\("focus", resumeBinanceAccountLiveRefresh/);
  assert.match(renderer, /document\.addEventListener\("visibilitychange", \(\) => \{[\s\S]*document\.hidden[\s\S]*stopBinanceAccountLiveRefresh\(\)[\s\S]*resumeBinanceAccountLiveRefresh\(\)/);
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
    "binanceAccount:getProfitCalendar",
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
  assert.match(renderer, /function loadBinanceAccountProfitCalendar[\s\S]*getBinanceAccountProfitCalendar[\s\S]*\{ month, force \}/);
  assert.match(renderer, /action === "previous-profit-month"[\s\S]*navigateBinanceAccountProfitCalendar\(-1\)/);
  assert.match(renderer, /action === "next-profit-month"[\s\S]*navigateBinanceAccountProfitCalendar\(1\)/);
  assert.match(renderer, /nextMonth > currentBinanceAccountProfitCalendarMonth\(\)/);
  assert.match(preload, /getBinanceAccountProfitCalendar: \(params\) => invokeBinanceAccountProfitCalendar\(params\)/);
  assert.match(binanceHandlers, /const force = params\?\.force === true[\s\S]*profitCalendar\(owner\.ownerId, \{[\s\S]*month: params\?\.month,[\s\S]*force,/);
  assert.match(desktopMain, /profitCalendarFetch:[\s\S]*BINANCE_REQUEST_PRIORITIES\.accountInteractive/);
  assert.match(renderer, /confirmBinanceAccountRemoval[\s\S]*confirmInApp[\s\S]*resetBinanceAccountDialog\(state\.binanceAccount, "remove"\)[\s\S]*sendBinanceAccountOtp\(\)/);
  assert.match(renderer, /removeBinanceAccount\(\{[\s\S]*challengeId: dialog\.challengeId,[\s\S]*code: dialog\.code\.trim\(\)/);
  const removalHandler = binanceHandlers.slice(binanceHandlers.indexOf('ipcMain.handle("binanceAccount:remove"'));
  assert.match(removalHandler, /OTP_REQUIRED[\s\S]*OTP_INVALID[\s\S]*verifyOtp\([\s\S]*sameBinanceBindingOwner[\s\S]*getBinanceAccountService\(\)\.remove/);
  assert.ok(removalHandler.indexOf("verifyOtp(") < removalHandler.indexOf("getBinanceAccountService().remove"));
  assert.doesNotMatch(preload, /getBinanceCredentials|binanceAccount:(?:order|trade|closePosition|setLeverage)/i);
  assert.doesNotMatch(binanceHandlers, /console\.(?:log|info|warn|error)[\s\S]*(?:apiKey|apiSecret)/i);
  assert.doesNotMatch(service, /signed(?:Post|Put|Delete)|pathname:\s*"\/fapi\/v1\/(?:order|algoOrder|allOpenOrders|algoOpenOrders)"/i);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/);
});

test("account styles cover light and dark surfaces plus every interactive state", async () => {
  const styles = await stylesSource;
  const accountStyles = styles.slice(styles.indexOf("/* Binance account"));
  assert.match(styles, /--card-border-subtle: rgba\(17, 24, 39, 0\.04\);/);
  assert.match(styles, /html\[data-theme="dark"\] \{[\s\S]*?--card-border-subtle: rgba\(255, 255, 255, 0\.08\);/s);
  assert.match(styles, /\.desktop-body > \.binance-account-page\s*\{[^}]*display: flex;[^}]*min-width: 0;[^}]*flex: 1 1 auto;/s);
  assert.doesNotMatch(styles, /binance-account-page-expansion-toggle/);
  assert.match(styles, /\.binance-account-page,[\s\S]*--binance-bg: #ffffff/);
  assert.match(styles, /--binance-surface: #ffffff/);
  assert.match(styles, /html\[data-theme="dark"\] \.binance-account-page,[\s\S]*--binance-bg: #101216/);
  assert.match(styles, /--binance-surface: #17191e/);
  assert.match(styles, /\.binance-account-quiet-button:hover:not\(:disabled\)/);
  assert.match(styles, /\.binance-account-quiet-button:active:not\(:disabled\)/);
  assert.match(accountStyles, /\.binance-account-summary-card \{[^}]*padding: 23px 34px 26px;/s);
  assert.match(accountStyles, /\.binance-account-summary-card \{[^}]*border: 1px solid var\(--card-border-subtle\);/s);
  assert.match(accountStyles, /\.binance-account-bound-view \{[^}]*padding: 30px 0 0;/s);
  assert.match(accountStyles, /\.binance-account-content \{[^}]*padding: 4px clamp\(20px, 3vw, 42px\) 40px;/s);
  assert.match(accountStyles, /\.binance-account-content\.profit-calendar \{ width: min\(80%, 896px\); \}/);
  assert.doesNotMatch(accountStyles, /\.binance-account-content\.assets\s*\{/);
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
  assert.match(accountStyles, /--binance-skeleton: #e8edf4;/);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-skeleton: #283649;/s);
  assert.match(accountStyles, /\.binance-account-skeleton::after[\s\S]*animation: binance-account-skeleton-shimmer 1\.35s ease-in-out infinite;/s);
  assert.match(accountStyles, /@keyframes binance-account-skeleton-shimmer/);
  assert.match(accountStyles, /@media \(max-width: 1000px\)[\s\S]*\.binance-account-skeleton-metric-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/s);
  assert.match(accountStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.binance-account-skeleton::after \{ animation: none; \}/s);
  assert.doesNotMatch(accountStyles, /\.binance-account-loading-spinner/);
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
  assert.match(accountStyles, /@media \(max-width: 760px\) \{[\s\S]*?\.binance-account-content\.profit-calendar \{ width: 100%; \}/s);
  assert.match(accountStyles, /\.binance-account-primary-amount strong \{[^}]*font-size: calc\(31px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 600;[^}]*letter-spacing: -0\.15px;/s);
  assert.match(accountStyles, /\.binance-account-primary-amount\.compact strong \{[^}]*font-size: calc\(31px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(accountStyles, /\.binance-account-pnl-row strong \{[^}]*font-weight: 500;/s);
  assert.match(accountStyles, /\.binance-account-realized-value \{[^}]*font-weight: 500;/s);
  assert.match(accountStyles, /--binance-positive: #0a9d68;[\s\S]*--binance-negative: #e8465b;/s);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-positive: #27c894;[\s\S]*--binance-negative: #ff5f73;/s);
  assert.match(accountStyles, /--binance-calendar-profit-bg: #e6f6ed;[\s\S]*--binance-calendar-loss-bg: #fff0f2;[\s\S]*--binance-calendar-neutral-bg: #ffffff;/s);
  assert.match(accountStyles, /html\[data-theme="dark"\][\s\S]*--binance-calendar-profit-bg: #18372c;[\s\S]*--binance-calendar-loss-bg: #3c2228;[\s\S]*--binance-calendar-neutral-bg: #17191e;/s);
  assert.match(accountStyles, /\.binance-account-metric-grid \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);[^}]*gap: 18px;/s);
  assert.match(accountStyles, /\.binance-account-profit-calendar \{[^}]*border: 1px solid var\(--card-border-subtle\);[^}]*background: var\(--binance-surface\);[^}]*padding: 23px 26px 24px;/s);
  assert.match(accountStyles, /\.binance-account-profit-calendar > header \{[^}]*justify-content: space-between;[^}]*gap: 16px;/s);
  assert.match(accountStyles, /\.binance-account-profit-month-total \{[^}]*margin-left: auto;[^}]*font-variant-numeric: tabular-nums;[^}]*white-space: nowrap;/s);
  assert.match(accountStyles, /\.binance-account-profit-month-total > span \{[^}]*position: relative;[^}]*top: -1px;/s);
  assert.match(accountStyles, /\.binance-account-profit-month-total > strong \{[^}]*color: inherit;[^}]*font-weight: 500;/s);
  assert.match(accountStyles, /\.binance-account-profit-month-total > small \{[^}]*position: relative;[^}]*top: -1px;[^}]*color: var\(--binance-label-text\);/s);
  assert.match(accountStyles, /\.binance-account-profit-grid,[\s\S]*?\.binance-account-profit-calendar-loading \{[^}]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\);[^}]*gap: 7px;/s);
  assert.match(accountStyles, /\.binance-account-profit-day \{[\s\S]*?min-height: 52px;[\s\S]*?gap: 2px;/s);
  assert.match(accountStyles, /\.binance-account-profit-day\.profit \{[^}]*background: var\(--binance-calendar-profit-bg\);/s);
  assert.match(accountStyles, /\.binance-account-profit-day\.loss \{[^}]*background: var\(--binance-calendar-loss-bg\);/s);
  assert.match(accountStyles, /\.binance-account-profit-day \{[\s\S]*?background: var\(--binance-calendar-neutral-bg\);/s);
  assert.match(accountStyles, /\.binance-account-profit-month-nav > button:hover:not\(:disabled\)/);
  assert.match(accountStyles, /\.binance-account-profit-month-nav > button:active:not\(:disabled\)/);
  assert.match(accountStyles, /\.binance-account-profit-month-nav > button:disabled/);
  assert.doesNotMatch(accountStyles, /@media \(max-width: 1100px\)/);
  assert.match(accountStyles, /@media \(max-width: 760px\)[\s\S]*?\.binance-account-profit-calendar \{ padding: 19px 20px 22px; \}/s);
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
  assert.match(accountStyles, /\.binance-account-empty-positions \{[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: transparent;/s);
  assert.match(accountStyles, /\.binance-account-empty-positions strong \{[^}]*font-size: calc\(14px \+ var\(--app-font-size-offset\)\);[^}]*font-weight: 400;/s);
  assert.match(accountStyles, /\.binance-account-open-order-list \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*gap: 14px;/s);
  assert.match(accountStyles, /\.binance-account-open-order-card \{[^}]*border: 1px solid var\(--binance-border\);[^}]*border-radius: 14px;[^}]*background: var\(--binance-surface\);[^}]*padding: 18px 20px 20px;[^}]*color: var\(--binance-text\);/s);
  assert.match(accountStyles, /@media \(max-width: 1000px\) \{[\s\S]*?\.binance-account-open-order-list \{ grid-template-columns: minmax\(0, 1fr\); \}/s);
  assert.doesNotMatch(accountStyles, /\.binance-account-open-order-card > footer/);
  assert.match(accountStyles, /\.binance-account-open-order-progress > span \{[^}]*background: var\(--binance-surface-active\);/s);
  assert.match(accountStyles, /\.binance-account-open-order-progress i \{[^}]*background: var\(--binance-positive\);/s);
  assert.match(accountStyles, /\.binance-account-open-order-card\.sell \.binance-account-open-order-progress i \{ background: var\(--binance-negative\); \}/);
  assert.match(accountStyles, /\.binance-account-open-order-intro > strong \{[^}]*font-size: calc\(11px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(accountStyles, /\.binance-account-open-order-card\.sell \.binance-account-open-order-intro > strong \{ color: var\(--binance-negative\); \}/);
  assert.match(accountStyles, /\.binance-account-open-order-details span \{[^}]*font-size: calc\(13px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(accountStyles, /\.binance-account-open-order-details strong \{[^}]*font-size: calc\(13px \+ var\(--app-font-size-offset\)\);/s);
  assert.match(accountStyles, /\.binance-account-empty-open-orders \{[^}]*border: 0;[^}]*background: var\(--binance-surface\);[^}]*color: var\(--binance-text-secondary\);/s);
  assert.doesNotMatch(accountStyles, /\.binance-account-empty-open-orders \{[^}]*border: 1px/s);
  assert.doesNotMatch(accountStyles, /\.binance-account-open-order[^\n{]*button/);
  assert.match(accountStyles, /\.binance-account-history-list \{[^}]*border: 1px solid var\(--card-border-subtle\);[^}]*background: var\(--binance-surface\);/s);
  assert.match(accountStyles, /\.binance-account-history-card \+ \.binance-account-history-card \{ border-top: 1px solid var\(--card-border-subtle\); \}/);
  assert.match(accountStyles, /\.binance-account-history-body \{[^}]*grid-template-columns: minmax\(0, 1\.35fr\) repeat\(4, minmax\(0, 1fr\)\);/s);
  assert.match(accountStyles, /\.binance-account-history-card\.short \.binance-account-history-symbol > \.binance-account-history-direction/);
  assert.match(accountStyles, /@media \(max-width: 1000px\) \{[\s\S]*?\.binance-account-history-body \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/s);
  assert.doesNotMatch(accountStyles, /#(?:f0b90b|d9a600|c99a00|f8c72b|fff8db|7a5c00|332b10|f3cf55)\b/i);
  assert.doesNotMatch(accountStyles, /\.binance-account-(?:metric|position-list|empty-positions) \{[^}]*border-top:/s);
  assert.doesNotMatch(accountStyles, /binance-account-source-note/);
  assert.doesNotMatch(accountStyles, /binance-account-usd-equivalent/);
  assert.match(accountStyles, /\.binance-account-unbound-card \{[^}]*border: 0;[^}]*border-radius: 0;[^}]*background: transparent;/s);
  assert.doesNotMatch(accountStyles, /\.binance-account-unbound-card \{[^}]*border: 1px/s);
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
      marginRatio: 3.5,
      entryPrice: 1883.91,
      markPrice: 1884.21,
      liquidationPrice: 1951.3,
      breakEvenPrice: 1883.65,
      marginAsset: "USDT",
      updatedAt: Date.now(),
    }],
    openOrders: [{
      id: "order-buy",
      source: "ORDER",
      symbol: "EDENUSDT",
      contractType: "PERPETUAL",
      orderType: "LIMIT",
      side: "BUY",
      positionSide: "BOTH",
      status: "NEW",
      timeInForce: "GTC",
      quantityUsdt: 13.37,
      executedQuantityUsdt: 0,
      progressPercent: 0,
      price: 0.07,
      averagePrice: null,
      triggerPrice: null,
      activationPrice: null,
      callbackRate: null,
      workingType: null,
      reduceOnly: false,
      closePosition: false,
      priceProtect: false,
      priceMatch: null,
      createdAt: Date.parse("2026-08-14T11:37:07.000Z"),
      updatedAt: Date.parse("2026-08-14T11:37:07.000Z"),
    }, {
      id: "order-sell",
      source: "ORDER",
      symbol: "EDENUSDT",
      contractType: "PERPETUAL",
      orderType: "LIMIT",
      side: "SELL",
      positionSide: "BOTH",
      status: "NEW",
      timeInForce: "GTC",
      quantityUsdt: 12.42,
      executedQuantityUsdt: 0,
      progressPercent: 0,
      price: 0.09,
      averagePrice: null,
      triggerPrice: null,
      activationPrice: null,
      callbackRate: null,
      workingType: null,
      reduceOnly: false,
      closePosition: false,
      priceProtect: false,
      priceMatch: null,
      createdAt: Date.parse("2026-08-14T11:46:55.000Z"),
      updatedAt: Date.parse("2026-08-14T11:46:55.000Z"),
    }, {
      id: "algo-conditional-limit-sell",
      source: "ALGO",
      symbol: "EDENUSDT",
      contractType: "PERPETUAL",
      orderType: "TAKE_PROFIT",
      side: "SELL",
      positionSide: "BOTH",
      status: "NEW",
      timeInForce: "GTC",
      quantityUsdt: 10.92,
      executedQuantityUsdt: null,
      progressPercent: null,
      price: 0.091,
      averagePrice: null,
      triggerPrice: 0.09,
      activationPrice: null,
      callbackRate: null,
      workingType: "CONTRACT_PRICE",
      reduceOnly: false,
      closePosition: false,
      priceProtect: false,
      priceMatch: null,
      createdAt: Date.parse("2026-08-14T11:56:21.000Z"),
      updatedAt: Date.parse("2026-08-14T11:56:21.000Z"),
    }, {
      id: "algo-stop-market-sell",
      source: "ALGO",
      symbol: "EDENUSDT",
      contractType: "PERPETUAL",
      orderType: "STOP_MARKET",
      side: "SELL",
      positionSide: "BOTH",
      status: "NEW",
      timeInForce: null,
      quantityUsdt: 19.197,
      executedQuantityUsdt: null,
      progressPercent: null,
      price: null,
      averagePrice: null,
      triggerPrice: 0.079,
      activationPrice: null,
      callbackRate: null,
      workingType: "CONTRACT_PRICE",
      reduceOnly: true,
      closePosition: false,
      priceProtect: false,
      priceMatch: null,
      createdAt: Date.parse("2026-08-14T11:26:59.000Z"),
      updatedAt: Date.parse("2026-08-14T11:26:59.000Z"),
    }, {
      id: "algo-take-profit-market-buy",
      source: "ALGO",
      symbol: "EDENUSDT",
      contractType: "PERPETUAL",
      orderType: "TAKE_PROFIT_MARKET",
      side: "BUY",
      positionSide: "SHORT",
      status: "NEW",
      timeInForce: null,
      quantityUsdt: 3.22,
      executedQuantityUsdt: null,
      progressPercent: null,
      price: null,
      averagePrice: null,
      triggerPrice: 0.07,
      activationPrice: null,
      callbackRate: null,
      workingType: "CONTRACT_PRICE",
      reduceOnly: true,
      closePosition: false,
      priceProtect: false,
      priceMatch: null,
      createdAt: Date.parse("2026-08-14T11:48:14.000Z"),
      updatedAt: Date.parse("2026-08-14T11:48:14.000Z"),
    }, {
      id: "algo-stop-limit-buy",
      source: "ALGO",
      symbol: "EDENUSDT",
      contractType: "PERPETUAL",
      orderType: "STOP",
      side: "BUY",
      positionSide: "BOTH",
      status: "NEW",
      timeInForce: "GTC",
      quantityUsdt: 4.14,
      executedQuantityUsdt: null,
      progressPercent: null,
      price: 0.091,
      averagePrice: null,
      triggerPrice: 0.09,
      activationPrice: null,
      callbackRate: null,
      workingType: "CONTRACT_PRICE",
      reduceOnly: true,
      closePosition: false,
      priceProtect: false,
      priceMatch: null,
      createdAt: Date.parse("2026-08-14T11:48:14.000Z"),
      updatedAt: Date.parse("2026-08-14T11:48:14.000Z"),
    }, {
      id: "algo-take-profit-limit-sell",
      source: "ALGO",
      symbol: "EDENUSDT",
      contractType: "PERPETUAL",
      orderType: "TAKE_PROFIT",
      side: "SELL",
      positionSide: "BOTH",
      status: "NEW",
      timeInForce: "GTC",
      quantityUsdt: 43.99,
      executedQuantityUsdt: null,
      progressPercent: null,
      price: 0.84,
      averagePrice: null,
      triggerPrice: 0.83,
      activationPrice: null,
      callbackRate: null,
      workingType: "CONTRACT_PRICE",
      reduceOnly: true,
      closePosition: false,
      priceProtect: true,
      priceMatch: null,
      createdAt: Date.parse("2026-08-14T11:43:57.000Z"),
      updatedAt: Date.parse("2026-08-14T11:43:57.000Z"),
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
      openOrders: "USD_M_OPEN_ORDERS+USD_M_OPEN_ALGO_ORDERS",
    },
    warnings: [],
    fetchedAt: "2026-08-13T04:00:00.000Z",
  };
}
