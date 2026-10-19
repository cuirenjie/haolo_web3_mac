// Offscreen renderer, synthetic market data, isolated storage. No real account.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache','drawing-style-audit-20261017');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={themes:[],tools:[],errors:[]};let win;
(async()=>{
  await app.whenReady();win=new BrowserWindow({show:false,width:1304,height:880,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.includes('Binance market catalog is unavailable'))report.errors.push(e.message)});
  const js=async code=>{try{return await win.webContents.executeJavaScript(code,true)}catch(e){throw new Error(e.message+'\n'+code)}};
  const settle=async()=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await pause(30)};
  const capture=async name=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  const load=async()=>{
    await win.loadURL(`http://127.0.0.1:5183/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
    for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
    assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
    await js(`(async()=>{document.querySelector('#host').style.cssText='width:100%;height:100%';window.d=workspace.drawingController;workspace.loadingHistory=true;window.catalog=await import('/trading-expert-drawing.ts');window.defaults=await import('/trading-drawing-defaults.ts');window.lang=await import('/app-language.mjs');lang.applyAppLanguage('en',{root:document.body});lang.observeAppLanguage(document.body);})()`);await settle();
  };
  const click=async(x,y)=>{win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await settle()};
  const stroke=()=>js(`(()=>{const g=d.content.querySelector('[data-drawing-id]');return [...g.querySelectorAll('[stroke]')].filter(e=>!e.classList.contains('trading-drawing-handle')).map(e=>({tag:e.tagName,color:e.getAttribute('stroke'),width:e.getAttribute('stroke-width'),dash:e.getAttribute('stroke-dasharray'),opacity:e.getAttribute('opacity'),fill:e.getAttribute('fill-opacity')}))})()`);
  const toolbar=()=>js(`({color:d.selectionToolbar.style.getPropertyValue('--drawing-current-color'),width:d.selectionToolbar.querySelector('[data-drawing-width-value]').textContent,checked:d.selectionToolbar.querySelector('[data-drawing-width][aria-checked="true"]')?.dataset.drawingWidth})`);
  await load();await js('d.drawings=[];d.drawingStyles.clear();d.selectTool("trend-line")');
  const bounds=await js('(()=>{const b=d.overlay.getBoundingClientRect();return {x:b.x,y:b.y}})()');
  await click(Math.round(bounds.x+230),Math.round(bounds.y+160));await click(Math.round(bounds.x+700),Math.round(bounds.y+370));
  assert.equal(await js('d.drawings.length'),1);
  await js('d.selectedDrawingId=d.drawings[0].id;d.redraw()');await settle();
  for(const theme of ['light','dark']){
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.redraw()`);await settle();
    const paths=await stroke();assert.equal(paths[0].color,'#2962ff');assert.equal(paths[0].width,'2');assert.ok(!paths[0].dash);
    assert.deepEqual(await toolbar(),{color:'#2962ff',width:'2px',checked:'2'});
    const handles=await js(`[...d.content.querySelectorAll('.trading-drawing-handle')].map(e=>({color:e.getAttribute('stroke'),width:e.getAttribute('stroke-width'),filter:getComputedStyle(e).filter}))`);
    handles.forEach(h=>assert.deepEqual(h,{color:'#2962ff',width:'1.5',filter:'none'}));
    const axes=await js(`[...d.axisMarkerLayer.children].map(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}))`);
    assert.ok(axes.length>=2);axes.forEach(a=>assert.deepEqual(a,{bg:'rgb(41, 98, 255)',color:'rgb(255, 255, 255)'}));
    report.themes.push({theme,paths,handles,axes});
    const close=await js(`(()=>{const b=d.selectionToolbar.querySelector('[data-drawing-selection-action="hide-toolbar"]').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',x:close.x-20,y:close.y+20});await settle();
    const sameCloseStyle=await js(`(()=>{const drawing=d.selectionToolbar.querySelector('.trading-chart-toolbar-close'),navigation=document.querySelector('.trading-chart-navigation-close');return ['width','height','borderRadius','backgroundColor','color'].every(k=>getComputedStyle(drawing)[k]===getComputedStyle(navigation)[k])})()`);
    assert.equal(sameCloseStyle,true,theme+': shared chart close button style');
    // The lower-left part overlaps the delete action. It must remain visible
    // and receive the click even while the underlying action is hovered.
    assert.equal(await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="hide-toolbar"]').contains(document.elementFromPoint(${close.x-4},${close.y+4}))`),true,theme+': close button stays above toolbar actions');
    await capture(theme+'-trendline');
    const beforeClose=await js('JSON.stringify(d.drawings)');await click(close.x-4,close.y+4);
    assert.equal(await js('d.selectionToolbar.hidden'),true,theme+': native close click');
    await js('d.redraw()');await settle();assert.equal(await js('d.selectionToolbar.hidden'),true,theme+': redraw stays hidden');
    assert.equal(await js('JSON.stringify(d.drawings)'),beforeClose,theme+': closing preserves drawing');
    const handle=await js(`(()=>{const b=d.content.querySelector('.trading-drawing-handle').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
    await click(handle.x,handle.y);assert.equal(await js('d.selectionToolbar.hidden'),false,theme+': selecting restores toolbar');
  }
  // All line/shape rendering routes, not just the common svgLine helper.
  await js(`document.documentElement.dataset.theme='light';workspace.applyChartTheme()`);
  for(const id of ['ray','extended-line','horizontal-line','vertical-line','cross-line','arrow','parallel-channel','flat-top-bottom','disjoint-channel','rectangle','rotated-rectangle','circle','ellipse','triangle','arc','curve','double-curve','multi-point-path','multi-point-polyline','brush','highlighter','xabcd','head-shoulders','elliott-impulse','elliott-triangle','elliott-triple-combo','sine-line','time-cycles','anchored-vwap']) {
    await js(`(()=>{const tool=catalog.TRADING_DRAWING_TOOLS.find(t=>t.id==='${id}');const count=tool.freehand||catalog.tradingDrawingIsMultiPoint(tool.id)?7:catalog.tradingDrawingRequiredPointCount(tool);const points=Array.from({length:count},(_,i)=>{const c=workspace.candles.at(-85+Math.round(i*60/Math.max(1,count-1)));return {time:c.time,price:c.close+i*.5}});d.drawings=[{id:'style-${id}',tool:'${id}',symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points}];d.selectedDrawingId=d.drawings[0].id;d.redraw()})()`);await settle();
    const expected=await js(`defaults.manualDrawingDefaults('${id}')`),paths=await stroke(),bar=await toolbar();
    assert.ok(paths.length>0,id);assert.equal(paths[0].color,expected.color,id);assert.equal(Number(paths[0].width),expected.lineWidth,id);
    assert.equal(bar.color,expected.color,id);assert.equal(bar.width,expected.lineWidth+'px',id);
    assert.equal(await js(`d.selectionToolbar.querySelector('[data-drawing-color][aria-checked="true"]')?.dataset.drawingColor`),expected.color,`${id}: default color swatch`);
    report.tools.push({id,paths,bar});
    if(['rectangle','brush','highlighter','elliott-triangle'].includes(id))await capture(id);
  }
  // Update from the actual style buttons; restore defaults and remember the
  // chosen style for the next tool of the same type.
  await js(`d.drawings=[{id:'custom',tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points:workspace.candles.slice(-60,-58).map(c=>({time:c.time,price:c.close}))}];d.selectedDrawingId='custom';d.redraw()`);await settle();
  for(const selector of ['[data-drawing-color="#ff9800"]','[data-drawing-width="4"]','[data-drawing-style="dashed"]']) {await js(`d.selectionToolbar.querySelector('${selector}').click()`);await settle()}
  assert.equal((await stroke())[0].color,'#ff9800');assert.equal((await stroke())[0].width,'4');assert.equal((await stroke())[0].dash,'7 5');
  assert.equal(await js('d.drawingStyleForTool("trend-line").color'),'#ff9800');
  await js('d.persistDrawings()');await load();await js('d.selectedDrawingId="custom";d.redraw()');await settle();
  assert.equal((await stroke())[0].color,'#ff9800');assert.equal((await stroke())[0].width,'4');
  await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="reset"]').click()`);await settle();
  assert.equal((await stroke())[0].color,'#2962ff');assert.equal((await stroke())[0].width,'2');assert.ok(!(await stroke())[0].dash);
  assert.deepEqual(await js('d.drawingStyleForTool("trend-line")'),{});
  // Highlighter widths above the old 4px cap must survive the same save/load.
  await js(`d.drawings[0].tool='highlighter';d.drawings[0].id='highlighter';d.selectedDrawingId='highlighter';d.redraw()`);await settle();
  await js(`d.selectionToolbar.querySelector('[data-drawing-width="30"]').click();d.persistDrawings()`);await settle();await load();
  assert.equal(await js('d.drawings[0].lineWidth'),30);
  await js('d.selectedDrawingId="highlighter";d.redraw()');await settle();assert.equal((await stroke())[0].width,'30');
  await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="reset"]').click()`);await settle();assert.equal((await stroke())[0].width,'20');
  // Colors selected explicitly continue to override multicolor Fibonacci levels.
  await js(`d.drawings[0].tool='fib-retracement';d.redraw()`);await settle();
  assert.deepEqual(await js(`[...d.content.querySelectorAll('.trading-fibonacci-level-line')].map(e=>e.getAttribute('stroke'))`),['#808080','#00bcd4','#089981','#4caf50','#ff9800','#f23645','#808080']);
  await js(`d.selectionToolbar.querySelector('[data-drawing-color="#ff9800"]').click()`);await settle();
  assert.ok((await js(`[...d.content.querySelectorAll('.trading-fibonacci-level-line')].map(e=>e.getAttribute('stroke'))`)).every(c=>c==='#ff9800'));
  await capture('custom-fibonacci');
  // Every selectable drawing, including text, shares dismissal without deleting
  // model data, and can restore its options on explicit selection.
  report.dismissals=await js(`(()=>{const checked=[];for(const tool of catalog.TRADING_DRAWING_TOOLS.filter(t=>!['cursor','eraser'].includes(t.kind))){const count=tool.freehand||catalog.tradingDrawingIsMultiPoint(tool.id)?7:catalog.tradingDrawingRequiredPointCount(tool);const points=Array.from({length:count},(_,i)=>{const c=workspace.candles.at(-85+Math.round(i*60/Math.max(1,count-1)));return {time:c.time,price:c.close+i*.5}});d.drawings=[{id:'close-'+tool.id,tool:tool.id,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points,text:'User note'}];d.selectDrawing(d.drawings[0].id);if(d.selectionToolbar.hidden)throw Error(tool.id+': toolbar unavailable');const before=JSON.stringify(d.drawings);d.selectionToolbar.querySelector('[data-drawing-selection-action="hide-toolbar"]').click();d.redraw();if(!d.selectionToolbar.hidden||JSON.stringify(d.drawings)!==before)throw Error(tool.id+': dismissal changed drawing');d.selectDrawing(d.drawings[0].id);if(d.selectionToolbar.hidden)throw Error(tool.id+': restore failed');checked.push(tool.id)}return checked})()`);
  report.persistence='PASS: custom style, new-tool style memory, reset, highlighter 30px save/load, per-level color override';
  assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));fs.rmSync(path.join(output,'failure.txt'),{force:true});
  console.log(`PASS: ${report.themes.length} themes, ${report.tools.length} drawing routes, ${report.dismissals.length} toolbar dismiss/restore cases, color/width/style toolbar, handles, axes, persistence and reset`);win.destroy();app.quit();
})().catch(e=>{console.error(e);fs.writeFileSync(path.join(output,'failure.txt'),String(e.stack));win?.destroy();app.exit(1)});
