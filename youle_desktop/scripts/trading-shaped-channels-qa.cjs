const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/shaped-channels-qa');
fs.mkdirSync(output, { recursive: true });
fs.rmSync(path.join(output, 'report.json'), { force: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(30); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, p, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  const click = async p => { await input('mouseMove', p); await input('mouseDown', p, { button: 'left', clickCount: 1 }); await input('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const drag = async (a, b) => {
    await input('mouseMove', a); await input('mouseDown', a, { button: 'left', clickCount: 1 });
    await input('mouseMove', b, { button: 'left', modifiers: ['leftButtonDown'] }); await input('mouseUp', b, { button: 'left', clickCount: 1 });
  };
  const load = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair')`); await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await load();
  const rect = await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
  const screen = p => ({ x: rect.x + p.x, y: rect.y + p.y });
  const state = () => js(`(()=>{
    const item=d.draft??d.drawings.at(-1),group=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]'),geometry=group?.querySelector('.trading-drawing-geometry');
    const points=e=>e?[...e.points].map(p=>({x:p.x,y:p.y})):null;
    return {draft:!!d.draft,confirmed:d.draftConfirmedPointCount,count:d.drawings.length,tool:d.activeTool,model:item,anchors:item?.points.slice(0,2),status:d.status.textContent,
      lines:[...(geometry?.querySelectorAll('line')??[])].map(l=>({x1:+l.getAttribute('x1'),y1:+l.getAttribute('y1'),x2:+l.getAttribute('x2'),y2:+l.getAttribute('y2'),dash:l.getAttribute('stroke-dasharray')})),
      polygon:points(geometry?.querySelector('polygon')),hit:points(group?.querySelector('.trading-drawing-hit-target.area')),
      prices:[...d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-price]')].map(e=>e.textContent),
      handles:[...(group?.querySelectorAll('[data-drawing-handle-index]')??[])].map(e=>({index:+e.dataset.drawingHandleIndex,x:+e.getAttribute('cx'),y:+e.getAttribute('cy')}))};
  })()`);
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .8, `${label}: ${actual} vs ${expected}`);
  const check = (value, tool, a, b, level) => {
    assert.equal(value.lines.length, 2, 'only the two boundaries, no parallel-channel midline');
    const expected = [a, b, { x: b.x, y: level }, { x: a.x, y: tool === 'flat-top-bottom' ? level : level + b.y - a.y }];
    value.polygon.forEach((p, i) => { near(p.x, expected[i].x, `corner ${i} x`); near(p.y, expected[i].y, `corner ${i} y`); });
    assert.ok(value.lines.every(l => !l.dash));
    if (!value.draft) assert.deepEqual(value.hit, value.polygon);
  };
  const reset = async (tool, theme = 'light') => {
    await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('${tool}');d.redraw()`); await settle();
  };
  let cases = 0;
  for (const tool of ['flat-top-bottom', 'disjoint-channel']) for (const theme of ['light', 'dark']) for (const reversed of [false, true]) for (const slope of [-1, 0, 1]) {
    await reset(tool, theme);
    const a = { x: reversed ? 700 : 180, y: 170 }, b = { x: reversed ? 180 : 700, y: 170 + slope * 70 };
    await click(screen(a)); await input('mouseMove', screen(b));
    let value = await state();
    assert.equal(value.lines.length, 1); assert.equal(value.polygon, null); assert.equal(value.confirmed, 1); assert.equal(value.count, 0);
    if (!reversed && slope === 1) await capture(`${tool}-${theme}-baseline`);
    await click(screen(b)); value = await state();
    assert.equal(value.confirmed, 2); assert.equal(value.draft, true); assert.equal(value.count, 0);
    const anchors = value.anchors;
    // Cross the first edge and move beyond both ends without changing it.
    for (const [x, y] of [[80, 80], [950, 320], [400, 200], [350, 300]]) {
      await input('mouseMove', screen({ x, y })); value = await state();
      assert.deepEqual(value.anchors, anchors); check(value, tool, a, b, y);
    }
    if (!reversed && slope === 1) await capture(`${tool}-${theme}-preview`);
    await click(screen({ x: 350, y: 300 })); value = await state();
    assert.equal(value.draft, false); assert.equal(value.count, 1); assert.equal(value.tool, 'crosshair');
    assert.equal(value.model.points.length, 3); assert.deepEqual(value.anchors, anchors); check(value, tool, a, b, 300);
    assert.equal(value.model.points[2].time, value.model.points[1].time);
    assert.equal(value.handles.length, 4);
    if (slope !== 0) assert.equal(value.prices.length, tool === 'flat-top-bottom' ? 3 : 4);
    if (!reversed && slope === 1) await capture(`${tool}-${theme}-complete`);
    cases++;
  }
  for (const tool of ['flat-top-bottom', 'disjoint-channel']) {
    await reset(tool);
    const a = { x: 180, y: 130 }, b = { x: 700, y: 210 };
    await drag(screen(a), screen(b)); assert.equal((await state()).confirmed, 2);
    await input('mouseMove', screen({ x: 400, y: 300 }));
    await input('mouseDown', screen({ x: 400, y: 300 }), { button: 'right', clickCount: 1 });
    await input('mouseUp', screen({ x: 400, y: 300 }), { button: 'right', clickCount: 1 });
    let value = await state(); assert.equal(value.confirmed, 1); assert.equal(value.lines.length, 1); assert.equal(value.polygon, null);
    await click(screen(b)); await click(screen({ x: 400, y: 300 })); value = await state(); check(value, tool, a, b, 300);
    // All four rendered handles are real drag targets; check constraint and
    // position from actual mouse events (including the derived fourth corner).
    for (const index of [0, 1, 3, 2]) {
      value = await state(); const before = value.model.points, h = value.handles.find(h => h.index === index);
      assert.ok(h, `handle ${index}`);
      await drag(screen(h), screen({ x: h.x + 30, y: h.y + 25 })); value = await state();
      const after = value.model.points, polygon = value.polygon;
      assert.notDeepEqual(after, before);
      near(polygon[0].x, polygon[3].x, 'shared start time'); near(polygon[1].x, polygon[2].x, 'shared end time');
      if (tool === 'flat-top-bottom') {
        near(polygon[3].y, polygon[2].y, 'flat edge');
        if (index >= 2) assert.deepEqual(after.slice(0,2).map(p=>p.price), before.slice(0,2).map(p=>p.price));
        else assert.equal(after[2].price, before[2].price);
      } else {
        near(polygon[1].y-polygon[0].y, -(polygon[2].y-polygon[3].y), 'opposite slopes');
        if (index === 2) assert.deepEqual(after.slice(0,2), before.slice(0,2));
        else near(after[1].price + after[2].price, before[1].price + before[2].price, 'preserved center price');
      }
      assert.deepEqual(value.hit, value.polygon);
    }
    await capture(tool + '-handles-adjusted');
    // Move via the interior, lock, restore, and zoom.
    value = await state(); const beforeMove = value.model.points;
    const center = value.polygon.reduce((p,c)=>({x:p.x+c.x/4,y:p.y+c.y/4}), {x:0,y:0});
    await drag(screen(center), screen({x:center.x+45,y:center.y+30})); value=await state();
    const dt=value.model.points[0].time-beforeMove[0].time, dp=value.model.points[0].price-beforeMove[0].price;
    assert.notEqual(dt,0); assert.notEqual(dp,0);
    value.model.points.forEach((p,i)=>{near(p.time-beforeMove[i].time,dt,'translation time');near(p.price-beforeMove[i].price,dp,'translation price');});
    await js('d.drawings.at(-1).locked=true;d.redraw()'); await settle();
    const locked=(await state()).model;
    await drag(screen({x:center.x+45,y:center.y+30}),screen({x:center.x+80,y:center.y+60})); assert.deepEqual((await state()).model,locked);
    await js('d.drawings.at(-1).locked=false;d.persistDrawings();d.redraw()'); await settle();
    const saved=(await state()).model;
    await win.reload(); await load(); value=await state();
    for(const key of Object.keys(saved)) assert.deepEqual(value.model[key],saved[key],'restored '+key);
    await js('d.selectDrawing(d.drawings.at(-1).id);const scale=d.getChart().timeScale(),range=scale.getVisibleLogicalRange();scale.setVisibleLogicalRange({from:range.from+10,to:range.to-10});d.redraw()'); await settle();
    value=await state(); assert.deepEqual(value.model.points,saved.points); assert.deepEqual(value.hit,value.polygon);
    await capture(tool+'-restored-zoomed');
    // On a logarithmic chart the derived corner must still retain its price;
    // reflecting screen pixels would move the saved boundary after a zoom.
    await js('d.getCandleSeries().priceScale().applyOptions({mode:1})'); await settle();
    // Chart scale layout (including its price-axis width) is asynchronous.
    await js('d.redraw()'); await settle();
    value=await state(); assert.deepEqual(value.model.points,saved.points); assert.deepEqual(value.hit,value.polygon);
    const projected = await js(`(()=>{const p=d.drawings.at(-1).points;return d.pointToScreen({time:p[0].time,price:p[2].price+('${tool}'==='disjoint-channel'?p[1].price-p[0].price:0)})})()`);
    near(value.polygon[3].x,projected.x,'log corner x'); near(value.polygon[3].y,projected.y,'log corner y');
    await js('d.getCandleSeries().priceScale().applyOptions({mode:0})'); await settle();
    await js('d.redraw()'); await settle();
    await js('d.undo();d.redraw()'); assert.equal((await state()).count,0);
    await js('d.redo();d.redraw()'); assert.equal((await state()).count,1);
    // Cancel an unfinished draft without storing it.
    await reset(tool); await click(screen(a));
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'}); await settle();
    assert.equal((await state()).draft,false); assert.equal((await state()).count,0);
    // A vertical baseline cannot define a time-spanning region.
    await reset(tool); await click(screen(a)); await click(screen({x:a.x,y:320})); assert.equal((await state()).confirmed,1);
    await click(screen({x:700,y:a.y})); await click(screen({x:400,y:a.y})); assert.equal((await state()).draft,true);
    await click(screen({x:400,y:400})); assert.equal((await state()).draft,false);
    // Old two-anchor records restore as an editable triangle at the old end
    // price; no invented fixed-width parallel channel survives the upgrade.
    await js(`d.drawings.at(-1).points=d.drawings.at(-1).points.slice(0,2);d.drawings.at(-1).points[0].price+=10;d.redraw()`); await settle();
    value=await state(); assert.equal(value.model.points.length,3); assert.equal(value.lines.length,2);
    assert.equal(value.model.points[2].price,value.model.points[1].price);
  }
  assert.equal(await js('String(window.qaError??"")'),'');
  const report={result:'PASS',visualCases:cases,tools:['flat-top-bottom','disjoint-channel'],baselinePreview:true,liveFill:true,threeClick:true,fourHandles:true,dragBaseline:true,undoDraft:true,cancel:true,move:true,lock:true,persistence:true,zoom:true,logScale:true,priceLabels:true,legacy:true};
  for (const name of ['failure.txt','failure.png']) fs.rmSync(path.join(output,name),{force:true});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  win.destroy(); app.quit();
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1);});
