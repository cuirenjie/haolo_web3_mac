// Isolated real chart and native toolbar clicks; never opens the user's profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'ai-drawing-sets-M1-427');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
(async () => {
  setTimeout(() => app.exit(1), 90000).unref();
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1304, height: 880, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = async code => {
    const result = await win.webContents.executeJavaScript(`(async()=>{try{return {value:await eval(${JSON.stringify(code)})}}catch(e){return {error:String(e.stack)}}})()`, true);
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const next = '[data-ai-text-size-action="next-drawing"]';
  const click = async selector => {
    const point = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(e.hidden||e.disabled)throw Error('Unavailable '+e.outerHTML);return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await settle();
  };
  const current = () => js('d.aiDrawings.filter(x=>x.symbol===d.getSymbol()).map(x=>x.text).filter(Boolean)');
  const position = () => js(`document.querySelector('${next}').textContent.trim()`);
  const capture = async name => {
    await pause(250); await settle();
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const init = async () => {
    for (let i = 0; i < 160 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`window.d=workspace.drawingController; workspace.loadingHistory=true;
      window.makePatch=(id,turn='turn-1')=>{
        const candles=d.getCandles(),a=candles.at(-50),b=candles.at(-12),marketId=d.getSymbol(),interval=d.getInterval();
        return {schemaVersion:1,analysisId:id,drawingTurnId:turn,baseRevision:0,marketId,interval,operations:[
          {op:'upsert',drawing:{id:'same-line-id',symbol:marketId,theory:'chan',layer:'ai/chan',tool:'path',points:[{time:a.time,price:a.low},{time:b.time,price:b.high}],colorToken:'chan-pen',locked:true,status:'confirmed',evidenceIds:[]}},
          {op:'upsert',drawing:{id:'same-note-id',symbol:marketId,theory:'chan',layer:'ai/chan',tool:'note',points:[{time:b.time,price:b.high}],text:id,colorToken:'chan-note',locked:true,status:'confirmed',evidenceIds:[]}}
        ]};
      }; void 0;`);
    await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5197}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  await init();
  await js(`d.clearAllDrawings(); d.storeAiDrawingPatch(makePatch('威科夫：区间结构'));`);
  assert.equal(await js(`getComputedStyle(document.querySelector('${next}')).display`), 'none');
  await js(`d.storeAiDrawingPatch(makePatch('缠论：笔与中枢')); d.storeAiDrawingPatch(makePatch('波浪：主计数'));`);
  await js(`d.drawings=[{id:'manual-kept',tool:'horizontal-line',symbol:d.getSymbol(),points:[{time:d.getCandles().at(-50).time,price:1325}]}];d.persistDrawings();window.manualBefore=JSON.stringify(d.drawings);window.redoBefore=JSON.stringify(d.redoStack);`);
  await settle();
  assert.equal(await position(), '3/3');
  assert.equal(await js(`document.querySelector('${next}').previousElementSibling.dataset.aiTextSizeAction`), 'toggle-visibility');
  for (const [expected, label] of [['威科夫：区间结构','1/3'], ['缠论：笔与中枢','2/3'], ['波浪：主计数','3/3'], ['威科夫：区间结构','1/3']]) {
    await click(next); assert.deepEqual(await current(), [expected]); assert.equal(await position(), label);
  }
  await click('[data-ai-text-size-action="increase"]');
  const font = await js('d.aiDrawings.find(x=>x.tool==="note").fontSize');
  await click(next); await click(next); await click(next);
  assert.equal(await js('d.aiDrawings.find(x=>x.tool==="note").fontSize'), font);
  assert.equal(await js('JSON.stringify(d.drawings)===manualBefore&&JSON.stringify(d.redoStack)===redoBefore'), true);
  await js(`document.querySelector('${next}').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await settle(); assert.equal(await position(), '2/3');
  await click(next); await click(next);
  await capture('switch-light');
  await js('document.documentElement.dataset.theme="dark";d.redraw()'); await settle();
  await capture('switch-dark');
  await click('[data-ai-text-size-action="toggle-visibility"]');
  assert.equal(await js('d.drawingVisibility.aiHidden'), true);
  await click(next);
  assert.equal(await position(), '2/3');
  assert.equal(await js('d.drawingVisibility.aiHidden'), true);
  await click('[data-ai-text-size-action="toggle-visibility"]');
  await js(`d.switchStorageSession('other-thread');d.redraw()`);
  assert.deepEqual(await current(), []);
  await js(`d.switchStorageSession('isolated-navigation-qa');d.redraw()`);
  assert.deepEqual(await current(), ['缠论：笔与中枢']);
  await js(`import('/trading-expert-drawing.ts').then(m=>{m.persistTradingAiDrawingPatch('background',makePatch('后台一'));m.persistTradingAiDrawingPatch('background',makePatch('后台二'));})`);
  await js(`d.switchStorageSession('background');d.redraw()`);
  assert.deepEqual(await current(), ['后台二']);
  await click(next); assert.deepEqual(await current(), ['后台一']);
  await js(`d.switchStorageSession('promoted',{migrateFromSessionId:'background'});d.redraw()`);
  assert.equal(await position(), '1/2');
  await click(next); assert.deepEqual(await current(), ['后台二']);
  await js(`d.switchStorageSession('isolated-navigation-qa');d.redraw()`);
  await win.reload(); await pause(250); await init();
  assert.deepEqual(await current(), ['缠论：笔与中枢']);
  assert.equal(await position(), '2/3');
  // Both the background saver and the mounted controller may see the same receipt.
  await js(`d.storeAiDrawingPatch(makePatch('波浪：主计数'))`);
  assert.equal(await position(), '2/3');
  // Failed validation must preserve the complete previous turn.
  assert.equal(await js(`(()=>{try{d.storeAiDrawingPatch({...makePatch('bad','turn-2'),operations:[{op:'upsert',drawing:{}}]})}catch{return true}return false})()`), true);
  assert.deepEqual(await current(), ['缠论：笔与中枢']);
  // Complete actual playback, not just storage: it must not erase the prior alternative.
  await js(`d.playAiDrawingPatch(makePatch('量价：补充分析'))`);
  assert.equal(await position(), '4/4');
  await click(next); assert.deepEqual(await current(), ['威科夫：区间结构']);
  // A failed pre-playback chart focus also keeps completed drawings available.
  await js(`d.playAiDrawingPatch(makePatch('failed','turn-2'),{beforePlayback:()=>{throw Error('focus failed')}}).catch(()=>{})`);
  assert.equal(await position(), '1/4');
  assert.deepEqual(await current(), ['威科夫：区间结构']);
  await js(`d.storeAiDrawingPatch(makePatch('新一轮：最新绘制','turn-2'))`);
  assert.equal(await js(`getComputedStyle(document.querySelector('${next}')).display`), 'none');
  assert.deepEqual(await current(), ['新一轮：最新绘制']);
  await js('d.clearAllDrawings()');
  await win.reload(); await pause(250); await init();
  assert.deepEqual(await current(), []);
  assert.equal(await js(`getComputedStyle(document.querySelector('${next}')).display`), 'none');
  const checks = ['single-hidden','eye-adjacency','ordered-wrap','font-memory','light-dark','hidden-switch','session-isolation','reload-selection','idempotent','invalid-patch','playback','playback-failure','next-turn-replacement','clear-reload','manual-undo-preserved','keyboard-space','background-persistence','session-promotion'];
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2));
  console.log(`PASS: ${checks.length} chart drawing switch scenarios`);
  win.destroy(); app.quit();
})().catch(error => { console.error(error.stack); if(win)win.destroy(); app.exit(1); });
