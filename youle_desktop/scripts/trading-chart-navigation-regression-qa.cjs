// M1-317 regressions against the actual chart library and native Electron input.
// Start Vite on 127.0.0.1:5183, then run with the repository's Electron binary.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'tradingview-regression');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  const report = { modes: [], measurements: [], logarithmic: [], signedIndicators: [], errors: [] };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await pause(100);
  };
  const click = async (x, y, button = 'left') => {
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x, y, button, clickCount: 1 });
    await pause(80);
  };
  const drag = async (x, y, dx, dy, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers });
    for (let step = 1; step <= 8; step++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x + dx * step / 8), y: Math.round(y + dy * step / 8), button: 'left', modifiers: ['leftButtonDown', ...modifiers] });
      await pause(12);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y: y + dy, button: 'left', clickCount: 1, modifiers });
    await pause(100);
  };
  const point = () => js(`(()=>{const r=workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect(),e=workspace.chartElement.getBoundingClientRect();return {x:Math.round(r.left+100),y:Math.round(r.top+100),timeY:Math.round(e.bottom-12),axisX:Math.round(e.right-20)}})()`);
  const measure = async () => {
    const p = await point();
    await drag(p.x, p.y, 170, 100, ['shift']);
    assert.equal(await js('Boolean(workspace.chartElement.querySelector(".trading-chart-measurement"))'), true, 'measurement must initially be visible');
    return p;
  };
  const priceCases = [[100000, .01], [100000, .1], [100000, 1], [100, .0001], [1, .000001], [1, .0001], [1, .001], [10, .01], [.00001, 1e-10]];
  for (const theme of ['light', 'dark']) {
    await win.webContents.session.clearStorageData();
    await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/') + '?regression=' + theme);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}';workspace.loadingHistory=true;workspace.chartSettings.priceScaleMode='linear';workspace.applyChartTheme();window.primary=workspace;primary.splitLayoutId='2-columns';primary.applySplitLayout()`);
    for (let i = 0; i < 100 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(50);
    // Tests explicitly control data updates; background mock polling must not
    // replace a narrow-price scenario with the fixture's default 1300 candles.
    await js('clearInterval(primary.pollTimer);primary.pollTimer=null;clearInterval(primary.candlePollTimer);primary.candlePollTimer=null;clearTimeout(primary.splitPanes[0].refreshTimer);primary.splitPanes[0].refreshTimer=null;primary.favoriteTickerGeneration++;primary.closeFavoriteTickerStreams();primary.closeSocket();primary.cancelScheduledLiveChartPaint();primary.latestLivePricesByMarketId.clear();void 0');
    await js('window.workspace=primary.splitPanes[0];workspace.chartElement.focus()'); await pause(180);
    const assertMode = async (mode, label) => {
      const actual = await js(`({actual:workspace.chart.priceScale('right').options().mode,setting:workspace.settings.priceScaleMode,primary:primary.chart.priceScale('right').options().mode})`);
      assert.equal(actual.actual, mode, label); assert.equal(actual.setting, ['linear', 'logarithmic', 'percentage'][mode], label);
      assert.equal(actual.primary, 0, 'split action must stay local');
      report.modes.push({ theme, label, ...actual });
    };
    for (const [letter, mode] of [['l', 1], ['l', 0], ['p', 2], ['p', 0]]) { await key(letter, ['alt']); await assertMode(mode, 'Alt+' + letter); }
    for (const mode of [1, 0]) {
      await js(`workspace.chartNavigation.setMode(${mode})`); await pause(100); await assertMode(mode, 'price mode setting');
    }
    for (const [index, mode] of [[3, 2], [2, 1], [2, 0]]) {
      const p = await point(); await click(p.x, p.y, 'right');
      await js(`workspace.chartElement.querySelector('.trading-chart-navigation-menu').children[${index}].click()`); await pause(100); await assertMode(mode, 'context menu');
    }
    await key('l', ['alt']);
    await js(`document.documentElement.dataset.theme='${theme === 'dark' ? 'light' : 'dark'}'`); await pause(120); await assertMode(1, 'local mode survives theme');
    await js(`document.documentElement.dataset.theme='${theme}'`); await pause(120); await assertMode(1, 'local mode survives theme restore');
    await js(`primary.chartSettings.priceScaleMode='percentage';primary.applyChartTheme()`); await pause(120);
    assert.equal(await js('workspace.chart.priceScale("right").options().mode'), 2, 'a changed global mode must still synchronize');
    await js(`primary.chartSettings.priceScaleMode='linear';primary.applyChartTheme()`); await pause(120); await assertMode(0, 'global mode restore');
    for (const subject of ['main', 'split']) {
      await js(`window.workspace=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};window.source=workspace.candleSeries||workspace.series;window.originalCandles=workspace.candles.map(c=>({...c}));workspace.chartNavigation.reset();workspace.chartElement.focus()`); await pause(150);
      const actions = [
        ['time axis', async p => drag(p.x, p.timeY, 100, 0)],
        ['price axis', async p => drag(p.axisX, p.y, 0, 60)],
        ['navigation button', async () => { await js(`workspace.chartNavigation.controls.querySelector('[data-navigation-action=zoom-in]').click()`); await pause(100); }],
        ['arrow key', async () => key('Left')],
        ['zoom key', async () => key('Up', ['control'])],
        ['external time range', async () => { await js('(()=>{const t=workspace.chart.timeScale(),r=t.getVisibleLogicalRange();t.setVisibleLogicalRange({from:r.from-5,to:r.to-5})})()'); await pause(100); }],
        ['resize', async () => { await js(`workspace.chartElement.style.height=(workspace.chartElement.clientHeight-80)+'px'`); await pause(160); }],
        ['series update', async () => { await js('source.update({...source.data().at(-1)})'); await pause(100); }],
      ];
      for (const [action, run] of actions) {
        const p = await measure(); await run(p);
        assert.equal(await js('workspace.chartElement.querySelectorAll(".trading-chart-measurement").length'), 0, `${theme}/${subject}: stale measurement after ${action}`);
        report.measurements.push({ theme, subject, action });
        await js(`workspace.chartElement.style.height='';workspace.chartNavigation.reset();workspace.chartElement.focus()`); await pause(100);
      }
      for (const [center, amplitude] of priceCases) {
        await js(`workspace.candles=originalCandles.map((c,i)=>{const o=${center}+Math.sin(i/9)*${amplitude},close=o+Math.sin(i)*${amplitude}/5;return {...c,open:o,close,high:Math.max(o,close)+${amplitude}/10,low:Math.min(o,close)-${amplitude}/10}});if(workspace===primary){workspace.chartSettings.priceScaleMode='logarithmic';workspace.applyChartTheme();workspace.updateChartData({resetViewport:true})}else{workspace.chartNavigation.setMode(1);workspace.updateData()}source.applyOptions({priceFormat:{type:'price',precision:${Math.min(12, Math.max(2, Math.ceil(-Math.log10(amplitude)) + 2))},minMove:${10 ** -Math.min(12, Math.max(2, Math.ceil(-Math.log10(amplitude)) + 2))}}});workspace.chartNavigation.reset()`); await pause(120);
        const p = await point();
        const snapshot = () => js(`(()=>{const s=workspace.chart.priceScale('right'),h=workspace.chart.panes()[0].getHeight(),y=source.priceToCoordinate(${center});return {range:s.getVisibleRange(),auto:s.options().autoScale,mode:s.options().mode,y,height:h,sample:source.coordinateToPrice(h/2)}})()`);
        const before = await snapshot();
        assert.ok(Number.isFinite(before.y) && before.y > 0 && before.y < before.height, 'fixture price must start inside its pane: ' + JSON.stringify({center,amplitude,before}));
        for (const deltaY of [60, -90, 30]) {
          win.webContents.sendInputEvent({ type: 'mouseWheel', x: p.axisX, y: p.y, deltaY, deltaX: 0 }); await pause(100);
          const after = await snapshot();
          assert.equal(after.mode, 1); assert.equal(after.auto, false);
          assert.ok(Number.isFinite(after.y) && Math.abs(after.y - before.y) < 25, JSON.stringify({ theme, subject, center, amplitude, deltaY, before, after }));
          assert.ok(Math.abs(after.sample - center) < amplitude * 2, JSON.stringify(after));
        }
        const wheel = await snapshot();
        await js('if(workspace===primary)workspace.updateChartData({preserveViewport:true});else workspace.updateData()'); await pause(100);
        assert.ok(Math.abs((await snapshot()).y - wheel.y) < 1, 'data update must retain manual log range');
        await js(`document.documentElement.dataset.theme='${theme === 'dark' ? 'light' : 'dark'}'`); await pause(100);
        assert.ok(Math.abs((await snapshot()).y - wheel.y) < 1, 'theme change must retain manual log range');
        await js(`document.documentElement.dataset.theme='${theme}'`); await pause(100);
        const target = await js(`source.coordinateToPrice(${p.y}-workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect().top)`);
        await js(`workspace.chartNavigation.setTool('zoom')`); await drag(p.x, p.y, 180, 160);
        const boxed = await snapshot(), actualY = await js(`source.priceToCoordinate(${target})`);
        const expectedY = await js('workspace.chart.panes()[0].getHeight()*workspace.chart.priceScale("right").options().scaleMargins.top');
        assert.ok(Number.isFinite(actualY) && Math.abs(actualY - expectedY) < 20, JSON.stringify({ theme, subject, center, amplitude, target, actualY, expectedY, boxed }));
        assert.equal(boxed.mode, 1); assert.equal(boxed.auto, false);
        // Reset fits through the original providers, then respects the saved Auto preference.
        await js('workspace.chartNavigation.reset()'); await pause(100);
        const reset = await snapshot();
        assert.equal(reset.auto, await js("(workspace.chartSettings || workspace.settings).autoScale")); assert.ok(Math.abs(reset.y - before.y) < 2, JSON.stringify({ theme, subject, center, amplitude, before, reset }));
        report.logarithmic.push({ theme, subject, center, amplitude, before, wheel, actualY, expectedY, reset });
        if (center === 100000 && amplitude === .1) await fs.promises.writeFile(path.join(output, `${theme}-${subject}-log-fixed.png`), (await win.webContents.capturePage()).toPNG());
      }
      await js(`workspace.candles=originalCandles;if(workspace===primary){workspace.chartSettings.priceScaleMode='linear';workspace.applyChartTheme();workspace.updateChartData({resetViewport:true})}else{workspace.updateSettings({...workspace.settings,priceScaleMode:'linear'},'${theme}');workspace.updateData()}workspace.chartNavigation.reset()`); await pause(120);
    }
    // Retain coverage for negative/cross-zero indicator axes and inverted axes.
    await js(`window.workspace=primary;window.indicatorPane=primary.chart.panes()[1];window.indicatorSeries=indicatorPane.getSeries().find(s=>s.seriesType()==='Line');window.indicatorScale=primary.chart.priceScale('right',1);indicatorPane.getSeries().forEach(s=>s.setData([]));void 0`);
    for (const center of [-1e-5, 0]) for (const invert of [false, true]) {
      await js(`indicatorSeries.setData(primary.candles.map((c,i)=>({time:c.time+28800,value:${center}+Math.sin(i/9)*1e-6})));indicatorSeries.applyOptions({priceFormat:{type:'price',precision:10,minMove:1e-10}});indicatorScale.applyOptions({mode:1,autoScale:true,invertScale:${invert}})`); await pause(120);
      const before = await js(`(()=>{const r=indicatorPane.getHTMLElement().getBoundingClientRect();return {y:indicatorSeries.priceToCoordinate(${center}),x:Math.round(r.right-20),py:Math.round(r.top+70)}})()`);
      win.webContents.sendInputEvent({ type: 'mouseWheel', x: before.x, y: before.py, deltaY: 60, deltaX: 0 }); await pause(120);
      const after = await js(`({y:indicatorSeries.priceToCoordinate(${center}),mode:indicatorScale.options().mode,auto:indicatorScale.options().autoScale,invert:indicatorScale.options().invertScale})`);
      assert.equal(after.mode, 1); assert.equal(after.auto, false); assert.equal(after.invert, invert);
      assert.ok(Number.isFinite(after.y) && Math.abs(after.y - before.y) < 15, JSON.stringify({ theme, center, invert, before, after }));
      report.signedIndicators.push({ theme, center, invert, before, after });
    }
    console.log('theme passed', theme);
    await js('primary.destroy()');
  }
  assert.deepEqual(report.errors, [], 'unexpected renderer errors');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, modes: report.modes.length, measurements: report.measurements.length, logarithmic: report.logarithmic.length, signedIndicators: report.signedIndicators.length, output }));
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
