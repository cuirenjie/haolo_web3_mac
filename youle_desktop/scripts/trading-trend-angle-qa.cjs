// Verify the real chart's drawing preview, native endpoint drags and persistence.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/trading-trend-angle-qa');
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
  await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.selectTool('crosshair');d.drawings=[];d.redraw()`); await settle();
  const setup = async (second = { x: 560, y: 375 }) => {
    await js(`d.selectDrawing(null);d.drawings=[{id:'angle',tool:'trend-angle',symbol:d.getSymbol(),interval:d.getInterval(),points:[{x:300,y:180},${JSON.stringify(second)}].map(p=>d.screenToDrawingPoint(p,false))}];d.selectDrawing('angle');d.redraw()`); await settle();
  };
  const state = () => js(`(()=>{
    const g=d.content.querySelector('[data-drawing-id="angle"]') || d.content.querySelector('[data-drawing-id]');
    const line=g.querySelector('.trading-drawing-geometry > line'), guide=g.querySelector('.trading-trend-angle-baseline'),arc=g.querySelector('.trading-trend-angle-arc'),text=g.querySelector('.trading-trend-angle-label');
    const handles=[...g.querySelectorAll('[data-drawing-handle-index]')];
    return {label:text.textContent,arc:arc?.getAttribute('d'),baseline:[+guide.getAttribute('x1'),+guide.getAttribute('y1'),+guide.getAttribute('x2'),+guide.getAttribute('y2')],
      line:[+line.getAttribute('x1'),+line.getAttribute('y1'),+line.getAttribute('x2'),+line.getAttribute('y2')],width:line.getAttribute('stroke-width'),color:line.getAttribute('stroke'),arrow:!!g.querySelector('[marker-end]'),
      handles:handles.map(e=>({stroke:getComputedStyle(e).stroke,visibility:getComputedStyle(e).visibility})),highlight:!!document.querySelector('.trading-trend-angle-axis-range')};
  })()`);
  const verify = async () => {
    const v = await state();
    assert.equal(v.arrow, false); assert.equal(v.width, '2'); assert.equal(v.color, '#2962ff');
    const [x1,y1,x2,y2]=v.line;
    const angle = Math.atan2(y1-y2,x2-x1)*180/Math.PI;
    assert.ok(Math.abs(parseFloat(v.label)-angle)<.006, JSON.stringify(v));
    assert.deepEqual(v.baseline.slice(0,2),[x1,y1]); assert.equal(v.baseline[3],y1);
    assert.ok(v.arc); assert.equal(v.handles.length,2);
    for(const h of v.handles){assert.equal(h.stroke,'rgb(41, 98, 255)');assert.equal(h.visibility,'visible');}
    return v;
  };
  for (const theme of ['light','dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme()`);
    for (const [name,second] of Object.entries({falling:{x:560,y:375},'left-falling':{x:220,y:390},rising:{x:560,y:60},'left-rising':{x:220,y:60}})) {
      await setup(second); const v = await verify(); assert.equal(v.highlight,true); await capture(`${theme}-${name}`);
    }
  }
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme()`); await setup();
  // Assert during mouseMove, before mouseUp: the annotation must update live.
  const drag = async (index, dx, dy) => {
    const before = await verify();
    const p = await js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="${index}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await pointer('mouseMove',p); await pointer('mouseDown',p,{button:'left',clickCount:1});
    const to={x:p.x+dx,y:p.y+dy};
    await pointer('mouseMove',to,{button:'left',modifiers:['leftButtonDown']});
    assert.equal(await js(`d.dragState?.mode`),'handle');
    const live=await verify();assert.notEqual(live.label,before.label);assert.notEqual(live.arc,before.arc);
    await capture(`dragging-${index}`);
    await pointer('mouseUp',to,{button:'left',clickCount:1});await verify();
    return live;
  };
  const left = await drag(1,-340,15);assert.ok(parseFloat(left.label)<-90);
  await drag(0,40,-35);
  await js(`d.overlay.classList.add('drawing-handles-idle')`);await verify();
  const beforeZoom=await verify();
  await js(`(()=>{const t=d.getChart().timeScale(),r=t.getVisibleLogicalRange();t.setVisibleLogicalRange({from:r.from+20,to:r.to-10});d.redraw()})()`);await settle();
  const zoomed=await verify();assert.notEqual(zoomed.label,beforeZoom.label);assert.notEqual(zoomed.arc,beforeZoom.arc);
  await js('d.persistDrawings()');const saved=await js('d.drawings[0]');
  await js(`d.selectDrawing(null);d.redraw()`);await settle();
  assert.equal(await js(`d.content.querySelectorAll('[data-trend-angle-handle]').length`),0);
  assert.equal(await js(`!!d.content.querySelector('.trading-trend-angle-label')`),true);
  assert.equal(await js(`!!document.querySelector('.trading-trend-angle-axis-range')`),false);
  await win.reload();for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
  const restored=await js('workspace.drawingController.drawings[0]');
  for(const key of Object.keys(saved))assert.deepEqual(restored[key],saved[key],'reload '+key);
  await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;d.drawings=[];d.selectTool('trend-angle')`);await settle();
  const origin=await js(`(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y}})()`);
  const start={x:origin.x+300,y:origin.y+180},end={x:origin.x+560,y:origin.y+375};
  await pointer('mouseDown',start,{button:'left',clickCount:1});await pointer('mouseUp',start,{button:'left',clickCount:1});
  await pointer('mouseMove',end);await verify();await capture('drawing-preview');
  await pointer('mouseDown',end,{button:'left',clickCount:1});await pointer('mouseUp',end,{button:'left',clickCount:1});await verify();
  await js(`Object.assign(d.drawings[0],{color:'#ff9800',lineWidth:4,lineStyle:'dashed'});d.redraw()`);await settle();
  assert.equal(await js(`d.content.querySelector('.trading-drawing-geometry > line').getAttribute('stroke-dasharray')`),'7 5');
  assert.equal(await js(`d.content.querySelector('.trading-trend-angle-label').getAttribute('fill')`),'#ff9800');
  assert.equal(await js(`getComputedStyle(d.content.querySelector('[data-trend-angle-handle]')).stroke`),'rgb(255, 152, 0)');
  assert.equal(await js('String(window.qaError??"")'),'');
  const report={result:'PASS',visualCases:8,liveBothEndpointDrags:true,leftwardAngle:true,zoom:true,idleHandles:true,persistence:true,drawingPreview:true,customStyle:true};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win.destroy();app.quit();
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1);});
