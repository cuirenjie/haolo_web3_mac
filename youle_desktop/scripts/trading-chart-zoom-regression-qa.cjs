// Start Vite on 127.0.0.1:5183, then run:
// node node_modules/electron/cli.js scripts/trading-chart-zoom-regression-qa.cjs
// Uses real chart geometry and native mouse input with mocked market data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'chart-zoom-regression');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  const report = { recovery: [], limits: [], themes: [], errors: [], nativeClicks: 0 };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  const settle = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const click = async selector => {
    const p = await js(`(()=>{workspace.chartElement.focus();const e=${selector};assertButton(e);const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...p, button: 'left', clickCount: 1 });
    report.nativeClicks++;
    await settle();
  };
  const nav = action => `workspace.chartNavigation.controls.querySelector('[data-navigation-action=${action}]')`;
  const sidebar = action => `document.querySelector('[data-drawing-action=${action}]')`;
  const snapshot = () => js(`(()=>{
    const c=workspace.chart,t=c.timeScale(),s=c.priceScale('right'),r=t.getVisibleLogicalRange(),h=c.panes()[0].getHeight();
    const data=source.data().slice(Math.max(0,Math.ceil(r.from)),Math.max(0,Math.floor(r.to)+1));
    return {range:r,price:s.getVisibleRange(),auto:s.options().autoScale,mode:s.options().mode,spacing:t.options().barSpacing,
      visible:data.length,inside:data.filter(d=>source.priceToCoordinate(d.high)>=-1&&source.priceToCoordinate(d.low)<=h+1).length};
  })()`);
  const assertFit = (state, label) => {
    assert.equal(state.auto, false, label); // Default is fit once, then free dragging.
    assert.ok(state.visible > 0, `${label}: no candles`);
    assert.equal(state.inside, state.visible, `${label}: clipped candle highs/lows`);
    assert.ok([state.range.from, state.range.to, state.price.from, state.price.to, state.spacing].every(Number.isFinite), label);
    assert.ok(state.range.to > state.range.from && state.price.to > state.price.from && state.spacing > 0, label);
  };
  const box = async () => {
    await click(sidebar('zoom-in'));
    assert.equal(await js('workspace.chartNavigation.getTool()'), 'zoom');
    const p = await js(`(()=>{const pane=workspace.chart.panes()[0],r=pane.getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+70),y:Math.round(r.top+pane.getHeight()/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + 140, y: p.y + 24, button: 'left', modifiers: ['leftButtonDown'] });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x + 140, y: p.y + 24, button: 'left', clickCount: 1 });
    await settle();
    const state = await snapshot();
    assert.equal(state.auto, false, 'box selection must initially own its price range');
    assert.ok(state.inside < state.visible, 'narrow selection must reproduce clipped candles');
    return state;
  };

  for (const theme of ['light', 'dark']) {
    await win.webContents.session.clearStorageData();
    await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/') + '?zoom=' + theme);
    for (let i = 0; i < 100 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`window.assertButton=e=>{if(!e||e.disabled)throw Error('Button unavailable')};document.documentElement.dataset.theme='${theme}';window.primary=workspace;primary.loadingHistory=true;primary.splitLayoutId='2-columns';primary.applySplitLayout()`);
    for (let i = 0; i < 100 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(50);
    await js('clearInterval(primary.pollTimer);clearInterval(primary.candlePollTimer);clearTimeout(primary.splitPanes[0].refreshTimer);primary.splitPanes[0].refreshTimer=null;primary.favoriteTickerGeneration++;primary.closeFavoriteTickerStreams();primary.closeSocket();primary.cancelScheduledLiveChartPaint();primary.latestLivePricesByMarketId.clear();void 0');
    for (const subject of ['main', 'split']) {
      await js(`window.workspace=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};window.source=workspace.candleSeries||workspace.series;primary.activateDrawingController(workspace.drawingController);workspace.chartNavigation.activePane=0;workspace.chartElement.focus()`);
      for (const mode of [0, 1, 2]) {
        await js(`workspace.chartNavigation.setMode(${mode});workspace.chartNavigation.reset()`); await settle();
        for (const [entry, selector] of [['bottom minus', nav('zoom-out')], ['bottom plus', nav('zoom-in')], ['sidebar minus', sidebar('zoom-out')]]) {
          await js('workspace.chartNavigation.reset()'); await settle();
          const before = await box();
          await click(selector);
          const after = await snapshot();
          assertFit(after, `${theme}/${subject}/${mode}/${entry}`);
          assert.equal(after.mode, mode);
          report.recovery.push({ theme, subject, mode, entry, before, after });
        }
        // Changing this chart must leave the other split chart's manual view alone.
        await js(`window.other=${subject === 'main' ? 'primary.splitPanes[0]' : 'primary'};other.chart.priceScale('right').setAutoScale(false);window.otherRange=other.chart.timeScale().getVisibleLogicalRange();window.otherPrice=other.chart.priceScale('right').getVisibleRange()`);
        await js('workspace.chartNavigation.reset()'); await settle();
        for (const [action, count] of [['zoom-in', 35], ['zoom-out', 55]]) {
          for (let i = 0; i < count; i++) await click(nav(action));
          const atLimit = await snapshot(); assertFit(atLimit, `${theme}/${subject}/${mode}/${action}`);
          for (let i = 0; i < 12; i++) await click(nav(action));
          const repeated = await snapshot(); assertFit(repeated, 'stable limit');
          assert.ok(Math.abs(repeated.range.from - atLimit.range.from) < 1e-5 && Math.abs(repeated.range.to - atLimit.range.to) < 1e-5, JSON.stringify({ atLimit, repeated }));
          if (action === 'zoom-out') assert.equal(repeated.visible, await js('source.data().length'));
          report.limits.push({ theme, subject, mode, action, atLimit, repeated });
        }
        assert.equal(await js('other.chart.priceScale("right").options().autoScale'), false, 'zoom must stay local');
        assert.deepEqual(await js('other.chart.timeScale().getVisibleLogicalRange()'), await js('otherRange'));
        assert.deepEqual(await js('other.chart.priceScale("right").getVisibleRange()'), await js('otherPrice'));
        // Rapid alternating clicks before a paint must also retain finite geometry.
        await js(`(()=>{const c=workspace.chartNavigation.controls;for(let i=0;i<100;i++){c.querySelector('[data-navigation-action=zoom-in]').click();c.querySelector('[data-navigation-action=zoom-out]').click()}})()`); await settle();
        assertFit(await snapshot(), 'rapid alternating clicks');
        await js('workspace.chartNavigation.reset()'); await settle();
      }
      console.log('zoom passed', theme, subject);
    }
    await js(`window.workspace=primary;primary.activateDrawingController(primary.drawingController);primary.chartNavigation.reset();primary.splitPanes[0].chartNavigation.reset()`); await settle();
    await box(); await click(nav('zoom-out'));
    const tones = await js(`(()=>{const c=workspace.chartNavigation.controls,b=c.querySelector('button'),s=getComputedStyle(b),p=getComputedStyle(c);return {color:s.color,panel:p.backgroundColor,hover:s.backgroundColor,focus:s.outlineColor,pressed:c.querySelector('[data-navigation-action=lock-vertical]').getAttribute('aria-pressed')}})()`);
    assert.equal(tones.pressed, 'false');
    report.themes.push({ theme, ...tones });
    await fs.promises.writeFile(path.join(output, `${theme}-recovered.png`), (await win.webContents.capturePage()).toPNG());
    assert.equal(await js('window.qaError ?? null'), null);
    await js('primary.destroy()');
  }
  assert.notEqual(report.themes[0].color, report.themes[1].color);
  assert.notEqual(report.themes[0].panel, report.themes[1].panel);
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, recovery: report.recovery.length, limits: report.limits.length, nativeClicks: report.nativeClicks, output }));
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
