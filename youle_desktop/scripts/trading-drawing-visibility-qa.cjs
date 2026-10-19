// Synthetic market, isolated profile, real Electron clicks on both eye buttons.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-visibility-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  setTimeout(() => app.exit(1), 120000).unref();
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1320, height: 900,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const clickPoint = async point => {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await settle();
  };
  const click = async selector => clickPoint(await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`));
  const capture = async name => fs.writeFileSync(path.join(output, name+'.png'), (await win.webContents.capturePage()).toPNG());
  const eye = '[data-drawing-selection-mode="drawing"] [data-drawing-selection-action="toggle-visibility"]';
  const aiEye = '[data-ai-text-size-action="toggle-visibility"]';
  const snapshot = () => js('JSON.stringify({manual:d.drawings,ai:d.aiDrawings,redo:d.redoStack})');
  const cases = [];
  for (const theme of ['light', 'dark']) {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
    for(let i=0;i<120&&!await js('Boolean(window.ready)');i++)await pause(100);
    assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}';document.querySelector('#host').style.cssText='width:100%;height:100%';
      workspace.loadingHistory=true;workspace.applyChartTheme();window.d=workspace.drawingController;
      d.switchStorageSession('visibility-${theme}-'+Date.now());d.drawings=[];d.aiDrawings=[];d.selectTool('trend-line');void 0`);
    await settle();
    const origin = await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y}})()');
    const blank = {x:Math.round(origin.x+110),y:Math.round(origin.y+320)};
    await clickPoint({x:Math.round(origin.x+230),y:Math.round(origin.y+180)});
    await clickPoint({x:Math.round(origin.x+650),y:Math.round(origin.y+270)});
    const original = await snapshot();
    await capture(theme+'-visible');
    await click(eye);
    assert.equal(await js('d.content.childElementCount'),0,'all manual geometry and handles hidden');
    assert.equal(await js('d.axisMarkerLayer.childElementCount'),0,'axis labels hidden too');
    assert.equal(await snapshot(),original,'hide preserves geometry and undo');
    await pause(3150);
    assert.equal(await js('d.selectionToolbar.hidden'),true,'idle toolbar still dismisses');
    await clickPoint(blank);
    assert.equal(await js('d.selectionToolbar.hidden'),false,'native blank canvas click restores toolbar');
    assert.equal(await js(`document.querySelector('${eye}').getAttribute('aria-pressed')`),'true');
    await capture(theme+'-hidden');
    await click(eye);
    assert.ok(await js('d.content.childElementCount')>0);
    assert.equal(await snapshot(),original);
    // Multiple hidden drawings, visible line selection, horizontal labels, and deletion.
    await js(`window.line=d.drawings[0];d.drawings.push({...line,id:'second',tool:'horizontal-line',points:[{...line.points[0],price:line.points[0].price+5}]});
      d.selectDrawing(line.id);void 0`);
    await click(eye);
    await js(`d.selectDrawing('second')`);await click(eye);
    await js('d.selectDrawing(null)');await clickPoint(blank);
    assert.equal(await js('d.selectedDrawingId'),'second');
    await click(eye);await clickPoint(blank);
    assert.equal(await js('d.selectedDrawingId'),await js('line.id'),'next hidden line stays reachable');
    await click(eye);
    await click('[data-drawing-selection-mode="drawing"] [data-drawing-selection-action="delete"]');
    await clickPoint(blank);
    assert.equal(await js('d.drawings.some(x=>x.id===line.id)'),false,'deleted drawing cannot reappear');
    await js('d.redo();d.selectDrawing(null)');
    // AI includes text, a segment, and another market: hide is session scoped.
    await js(`d.aiDrawings=[
      {id:'ai-note',tool:'note',source:'ai',symbol:d.getSymbol(),interval:d.getInterval(),fontSize:10,colorToken:'chan-note',text:'结构参考：等待确认',points:[{time:workspace.candles.at(-40).time,price:workspace.candles.at(-40).close}]},
      {...line,id:'ai-line',tool:'path',source:'ai',colorToken:'chan-pen'},
      {...line,id:'other-market',tool:'path',source:'ai',colorToken:'chan-pen',symbol:'other-market'}];d.redraw();void 0`);
    await settle();
    const withAi = await snapshot();
    assert.ok(await js('d.aiContent.childElementCount')>0);
    await capture(theme+'-ai-visible');await click(aiEye);
    assert.equal(await js('d.aiContent.childElementCount+d.aiTextHitContent.childElementCount+d.aiCursorContent.childElementCount'),0);
    assert.ok(await js('d.content.childElementCount')>0,'AI eye leaves manual drawings visible');
    assert.equal(await snapshot(),withAi);
    await click('[data-ai-text-size-action="dismiss"]');
    assert.equal(await js('d.aiTextSizeToolbar.hidden'),true);
    await clickPoint(blank);
    assert.equal(await js('d.aiTextSizeToolbar.hidden'),false,'canvas click reopens dismissed hidden AI controls');
    await capture(theme+'-ai-hidden');await click(aiEye);
    assert.ok(await js('d.aiContent.childElementCount')>0);
    assert.equal(await snapshot(),withAi);
    // Saved display state survives controller recreation/session changes.
    await click(aiEye);await js(`d.selectDrawing(line.id)`);await click(eye);
    await js(`window.savedSession=d.storageSessionId;d.persistDrawings();d.persistAiDrawings();d.switchStorageSession(savedSession+'-other')`);
    assert.equal(await js('d.drawingVisibility.aiHidden'),false);
    await js('d.switchStorageSession(savedSession);d.redraw()');await clickPoint(blank);
    assert.equal(await js('d.drawingVisibility.aiHidden'),true);
    assert.equal(await js('d.selectionToolbar.hidden'),false);
    assert.equal(await js('d.content.querySelector(`[data-drawing-id="${line.id}"]`)===null'),true);
    await click(eye);await click(aiEye);
    // Fresh AI results received while hidden remain hidden without losing data.
    await click(aiEye);
    await js(`d.aiDrawings.push({...d.aiDrawings[0],id:'new-ai'});d.aiDraft={...d.aiDrawings[0],id:'draft-ai'};d.aiCursorPoint=d.aiDrawings[0].points[0];d.redraw()`);
    assert.equal(await js('d.aiContent.childElementCount+d.aiTextHitContent.childElementCount+d.aiCursorContent.childElementCount'),0);
    await js('d.aiDraft=null;d.aiCursorPoint=null');await click(aiEye);
    assert.equal(await js('d.aiDrawings.some(x=>x.id==="new-ai")'),true);
    // Geometry-only AI still has an eye, even when no text label is on screen.
    await js(`d.aiDrawings=d.aiDrawings.filter(x=>x.tool!=='note');d.redraw()`);
    assert.equal(await js('d.aiTextSizeToolbar.hidden'),false);
    assert.equal(await js(`d.aiTextSizeToolbar.querySelector('[data-ai-text-size-action="increase"]').disabled`),true);
    await click(aiEye);await clickPoint(blank);await click(aiEye);
    // Split charts share the same conversation visibility preference.
    await js(`workspace.splitLayoutId='2-columns';workspace.applySplitLayout()`);
    for(let i=0;i<100&&!await js('workspace.splitPanes[0]?.candles.length');i++)await pause(50);
    await js(`window.split=workspace.splitPanes[0].drawingController;split.switchStorageSession(d.storageSessionId);
      split.aiDrawings=[{...d.aiDrawings[0],id:'split-ai',symbol:split.getSymbol(),interval:split.getInterval()}];split.redraw();
      d.drawingVisibility.toggleAi()`);
    assert.equal(await js('split.drawingVisibility.aiHidden'),true);
    assert.equal(await js('split.aiContent.childElementCount'),0);
    await js('split.drawingVisibility.toggleAi()');
    assert.equal(await js('d.drawingVisibility.aiHidden'),false);
    assert.ok(await js('d.aiContent.childElementCount')>0);
    await js(`workspace.splitLayoutId='1-single';workspace.applySplitLayout();d.selectDrawing(d.drawings[0].id)`);
    // Eye labels update in all supported languages, including redraw mutations.
    await js(`(async()=>{const m=await import('/app-language.mjs');m.observeAppLanguage(document.body)})()`);
    for (const language of ['en','zh-TW','zh-CN']) {
      await js(`(async()=>{const m=await import('/app-language.mjs');m.applyAppLanguage('${language}',{root:document.body});m.localizeAppTree(document.body,'${language}')})()`);
      await settle();
      const labels = await js(`[document.querySelector('${eye}'),document.querySelector('${aiEye}')].map(x=>x.title)`);
      if(language==='en')assert.ok(labels.every(label=>!/[\u3400-\u9fff]/.test(label)),JSON.stringify(labels));
      if(language==='zh-TW')assert.ok(labels.every(label=>label.includes('隱藏')),JSON.stringify(labels));
    }
    const tools = await js(`(async()=>{
      const m=await import('/trading-expert-drawing.ts');const checked=[];
      d.aiDrawings=[];d.selectDrawing(null);d.redoStack=[];
      for(const tool of m.TRADING_DRAWING_TOOLS.filter(t=>!['cursor','eraser'].includes(t.kind))){
        const count=tool.freehand||m.tradingDrawingIsMultiPoint(tool.id)?7:m.tradingDrawingRequiredPointCount(tool);
        d.drawings=[{id:'visibility-'+tool.id,tool:tool.id,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',
          points:Array.from({length:count},(_,i)=>({time:workspace.candles.at(-85+Math.round(i*60/Math.max(1,count-1))).time,price:1315+i*2})),text:'User note'}];
        d.selectDrawing(d.drawings[0].id);const before=JSON.stringify(d.drawings);
        const button=d.selectionToolbar.querySelector('[data-drawing-selection-mode]:not([hidden]) [data-drawing-selection-action="toggle-visibility"]');
        if(!button||button.nextElementSibling?.dataset.drawingSelectionAction!=='delete')throw Error(tool.id+': eye placement');
        button.click();d.redraw();
        if(d.content.childElementCount||d.axisMarkerLayer.childElementCount)throw Error(tool.id+': hidden drawing still rendered');
        d.selectDrawing(null);
        d.overlay.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:42}));
        if(d.selectionToolbar.hidden||button.getAttribute('aria-pressed')!=='true')throw Error(tool.id+': recovery unavailable');
        button.click();
        if(!d.content.childElementCount||JSON.stringify(d.drawings)!==before)throw Error(tool.id+': restore changed drawing');
        checked.push(tool.id);
      }
      return checked;
    })()`);
    assert.ok(tools.length>=98);
    cases.push({theme,passed:true,tools});console.log('PASS '+theme+': '+tools.length+' drawing types');
    await js('workspace.destroy()');
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,cases},null,2));
  win.destroy();app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
