import { app, BrowserWindow } from "electron/main";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.HAOLO_WATCHLIST_QA_OUTPUT || path.join(root, ".tmp", "trading-watchlist-qa");
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();
async function main() {
  await mkdir(output, { recursive: true });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const report = { checks: [], screenshots: [], errors: [] };
  let server, window;
  try {
    server = await createServer({
      configFile: false,
      root: path.join(root, "src", "renderer"),
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: true,
        hmr: false,
        fs: { allow: [root] },
      },
      clearScreen: false,
    });
    await server.listen();
    await app.whenReady();
    window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const js = (source) => window.webContents.executeJavaScript(source, true);
    const check = (name) => report.checks.push(name);
    const click = async (selector) => {
      await js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await pause(90);
    };
    const wait = async (expression) => {
      for (let i = 0; i < 150; i++) {
        if (await js(expression)) return;
        const error = await js("window.qaError || ''");
        if (error) throw Error(error);
        await pause(100);
      }
      throw Error(`Timed out: ${expression}`);
    };
    const capture = async (name) => {
      await js(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      window.webContents.invalidate();
      await pause(220);
      const file = path.join(output, `${name}.png`);
      await writeFile(file, (await window.webContents.capturePage()).toPNG());
      report.screenshots.push(file);
    };
    const cdp = (method, params) => window.webContents.debugger.sendCommand(method, params);
    const forceState = async (selector, pseudoClasses = []) => {
      const { root: documentNode } = await cdp("DOM.getDocument");
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: documentNode.nodeId, selector });
      assert.ok(nodeId, selector);
      await cdp("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: pseudoClasses });
    };
    const style = (selector) => js(`(() => {
      const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
      return Object.fromEntries(['backgroundColor','color','borderTopWidth','borderBottomWidth','borderLeftWidth','borderTopColor','borderRadius','outlineWidth','boxShadow','fontSize','fontWeight','opacity'].map(key => [key,s[key]]));
    })()`);
    const contrast = (foreground, background) => {
      const luminance = (color) => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const fixtureUrl = `${server.resolvedUrls.local[0]}@fs/${path.join(root, "test", "fixtures", "trading-watchlist.html").replaceAll("\\", "/")}`;
    await window.loadURL(fixtureUrl);
    await wait("window.ready === true");
    window.webContents.debugger.attach("1.3");
    await cdp("DOM.enable");
    await cdp("CSS.enable");
    await js("localStorage.clear()");
    await window.loadURL(`${fixtureUrl}?hold-indices=1`);
    await wait("window.ready === true");
    assert.equal(
      await js("document.querySelector('[data-watchlist-host]').hidden"),
      false,
    );
    assert.equal(
      await js("document.querySelector('[data-watchlist-toggle]').textContent"),
      "收起自选",
    );
    assert.equal(await js("document.querySelector('[data-watchlist-toggle]').getAttribute('aria-expanded')"), "true");
    check("A fresh account opens the watchlist by default with matching toggle accessibility state");
    assert.equal(await js('qaIndexCalls'), 1, 'preload starts before opening any fixed category');
    assert.equal(await js('workspace.watchlist.activeGroupId'), 'watchlist');
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}'`);
      await click('[data-group-id="indices"]');
      assert.equal(await js('workspace.watchlistPanel.indices.loading'), true);
      assert.equal(await js("document.querySelectorAll('.trading-index-footer,[data-watchlist-action=refresh-indices],.trading-watchlist-empty').length"), 0);
      assert.doesNotMatch(await js("document.querySelector('[data-watchlist-host]').textContent"), /正在加载|更新中|来源[：:]/);
      await capture(`indices-silent-${theme}`);
      await click('[data-group-id="tradfi"]');
      await js("workspace.watchlistTradFiState='loading';workspace.watchlist.groups.find(group=>group.id==='tradfi').markets=[];workspace.watchlistPanel.refresh()");
      assert.equal(await js("document.querySelectorAll('.trading-watchlist-empty').length"), 0);
      await capture(`tradfi-silent-${theme}`);
      await js("workspace.watchlist.updateTradFiMarkets(qaMarkets);workspace.watchlistTradFiState='ready';workspace.watchlistPanel.refresh()");
      await click('[data-group-id="watchlist"]');
    }
    await js('qaReleaseIndices()');
    await wait('workspace.watchlistPanel.indices.indices.length === 7');
    assert.equal(await js('qaIndexCalls'), 1, 'switching categories does not duplicate pending requests');
    await click('[data-group-id="indices"]');
    assert.equal(await js("document.querySelectorAll('[data-watchlist-index]').length"), 7, 'warm data displays immediately');
    assert.equal(await js('qaIndexCalls'), 1, 'opening a warm category does not fetch again');
    await click('[data-group-id="watchlist"]');
    check('Both themes preload indices before tab clicks, show no loading text or source footer, and render warm data without another request');
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}';
        window.qaHistoryMarkup='<p>历史会话：基于当前 1 小时已收盘 K 线的分析记录</p><button type="button">添加到计划</button>';
        document.querySelector('.qa-task').innerHTML=qaHistoryMarkup;`);
      for (const count of [0, 3, 18]) {
        await js(`workspace.watchlist.groups[0].markets=qaMarkets.slice(0, ${count}); workspace.watchlistPanel.refresh()`);
        assert.equal(await js("getComputedStyle(document.querySelector('#trading-expert-panel-chat')).display"), "none", `${theme}, ${count} rows: expanded watchlist hides history`);
        assert.equal(await js("document.querySelector('.qa-task button').getClientRects().length"), 0, `${theme}: history actions are hidden`);
        assert.ok(await js("document.querySelector('.composer textarea').checkVisibility()"), `${theme}: composer stays visible`);
        if (count === 3) await capture(`history-hidden-${theme}`);
        await click('[data-watchlist-toggle]');
        assert.ok(await js("document.querySelector('.qa-task').checkVisibility()"), `${theme}: collapse restores history`);
        assert.equal(await js("document.querySelector('.qa-task').innerHTML === qaHistoryMarkup"), true, `${theme}: history content and actions are preserved`);
        if (count === 3) await capture(`history-restored-${theme}`);
        await click('[data-watchlist-toggle]');
        await js("document.querySelector('.trading-expert-panel').outerHTML=qaPanelMarkup(); document.querySelector('.qa-task').innerHTML=qaHistoryMarkup; workspace.syncWatchlistHost()");
        assert.equal(await js("getComputedStyle(document.querySelector('#trading-expert-panel-chat')).display"), "none", `${theme}: history stays hidden after panel rerender`);
      }
    }
    await js("workspace.watchlist.groups[0].markets=[]; workspace.watchlistPanel.refresh()");
    check("Both themes hide history and its actions while watchlists are expanded, restore intact history on collapse, and preserve visibility across empty/short/long lists and panel rerenders");
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}'; workspace.watchlist.addMarkets(qaMarkets); workspace.watchlistPanel.refresh(); document.querySelector('.qa-task').textContent='分析一下当前走势'; document.querySelector('.composer textarea').focus()`);
      const expandedHeight = await js("document.querySelector('.trading-expert-dashboard').getBoundingClientRect().height");
      await click('[data-watchlist-action="menu"]');
      await js("document.querySelector('.composer textarea').focus(); workspace.collapseWatchlist()");
      assert.equal(await js("document.querySelector('[data-watchlist-host]').hidden"), true);
      assert.equal(await js("document.querySelector('[data-watchlist-toggle]').textContent"), "展开自选");
      assert.equal(await js("document.querySelector('[data-watchlist-toggle]').getAttribute('aria-expanded')"), "false");
      assert.equal(await js("document.querySelectorAll('[data-watchlist-menu]:popover-open').length"), 0);
      assert.equal(await js("document.activeElement.tagName"), "TEXTAREA");
      assert.ok(await js(`document.querySelector('.trading-expert-dashboard').getBoundingClientRect().height > ${expandedHeight}`));
      assert.ok(await js(`(() => {
        const message = document.querySelector('.qa-task');
        const rect = message.getBoundingClientRect();
        return message.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })()`), `${theme}: message is visible after collapsing`);
      const messageStyle = await style('.qa-task');
      assert.ok(contrast(messageStyle.color, (await style('.trading-expert-dashboard')).backgroundColor) >= 4.5, `${theme}: message contrast`);
      await capture(`composer-message-${theme}`);
      await js("workspace.collapseWatchlist(); document.querySelector('.trading-expert-panel').outerHTML=qaPanelMarkup(); workspace.syncWatchlistHost()");
      assert.equal(await js("document.querySelector('[data-watchlist-host]').hidden"), true, "repeated sends and rerenders keep messages visible");
      await click('[data-watchlist-toggle]');
      assert.equal(await js("document.querySelector('[data-watchlist-host]').hidden"), false, "manual reopening remains available");
      assert.equal(await js("document.querySelectorAll('[data-watchlist-row]').length"), 18, "collapse preserves watchlist members");
      await js("workspace.watchlist.groups[0].markets=[]; workspace.watchlist.save(); workspace.watchlistPanel.refresh()");
    }
    check("Composer collapse reveals messages in both themes, closes open menus, preserves focus and members, survives rerenders, and allows manual reopening");
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}'`);
      const hostStyle = await style('[data-watchlist-host]');
      assert.equal(hostStyle.borderBottomWidth, "0px");
      assert.equal(hostStyle.backgroundColor, (await style('.trading-expert-panel .agent-panel-inner')).backgroundColor, `${theme} surrounding panel`);
      assert.equal(hostStyle.backgroundColor, (await style('.trading-expert-dashboard')).backgroundColor, `${theme} conversation surface`);
      for (const selector of ['.trading-watchlist-tabs', '.trading-watchlist-head']) {
        assert.equal((await style(selector)).backgroundColor, hostStyle.backgroundColor, `${theme} ${selector}`);
      }
      if (theme === "light") assert.equal(hostStyle.backgroundColor, "rgb(255, 255, 255)");
      const nameStyle = await style('.trading-watchlist-head > span');
      for (const selector of ['[data-watchlist-action="sort-price"]', '[data-watchlist-action="sort-change"]']) {
        for (const state of ["", "hover", "active", "focus-visible"]) {
          await forceState(selector, state ? [state] : []);
          const headerStyle = await style(selector);
          assert.equal(headerStyle.fontSize, nameStyle.fontSize, `${theme} matching header size`);
          assert.equal(headerStyle.fontWeight, "400", `${theme} matching header weight`);
          assert.equal(headerStyle.color, nameStyle.color, `${theme} matching header color`);
          assert.equal(headerStyle.backgroundColor, "rgba(0, 0, 0, 0)", `${theme} no header state fill`);
          assert.ok(contrast(headerStyle.color, hostStyle.backgroundColor) >= 4.5, `${theme} header contrast`);
        }
        await forceState(selector);
      }
      const addGroup = '[data-watchlist-action="new-group"]';
      assert.equal((await style(addGroup)).borderLeftWidth, "0px");
      for (const state of ["hover", "active", "focus-visible"]) {
        await forceState(addGroup, [state]);
        assert.equal((await style(addGroup)).borderLeftWidth, "0px");
      }
      await forceState(addGroup);
      const recommendations = await js("[...document.querySelectorAll('[data-watchlist-recommendation]')].map(e=>({id:e.dataset.watchlistRecommendation,checked:e.checked}))");
      assert.deepEqual(recommendations.map(r => r.id), ['BTC','ETH','ZEC','BNB','SNDK','MU','SKHYNIX','XAU'].map(s => `BINANCE:FUTURES:${s}USDT`));
      assert.ok(recommendations.every(r => r.checked));
      const recommendationInput = '[data-watchlist-recommendation]';
      assert.equal((await style(recommendationInput)).backgroundColor, 'rgb(5, 5, 5)');
      const recommendationAction = '[data-watchlist-action="add-recommended"]';
      for (const [state, expected] of [["", "rgb(5, 5, 5)"], ["hover", "rgb(32, 32, 32)"], ["active", "rgb(48, 48, 48)"], ["focus-visible", "rgb(5, 5, 5)"]]) {
        await forceState(recommendationAction, state ? [state] : []);
        const actionStyle = await style(recommendationAction);
        assert.equal(actionStyle.backgroundColor, expected);
        assert.ok(contrast(actionStyle.color, actionStyle.backgroundColor) >= 4.5);
      }
      await forceState(recommendationAction);
      for (const state of ['', 'hover', 'active']) {
        await forceState('.trading-watchlist-recommendation', state ? [state] : []);
        const card = await style('.trading-watchlist-recommendation');
        assert.ok(contrast((await style('.trading-watchlist-recommendation strong')).color, card.backgroundColor) >= 4.5);
        assert.ok(contrast((await style('.trading-watchlist-recommendation small')).color, card.backgroundColor) >= 4.5);
      }
      await forceState('.trading-watchlist-recommendation');
      await js("document.querySelectorAll('[data-watchlist-recommendation]').forEach(e=>e.click())");
      assert.equal(await js("document.querySelector('[data-watchlist-action=add-recommended]').disabled"), true);
      const disabledRecommendation = await style(recommendationAction);
      assert.ok(contrast(disabledRecommendation.color, disabledRecommendation.backgroundColor) >= 4.5);
      await capture(`recommendations-disabled-${theme}`);
      await js("workspace.watchlistPanel.refresh()");
      assert.equal(await js("document.querySelectorAll('[data-watchlist-recommendation]:checked').length"), 0, 'refresh preserves choices');
      await js("document.querySelectorAll('[data-watchlist-recommendation]').forEach(e=>e.click());document.activeElement?.blur()");
      const addAlignment = await js(`(() => {
        const add=document.querySelector('[data-watchlist-action=add]'), a=add.getBoundingClientRect();
        const icon=document.querySelector('.trading-expert-panel-header-actions > .small-icon-button').getBoundingClientRect();
        return {label:add.textContent,delta:(a.left+a.width/2)-(icon.left+icon.width/2),size:getComputedStyle(add).fontSize};
      })()`);
      assert.equal(addAlignment.label, '添加');
      assert.ok(Math.abs(addAlignment.delta) <= 6, JSON.stringify(addAlignment));
      assert.equal(addAlignment.size, (await style('[data-watchlist-host]')).fontSize);
      await capture(`empty-${theme}`);
      const recommendationLabel = await js(`(() => {
        const e=document.querySelector('[data-watchlist-action=add-recommended]'), s=getComputedStyle(e), range=document.createRange();range.selectNodeContents(e);
        const r=range.getBoundingClientRect(), b=e.getBoundingClientRect();
        return {text:e.textContent,color:s.color,fill:s.webkitTextFillColor,visibility:s.visibility,font:s.font,opacity:s.opacity,rect:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},button:{top:b.top,bottom:b.bottom}};
      })()`);
      assert.equal(recommendationLabel.visibility, 'visible');
      assert.equal(recommendationLabel.fill, 'rgb(255, 255, 255)');
      assert.ok(recommendationLabel.rect.top >= recommendationLabel.button.top && recommendationLabel.rect.bottom <= recommendationLabel.button.bottom, JSON.stringify(recommendationLabel));
      await click(addGroup);
      const dialog = '.trading-watchlist-dialog';
      const input = '[data-watchlist-name]';
      const primary = `${dialog} button.primary`;
      const fieldStyle = await style('.trading-watchlist-name');
      assert.equal((await style(`${dialog} header`)).borderBottomWidth, "0px");
      assert.equal((await style(dialog)).borderRadius, "12px");
      assert.equal((await style(input)).outlineWidth, "0px");
      assert.equal((await style(input)).boxShadow, "none");
      assert.equal((await style(input)).borderLeftWidth, "0px");
      assert.ok(contrast((await style(input)).color, fieldStyle.backgroundColor) >= 4.5, `${theme} input contrast`);
      assert.ok(contrast(fieldStyle.borderTopColor, fieldStyle.backgroundColor) >= 3, `${theme} neutral focus border`);
      const disabledStyle = await style(primary);
      assert.equal(disabledStyle.backgroundColor, "rgb(5, 5, 5)");
      assert.equal(disabledStyle.color, "rgb(255, 255, 255)");
      assert.equal(disabledStyle.opacity, "1");
      assert.ok(contrast(disabledStyle.color, disabledStyle.backgroundColor) >= 4.5, `${theme} disabled label contrast`);
      await capture(`dialog-empty-${theme}`);
      await js(`document.querySelector('${input}').value='观察组';document.querySelector('${input}').dispatchEvent(new Event('input',{bubbles:true}))`);
      for (const [state, expected] of [["", "rgb(5, 5, 5)"], ["hover", "rgb(32, 32, 32)"], ["active", "rgb(48, 48, 48)"], ["focus-visible", "rgb(5, 5, 5)"]]) {
        await forceState(primary, state ? [state] : []);
        const primaryStyle = await style(primary);
        assert.equal(primaryStyle.backgroundColor, expected, `${theme} primary ${state}`);
        assert.equal(primaryStyle.color, "rgb(255, 255, 255)");
        assert.equal(primaryStyle.boxShadow, "none");
        assert.ok(contrast(primaryStyle.color, primaryStyle.backgroundColor) >= 4.5, `${theme} primary ${state} contrast`);
      }
      await forceState(primary);
      await capture(`dialog-filled-${theme}`);
      await js(`document.querySelector('${input}').blur()`);
      assert.equal((await style('.trading-watchlist-name')).boxShadow, "none");
      for (const selector of [`${dialog} header button`, `${dialog} footer [data-watchlist-close]`]) {
        for (const state of ["hover", "active", "focus-visible"]) {
          await forceState(selector, [state]);
          const controlStyle = await style(selector);
          assert.ok(contrast(controlStyle.color, (await style(dialog)).backgroundColor) >= 4.5, `${theme} secondary ${state} contrast`);
        }
        await forceState(selector);
      }
      await click(`${dialog} [data-watchlist-close]`);
    }
    check("Both themes use seamless headers, no panel divider or plus border, compact dialogs, neutral input focus and black actions across enabled, disabled, hover, active and keyboard focus states");
    const initialStars = await js("JSON.stringify([...workspace.favoriteSymbols])");
    await click('[data-watchlist-recommendation="BINANCE:FUTURES:ZECUSDT"]');
    await click('[data-watchlist-action="add-recommended"]');
    assert.deepEqual(await js("workspace.watchlist.activeGroup.markets.map(m=>m.baseAsset)"), ['BTC','ETH','BNB','SNDK','MU','SKHYNIX','XAU']);
    assert.equal(await js("JSON.stringify([...workspace.favoriteSymbols])"), initialStars);
    await window.loadURL(fixtureUrl);
    await wait("window.ready === true");
    assert.deepEqual(await js("workspace.watchlist.activeGroup.markets.map(m=>m.baseAsset)"), ['BTC','ETH','BNB','SNDK','MU','SKHYNIX','XAU']);
    await js("workspace.watchlist.activeGroup.markets=[];workspace.watchlist.save();workspace.watchlistPanel.refresh();workspace.syncWatchlistChanges()");
    for (const theme of ['light','dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';workspace.watchlistPanel.refresh()`);
      await capture(`recommendations-${theme}`);
    }
    check("Fixed recommendations preserve checkbox choices, disable empty submission, add selected perpetuals in order and persist without touching star favorites");
    await js("document.documentElement.dataset.theme='light'");
    await capture("empty-light");
    await click('[data-watchlist-action="add"]');
    await wait(
      "document.querySelectorAll('[data-market-action=watchlist-membership]').length >= 18",
    );
    const favoriteBefore = await js(
      "JSON.stringify([...workspace.favoriteSymbols])",
    );
    const checkbox = (symbol, type = "FUTURES") =>
      `[data-market-action="watchlist-membership"][data-market-id="BINANCE:${type}:${symbol}USDT"]`;
    for (const symbol of ["ETH", "SOL", "XAU"]) await click(checkbox(symbol));
    await click(checkbox("ETH", "SPOT"));
    assert.equal(await js("workspace.watchlist.activeGroup.markets.length"), 4);
    assert.equal(
      await js("JSON.stringify([...workspace.favoriteSymbols])"),
      favoriteBefore,
    );
    assert.equal(await js("workspace.picker.hidden"), false);
    check(
      "Multi-select keeps picker open, separates spot/futures and never changes star favorites",
    );
    await js("workspace.setPickerOpen(false)");
    await click('[data-watchlist-action="new-group"]');
    assert.equal(
      await js(
        "document.querySelector('.trading-watchlist-dialog [type=submit]').disabled",
      ),
      true,
    );
    await js(
      "document.querySelector('[data-watchlist-name]').value='观察组';document.querySelector('[data-watchlist-name]').dispatchEvent(new Event('input',{bubbles:true}))",
    );
    await capture("new-group-light");
    await click('.trading-watchlist-dialog [type="submit"]');
    const customGroupId = await js("workspace.watchlist.activeGroupId");
    const assertCustomEmpty = async () => {
      assert.equal(await js("document.querySelector('.trading-watchlist-empty-custom')?.textContent"), '点击右上角"添加"增加');
      assert.equal(await js("document.querySelectorAll('.trading-watchlist-recommendations,[data-watchlist-action=add-recommended]').length"), 0);
    };
    for (const theme of ["light", "dark"]) {
      for (const [width, height, fontOffset] of [[1440, 900, 0], [1100, 700, 2]]) {
        window.setSize(width, height);
        await pause(100);
        await js(`document.documentElement.dataset.theme='${theme}';document.documentElement.style.setProperty('--app-font-size-offset','${fontOffset}px');workspace.watchlistPanel.refresh()`);
        await assertCustomEmpty();
        const empty = await style('.trading-watchlist-empty-custom');
        const host = await style('[data-watchlist-host]');
        assert.equal(empty.color, (await style('.qa-task')).color);
        assert.equal(empty.fontSize, `${12 + fontOffset}px`);
        assert.ok(contrast(empty.color, host.backgroundColor) >= 4.5, `${theme} custom empty text contrast`);
        const geometry = await js(`(() => {
          const empty=document.querySelector('.trading-watchlist-empty-custom'), range=document.createRange();range.selectNodeContents(empty);
          const text=range.getBoundingClientRect(), rows=document.querySelector('[data-watchlist-rows]').getBoundingClientRect();
          const picker=document.querySelector('.composer-context-group-picker').getBoundingClientRect();
          const add=document.querySelector('[data-watchlist-action=add]'), a=add.getBoundingClientRect();
          return {dx:(text.left+text.width/2)-(rows.left+rows.width/2),dy:(text.top+text.height/2)-(rows.top+rows.height/2),height:rows.height,aboveComposer:rows.bottom<=picker.top-4,addClickable:add.contains(document.elementFromPoint(a.left+a.width/2,a.top+a.height/2))};
        })()`);
        assert.ok(Math.abs(geometry.dx) <= 1 && Math.abs(geometry.dy) <= 2, JSON.stringify(geometry));
        assert.ok(geometry.height > 150 && geometry.aboveComposer && geometry.addClickable, JSON.stringify(geometry));
        await capture(`custom-empty-${theme}-${height}`);
      }
    }
    await js("document.documentElement.style.removeProperty('--app-font-size-offset')");
    window.setSize(1440, 900);
    await window.loadURL(fixtureUrl);
    await wait("window.ready === true");
    assert.equal(await js("workspace.watchlist.activeGroupId"), customGroupId);
    await assertCustomEmpty();
    await click('[data-watchlist-action="add"]');
    await wait("document.querySelectorAll('[data-market-action=watchlist-membership]').length >= 18");
    await click(checkbox("ETH"));
    assert.equal(await js("document.querySelectorAll('.trading-watchlist-empty-custom').length"), 0);
    await js("workspace.setPickerOpen(false)");
    await click('[data-watchlist-action="remove"][data-market-id="BINANCE:FUTURES:ETHUSDT"]');
    await assertCustomEmpty();
    check("Custom empty groups show centered theme-aware guidance without recommendations at both sizes, persist after reload and return to the hint after removing the last market");
    await click('[data-watchlist-action="add"]');
    await wait(
      "document.querySelectorAll('[data-market-action=watchlist-membership]').length >= 18",
    );
    assert.equal(
      await js(
        "document.querySelector('[data-market-watchlist-heading]').textContent",
      ),
      "观察组",
    );
    assert.equal(
      await js(
        `document.querySelector(${JSON.stringify(checkbox("ETH"))}).checked`,
      ),
      false,
    );
    for (const symbol of ["ETH", "SOL", "XAU"]) await click(checkbox(symbol));
    await click(checkbox("SOL"));
    assert.equal(await js("workspace.watchlist.activeGroup.markets.length"), 2);
    assert.equal(await js("workspace.watchlist.groups[0].markets.length"), 4);
    check(
      "Custom group name labels checkboxes; toggling membership affects only that group",
    );
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}'`);
      const actionSpacing = await js(`(() => {
        const center = e => { const r=e.getBoundingClientRect(); return r.left+r.width/2; };
        const head=document.querySelector('.trading-market-picker-head');
        const row=document.querySelector('.trading-market-row');
        const favorite=row.querySelector('.trading-market-favorite').getBoundingClientRect();
        const checkbox=row.querySelector('.trading-watchlist-checkbox').getBoundingClientRect();
        return {header:center(head.children[5])-center(head.children[4]),row:center(row.querySelector('.trading-watchlist-checkbox'))-center(row.querySelector('.trading-market-favorite')),gap:checkbox.left-favorite.right};
      })()`);
      assert.ok(Math.abs(actionSpacing.header - actionSpacing.row) < 0.5, `${theme} aligned action columns ${JSON.stringify(actionSpacing)}`);
      assert.ok(actionSpacing.gap >= 7, `${theme} separate favorite and watchlist targets`);
      const checkedSelector = '.trading-watchlist-checkbox:checked';
      const { root: pickerDocument } = await cdp('DOM.getDocument');
      const { nodeId: checkboxNode } = await cdp('DOM.querySelector', { nodeId: pickerDocument.nodeId, selector: checkedSelector });
      const { node: checkboxDetails } = await cdp('DOM.describeNode', { nodeId: checkboxNode });
      const checkmark = checkboxDetails.pseudoElements.find(node => node.pseudoType === 'after');
      const checkboxBox = (await cdp('DOM.getBoxModel', { nodeId: checkboxNode })).model.border;
      const checkmarkBox = (await cdp('DOM.getBoxModel', { backendNodeId: checkmark.backendNodeId })).model.border;
      const center = (quad, axis) => (quad[axis] + quad[axis + 2] + quad[axis + 4] + quad[axis + 6]) / 4;
      assert.ok(Math.abs(center(checkboxBox, 0) - center(checkmarkBox, 0)) <= 0.5, `${theme} horizontally centered checkmark`);
      assert.ok(Math.abs(center(checkboxBox, 1) - center(checkmarkBox, 1)) <= 0.5, `${theme} vertically centered checkmark`);
      const checkedColors = await js(`(() => {
        const input = document.querySelector('${checkedSelector}');
        return { mark: getComputedStyle(input, '::after').backgroundColor, fill: getComputedStyle(input).backgroundColor };
      })()`);
      assert.ok(contrast(checkedColors.mark, checkedColors.fill) >= 3, `${theme} checkmark contrast`);
      for (const state of ['hover', 'active', 'focus-visible', 'disabled']) {
        await forceState(checkedSelector, state === 'disabled' ? [] : [state]);
        await js(`document.querySelector('${checkedSelector}').disabled = ${state === 'disabled'}`);
        const stateBox = (await cdp('DOM.getBoxModel', { backendNodeId: checkmark.backendNodeId })).model.border;
        assert.ok(Math.abs(center(checkboxBox, 0) - center(stateBox, 0)) <= 0.5, `${theme} ${state} horizontal center`);
        assert.ok(Math.abs(center(checkboxBox, 1) - center(stateBox, 1)) <= 0.5, `${theme} ${state} vertical center`);
      }
      await js(`document.querySelector('${checkedSelector}').disabled = false`);
      await forceState(checkedSelector);
      await capture(`picker-${theme}`);
    }
    check('Both themes center the picker checkmark in default, hover, active, focus and disabled states with readable contrast');
    await js("workspace.setPickerOpen(false)");
    const groupTrigger = '[data-watchlist-groups] > [data-group-id]';
    const groupArrow = '[data-watchlist-action="menu"]';
    const groupMenuOpen = "document.querySelector('[data-watchlist-menu]').matches(':popover-open')";
    const moveToGroupControl = async (selector, topEdge = false) => {
      const point = await js(`(() => {
        const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return {x:Math.round(r.left+r.width/2),y:Math.round(${topEdge ? 'r.top+2' : 'r.top+r.height/2'})};
      })()`);
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      await pause(50);
      return point;
    };
    const leaveGroups = async () => {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 100, y: 100 });
      await pause(260);
    };
    for (const theme of ['light', 'dark']) {
      await leaveGroups();
      await js(`document.documentElement.dataset.theme='${theme}';document.querySelector('[data-watchlist-toggle]').focus()`);
      const activeGroup = await js('workspace.watchlist.activeGroupId');
      const normalSurface = (await style('.trading-expert-panel .agent-panel-inner')).backgroundColor;
      for (const selector of [groupTrigger, groupArrow]) {
        assert.ok(contrast((await style(selector)).color, normalSurface) >= 4.5, `${theme} trigger contrast`);
      }
      await moveToGroupControl(groupTrigger);
      assert.equal(await js(groupMenuOpen), true, `${theme} hovering the group name opens the menu`);
      assert.equal(await js("document.activeElement.hasAttribute('data-watchlist-toggle')"), true, 'hover does not steal focus');
      assert.equal(await js('workspace.watchlist.activeGroupId'), activeGroup, 'hover does not select a different group');
      await moveToGroupControl(groupArrow, true);
      assert.equal(await js(groupMenuOpen), true, `${theme} arrow top edge belongs to the same hover area`);
      const triggerBounds = await js(`(() => {
        const group=document.querySelector('[data-watchlist-groups]').getBoundingClientRect();
        return [...document.querySelectorAll('[data-watchlist-groups] > button')].every(button=>{
          const r=button.getBoundingClientRect();return r.top===group.top && r.bottom===group.bottom;
        });
      })()`);
      assert.ok(triggerBounds, `${theme} full-height label and arrow targets`);
      assert.notEqual((await style('[data-watchlist-groups]')).backgroundColor, 'rgba(0, 0, 0, 0)', 'one shared hover background');
      assert.equal(await js("document.querySelector('[data-watchlist-action=menu]').getAttribute('aria-expanded')"), 'true');
      const menuSurface = (await style('[data-watchlist-menu]')).backgroundColor;
      assert.ok(contrast((await style('[data-watchlist-menu]')).color, menuSurface) >= 4.5, `${theme} popup contrast`);
      const menuItem = '[data-watchlist-menu] [data-group-id="watchlist"]';
      for (const state of ['', 'hover', 'active', 'focus-visible']) {
        await forceState(menuItem, state ? [state] : []);
        const itemStyle = await style(menuItem);
        const channels = itemStyle.backgroundColor.match(/[\d.]+/g).map(Number);
        const base = menuSurface.match(/[\d.]+/g).map(Number);
        const alpha = channels[3] ?? 1;
        const fill = `rgb(${base.slice(0,3).map((channel,i)=>channel*(1-alpha)+channels[i]*alpha).join(',')})`;
        assert.ok(contrast(itemStyle.color, fill) >= 4.5, `${theme} menu ${state} contrast`);
        if (state === 'focus-visible') assert.equal(itemStyle.outlineWidth, '2px');
      }
      await forceState(menuItem);
      await capture(`groups-trigger-hover-${theme}`);
      const gap = await js("(() => {const r=document.querySelector('[data-watchlist-menu]').getBoundingClientRect();return {x:Math.round(r.left+20),y:Math.round(r.top-2)};})()");
      window.webContents.sendInputEvent({ type: 'mouseMove', ...gap });
      await pause(60);
      assert.equal(await js(groupMenuOpen), true, 'crossing the popup gap keeps it open');
      await moveToGroupControl(menuItem);
      await pause(260);
      assert.equal(await js(groupMenuOpen), true, 'entering the popup cancels pending dismissal');
      await js('workspace.watchlistPanel.refresh()');
      assert.equal(await js(groupMenuOpen), true, 'refresh preserves the open popup');
      await leaveGroups();
      assert.equal(await js(groupMenuOpen), false, 'leaving the trigger and popup closes the menu');
      const arrowPoint = await moveToGroupControl(groupArrow, true);
      assert.equal(await js(groupMenuOpen), true, 'entering directly at the arrow opens the menu');
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...arrowPoint });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...arrowPoint });
      await pause(70);
      assert.equal(await js(groupMenuOpen), true, 'a mouse click after hover keeps the popup usable');
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await js(groupMenuOpen), false, 'Escape dismisses the hovered popup');
      assert.equal(await js("document.activeElement.dataset.watchlistAction"), 'menu');
      await leaveGroups();
      await js('document.activeElement.blur()');
      await moveToGroupControl(groupTrigger);
      const itemPoint = await moveToGroupControl(menuItem);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...itemPoint });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...itemPoint });
      await pause(70);
      assert.equal(await js('workspace.watchlist.activeGroupId'), 'watchlist', 'hover menu items remain selectable');
      assert.equal(await js(groupMenuOpen), false, 'selection dismisses the popup');
      await leaveGroups();
      await moveToGroupControl(groupTrigger);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 100, y: 100 });
      await pause(50);
      await js('workspace.watchlistPanel.refresh()');
      await pause(260);
      assert.equal(await js(groupMenuOpen), false, 'refresh preserves pending pointer-exit dismissal');
      await js(`workspace.watchlist.selectGroup(${JSON.stringify(activeGroup)});workspace.watchlistPanel.refresh();workspace.syncWatchlistChanges()`);
    }
    check('Both themes open groups on label or full-height arrow hover without selecting or stealing focus, bridge the popup gap, preserve refresh and keyboard behavior, and dismiss on exit, selection and Escape');
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';workspace.watchlist.addGroup('可删除分组');workspace.watchlist.setMembership(qaMarkets[0],true);workspace.watchlistPanel.refresh();workspace.syncWatchlistChanges()`);
      const groupId = await js('workspace.watchlist.activeGroupId');
      await click('[data-watchlist-action="menu"]');
      assert.equal(await js("document.querySelector('[data-watchlist-menu]').matches(':popover-open')"), true);
      const menuBounds = await js(`(() => {
        const menu=document.querySelector('[data-watchlist-menu]'), r=menu.getBoundingClientRect(), host=document.querySelector('[data-watchlist-host]').getBoundingClientRect();
        const points=[[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],[r.right-2,r.bottom-2]];
        return {inside:r.left>=host.left && r.right<=host.right && r.top>=0 && r.bottom<=innerHeight,hit:points.every(([x,y])=>menu.contains(document.elementFromPoint(x,y)))};
      })()`);
      assert.ok(menuBounds.inside && menuBounds.hit, `${theme} unclipped menu ${JSON.stringify(menuBounds)}`);
      const remove = `[data-watchlist-action="remove-group"][data-group-id="${groupId}"]`;
      await js("document.activeElement?.blur()");
      assert.equal((await style(remove)).opacity, '0');
      const deletePoint = await js(`(() => { const r=document.querySelector(${JSON.stringify(remove)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
      window.webContents.sendInputEvent({type:'mouseMove',x:deletePoint.x-45,y:deletePoint.y});
      await pause(100);
      assert.equal((await style(remove)).opacity, '1');
      for (const state of ['', 'hover', 'active']) {
        if(state==='hover') window.webContents.sendInputEvent({type:'mouseMove',...deletePoint});
        if(state==='active') window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...deletePoint});
        await pause(100);
        const removeStyle = await style(remove);
        assert.equal(removeStyle.backgroundColor, state === 'active' ? 'rgb(37, 37, 37)' : state === 'hover' ? 'rgb(54, 54, 54)' : 'rgb(75, 75, 75)', `${theme} neutral delete ${state}`);
        assert.equal(removeStyle.borderRadius, '50%');
        assert.equal(removeStyle.color, 'rgb(255, 255, 255)');
        assert.ok(contrast(removeStyle.color, removeStyle.backgroundColor) >= 4.5, `${theme} group delete ${state}: ${JSON.stringify(removeStyle)}`);
        if(state==='hover') await capture(`groups-hover-${theme}`);
      }
      window.webContents.sendInputEvent({type:'mouseMove',x:100,y:100});
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:100,y:100});
      await js(`document.querySelector(${JSON.stringify(remove)}).focus()`);
      assert.equal((await style(remove)).opacity, '1');
      assert.equal(await js("!!document.querySelector('[data-watchlist-action=remove-group][data-group-id=watchlist]')"), false);
      await click(remove);
      assert.equal(await js('workspace.watchlist.activeGroupId'), 'watchlist');
      assert.equal(await js(`workspace.watchlist.groups.some(g=>g.id===${JSON.stringify(groupId)})`), false);
      assert.equal(await js("workspace.watchlist.groups.find(g=>g.name==='观察组').markets.length"), 2);
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await js("document.querySelector('[data-watchlist-menu]').hidden"), true);
      assert.equal(await js("document.activeElement.dataset.watchlistAction"), 'menu');
      await click('[data-watchlist-action="menu"]');
      await click('[data-watchlist-menu] [data-watchlist-action="group"][data-group-id^="custom-"]');
    }
    check('Both themes show the complete group popup above clipping ancestors, reveal circular white-X delete controls on hover and focus, delete only that group, and support Escape');
    await click('[data-watchlist-action="menu"]');
    assert.equal(
      await js("document.querySelector('[data-watchlist-menu]').hidden"),
      false,
    );
    await capture("groups-dark");
    await js(
      "document.querySelector('#chart-host').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))",
    );
    assert.equal(
      await js("document.querySelector('[data-watchlist-menu]').hidden"),
      true,
    );
    await click('[data-watchlist-action="new-group"]');
    await js(
      "document.querySelector('[data-watchlist-name]').value='观察组';document.querySelector('[data-watchlist-name]').dispatchEvent(new Event('input',{bubbles:true}))",
    );
    assert.equal(
      await js(
        "document.querySelector('.trading-watchlist-dialog [type=submit]').disabled",
      ),
      true,
    );
    await capture("duplicate-name-dark");
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.trading-watchlist-dialog footer button')).borderRadius",
      ),
      "999px",
    );
    await js(
      "document.querySelector('[data-watchlist-name]').value='六个字的分组';document.querySelector('[data-watchlist-name]').dispatchEvent(new Event('input',{bubbles:true}))",
    );
    const primaryColor = await js(
      "getComputedStyle(document.querySelector('.trading-watchlist-dialog .primary')).backgroundColor",
    );
    const channels = primaryColor.match(/\d+/g).map(Number);
    assert.deepEqual(channels, [5, 5, 5], primaryColor);
    await capture("new-group-dark");
    assert.equal(
      await js(
        "Array.from(document.querySelector('[data-watchlist-name]').value).length",
      ),
      5,
    );
    await click(".trading-watchlist-dialog [data-watchlist-close]");
    check(
      "Group menu dismisses outside; dialog validates duplicate names and caps input at five characters",
    );
    await click('[data-group-id="watchlist"]');
    await js(
      "document.querySelector('[data-watchlist-drag]').focus();document.querySelector('[data-watchlist-drag]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))",
    );
    assert.equal(
      await js("workspace.watchlist.activeGroup.markets[0].baseAsset"),
      "SOL",
    );
    const drag = async (fromIndex, toIndex, cancel = false) => {
      const points = await js(`(() => { const rows=[...document.querySelectorAll('[data-watchlist-row]')]; const a=rows[${fromIndex}].getBoundingClientRect(),b=rows[${toIndex}].getBoundingClientRect();return {x:Math.round(a.left+a.width/2),from:Math.round(a.top+a.height/2),to:Math.round(b.bottom-3)};})()`);
      window.webContents.sendInputEvent({type:'mouseMove',x:points.x,y:points.from});
      window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:points.x,y:points.from});
      window.webContents.sendInputEvent({type:'mouseMove',x:points.x,y:points.to});
      await wait("!!document.querySelector('.trading-watchlist-drag-ghost')");
      assert.ok(await js("document.querySelector('[data-watchlist-rows]').classList.contains('sorting')"));
      const draggedId = await js("document.querySelector('[aria-grabbed=true]').dataset.watchlistRow");
      await js("workspace.watchlistPanel.refresh()");
      assert.equal(await js("document.querySelector('[aria-grabbed=true]').dataset.watchlistRow"),draggedId);
      await capture(cancel ? 'drag-cancel' : 'drag-reorder');
      if(cancel) window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:points.x,y:points.to});
      await pause(200);
      assert.equal(await js("!!document.querySelector('.trading-watchlist-drag-ghost')"),false);
    };
    const selectedBeforeDrag = await js("workspace.selectedMarketId");
    await drag(0,2);
    assert.equal(await js("workspace.watchlist.activeGroup.markets[2].baseAsset"),"SOL");
    assert.equal(await js("workspace.selectedMarketId"),selectedBeforeDrag);
    const orderAfterDrag = await js("workspace.watchlist.activeGroup.markets.map(m=>m.id).join(',')");
    await drag(0,2,true);
    assert.equal(await js("workspace.watchlist.activeGroup.markets.map(m=>m.id).join(',')"),orderAfterDrag);
    assert.equal(await js("[...document.querySelectorAll('[data-watchlist-row]')].map(r=>r.dataset.watchlistRow).join(',')"),orderAfterDrag);
    check("Whole-row pointer sorting animates live, survives refresh, suppresses chart clicks and cancels with Escape; keyboard sorting persists");
    await click(
      '[data-watchlist-action="remove"][data-market-id="BINANCE:FUTURES:ETHUSDT"]',
    );
    assert.equal(
      await js("workspace.watchlist.has('BINANCE:FUTURES:ETHUSDT')"),
      false,
    );
    assert.equal(
      await js(
        "workspace.watchlist.groups.find(g=>g.name==='观察组').markets.some(m=>m.id==='BINANCE:FUTURES:ETHUSDT')",
      ),
      true,
    );
    await js(
      `document.querySelector('.trading-expert-panel').outerHTML=qaPanelMarkup();workspace.syncWatchlistHost()`,
    );
    assert.equal(
      await js("document.querySelector('[data-watchlist-host]').hidden"),
      false,
    );
    assert.equal(
      await js("document.querySelectorAll('[data-watchlist-row]').length"),
      3,
    );
    check(
      "Removing a row is scoped to its list; panel remount preserves expansion and members",
    );
    await js(
      `qaStreamCallbacks.forEach(({request,callback})=>{if(request.marketType==='futures'&&request.streams.includes('solusdt@ticker')) callback({type:'data',data:{e:'24hrTicker',s:'SOLUSDT',c:'123.45',o:'126.615384615',P:'-2.5',E:Date.now()}})})`,
    );
    await pause(100);
    assert.equal(
      await js(
        "document.querySelector('[data-watchlist-row=\"BINANCE:FUTURES:SOLUSDT\"] [data-watchlist-change]').textContent",
      ),
      "-2.50%",
    );
    check(
      "Live ticker callbacks repaint the current list without rebuilding hovered rows",
    );
    for (const theme of ["light", "dark"]) {
      await js(
        `document.documentElement.dataset.theme='${theme}';document.querySelector('[data-watchlist-drag]').focus()`,
      );
      await capture(`list-${theme}`);
      const geometry = await js(
        `(() => { const r=e=>{const x=e.getBoundingClientRect();return {top:x.top,bottom:x.bottom,height:x.height,width:x.width}}, host=document.querySelector('[data-watchlist-host]'), panel=document.querySelector('.trading-expert-panel');return {list:r(host),panel:r(panel),chat:r(document.querySelector('#trading-expert-panel-chat')),composer:r(document.querySelector('.composer')),scroll:document.documentElement.scrollWidth,viewport:innerWidth,background:getComputedStyle(host).backgroundColor,text:getComputedStyle(host).color};})()`,
      );
      assert.ok(
        geometry.list.bottom <= geometry.composer.top,
        JSON.stringify(geometry),
      );
      assert.equal(geometry.chat.height, 0, `${theme}: expanded watchlist hides conversation`);
      assert.ok(
        geometry.composer.top >= geometry.list.bottom - 1,
        JSON.stringify(geometry),
      );
      assert.ok(geometry.scroll <= geometry.viewport, JSON.stringify(geometry));
      if (theme === "dark")
        assert.notEqual(geometry.background, "rgb(255, 255, 255)");
      const headerControls = await js(
        `(() => {const header=document.querySelector('.trading-expert-panel-header').getBoundingClientRect();return [...document.querySelectorAll('.trading-expert-panel-header-actions > button')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,center:r.top+r.height/2,headerTop:header.top,headerBottom:header.bottom}})})()`,
      );
      assert.ok(
        headerControls.every(
          (r) => r.top >= r.headerTop && r.bottom <= r.headerBottom,
        ),
        JSON.stringify(headerControls),
      );
      assert.ok(
        Math.abs(headerControls[0].center - headerControls[1].center) < 1,
        JSON.stringify(headerControls),
      );
    }
    check(
      "Both themes keep the task/composer below the list without horizontal overflow",
    );
    await js(
      "workspace.watchlist.setMembership(qaMarkets[2],true);workspace.watchlistPanel.refresh()",
    );
    await click(
      '[data-watchlist-action="select"][data-market-id="BINANCE:FUTURES:ETHUSDT"]',
    );
    assert.equal(
      await js("workspace.selectedMarketId"),
      "BINANCE:FUTURES:ETHUSDT",
    );
    assert.equal(
      await js("JSON.stringify([...workspace.favoriteSymbols])"),
      favoriteBefore,
    );
    check(
      "Clicking a watchlist pair selects the chart without adding a star favorite",
    );
    await click("[data-watchlist-toggle]");
    assert.equal(
      await js("document.querySelector('[data-watchlist-host]').hidden"),
      true,
    );
    await window.loadURL(fixtureUrl);
    await wait("window.ready === true");
    assert.equal(await js("workspace.watchlist.expanded"), false);
    assert.equal(await js("workspace.watchlist.activeGroup.markets.length"), 4);
    await click("[data-watchlist-toggle]");
    assert.equal(
      await js("document.querySelectorAll('[data-watchlist-row]').length"),
      4,
    );
    check("Collapse state, groups and order survive reload");
    await js(`(() => {
    const record={id:'FINNHUB:AAPL',provider:'finnhub',symbol:'AAPL',baseAsset:'AAPL',quoteAsset:'USD',displaySymbol:'AAPL',description:'Apple',venue:'NASDAQ',assetClass:'stock',marketType:'spot',tag:'美股'};
    workspace.watchlist.setMembership(record,true);workspace.watchlistPanel.refresh();workspace.finnhubConfigured=true;
    window.qaStockPrice=200;
    window.codexDesktop.getFinnhubMarketQuotes=async()=>({ok:true,quotes:[{symbol:'AAPL',current:qaStockPrice,changePercent:1.2}]});
    workspace.syncWatchlistChanges();
  })()`);
    await wait(
      "document.querySelector('[data-watchlist-row=\"FINNHUB:AAPL\"] [data-watchlist-price]').textContent==='200.00'",
    );
    await js("qaStockPrice=201;workspace.refreshFavoriteFinnhubQuotes()");
    await wait(
      "document.querySelector('[data-watchlist-row=\"FINNHUB:AAPL\"] [data-watchlist-price]').textContent==='201.00'",
    );
    await js(
      "workspace.watchlist.setMembership(workspace.watchlist.activeGroup.markets.find(m=>m.id==='FINNHUB:AAPL'),false);workspace.watchlistPanel.refresh();workspace.syncWatchlistChanges()",
    );
    assert.equal(await js("workspace.watchlistQuoteTimer"), null);
    check(
      "Non-crypto quotes refresh from provider responses and unused polling stops after removal",
    );
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}';document.activeElement?.blur()`);
      const row = '[data-watchlist-row="BINANCE:FUTURES:ETHUSDT"]';
      const select = `${row} [data-watchlist-action="select"]`;
      const remove = `${row} [data-watchlist-action="remove"]`;
      for (const state of ["hover", "active", "focus-visible"]) {
        await forceState(row, ["hover"]);
        await forceState(select, [state]);
        assert.equal((await style(select)).backgroundColor, "rgba(0, 0, 0, 0)", `${theme} no local selection rectangle`);
        const bounds = await js(`(() => {
          const row=document.querySelector(${JSON.stringify(row)}).getBoundingClientRect();
          const select=document.querySelector(${JSON.stringify(select)}).getBoundingClientRect();
          return {width:select.width-row.width,height:select.height-row.height,left:select.left-row.left,top:select.top-row.top};
        })()`);
        assert.ok(Object.values(bounds).every(delta => Math.abs(delta) < 0.1), `${theme} whole row bounds ${JSON.stringify(bounds)}`);
        const iconBounds = await js(`(() => {
          const button=document.querySelector(${JSON.stringify(remove)}).getBoundingClientRect();
          const icon=document.querySelector(${JSON.stringify(remove + ' svg')}).getBoundingClientRect();
          return {dx:icon.left+icon.width/2-button.left-button.width/2,dy:icon.top+icon.height/2-button.top-button.height/2};
        })()`);
        assert.ok(Math.abs(iconBounds.dx) < 0.1 && Math.abs(iconBounds.dy) < 0.1, `${theme} centered remove icon`);
        for (const removeState of ["", "hover", "active", "focus-visible"]) {
          await forceState(remove, removeState ? [removeState] : []);
          const removeStyle = await style(remove);
          assert.equal(removeStyle.color, "rgb(255, 255, 255)");
          assert.equal(removeStyle.borderLeftWidth, "0px");
          assert.equal(removeStyle.boxShadow, "none");
          assert.equal(removeStyle.borderRadius, "50%");
          assert.ok(contrast(removeStyle.color, removeStyle.backgroundColor) >= 4.5);
        }
        await forceState(remove);
      }
      await forceState(select);
      await js(`(() => {
        const row=document.querySelector(${JSON.stringify(row)});
        const select=row.querySelector('[data-watchlist-action="select"]');
        const cells=['.trading-watchlist-pair','[data-watchlist-price]','[data-watchlist-change]'];
        for (const selector of cells) {
          const r=row.querySelector(selector).getBoundingClientRect();
          if (document.elementFromPoint(r.left+r.width/2,r.top+r.height/2) !== select) throw Error('Row click missed: '+selector);
        }
        const remove=row.querySelector('[data-watchlist-action="remove"]'), drag=row.querySelector('[data-watchlist-drag]');
        for (const control of [remove,drag]) {
          const r=control.getBoundingClientRect();
          if (!control.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))) throw Error('Row overlay covers control');
        }
      })()`);
      const priceHit = await js(`(() => {const r=document.querySelector(${JSON.stringify(row + ' [data-watchlist-price]')}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await js(`document.elementFromPoint(${priceHit.x},${priceHit.y}).click()`);
      assert.equal(await js('workspace.selectedMarketId'), 'BINANCE:FUTURES:ETHUSDT');
      await capture(`full-row-${theme}`);
      await forceState(row);
    }
    check("Both themes keep header text uniform without state fills, align picker action columns, select the chart across the entire row, and center white remove icons on borderless dark circles");
    for (const theme of ["light", "dark"]) {
      await js(`document.documentElement.dataset.theme='${theme}';document.activeElement?.blur()`);
      const fills = await js(`(() => [...document.querySelectorAll('[data-watchlist-row]')].map(row => ({selected:row.querySelector('[aria-current=true]')!==null,color:getComputedStyle(row).backgroundColor})))()`);
      const expectedSelected = await js("getComputedStyle(document.documentElement).getPropertyValue('--app-chrome-background').trim()");
      for (const fill of fills) {
        if (!fill.selected) assert.equal(fill.color, "rgba(0, 0, 0, 0)", `${theme} no alternating row fills`);
        else {
          const expected = await js(`(() => {const e=document.createElement('span');e.style.backgroundColor=${JSON.stringify(expectedSelected)};document.body.append(e);const color=getComputedStyle(e).backgroundColor;e.remove();return color;})()`);
          assert.equal(fill.color,expected, `${theme} neutral whole-row selection`);
        }
      }
      await click('[data-group-id="tradfi"]');
      assert.equal(await js("document.querySelectorAll('[data-watchlist-row]').length"),1);
      assert.equal(await js("document.querySelector('[data-watchlist-row]').dataset.watchlistRow"),'BINANCE:FUTURES:XAUUSDT');
      assert.equal(await js("document.querySelectorAll('[data-watchlist-drag],[data-watchlist-action=remove],[data-watchlist-action=add],[data-watchlist-action=new-group]').length"),0);
      await capture(`tradfi-${theme}`);
      await click('[data-watchlist-action="select"]');
      assert.equal(await js("workspace.selectedMarketId"),'BINANCE:FUTURES:XAUUSDT');
      await click('[data-group-id="indices"]');
      await wait("document.querySelectorAll('[data-watchlist-index]').length === 7");
      assert.equal(await js("document.querySelectorAll('[data-watchlist-row]').length"),0);
      assert.equal(await js("document.querySelector('.trading-watchlist-head [data-watchlist-action=sort-price]').textContent"),'最新指数↕');
      assert.equal(await js("document.querySelector('[data-watchlist-index=\"alternative:fng\"] [data-index-source]').textContent"),'Alternative.me');
      assert.match(await js("document.querySelector('[data-watchlist-index=\"alternative:fng\"] .trading-watchlist-price').textContent"),/71/);
      await click('[data-index-id="alternative:fng"]');
      await wait("!!document.querySelector('.trading-index-dialog[open]')");
      assert.ok(await js("document.querySelector('.trading-index-chart path').getAttribute('d').startsWith('M')"));
      assert.match(await js("document.querySelector('.trading-index-dialog').textContent"),/每日更新/);
      const indexDialog = await style('.trading-index-dialog');
      assert.ok(contrast(indexDialog.color,indexDialog.backgroundColor) >= 4.5, `${theme} index dialog contrast`);
      await capture(`index-history-${theme}`);
      await click('.trading-index-dialog [data-index-source]');
      assert.equal(await js("qaSourceLinks.at(-1)"),'https://alternative.me/crypto/fear-and-greed-index/');
      await click('[data-index-close]');
      await js("qaIndicesFail=true;workspace.watchlistPanel.indices.refresh()");
      await wait("workspace.watchlistPanel.indices.loading === false");
      assert.equal(await js("document.querySelectorAll('[data-watchlist-index]').length"),7);
      assert.match(await js("document.querySelector('[data-watchlist-index=\"alternative:fng\"]').textContent"),/更新延迟/);
      await capture(`indices-stale-${theme}`);
      await js("qaIndicesFail=false;workspace.watchlistPanel.indices.refresh()");
      await wait("workspace.watchlistPanel.indices.loading === false");
      assert.equal(await js("document.querySelectorAll('[data-watchlist-action=add],[data-watchlist-action=new-group]').length"),0);
      await capture(`indices-${theme}`);
      await click('[data-group-id="watchlist"]');
      await click('[data-watchlist-action="select"][data-market-id="BINANCE:FUTURES:ETHUSDT"]');
    }
    check("Both themes use plain rows and neutral selection; fixed TradFi catalog auto-populates, selects its chart, has no editing controls; public indices load, retain attributed stale data during failures and show history in both themes");
    const groupPickerMarkup = await js("document.querySelector('.composer-context-group-picker').outerHTML");
    for (const theme of ["light", "dark"]) {
      for (const [width, height, count, fontOffset, groupPicker = true] of [
        [1440, 900, 3, 0],
        [1440, 900, 11, 0],
        [1440, 900, 18, 0],
        [1298, 878, 18, 0],
        [1298, 878, 18, 0, false],
        [1100, 700, 11, 0],
        [1100, 700, 11, 4],
        [1100, 700, 11, 4, false],
      ]) {
        window.setSize(width, height);
        await js(`
          document.querySelector('.composer-context-group-picker')?.remove();
          if (${groupPicker}) document.querySelector('.composer').insertAdjacentHTML('afterbegin', ${JSON.stringify(groupPickerMarkup)});
          document.documentElement.dataset.theme = '${theme}';
          document.documentElement.style.setProperty('--app-font-size-offset', '${fontOffset}px');
          workspace.watchlist.activeGroupId = 'watchlist';
          workspace.watchlist.activeGroup.markets = qaMarkets.slice(0, ${count});
          workspace.watchlistPanel.refresh();
          document.querySelector('[data-watchlist-rows]').scrollTop = 0;
        `);
        if (height === 878) {
          await js(`
            workspace.watchlist.activeGroup.markets = ['BTC', 'ETH', 'ZEC', 'BNB', 'SNDK', 'MU', 'SKHYNIX', 'XAU', 'XRP', 'UNI', 'SPCX', 'AKE', 'SOL', 'HYPE', 'ADA', 'DOGE', 'TRX', 'LTC'].map(symbol => ({
              ...qaMarkets[0], id: 'BINANCE:FUTURES:' + symbol + 'USDT', symbol: symbol + 'USDT', baseAsset: symbol, displaySymbol: symbol + '/USDT', description: symbol
            }));
            workspace.watchlistPanel.refresh();
            document.querySelector('[data-watchlist-rows]').scrollTop = 0;
          `);
        }
        await pause(200);
        const geometry = await js(`(() => {
          const bounds = element => {
            if (!element) return null;
            const { top, bottom, height } = element.getBoundingClientRect();
            return { top, bottom, height };
          };
          const rows = document.querySelector('[data-watchlist-rows]');
          const items = rows.querySelectorAll('[data-watchlist-row]');
          return {
            host: bounds(document.querySelector('[data-watchlist-host]')),
            rows: bounds(rows),
            first: bounds(items[0]),
            last: bounds(items[items.length - 1]),
            panel: bounds(document.querySelector('.trading-expert-panel')),
            chat: bounds(document.querySelector('#trading-expert-panel-chat')),
            composer: bounds(document.querySelector('.composer')),
            groupPicker: bounds(document.querySelector('.composer-context-group-picker')),
            clientHeight: rows.clientHeight,
            scrollHeight: rows.scrollHeight,
            partialRows: [...items].filter(item => {
              const itemBounds = item.getBoundingClientRect();
              const viewport = rows.getBoundingClientRect();
              return itemBounds.top < viewport.bottom - 0.5 && itemBounds.bottom > viewport.bottom + 0.5;
            }).length,
          };
        })()`);
        const context = `${theme} ${width}x${height}, ${count} rows, font +${fontOffset}, group picker ${groupPicker}: ${JSON.stringify(geometry)}`;
        assert.equal(geometry.partialRows, 0, `${context}: no partially displayed bottom row`);
        if (height === 878) {
          const visibleNames = await js(`(() => {
            const bottom = document.querySelector('[data-watchlist-rows]').getBoundingClientRect().bottom;
            return [...document.querySelectorAll('[data-watchlist-row] .trading-watchlist-pair > span')]
              .filter(name => name.getBoundingClientRect().top < bottom).map(name => name.textContent);
          })()`);
          assert.equal(visibleNames.at(-1), 'SPCX/USDT', context);
          assert.equal(visibleNames.length, 11, context);
          await capture(`spcx-cutoff-${theme}-group-picker-${groupPicker}`);
          const scrollbarState = () => js(`(() => {
            const rows = document.querySelector('[data-watchlist-rows]');
            const rect = rows.getBoundingClientRect();
            return { color: getComputedStyle(rows).scrollbarColor, width: rows.clientWidth, scrollTop: rows.scrollTop, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 20) };
          })()`);
          const hiddenColor = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)';
          window.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 40 });
          await pause(100);
          const hiddenScrollbar = await scrollbarState();
          assert.equal(hiddenScrollbar.color, hiddenColor, `${theme} scrollbar hidden outside list`);
          await capture('scrollbar-hidden-' + theme);
          window.webContents.sendInputEvent({ type: 'mouseMove', x: hiddenScrollbar.x, y: hiddenScrollbar.y });
          await pause(100);
          const hoveredScrollbar = await scrollbarState();
          assert.notEqual(hoveredScrollbar.color, hiddenColor, `${theme} scrollbar visible inside list`);
          assert.equal(hoveredScrollbar.width, hiddenScrollbar.width, `${theme} no column shift on hover`);
          await capture('scrollbar-hover-' + theme);
          window.webContents.sendInputEvent({ type: 'mouseWheel', x: hiddenScrollbar.x, y: hiddenScrollbar.y, deltaY: -120, deltaX: 0 });
          await pause(200);
          assert.ok((await scrollbarState()).scrollTop > 0, `${theme} mouse wheel still scrolls`);
          await js("document.querySelector('[data-watchlist-row] button').focus({ preventScroll: true })");
          window.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 40 });
          await pause(100);
          const leftScrollbar = await scrollbarState();
          assert.equal(leftScrollbar.color, hiddenColor, `${theme} scrollbar hides after leaving even with a focused row`);
          assert.equal(leftScrollbar.width, hiddenScrollbar.width, `${theme} no column shift after leaving`);
        }
        if (height === 900 && count <= 11) {
          assert.ok(geometry.last.bottom <= geometry.rows.bottom + 1, context);
          assert.ok(Math.abs(geometry.last.bottom - geometry.rows.bottom) <= 1, context);
          assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1, context);
          if (count === 11) assert.ok(geometry.host.height > geometry.panel.height * 0.5, context);
        } else {
          assert.ok(geometry.scrollHeight > geometry.clientHeight, context);
          assert.ok(geometry.rows.height > geometry.first.height, context);
          const lastRowVisible = await js(`(() => {
            const rows = document.querySelector('[data-watchlist-rows]');
            rows.scrollTop = rows.scrollHeight;
            const last = rows.querySelector('[data-watchlist-row]:last-of-type').getBoundingClientRect();
            const viewport = rows.getBoundingClientRect();
            return last.top >= viewport.top - 1 && last.bottom <= viewport.bottom + 1;
          })()`);
          assert.ok(lastRowVisible, context);
        }
        assert.equal(geometry.chat.height, 0, `${context}: expanded watchlist hides conversation`);
        assert.ok(geometry.host.bottom <= geometry.composer.top, context);
        if (groupPicker) {
          assert.ok(geometry.rows.bottom <= geometry.groupPicker.top - 4, context);
          const groupPickerHit = await js(`(() => {
            const button = document.querySelector('.composer-context-group-picker button');
            const r = button.getBoundingClientRect();
            return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
          })()`);
          assert.ok(groupPickerHit, `${context}: group picker remains clickable`);
        }
        assert.ok(geometry.composer.bottom <= geometry.panel.bottom + 1, context);
        await capture(`content-height-${theme}-${height}-${count}-font${fontOffset}-group-picker-${groupPicker}`);
      }
    }
    check("Both themes show only complete rows with or without the composer group picker, stop at SPCX at the reference size, and keep longer lists scrollable at compact sizes and larger fonts");
    check("Both themes hide the watchlist scrollbar outside the rows, reveal it on pointer entry, hide it again on exit and preserve column widths and wheel scrolling");
    await js("document.documentElement.style.removeProperty('--app-font-size-offset')");
    window.setSize(1100, 700);
    await pause(200);
    await js("document.documentElement.dataset.theme='dark'");
    await capture("compact-dark");
    assert.equal(await js("window.qaError || ''"), "");
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    window?.destroy();
    await server?.close();
    app.exit(report.status === "passed" ? 0 : 1);
  }
}
void main().catch((error) => {
  process.stderr.write(String(error));
  app.exit(1);
});
