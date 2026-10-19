// Real timers and native pointer input in an isolated offscreen renderer.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-handles-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1304, height: 880, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(40); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const pointer = (type, point) => win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
  const click = async point => { pointer('mouseMove', point); pointer('mouseDown', point); pointer('mouseUp', point); await settle(); };
  const center = selector => js(`(()=>{const r=d.content.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const visible = () => js(`[...d.content.querySelectorAll('.trading-drawing-handle')].filter(e=>getComputedStyle(e).visibility==='visible').length`);
  const expectHidden = async () => {
    assert.equal(await visible(), 0, 'idle endpoints are hidden');
    assert.equal(await js(`[...d.content.querySelectorAll('.trading-drawing-handle')].every(e=>getComputedStyle(e).pointerEvents==='none')`), true, 'hidden endpoints cannot intercept a click');
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i=0; i<120 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
  await js(`document.querySelector('#host').style.cssText='width:100%;height:100%';window.d=workspace.drawingController;workspace.loadingHistory=true;d.drawings=[];d.selectTool('trend-line')`); await settle();
  const bounds = await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y}})()');
  await click({x:Math.round(bounds.x+250),y:Math.round(bounds.y+140)});
  pointer('mouseMove',{x:Math.round(bounds.x+750),y:Math.round(bounds.y+230)}); await settle();
  await pause(3200);
  assert.ok(await visible()>0, 'unfinished drawing keeps endpoints after three seconds');
  await click({x:Math.round(bounds.x+750),y:Math.round(bounds.y+230)});
  assert.equal(await js('d.drawings.length'),1);
  assert.equal(await visible(),2, 'new drawing initially shows endpoints');
  const original = await js('JSON.stringify(d.drawings)');
  await pause(2300); assert.equal(await visible(),2,'endpoints stay visible before three seconds');
  // Moving over the line and quote redraws must not restart a click-based timer.
  const lineCenter=await center('.trading-drawing-hit-target'); pointer('mouseMove',lineCenter);
  await js('d.redraw()'); await pause(850); await expectHidden();
  assert.equal(await js('JSON.stringify(d.drawings)'),original,'hiding does not mutate or delete the drawing');
  assert.equal(await js('d.selectedDrawingId===d.drawings[0].id && d.selectionToolbar.hidden'),true,'selection stays intact while its toolbar also hides after three seconds');
  await js('d.redraw()'); await settle(); await expectHidden();
  await capture('idle-hidden-light');
  await click(lineCenter); assert.equal(await visible(),2,'click reveals hidden endpoints');
  await pause(1800); await click(lineCenter); await pause(1500);
  assert.equal(await visible(),2,'a second click restarts the full three seconds');
  await pause(1600); await expectHidden();
  // An active drag longer than the idle period keeps its handles; release starts
  // a fresh timer without canceling the drag or rolling back its new geometry.
  await click(lineCenter);
  const handle = await center('[data-drawing-handle-index="0"]');
  pointer('mouseMove',handle); pointer('mouseDown',handle);
  const moved={x:handle.x+30,y:handle.y+20}; pointer('mouseMove',moved); await settle();
  await pause(3200);
  assert.equal(await js('d.dragState?.mode'), 'handle'); assert.equal(await visible(),2);
  pointer('mouseUp',moved); await settle(); assert.equal(await visible(),2);
  assert.notEqual(await js('JSON.stringify(d.drawings)'),original,'endpoint drag still changes geometry');
  await pause(3100); await expectHidden();
  // The same behavior covers rays, single-point lines and Fibonacci handles.
  for (const tool of ['ray','horizontal-line','fib-retracement']) {
    await js(`d.drawings[0].tool='${tool}';d.drawings[0].points=d.drawings[0].points.slice(0,${tool==='horizontal-line'?1:2});if(d.drawings[0].points.length===1&&'${tool}'==='fib-retracement')d.drawings[0].points.push({time:workspace.candles.at(-30).time,price:1320});d.selectDrawing(null);d.redraw()`); await settle();
    await click(await center('.trading-drawing-hit-target:not(.area)'));
    assert.ok(await visible()>0,tool+' shows handles on click');
    await pause(3100); await expectHidden();
  }
  await js(`document.documentElement.dataset.theme='dark';workspace.applyChartTheme();d.selectDrawing(d.drawings[0].id)`); await settle();
  await capture('selected-dark'); await pause(3100); await expectHidden(); await capture('idle-hidden-dark');
  // Idle hiding is only a CSS state change and must not replace a focused editor.
  await js(`d.drawings[0].tool='horizontal-line';d.drawings[0].points=d.drawings[0].points.slice(0,1);d.drawings[0].text='原位编辑';d.redraw()`); await settle();
  await click(await center('[data-horizontal-line-edit-text]'));
  await js('window.inlineNode=document.activeElement;inlineNode.value="正在输入";inlineNode.setSelectionRange(2,2)');
  await pause(3100); await expectHidden();
  assert.equal(await js('document.activeElement===inlineNode&&inlineNode.selectionStart===2&&inlineNode.value==="正在输入"'),true,'idle hiding preserves editor focus and caret');
  await js('d.finishHorizontalLineTextEdit(false);d.drawings=[];d.selectDrawing(null);d.selectTool("horizontal-line")'); await settle();
  // Reproduce the reported route: create a new horizontal line, dismiss its
  // floating toolbar, then leave the central endpoint alone for three seconds.
  await click({x:Math.round(bounds.x+345),y:Math.round(bounds.y+205)});
  assert.equal(await js('d.drawings[0].tool'),'horizontal-line');
  assert.equal(await visible(),1,'new horizontal line exposes its center handle');
  await js('d.selectionToolbar.querySelector("[data-drawing-selection-action=hide-toolbar]").click()');
  assert.equal(await js('d.selectionToolbar.hidden'),true);
  await pause(3100); await expectHidden(); await capture('horizontal-toolbar-dismissed');
  const horizontalHit=await js(`(()=>{const r=d.content.querySelector('.trading-drawing-hit-target:not(.area)').getBoundingClientRect();return {x:Math.round(r.x+r.width*.2),y:Math.round(r.y)}})()`);
  await click(horizontalHit); assert.equal(await visible(),1);
  assert.equal(await js('d.horizontalLineSettings.open'),false,'click on line restores the handle without opening the add-text dialog');
  await pause(3100); await expectHidden();
  // Exhaustive catalog sweep with a controllable clock. Real elapsed-time and
  // native click/drag checks above cover timer delivery; this checks every
  // renderer's handles, including locked drawings and a dismissed toolbar.
  const catalogAudit=await js(`(async()=>{
    const {TRADING_DRAWING_TOOLS,tradingDrawingRequiredPointCount,tradingDrawingIsMultiPoint}=await import('/trading-expert-drawing.ts');
    const nativeSetTimeout=window.setTimeout,nativeClearTimeout=window.clearTimeout;
    const timers=new Map();let now=0,nextId=100000000;
    d.selectDrawing(null);
    window.setTimeout=(callback,delay,...args)=>{if(delay!==3000)return nativeSetTimeout(callback,delay,...args);const id=++nextId;timers.set(id,{due:now+delay,callback:()=>callback(...args)});return id};
    window.clearTimeout=id=>{if(!timers.delete(id))nativeClearTimeout(id)};
    const advance=ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.due<=now){timers.delete(id);timer.callback()}};
    const handles=()=>[...d.content.querySelectorAll('.trading-drawing-handle')];
    const isVisible=e=>getComputedStyle(e).visibility==='visible';
    const checked=[];
    try {
      for(const tool of TRADING_DRAWING_TOOLS.filter(t=>!['cursor','eraser'].includes(t.kind))){
        const count=tool.freehand||tradingDrawingIsMultiPoint(tool.id)?7:tradingDrawingRequiredPointCount(tool);
        const points=Array.from({length:count},(_,i)=>{const c=workspace.candles.at(-85+Math.round(i*60/Math.max(1,count-1)));return {time:c.time,price:1315+i*2}});
        const drawing={id:'idle-'+tool.id,tool:tool.id,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points,text:'User note'};
        d.drawings=[drawing];d.selectDrawing(drawing.id);
        if(!handles().length||!handles().every(isVisible))throw Error(tool.id+': missing visible endpoints');
        d.selectionToolbar.querySelector('[data-drawing-selection-action=hide-toolbar]').click();
        const before=JSON.stringify(drawing);advance(2999);d.redraw();
        if(!handles().every(isVisible))throw Error(tool.id+': hidden before three seconds');
        advance(1);d.redraw();
        if(handles().some(isVisible)||handles().some(e=>getComputedStyle(e).pointerEvents!=='none'))throw Error(tool.id+': endpoints survive timeout');
        if(JSON.stringify(drawing)!==before||!d.selectionToolbar.hidden)throw Error(tool.id+': timeout changes drawing/toolbar state');
        drawing.locked=true;d.selectDrawing(drawing.id);
        if(!handles().every(isVisible))throw Error(tool.id+': reselect does not restore endpoints');
        advance(3000);if(handles().some(isVisible))throw Error(tool.id+': locked endpoints survive timeout');
        checked.push({tool:tool.id,endpoints:handles().length});
      }
    } finally {d.selectDrawing(null);window.setTimeout=nativeSetTimeout;window.clearTimeout=nativeClearTimeout;}
    return checked;
  })()`);
  assert.ok(catalogAudit.length>=98,'all selectable drawing tools are covered');
  await js('d.finishHorizontalLineTextEdit(false);d.selectDrawing(d.drawings[0].id);d.selectDrawing(null)');
  assert.equal(await js('d.drawingHandlesHideTimer'),null,'deselection clears the timer');
  await js('d.selectDrawing(d.drawings[0].id);d.destroy()');
  assert.equal(await js('d.drawingHandlesHideTimer'),null,'destroy clears the timer');
  assert.equal(await js('String(window.qaError || "")'),'');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({result:'PASS',idleMs:3000,catalogAudit,checks:['unfinished drawing','idle timeout','hover and redraw do not restart','re-click restart','long endpoint drag','ray/horizontal/Fibonacci','light/dark','inline focus','new horizontal line with dismissed toolbar','all catalog renderers including locked drawings','deselect/destroy cleanup']},null,2));
  console.log('PASS: '+catalogAudit.length+' drawing types, new horizontal line with dismissed toolbar, three-second hiding, re-click, redraw, draft/drag, themes, inline editor and cleanup');
  win.destroy(); app.quit();
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));win?.destroy();app.exit(1)});
