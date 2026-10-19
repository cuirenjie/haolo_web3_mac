const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.cache/prediction-tools-qa');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms));let win;
(async()=>{
 await app.whenReady();win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),settle=async()=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(40);};
 const capture=async name=>fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());
 const input=async(type,p={x:0,y:0},extra={})=>{win.webContents.sendInputEvent({type,x:Math.round(p.x),y:Math.round(p.y),...extra});await settle();};
 const click=async p=>{await input('mouseMove',p);await input('mouseDown',p,{button:'left',clickCount:1});await input('mouseUp',p,{button:'left',clickCount:1});};
 const drag=async(a,b)=>{await input('mouseMove',a);await input('mouseDown',a,{button:'left',clickCount:1});await input('mouseMove',b,{button:'left',modifiers:['leftButtonDown']});await input('mouseUp',b,{button:'left',clickCount:1});};
 const key=async keyCode=>{await input('keyDown',undefined,{keyCode});await input('keyUp',undefined,{keyCode});};
 const load=async()=>{for(let i=0;i<120&&!await js('!!window.ready');i++)await pause(100);assert.ok(await js('!!window.ready'));await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');d.getChart().timeScale().setVisibleLogicalRange({from:410,to:540});d.redraw()`);await settle();};
 await win.loadURL(`http://127.0.0.1:5196/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);await load();
 let rect=await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');const screen=p=>({x:p.x+rect.x,y:p.y+rect.y});
 const state=()=>js(`(()=>{const m=d.draft??d.drawings.at(-1),g=m&&d.content.querySelector('[data-drawing-id="'+m.id+'"]');return {model:m,draft:!!d.draft,count:d.drawings.length,confirmed:d.draftConfirmedPointCount,points:m?.points.map((p,i)=>d.drawingPointToScreen(m,i,d.plotBounds())),handles:[...(g?.querySelectorAll('[data-position-handle]')??[])].map(e=>({i:+e.dataset.drawingHandleIndex,visible:getComputedStyle(e).visibility})),svg:g?.innerHTML??'',text:g?.textContent??'',prices:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-price]').length,times:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-time]').length,tool:d.activeTool}})()`);
 const reset=async(tool,theme='light')=>{await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('${tool}');d.redraw()`);await settle();};
 const reports=[];
 for(const theme of ['light','dark'])for(const tool of ['long-position','short-position','forecast','bars-pattern','sector','ghost-feed']){
  console.log(theme,tool);await reset(tool,theme);
  const anchors=tool==='sector'?[{x:250,y:280},{x:620,y:390},{x:620,y:160}]:tool==='ghost-feed'?[{x:260,y:350},{x:390,y:200},{x:520,y:320},{x:650,y:150},{x:780,y:260},{x:910,y:180}]:tool==='bars-pattern'?[{x:250,y:250},{x:650,y:330}]:[{x:310,y:300},{x:660,y:180}];
  await click(screen(anchors[0]));
  if(tool==='bars-pattern'){
    await input('mouseMove',screen({x:1200,y:200}));let s=await state();assert.equal(s.model.points[1].time,await js('d.getCandles().at(-1).time'));assert.equal((s.svg.match(/data-bars-boundary/g)||[]).length,2);assert.doesNotMatch(s.svg,/data-bars-stick/);await capture(theme+'-bars-preview');
  }
  for(let i=1;i<anchors.length;i++){await input('mouseMove',screen(anchors[i]));if(tool==='ghost-feed'){const s=await state();assert.equal(s.confirmed,i);assert.equal(s.handles.length,i);if(i===1)assert.doesNotMatch(s.svg,/data-ghost-candle/);if(i===3)await capture(theme+'-ghost-preview');}await click(screen(anchors[i]));}
  let s=await state();assert.equal(s.draft,false);assert.equal(s.count,1);assert.equal(s.tool,'crosshair');assert.doesNotMatch(s.svg,/NaN|Infinity/);
  const expected=tool.includes('position')?4:tool==='sector'?3:tool==='ghost-feed'?6:2;assert.equal(s.handles.length,expected);
  if(tool.includes('position')){assert.equal(s.prices,3);assert.equal(s.times,2);assert.equal((s.svg.match(/data-prediction-tag=/g)||[]).length,3);}
  if(tool==='bars-pattern'){assert.ok(s.model.barsPattern.bars.length>2);assert.equal((s.svg.match(/data-bars-stick/g)||[]).length,s.model.barsPattern.bars.length);assert.doesNotMatch(s.svg,/data-bars-boundary/);}
  if(tool==='forecast')assert.match(s.svg,/data-forecast-curve/);
  if(tool==='sector'){assert.match(s.svg,/fill="#9c6ade33"/);assert.equal(s.prices,3);}
  if(tool==='ghost-feed')assert.match(s.svg,/data-ghost-candle/);
  await capture(theme+'-'+tool);
  for(let i=0;i<expected;i++){
    const before=await state(),p=screen(before.points[i]);await drag(p,{x:p.x+14,y:p.y+9});s=await state();
    assert.notEqual(s.model.points[i].time,before.model.points[i].time,`${tool} handle ${i} time`);assert.notEqual(s.model.points[i].price,before.model.points[i].price,`${tool} handle ${i} price`);assert.doesNotMatch(s.svg,/NaN|Infinity/);
    if(tool.includes('position')){assert.equal(s.model.points[0].price,s.model.points[1].price);assert.equal(s.model.points[0].time,s.model.points[2].time);assert.equal(s.model.points[0].time,s.model.points[3].time);}
  }
  await js(`d.overlay.classList.add('drawing-handles-idle')`);assert.ok((await state()).handles.every(h=>h.visible==='visible'));
  // Use an actual filled body / curve / copied wick as the body hit target.
  const body=await js(`(()=>{const g=d.content.querySelector('[data-drawing-id="'+d.drawings.at(-1).id+'"]');const e=g.querySelector('.trading-drawing-hit-target');if(e?.tagName==='path'){const p=e.getPointAtLength(e.getTotalLength()*.45);return {x:p.x,y:p.y}}if(e?.tagName==='line')return {x:(+e.getAttribute('x1') + +e.getAttribute('x2'))/2,y:(+e.getAttribute('y1') + +e.getAttribute('y2'))/2};return {x:+e.getAttribute('x')+ +e.getAttribute('width')*.7,y:+e.getAttribute('y')+ +e.getAttribute('height')*.35}})()`);
  const before=await state(),p=screen(body);await drag(p,{x:p.x+22,y:p.y-13});s=await state();assert.notDeepEqual(s.model.points,before.model.points,tool+' body');
  await click(screen({x:1100,y:600}));s=await state();assert.equal(s.handles.length,0);assert.equal(s.prices,0);await capture(theme+'-'+tool+'-deselected');
  await js('d.selectDrawing(d.drawings.at(-1).id)');await settle();
  if(tool.includes('position')){
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="risk"]').value='10';document.querySelector('dialog[open] form').requestSubmit()`);await settle();assert.equal((await state()).model.position.risk,10);
    const saved=JSON.stringify((await state()).model);await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="risk"]').value='30'`);await key('Escape');assert.equal(JSON.stringify((await state()).model),saved);
  }
  const beforeLock=(await state()).model.points;await js('d.drawings.at(-1).locked=true;d.redraw()');s=await state();await drag(screen(s.points[0]),screen({x:s.points[0].x+25,y:s.points[0].y+20}));assert.deepEqual((await state()).model.points,beforeLock);
  await js('d.drawings.at(-1).locked=false;d.persistDrawings()');const saved=(await state()).model;await win.loadURL(win.webContents.getURL());await load();s=await state();for(const [field,value] of Object.entries(saved))assert.deepEqual(s.model[field],value,tool+' reload '+field);
  await js('d.selectDrawing(d.drawings.at(-1).id);d.deleteSelectedDrawing()');assert.equal((await state()).count,0);await js('d.redo()');assert.equal((await state()).count,1);
  reports.push({tool,theme,handles:expected,result:'PASS'});
 }
 await reset('ghost-feed');await click(screen({x:250,y:300}));await click(screen({x:400,y:200}));await input('mouseMove',screen({x:600,y:300}));await key('Enter');assert.equal((await state()).model.points.length,2);assert.equal((await state()).draft,false);
 await win.loadURL(win.webContents.getURL());await load();assert.equal((await state()).model.points.length,2);assert.match((await state()).svg,/data-ghost-candle/);
 await reset('ghost-feed');await click(screen({x:250,y:300}));await click(screen({x:400,y:200}));await input('mouseDown',screen({x:500,y:250}),{button:'right',clickCount:1});await input('mouseUp',screen({x:500,y:250}),{button:'right',clickCount:1});assert.equal((await state()).confirmed,1);await key('Escape');assert.equal((await state()).count,0);
 assert.equal(await js('String(window.qaError??"")'),'');fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({result:'PASS',reports,ghostEarlyFinish:true,rightClickRewind:true},null,2));console.log('PASS all prediction tools');win.destroy();app.quit();
})().catch(async e=>{console.error(e);fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1);});
