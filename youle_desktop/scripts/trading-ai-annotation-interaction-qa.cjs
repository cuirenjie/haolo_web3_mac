// Real Electron input against isolated chart data/storage. No user window or API.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/ai-annotation-interaction-M1-448');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { checks: [], screenshots: [] };
let win;
(async () => {
  setTimeout(() => app.exit(1), 120000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(http:\/\/127\.0\.0\.1:|devtools:|blob:|data:)/.test(details.url) }));
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  const settle = async () => { await js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(35); };
  const check = (name, actual, expected = true) => { assert.deepEqual(actual, expected, name); report.checks.push(name); };
  const move = async p => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) }); await settle(); };
  const click = async p => { await move(p); for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }); await settle(); };
  const point = (selector, fx = .5, fy = .5) => js(`const r=d.aiTextHitContent.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width*${fx},y:r.y+r.height*${fy}}`);
  const hit = id => `[data-ai-text-size-trigger="${id}"] .trading-ai-text-size-hit-target`;
  const del = id => `[data-ai-annotation-delete="${id}"]`;
  const visible = id => js(`return getComputedStyle(d.aiTextHitContent.querySelector('${del(id)}')).visibility==='visible'`);
  const view = () => js('return {time:workspace.chart.timeScale().getVisibleLogicalRange(),price:workspace.chart.priceScale("right").getVisibleRange()}');
  const capture = async name => { await settle(); fs.writeFileSync(path.join(output, name+'.png'), (await win.webContents.capturePage()).toPNG()); report.screenshots.push(name); };
  const init = async () => {
    for (let i=0;i<150&&!await js('return Boolean(window.ready)');i++) await pause(100);
    check('chart initialized', await js('return Boolean(window.ready)'));
    await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';
      window.lang=await import('/app-language.mjs');d.selectTool('crosshair');
      window.makePatch=(id='labels',turn=id,only=false)=>{
        const marketId=d.getSymbol(),interval=d.getInterval(),candles=d.getCandles();
        const op=(name,tool,index,price,text)=>({op:'upsert',drawing:{id:id+'-'+name,symbol:marketId,theory:'strategy',layer:'ai/strategy/chart-patterns',strategyId:'chart-patterns',tool,
          points:[{time:candles.at(index).time,price},...(tool==='path'?[{time:candles.at(index+30).time,price:price+5}]:[])],text,colorToken:'strategy-support',locked:true,status:'confirmed',fontSize:12}});
        return {schemaVersion:1,analysisId:id,drawingTurnId:turn,baseRevision:0,marketId,interval,
          operations:only?[op('note','note',-48,1310,'上升通道 · 已完成 · 历史参考，不是新入场信号')]:[
            op('note','note',-48,1310,'上升通道 · 已完成 · 历史参考，不是新入场信号'),
            op('text','text',-75,1338,'P3 · AI 标注'),op('line','path',-85,1314)]};};
      window.resetViewport=()=>{workspace.chartNavigation.setVerticalLocked(false);workspace.chart.timeScale().setVisibleLogicalRange({from:380,to:505});workspace.chartNavigation.setAutoScale(false);workspace.chart.priceScale('right').setVisibleRange({from:1280,to:1360});d.redraw();};
      resetViewport();`);
    await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT||5213}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  await init();
  await js(`d.drawings=[{id:'manual-kept',symbol:d.getSymbol(),interval:d.getInterval(),tool:'trend-line',points:[{time:d.getCandles().at(-95).time,price:1290},{time:d.getCandles().at(-65).time,price:1295}]}];d.persistDrawings();window.manualBefore=JSON.stringify(d.drawings);window.redoBefore=JSON.stringify(d.redoStack);`);
  for (const theme of ['light','dark']) for (const language of ['zh-CN','en','zh-TW']) {
    const label=`${theme} ${language}`;
    await js(`document.documentElement.dataset.theme='${theme}';lang.applyAppLanguage('${language}',{root:document.body});d.clearAiDrawings();d.storeAiDrawingPatch(makePatch());resetViewport();`); await settle();
    await move({x:5,y:5}); check(label+' hidden away',await visible('labels-note'),false);
    const p=await point(hit('labels-note'));
    await move(p);check(label+' hover reveals delete',await visible('labels-note'));
    check(label+' text passes through to native canvas', await js(`return document.elementFromPoint(${p.x},${p.y})?.tagName==='CANVAS'`));
    check(label+' only hovered annotation revealed',await visible('labels-text'),false);
    const appearance=await js(`const e=d.aiTextHitContent.querySelector('${del('labels-note')}');return {fill:getComputedStyle(e.querySelector('circle')).fill,stroke:getComputedStyle(e.querySelector('path')).stroke,label:e.getAttribute('aria-label'),radius:e.querySelector('circle').r.baseVal.value};`);
    check(label+' circular button',appearance.radius,9);
    check(label+' black background',appearance.fill,'rgb(17, 17, 17)');check(label+' white cross',appearance.stroke,'rgb(255, 255, 255)');
    check(label+' localized action',appearance.label,language==='en'?'Delete AI annotation':language==='zh-TW'?'刪除 AI 標註':'删除 AI 标注');
    await js('d.redraw()');await settle();check(label+' hover survives redraw',await visible('labels-note'));
    await capture(`hover-${theme}-${language}`);
    await move(await point(del('labels-note')));
    await js("d.aiDrawings.find(x=>x.id==='labels-text').text+=' ';d.redraw()");await settle();
    check(label+' button stays reachable through markup update',await visible('labels-note'));
    const before=await view();await click(await point(del('labels-note')));
    check(label+' deletes just note',await js('return d.aiDrawings.map(x=>x.id)'),['labels-text','labels-line']);
    check(label+' note and leader removed',await js('return d.aiContent.querySelector("[data-drawing-id=labels-note]")===null'));
    check(label+' delete does not move chart',await view(),before);
    check(label+' manual and redo preserved',await js('return JSON.stringify(d.drawings)===manualBefore&&JSON.stringify(d.redoStack)===redoBefore'));
  }
  for (const theme of ['light','dark']) for (const type of ['note','text']) for (const [direction,dx,dy] of [['left',-55,0],['right',55,0],['up',0,-45],['down',0,45]]) {
    await js(`document.documentElement.dataset.theme='${theme}';d.clearAiDrawings();d.storeAiDrawingPatch(makePatch());resetViewport();`);await settle();
    const p=await point(hit('labels-'+type));await move(p);const before=await view();const drawings=await js('return JSON.stringify(d.aiDrawings)');
    win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(p.x),y:Math.round(p.y),button:'left',clickCount:1});
    for(let step=1;step<=8;step++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(p.x+dx*step/8),y:Math.round(p.y+dy*step/8),button:'left',buttons:['left']});await settle();}
    const after=await view();await pause(180);
    win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(p.x+dx),y:Math.round(p.y+dy),button:'left',clickCount:1});await settle();
    check(`${theme} ${type} ${direction} native pan`,dx?Math.abs(after.time.from-before.time.from)>1:Math.abs(after.price.from-before.price.from)>1);
    check(`${theme} ${type} ${direction} preserves drawings`,await js('return JSON.stringify(d.aiDrawings)'),drawings);
  }
  // Real wheel input over text must still reach navigation.
  await js('resetViewport()');await settle();const wheelPoint=await point(hit('labels-note'));await move(wheelPoint);const wheelBefore=await view();
  win.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(wheelPoint.x),y:Math.round(wheelPoint.y),deltaY:-120,deltaX:0});await pause(200);await settle();
  check('wheel zoom over annotation',Math.abs((await view()).time.from-wheelBefore.time.from)>0.1);
  // Hover is suppressed during manual placement; keyboard access still works in cursor mode.
  await js("d.selectTool('trend-line')");await move(await point(hit('labels-text')));check('manual drawing mode hides delete',await visible('labels-text'),false);
  await js("d.selectTool('crosshair');d.aiTextHitContent.querySelector('[data-ai-text-size-trigger=labels-text]').focus()");await settle();
  check('keyboard focus reveals delete',await visible('labels-text'));
  await js(`d.aiTextHitContent.querySelector('${del('labels-text')}').focus()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await settle();
  check('Enter deletes only focused text',await js('return d.aiDrawings.some(x=>x.id==="labels-text")'),false);
  // History alternatives, duplicate receipt and a full renderer reload.
  await js(`d.clearAiDrawings();window.patchA=makePatch('a','turn');d.storeAiDrawingPatch(patchA);d.storeAiDrawingPatch(makePatch('b','turn'));d.aiDrawingSets.next(patchA);d.aiDrawings=d.aiDrawingSets.selectedDrawings(d.aiDrawings);d.redraw();resetViewport();`);await settle();
  await move(await point(hit('a-note')));await click(await point(del('a-note')));
  await js('d.aiDrawingSets.next(patchA);d.aiDrawings=d.aiDrawingSets.selectedDrawings(d.aiDrawings);d.persistAiDrawings();d.redraw()');
  check('alternative unaffected',await js('return d.aiDrawings.some(x=>x.id==="b-note")'));
  await js('d.aiDrawingSets.next(patchA);d.aiDrawings=d.aiDrawingSets.selectedDrawings(d.aiDrawings);d.storeAiDrawingPatch(patchA)');
  check('duplicate receipt preserves deletion',await js('return d.aiDrawings.some(x=>x.id==="a-note")'),false);
  await win.reload();await pause(200);await init();
  check('deletion survives renderer reload',await js('return !d.aiDrawings.some(x=>x.id==="a-note")&&d.aiDrawings.some(x=>x.id==="a-text")'));
  await js("d.clearAiDrawings();d.storeAiDrawingPatch(makePatch('only','only',true));resetViewport()");await settle();
  await move(await point(hit('only-note')));await click(await point(del('only-note')));
  await win.reload();await pause(200);await init();
  await js("d.storeAiDrawingPatch(makePatch('only','only',true))");await settle();
  check('last label remains deleted after reload and duplicate patch',await js('return d.aiDrawings.length'),0);
  // Delete during a real playback pause; final full-patch persistence must keep it removed.
  await js(`d.clearAiDrawings();window.deletedDuringPlayback=false;
    window.playPromise=d.playAiDrawingPatch(makePatch('during'),{speedMultiplier:4,onPhase:(phase,drawing)=>{
      if(d.aiDrawings.some(x=>x.id==='during-note')&&!window.deletedDuringPlayback){window.deletedDuringPlayback=true;d.deleteAiTextDrawing('during-note');}
    }});`);
  await js('await playPromise');await settle();
  check('deletion exercised during playback',await js('return window.deletedDuringPlayback'));
  check('playback final patch preserves deletion',await js('return !d.aiDrawings.some(x=>x.id==="during-note")&&d.aiDrawings.some(x=>x.id==="during-line")'));
  check('no renderer errors',await js('return String(window.qaError||"")'),'');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots,output}));app.exit(0);
})().catch(async error=>{fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());console.error(error);app.exit(1)});
