const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/parallel-channel-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(30); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, p, extra = {}) => {
    win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle();
  };
  const click = async p => { await input('mouseMove', p); await input('mouseDown', p, { button: 'left', clickCount: 1 }); await input('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const load = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair')`); await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await load();
  const rect = await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
  const screen = (x, y) => ({ x: rect.x + x, y: rect.y + y });
  const state = () => js(`(()=>{
    const item=d.draft??d.drawings.at(-1),group=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]');
    const geometry=group?.querySelector('.trading-drawing-geometry');
    const points=element=>element?[...element.points].map(p=>({x:p.x,y:p.y})):null;
    return {draft:!!d.draft,confirmed:d.draftConfirmedPointCount,count:d.drawings.length,tool:d.activeTool,
      model:item,anchors:item?.points.slice(0,2),status:d.status.textContent,
      lines:[...(geometry?.querySelectorAll('line')??[])].map(l=>({x1:+l.getAttribute('x1'),y1:+l.getAttribute('y1'),x2:+l.getAttribute('x2'),y2:+l.getAttribute('y2'),dash:l.getAttribute('stroke-dasharray')})),
      polygon:points(geometry?.querySelector('polygon')),hit:points(group?.querySelector('.trading-drawing-hit-target.area'))};
  })()`);
  // Native mouse events use integer device coordinates.
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .6, `${label}: ${actual} vs ${expected}`);
  const checkChannel = (value, a, b, offset) => {
    assert.equal(value.lines.length, 3);
    const expected = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x, y: b.y + offset }, { x: a.x, y: a.y + offset }];
    value.polygon.forEach((p, i) => { near(p.x, expected[i].x, 'corner x'); near(p.y, expected[i].y, 'corner y'); });
    near(value.lines[0].x1, a.x, 'baseline start'); near(value.lines[0].x2, b.x, 'baseline end');
    near(value.lines[2].y1, a.y + offset / 2, 'midline start'); near(value.lines[2].y2, b.y + offset / 2, 'midline end');
    assert.ok(value.lines[2].dash);
    if (!value.draft) assert.deepEqual(value.hit, value.polygon);
  };
  const reset = async theme => {
    await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('parallel-channel');d.redraw()`); await settle();
  };
  let cases = 0;
  for (const theme of ['light', 'dark']) for (const reversed of [false, true]) for (const direction of [-1, 1]) {
    await reset(theme);
    const a = reversed ? { x: 650, y: 150 } : { x: 180, y: 280 };
    const b = reversed ? { x: 180, y: 280 } : { x: 650, y: 150 };
    await click(screen(a.x, a.y)); await input('mouseMove', screen(b.x, b.y));
    let value = await state();
    assert.equal(value.lines.length, 1); assert.equal(value.polygon, null); assert.equal(value.confirmed, 1); assert.equal(value.count, 0);
    if (!reversed && direction === 1) await capture(theme + '-baseline');
    await click(screen(b.x, b.y));
    value = await state(); assert.equal(value.confirmed, 2); assert.equal(value.draft, true); assert.equal(value.count, 0);
    const anchors = value.anchors;
    // Different widths and pointer positions, including beyond the baseline.
    for (const [x, width] of [[400, 40], [800, 100], [300, 145]]) {
      const y = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) + direction * width;
      await input('mouseMove', screen(x, y)); value = await state();
      assert.deepEqual(value.anchors, anchors); checkChannel(value, a, b, direction * width);
    }
    if (!reversed) await capture(theme + (direction < 0 ? '-above-preview' : '-below-preview'));
    const x = 400, y = a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) + direction * 100;
    await click(screen(x, y)); value = await state();
    assert.equal(value.draft, false); assert.equal(value.count, 1); assert.equal(value.tool, 'crosshair');
    assert.equal(value.model.points.length, 3); assert.deepEqual(value.anchors, anchors); checkChannel(value, a, b, direction * 100);
    assert.equal(value.model.points[2].time, value.model.points[1].time, 'width handle retains the baseline end time');
    if (!reversed) await capture(theme + (direction < 0 ? '-above-complete' : '-below-complete'));
    cases++;
  }
  // Drag/release the baseline; reject a zero-width third click and undo back to a line.
  await reset('light');
  await input('mouseMove', screen(180, 280)); await input('mouseDown', screen(180, 280), { button: 'left', clickCount: 1 });
  await input('mouseMove', screen(650, 150), { button: 'left', modifiers: ['leftButtonDown'] });
  await input('mouseUp', screen(650, 150), { button: 'left', clickCount: 1 });
  assert.equal((await state()).confirmed, 2);
  await click(screen(415, 215)); assert.equal((await state()).draft, true); assert.equal((await state()).count, 0);
  await input('mouseMove', screen(415, 330));
  await input('mouseDown', screen(415, 330), { button: 'right', clickCount: 1 }); await input('mouseUp', screen(415, 330), { button: 'right', clickCount: 1 });
  let value = await state(); assert.equal(value.confirmed, 1); assert.equal(value.lines.length, 1); assert.equal(value.polygon, null);
  await click(screen(650, 150)); await click(screen(415, 315));
  value = await state(); assert.equal(value.draft, false); checkChannel(value, { x: 180, y: 280 }, { x: 650, y: 150 }, 100);
  // The width handle follows the opposite endpoint and adjusts only width.
  const anchors = value.anchors;
  const handle = await js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="2"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await input('mouseMove', handle); await input('mouseDown', handle, { button: 'left', clickCount: 1 });
  const moved = { x: handle.x, y: handle.y + 35 };
  await input('mouseMove', moved, { button: 'left', modifiers: ['leftButtonDown'] }); await input('mouseUp', moved, { button: 'left', clickCount: 1 });
  value = await state(); assert.deepEqual(value.anchors, anchors); checkChannel(value, { x: 180, y: 280 }, { x: 650, y: 150 }, 135);
  await capture('width-handle-dragged');
  const saved = value.model;
  await win.reload(); await load(); value = await state();
  for (const key of Object.keys(saved)) assert.deepEqual(value.model[key], saved[key], 'saved ' + key);
  assert.equal(value.lines.length, 3); assert.deepEqual(value.hit, value.polygon);
  // Zoom keeps the saved anchors and projects a parallel edge with equal x extents.
  await js(`(()=>{const t=d.getChart().timeScale(),r=t.getVisibleLogicalRange();t.setVisibleLogicalRange({from:r.from+10,to:r.to-10});d.redraw()})()`); await settle();
  value = await state(); assert.deepEqual(value.anchors, anchors);
  near(value.polygon[0].x, value.polygon[3].x, 'zoom left'); near(value.polygon[1].x, value.polygon[2].x, 'zoom right');
  near(value.polygon[2].y-value.polygon[1].y, value.polygon[3].y-value.polygon[0].y, 'zoom offset');
  await capture('restored-and-zoomed');
  assert.equal(await js('String(window.qaError??"")'), '');
  const report = { result: 'PASS', visualCases: cases, baselineOnly: true, fixedBaseline: true, bidirectionalWidth: true, dragBaseline: true, undo: true, widthHandle: true, persistence: true, zoom: true };
  fs.rmSync(path.join(output, 'failure.txt'), { force: true });
  fs.rmSync(path.join(output, 'failure.png'), { force: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  win.destroy(); app.quit();
})().catch(async error => { console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack)); if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); win?.destroy(); app.exit(1); });
