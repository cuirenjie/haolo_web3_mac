// Isolated renderer QA: synthetic candles, native mouse/keyboard input, no account data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/drawing-center-text-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { tools: [], themes: [], interactions: [] }; let win;
(async () => {
  setTimeout(() => app.exit(1), 240000).unref(); await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(20); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const move = async p => { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) }); await settle(); };
  const click = async p => { await move(p); for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }); await settle(); };
  const clickElement = async selector => {
    // SVG labels may be rotated or intersect an endpoint. Find an actual
    // exposed point in the action instead of clicking its axis-aligned bbox.
    const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();for(const fx of [.5,.25,.75,.1,.9])for(const fy of [.5,.25,.75]){const x=Math.round(r.x+r.width*fx),y=Math.round(r.y+r.height*fy),hit=document.elementFromPoint(x,y);if(e===hit||e.contains(hit))return {x,y};}throw Error('Obscured '+${JSON.stringify(selector)})})()`);
    await click(p);
  };
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5183}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
    for (let i = 0; i < 100 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`(async()=>{window.d=workspace.drawingController;window.api=await import('/trading-expert-drawing.ts');window.sync=await import('/manual-drawing-sync.ts');workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.selectTool('crosshair')})()`); await settle();
  };
  await load();
  const setup = async tool => {
    await move({ x: 5, y: 5 });
    await js(`(()=>{d.horizontalLineSettings.close();d.selectTool('crosshair');d.selectDrawing(null);const tool=api.tradingDrawingToolDefinition(${JSON.stringify(tool)}),count=tool.freehand||api.tradingDrawingIsMultiPoint(tool.id)?5:api.tradingDrawingRequiredPointCount(tool);const coords=count===1?[{x:470,y:230}]:count===2?[{x:260,y:190},{x:690,y:280}]:Array.from({length:count},(_,i)=>({x:260+i*430/(count-1),y:i%2?280:180}));if(tool.id==='circle')coords[1]={x:350,y:210};if(tool.id==='rotated-rectangle')coords.splice(0,coords.length,{x:260,y:170},{x:690,y:260},{x:650,y:320});d.drawings=[{id:'center-'+tool.id,tool:tool.id,symbol:d.getSymbol(),interval:d.getInterval(),drawingScope:'main',points:coords.map(p=>d.screenToDrawingPoint(p,false))}];d.selectionToolbarPosition={x:150,y:10};d.selectDrawing(d.drawings[0].id);d.redraw()})()`); await settle();
  };
  const center = '[data-drawing-text-position="center"]';
  const tools = await js('api.TRADING_DRAWING_TOOLS.filter(t=>api.tradingDrawingSupportsSettings(t.id)).map(t=>t.id)');
  for (const theme of ['light', 'dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme()`);
    for (const tool of tools) {
      report.current = { tool, theme }; await setup(tool);
      const state = await js(`(()=>{const g=d.content.querySelector('[data-drawing-id]'),prompt=g.querySelector('${center}');return {prompt:!!prompt,opacity:prompt&&getComputedStyle(prompt).opacity,hidden:api.tradingDrawingHidesLineNodes(d.drawings[0].tool),handles:[...g.querySelectorAll('.trading-drawing-handle')].map(e=>getComputedStyle(e).opacity)}})()`);
      assert.equal(state.prompt, true, tool + ' center entry'); assert.equal(state.opacity, '1', tool);
      if (state.hidden) state.handles.forEach(opacity => assert.equal(opacity, '0', tool + ' hidden node'));
      else state.handles.forEach(opacity => assert.equal(opacity, '1', tool + ' shape node'));
      const before = await js('JSON.stringify(d.drawings[0])');
      await clickElement(center); assert.equal(await js('d.horizontalLineSettings.open'), true, tool + ' native click');
      assert.deepEqual(await js(`[document.querySelector('[name="textAlign"]').value,document.querySelector('[name="textVerticalAlign"]').value,document.activeElement.name]`), ['center', 'middle', 'text'], tool);
      await win.webContents.insertText('中心文字 <安全>');
      await clickElement('.trading-horizontal-line-dialog [type="submit"]');
      assert.equal(await js('d.horizontalLineSettings.open'), false, tool + ' save');
      const next = await js('JSON.stringify(d.drawings[0])');
      const oldModel = JSON.parse(before), nextModel = JSON.parse(next);
      assert.equal(nextModel.text, '中心文字 <安全>', tool);
      for (const key of Object.keys(oldModel)) if (!['text', 'textAlign', 'textVerticalAlign', 'textColor', 'fontSize', 'bold', 'italic'].includes(key)) assert.deepEqual(nextModel[key], oldModel[key], tool + ' preserves ' + key);
      assert.equal(await js(`d.content.querySelector('.trading-drawing-label text')?.textContent`), nextModel.text, tool + ' rendered label');
      assert.equal(await js(`d.content.querySelectorAll('${center}').length`), 0, tool + ' no duplicate prompt');
      assert.equal(await js(`sync.drawingFromWire(sync.drawingToWire(d.drawings[0]),d.getSymbol()).text`), nextModel.text, tool + ' sync');
      if (['trend-line', 'circle', 'highlighter', 'rotated-rectangle', 'forecast', 'anchored-vwap'].includes(tool)) await capture(theme + '-' + tool);
      report.tools.push({ tool, theme, handles: state.handles.length });
    }
    report.themes.push(theme);
    console.log(theme + ': ' + tools.length + ' tool text/handle checks passed');
  }
  for (const tool of ['trend-line', 'curve', 'multi-point-path', 'parallel-channel', 'rectangle', 'rotated-rectangle']) {
    await setup(tool);
    const before = await js('JSON.stringify(d.drawings[0])');
    await clickElement(center); await win.webContents.insertText('取消不保存');
    await clickElement('[data-line-cancel]'); assert.equal(await js('JSON.stringify(d.drawings[0])'), before, tool + ' cancel');
    const p = await js(`(()=>{const g=d.content.querySelector('[data-drawing-id]'),h=g.querySelector('[data-drawing-handle-index="0"]'),r=h.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await move(p);
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }); await settle();
    assert.equal(await js('d.dragState?.handleIndex'), 0, tool + ' invisible handle hit');
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x + 25), y: Math.round(p.y + 18), button: 'left', modifiers: ['leftButtonDown'] });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(p.x + 25), y: Math.round(p.y + 18), button: 'left', clickCount: 1 }); await settle();
    assert.notEqual(await js('JSON.stringify(d.drawings[0].points)'), JSON.stringify(JSON.parse(before).points), tool + ' endpoint changed');
    await clickElement(center); await win.webContents.insertText('可编辑'); await clickElement('.trading-horizontal-line-dialog [type="submit"]');
    await clickElement('[data-horizontal-line-edit-text]'); assert.equal(await js(`document.activeElement.classList.contains('trading-horizontal-line-inline-input')`), true, tool + ' inline editor');
    await js('document.activeElement.select()'); await win.webContents.insertText('编辑完成');
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Enter' }); await settle();
    assert.equal(await js('d.drawings[0].text'), '编辑完成', tool);
    report.interactions.push(tool);
  }
  const persistedFields = `({points:d.drawings[0].points,text:d.drawings[0].text,textColor:d.drawings[0].textColor,fontSize:d.drawings[0].fontSize,textAlign:d.drawings[0].textAlign,textVerticalAlign:d.drawings[0].textVerticalAlign})`;
  const saved = await js('d.persistDrawings();' + persistedFields); await load();
  assert.deepEqual(await js(persistedFields), saved, 'reload preserves text, appearance and anchors');
  await js(`d.drawings=[];d.selectDrawing(null);d.selectTool('trend-line')`);
  const origin = await js('(()=>{const r=d.overlay.getBoundingClientRect();return {x:r.x,y:r.y}})()');
  const a = { x: origin.x + 260, y: origin.y + 190 }, b = { x: origin.x + 690, y: origin.y + 280 };
  await click(a); await move(b);
  assert.equal(await js(`d.content.querySelectorAll('${center}').length`), 0, 'no text action during drawing');
  assert.equal(await js(`[...d.content.querySelectorAll('.trading-drawing-handle')].every(e=>getComputedStyle(e).opacity==='0')`), true, 'draft nodes hidden');
  await click(b);
  const beforeMove = await js('d.drawings[0].points.map(p=>d.pointToScreen(p))');
  const body = { x: a.x * .8 + b.x * .2, y: a.y * .8 + b.y * .2 }; await move(body);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(body.x), y: Math.round(body.y), button: 'left', clickCount: 1 }); await settle();
  assert.equal(await js('d.dragState?.handleIndex'), -1, 'whole line hit');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(body.x + 30), y: Math.round(body.y + 20), button: 'left', modifiers: ['leftButtonDown'] });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(body.x + 30), y: Math.round(body.y + 20), button: 'left', clickCount: 1 }); await settle();
  const afterMove = await js('d.drawings[0].points.map(p=>d.pointToScreen(p))');
  beforeMove.forEach((p,i)=>{assert.ok(Math.abs(afterMove[i].x-p.x-30)<1,'body drag x');assert.ok(Math.abs(afterMove[i].y-p.y-20)<1,'body drag y');});
  report.interactions.push('draft and whole-line drag');
  await setup('trend-line');
  await js(`d.drawings[0].locked=true;d.redraw()`); assert.equal(await js(`d.content.querySelectorAll('${center}').length`), 0, 'locked');
  await js(`d.drawings[0].locked=false;d.drawings[0].source='ai';d.redraw()`); assert.equal(await js(`d.content.querySelectorAll('${center}').length`), 0, 'AI excluded');
  delete report.current; report.result = 'PASS'; fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, tools: report.tools.length, themes: report.themes, interactions: report.interactions, output })); app.quit();
})().catch(async error => {
  report.error = error.stack; fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (win) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  console.error(error.stack); app.exit(1);
});
