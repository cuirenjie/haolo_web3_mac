// Isolated real-chart acceptance. Run from the repository root with Vite :5183.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/chart-momentum-20261022');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const pause = ms => new Promise(r => setTimeout(r, ms));
const report = { cases: [], interruptions: [], masks: [], errors: [] };
(async () => {
  setTimeout(() => { console.error('momentum QA timed out'); app.exit(1); }, 180000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  win.webContents.on('console-message', e => { if (e.level === 'error' && !e.message.includes('Binance market catalog is unavailable')) report.errors.push(e.message); });
  await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  for (let i = 0; i < 200 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.ok(await js('Boolean(window.ready)'), await js('String(window.qaError)'));
  await js(`window.primary=workspace;primary.loadingHistory=true;primary.splitLayoutId='2-columns';primary.applySplitLayout();void 0`);
  for (let i = 0; i < 100 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(50);
  await js(`clearInterval(primary.pollTimer);clearInterval(primary.candlePollTimer);clearTimeout(primary.splitPanes[0].refreshTimer);
    primary.splitPanes[0].refreshTimer=null;primary.favoriteTickerGeneration++;primary.closeFavoriteTickerStreams();primary.closeSocket();primary.cancelScheduledLiveChartPaint();primary.latestLivePricesByMarketId.clear();
    window.frames=[];window.measuring=false;window.lastFrame=0;
    function tick(t){if(measuring)frames.push({t,offset:w.chart.timeScale().scrollPosition(),y:s.priceToCoordinate(1330),coasting:!!w.chartNavigation.coasting});lastFrame=t;requestAnimationFrame(tick)}requestAnimationFrame(tick);
    window.addEventListener('pointerup',()=>{window.qaRelease={offset:w.chart.timeScale().scrollPosition(),y:s.priceToCoordinate(1330),coasting:!!w.chartNavigation.coasting}});
    void 0`);
  await js(`import('/trading-chart-interaction.ts').then(module=>{window.interaction=module})`);
  const configure = async (theme, subject, mode = 0, inverted = false, locked = false) => {
    await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.w=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};
      primary.chartNavigation.cancelGesture();primary.splitPanes[0].chartNavigation.cancelGesture();
      primary.activateDrawingController(w.drawingController);w.chartNavigation.setVerticalLocked(false);w.chartNavigation.reset();
      w.chart.priceScale('right').applyOptions({mode:${mode},invertScale:${inverted}});void 0`);
    await settle();
    await js(`window.s=w.candleSeries||w.series;w.chartNavigation.setAutoScale(false);w.chartNavigation.setVerticalLocked(${locked});
      window.d=w.drawingController;d.drawings=[{id:'momentum-guide',tool:'horizontal-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:w.candles.at(-50).time,price:1330}]}];d.redraw();void 0`);
    await settle();
    await pause(120);
    return js(`(()=>{const r=w.chart.panes()[0].getHTMLElement().getBoundingClientRect();const y=Math.abs(s.priceToCoordinate(1330)-90)<50?180:90;return {x:Math.round(r.left+90),y:Math.round(r.top+y)}})()`);
  };
  const input = (type, p, extra = {}) => win.webContents.sendInputEvent({ type, ...p, ...extra });
  const flick = async (p, hold = 0, dy = 3) => {
    await js('frames=[];measuring=true;window.qaRelease=null;void 0');
    input('mouseMove', p); input('mouseDown', p, { button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      input('mouseMove', { x: p.x + i * 8, y: p.y + i * dy }, { button: 'left', modifiers: ['leftButtonDown'] }); await pause(16);
    }
    if (hold) await pause(hold);
    input('mouseUp', { x: p.x + 64, y: p.y + 8 * dy }, { button: 'left', clickCount: 1 });
    await settle(); return js('qaRelease');
  };
  for (const theme of ['light', 'dark']) for (const subject of ['main', 'split']) for (const mode of [0, 1, 2]) {
    const p = await configure(theme, subject, mode);
    const other = await js(`(w===primary?primary.splitPanes[0]:primary).chart.timeScale().scrollPosition()`);
    // Measure first accepted native mouse movement independently of release.
    const before = await js('({offset:w.chart.timeScale().scrollPosition(),spacing:w.chart.timeScale().options().barSpacing})');
    input('mouseMove', p); input('mouseDown', p, { button: 'left', clickCount: 1 });
    input('mouseMove', { x: p.x + 12, y: p.y }, { button: 'left', modifiers: ['leftButtonDown'] });
    await settle();
    const firstPixels = await js(`(${before.offset}-w.chart.timeScale().scrollPosition())*${before.spacing}`);
    assert.ok(Math.abs(firstPixels - 12) < .5, 'first movement lost: ' + firstPixels);
    input('mouseUp', { x: p.x + 12, y: p.y }, { button: 'left', clickCount: 1 });
    await js('w.chartNavigation.cancelGesture();void 0');
    const released = await flick(p);
    assert.equal(released.coasting, true, `${theme}/${subject}/${mode} release`);
    await js('window.resumed=0;interaction.deferTradingChartShellRender(()=>resumed++);void 0');
    await pause(180);
    const moving = await js('({offset:w.chart.timeScale().scrollPosition(),y:s.priceToCoordinate(1330),coasting:!!w.chartNavigation.coasting,resumed})');
    assert.ok(moving.offset < released.offset - .5, 'horizontal glide'); assert.equal(moving.resumed, 0);
    assert.ok(moving.y > released.y + 2, 'vertical glide ' + JSON.stringify({released,moving, state:await js('({auto:w.chart.priceScale("right").options().autoScale,velocity:w.chartNavigation.momentum.velocity,locked:w.chartNavigation.isVerticalLocked(),mode:w.chart.priceScale("right").options().mode})')}));
    for (let i = 0; i < 100 && await js('!!w.chartNavigation.coasting'); i++) await pause(20);
    await settle();
    const result = await js(`(()=>{measuring=false;const gaps=frames.slice(1).map((f,i)=>f.t-frames[i].t).sort((a,b)=>a-b);
      const line=d.content.querySelector('[data-drawing-id="momentum-guide"] line');
      return {offset:w.chart.timeScale().scrollPosition(),y:s.priceToCoordinate(1330),coasting:!!w.chartNavigation.coasting,resumed,
        frameP95:gaps[Math.floor(gaps.length*.95)],frameMax:Math.max(...gaps),frames:frames.length,
        guide:line?Number(line.getAttribute('y1')):null,other:(w===primary?primary.splitPanes[0]:primary).chart.timeScale().scrollPosition()}})()`);
    assert.equal(result.coasting, false); assert.equal(result.resumed, 1); assert.equal(result.other, other);
    assert.ok(Math.abs(result.guide - result.y) < 1, 'drawing alignment ' + JSON.stringify(result));
    const stopped = result.offset; await pause(80); assert.equal(await js('w.chart.timeScale().scrollPosition()'), stopped);
    report.cases.push({ theme, subject, mode, firstPixels, released, moving, ...result });
    console.log(JSON.stringify({ theme, subject, mode, firstPixels, p95: result.frameP95, max: result.frameMax }));
  }
  for (const [label, action] of [
    ['mouse-down', p => input('mouseDown', p, { button: 'left', clickCount: 1 })],
    ['wheel', p => input('mouseWheel', p, { deltaY: -16, deltaX: 0 })],
    ['escape', () => input('keyDown', {}, { keyCode: 'Escape' })],
    ['context-change', () => js('w.chartNavigation.cancelGesture();void 0')],
    ['blur', () => js('window.dispatchEvent(new Event("blur"));void 0')],
  ]) {
    const p = await configure('light', 'main'); await flick(p); await pause(50); await action(p); await settle();
    assert.equal(await js('!!w.chartNavigation.coasting'), false, label);
    input('mouseUp', p, { button: 'left', clickCount: 1 });
    const before = await js('w.chart.timeScale().scrollPosition()'); await pause(160);
    assert.equal(await js('w.chart.timeScale().scrollPosition()'), before, label + ' no drift'); report.interruptions.push(label);
  }
  for (const subject of ['main', 'split']) {
    let p = await configure('dark', subject, 1, true); const release = await flick(p); await pause(180);
    assert.ok(await js('s.priceToCoordinate(1330)') > release.y + 2, 'inverted logarithmic drag follows pointer');
    p = await configure('dark', subject, 0, false, true); const locked = await flick(p); await pause(180);
    assert.ok(await js('w.chart.timeScale().scrollPosition()') < locked.offset); await js('w.chartNavigation.cancelGesture();void 0');
    p = await configure('dark', subject); await flick(p, 100); assert.equal(await js('!!w.chartNavigation.coasting'), false, 'held release');
    report.interruptions.push(subject + ' inverted-log/locked/held');
  }
  for (const theme of ['light', 'dark']) {
    await configure(theme, 'main'); await settle();
    const maskResult = await js(`(()=>{
      const geometry=d.content.querySelector('[data-drawing-placeholder-mask]');
      if(!geometry)throw Error('missing lazy placeholder mask');
      const read=()=>getComputedStyle(geometry).maskImage;
      const group=geometry.closest('[data-drawing-id]'), old=group.getAttribute('data-selected');
      const idle=read();group.setAttribute('data-selected','true');const selected=read();
      d.overlay.classList.add('dragging-drawing');const dragging=read();d.overlay.classList.remove('dragging-drawing');
      document.body.classList.add('trading-chart-capturing');const capture=read();document.body.classList.remove('trading-chart-capturing');
      group.setAttribute('data-selected',old);return {idle,selected,dragging,capture};
    })()`);
    assert.equal(maskResult.idle, 'none'); assert.match(maskResult.selected, /url\(/);
    assert.equal(maskResult.dragging, 'none'); assert.equal(maskResult.capture, 'none');
    report.masks.push({theme,...maskResult});
    fs.writeFileSync(path.join(output, theme + '.png'), (await win.webContents.capturePage()).toPNG());
  }
  assert.equal(await js('window.qaError??null'), null); assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS ${report.cases.length} real-chart cases, ${report.interruptions.length} interruption/axis cases`);
  win.destroy(); app.quit();
})().catch(error => { report.failure = String(error.stack || error); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.error(error); app.exit(1); });
