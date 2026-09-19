// Start Vite at 127.0.0.1:5183. Run with node node_modules/electron/cli.js.
// Pass a report label (e.g. before / after); all data and annotations are mocked.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), label = process.argv[2] || 'after';
const output = path.join(root, '.cache', 'chart-performance');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = source => win.webContents.executeJavaScript(source, true);
  const settle = () => js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const report = { label, cases: [], overlays: [], errors: [] };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  for (const theme of ['light', 'dark']) {
    await win.webContents.session.clearStorageData();
    await win.loadURL('http://127.0.0.1:5183/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
    for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
    assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
    await js(`document.documentElement.dataset.theme='${theme}';window.primary=workspace;primary.loadingHistory=true;primary.splitLayoutId='2-columns';primary.applySplitLayout()`);
    for (let i = 0; i < 100 && !await js('primary.splitPanes[0]?.candles.length'); i++) await pause(50);
    await js(`clearInterval(primary.pollTimer);clearInterval(primary.candlePollTimer);clearTimeout(primary.splitPanes[0].refreshTimer);primary.splitPanes[0].refreshTimer=null;primary.favoriteTickerGeneration++;primary.closeFavoriteTickerStreams();primary.closeSocket();primary.cancelScheduledLiveChartPaint();primary.latestLivePricesByMarketId.clear();
      window.metrics={};window.frameGaps=[];window.measuring=false;window.lastFrame=0;window.frameNumber=0;
      function tick(t){frameNumber++;if(measuring&&lastFrame)frameGaps.push(t-lastFrame);lastFrame=t;window.perfFrame=requestAnimationFrame(tick)}requestAnimationFrame(tick);
      window.wrap=(object,key,name)=>{const original=object[key];if(typeof original!=='function')return;object[key]=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{if(measuring){const m=metrics[name]??={count:0,ms:0,maxMs:0,frames:{}};const dt=performance.now()-start;m.count++;m.ms+=dt;m.maxMs=Math.max(m.maxMs,dt);m.frames[frameNumber]=(m.frames[frameNumber]||0)+1}}}};
      for(const [object,name] of [[primary,'main'],[primary.splitPanes[0],'split']]){
        for(const key of ['synchronizeVisibleChartGeometry','renderVolumeProfile','updateMainIndicatorLegends','updateIndicatorLegends'])wrap(object,key,name+'.'+key);
        wrap(object.drawingController,'redraw',name+'.draw');wrap(object.drawingController,'visibleCandleObstacles',name+'.obstacles');wrap(object.extremaOverlay,'update',name+'.extrema');
      }
      window.originalCandles=primary.candles.map(c=>({...c}));void 0`);
    for (const [candles, drawings] of [[500, 0], [5000, 0], [5000, 80]]) {
      await js(`primary.candles=Array.from({length:${candles}},(_,i)=>{const old=originalCandles[i%500];return {...old,time:originalCandles[0].time+(i-${candles}+500)*3600}});primary.updateChartData({resetViewport:true});primary.splitPanes[0].candles=primary.candles.map(c=>({...c}));primary.splitPanes[0].updateData();
        for(const w of [primary,primary.splitPanes[0]]){const d=w.drawingController;d.drawings=Array.from({length:${drawings}},(_,i)=>({id:'perf-'+i,tool:'horizontal-line',symbol:d.getSymbol(),interval:d.getInterval(),points:[{time:w.candles.at(-50).time,price:1300+i/2}]}));d.redraw();w.chartNavigation.reset()}void 0`); await settle();
      for (const subject of ['main', 'split']) {
        await js(`window.workspace=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};primary.activateDrawingController(workspace.drawingController);workspace.chartNavigation.reset();workspace.chartElement.focus()`); await settle();
        const p = await js(`(()=>{const pane=workspace.chart.panes()[0],r=pane.getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+220),y:Math.round(r.top+170)}})()`);
        for (const action of ['drag', 'wheel']) {
          await js('window.metrics={};window.frameGaps=[];window.measuring=true');
          win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
          if (action === 'drag') win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
          for (let i = 0; i < 90; i++) {
            if (action === 'drag') win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + Math.round(Math.sin(i / 12) * 100), y: p.y + Math.round(Math.sin(i / 18) * 75), button: 'left', modifiers: ['leftButtonDown'] });
            else win.webContents.sendInputEvent({ type: 'mouseWheel', ...p, deltaY: i % 20 < 10 ? 12 : -12, deltaX: 0 });
            await pause(8);
          }
          if (action === 'drag') win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x + Math.round(Math.sin(89 / 12) * 100), y: p.y + Math.round(Math.sin(89 / 18) * 75), button: 'left', clickCount: 1 });
          await settle();
          const result = await js(`(()=>{measuring=false;const frames=[...frameGaps].sort((a,b)=>a-b),c=workspace.chart;return {frames:frames.length,frameP95:frames[Math.floor(frames.length*.95)],over33:frames.filter(x=>x>33.5).length,metrics:Object.fromEntries(Object.entries(metrics).map(([k,m])=>[k,{count:m.count,ms:m.ms,maxMs:m.maxMs,maxPerFrame:Math.max(...Object.values(m.frames))}])),range:c.timeScale().getVisibleLogicalRange(),price:c.priceScale('right').getVisibleRange(),auto:c.priceScale('right').options().autoScale}})()`);
          assert.ok([result.range.from, result.range.to, result.price.from, result.price.to].every(Number.isFinite));
          if (label !== 'before' && action === 'wheel') {
            assert.ok(result.metrics[subject + '.draw'].maxPerFrame <= 1, 'viewport overlays must paint at most once per frame');
            assert.equal(result.metrics[(subject === 'main' ? 'split' : 'main') + '.draw']?.count || 0, 0, 'an untouched split chart must not redraw');
            assert.equal(result.metrics[subject + '.obstacles']?.count || 0, 0, 'plain lines do not need candle collision scans');
          }
          report.cases.push({ theme, subject, candles, drawings, action, ...result });
          console.log(JSON.stringify({ theme, subject, candles, drawings, action, frames: result.frames, frameP95: result.frameP95, draw: result.metrics[subject + '.draw'], otherDraw: result.metrics[(subject === 'main' ? 'split' : 'main') + '.draw']?.count || 0 }));
          await js('workspace.chartNavigation.reset()'); await settle();
        }
      }
    }
    // Exercise the layers that do need collision geometry. Keep VPVR's cached
    // distribution, note leaders and order labels attached to the same prices.
    for (const subject of ['main', 'split']) {
      await js(`window.workspace=${subject === 'main' ? 'primary' : 'primary.splitPanes[0]'};window.d=workspace.drawingController;window.series=workspace.candleSeries||workspace.series;primary.activateDrawingController(d);workspace.chartNavigation.reset();d.drawings=[];d.selectedDrawingId=null;
        d.aiDrawings=[{id:'perf-guide',tool:'horizontal-line',source:'ai',symbol:d.getSymbol(),interval:d.getInterval(),colorToken:'chan-note',points:[{time:workspace.candles.at(-50).time,price:1330}]},{id:'perf-note',tool:'note',source:'ai',symbol:d.getSymbol(),interval:d.getInterval(),colorToken:'chan-note',text:'Price level',fontSize:10,points:[{time:workspace.candles.at(-45).time,price:1325}]}];
        d.orderLines=[{id:'perf-order',marketId:d.getSymbol(),price:1310,kind:'position-long',label:'Test position',shortLabel:'Long'}];workspace.activeMainIndicators=['vpvr'];workspace.renderVolumeProfile(true);d.redraw();window.profileSnapshot=workspace.volumeProfileSnapshot;void 0`); await settle();
      assert.equal(await js('Boolean(profileSnapshot)'), true);
      const identity = await js(`(()=>{const before=d.aiContent.firstElementChild;d.redraw();return before===d.aiContent.firstElementChild})()`);
      if (label !== 'before') assert.equal(identity, true, 'unchanged overlay nodes must survive a redraw');
      const p = await js(`(()=>{const r=workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+70),y:Math.round(r.top+120)}})()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
      win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 12; i++) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x + i * 3, y: p.y + i * 3, button: 'left', modifiers: ['leftButtonDown'] }); await pause(12);
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x + 36, y: p.y + 36, button: 'left', clickCount: 1 }); await settle();
      win.webContents.sendInputEvent({ type: 'mouseWheel', ...p, deltaY: -60, deltaX: 0 }); await settle();
      const geometry = await js(`(()=>{const guide=d.aiContent.querySelector('[data-drawing-id="perf-guide"] line'),poc=workspace.volumeProfileSnapshot.rows[workspace.volumeProfileSnapshot.pocIndex],line=workspace.volumeProfileLayer.querySelector('[data-vpvr-poc]');return {guide:Number(guide?.getAttribute('y1')),expected:series.priceToCoordinate(1330),poc:Number(line?.getAttribute('y1')),expectedPoc:((series.priceToCoordinate(poc.priceLow))+(series.priceToCoordinate(poc.priceHigh)))/2,note:!!d.aiContent.querySelector('[data-drawing-id="perf-note"]'),orders:d.orderLineContent.childElementCount,sameProfile:workspace.volumeProfileSnapshot===profileSnapshot}})()`);
      assert.ok(Math.abs(geometry.guide - geometry.expected) < 1, JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.poc - geometry.expectedPoc) < 1, JSON.stringify(geometry));
      assert.equal(geometry.note, true); assert.ok(geometry.orders > 0); assert.equal(geometry.sameProfile, true);
      report.overlays.push({ theme, subject, identity, ...geometry });
    }
    await fs.promises.writeFile(path.join(output, `${label}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    assert.equal(await js('window.qaError ?? null'), null);
    await js('cancelAnimationFrame(perfFrame);primary.destroy()');
  }
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, cases: report.cases.length, output, label }));
  win.destroy(); app.exit(0);
})().catch(e => { console.error(e); app.exit(1); });
