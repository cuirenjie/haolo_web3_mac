// Synthetic candles and an isolated offscreen Electron profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/fibonacci-style-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 1050, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); await pause(30); };
  const pointer = async (type, p, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  const click = async p => { await pointer('mouseMove', p); await pointer('mouseDown', p, { button: 'left', clickCount: 1 }); await pointer('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const capture = async name => {
    const rect = await js(`(() => { const r=document.querySelector('.trading-expert-market').getBoundingClientRect(); return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)} })()`);
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage(rect)).toPNG());
  };
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`window.d = workspace.drawingController; workspace.loadingHistory = true; document.querySelector('#host').style.cssText = 'width:100%;height:100%'`);
    await settle();
  };
  const verify = () => js(`(() => {
    const points = d.drawings[0].points.map(p => d.pointToScreen(p));
    const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
    const lines = [...d.content.querySelectorAll('.trading-fibonacci-level-line')];
    const labels = [...d.content.querySelectorAll('.trading-fibonacci-label')];
    const bands = [...d.content.querySelectorAll('.trading-fibonacci-band')];
    const near = (a, b) => Math.abs(a-b) < .001;
    if (lines.length !== 11 || !lines.every(e => near(+e.getAttribute('x1'), left) && near(+e.getAttribute('x2'), right))) throw Error('line span');
    if (!labels.every(e => near(+e.getAttribute('x'), left - 8) && e.getAttribute('text-anchor') === 'end' && getComputedStyle(e).fontWeight === '400' && !e.textContent.includes('%'))) throw Error('labels');
    if (!bands.length || !bands.every(e => +e.getAttribute('width') >= 0 && +e.getAttribute('height') > 0 && e.getAttribute('fill-opacity') === '0.2' && getComputedStyle(e).pointerEvents === 'none')) throw Error('bands');
    const hits = [...d.content.querySelectorAll('.trading-drawing-hit-target')];
    if (!hits.every(e => near(+e.getAttribute('x1'), points[0].x) && near(+e.getAttribute('x2'), points[1].x))) throw Error('hit span');
    return { left, right, labels: labels.map(e => e.textContent), bands: bands.map(e => ({ ratio: e.dataset.fibonacciBand, color: e.getAttribute('fill') })) };
  })()`);
  await load();
  await js(`d.drawings=[]; d.drawingStyles.clear(); d.selectDrawing(null); d.selectTool('fib-retracement')`);
  const b = await js(`(() => { const r=d.overlay.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()`);
  await click({ x: b.x + 270, y: b.y + b.height * .39 });
  assert.equal(await js(`d.content.querySelectorAll('.trading-fibonacci-band').length`), 0, 'first click has no collapsed bands');
  await click({ x: b.x + b.width - 200, y: b.y + b.height - 50 });
  assert.equal(await js('d.drawings.length'), 1, 'native two-click creation');
  await js(`d.selectTool('crosshair'); window.basePoints=structuredClone(d.drawings[0].points); d.selectDrawing(null); d.redraw()`);
  const cases = [];
  for (const theme of ['light', 'dark']) for (const reverseTime of [false, true]) for (const reversePrice of [false, true]) {
    await js(`document.documentElement.dataset.theme='${theme}'; workspace.applyChartTheme(); d.drawings[0].points=basePoints.map((p,i)=>({time:basePoints[${reverseTime ? '1-i' : 'i'}].time,price:basePoints[${reversePrice ? '1-i' : 'i'}].price})); d.redraw()`);
    await settle(); cases.push({ theme, reverseTime, reversePrice, ...await verify() });
    if (!reverseTime && !reversePrice) { await pointer('mouseMove', { x: 20, y: 20 }); await capture(theme); }
  }
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme();d.drawings[0].points=basePoints;d.selectDrawing(d.drawings[0].id);d.redraw()`); await settle();
  const endpoint = await js(`(() => { const r=d.content.querySelector('[data-drawing-handle-index="1"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`);
  const old = await js('JSON.stringify(d.drawings[0].points)');
  await pointer('mouseMove', endpoint); await pointer('mouseDown', endpoint, { button: 'left', clickCount: 1 });
  await pointer('mouseMove', { x: endpoint.x - 90, y: endpoint.y - 70 }, { button: 'left', modifiers: ['leftButtonDown'] });
  await pointer('mouseUp', { x: endpoint.x - 90, y: endpoint.y - 70 }, { button: 'left', clickCount: 1 });
  assert.notEqual(await js('JSON.stringify(d.drawings[0].points)'), old); await verify();
  await js(`d.selectDrawing(null);const r=d.getChart().timeScale().getVisibleLogicalRange();d.getChart().timeScale().setVisibleLogicalRange({from:r.from+15,to:r.to-15});d.redraw()`); await settle(); await verify();
  await js(`d.selectDrawing(d.drawings[0].id); d.selectionToolbar.querySelector('[data-drawing-color="#ff9800"]').click();d.selectionToolbar.querySelector('[data-drawing-width="4"]').click();d.selectionToolbar.querySelector('[data-drawing-style="dashed"]').click();d.persistDrawings()`); await settle();
  await load(); await verify();
  assert.deepEqual(await js(`({color:d.drawings[0].color,width:d.drawings[0].lineWidth,style:d.drawings[0].lineStyle})`), { color: '#ff9800', width: 4, style: 'dashed' });
  assert.equal(await js(`[...d.content.querySelectorAll('.trading-fibonacci-band')].every(e => e.getAttribute('fill') === '#ff9800')`), true);
  await js(`d.selectDrawing(d.drawings[0].id);d.selectionToolbar.querySelector('[data-drawing-selection-action="reset"]').click();d.selectDrawing(null);d.redraw()`); await settle(); await verify();
  assert.equal(await js(`d.content.querySelector('[data-fibonacci-band="0.236"]').getAttribute('fill')`), '#f23645');
  assert.equal(await js('String(window.qaError ?? "")'), '');
  const report = { result: 'PASS', cases, nativeCreation: true, nativeEndpointDrag: true, zoom: true, persistenceAndReset: true };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS: 8 theme/direction cases, native creation/drag, zoom, persistence and reset');
  win.destroy(); app.quit();
})().catch(async error => {
  console.error(error);
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  win?.destroy(); app.exit(1);
});
