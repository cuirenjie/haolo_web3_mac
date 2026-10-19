const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const tool = process.argv.find(a => a.startsWith('--tool='))?.slice(7) || 'elliott-impulse';
const labels = {
  'elliott-impulse': ['0','1','2','3','4','5'],
  'elliott-correction': ['0','A','B','C'],
  'elliott-triangle': ['0','A','B','C','D','E'],
  'elliott-double-combo': ['0','W','X','Y'],
  'elliott-triple-combo': ['0','W','X','Y','X','Z'],
}[tool];
assert.ok(labels, tool);
const output = path.join(root, '.cache/elliott-wave-qa', tool);
fs.mkdirSync(output, {recursive:true});
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(r=>setTimeout(r,ms));
const near = (a,b) => assert.ok(Math.abs(a-b)<.8, `${a} vs ${b}`);
let win;
(async()=>{
  await app.whenReady();
  win = new BrowserWindow({show:false,width:1400,height:950,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js = code => win.webContents.executeJavaScript(code,true);
  const settle = async()=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(25);};
  const input = async(type,p={x:0,y:0},extra={})=>{win.webContents.sendInputEvent({type,x:Math.round(p.x),y:Math.round(p.y),...extra});await settle();};
  const click = async p=>{await input('mouseMove',p);await input('mouseDown',p,{button:'left',clickCount:1});await input('mouseUp',p,{button:'left',clickCount:1});};
  const drag = async(a,b)=>{await input('mouseMove',a);await input('mouseDown',a,{button:'left',clickCount:1});await input('mouseMove',b,{button:'left',modifiers:['leftButtonDown']});await input('mouseUp',b,{button:'left',clickCount:1});};
  const key = async keyCode=>{await input('keyDown',undefined,{keyCode});await input('keyUp',undefined,{keyCode});};
  const capture = async name=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  const load = async()=>{
    for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
    assert.equal(await js('Boolean(window.ready)'),true);
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');d.redraw()`);await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT||5196}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  await load();
  const rect = await js('(()=>{const r=d.chartElement.getBoundingClientRect();return {x:r.left,y:r.top}})()');
  const screen = p=>({x:rect.x+p.x,y:rect.y+p.y});
  const state = ()=>js(`(()=>{const m=d.draft??d.drawings.at(-1),g=m&&d.content.querySelector('[data-drawing-id="'+m.id+'"]');return {draft:!!d.draft,confirmed:d.draftConfirmedPointCount,count:d.drawings.length,model:m,points:m?.points.map(p=>d.pointToScreen(p)),
    labels:[...(g?.querySelectorAll('[data-elliott-label]')??[])].map(n=>({text:n.textContent,x:+n.getAttribute('x'),y:+n.getAttribute('y'),font:n.getAttribute('font-size'),color:n.getAttribute('fill')})),
    handles:[...(g?.querySelectorAll('[data-elliott-handle]')??[])].map(n=>({x:+n.getAttribute('cx'),y:+n.getAttribute('cy'),stroke:getComputedStyle(n).stroke,fill:getComputedStyle(n).fill,visible:getComputedStyle(n).visibility})),
    line:g?.querySelector('[data-elliott-legs]')?.outerHTML,svg:g?.innerHTML??'',prices:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-price]').length,times:d.axisMarkerLayer.querySelectorAll('[data-drawing-axis-time]').length,ranges:d.axisMarkerLayer.querySelectorAll('.trading-harmonic-axis-range').length,tool:d.activeTool,toolbar:!d.selectionToolbar.hidden,viewport:d.getChart().timeScale().getVisibleLogicalRange()}})()`);
  const verify = (v,selected=true)=>{
    assert.equal(v.model.points.length,labels.length);assert.equal(v.draft,false);
    assert.deepEqual(v.labels.map(l=>l.text),(selected?labels:labels.slice(1)).map(l=>`(${l})`));
    assert.equal(v.handles.length,selected?labels.length:0);
    const color=v.model.color??(tool==='elliott-triangle'?'#ff9800':tool.includes('combo')?'#6aa84f':'#3d85c6');
    assert.ok(v.line.includes(`stroke="${color}"`));assert.ok(v.line.includes(`stroke-width="${v.model.lineWidth??2}"`));
    for(const l of v.labels){assert.equal(+l.font,v.model.fontSize??20);assert.equal(l.color,v.model.textColor??color);}
    for(const h of v.handles)assert.equal(h.stroke,'rgb(41, 98, 255)');
    assert.doesNotMatch(v.svg,/NaN|Infinity|data-horizontal-line-add-text/);
  };
  const anchors = labels.length===4 ? [{x:250,y:350},{x:480,y:145},{x:700,y:225},{x:920,y:95}]
    : [{x:220,y:370},{x:370,y:260},{x:520,y:305},{x:590,y:135},{x:770,y:205},{x:940,y:80}];
  for(const theme of ['light','dark']) {
    console.log(`${tool}: ${theme} staged placement`);
    await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.selectTool('${tool}');d.redraw()`);await settle();
    await click(screen(anchors[0]));
    for(let i=1;i<anchors.length;i++){
      await input('mouseMove',screen(anchors[i]));let v=await state();
      assert.equal(v.count,0);assert.equal(v.confirmed,i);assert.equal(v.handles.length,i);
      assert.deepEqual(v.labels.map(l=>l.text),labels.slice(0,i).map(l=>`(${l})`));
      assert.equal(v.prices,i);assert.equal(v.times,i);assert.equal(v.ranges,2);
      if(theme==='light')await capture(`preview-${i}`);
      await click(screen(anchors[i]));
    }
    let v=await state();verify(v);assert.equal(v.tool,'crosshair');assert.equal(v.toolbar,true);assert.equal(v.prices,labels.length);assert.equal(v.times,labels.length);
    const barWidth=await js('Math.abs(d.getChart().timeScale().logicalToCoordinate(450)-d.getChart().timeScale().logicalToCoordinate(449))');
    for(let i=0;i<labels.length;i++){assert.ok(Math.abs(v.points[i].x-anchors[i].x)<=barWidth/2+1);near(v.points[i].y,anchors[i].y);assert.equal(v.model.points[i].time%3600,0);assert.equal(v.labels[i].y>v.points[i].y,i%2===0);}
    if(theme==='light'){await pause(3200);v=await state();assert.equal(v.toolbar,true);assert.ok(v.handles.every(h=>h.visible==='visible'));}
    await input('mouseMove',screen({x:1050,y:600}));await capture(theme+'-selected');
    console.log(`${tool}: ${theme} each handle, body and label drag`);
    for(let i=0;i<labels.length;i++){
      const before=await state(),p=screen(before.points[i]);await drag(p,{x:p.x+9,y:p.y+7});v=await state();verify(v);
      assert.notDeepEqual(v.model.points[i],before.model.points[i],`handle ${i}`);
      for(let j=0;j<labels.length;j++)if(j!==i)assert.deepEqual(v.model.points[j],before.model.points[j]);
      assert.deepEqual(v.viewport,before.viewport);
    }
    for(const kind of ['line','label']){
      const before=await state();const p=screen(kind==='line'?{x:(before.points[0].x+before.points[1].x)/2,y:(before.points[0].y+before.points[1].y)/2}:before.labels[2]);
      await drag(p,{x:p.x+21,y:p.y-13});v=await state();verify(v);
      for(let i=0;i<labels.length;i++){assert.notDeepEqual(v.model.points[i],before.model.points[i]);near(v.model.points[i].price-before.model.points[i].price,v.model.points[0].price-before.model.points[0].price);near(v.model.points[i].time-before.model.points[i].time,v.model.points[0].time-before.model.points[0].time);}
    }
    await js(`d.overlay.classList.add('drawing-handles-idle')`);assert.ok((await state()).handles.every(h=>h.visible==='visible'));
    await click(screen({x:1090,y:350}));await settle();v=await state();verify(v,false);assert.equal(v.prices,0);assert.equal(v.times,0);assert.equal(v.ranges,0);await capture(theme+'-deselected');
    await click(screen(v.points[1]));verify(await state());
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[data-line-tab="coordinates"]').click()`);await settle();
    assert.deepEqual(await js(`[...document.querySelectorAll('[name="coordinatePoint"] option')].map(o=>o.textContent)`),labels.map((l,i)=>`#${i} (${l})`));
    const before=await state();
    await js(`(()=>{const s=document.querySelector('[name="coordinatePoint"]');s.value='${labels.length-2}';s.dispatchEvent(new Event('change',{bubbles:true}));const p=document.querySelector('[name="price"]');p.value=String(Number(p.value)+.1);document.querySelector('dialog[open] form').requestSubmit()})()`);await settle();v=await state();verify(v);
    for(let i=0;i<labels.length;i++)if(i!==labels.length-2)assert.deepEqual(v.model.points[i],before.model.points[i]);
  }
  console.log(`${tool}: styles, persistence, zoom, reverse direction and cancellation`);
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="color"]').value='#e91e63';document.querySelector('[name="textColor"]').value='#00ff00';document.querySelector('[name="fontSize"]').value='24';document.querySelector('[name="lineWidth"]').value='3';document.querySelector('[name="lineStyle"]').value='dashed';document.querySelector('dialog[open] form').requestSubmit()`);await settle();let v=await state();verify(v);const saved=v.model;
  await win.reload();await load();await js('d.selectDrawing(d.drawings.at(-1).id)');await settle();v=await state();for(const name of ['id','points','color','textColor','fontSize','lineWidth','lineStyle'])assert.deepEqual(v.model[name],saved[name]);verify(v);
  await js('d.getChart().timeScale().setVisibleLogicalRange({from:350,to:520});d.redraw()');await settle();v=await state();verify(v);assert.deepEqual(v.model.points,saved.points);
  await js('workspace.chartNavigation.setMode(1)');await settle();v=await state();verify(v);assert.deepEqual(v.model.points,saved.points);await capture('restored-log-scale');
  const logBefore=await state(),logPoint=screen({x:(logBefore.points[0].x+logBefore.points[1].x)/2,y:(logBefore.points[0].y+logBefore.points[1].y)/2});
  await drag(logPoint,{x:logPoint.x+23,y:logPoint.y-12});v=await state();verify(v);
  for(let i=0;i<labels.length;i++){near(v.points[i].y-logBefore.points[i].y,-12);near(v.points[i].x-logBefore.points[i].x,v.points[0].x-logBefore.points[0].x);}
  await js('workspace.chartNavigation.setMode(0)');await settle();
  await js(`d.selectTool('${tool}')`);await click(screen({x:280,y:150}));await click(screen({x:470,y:290}));await input('mouseMove',screen({x:660,y:160}));
  await input('mouseDown',screen({x:660,y:160}),{button:'right',clickCount:1});await input('mouseUp',screen({x:660,y:160}),{button:'right',clickCount:1});
  v=await state();assert.equal(v.confirmed,1);assert.equal(v.labels.length,1);assert.equal(v.handles.length,1);assert.equal(v.count,1);await key('Escape');assert.equal((await state()).draft,false);assert.equal((await state()).count,1);
  await js('d.selectTool("crosshair");d.selectDrawing(d.drawings[0].id);d.drawings[0].locked=true;d.redraw()');await settle();v=await state();const locked=v.model.points,p=screen(v.points[0]);await drag(p,{x:p.x+20,y:p.y+20});assert.deepEqual((await state()).model.points,locked);
  await js('d.drawings[0].locked=false;d.undo()');await settle();assert.equal((await state()).count,0);await js('d.redo();d.selectDrawing(d.drawings[0].id)');await settle();verify(await state());
  // A falling wave mirrors all label sides and stays in drawing mode when enabled.
  await js(`d.drawings=[];d.drawingStyles.clear();d.stayInDrawingMode=true;d.selectTool('${tool}')`);await settle();
  for(const a of anchors)await click(screen({x:a.x,y:430-a.y}));v=await state();assert.equal(v.tool,tool);verify(v);for(let i=0;i<labels.length;i++)assert.equal(v.labels[i].y>v.points[i].y,i%2===1);await capture('falling-wave');
  await js(`d.selectTool('crosshair');d.selectDrawing(d.drawings[0].id);d.selectionToolbar.querySelector('[data-drawing-selection-action="delete"]').click()`);await settle();assert.equal((await state()).count,0);
  if(tool==='elliott-triple-combo') {
    console.log(`${tool}: future anchors, magnet and settings cancellation`);
    await js(`d.getChart().timeScale().setVisibleLogicalRange({from:460,to:560});d.selectTool('${tool}');d.stayInDrawingMode=false`);await settle();
    for(const a of anchors)await click(screen(a));v=await state();verify(v);
    assert.ok(v.model.points.at(-1).time>await js('d.getCandles().at(-1).time'));await capture('future-wave');
    const before=JSON.stringify(v.model);
    await js(`d.openHorizontalLineSettings(d.drawings[0]);document.querySelector('[name="color"]').value='#ff0000'`);await key('Escape');assert.equal(JSON.stringify((await state()).model),before);
    await js(`d.selectDrawing(null);d.drawings=[];d.magnetEnabled=true;d.selectTool('${tool}')`);await settle();
    const candle=await js(`d.getCandles().map(c=>({time:c.time,price:c.close,screen:d.pointToScreen({time:c.time,price:c.close})})).find(c=>c.screen&&c.screen.x>100&&c.screen.x<d.plotBounds().width-100&&c.screen.y>60&&c.screen.y<d.plotBounds().height-40)`);
    assert.ok(candle);await click(screen({x:candle.screen.x+1,y:candle.screen.y+1}));v=await state();assert.equal(v.model.points[0].time,candle.time);assert.equal(v.model.points[0].price,candle.price);await key('Escape');
  }
  assert.equal(await js('String(window.qaError??"")'),'');
  const report={result:'PASS',tool,labels,themes:['light','dark'],stagedPreview:true,confirmedOnlyLabelsAndHandles:true,axisMarkersAndRanges:true,independentHandles:labels.length,bodyAndLabelDrag:true,coordinateEditor:true,stylePersistence:true,zoomAndLog:true,rightClickRewind:true,escapeCancel:true,lock:true,undoRedo:true,fallingWave:true,stayInDrawingMode:true,delete:true,...(tool==='elliott-triple-combo'?{futureAnchors:true,magnet:true,settingsCancel:true}:{})};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win.destroy();app.quit();
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1);});
