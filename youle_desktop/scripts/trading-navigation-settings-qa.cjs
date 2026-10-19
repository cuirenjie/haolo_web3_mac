// Start Vite on 127.0.0.1:5183. Uses isolated synthetic market data and native clicks.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'navigation-settings-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  setTimeout(() => app.exit(1), 120000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1320, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const click = async selector => {
    const point = await js(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)}), r = e?.getBoundingClientRect();
      if (!r?.width || !r.height) throw Error('Invisible control: ' + ${JSON.stringify(selector)});
      return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
    })()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    }
    await settle();
  };
  const open = async (split = false) => {
    await click(split ? '[data-market-split-pane="2"] [data-split-action="open-chart-settings"]' : '[data-market-action="open-chart-settings"]');
    await click('[data-market-settings-tab="scale"]');
    assert.equal(await js('workspace.chartSettingsTab'), 'scale');
  };
  const close = () => click('[data-market-action="close-chart-settings"]');
  const lock = '[data-chart-setting="verticalLocked"]';
  const states = () => js('({main: workspace.chartNavigation.isVerticalLocked(), split: workspace.splitPanes[0]?.getChartNavigation().isVerticalLocked(), checked: document.querySelector(\'[data-chart-setting="verticalLocked"]\').checked})');
  const capture = async name => {
    await settle();
    await pause(150);
    const rect = await js(`(() => {
      if (workspace.chartSettingsBackdrop.hidden) return undefined;
      const r = document.querySelector('.trading-chart-settings-dialog').getBoundingClientRect();
      return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    })()`);
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  };
  const report = [];
  for (const theme of ['light', 'dark']) {
    await win.webContents.session.clearStorageData();
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme = '${theme}';
      document.querySelector('#host').style.cssText = 'width:100%;height:100%';
      workspace.loadingHistory = true; workspace.closeSocket();
      clearInterval(workspace.pollTimer); clearInterval(workspace.candlePollTimer); void 0`);
    await settle();
    assert.equal(await js('document.querySelectorAll(".trading-chart-navigation-controls").length'), 0);
    await capture(`${theme}-chart`);
    await open();
    assert.equal((await states()).checked, true);
    await capture(`${theme}-settings`);
    const preference = await js('workspace.chartSettings.autoScale');
    await click(lock);
    assert.equal((await states()).main, false);
    assert.equal(await js('workspace.chart.options().handleScroll.pressedMouseMove'), true);
    assert.equal(await js('workspace.chartSettings.autoScale'), preference);
    await close(); await open();
    assert.equal((await states()).checked, false);
    await click(lock);
    assert.equal((await states()).main, true);
    assert.equal(await js('workspace.chart.options().handleScroll.pressedMouseMove'), false);
    await close();
    await js('workspace.chartNavigation.zoom(0.5); workspace.chartNavigation.pan(-60); void 0');
    await settle();
    const beforeReset = await js('workspace.chart.timeScale().getVisibleLogicalRange()');
    await open(); await click('[data-market-action="reset-chart"]');
    const afterReset = await js('workspace.chart.timeScale().getVisibleLogicalRange()');
    assert.notDeepEqual(afterReset, beforeReset);
    assert.equal(await js('workspace.chart.timeScale().scrollPosition()'), await js('workspace.chart.timeScale().options().rightOffset'));
    assert.equal((await states()).main, true);
    await close();
    await js("workspace.splitLayoutId = '2-columns'; workspace.applySplitLayout(); void 0");
    for (let i = 0; i < 150 && !await js('Boolean(workspace.splitPanes[0]?.candles.length)'); i++) await pause(100);
    assert.equal(await js('Boolean(workspace.splitPanes[0]?.candles.length)'), true);
    await open(true); await click(lock);
    assert.deepEqual(await states(), { main: true, split: false, checked: false });
    await close(); await open();
    assert.equal((await states()).checked, true);
    await close(); await open(true);
    assert.equal((await states()).checked, false);
    await js(`workspace.splitPanes[0].getChartNavigation().zoom(0.5);
      workspace.splitPanes[0].getChartNavigation().pan(-60); void 0`);
    await settle();
    const primaryRange = await js('workspace.chart.timeScale().getVisibleLogicalRange()');
    const splitRange = await js('workspace.splitPanes[0].chart.timeScale().getVisibleLogicalRange()');
    await click('[data-market-action="reset-chart"]');
    assert.deepEqual(await js('workspace.chart.timeScale().getVisibleLogicalRange()'), primaryRange);
    assert.notDeepEqual(await js('workspace.splitPanes[0].chart.timeScale().getVisibleLogicalRange()'), splitRange);
    assert.deepEqual(await states(), { main: true, split: false, checked: false });
    await capture(`${theme}-split-settings`);
    await click('[data-market-action="restore-chart-settings"]');
    assert.deepEqual(await states(), { main: true, split: true, checked: true });
    assert.equal(await js('document.querySelectorAll(".trading-chart-navigation-controls").length'), 0);
    assert.equal(await js('window.qaError ?? null'), null);
    report.push({ theme, toolbarRemoved: true, lockRoundtrip: true, resetViewport: true, splitIsolation: true, restoreDefaults: true });
    console.log('Passed:', theme);
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, output }));
  win.destroy(); app.quit();
})().catch(error => { console.error(error); app.exit(1); });
