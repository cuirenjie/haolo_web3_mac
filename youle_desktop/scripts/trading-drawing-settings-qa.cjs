// Run against an isolated Vite renderer with synthetic candles, using native input.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'drawing-settings-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(30); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const click = async (selector, count = 1) => {
    const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...p});
    win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:count});
    win.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:count}); await settle();
  };
  const load = async () => {
    await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5196}/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
    for(let i=0;i<120&&!await js('Boolean(window.ready)');i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'),true,await js('String(window.qaError)'));
    await js(`(async()=>{document.querySelector('#host').style.cssText='width:100%;height:100%';window.d=workspace.drawingController;workspace.loadingHistory=true;window.api=await import('/trading-expert-drawing.ts');window.lang=await import('/app-language.mjs');lang.observeAppLanguage(document.body)})()`); await settle();
  };
  const field = async (name,value) => js(`(()=>{const e=document.querySelector('.trading-horizontal-line-dialog [name="${name}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const confirm = () => click('.trading-horizontal-line-dialog [type="submit"]');
  const cancel = () => click('.trading-horizontal-line-dialog footer [data-line-cancel]');
  await load();
  const tools = await js('api.TRADING_DRAWING_TOOLS.filter(t=>api.tradingDrawingSupportsSettings(t.id)).map(t=>({id:t.id,label:t.label}))');
  const report = { result:'PASS', tools:[], nativeInline:[], locales:[], coordinates:true, persistence:true };
  for (const tool of tools) {
    // Each fixture is a new selection; do not carry the previous tool's
    // deliberately retained toolbar position into another geometry.
    await js('d.selectDrawing(null)');
    await js(`(()=>{const def=api.tradingDrawingToolDefinition(${JSON.stringify(tool.id)});const n=Math.max(api.tradingDrawingRequiredPointCount(def),def.freehand||api.tradingDrawingIsMultiPoint(def.id)?4:1);d.drawings=[{id:'generic-qa',tool:def.id,symbol:d.getSymbol(),interval:d.getInterval(),points:Array.from({length:n},(_,i)=>({time:workspace.candles.at(-100+Math.round(i*60/Math.max(1,n-1))).time,price:1320-i*20/Math.max(1,n-1)}))}];d.selectTool('crosshair');d.selectDrawing('generic-qa')})()`); await settle();
    assert.equal(await js(`d.selectionToolbar.querySelector('[data-horizontal-line-settings]').hidden`),false,tool.id);
    assert.equal(await js(`!!d.content.querySelector('[data-horizontal-line-add-text]')`),true,'add text '+tool.id);
    const before = await js('JSON.stringify(d.drawings[0].points)');
    // The shared action is now hover-only; keyboard focus remains an explicit
    // way to reveal it when testing every tool's settings route.
    await js(`d.content.querySelector('[data-horizontal-line-add-text]').focus()`); await settle();
    await click('[data-horizontal-line-add-text="generic-qa"]');
    assert.equal(await js(`d.horizontalLineSettings.open && document.querySelector('[data-line-tab="text"]').getAttribute('aria-selected')==='true' && document.activeElement.matches('textarea')`),true,tool.id);
    assert.equal(await js('d.dragState===null'),true);
    await field('text','临时草稿'); await cancel();
    assert.equal(await js('d.drawings[0].text??null'),null);
    await click('[data-horizontal-line-settings]');
    assert.equal(await js(`document.querySelector('.trading-horizontal-line-dialog h2').textContent`),tool.label);
    await field('text','共同备注 Shared'); await field('textColor','#ef5350'); await field('fontSize','20');
    await field('textAlign','right'); await field('textVerticalAlign','top');
    await js(`document.querySelector('[data-line-toggle="bold"]').click();document.querySelector('[data-line-toggle="italic"]').click()`);
    await confirm();
    assert.equal(await js('d.horizontalLineSettings.open'),false,tool.id);
    assert.equal(await js('JSON.stringify(d.drawings[0].points)'),before,'style edit preserves all points '+tool.id);
    assert.equal(await js(`d.content.querySelectorAll('.trading-horizontal-line-text').length`),1,tool.id);
    assert.equal(await js(`d.content.querySelector('.trading-horizontal-line-text').getAttribute('fill')`),'#ef5350');
    report.tools.push(tool.id);
    if (['trend-line','ray','vertical-line','rectangle','fib-retracement','multi-point-polyline','brush','parallel-channel'].includes(tool.id)) {
      await click('[data-horizontal-line-edit-text="generic-qa"]');
      assert.equal(await js(`document.activeElement.matches('.trading-horizontal-line-inline-input')`),true,tool.id);
      await js('document.activeElement.select()'); await win.webContents.insertText('原位编辑 Inline');
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'}); await settle();
      assert.equal(await js('d.drawings[0].text'),'原位编辑 Inline',tool.id);
      assert.equal(await js('JSON.stringify(d.drawings[0].points)'),before);
      report.nativeInline.push(tool.id);
    }
  }
  // Independent coordinates, retained drafts when switching points, closed paths.
  await js(`d.drawings=[{id:'generic-qa',tool:'multi-point-polyline',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-100).time,price:1330},{time:workspace.candles.at(-70).time,price:1300},{time:workspace.candles.at(-40).time,price:1310},{time:workspace.candles.at(-100).time,price:1330}]}];d.selectDrawing('generic-qa');d.redraw()`);await settle();
  const original = await js('d.drawings[0].points');
  await click('[data-horizontal-line-settings]'); await click('[data-line-tab="coordinates"]');
  assert.equal(await js(`document.querySelector('[name="coordinatePoint"]').options.length`),3);
  await field('price','1332'); await field('coordinatePoint','1'); await field('price','1302'); await field('time','2026-10-18T08:15:00');
  await field('coordinatePoint','0'); assert.equal(await js(`document.querySelector('[name="price"]').value`),'1332');
  await confirm();
  const points = await js('d.drawings[0].points');
  assert.equal(points[0].price,1332);assert.deepEqual(points[3],points[0]);assert.deepEqual(points[2],original[2]);
  assert.equal(points[1].price,1302);assert.equal(points[1].time,Date.parse('2026-10-18T08:15:00Z')/1000);
  // A native double click on the sloping stroke opens settings without maximizing panes.
  await js(`d.drawings=[{id:'generic-qa',tool:'trend-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:workspace.candles.at(-100).time,price:1330},{time:workspace.candles.at(-40).time,price:1305}],text:'趋势线备注'}];d.selectDrawing(null);d.redraw()`);await settle();
  const heights = await js('d.getChart().panes().map(p=>p.getHeight())');
  const point = await js(`(()=>{const r=d.overlay.getBoundingClientRect(),a=d.pointToScreen(d.drawings[0].points[0]),b=d.pointToScreen(d.drawings[0].points[1]);return {x:Math.round(r.x+a.x*.8+b.x*.2),y:Math.round(r.y+a.y*.8+b.y*.2)}})()`);
  for (const count of [1,2]) {win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:count});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:count});await settle();}
  assert.equal(await js('d.horizontalLineSettings.open'),true);
  assert.deepEqual(await js('d.getChart().panes().map(p=>p.getHeight())'),heights);await cancel();
  for(const language of ['zh-CN','en','zh-TW']) for(const theme of ['light','dark']) {
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();lang.applyAppLanguage('${language}',{root:document.body})`);
    await click('[data-horizontal-line-settings]'); await click('[data-line-tab="coordinates"]');
    const text = await js(`document.querySelector('.trading-horizontal-line-dialog').innerText`);
    if(language==='en') assert.doesNotMatch(text,/[\u4e00-\u9fff]/);
    assert.equal(await js(`(()=>{const e=document.querySelector('.trading-horizontal-line-dialog');return e.scrollWidth===e.clientWidth})()`),true);
    await capture(`coordinates-${language}-${theme}`);await click('[data-line-tab="text"]');await capture(`text-${language}-${theme}`);await cancel();
    report.locales.push(language+'-'+theme);
  }
  await js(`lang.applyAppLanguage('zh-CN',{root:document.body});Object.assign(d.drawings[0],{fontSize:24,textAlign:'left',textVerticalAlign:'bottom',textColor:'#ef5350',bold:true,italic:true});d.persistDrawings()`);
  const saved = await js('d.drawings[0]');await load();const restored=await js('d.drawings[0]');
  for(const key of Object.keys(saved)) assert.deepEqual(restored[key],saved[key],'reload '+key);
  assert.equal(await js('String(window.qaError??"")'),'');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  win.destroy();app.quit();
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1)});
