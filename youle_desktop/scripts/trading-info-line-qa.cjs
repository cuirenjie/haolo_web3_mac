// Exercise the actual chart renderer and native endpoint dragging in isolation.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/trading-info-line-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(50); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const pointer = async (type, p, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true);
  await js(`(async()=>{window.d=workspace.drawingController;window.info=await import('/trading-info-line.ts');window.language=await import('/app-language.mjs');workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.selectTool('crosshair')})()`); await settle();
  // Reference data, fractional-price symbols, zero span and reverse direction.
  const rows = await js(`info.tradingInfoLineRows({start:{time:0,price:2569.15},end:{time:61*86400,price:2099.22},first:{x:0,y:0},second:{x:460,y:290},bars:61,precision:2,minMove:.01})`);
  assert.equal(rows[0], '-469.93 (-18.29%), -46,993');
  assert.equal(rows[1], '61根K线 (61天), 距离: 544 px');
  assert.equal(rows[2], '-32.23°');
  const tiny = await js(`info.tradingInfoLineRows({start:{time:0,price:.000025},end:{time:60,price:.000026},first:{x:0,y:10},second:{x:10,y:0},bars:1,precision:6,minMove:.000001})`);
  assert.equal(tiny[0], '+0.000001 (+4.00%), +1');
  assert.equal(tiny[2], '45.00°');
  const zero = await js(`info.tradingInfoLineRows({start:{time:0,price:0},end:{time:0,price:0},first:{x:5,y:5},second:{x:5,y:5},bars:0,precision:2,minMove:.01})`);
  assert.deepEqual(zero, ['0.00 (0.00%), 0', '0根K线 (0秒), 距离: 0 px', '0.00°']);
  assert.equal(await js(`language.translateDrawingText('61根K线 (61d), 距离: 544 px', 'en')`), '61 bars (61d), Distance: 544 px');
  const setup = async (rising = false, reversed = false) => {
    await js(`d.selectDrawing(null);d.drawings=[{id:'info',tool:'info-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-105).time,price:${rising ? 1300 : 1345}},{time:workspace.candles.at(-35).time,price:${rising ? 1345 : 1300}}]${reversed ? '.reverse()' : ''}}];d.selectDrawing('info');d.redraw()`); await settle();
  };
  const state = () => js(`(()=>{
    const g=d.content.querySelector('[data-drawing-id="info"]'),card=g.querySelector('.trading-info-line-card'),rect=card.getBoundingClientRect(),overlay=d.overlay.getBoundingClientRect(),bounds=d.plotBounds();
    const handles=[...g.querySelectorAll('[data-drawing-handle-index]')],line=g.querySelector('.trading-drawing-geometry line');
    return {rows:[...card.querySelectorAll('text')].map(e=>e.textContent),arrow:!!g.querySelector('[marker-end]'),width:line.getAttribute('stroke-width'),color:line.getAttribute('stroke'),
      handles:handles.map(e=>({stroke:getComputedStyle(e).stroke,fill:getComputedStyle(e).fill,visibility:getComputedStyle(e).visibility})),
      card:{x:rect.x-overlay.x,y:rect.y-overlay.y,width:rect.width,height:rect.height},bounds,
      background:getComputedStyle(card.querySelector('rect')).fill,text:getComputedStyle(card).color,highlight:!!document.querySelector('.trading-info-line-axis-range')};
  })()`);
  const verify = async () => {
    const v = await state(); assert.equal(v.arrow, false); assert.equal(v.rows.length, 3); assert.equal(v.handles.length, 2);
    assert.equal(v.width, '2'); assert.equal(v.color, '#2962ff'); assert.equal(v.highlight, true);
    for (const handle of v.handles) { assert.equal(handle.stroke, 'rgb(41, 98, 255)'); assert.equal(handle.visibility, 'visible'); }
    assert.ok(v.card.x >= 0 && v.card.y >= 0 && v.card.x + v.card.width <= v.bounds.width + 1 && v.card.y + v.card.height <= v.bounds.height + 1);
    return v;
  };
  let cases = 0;
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme()`);
    for (const rising of [false, true]) for (const reversed of [false, true]) {
      await setup(rising, reversed); const v = await verify();
      assert.equal(v.background, theme === 'light' ? 'rgb(240, 240, 240)' : 'rgb(42, 46, 57)');
      assert.equal(v.text, theme === 'light' ? 'rgb(19, 23, 34)' : 'rgb(209, 212, 220)');
      if (!reversed) await capture(`${theme}-${rising ? 'rising' : 'falling'}`);
      cases++;
    }
  }
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme()`); await setup();
  const before = await verify();
  const endpoint = await js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="1"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await pointer('mouseMove', endpoint); await pointer('mouseDown', endpoint, { button: 'left', clickCount: 1 });
  const moved = { x: endpoint.x + 50, y: endpoint.y - 80 };
  await pointer('mouseMove', moved, { button: 'left', modifiers: ['leftButtonDown'] }); await pointer('mouseUp', moved, { button: 'left', clickCount: 1 });
  const dragged = await verify(); assert.notDeepEqual(dragged.rows, before.rows); await capture('endpoint-dragged');
  await js(`d.overlay.classList.add('drawing-handles-idle')`); await verify();
  await js(`(()=>{const t=d.getChart().timeScale(),r=t.getVisibleLogicalRange();t.setVisibleLogicalRange({from:r.from+25,to:r.to-10});d.redraw()})()`); await settle();
  const zoomed = await verify(); assert.equal(zoomed.rows[0], dragged.rows[0]); assert.notEqual(zoomed.rows[1], dragged.rows[1]); await capture('zoomed');
  // Keep the card inside a narrow pane and retain user styling and saved anchors.
  await js(`document.querySelector('#host').style.width='600px'`); await pause(300); await settle(); await verify(); await capture('narrow');
  await js(`Object.assign(d.drawings[0],{color:'#ff9800',lineWidth:4,lineStyle:'dashed'});d.redraw();d.persistDrawings()`); await settle();
  assert.equal(await js(`d.content.querySelector('.trading-drawing-geometry line').getAttribute('stroke-dasharray')`), '7 5');
  assert.equal(await js(`d.content.querySelector('.trading-drawing-geometry line').getAttribute('marker-end')`), null);
  const saved = await js('d.drawings[0]');
  await js(`d.selectDrawing(null);d.redraw()`); await settle();
  assert.equal(await js(`d.content.querySelectorAll('[data-info-line-handle]').length`), 0);
  assert.equal(await js(`!!d.content.querySelector('.trading-info-line-card')`), true);
  assert.equal(await js(`!!document.querySelector('.trading-info-line-axis-range')`), false);
  await win.reload(); for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
  const restored = await js('workspace.drawingController.drawings[0]');
  for (const key of Object.keys(saved)) assert.deepEqual(restored[key], saved[key], 'reload ' + key);
  assert.equal(await js('String(window.qaError??"")'), '');
  const report = { result: 'PASS', visualCases: cases, referenceMetrics: true, tinyPrices: true, nativeEndpointDrag: true, zoom: true, narrowPane: true, persistence: true };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  win.destroy(); app.quit();
})().catch(async error => { console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack)); if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); win?.destroy(); app.exit(1); });
