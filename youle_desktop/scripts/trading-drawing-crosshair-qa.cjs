// Real Chromium hit testing and chart events, with isolated synthetic market data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache/drawing-crosshair-20261018');
const probe = process.argv.includes('--probe');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  setTimeout(() => app.exit(1), 90000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async source => {
    try { return await win.webContents.executeJavaScript(source, true); }
    catch (error) { throw new Error(source.slice(0, 500) + ': ' + error.message + ' / ' + await win.webContents.executeJavaScript('String(window.qaError)')); }
  };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(40); };
  const move = async (x, y) => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) }); await settle(); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
  await js(`window.w=workspace;window.d=w.drawingController;
    clearInterval(w.pollTimer);clearInterval(w.candlePollTimer);w.favoriteTickerGeneration++;
    w.closeFavoriteTickerStreams();w.closeSocket();w.cancelScheduledLiveChartPaint();w.loadingHistory=true;
    d.drawings=[];d.selectDrawing(null);d.selectTool('crosshair');d.redraw();
    window.moves=[];w.chart.subscribeCrosshairMove(p=>moves.push({point:p.point,paneIndex:p.paneIndex,time:p.time,logical:p.logical}));void 0`);
  await settle();
  const rect = await js(`(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const point = { x: rect.x + rect.width * .55, y: rect.y + rect.height * .45 };
  await move(1350, 850); await move(point.x, point.y);
  const native = await js('moves.at(-1)');
  assert.ok(native?.point, 'native crosshair is visible before selecting a tool');
  await capture('before-native');
  await js("d.selectTool('trend-line');moves=[];void 0");
  await move(point.x + 40, point.y + 35);
  const drawing = await js(`({last:moves.at(-1),events:moves.length,color:w.chart.options().crosshair.vertLine.color,
    hit:document.elementFromPoint(${point.x + 40},${point.y + 35})?.tagName,
    cursor:getComputedStyle(d.overlay).cursor})`);
  await capture(probe ? 'before-drawing-missing' : 'after-drawing');
  const report = { native, drawing };
  fs.writeFileSync(path.join(output, probe ? 'before.json' : 'after.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!probe) assert.ok(drawing.last?.point, 'drawing overlay forwards crosshair motion');
  if (!probe) {
    const checks = [];
    const click = async (x, y) => {
      await move(x, y);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      await settle();
    };
    const verify = async (x, y, paneIndex, label) => {
      await js('moves=[];void 0');
      await move(x, y);
      const actual = await js(`(()=>{const p=moves.at(-1);const canvas=w.chart.panes()[${paneIndex}].getHTMLElement().children[1].querySelector('canvas:last-of-type');
        const r=canvas.getBoundingClientRect(),cy=Math.round((Math.round(${y})-r.top)*canvas.height/r.height);
        const row=canvas.getContext('2d').getImageData(0,Math.max(0,cy-2),canvas.width,5).data;
        return {point:p?.point,paneIndex:p?.paneIndex,expected:{x:Math.round(${x})-r.left,y:Math.round(${y})-r.top},
          hit:document.elementFromPoint(${x},${y})?.outerHTML.slice(0,180),timeVisible:!w.crosshairTimeElement.hidden,priceVisible:!w.crosshairPriceElement.hidden,
          horizontalPixels:row.reduce((sum,v,i)=>sum+(i%4===3&&v>0?1:0),0),canvasWidth:canvas.width,
          pixels:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0)}})()`);
      assert.ok(actual.point, label + ': crosshair event ' + JSON.stringify(actual));
      assert.equal(actual.paneIndex, paneIndex, label + ': correct pane');
      assert.ok(Math.abs(actual.point.x - actual.expected.x) < 1.1 && Math.abs(actual.point.y - actual.expected.y) < 1.1, label + ': exact pointer coordinates');
      assert.ok(actual.timeVisible && actual.pixels, label + ': time label and crosshair pixels');
      assert.ok(actual.horizontalPixels > actual.canvasWidth / 10, label + ': horizontal crosshair spans plot');
      assert.equal(actual.priceVisible, paneIndex === 0, label + ': main price label is scoped');
      checks.push(label);
    };
    const tools = await js("import('/trading-expert-drawing.ts').then(m=>m.TRADING_DRAWING_TOOLS.filter(t=>t.kind!=='cursor').map(t=>t.id))");
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.theme='${theme}';w.applyChartTheme(false);void 0`);
      for (const [i, tool] of tools.entries()) {
        await js(`d.selectTool(${JSON.stringify(tool)});void 0`);
        await verify(point.x + i % 9 * 6, point.y + i % 7 * 5, 0, theme + ': ' + tool);
      }
      await js("d.selectTool('trend-line');void 0");
      await verify(point.x + 100, point.y + 80, 0, theme + ': final line hover');
      await capture('after-' + theme);
      await move(25, 80);
      assert.equal(await js('Boolean(moves.at(-1)?.point)||!w.crosshairTimeElement.hidden||!w.crosshairPriceElement.hidden'), false, 'leaving hides crosshair and labels');
      await verify(point.x, point.y, 0, theme + ': reenter');
    }
    await js("document.documentElement.dataset.theme='light';w.applyChartTheme(false);d.stayInDrawingMode=true;d.selectTool('trend-line');void 0");
    const range = await js('w.chart.timeScale().getVisibleLogicalRange()');
    const count = await js('d.drawings.length');
    for (let i = 0; i < 3; i++) {
      await click(point.x - 100, point.y + i * 30);
      await verify(point.x + 100, point.y + 20 + i * 30, 0, 'multi-click preview ' + i);
      await click(point.x + 100, point.y + 20 + i * 30);
      await verify(point.x + 140, point.y + 45 + i * 30, 0, 'continuous drawing ' + i);
    }
    assert.equal(await js('d.drawings.length'), count + 3, 'three completed drawings');
    assert.deepEqual(await js('w.chart.timeScale().getVisibleLogicalRange()'), range, 'drawing never pans chart');
    await js("d.selectTool('crosshair');d.selectDrawing(d.drawings.at(-1).id);d.redraw();void 0");
    const handle = await js(`(()=>{const p=d.pointToScreen(d.drawings.at(-1).points[1]),r=d.chartElement.getBoundingClientRect();return {x:p.x+r.left,y:p.y+r.top}})()`);
    await move(handle.x, handle.y);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(handle.x), y: Math.round(handle.y), button: 'left', clickCount: 1 });
    await settle();assert.equal(await js('Boolean(d.dragState)'), true, 'endpoint drag began');
    await verify(handle.x + 25, handle.y - 15, 0, 'endpoint drag');
    await move(1350, 850);
    assert.equal(await js('Boolean(moves.at(-1)?.point)'), false, 'captured pointer outside plot clears crosshair');
    await verify(handle.x + 40, handle.y - 30, 0, 'captured pointer reenters');
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(handle.x + 40), y: Math.round(handle.y - 30), button: 'left', clickCount: 1 });
    await settle();assert.equal(await js('Boolean(d.dragState)'), false, 'endpoint released');
    assert.deepEqual(await js('w.chart.timeScale().getVisibleLogicalRange()'), range, 'endpoint drag never pans chart');
    await js("d.selectTool('trend-line');void 0");
    await verify(rect.x + rect.width - 8, point.y + 5, 0, 'future whitespace');
    assert.ok(await js('moves.at(-1).logical > w.chartCandles.length - 1'), 'crosshair is beyond final candle');
    await js("window.dispatchEvent(new Event('blur'));void 0");await settle();
    assert.equal(await js('Boolean(moves.at(-1)?.point)||!w.crosshairTimeElement.hidden'), false, 'blur clears crosshair');
    await verify(rect.x + rect.width * .3, rect.y + rect.height * .75, 0, 'returns after blur');
    await js("d.selectDrawing(null);d.redraw();w.activeIndicators=['volume'];w.rebuildIndicatorPanes();w.updateIndicatorData(w.chartCandles);void 0");await settle();
    for (let i = 0; i < 2; i++) {
      if (i) { await js('w.rebuildIndicatorPanes();w.updateIndicatorData(w.chartCandles);void 0');await settle(); }
      const indicator = await js(`(()=>{const c=Array.from(w.indicatorDrawingControllers.values())[0];c.selectTool('trend-line');const r=c.overlay.getBoundingClientRect();
        return {x:r.x+r.width*.6,y:r.y+r.height*.55,paneIndex:c.paneIndex}})()`);
      await verify(indicator.x, indicator.y, indicator.paneIndex, i ? 'rebuilt indicator pane' : 'indicator pane');
      await capture(i ? 'after-indicator-rebuilt' : 'after-indicator');
      await verify(point.x + 20 + i * 5, point.y, 0, 'return to main pane ' + i);
    }
    await js("d.selectTool('trend-line');d.crosshair.destroy();moves=[];void 0");
    await move(point.x + 80, point.y + 5);
    assert.equal(await js('moves.filter(p=>p.point).length'), 0, 'destroy cancels forwarding');
    report.checks = checks;
    report.passed = true;
    fs.writeFileSync(path.join(output, 'after.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, tools: tools.length, checks: checks.length }));
  }
  win.destroy();app.exit(0);
})().catch(error => { console.error(error);app.exit(1); });
