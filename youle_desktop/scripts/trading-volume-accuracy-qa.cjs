const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/volume-profile-accuracy');
const snapshot = JSON.parse(fs.readFileSync(path.join(output, 'snapshot.json'), 'utf8'));
app.setPath('userData', path.join(output, 'ui-profile')); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(`(async()=>{try{return await eval(${JSON.stringify(code)})}catch(e){return {__qaError:String(e.stack)}}})()`, true).then(v => { if (v?.__qaError) throw Error(v.__qaError); return v; });
  const settle = async () => { await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); await pause(25); };
  const click = async p => { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { win.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }); await settle(); } };
  await win.loadURL(`http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5194}/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i = 0; i < 120 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true);
  // Replay the actual COIN-M data through an isolated mock bridge to exercise
  // the production renderer loader. This does not add a COIN-M market catalog.
  await js(`window.sample=${JSON.stringify(snapshot)};window.d=workspace.drawingController;
    for(const name of ['pollTimer','candlePollTimer','reconnectTimer','marketRateLimitRetryTimer']){clearTimeout(workspace[name]);clearInterval(workspace[name]);workspace[name]=null}
    workspace.loadingHistory=true;workspace.refreshSnapshot=async()=>{};workspace.refreshMarketDataFallback=()=>{};workspace.refreshLiveCandle=async()=>{};workspace.restartMarketData=async()=>{};
    workspace.activeInterval='1D';workspace.selectedMarketId=sample.market;workspace.selectedMarketMeta={id:sample.market,symbol:sample.symbol,provider:'binance',marketType:'perpetual',assetClass:'crypto'};
    workspace.candles=sample.daily;workspace.sourceCandles=sample.daily;workspace.updateChartData({resetViewport:true});
    d.getCandles=()=>sample.daily;d.getVolumeCandles=()=>sample.daily;d.magnetEnabled=false;d.stayInDrawingMode=false;d.drawings=[];d.drawingStyles.clear();d.selectTool('crosshair');
    d.getCandleSeries().applyOptions({priceFormat:{type:'price',precision:2,minMove:.1}});
    d.getChart().timeScale().setVisibleLogicalRange({from:-20,to:95});document.querySelector('#host').style.cssText='width:100%;height:100%';
    window.profileRequests=[];window.codexDesktop.getBinancePublicMarketData=async request=>{
      if(request.path.endsWith('/exchangeInfo'))return {ok:true,status:200,data:{symbols:[{symbol:sample.symbol,filters:[{filterType:'PRICE_FILTER',tickSize:String(sample.tickSize)}]}]}};
      if(!request.path.endsWith('/klines'))return {ok:true,status:200,data:[]};
      profileRequests.push(request);const p=request.parameters;
      if(p.symbol!==sample.symbol||p.interval!=='4h')throw Error('Wrong profile contract or period');
      const rows=sample.lower.filter(c=>p.endTime===undefined||c.time*1000<=p.endTime).slice(-p.limit);
      return {ok:true,status:200,data:rows.map(c=>[c.time*1000,String(c.open),String(c.high),String(c.low),String(c.close),String(c.volume),c.time*1000+14400000-1,'0',1,'0','0','0'])};
    };d.redraw()`);
  const point = (date, price = 2400) => js(`(()=>{const p=d.pointToScreen({time:Date.parse('${date}T00:00:00Z')/1000,price:${price}}),r=d.chartElement.getBoundingClientRect();return {x:p.x+r.x,y:p.y+r.y}})()`);
  const results = [];
  for (const [tool, anchor, end, expected] of [
    ['anchored-volume-profile','2026-08-26',null,2701.73],
    ['anchored-volume-profile','2026-09-23',null,2709.29],
    ['fixed-range-volume','2026-08-20','2026-09-25',2476.46],
  ]) {
    await js(`d.drawings=[];d.selectDrawing(null);d.selectTool('${tool}')`); await settle();
    await click(await point(anchor)); if(end)await click(await point(end,2300));
    await pause(1150); await settle();
    const result = await js(`(()=>{const item=d.drawings.at(-1),p=d.volumeProfileForDrawing(item);return {tool:item.tool,poc:+p.poc.toFixed(2),tickSize:p.tickSize,total:p.total,label:p.sourceLabel,rows:d.content.querySelectorAll('[data-volume-row]').length,axis:d.axisMarkerLayer.textContent,preview:!!d.content.querySelector('[data-volume-preview]')}})()`);
    assert.equal(result.poc,expected); assert.equal(result.tickSize,.01); assert.equal(result.rows,24); assert.equal(result.preview,false); assert.match(result.label,/完整/);
    if(!end)assert.ok(result.axis.replaceAll(',','').includes(String(expected)));
    results.push(result); fs.writeFileSync(path.join(output,`${tool}-${anchor}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await js(`d.openHorizontalLineSettings(d.drawings.at(-1));const f=document.querySelector('[name="rowLayout"]');f.value='ticks';f.dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await js(`document.querySelector('[name="rows"]').closest('label').hidden`),true);
  assert.equal(await js(`document.querySelector('[name="ticksPerRow"]').closest('label').hidden`),false);
  await js(`document.querySelector('[name="ticksPerRow"]').value='2500';document.querySelector('dialog[open] form').requestSubmit()`); await pause(1150); await settle();
  assert.equal(await js(`d.drawings.at(-1).volumeProfile.ticksPerRow`),2500);
  assert.equal(await js(`d.content.querySelectorAll('[data-volume-row]').length`),24);
  assert.equal(await js(`String(window.qaError??'')`),'');
  const requests = await js(`profileRequests.map(r=>({symbol:r.parameters.symbol,interval:r.parameters.interval,count:r.parameters.limit,end:r.parameters.endTime}))`);
  assert.ok(requests.length >= 3 && requests.length <= 5);
  const report = { result:'PASS', referenceSymbol:snapshot.symbol, results, exchangeTickOverridesDisplayTick:true, tickLayoutSettings:true, requests };
  fs.writeFileSync(path.join(output,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win.destroy();app.quit();
})().catch(async e=>{console.error(e);if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'ui-failure.png'),(await win.webContents.capturePage()).toPNG());win?.destroy();app.exit(1)});
