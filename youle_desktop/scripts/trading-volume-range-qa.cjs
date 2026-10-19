const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/volume-range-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{try{return await (async()=>{return eval(${JSON.stringify(code)})})()}catch(e){return {__qaError:String(e.stack)}}})()`, true).then(v => { if (v?.__qaError) throw Error(v.__qaError); return v; });
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(25); };
  const capture = async name => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const input = async (type, p, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), ...extra }); await settle(); };
  const click = async p => { await input('mouseMove', p); await input('mouseDown', p, { button: 'left', clickCount: 1 }); await input('mouseUp', p, { button: 'left', clickCount: 1 }); };
  const drag = async (a, b) => { await input('mouseMove', a); await input('mouseDown', a, { button: 'left', clickCount: 1 }); await input('mouseMove', b, { button: 'left', modifiers: ['leftButtonDown'] }); await input('mouseUp', b, { button: 'left', clickCount: 1 }); };
  const load = async () => {
    for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true);
    await js(`(async()=>{window.vol=await import('/trading-volume-drawings.ts');window.ranges=await import('/trading-range-tools.ts');window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';d.magnetEnabled=false;d.stayInDrawingMode=false;d.selectTool('crosshair');
      window.candles=Array.from({length:120},(_,i)=>{const c=i<32?1900+Math.sin(i)*35:i<38?1900+(i-31)*90:i<75?2490+Math.sin(i*1.8)*45:i<98?2730+Math.sin(i*2)*35:2460+Math.sin(i)*35;return {time:1785542400+i*86400,open:c+Math.sin(i*1.7)*20,high:c+40,low:c-55,close:c,volume:i===80?2000000:80000+(Math.sin(i*1.3)+1)*60000}});
      for(const name of ['pollTimer','candlePollTimer','reconnectTimer','marketRateLimitRetryTimer']) {clearTimeout(workspace[name]);clearInterval(workspace[name]);workspace[name]=null}
      workspace.refreshSnapshot=async()=>{};workspace.refreshMarketDataFallback=()=>{};workspace.refreshLiveCandle=async()=>{};workspace.restartMarketData=async()=>{};
      d.volumeHistory?.destroy();d.volumeHistory=undefined;workspace.candles=candles;workspace.sourceCandles=candles;workspace.updateChartData({resetViewport:true});d.getCandles=()=>candles;d.getChart().timeScale().setVisibleLogicalRange({from:-3,to:175});d.redraw()})()`); await settle();
  };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5194}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  await load();
  const point = (index, price) => js(`(()=>{const p=d.pointToScreen({time:candles[0].time+${index}*86400,price:${price}}),r=d.chartElement.getBoundingClientRect();return {x:p.x+r.x,y:p.y+r.y}})()`);
  const state = () => js(`(()=>{const item=d.draft??d.drawings.at(-1),g=item&&d.content.querySelector('[data-drawing-id="'+item.id+'"]');return {draft:!!d.draft,count:d.drawings.length,model:item,tool:d.activeTool,
    vwapLines:g?.querySelectorAll('[data-vwap-line]').length??0,fills:g?.querySelectorAll('[data-vwap-fill]').length??0,rows:g?.querySelectorAll('[data-volume-row]').length??0,
    preview:!!g?.querySelector('[data-volume-preview]'),poc:g?.querySelector('[data-volume-poc]')?.outerHTML,card:g?.querySelector('[data-range-card]')?.textContent,
    handles:g?.querySelectorAll('[data-drawing-handle-index]').length??0,selectionPoints:g?.querySelectorAll('[data-vwap-selection-point]').length??0,
    axis:d.axisMarkerLayer.textContent,toolbar:!d.selectionToolbar.hidden}})()`);
  const handle = i => js(`(()=>{const r=d.content.querySelector('[data-drawing-handle-index="${i}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const completed = [];
  for (const theme of ['light', 'dark']) for (const tool of ['anchored-vwap', 'fixed-range-volume', 'anchored-volume-profile', 'price-range', 'date-range', 'date-price-range']) {
    await js(`d.selectTool('crosshair');d.selectDrawing(null);d.drawings=[];d.drawingStyles.clear();document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.getCandleSeries().priceScale().applyOptions({scaleMargins:{top:.15,bottom:.23}});d.selectTool('${tool}');d.redraw()`); await settle();
    await click(await point(38, 2450));
    if (!['anchored-vwap', 'anchored-volume-profile'].includes(tool)) {
      await input('mouseMove', await point(145, 2050));
      let value = await state(); assert.equal(value.draft, true);
      if (tool === 'fixed-range-volume') { assert.equal(value.preview, true); assert.equal(value.model.points[1].time, await js('candles.at(-1).time')); assert.equal(value.rows, 0); }
      else assert.ok(value.card);
      await capture(theme + '-' + tool + '-preview');
      await click(await point(145, 2050));
    }
    let value = await state(); assert.equal(value.draft, false); assert.equal(value.count, 1); assert.equal(value.tool, 'crosshair');
    if (tool.includes('volume') && tool !== 'anchored-vwap') {
      assert.equal(value.preview, true); assert.equal(value.rows, 0);
      await pause(1100); await settle(); value = await state(); assert.equal(value.preview, false); assert.equal(value.rows, 24); assert.ok(value.poc);
      assert.equal(value.handles, tool === 'fixed-range-volume' ? 2 : 1);
      assert.equal(await js(`[...d.selectionToolbar.querySelectorAll('[data-drawing-selection-mode="drawing"] > .trading-drawing-selection-menu-wrap')].every(e=>getComputedStyle(e).display==='none')`), true);
      if (tool === 'fixed-range-volume') assert.equal(value.model.points[1].time, await js('candles.at(-1).time'));
      else assert.match(value.poc, /x1="0"/);
    } else if (tool === 'anchored-vwap') {
      assert.equal(value.vwapLines, 3); assert.equal(value.fills, 1); assert.equal(value.handles, 1); assert.equal(value.selectionPoints, 6);
      assert.equal(value.model.points[0].price, await js('vol.vwapSourcePrice(candles[38])'));
    } else { assert.equal(value.handles, 2); assert.ok(value.card); assert.ok(value.model.points[1].time > await js('candles.at(-1).time')); }
    await capture(theme + '-' + tool); completed.push(theme + ':' + tool);
  }
  // Range handles retain tick-aligned prices, update metrics and survive reload.
  const before = await state();
  await drag(await handle(1), await point(150, 2150));
  let value = await state(); assert.notEqual(value.card, before.card); assert.ok(value.model.points[1].time > await js('candles.at(-1).time'));
  const saved = value.model;
  await win.reload(); await load(); value = await state(); assert.deepEqual(value.model.points, saved.points);
  // Reverse placement, body drag, lock and transactional settings.
  await js(`d.drawings=[];d.selectTool('price-range')`); await click(await point(115, 2150)); await click(await point(50, 2650));
  value = await state(); assert.equal(value.draft, false); assert.ok(!value.card.startsWith('−'));
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="patternFill"]').value='#ff000040';document.querySelector('[data-line-cancel]').click()`); await settle();
  assert.equal((await state()).model.textBackgroundColor, undefined);
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[name="patternFill"]').value='#ff000040';document.querySelector('dialog[open] form').requestSubmit()`); await settle();
  assert.equal((await state()).model.textBackgroundColor, '#ff000040');
  // Anchored VWAP and profile dragging only select a new real bar; vertical movement is ignored.
  for (const tool of ['anchored-vwap', 'fixed-range-volume', 'anchored-volume-profile']) {
    await js(`d.getCandleSeries().priceScale().applyOptions({scaleMargins:{top:.3,bottom:.23}});d.drawings=[];d.selectTool('${tool}')`); await settle(); await click(await point(45, 2400)); if (tool === 'fixed-range-volume') await click(await point(105, 2200));
    await pause(1100); await settle(); const previous = (await state()).model.points;
    const a = await handle(0); await drag(a, { x: a.x, y: a.y + 35 }); assert.deepEqual((await state()).model.points, previous);
    await drag(await handle(0), await point(55, 2350)); await pause(1100); await settle();
    assert.equal((await state()).model.points[0].time, await js('candles[55].time'));
    if (tool === 'fixed-range-volume') {
      await drag(await handle(1), await point(170, 2100)); await pause(1100); await settle();
      assert.equal((await state()).model.points[1].time, await js('candles.at(-1).time'));
    }
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1))`); await settle();
    const key = tool === 'anchored-vwap' ? 'multiplier' : 'rows', number = tool === 'anchored-vwap' ? 2 : 36;
    await js(`document.querySelector('[name="${key}"]').value='${number}';document.querySelector('dialog[open] form').requestSubmit()`); await pause(1100); await settle();
    value = await state(); assert.equal(tool === 'anchored-vwap' ? value.model.vwap.multiplier : value.rows, number);
    await js(`d.openHorizontalLineSettings(d.drawings.at(-1));document.querySelector('[data-line-tab="style"]').click()`); await settle(); await capture(tool + '-settings');
    await js(`document.querySelector('[data-line-cancel]').click()`); await settle();
    const locked = (await state()).model.points;
    await js(`d.drawings.at(-1).locked=true;d.redraw()`); await drag(await handle(0), await point(65, 2200)); assert.deepEqual((await state()).model.points, locked);
  }
  // Anchored profile is tied to data, while its histogram is always attached to the price axis.
  await js(`d.drawings.at(-1).locked=false;window.oldPoc=vol.calculateFixedVolume(candles,vol.volumeProfilePoints(d.drawings.at(-1),candles),d.drawings.at(-1).volumeProfile).poc;const c={...candles.at(-1),time:candles.at(-1).time+86400,open:2200,high:2250,low:2150,close:2220,volume:1e9};candles.push(c);workspace.updateChartData({resetViewport:false});d.redraw()`); await settle();
  assert.notEqual(await js('vol.calculateFixedVolume(candles,vol.volumeProfilePoints(d.drawings.at(-1),candles),d.drawings.at(-1).volumeProfile).poc'), await js('oldPoc'));
  await js(`d.getChart().timeScale().setVisibleLogicalRange({from:25,to:155});d.redraw()`); await settle(); await capture('anchored-volume-profile-realtime-zoom');
  // A purely vertical price measurement also completes on release.
  await js(`d.drawings=[];d.selectTool('price-range')`); await drag(await point(60, 2400), await point(60, 2100));
  assert.equal((await state()).draft, false); assert.equal((await state()).count, 1);
  // Whole-object movement, log-price projection, compact panels, undo/redo.
  await js(`d.drawings=[];d.selectTool('date-price-range')`); await drag(await point(45, 2400), await point(90, 2100));
  const original = (await state()).model.points;
  // Grab the filled interior away from the arrow's hover-to-add-text action.
  const middle = await point(52, 2350); await drag(middle, {x:middle.x+40,y:middle.y+20});
  value = await state(); assert.notDeepEqual(value.model.points, original);
  assert.equal(Math.round((value.model.points[1].time-value.model.points[0].time)/86400), 45);
  await js(`d.getCandleSeries().priceScale().applyOptions({mode:1});d.redraw()`); await settle();
  await drag(await handle(1), await point(135, 2200)); value = await state(); assert.ok(value.card); assert.equal(value.model.points[1].time, await js('candles[0].time+135*86400'));
  assert.equal(await js(`/NaN|Infinity/.test(d.content.innerHTML)`), false);
  win.setSize(800,650); await pause(250); await settle(); await capture('date-price-range-log-compact');
  assert.equal(await js(`(()=>{const c=d.content.querySelector('[data-range-card]').getBoundingClientRect(),p=d.chartElement.getBoundingClientRect();return c.left>=p.left&&c.right<=p.right&&c.top>=p.top&&c.bottom<=p.bottom})()`), true);
  await js(`d.undo()`); assert.equal((await state()).count, 0); await js(`d.redo()`); assert.equal((await state()).count, 1);
  await js(`d.selectDrawing(d.drawings.at(-1).id);d.deleteSelectedDrawing()`); assert.equal((await state()).count, 0);
  assert.equal(await js('String(window.qaError??"")'), '');
  const report = { result: 'PASS', completed, latestBarClamp: true, oneSecondGeneration: true, verticalDrag: true, reanchor: true, settings: true, cancel: true, lock: true, persistence: true, realtime: true, zoom: true, futureMeasurement: true, verticalPlacement: true, bodyDrag: true, logScale: true, compactPanel: true, undoRedo: true, deletion: true };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); win.destroy(); app.quit();
})().catch(async e => { console.error(e); fs.writeFileSync(path.join(output, 'failure.txt'), String(e.stack)); if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); win?.destroy(); app.exit(1); });
