import { app, BrowserWindow } from "electron/main";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.resolve(
  process.env.HAOLO_BINANCE_ACCOUNT_VISUAL_QA_DIR
    || path.join(ROOT, ".tmp", "binance-account-visual-qa"),
);
const INDEX = path.join(ROOT, "dist", "renderer", "index.html");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(window, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    await delay(100);
  }
  throw new Error(`等待账户界面超时：${expression}`);
}

async function settleTheme(window, theme) {
  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    let style = document.getElementById('binance-account-visual-qa-motion');
    if (!style) {
      style = document.createElement('style');
      style.id = 'binance-account-visual-qa-motion';
      style.textContent = '*, *::before, *::after { transition: none !important; }';
      document.head.append(style);
    }
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  })`, true);
  await delay(120);
}

async function capture(window, name, metadata) {
  const image = await window.webContents.capturePage();
  const file = path.join(OUTPUT, `${name}.png`);
  await writeFile(file, image.toPNG());
  const state = await window.webContents.executeJavaScript(`(() => {
    const page = document.querySelector('.binance-account-page');
    const card = document.querySelector('.binance-account-summary-card, .binance-account-position-card, .binance-account-open-order-card, .binance-account-history-card, .binance-account-unbound-card');
    const panel = document.querySelector('.trading-expert-panel');
    const panelInner = panel?.querySelector('.agent-panel-inner');
    const panelHeader = panel?.querySelector('.trading-expert-panel-header');
    const panelMessages = panel?.querySelector('.trading-expert-message-scroller');
    const panelComposer = panel?.querySelector(':scope > .composer');
    const unboundCard = document.querySelector('.binance-account-unbound-card');
    const unboundTitle = unboundCard?.querySelector('h2');
    const bindButton = unboundCard?.querySelector('.binance-account-bind-button');
    const tutorialButton = unboundCard?.querySelector('.binance-account-tutorial-button');
    const accountDialogSubmit = document.querySelector('.binance-account-dialog button[type="submit"]');
    const leftToggle = document.querySelector('[data-action="toggle-left-panel"]');
    const conversationList = document.querySelector('.desktop-body > .chat-list');
    const favoriteHost = document.querySelector('[data-titlebar-market-favorites-host]');
    const primaryAmountValue = document.querySelector('.binance-account-primary-amount strong');
    const profitMonthTotal = document.querySelector('.binance-account-profit-month-total');
    const openOrderType = document.querySelector('.binance-account-open-order-intro > strong');
    const openOrderLabel = document.querySelector('.binance-account-open-order-details span');
    const openOrderValue = document.querySelector('.binance-account-open-order-details strong');
    const pageStyle = page ? getComputedStyle(page) : null;
    const cardStyle = card ? getComputedStyle(card) : null;
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const panelRect = rect(panel);
    const panelInnerRect = rect(panelInner);
    const panelHeaderRect = rect(panelHeader);
    const panelMessagesRect = rect(panelMessages);
    const panelComposerRect = rect(panelComposer);
    const panelLayoutComplete = Boolean(
      panelRect
      && panelInnerRect
      && panelHeaderRect
      && panelMessagesRect
      && panelComposerRect
      && panelRect.width >= 299
      && panelRect.right <= innerWidth + 1
      && panelInnerRect.left >= panelRect.left - 1
      && panelInnerRect.right <= panelRect.right + 1
      && panelHeaderRect.width >= 290
      && panelMessagesRect.width >= 290
      && panelComposerRect.width >= 270
      && panelComposerRect.left >= panelRect.left
      && panelComposerRect.right <= panelRect.right
    );
    const styleColors = unboundCard
      ? [...unboundCard.querySelectorAll('*')].flatMap((element) => {
          const style = getComputedStyle(element);
          return [style.color, style.backgroundColor, style.borderColor, style.fill, style.stroke];
        })
      : [];
    const positionCards = [...document.querySelectorAll('.binance-account-position-card')];
    const positionCardRects = positionCards.map(rect);
    const positionAlignments = positionCards.map((positionCard) => {
      const roi = positionCard.querySelector('.binance-account-position-featured > div:last-child');
      const rightMetric = positionCard.querySelector('.binance-account-position-metrics > div:nth-child(3)');
      const roiRect = rect(roi);
      const metricRect = rect(rightMetric);
      return {
        roiLeft: roiRect?.left || null,
        metricLeft: metricRect?.left || null,
        aligned: Boolean(roiRect && metricRect && Math.abs(roiRect.left - metricRect.left) <= 1),
      };
    });
    const yellowLikeStyles = [...new Set(styleColors.filter((value) => {
      const match = String(value).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!match) return false;
      const [, red, green, blue] = match.map(Number);
      return red >= 140 && green >= 100 && blue <= 100 && red > blue * 1.5 && green > blue * 1.35;
    }))];
    return {
      theme: document.documentElement.dataset.theme,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      desktopBodyClasses: document.querySelector('.desktop-body')?.className || '',
      pageVisible: Boolean(page),
      unboundVisible: Boolean(document.querySelector('.binance-account-unbound-card')),
      dialogVisible: Boolean(document.querySelector('.binance-account-dialog[open]')),
      accountDialogMode: document.querySelector('.binance-account-dialog form')?.getAttribute('data-binance-account-form-mode') || null,
      accountDialogSubmit: accountDialogSubmit ? {
        className: accountDialogSubmit.className,
        disabled: accountDialogSubmit.disabled,
        background: getComputedStyle(accountDialogSubmit).backgroundColor,
        border: getComputedStyle(accountDialogSubmit).borderColor,
        color: getComputedStyle(accountDialogSubmit).color,
        dangerAction: getComputedStyle(accountDialogSubmit).getPropertyValue('--binance-danger-action').trim(),
      } : null,
      summaryCards: document.querySelectorAll('.binance-account-summary-card').length,
      positions: document.querySelectorAll('.binance-account-position-card').length,
      openOrders: document.querySelectorAll('.binance-account-open-order-card').length,
      positionHistory: document.querySelectorAll('.binance-account-history-card').length,
      forbiddenMaximumOpenInterestVisible: document.querySelector('.binance-account-position-history')?.textContent?.includes('最大未平仓合约量') || false,
      positionTitleRemoved: !document.querySelector('#binanceAccountPositionsTitle'),
      positionCardRects,
      positionCardsShareRow: positionCardRects.length >= 2
        && Math.abs(positionCardRects[0].top - positionCardRects[1].top) <= 1
        && Math.abs(positionCardRects[0].width - positionCardRects[1].width) <= 1,
      positionAlignments,
      activeAccountSection: document.querySelector('.binance-account-tabs [aria-pressed="true"]')?.getAttribute('data-binance-account-section') || null,
      accountTabs: [...document.querySelectorAll('.binance-account-tabs button')].map((tab) => ({
        section: tab.getAttribute('data-binance-account-section'),
        label: tab.textContent?.trim() || '',
        selected: tab.getAttribute('aria-pressed') === 'true',
        rect: rect(tab),
      })),
      accountTabsRect: rect(document.querySelector('.binance-account-tabs')),
      accountToolbarRect: rect(document.querySelector('.binance-account-toolbar')),
      accountToolbarActionsRect: rect(document.querySelector('.binance-account-toolbar-actions')),
      accountRefreshButtonRect: rect(document.querySelector('.binance-account-toolbar-actions [data-binance-account-action="refresh"]')),
      accountSectionRect: rect(document.querySelector('.binance-account-content > :is(.binance-account-summary-card, .binance-account-positions, .binance-account-open-orders, .binance-account-position-history)')),
      accountContentRect: rect(document.querySelector('.binance-account-content')),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      accountHeaderRemoved: !document.querySelector('.binance-account-page-header'),
      favoriteTickersHidden: Boolean(
        favoriteHost
        && (favoriteHost.hidden || getComputedStyle(favoriteHost).display === 'none')
      ),
      leftToggleInBody: leftToggle?.parentElement?.classList.contains('desktop-body') || false,
      leftToggleInTitlebar: Boolean(leftToggle?.closest('.app-titlebar')),
      leftPanelCollapsed: document.querySelector('.desktop-body')?.classList.contains('left-panel-collapsed') || false,
      leftToggleExpanded: leftToggle?.getAttribute('aria-expanded') || null,
      conversationListRect: rect(conversationList),
      leftToggleRect: rect(leftToggle),
      pageRect: rect(page),
      pageTopLeftRadius: pageStyle?.borderTopLeftRadius || null,
      unboundYellowLikeStyles: yellowLikeStyles,
      unboundTypography: {
        titleFontSize: unboundTitle ? getComputedStyle(unboundTitle).fontSize : null,
        titleFontWeight: unboundTitle ? getComputedStyle(unboundTitle).fontWeight : null,
        bindButtonFontSize: bindButton ? getComputedStyle(bindButton).fontSize : null,
      },
      unboundButtonGeometry: {
        bindWidth: rect(bindButton)?.width || null,
        bindHeight: rect(bindButton)?.height || null,
        bindFontWeight: bindButton ? getComputedStyle(bindButton).fontWeight : null,
        tutorialHeight: rect(tutorialButton)?.height || null,
        tutorialFontWeight: tutorialButton ? getComputedStyle(tutorialButton).fontWeight : null,
      },
      accountTypography: {
        primaryAmountWeight: primaryAmountValue ? getComputedStyle(primaryAmountValue).fontWeight : null,
        openOrderTypeSize: openOrderType ? getComputedStyle(openOrderType).fontSize : null,
        openOrderLabelSize: openOrderLabel ? getComputedStyle(openOrderLabel).fontSize : null,
        openOrderValueSize: openOrderValue ? getComputedStyle(openOrderValue).fontSize : null,
      },
      profitMonthTotal: profitMonthTotal ? {
        text: profitMonthTotal.textContent?.replace(/\s+/g, ' ').trim() || '',
        className: profitMonthTotal.className,
        color: getComputedStyle(profitMonthTotal).color,
      } : null,
      panelLayoutComplete,
      panel: {
        rect: panelRect,
        innerRect: panelInnerRect,
        headerRect: panelHeaderRect,
        messagesRect: panelMessagesRect,
        composerRect: panelComposerRect,
        title: panelHeader?.querySelector('.trading-expert-panel-title')?.textContent?.trim() || '',
      },
      pageStyle: pageStyle ? { color: pageStyle.color, background: pageStyle.backgroundColor } : null,
      cardStyle: cardStyle ? { color: cardStyle.color, background: cardStyle.backgroundColor, border: cardStyle.borderColor } : null,
    };
  })()`, true);
  return { name, file, ...metadata, state };
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: "#101216",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const captures = [];
  try {
    await window.loadFile(INDEX);
    await waitFor(window, `document.querySelector('[data-conversation-static-action="account"]')`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-action="close-update-dialog"]')?.click()`, true);
    await window.webContents.executeJavaScript(`document.querySelector('[data-action="new-chat"]')?.click()`, true);
    await waitFor(window, `document.querySelector('[data-titlebar-market-favorites-host]:not([hidden])')`);
    await window.webContents.executeJavaScript(`document.querySelector('[data-conversation-static-action="account"]')?.click()`, true);
    await waitFor(window, `document.querySelector('.binance-account-unbound-card')`);
    await delay(600);
    await window.webContents.capturePage();
    await delay(180);
    for (const theme of ["light", "dark"]) {
      await settleTheme(window, theme);
      captures.push(await capture(window, `unbound-${theme}`, { surface: "unbound", theme }));
    }

    await window.webContents.executeJavaScript(`document.querySelector('[data-binance-account-action="open-dialog"]')?.click()`, true);
    await waitFor(window, `document.querySelector('.binance-account-dialog[open]')`);
    await waitFor(window, `document.querySelector('.binance-account-otp-copy')?.textContent?.includes('已向')`);
    for (const theme of ["light", "dark"]) {
      await settleTheme(window, theme);
      await window.webContents.executeJavaScript(`document.querySelector('.binance-account-dialog input[name="apiKey"]')?.focus()`, true);
      captures.push(await capture(window, `dialog-${theme}`, { surface: "dialog", theme }));
    }

    await window.webContents.executeJavaScript(`(() => {
      const fill = (name, value) => {
        const input = document.querySelector('.binance-account-dialog input[name="' + name + '"]');
        if (!input) return;
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      fill('apiKey', 'visual-qa-key');
      fill('apiSecret', 'visual-qa-secret');
      fill('code', '123456');
      document.querySelector('[data-binance-account-dialog-form]')?.requestSubmit();
    })()`, true);
    await waitFor(window, `document.querySelectorAll('.binance-account-summary-card').length === 2`);
    await delay(3_800);
    for (const theme of ["light", "dark"]) {
      await settleTheme(window, theme);
      captures.push(await capture(window, `assets-${theme}`, { surface: "assets", theme }));
      await window.webContents.executeJavaScript(`document.querySelector('[data-binance-account-section="profit-calendar"]')?.click()`, true);
      await waitFor(window, `document.querySelector('.binance-account-profit-calendar')`);
      await delay(120);
      captures.push(await capture(window, `profit-calendar-${theme}`, { surface: "profit-calendar", theme }));
      await window.webContents.executeJavaScript(`document.querySelector('[data-binance-account-section="positions"]')?.click()`, true);
      await waitFor(window, `document.querySelector('.binance-account-position-card')`);
      await delay(120);
      captures.push(await capture(window, `positions-${theme}`, { surface: "positions", theme }));
      await window.webContents.executeJavaScript(`document.querySelector('[data-binance-account-section="open-orders"]')?.click()`, true);
      await waitFor(window, `document.querySelector('.binance-account-open-order-card')`);
      await delay(120);
      captures.push(await capture(window, `open-orders-${theme}`, { surface: "open-orders", theme }));
      await window.webContents.executeJavaScript(`document.querySelector('[data-binance-account-section="history"]')?.click()`, true);
      await waitFor(window, `document.querySelector('.binance-account-history-card')`);
      await delay(120);
      captures.push(await capture(window, `history-${theme}`, { surface: "history", theme }));
      await window.webContents.executeJavaScript(`document.querySelector('[data-binance-account-section="assets"]')?.click()`, true);
      await waitFor(window, `document.querySelectorAll('.binance-account-summary-card').length === 2`);
      await delay(120);
      await window.webContents.executeJavaScript(`document.querySelector('[data-action="toggle-left-panel"]')?.click()`, true);
      await waitFor(window, `document.querySelector('.desktop-body.left-panel-collapsed')`);
      await delay(320);
      captures.push(await capture(window, `left-collapsed-${theme}`, { surface: "left-collapsed", theme }));
      await window.webContents.executeJavaScript(`document.querySelector('[data-action="toggle-left-panel"]')?.click()`, true);
      await waitFor(window, `!document.querySelector('.desktop-body.left-panel-collapsed')`);
      await delay(320);
      await window.webContents.executeJavaScript(`document.querySelector('[data-binance-account-action="remove"]')?.click()`, true);
      await waitFor(window, `document.querySelector('.app-confirmation-dialog')`);
      await window.webContents.executeJavaScript(`document.querySelector('[data-app-confirmation-action="confirm"]')?.click()`, true);
      await waitFor(window, `document.querySelector('[data-binance-account-form-mode="remove"]')`);
      await waitFor(window, `document.querySelector('.binance-account-otp-copy')?.textContent?.includes('已向')`);
      await settleTheme(window, theme);
      captures.push(await capture(window, `remove-dialog-${theme}`, { surface: "remove-dialog", theme }));
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[data-binance-account-form-mode="remove"] input[name="code"]');
        if (!input) return;
        input.value = '123456';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`, true);
      await waitFor(window, `!document.querySelector('[data-binance-account-form-mode="remove"] button[type="submit"]')?.disabled`);
      captures.push(await capture(window, `remove-dialog-ready-${theme}`, { surface: "remove-dialog-ready", theme }));
      await window.webContents.executeJavaScript(`document.querySelector('.binance-account-dialog-close')?.click()`, true);
      await waitFor(window, `!document.querySelector('.binance-account-dialog[open]')`);
      await delay(120);
    }
    await writeFile(path.join(OUTPUT, "report.json"), `${JSON.stringify({ captures }, null, 2)}\n`, "utf8");
    const incompletePanel = captures.find((entry) => !entry.state.panelLayoutComplete);
    if (incompletePanel) {
      throw new Error(`账户页右侧会话布局不完整：${incompletePanel.name}`);
    }
    const visibleAccountHeader = captures.find((entry) => !entry.state.accountHeaderRemoved);
    if (visibleAccountHeader) {
      throw new Error(`账户页顶部标题区仍然存在：${visibleAccountHeader.name}`);
    }
    const yellowUnbound = captures.find((entry) => entry.state.unboundYellowLikeStyles.length > 0);
    if (yellowUnbound) {
      throw new Error(`账户未绑定态仍包含黄色样式：${yellowUnbound.name}`);
    }
    const wrongLightBackground = captures.find((entry) => (
      entry.theme === 'light'
      && entry.state.pageStyle?.background !== 'rgb(255, 255, 255)'
    ));
    if (wrongLightBackground) {
      throw new Error(`账户亮色画布不是纯白：${wrongLightBackground.name}`);
    }
    const wrongTypography = captures.find((entry) => (
      entry.surface === 'unbound'
      && (entry.state.unboundTypography.titleFontSize !== '25px'
        || entry.state.unboundTypography.titleFontWeight !== '400'
        || entry.state.unboundTypography.bindButtonFontSize !== '12px')
    ));
    if (wrongTypography) {
      throw new Error(`账户未绑定态字号不正确：${wrongTypography.name}`);
    }
    const wrongButtonGeometry = captures.find((entry) => (
      entry.surface === 'unbound'
      && (Math.abs(entry.state.unboundButtonGeometry.bindWidth - 88.5) > 0.2
        || Math.abs(entry.state.unboundButtonGeometry.bindHeight - 38) > 0.2
        || Math.abs(entry.state.unboundButtonGeometry.tutorialHeight - 38) > 0.2
        || entry.state.unboundButtonGeometry.bindFontWeight !== '400'
        || entry.state.unboundButtonGeometry.tutorialFontWeight !== '400')
    ));
    if (wrongButtonGeometry) {
      throw new Error(`账户未绑定态按钮尺寸不正确：${wrongButtonGeometry.name}`);
    }
    const wrongRemovalReady = captures.find((entry) => (
      entry.surface === 'remove-dialog-ready'
      && (entry.state.accountDialogMode !== 'remove'
        || entry.state.accountDialogSubmit?.className !== 'binance-account-submit danger'
        || entry.state.accountDialogSubmit?.disabled
        || entry.state.accountDialogSubmit?.background !== (entry.theme === 'dark' ? 'rgb(255, 95, 115)' : 'rgb(198, 40, 66)')
        || entry.state.accountDialogSubmit?.color !== (entry.theme === 'dark' ? 'rgb(16, 18, 22)' : 'rgb(255, 255, 255)'))
    ));
    if (wrongRemovalReady) {
      throw new Error(`账户解绑验证码按钮主题不正确：${wrongRemovalReady.name}`);
    }
    const wrongWorkspaceChrome = captures.find((entry) => (
      !entry.state.favoriteTickersHidden
      || !entry.state.leftToggleInBody
      || entry.state.leftToggleInTitlebar
      || entry.state.pageTopLeftRadius !== '16px'
      || Math.abs((entry.state.leftToggleRect?.left || 0) - (entry.state.pageRect?.left || 0) - 4) > 2
    ));
    if (wrongWorkspaceChrome) {
      throw new Error(`账户页全局工作区外观不正确：${wrongWorkspaceChrome.name}`);
    }
    const brokenAccountLeftCollapse = captures.find((entry) => (
      entry.surface === 'left-collapsed'
      && (!entry.state.leftPanelCollapsed
        || entry.state.leftToggleExpanded !== 'false'
        || !entry.state.conversationListRect
        || entry.state.conversationListRect.width > 1
        || Math.abs((entry.state.pageRect?.left || 0) - (entry.state.conversationListRect?.left || 0)) > 1)
    ));
    if (brokenAccountLeftCollapse) {
      throw new Error(`账户页左侧栏点击收起失败：${brokenAccountLeftCollapse.name}`);
    }
    const wrongAccountTabs = captures.find((entry) => (
      (entry.surface === 'assets' || entry.surface === 'positions' || entry.surface === 'open-orders' || entry.surface === 'history')
      && (entry.state.accountTabs.length !== 4
        || entry.state.accountTabs.map((tab) => tab.label).join(',') !== '资产,持仓,当前委托,仓位历史'
        || entry.state.activeAccountSection !== entry.surface
        || entry.state.accountTabs.filter((tab) => tab.selected).length !== 1)
    ));
    if (wrongAccountTabs) {
      throw new Error(`账户页分类栏状态不正确：${wrongAccountTabs.name}`);
    }
    const misalignedAccountActions = captures.find((entry) => {
      if (entry.surface !== 'assets' && entry.surface !== 'positions' && entry.surface !== 'open-orders' && entry.surface !== 'history') return false;
      const activeTabRect = entry.state.accountTabs.find((tab) => tab.selected)?.rect;
      const refreshRect = entry.state.accountRefreshButtonRect;
      const actionsRect = entry.state.accountToolbarActionsRect;
      const sectionRect = entry.state.accountSectionRect;
      return !activeTabRect
        || !refreshRect
        || !actionsRect
        || !sectionRect
        || Math.abs((activeTabRect.top + activeTabRect.bottom) / 2 - (refreshRect.top + refreshRect.bottom) / 2) > 1
        || Math.abs(actionsRect.right - sectionRect.right) > 2;
    });
    if (misalignedAccountActions) {
      throw new Error(`账户操作图标未与分类栏或下方内容右边框对齐：${misalignedAccountActions.name}`);
    }
    const wrongPositionHistory = captures.find((entry) => (
      entry.surface === 'history'
      && (entry.state.positionHistory < 1 || entry.state.forbiddenMaximumOpenInterestVisible)
    ));
    if (wrongPositionHistory) {
      throw new Error(`仓位历史内容不正确：${wrongPositionHistory.name}`);
    }
    const wrongAccountTypography = captures.find((entry) => (
      (entry.surface === 'assets' && entry.state.accountTypography.primaryAmountWeight !== '600')
      || (entry.surface === 'open-orders'
        && (entry.state.accountTypography.openOrderTypeSize !== '11px'
          || entry.state.accountTypography.openOrderLabelSize !== '13px'
          || entry.state.accountTypography.openOrderValueSize !== '13px'))
    ));
    if (wrongAccountTypography) {
      throw new Error(`账户资产或当前委托字号不正确：${wrongAccountTypography.name}`);
    }
    const mixedAccountContent = captures.find((entry) => (
      entry.surface === 'assets'
        ? entry.state.summaryCards !== 2 || entry.state.positions !== 0 || entry.state.openOrders !== 0
        : entry.surface === 'positions'
          ? entry.state.summaryCards !== 0 || entry.state.positions < 1 || entry.state.openOrders !== 0
          : entry.surface === 'open-orders'
            ? entry.state.summaryCards !== 0 || entry.state.positions !== 0 || entry.state.openOrders < 1
            : false
    ));
    if (mixedAccountContent) {
      throw new Error(`账户分类内容没有完全分离：${mixedAccountContent.name}`);
    }
    const wrongPositionLayout = captures.find((entry) => (
      entry.surface === 'positions'
      && (!entry.state.positionTitleRemoved
        || entry.state.positions < 2
        || !entry.state.positionCardsShareRow
        || entry.state.positionAlignments.some((alignment) => !alignment.aligned))
    ));
    if (wrongPositionLayout) {
      throw new Error(`持仓双列或投资回报率对齐不正确：${wrongPositionLayout.name}`);
    }
    const overflowingAccount = captures.find((entry) => (
      (entry.surface === 'assets' || entry.surface === 'positions' || entry.surface === 'open-orders' || entry.surface === 'history')
      && entry.state.horizontalOverflow
    ));
    if (overflowingAccount) {
      throw new Error(`账户分类页面出现横向溢出：${overflowingAccount.name}`);
    }
    await writeFile(path.join(OUTPUT, "report.json"), `${JSON.stringify({ captures }, null, 2)}\n`, "utf8");
  } finally {
    window.destroy();
    app.quit();
  }
}

main().catch((error) => {
  process.exitCode = 1;
  console.error(error?.stack || error);
  app.quit();
});
