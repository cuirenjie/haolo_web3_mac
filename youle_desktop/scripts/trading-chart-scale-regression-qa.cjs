// Start Vite on 127.0.0.1:5183. Uses native Electron input and synthetic candles.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache', 'chart-scale-regression');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  const report = { checks: [], nativeClicks: 0, errors: [] };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  async function click(x, y, button = 'left') {
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x, y, button, clickCount: 1 });
    report.nativeClicks++; await settle();
  }
  async function clickElement(selector) {
    const p = await js(`(()=>{const e=${selector},r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    await click(p.x, p.y);
  }
  // A/L now live in settings; the companion settings-lock suite clicks that UI.
  const button = async action => {
    await js(action === 'auto' ? 'workspace.chartNavigation.setAutoScale(!workspace.chart.priceScale("right",0).options().autoScale)'
      : 'workspace.chartNavigation.setMode(workspace.chart.priceScale("right",0).options().mode===1?0:1)');
    await settle();
  };
  async function pane(index, right = false) {
    const p = await js(`(()=>{const r=workspace.chart.panes()[${index}].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+100),y:Math.round(r.top+r.height/2)}})()`);
    await click(p.x, p.y, right ? 'right' : 'left');
  }
  async function key(keyCode, modifiers = []) {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await settle();
  }
  const snapshot = () => js(`(()=>{const c=workspace.chart,v=workspace.indicatorPanes.get('volume').series[0].api,b=v.priceToCoordinate(0);return {
    modes:c.panes().map(p=>c.priceScale('right',p.paneIndex()).options().mode),
    auto:c.panes().map(p=>c.priceScale('right',p.paneIndex()).options().autoScale),
    ranges:c.panes().map(p=>c.priceScale('right',p.paneIndex()).getVisibleRange()),
    margins:c.panes().map(p=>c.priceScale('right',p.paneIndex()).options().scaleMargins),
    heights:[100,1000,10000,100000].map(n=>b-v.priceToCoordinate(n)),
    volumes:v.data().map(d=>d.value),
    mainData:(workspace.candleSeries||workspace.series).data(),
    a:String(c.priceScale('right',0).options().autoScale),
    l:String(c.priceScale('right',0).options().mode===1)
  }})()`);
  const check = (theme, subject, label, extra = {}) => report.checks.push({ theme, subject, label, ...extra });
  async function load(theme, clear = false) {
    if (clear) await win.webContents.session.clearStorageData();
    await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/') + '?scale=' + theme);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}';workspace.loadingHistory=true;clearInterval(workspace.pollTimer);workspace.pollTimer=null;clearInterval(workspace.candlePollTimer);workspace.candlePollTimer=null;workspace.favoriteTickerGeneration++;workspace.closeFavoriteTickerStreams();workspace.closeSocket();workspace.cancelScheduledLiveChartPaint();workspace.latestLivePricesByMarketId.clear();workspace.candles=workspace.candles.map((c,i)=>({...c,volume:[100,1000,10000,100000][i%4]}));workspace.updateChartData({resetViewport:true});void 0`);
    await settle();
  }
  for (const theme of ['light', 'dark']) {
    await load(theme, true);
    await js('workspace.chartNavigation.setAutoScale(true)'); await settle();
    await js("window.primary=workspace;primary.splitLayoutId='2-columns';primary.applySplitLayout();void 0");
    for (let i = 0; i < 100 && !await js('Boolean(primary.splitPanes[0]?.candles.length)'); i++) await pause(50);
    await js("clearTimeout(primary.splitPanes[0].refreshTimer);primary.splitPanes[0].refreshTimer=null;primary.splitPanes[0].candles=primary.candles.map(c=>({...c}));for(const w of [primary,...primary.splitPanes]){w.activeIndicators=['volume','macd','rsi'];w.rebuildIndicatorPanes();if(w===primary)w.updateChartData();else w.updateData()}void 0");
    await settle();
    for (const subject of ['main', 'split']) {
      await js(`window.workspace=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};void 0`);
      await pane(1);
      const original = await snapshot(); assert.deepEqual(original.modes, [0, 0, 0, 0]);
      assert.ok(Math.abs(original.heights[0] / original.heights[3] - .001) < 1e-9);
      await button('auto'); const off = await snapshot();
      assert.deepEqual(off.auto, [false, true, true, true]); assert.equal(off.a, 'false'); assert.deepEqual(off.ranges, original.ranges);
      await js('workspace.chart.priceScale("right",0).setVisibleRange({from:1300,to:1310});void 0'); await settle();
      await button('auto'); const fitted = await snapshot();
      assert.equal(fitted.auto[0], true); assert.ok(fitted.ranges[0].to - fitted.ranges[0].from > 30);
      check(theme, subject, 'A targets main after volume focus and restores manual prices');
      // Freeze an indicator to ensure price changes do not reset its range or padding.
      await js('workspace.chart.priceScale("right",2).setVisibleRange({from:-15,to:25});void 0'); await settle();
      const before = await snapshot();
      for (let i = 0; i < 12; i++) {
        await pane(i % 3 + 1); await button('log'); const after = await snapshot();
        assert.deepEqual(after.modes, [i % 2 === 0 ? 1 : 0, 0, 0, 0]);
        assert.deepEqual(after.volumes, before.volumes); assert.deepEqual(after.mainData, before.mainData);
        assert.deepEqual(after.heights, before.heights); assert.deepEqual(after.ranges.slice(1), before.ranges.slice(1));
        assert.deepEqual(after.auto.slice(1), before.auto.slice(1)); assert.deepEqual(after.margins.slice(1), before.margins.slice(1));
        assert.equal(await js(`(${subject === 'main' ? 'primary.splitPanes[0]' : 'primary'}).chart.priceScale('right',0).options().mode`), 0);
      }
      check(theme, subject, '12 L toggles preserve other charts, indicator geometry and raw data');
      await key('p', ['alt']); assert.deepEqual((await snapshot()).modes, [2, 0, 0, 0]);
      await key('l', ['alt']); assert.deepEqual((await snapshot()).modes, [1, 0, 0, 0]);
      await js(`document.documentElement.dataset.theme='${theme === 'dark' ? 'light' : 'dark'}'`); await settle();
      assert.deepEqual((await snapshot()).modes, [1, 0, 0, 0]);
      await js(`document.documentElement.dataset.theme='${theme}'`); await settle();
      assert.deepEqual((await snapshot()).ranges.slice(1), before.ranges.slice(1));
      check(theme, subject, 'keyboard and theme changes preserve independent indicator scales');
      await pane(1, true);
      assert.equal(await js("workspace.chartNavigation.menu.querySelectorAll('button').length"), 3);
      await clickElement('workspace.chartNavigation.menu.children[1]'); const menu = await snapshot();
      assert.equal(menu.auto[1], false); assert.equal(menu.a, 'true');
      check(theme, subject, 'indicator context menu has local Auto without price modes');
      await js('workspace.rebuildIndicatorPanes();if(workspace===primary)workspace.updateChartData();else workspace.updateData();void 0'); await settle();
      assert.deepEqual((await snapshot()).modes, [1, 0, 0, 0]);
      await button('log'); assert.deepEqual((await snapshot()).modes, [0, 0, 0, 0]);
      check(theme, subject, 'recreated VOLUME/MACD/RSI remain linear while main is logarithmic');
    }
    // Settings are intentionally global; they still affect only the main pane of each chart.
    await js("primary.chartSettings.priceScaleMode='percentage';primary.applyChartTheme();void 0"); await settle();
    assert.deepEqual(await js("[primary,...primary.splitPanes].map(w=>w.chart.panes().map(p=>w.chart.priceScale('right',p.paneIndex()).options().mode))"), [[2, 0, 0, 0], [2, 0, 0, 0]]);
    check(theme, 'all', 'global percentage setting excludes all indicator panes');
    await js("window.workspace=primary;primary.chartSettings.priceScaleMode='linear';primary.applyChartTheme();void 0"); await settle();
    await pane(1); await button('log');
    await fs.promises.writeFile(path.join(output, theme + '-isolated-log.png'), (await win.webContents.capturePage()).toPNG());
    await load(theme); assert.equal(await js('workspace.chart.priceScale("right",0).options().mode'), 1);
    assert.deepEqual((await snapshot()).modes.slice(1), [0]);
    check(theme, 'reload', 'saved logarithmic price setting starts with linear volume');
    await button('log');
    // Empty main chart has disabled controls in both themes.
    await js('workspace.candleSeries.setData([]);workspace.chartNavigation.schedule();void 0'); await settle();
    assert.equal(await js("Array.from(workspace.chartNavigation.controls.querySelectorAll('button')).every(b=>b.disabled)"), true);
    check(theme, 'empty', 'A/L disabled without main price data');
    console.log('scale cases passed', theme);
  }
  assert.deepEqual(report.errors, []);
  await fs.promises.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks: report.checks.length, nativeClicks: report.nativeClicks, output }));
  win.destroy(); app.quit();
})().catch(error => { console.error(error); app.exit(1); });
