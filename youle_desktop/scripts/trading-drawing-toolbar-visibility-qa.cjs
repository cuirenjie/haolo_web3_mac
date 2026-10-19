// Isolated Electron: native clicks and real timers, then every drawing type at
// the exact timeout boundary with a controllable clock. Uses synthetic candles.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-toolbar-visibility-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  setTimeout(() => app.exit(1), 90000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1304, height: 880, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async code => {
    const result = await win.webContents.executeJavaScript(`(async()=>{try{return {value:await eval(${JSON.stringify(code)})}}catch(error){return {error:String(error.stack)}}})()`, true);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const pointer = (type, point) => win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
  const click = async point => { pointer('mouseMove', point); pointer('mouseDown', point); pointer('mouseUp', point); await settle(); };
  const center = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const hidden = () => js('d.selectionToolbar.hidden');
  const visibleHandles = () => js(`[...d.content.querySelectorAll('.trading-drawing-handle')].filter(e=>getComputedStyle(e).visibility==='visible').length`);
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i=0; i<120 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
  await js(`document.querySelector('#host').style.cssText='width:100%;height:100%';window.d=workspace.drawingController;workspace.loadingHistory=true;d.drawings=[];d.selectTool('trend-line')`);
  await settle();
  const bounds = await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y}})()');
  await click({x:Math.round(bounds.x+250),y:Math.round(bounds.y+180)});
  await click({x:Math.round(bounds.x+750),y:Math.round(bounds.y+290)});
  assert.equal(await hidden(), false, 'new drawing displays its toolbar');
  const original = await js('JSON.stringify(d.drawings)');
  await capture('visible-light');
  await pause(2100);
  assert.equal(await hidden(), false, 'toolbar remains before timeout');
  // The midpoint can contain the inline Add text action. Select the segment
  // itself so the timer test does not accidentally open the text settings.
  const line = await js(`(()=>{
    const e=d.content.querySelector('line.trading-drawing-hit-target');
    const point=new DOMPoint(Number(e.getAttribute('x1'))*.8+Number(e.getAttribute('x2'))*.2,
      Number(e.getAttribute('y1'))*.8+Number(e.getAttribute('y2'))*.2).matrixTransform(e.getScreenCTM());
    return {x:Math.round(point.x),y:Math.round(point.y)};
  })()`);
  pointer('mouseMove', line); await js('d.redraw()');
  await pause(1100);
  assert.equal(await hidden(), true, 'hover and quote redraw do not extend the timer');
  assert.equal(await js('JSON.stringify(d.drawings)'), original, 'auto hide preserves drawing geometry and style');
  await js('d.redraw()'); await settle();
  assert.equal(await hidden(), true, 'redraw cannot restore a dismissed toolbar');
  await capture('hidden-light');
  await click(line); assert.equal(await hidden(), false, 'click drawing restores toolbar');
  await pause(1800);
  await click(await center('[data-drawing-selection-action="toggle-color"]'));
  await pause(1500);
  assert.equal(await hidden(), false, 'toolbar click cancels the timeout');
  assert.equal(await js('d.activeSelectionMenu'), 'color');
  await pause(1650);
  assert.equal(await hidden(), false, 'toolbar and color menu stay open after interaction');
  assert.equal(await js('d.activeSelectionMenu'), 'color');
  await click(await center('[data-color-swatch="#2962ff"]'));
  await click(await center('[data-drawing-selection-action="toggle-color"]'));
  await pause(3150);
  assert.equal(await hidden(), false, 'choosing a color and closing its menu does not restore the timeout');
  await js(`(()=>{const color=JSON.parse(${JSON.stringify(original)})[0].color;if(color===undefined)delete d.drawings[0].color;else d.drawings[0].color=color;d.redraw()})()`);
  await click(line);
  const blank = {x:Math.round(bounds.x+70),y:Math.round(bounds.y+320)};
  assert.equal(await visibleHandles(), 2, 'drawing click restores both endpoints');
  await click(blank);
  assert.equal(await hidden(), true, 'native click on chart background immediately hides toolbar');
  assert.equal(await visibleHandles(), 0, 'native background click also immediately hides endpoints');
  assert.equal(await js('d.drawingHandlesHideTimer'), null, 'background click clears the endpoint timer');
  await js('d.redraw()'); await settle();
  assert.equal(await visibleHandles(), 0, 'redraw cannot restore endpoints after background click');
  assert.equal(await js('JSON.stringify(d.drawings)'), original, 'background click preserves drawing geometry and style');
  await capture('blank-click-hidden');
  await click(line);
  assert.equal(await visibleHandles(), 2, 'reselect restores endpoints after background dismissal');
  await js(`d.overlay.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:42}))`);
  assert.equal(await hidden(), true, 'empty overlay background also dismisses toolbar');
  assert.equal(await visibleHandles(), 0, 'empty overlay background also immediately hides endpoints');
  await click(line);
  await js(`d.selectionToolbar.querySelector('[data-drawing-selection-action="hide-toolbar"]').click()`);
  assert.equal(await hidden(), true);
  assert.equal(await visibleHandles(), 2, 'manual toolbar close leaves endpoints available until background click');
  await click(blank);
  assert.equal(await visibleHandles(), 0, 'background click hides endpoints even if toolbar was already hidden');
  await click(line);
  const grip = await center('.trading-drawing-selection-grip');
  pointer('mouseMove',grip); pointer('mouseDown',grip);
  const moved = {x:grip.x+40,y:grip.y+20}; pointer('mouseMove',moved);
  await pause(3200);
  assert.equal(await hidden(), false, 'toolbar remains during a long drag');
  pointer('mouseUp',moved); await settle();
  await pause(3150);
  assert.equal(await hidden(), true, 'toolbar drag release starts a fresh timer');
  await click(line);
  const handle = await center('[data-drawing-handle-index="0"]');
  pointer('mouseMove',handle); pointer('mouseDown',handle);
  await pause(3200);
  assert.equal(await hidden(), false, 'drawing drag keeps toolbar visible');
  pointer('mouseUp',handle); await settle();
  await pause(3150);
  assert.equal(await hidden(), true, 'drawing drag release starts a fresh timer');
  // Exhaustive boundary and re-selection checks, including both toolbar modes.
  const catalogAudit = await js(`(async()=>{
    const {TRADING_DRAWING_TOOLS,tradingDrawingRequiredPointCount,tradingDrawingIsMultiPoint}=await import('/trading-expert-drawing.ts');
    d.selectDrawing(null);
    const nativeSetTimeout=window.setTimeout,nativeClearTimeout=window.clearTimeout;
    const timers=new Map();let now=0,nextId=100000000;
    window.setTimeout=(callback,delay,...args)=>{if(delay!==3000)return nativeSetTimeout(callback,delay,...args);const id=++nextId;timers.set(id,{due:now+delay,callback:()=>callback(...args)});return id};
    window.clearTimeout=id=>{if(!timers.delete(id))nativeClearTimeout(id)};
    const advance=ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.due<=now){timers.delete(id);timer.callback()}};
    const check=(ok,label)=>{if(!ok)throw Error(label)};
    const checked=[];
    try {
      for(const tool of TRADING_DRAWING_TOOLS.filter(t=>!['cursor','eraser'].includes(t.kind))){
        const count=tool.freehand||tradingDrawingIsMultiPoint(tool.id)?7:tradingDrawingRequiredPointCount(tool);
        const points=Array.from({length:count},(_,i)=>({time:workspace.candles.at(-85+Math.round(i*60/Math.max(1,count-1))).time,price:1315+i*2}));
        const drawing={id:'toolbar-'+tool.id,tool:tool.id,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points,text:'User note'};
        d.drawings=[drawing];d.selectDrawing(drawing.id);
        check(!d.selectionToolbar.hidden,tool.id+': initial appearance');
        const original=JSON.stringify(drawing);
        advance(2999);d.redraw();check(!d.selectionToolbar.hidden,tool.id+': hidden early');
        advance(1);check(d.selectionToolbar.hidden,tool.id+': not hidden at 3000ms');
        d.redraw();check(d.selectionToolbar.hidden,tool.id+': redraw restored toolbar');
        check(JSON.stringify(drawing)===original,tool.id+': changed drawing');
        d.selectDrawing(drawing.id);advance(2000);d.selectDrawing(drawing.id);advance(1500);
        check(!d.selectionToolbar.hidden,tool.id+': repeated selection must restart timer');
        advance(1500);check(d.selectionToolbar.hidden,tool.id+': reselected timeout');
        drawing.locked=true;d.selectDrawing(drawing.id);advance(3000);
        check(d.selectionToolbar.hidden,tool.id+': locked drawing timeout');
        d.selectDrawing(drawing.id);
        check([...d.content.querySelectorAll('.trading-drawing-handle')].some(e=>getComputedStyle(e).visibility==='visible'),tool.id+': missing endpoints before background click');
        d.overlay.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:42}));
        d.redraw();
        check(d.selectionToolbar.hidden,tool.id+': background click did not hide toolbar');
        check([...d.content.querySelectorAll('.trading-drawing-handle')].every(e=>getComputedStyle(e).visibility!=='visible'&&getComputedStyle(e).pointerEvents==='none'),tool.id+': background click did not hide endpoints');
        checked.push({tool:tool.id,mode:d.selectionToolbar.dataset.mode});
      }
      d.drawings[0].tool='text';d.drawings[0].locked=false;d.selectDrawing(d.drawings[0].id);
      d.selectionToolbar.querySelector('[data-drawing-selection-action="edit-text"]').click();
      const input=d.textInputElement();input.focus();input.value='未确认草稿';input.setSelectionRange(2,2);
      advance(5000);d.redraw();
      check(!d.selectionToolbar.hidden&&document.activeElement===input&&input.value==='未确认草稿'&&input.selectionStart===2,'text draft and focus are preserved');
      d.selectionToolbar.querySelector('[data-drawing-selection-action="confirm-text"]').click();
      check(d.drawings[0].text==='未确认草稿','confirm still saves text');
      advance(6000);d.redraw();check(!d.selectionToolbar.hidden,'text toolbar stays open after confirmation');
      for(const [tool,actions] of [
        ['trend-line',['reset','toggle-color','toggle-style','set-style','toggle-width','set-width','settings','toggle-lock']],
        ['text',['reset-text','edit-text','close-text-input','clear-text','confirm-text','toggle-text-color','toggle-text-background','toggle-font-size','set-font-size','toggle-bold','toggle-lock']],
      ]) {
        for(const action of actions) {
          d.selectDrawing(null);
          const drawing={id:'action-'+tool+'-'+action,tool,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points:[{time:workspace.candles.at(-85).time,price:1315},{time:workspace.candles.at(-25).time,price:1325}],text:'User note'};
          d.drawings=[drawing];d.selectDrawing(drawing.id);advance(2900);
          const mode=d.selectionToolbar.querySelector('[data-drawing-selection-mode="'+d.selectionToolbar.dataset.mode+'"]');
          mode.querySelector('[data-drawing-selection-action="'+action+'"]').click();
          if(action==='settings')d.horizontalLineSettings.close();
          advance(6000);d.redraw();
          check(!d.selectionToolbar.hidden,action+': interaction must cancel auto hide');
          check(d.selectionToolbarHideTimer===null,action+': timer must stay cancelled');
          d.selectDrawing(drawing.id);advance(6000);
          check(!d.selectionToolbar.hidden,action+': selecting the active drawing must not restore the timer');
          d.selectionToolbar.querySelector('[data-drawing-selection-action="hide-toolbar"]').click();
          check(d.selectionToolbar.hidden,action+': manual close still works');
          d.selectDrawing(drawing.id);advance(3000);
          check(d.selectionToolbar.hidden,action+': reopening starts a fresh timeout');
        }
      }
      d.selectDrawing(d.drawings[0].id);
      d.selectionToolbar.querySelector('[data-drawing-selection-mode="text"] [data-drawing-selection-action="toggle-visibility"]').click();
      check(d.drawingVisibility.isHidden(d.drawings[0]),'hide button still hides drawing');
      advance(3000);check(d.selectionToolbar.hidden,'hide button does not cancel auto hide');
      d.drawingVisibility.toggle(d.drawings[0]);d.selectDrawing(d.drawings[0].id);
      d.selectionToolbar.querySelector('[data-drawing-selection-mode="text"] [data-drawing-selection-action="reset-text"]').click();
      const second={...d.drawings[0],id:'another-drawing'};d.drawings.push(second);d.selectDrawing(second.id);
      advance(3000);check(d.selectionToolbar.hidden,'interacting with one drawing does not pin another toolbar');
      d.selectDrawing(second.id);
      d.selectionToolbar.querySelector('[data-drawing-selection-mode="text"] [data-drawing-selection-action="delete"]').click();
      check(!d.drawings.includes(second)&&d.selectionToolbar.hidden,'delete removes drawing and closes toolbar');
      d.selectDrawing(d.drawings[0].id);d.selectDrawing(null);
      check(d.selectionToolbarHideTimer===null,'deselect clears timer');
      d.selectDrawing(d.drawings[0].id);d.setUserDrawingEnabled(false);
      check(d.selectionToolbarHideTimer===null&&d.selectionToolbar.hidden,'disable clears timer');d.setUserDrawingEnabled(true);
      d.selectDrawing(d.drawings[0].id);d.switchStorageSession('toolbar-qa-next');
      check(d.selectionToolbarHideTimer===null&&d.selectionToolbar.hidden,'session switch clears timer');
    } finally {d.selectDrawing(null);window.setTimeout=nativeSetTimeout;window.clearTimeout=nativeClearTimeout;}
    return checked;
  })()`);
  assert.ok(catalogAudit.length >= 98);
  await js(`document.documentElement.dataset.theme='dark';workspace.applyChartTheme();d.drawings=[{id:'dark-line',tool:'horizontal-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-50).time,price:1320}]}];d.selectDrawing('dark-line')`);
  await settle(); await capture('visible-dark');
  await pause(3150); assert.equal(await hidden(), true); await capture('hidden-dark');
  await js(`d.selectDrawing('dark-line');d.destroy()`);
  assert.equal(await js('d.selectionToolbarHideTimer'), null, 'destroy clears timer');
  assert.equal(await js('String(window.qaError || "")'), '');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({result:'PASS',idleMs:3000,catalogAudit,checks:['real timer','new drawing','drawing click restart','toolbar actions cancel auto hide','hide and delete exceptions','reopen and selection reset','hover/redraw stability','native chart click hides toolbar and endpoints','empty overlay click hides toolbar and endpoints','background click with toolbar already hidden','toolbar and drawing drag','color menu','text editing','deselect/disable/session/destroy cleanup','light/dark']},null,2));
  console.log('PASS: '+catalogAudit.length+' drawing tools, toolbar actions cancel auto hide, hide/delete exceptions, background dismissal, 3-second idle before interaction, drag, menus, text input, themes and cleanup');
  win.destroy();app.quit();
})().catch(error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));win?.destroy();app.exit(1)});
