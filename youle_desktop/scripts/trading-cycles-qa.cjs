const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/cycles-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile-' + Date.now())); app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const near = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1, `${msg}: ${a} vs ${b}`);
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch(error) { throw new Error(error.message + '\n' + code); } };
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(25); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, p = { x: 0, y: 0 }, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  const click = async p => { await input('mouseMove', p); await input('mouseDown', p, { button: 'left', clickCount: 1 }); await input('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const drag = async (a, b) => { await input('mouseMove', a); await input('mouseDown', a, { button: 'left', clickCount: 1 }); await input('mouseMove', b, { button: 'left', modifiers: ['leftButtonDown'] }); await input('mouseUp', b, { button: 'left', clickCount: 1 }); };
  const key = async keyCode => { await input('keyDown', undefined, { keyCode }); await input('keyUp', undefined, { keyCode }); };
  const load = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');d.redraw()`); await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5198}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await load();
  const rect = await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
  const screen = p => ({ x: rect.x + p.x, y: rect.y + p.y });
  const state = () => js(`(()=>{const item=d.draft??d.drawings.at(-1),g=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]');return {draft:!!d.draft,count:d.drawings.length,model:item,bounds:d.plotBounds(),points:item?.points.map((p,i)=>d.drawingPointToScreen(item,i,d.plotBounds())),svg:g?.innerHTML??'',handles:g?.querySelectorAll('[data-cycle-handle]').length??0,lines:[...(g?.querySelectorAll('[data-cycle-line]')??[])].map(n=>Number(n.getAttribute('x1'))),arcs:[...(g?.querySelectorAll('[data-cycle-arc]')??[])].map(n=>n.getAttribute('d')),sine:g?.querySelector('[data-cycle-sine]')?.getAttribute('d'),fills:[...(g?.querySelectorAll('[data-cycle-fill]')??[])].map(n=>n.getAttribute('fill')),priceMarkers:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-price]').length,timeMarkers:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-time]').length,toolbar:!d.selectionToolbar.hidden}})()`);
  const verify = (tool, v) => {
    assert.doesNotMatch(v.svg, /NaN|Infinity/);
    const [a,b] = v.points, period = Math.abs(b.x-a.x);
    if (tool === 'cyclic-lines') {
      assert.ok(v.lines.length > 2); near(v.lines[0], Math.min(a.x,b.x));
      for (let i=1;i<v.lines.length;i++) near(v.lines[i]-v.lines[i-1], period);
      assert.doesNotMatch(v.svg, /<text/);
    } else if (tool === 'time-cycles') {
      near(a.y,b.y); assert.equal(v.model.points[0].price,v.model.points[1].price);
      assert.ok(v.arcs.length>2); assert.equal(v.arcs.length,v.fills.length);
      const match = /A([\d.e+-]+),([\d.e+-]+)/.exec(v.arcs[0]); near(Number(match[1]),period/2);near(Number(match[2]),period/2);
    } else {
      assert.ok(v.sine); const samples=[...v.sine.matchAll(/[ML]([\d.e+-]+),([\d.e+-]+)/g)].map(m=>({x:Number(m[1]),y:Number(m[2])}));
      near(Math.min(...samples.map(p=>p.y)),Math.min(a.y,b.y)); near(Math.max(...samples.map(p=>p.y)),Math.max(a.y,b.y));
      for (const p of [a,b]) assert.ok(samples.some(s=>Math.abs(s.x-p.x)<.01&&Math.abs(s.y-p.y)<.01),'anchor is an exact extremum');
    }
  };
  const reports=[];
  for (const tool of ['cyclic-lines','time-cycles','sine-line']) {
    for (const theme of ['light','dark']) {
      console.log(`${tool}: ${theme} placement and drag`);
      await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('${tool}');d.redraw()`);await settle();
      const a={x:220,y:280},b={x:420,y:tool==='cyclic-lines'?340:160};
      await click(screen(a)); await input('mouseMove',screen(b));let v=await state();
      assert.equal(v.draft,true);assert.equal(v.count,0);assert.equal(v.handles,tool==='cyclic-lines'?2:1);verify(tool,v);
      assert.equal(v.priceMarkers,tool==='time-cycles'?1:2);assert.equal(v.timeMarkers,2);
      await capture(tool+'-'+theme+'-preview');await click(screen(b));v=await state();verify(tool,v);
      assert.equal(v.draft,false);assert.equal(v.count,1);assert.equal(v.handles,2);assert.equal(v.toolbar,true);
      assert.equal(await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="pattern-fill"]').hidden`),tool!=='time-cycles');
      await capture(tool+'-'+theme+'-selected');
      for (let i=0;i<2;i++) {
        const before=await state(),p=screen(before.points[i]);await drag(p,{x:p.x+25,y:p.y+12});v=await state();verify(tool,v);
        assert.notDeepEqual(v.model.points[i],before.model.points[i]);
        if(tool==='time-cycles') assert.equal(v.model.points[1-i].time,before.model.points[1-i].time);
        else assert.deepEqual(v.model.points[1-i],before.model.points[1-i]);
      }
      // Grab repeated geometry outside the two defining anchors.
      v=await state();let p;
      if(tool==='cyclic-lines')p={x:v.lines[2],y:350};
      else if(tool==='time-cycles')p={x:v.points[1].x+(v.points[1].x-v.points[0].x)/2,y:v.points[0].y-Math.abs(v.points[1].x-v.points[0].x)/2};
      else p={x:v.points[1].x+(v.points[1].x-v.points[0].x)/2,y:(v.points[0].y+v.points[1].y)/2};
      const before=v.points;await drag(screen(p),screen({x:p.x+25,y:p.y-15}));v=await state();verify(tool,v);
      assert.notDeepEqual(v.points,before,'repeated geometry can move the drawing');
      near(v.points[1].x-v.points[0].x,before[1].x-before[0].x);near(v.points[1].y-v.points[0].y,before[1].y-before[0].y);
      await js(`d.overlay.classList.add('drawing-handles-idle')`);assert.equal(await js(`getComputedStyle(d.content.querySelector('[data-cycle-handle]')).visibility`),'visible');
      await js('d.selectDrawing(null)');await settle();v=await state();assert.equal(v.handles,0);assert.equal(v.priceMarkers,0);assert.doesNotMatch(v.svg,/data-cycle-guide/);verify(tool,v);
      await capture(tool+'-'+theme+'-deselected');await click(screen(v.points[0]));assert.equal((await state()).handles,2);
    }
    console.log(`${tool}: settings, persistence, logarithmic drag and zoom`);
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="color"]').value='#e91e63';document.querySelector('[name="lineWidth"]').value='3';document.querySelector('[name="lineStyle"]').value='dashed';document.querySelector('[name="patternFill"]')?.setAttribute('value','#673ab780');document.querySelector('[data-line-tab="coordinates"]').click();const endpoint=document.querySelector('[name="coordinatePoint"]');endpoint.value='1';endpoint.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[name="price"]').value=String(Number(document.querySelector('[name="price"]').value)+1);document.querySelector('dialog[open] form').requestSubmit()`);await settle();
    let v=await state();verify(tool,v);assert.equal(v.model.color,'#e91e63');assert.match(v.svg,/stroke-width="3" stroke-dasharray="7 5"/);const saved=v.model;
    if(tool==='time-cycles')assert.ok(v.fills.every(fill=>fill==='#673ab780'));
    // Invalid coordinate edits stay in the dialog and do not erase the shape.
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[data-line-tab="coordinates"]').click();const firstTime=document.querySelector('[name="time"]').value;const select=document.querySelector('[name="coordinatePoint"]');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[name="time"]').value=firstTime;document.querySelector('dialog[open] form').requestSubmit()`);await settle();
    assert.equal(await js('Boolean(document.querySelector("dialog[open]"))'),true);assert.deepEqual((await state()).model.points,saved.points);await key('Escape');
    await win.reload();await load();v=await state();verify(tool,v);
    for(const field of ['id','tool','points','color','lineWidth','lineStyle','textBackgroundColor'])assert.deepEqual(v.model[field],saved[field],field);
    await js(`d.selectDrawing(d.drawings.at(-1).id);workspace.chartNavigation.setMode(1);d.redraw()`);await settle();v=await state();
    let p=tool==='cyclic-lines'?{x:v.lines[0],y:350}:v.points[0];
    // A cycle line, an arc quarter-point, or sine midpoint moves the body.
    if(tool==='time-cycles'){const r=Math.abs(v.points[1].x-v.points[0].x)/2;p={x:(v.points[0].x+v.points[1].x)/2,y:v.points[0].y-r};}
    if(tool==='sine-line')p={x:(v.points[0].x+v.points[1].x)/2,y:(v.points[0].y+v.points[1].y)/2};
    const before=v.points;await drag(screen(p),screen({x:p.x+20,y:p.y-17}));v=await state();verify(tool,v);
    near(v.points[1].y-v.points[0].y,before[1].y-before[0].y,'log drag keeps shape');near(v.points[1].x-v.points[0].x,before[1].x-before[0].x);
    const savedPoints=v.model.points;
    await js(`const range=d.getChart().timeScale().getVisibleLogicalRange();d.getChart().timeScale().setVisibleLogicalRange({from:range.from+15,to:range.to-15});d.redraw()`);await settle();v=await state();verify(tool,v);assert.deepEqual(v.model.points,savedPoints);await capture(tool+'-zoom-log');
    await js('workspace.chartNavigation.setMode(0)');await settle();
    await js(`d.selectTool('${tool}')`);await click(screen({x:300,y:200}));await click(screen({x:300,y:400}));assert.equal((await state()).draft,true,'vertical-only second click cannot complete');await key('Escape');assert.equal((await state()).count,1);
    await js(`d.selectTool('crosshair');d.selectDrawing(d.drawings[0].id);d.drawings[0].locked=true;d.redraw()`);await settle();v=await state();const locked=v.model.points;p=screen(v.points[0]);await drag(p,{x:p.x+25,y:p.y+25});assert.deepEqual((await state()).model.points,locked);
    await js(`d.drawings[0].locked=false;d.selectTool('eraser')`);await settle();v=await state();
    if(tool==='cyclic-lines')p={x:v.lines[2],y:350};
    else if(tool==='time-cycles')p={x:v.points[1].x+(v.points[1].x-v.points[0].x)/2,y:v.points[0].y-Math.abs(v.points[1].x-v.points[0].x)/2};
    else p={x:v.points[1].x+(v.points[1].x-v.points[0].x)/2,y:(v.points[0].y+v.points[1].y)/2};
    await click(screen(p));assert.equal((await state()).count,0,'eraser hits the repeated part');
    await js(`d.selectTool('crosshair');d.toolbar.querySelector('[data-drawing-action="redo"]').click();d.selectDrawing(d.drawings[0].id);d.redraw()`);await settle();assert.equal((await state()).count,1);
    await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="delete"]').click()`);await settle();assert.equal((await state()).count,0);
    assert.equal(await js('String(window.qaError??"")'),'');
    reports.push({tool,result:'PASS',themes:2,preview:true,handles:true,repeatedGeometryDrag:true,settings:true,reload:true,logDrag:true,zoom:true,zeroIntervalRejected:true,escape:true,lock:true,eraser:true,redo:true,delete:true});
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));win.destroy();app.quit();
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1);});
