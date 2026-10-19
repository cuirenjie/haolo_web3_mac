const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/pitchfork-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, label = '') => assert.ok(Math.abs(a - b) < .7, `${label}: ${a} vs ${b}`);
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(30); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, p, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  const click = async p => { await input('mouseMove', p); await input('mouseDown', p, { button: 'left', clickCount: 1 }); await input('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const drag = async (a, b) => { await input('mouseMove', a); await input('mouseDown', a, { button: 'left', clickCount: 1 }); await input('mouseMove', b, { button: 'left', modifiers: ['leftButtonDown'] }); await input('mouseUp', b, { button: 'left', clickCount: 1 }); };
  const load = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');d.redraw()`); await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5194}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await load();
  const rect = await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
  const screen = p => ({ x: rect.x + p.x, y: rect.y + p.y });
  const state = () => js(`(()=>{const item=d.draft??d.drawings.at(-1),g=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]');return {draft:!!d.draft,count:d.drawings.length,model:item,confirmed:d.draftConfirmedPointCount,bounds:d.plotBounds(),
    points:item?.points.map(p=>d.pointToScreen(p)),
    lines:[...(g?.querySelectorAll('[data-pitchfork-line]')??[])].map(l=>({part:l.dataset.pitchforkLine,color:l.getAttribute('stroke'),x1:+l.getAttribute('x1'),y1:+l.getAttribute('y1'),x2:+l.getAttribute('x2'),y2:+l.getAttribute('y2')})),
    fills:g?.querySelectorAll('[data-pitchfork-fill]').length??0,handles:g?.querySelectorAll('[data-pitchfork-handle]').length??0,tool:d.activeTool,status:d.status.textContent}})()`);
  const verify = v => {
    assert.equal(v.fills, 3); assert.equal(v.points.length, 3);
    const [a, b, c] = v.points, tool = v.model.tool, m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    const origin = tool === 'pitchfork' ? a : { x: tool === 'schiff-pitchfork' ? a.x : (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const target = tool === 'inside-pitchfork' ? c : m, slope = { x: target.x - origin.x, y: target.y - origin.y };
    const median = v.lines.find(l => l.part === 'median'), start = tool === 'inside-pitchfork' ? m : origin;
    near(median.x1, start.x, 'median origin x'); near(median.y1, start.y, 'median origin y');
    assert.equal(median.color, '#f23645');
    for (const part of ['median', 'outer-b', 'inner-b', 'inner-c', 'outer-c']) {
      const l = v.lines.find(l => l.part === part); assert.ok(l, part);
      near(((l.x2 - l.x1) * slope.y - (l.y2 - l.y1) * slope.x) / Math.hypot(slope.x, slope.y), 0, part + ' parallel');
      assert.ok(Math.min(Math.abs(l.x2), Math.abs(l.x2 - v.bounds.width), Math.abs(l.y2), Math.abs(l.y2 - v.bounds.height)) < .7, part + ' reaches plot edge');
    }
    for (const [part, p] of [['outer-b', b], ['outer-c', c]]) { const l = v.lines.find(l => l.part === part); near(l.x1, p.x); near(l.y1, p.y); assert.equal(l.color, '#2962ff'); }
    assert.equal(v.lines.filter(l => l.color === '#089981').length, 2);
  };
  const tools = ['pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'];
  for (const theme of ['light', 'dark']) for (const tool of tools) {
    await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('${tool}');d.redraw()`); await settle();
    const a = { x: 300, y: 130 }, b = { x: 760, y: 250 }, c = { x: 580, y: 350 };
    await click(screen(a)); await input('mouseMove', screen(b));
    let v = await state(); assert.equal(v.draft, true); assert.equal(v.confirmed, 1); assert.equal(v.lines.length, 1); assert.equal(v.fills, 0);
    if (theme === 'light') await capture(tool + '-first-leg');
    await click(screen(b)); v = await state(); assert.equal(v.draft, true); assert.equal(v.confirmed, 2); assert.equal(v.count, 0); assert.equal(v.fills, 0); assert.ok(v.lines.some(l => l.part === 'preview-ray'));
    if (theme === 'light') await capture(tool + '-second-point');
    await input('mouseMove', screen(c)); v = await state(); verify(v); assert.equal(v.count, 0);
    await click(screen(c)); v = await state(); verify(v); assert.equal(v.draft, false); assert.equal(v.count, 1); assert.equal(v.handles, 3); assert.equal(v.tool, 'crosshair');
    await capture(tool + '-' + theme + '-complete');
    // Each real handle moves independently; no projected channel-width handle.
    for (const index of [0, 1, 2]) {
      const before = await state(), p = screen(before.points[index]);
      await drag(p, { x: p.x - 17, y: p.y + 13 }); v = await state(); verify(v);
      for (const other of [0, 1, 2].filter(n => n !== index)) assert.deepEqual(v.model.points[other], before.model.points[other]);
      assert.notDeepEqual(v.model.points[index], before.model.points[index]);
    }
    // The visible crossbar and shaded channel both belong to the same drawing.
    v = await state(); const center = screen({ x: (v.points[1].x + v.points[2].x) / 2, y: (v.points[1].y + v.points[2].y) / 2 });
    const before = v.model.points;
    await drag(center, { x: center.x + 28, y: center.y - 20 }); v = await state(); verify(v);
    for (let i = 0; i < 3; i++) { assert.notDeepEqual(v.model.points[i], before[i]); near(v.model.points[i].time - before[i].time, v.model.points[0].time - before[0].time); near(v.model.points[i].price - before[i].price, v.model.points[0].price - before[0].price); }
    // Coordinate dialog includes the third point and must preserve multicolor defaults.
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[data-line-tab="coordinates"]').click()`); await settle();
    assert.equal(await js(`document.querySelectorAll('dialog[open] [name="coordinatePoint"] option').length`), 3);
    await js(`(()=>{const select=document.querySelector('[name="coordinatePoint"]');select.value='2';select.dispatchEvent(new Event('change',{bubbles:true}));const price=document.querySelector('[name="price"]');price.value=String(Number(price.value)+.5);document.querySelector('dialog[open] form').requestSubmit()})()`); await settle(); verify(await state());
  }
  // Stored anchor values survive reopening, zoom, and logarithmic price projection.
  let v = await state(); const saved = v.model;
  await win.reload(); await load(); v = await state(); assert.deepEqual(v.model.points, saved.points); verify(v);
  await js(`d.getChart().timeScale().setVisibleLogicalRange({from:350,to:520});d.redraw()`); await settle(); v = await state(); assert.deepEqual(v.model.points, saved.points); verify(v);
  await js(`workspace.chartNavigation.setMode(1)`); await settle(); v = await state(); verify(v); await capture('inside-restored-log-scale');
  await js(`workspace.chartNavigation.setMode(0)`); await settle();
  // Eraser must find a ray far beyond the three anchor points.
  v = await state(); const ray = v.lines.find(l=>l.part==='outer-b');
  await js(`d.selectTool('eraser')`); await click(screen({x:ray.x1+(ray.x2-ray.x1)*.75,y:ray.y1+(ray.y2-ray.y1)*.75})); assert.equal((await state()).count, 0);
  await js('d.undo();d.redo()'); // No crash when deletion history is empty/consumed.
  // Right click unwinds only B; Escape cancels the uncommitted fork.
  for (const tool of tools) {
    await js(`d.selectTool('${tool}')`); await click(screen({x:350,y:130})); await click(screen({x:800,y:250})); await input('mouseMove', screen({x:620,y:350}));
    await input('mouseDown', screen({x:620,y:350}), {button:'right',clickCount:1}); await input('mouseUp', screen({x:620,y:350}), {button:'right',clickCount:1});
    v = await state(); assert.equal(v.draft, true); assert.equal(v.confirmed, 1); assert.equal(v.fills, 0);
    await input('keyDown', {x:0,y:0}, {keyCode:'Escape'}); await input('keyUp', {x:0,y:0}, {keyCode:'Escape'}); assert.equal((await state()).draft, false);
    await js(`d.selectTool('${tool}')`); await drag(screen({x:300,y:130}), screen({x:760,y:250}));
    v = await state(); assert.equal(v.draft, true); assert.equal(v.confirmed, 2);
    await click(screen({x:580,y:350})); assert.equal((await state()).draft, false); verify(await state());
    await js(`d.selectTool('crosshair');d.drawings=[];d.redraw()`);
  }
  assert.equal(await js('String(window.qaError??"")'), '');
  const report = {result:'PASS',tools,themes:['light','dark'],threeStagePreview:true,threeIndependentHandles:true,bodyDrag:true,threeCoordinates:true,persistence:true,zoom:true,logScale:true,rayEraser:true,rightClickRewind:true,escapeCancel:true,dragPlacement:true};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win.destroy();app.quit();
})().catch(async error => { console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1); });
