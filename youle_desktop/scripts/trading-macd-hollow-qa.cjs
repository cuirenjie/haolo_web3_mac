// Run with Electron while this checkout's Vite server listens on 127.0.0.1:5183.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'macd-hollow');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await pause(80); await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); };
  const screenshot = async name => fs.promises.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const fixture = `http://127.0.0.1:5183/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`;
  const load = async () => {
    await win.loadURL(fixture);
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js("host.style.width='100%';host.style.height='100vh';workspace.loadingHistory=true;void 0");
    await settle();
  };
  const openEditor = async () => {
    await js("workspace.selectedIndicatorSettingKey='sub:macd';workspace.setIndicatorEditorOpen(true)");
    await settle();
  };
  const selectStyle = async style => {
    await click('.trading-market-indicator-histogram-style [data-haolo-select-trigger]');
    await click(`.trading-market-indicator-histogram-style [data-haolo-select-value="${style}"]`);
  };
  const click = async selector => {
    const point = await js(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({ type, ...point, button:'left', clickCount:1 });
    await settle();
  };
  const action = async name => { await js(`workspace.host.querySelector('[data-market-action="${name}"]').click()`); await settle(); };
  const style = () => js("workspace.indicatorSettings['sub:macd'].series.histogram.histogramStyle");
  const histogram = subject => `${subject}.indicatorPanes.get('macd').series.find(s=>s.key==='histogram').api`;
  const seriesType = subject => js(`${histogram(subject)}.seriesType()`);
  await win.webContents.session.clearStorageData();
  await load();
  await openEditor();
  assert.equal(await style(), 'solid');
  await selectStyle('hollow');
  assert.equal(await style(), 'solid', 'draft does not change the chart');
  await action('close-indicator-editor');
  await openEditor();
  assert.equal(await js("document.querySelector('[data-market-indicator-histogram-style]').value"), 'solid');
  await selectStyle('hollow');
  await screenshot('light-settings');
  await action('save-indicator-settings');
  assert.equal(await style(), 'hollow');
  assert.equal(await seriesType('workspace'), 'Custom');
  await load();
  assert.equal(await style(), 'hollow', 'saved preference survives a renderer restart');
  assert.equal(await seriesType('workspace'), 'Custom');
  await js("workspace.splitLayoutId='2-columns';workspace.applySplitLayout();void 0");
  for (let i = 0; i < 150 && !await js('workspace.splitPanes[0]?.candles.length'); i++) await pause(100);
  await js("workspace.splitPanes[0].activateIndicator('sub','macd');void 0");
  await settle();
  assert.equal(await seriesType('workspace.splitPanes[0]'), 'Custom');
  const report = { pixels: [], persistence: true, split: true };
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.chart.timeScale().setVisibleLogicalRange({from:430,to:490});workspace.splitPanes[0].chart.timeScale().setVisibleLogicalRange({from:430,to:490});void 0`);
    await settle();
    await openEditor();
    await screenshot(`${theme}-settings`);
    await click('.trading-market-indicator-histogram-style [data-haolo-select-trigger]');
    await screenshot(`${theme}-settings-options`);
    await action('close-indicator-editor');
    await screenshot(`${theme}-split-hollow`);
    // Compare actual canvas pixels at the bar interior and border. Both signs
    // must retain colored edges while exposing the background in the center.
    for (const subject of ['workspace', 'workspace.splitPanes[0]']) {
      const pixels = await js(`(() => {
        const w=${subject}, runtime=w.indicatorPanes.get('macd'), api=${histogram(subject)};
        if(!runtime.pane.getSeries().includes(api))throw new Error('Histogram must belong to the MACD pane');
        const plot=runtime.pane.getHTMLElement().querySelector('td:nth-child(2)>div');
        const canvas=plot.querySelector('canvas'), ctx=canvas.getContext('2d'), ratio=canvas.width/canvas.getBoundingClientRect().width;
        const sample=(x,y)=>Array.from(ctx.getImageData(Math.round(x*ratio),Math.round(y*ratio),1,1).data);
        return [-1,1].map(sign=>{
          const point=api.data().find(d=>Math.sign(d.value)===sign&&Math.abs(d.value)>0.5&&w.chart.timeScale().timeToCoordinate(d.time)>40&&w.chart.timeScale().timeToCoordinate(d.time)<w.chart.timeScale().width()-40);
          if(!point)throw new Error('Missing visible histogram sign '+sign);
          const x=w.chart.timeScale().timeToCoordinate(point.time),zero=api.priceToCoordinate(0),tip=api.priceToCoordinate(point.value);
          return {sign,center:sample(x,(zero+tip)/2),edge:sample(x,Math.min(tip,zero)+0.5),value:point.value};
        });
      })()`);
      for (const pixel of pixels) {
        assert.notDeepEqual(pixel.center, pixel.edge, `${theme} ${subject}: interior must be hollow`);
        assert.ok(Math.max(...pixel.edge.slice(0,3))-Math.min(...pixel.edge.slice(0,3))>60, 'border retains sign color');
      }
      report.pixels.push({ theme, subject, pixels });
    }
  }
  // Live updates use the same value/time shape as native histograms.
  await js(`(() => {const api=${histogram('workspace')},last=api.data().at(-1);window.qaOriginal=last;api.update({...last,value:last.value+0.25});})()`);
  await settle();
  assert.equal(await js(`${histogram('workspace')}.data().at(-1).value`), await js('qaOriginal.value+0.25'));
  await openEditor();
  await action('restore-indicator-settings');
  assert.equal(await js("document.querySelector('[data-market-indicator-histogram-style]').value"), 'solid');
  assert.equal(await style(), 'hollow', 'restore is a draft until saved');
  await action('save-indicator-settings');
  assert.equal(await seriesType('workspace'), 'Histogram');
  assert.equal(await seriesType('workspace.splitPanes[0]'), 'Histogram');
  await screenshot('dark-split-solid-restored');
  assert.equal(await js('window.qaError || null'), null);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(`PASS: MACD hollow settings, cancel/save/reload/reset, main/split, light/dark pixels and live updates. ${output}`);
  win.destroy(); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
