const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/regression-trend-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{try{return await (async()=>{return eval(${JSON.stringify(code)})})()}catch(e){return {__qaError:String(e.stack)}}})()`, true).then(value => { if (value?.__qaError) throw new Error(value.__qaError + '\n' + code.slice(0, 350)); return value; });
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(30); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, p, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  const click = async p => { await input('mouseMove', p); await input('mouseDown', p, { button: 'left', clickCount: 1 }); await input('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const drag = async (a, b) => { await input('mouseMove', a); await input('mouseDown', a, { button: 'left', clickCount: 1 }); await input('mouseMove', b, { button: 'left', modifiers: ['leftButtonDown'] }); await input('mouseUp', b, { button: 'left', clickCount: 1 }); };
  const load = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`(async()=>{window.reg=await import('/trading-regression-trend.ts');window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');
      window.candles=Array.from({length:120},(_,i)=>{const close=1300+i*.3+Math.sin(i/4)*6;return {time:1792252800+i*3600,open:close+Math.sin(i)*2,high:close+3,low:close-3,close,volume:100}});
      workspace.candles=candles;workspace.updateChartData({resetViewport:true});d.getCandles=()=>candles;d.getChart().timeScale().setVisibleLogicalRange({from:-3,to:125});d.redraw()})()`); await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5194}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await load();
  const rect = await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
  const screen = (x, y) => ({ x: rect.x + x, y: rect.y + y });
  const state = () => js(`(()=>{const item=d.draft??d.drawings.at(-1),g=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]');return {draft:!!d.draft,count:d.drawings.length,model:item,
    fit:item?reg.calculateRegressionTrend(candles,item.points,item.regression):null,
    lines:[...(g?.querySelectorAll('.trading-drawing-geometry line')??[])].map(l=>({part:l.dataset.regressionLine,x1:+l.getAttribute('x1'),y1:+l.getAttribute('y1'),x2:+l.getAttribute('x2'),y2:+l.getAttribute('y2')})),
    fills:g?.querySelectorAll('[data-regression-fill]').length??0,pearson:g?.querySelector('[data-regression-pearson]')?.textContent,
    handles:g?.querySelectorAll('[data-drawing-handle-index]').length??0,tool:d.activeTool,status:d.status.textContent}})()`);
  const near = (a, b, message) => assert.ok(Math.abs(a - b) < .6, `${message}: ${a} vs ${b}`);
  const verify = async value => {
    assert.equal(value.fills, 2); assert.equal(value.lines.length, 3); assert.ok(value.fit.slope > 0);
    const projected = await js(`reg.calculateRegressionTrend(candles,d.drawings.at(-1).points,d.drawings.at(-1).regression).base.map(p=>d.pointToScreen(p))`);
    const base = value.lines.find(l => l.part === 'base');
    near(base.x1, projected[0].x, 'base start x'); near(base.y1, projected[0].y, 'base start y');
    near(base.x2, projected[1].x, 'base end x'); near(base.y2, projected[1].y, 'base end y');
    for (const l of value.lines) { near(l.x1, base.x1, 'channel left'); near(l.x2, base.x2, 'channel right'); }
    assert.equal(Number(value.pearson), Number(value.fit.pearson.toPrecision(16)));
  };
  for (const theme of ['light', 'dark']) for (const reverse of [false, true]) {
    await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.getCandleSeries().priceScale().applyOptions({scaleMargins:{top:.15,bottom:.3}});d.selectTool('regression-trend');d.redraw()`); await settle();
    const a = { x: 400, y: 180 }, b = { x: 1050, y: 420 };
    await click(screen(...Object.values(reverse ? b : a))); await input('mouseMove', screen(...Object.values(reverse ? a : b)));
    let v = await state(); assert.equal(v.draft, true); assert.equal(v.lines.length, 1); assert.equal(v.fills, 0);
    if (!reverse) await capture(theme + '-preview');
    await click(screen(...Object.values(reverse ? a : b))); v = await state();
    assert.equal(v.draft, false); assert.equal(v.count, 1); assert.equal(v.tool, 'crosshair'); assert.equal(v.handles, 4); await verify(v);
    if (!reverse) await capture(theme + '-complete');
  }
  // Vertical endpoint movement must leave the fitted channel unchanged.
  const before = await state();
  const handle = await js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="0"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await drag(handle, { x: handle.x, y: handle.y + 50 });
  assert.deepEqual((await state()).fit, before.fit);
  await drag(handle, { x: handle.x - 80, y: handle.y + 50 });
  let v = await state(); assert.notEqual(v.fit.count, before.fit.count); await verify(v);
  // Dragging the body shifts the interval by whole bars and recalculates it.
  const base = v.lines.find(l => l.part === 'base'), center = screen((base.x1 + base.x2) / 2, (base.y1 + base.y2) / 2);
  await drag(center, { x: center.x + 60, y: center.y + 30 });
  const shifted = await state(); assert.equal(shifted.fit.count, v.fit.count); assert.notEqual(shifted.fit.start, v.fit.start); await verify(shifted);
  // Settings are transactional; controls and color picker are usable.
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1))`); await settle();
  assert.equal(await js(`!!document.querySelector('dialog[open] [name="upperDeviation"]')`), true);
  await js(`document.querySelector('[name="upperDeviation"]').value='1';document.querySelector('[name="source"]').value='open';document.querySelector('[data-line-tab="style"]').click()`); await settle(); await capture('settings');
  await js(`document.querySelector('[name="upperColor"]').click()`); await settle();
  assert.equal(await js(`!!document.querySelector('.haolo-color-picker')`), true);
  await input('keyDown', { x: 0, y: 0 }, { keyCode: 'Escape' }); await input('keyUp', { x: 0, y: 0 }, { keyCode: 'Escape' });
  await js(`document.querySelector('dialog[open] form').requestSubmit()`); await settle();
  v = await state(); assert.equal(v.model.regression.upperDeviation, 1); assert.equal(v.model.regression.source, 'open'); await verify(v);
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="upperDeviation"]').value='4';document.querySelector('[data-line-cancel]').click()`); await settle();
  assert.equal((await state()).model.regression.upperDeviation, 1);
  const saved = (await state()).model;
  await win.reload(); await load(); v = await state(); assert.deepEqual(v.model.points, saved.points); assert.deepEqual(v.model.regression, saved.regression); await verify(v);
  // Realtime candle changes inside the selected interval invalidate the fit.
  const oldFit = v.fit;
  await js(`candles[${oldFit.end}].open+=10;d.redraw()`); await settle(); v = await state(); assert.notEqual(v.fit.slope, oldFit.slope);
  // Zoom preserves the stored anchors and recalculates all screen coordinates.
  await js(`d.getChart().timeScale().setVisibleLogicalRange({from:10,to:115});d.redraw()`); await settle();
  v = await state(); assert.deepEqual(v.model.points, saved.points); await verify(v); await capture('restored-zoomed');
  // Same-bar clicks do not finish; a later valid point can finish the draft.
  await js(`d.selectTool('regression-trend')`); await click(screen(500, 200)); await click(screen(500, 400));
  assert.equal((await state()).draft, true); assert.match((await state()).status, /两根/);
  await click(screen(800, 300)); assert.equal((await state()).draft, false);
  // Drag/release also completes the two-point tool.
  await js(`d.selectTool('regression-trend')`); await drag(screen(300, 200), screen(900, 450)); assert.equal((await state()).draft, false);
  assert.equal(await js('String(window.qaError??"")'), '');
  const report = { result: 'PASS', themes: 2, reversePlacement: true, preview: true, verticalDrag: true, rangeDrag: true, bodyDrag: true, settings: true, cancel: true, persistence: true, realtime: true, zoom: true, sameBarGuard: true, dragPlacement: true };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  win.destroy(); app.quit();
})().catch(async error => { console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack)); if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); win?.destroy(); app.exit(1); });
