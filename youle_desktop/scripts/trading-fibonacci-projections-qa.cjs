const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),tool=process.argv[2]||'fib-trend-extension';
const output=path.join(root,'.cache/fibonacci-projections-qa',tool);fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms));let win;
(async()=>{
 await app.whenReady();win=new BrowserWindow({show:false,width:1400,height:950,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true);
 const settle=async()=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(35)};
 const input=async(type,p,extra={})=>{win.webContents.sendInputEvent({type,x:Math.round(p.x),y:Math.round(p.y),...extra});await settle()};
 const click=async p=>{await input('mouseMove',p);await input('mouseDown',p,{button:'left',clickCount:1});await input('mouseUp',p,{button:'left',clickCount:1})};
 const drag=async(a,b)=>{await input('mouseMove',a);await input('mouseDown',a,{button:'left',clickCount:1});await input('mouseMove',b,{button:'left',modifiers:['leftButtonDown']});await input('mouseUp',b,{button:'left',clickCount:1})};
 const capture=async name=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
 await win.loadURL(`http://127.0.0.1:5183/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
 const load=async()=>{for(let i=0;i<100&&!await js('Boolean(window.ready)');i++)await pause(100);assert.ok(await js('Boolean(window.ready)'));await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');d.redraw()`);await settle()};await load();
 const rect=await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
 const screen=p=>({x:p.x+rect.x,y:p.y+rect.y});
 const state=()=>js(`(()=>{const item=d.draft??d.drawings.at(-1),g=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]');return {draft:!!d.draft,count:d.drawings.length,confirmed:d.draftConfirmedPointCount,required:d.draftRequiredPointCount,model:item,points:item?.points.map((p,i)=>d.drawingPointToScreen(item,i,d.plotBounds())),handles:g?.querySelectorAll('[data-drawing-handle-index]').length??0,svg:g?.innerHTML??'',levelCount:g?.querySelectorAll('[data-fibonacci-level]').length??0,hitCount:g?.querySelectorAll('.trading-drawing-hit-target').length??0}})()`);
 const verify=v=>{assert.equal(v.count,1);assert.ok(v.hitCount>0);assert.ok(!/NaN|Infinity/.test(v.svg));assert.ok(v.handles>=v.model.points.length);};
 const bodyPoint=()=>js(`(()=>{
   const item=d.drawings.at(-1),bounds=d.plotBounds(),rect=d.chartElement.getBoundingClientRect();
   const anchors=item.points.map((_,i)=>d.drawingPointToScreen(item,i,bounds));
   for(const shape of d.content.querySelectorAll('[data-drawing-id="'+item.id+'"] .trading-drawing-hit-target')){
     if(!shape.getTotalLength)continue;
     for(const t of [.45,.7,.25,.9]){
       const p=shape.getPointAtLength(shape.getTotalLength()*t);
       if(p.x<25||p.y<40||p.x>bounds.width-30||p.y>bounds.height-30||anchors.some(a=>Math.hypot(p.x-a.x,p.y-a.y)<35))continue;
       const target=document.elementFromPoint(rect.left+p.x,rect.top+p.y);
       if(target?.closest('[data-drawing-id]')?.dataset.drawingId===item.id&&!target.closest('[data-drawing-handle-index]'))return {x:p.x,y:p.y};
     }
   }
   return null;
 })()`);
 for(const theme of ['light','dark']){
  await js(`d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();d.selectTool('crosshair');document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('${tool}');d.redraw()`);await settle();
  const a=tool==='fib-wedge'?{x:260,y:130}:{x:260,y:85},b=tool==='gann-square-fixed'?{x:310,y:110}:['gann-box','gann-square','gann-fan','fib-speed-fan'].includes(tool)?{x:650,y:340}:tool==='fib-wedge'?{x:500,y:220}:tool==='fib-speed-arcs'?{x:260,y:155}:tool==='fib-circles'?{x:330,y:155}:{x:650,y:135},c=tool==='pitchfan'?{x:420,y:350}:tool==='fib-wedge'?{x:350,y:350}:{x:400,y:170};
  await click(screen(a));await input('mouseMove',screen(b));let v=await state();assert.ok(v.draft);assert.equal(v.count,0);await capture(theme+'-preview');
  const required=v.required;await click(screen(b));
  if(required===3){v=await state();assert.ok(v.draft);assert.equal(v.confirmed,2);await input('mouseMove',screen(c));await capture(theme+'-third-preview');await click(screen(c));}
  v=await state();assert.equal(v.draft,false);assert.equal(v.model.points.length,required);verify(v);await capture(theme+'-complete');
  if(tool==='gann-square'){
    const measurements=await js(`Array.from(d.content.querySelectorAll('[data-gann-measurement]'),n=>n.textContent)`);
    assert.equal(measurements.length,3);assert.ok(Number(measurements[0])>0);assert.ok(Number(measurements[2])>0);
  }
  for(let i=0;i<required;i++){const before=await state(),p=screen(before.points[i]);await drag(p,{x:p.x+13,y:p.y+17});v=await state();verify(v);assert.notDeepEqual(v.model.points[i],before.model.points[i]);}
  if(tool==='gann-box')for(const i of [2,3]){
    const before=await state(),p=screen(i===2?{x:before.points[1].x,y:before.points[0].y}:{x:before.points[0].x,y:before.points[1].y});
    assert.equal(before.handles,4);await drag(p,{x:p.x+15,y:p.y+12});v=await state();verify(v);assert.notDeepEqual(v.model.points,before.model.points);
    // A virtual corner resizes adjacent sides; its opposite corner stays fixed.
    const fixed=i===2?{x:0,y:1}:{x:1,y:0};
    assert.equal(v.model.points[fixed.x].time,before.model.points[fixed.x].time);
    assert.equal(v.model.points[fixed.y].price,before.model.points[fixed.y].price);
  }
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1))`);await settle();
  if(tool==='fib-channel')assert.equal(await js(`document.querySelector('dialog[open] [name="trendVisible"]').closest('.fib-setting-row').hidden`),true);
  if(tool.startsWith('gann-square'))assert.equal(await js(`document.querySelector('dialog[open] [data-fib-trend]').hidden`),true);
  const option=tool==='fib-spiral'?'counterclockwise':tool==='fib-speed-arcs'?'fullCircles':tool.startsWith('gann-square')?'gannArcsVisible':'fillVisible';
  const expectedOption=await js(`(()=>{const input=document.querySelector('dialog[open] [name="${option}"]');input.click();return input.checked})()`);await settle();
  await js(`document.querySelector('[data-line-tab="coordinates"]').click()`);await settle();
  assert.equal(await js(`document.querySelectorAll('dialog[open] input[name^="price"]').length`),required);
  const expectedPrice=await js(`(()=>{const input=document.querySelector('dialog[open] [name="price0"]');input.value=String(Number(input.value)+.25);input.dispatchEvent(new Event('input',{bubbles:true}));return Number(input.value)})()`);
  await js(`document.querySelector('dialog[open] form').requestSubmit()`);await settle();v=await state();verify(v);assert.equal(v.model.fibonacci.levels.length>0,true);
  assert.equal(v.model.fibonacci[option],expectedOption);assert.equal(v.model.points[0].price,expectedPrice);
  const saved=v.model.points;await win.reload();await load();await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectDrawing(d.drawings.at(-1).id);d.redraw()`);await settle();v=await state();verify(v);assert.deepEqual(v.model.points,saved);assert.equal(v.model.fibonacci[option],expectedOption);
  await js('workspace.chartNavigation.setMode(1);d.redraw()');await settle();v=await state();verify(v);
  if(tool==='fib-wedge'){
    const [a,b,c]=v.points;
    assert.ok(Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-Math.hypot(c.x-a.x,c.y-a.y))<.01,'angular handle remains on outer arc after scale change');
  }
  const beforeMove=await state(),body=await bodyPoint();assert.ok(body,'visible non-anchor hit target');
  const from=screen(body);await drag(from,{x:from.x+19,y:from.y+11});v=await state();verify(v);
  for(let i=0;i<required;i++){
    assert.ok(Math.abs(v.points[i].x-beforeMove.points[i].x-19)<1.5,'whole drawing moves in time');
    assert.ok(Math.abs(v.points[i].y-beforeMove.points[i].y-11)<1.5,'whole drawing moves in price');
  }
  await capture(theme+'-log');await js('workspace.chartNavigation.setMode(0)');await settle();
  const beforeLock=await state();await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="toggle-lock"]').click()`);await settle();
  const lockedHandle=screen(beforeLock.points[0]);await drag(lockedHandle,{x:lockedHandle.x+20,y:lockedHandle.y+20});assert.deepEqual((await state()).model.points,beforeLock.model.points);
  await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="toggle-lock"]').click();d.undo()`);await settle();assert.equal((await state()).count,0);
  await js('d.redo();d.selectDrawing(d.drawings.at(-1).id);d.redraw()');await settle();verify(await state());
  const erase=await bodyPoint();assert.ok(erase);await js(`d.selectTool('eraser')`);await click(screen(erase));assert.equal((await state()).count,0,'eraser hits the visible curve away from anchors');
 }
 // Escape and right-click never commit an unfinished drawing.
 await js(`d.selectTool('${tool}')`);await click(screen({x:250,y:180}));await input('mouseMove',screen({x:650,y:310}));
 await input('keyDown',{x:0,y:0},{keyCode:'Escape'});await input('keyUp',{x:0,y:0},{keyCode:'Escape'});assert.equal((await state()).draft,false);
 await js(`d.selectTool('${tool}')`);await click(screen({x:250,y:180}));await input('mouseMove',screen({x:650,y:310}));
 let draft=await state();
 if(draft.required===3){await click(screen({x:650,y:310}));assert.equal((await state()).confirmed,2);}
 await input('mouseDown',screen({x:400,y:260}),{button:'right',clickCount:1});await input('mouseUp',screen({x:400,y:260}),{button:'right',clickCount:1});
 if(draft.required===3){assert.equal((await state()).confirmed,1);await input('keyDown',{x:0,y:0},{keyCode:'Escape'});await input('keyUp',{x:0,y:0},{keyCode:'Escape'});}
 assert.equal((await state()).draft,false);assert.equal((await state()).count,0);
 assert.equal(await js('String(window.qaError??"")'),'');
 const report={result:'PASS',tool,themes:['light','dark'],preview:true,placement:true,handles:true,settingsCoordinates:true,settingsToggle:true,persistence:true,logScale:true,bodyDrag:true,lock:true,undoRedo:true,curveEraser:true,escape:true,rightClick:true};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));await win.loadURL('about:blank');await pause(100);win.destroy();app.quit();
})().catch(async e=>{console.error(e);fs.writeFileSync(path.join(output,'failure.txt'),String(e.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1)});
