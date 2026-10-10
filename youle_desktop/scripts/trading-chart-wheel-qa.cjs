// Run from the workspace root with Vite on 5183. Uses isolated mock market data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../.cache/chart-wheel');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const js = code => win.webContents.executeJavaScript(code, true);
  await win.webContents.session.clearStorageData();
  await win.loadURL('http://127.0.0.1:5183/@fs/' + path.resolve(__dirname, '../test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  for (let i = 0; i < 150 && !await js('Boolean(window.ready)'); i++) await pause(100);
  assert.equal(await js('Boolean(window.ready)'), true, await js('String(window.qaError)'));
  await js('workspace.loadingHistory=true;clearInterval(workspace.pollTimer);clearInterval(workspace.candlePollTimer);workspace.favoriteTickerGeneration++;workspace.closeFavoriteTickerStreams();workspace.closeSocket();void 0');
  const snapshot = () => js(`(()=>{const t=workspace.chart.timeScale(),r=t.getVisibleLogicalRange(),s=workspace.candleSeries,h=workspace.chart.panes()[0].getHeight(),d=s.data().slice(Math.max(0,Math.ceil(r.from)),Math.max(0,Math.floor(r.to)+1));return {range:r,auto:workspace.chart.priceScale('right').options().autoScale,preference:workspace.chartSettings.autoScale,visible:d.length,inside:d.filter(c=>s.priceToCoordinate(c.high)>=-1&&s.priceToCoordinate(c.low)<=h+1).length}})()`);
  // Reproduce the user's stale/manual vertical range, not only a clean Auto view.
  await js(`workspace.chartNavigation.setAutoScale(false);workspace.chart.priceScale('right').setVisibleRange({from:1320,to:1335})`);
  await pause(100);
  const before = await snapshot();
  assert.ok(before.inside < before.visible, 'fixture must reproduce clipped candles');
  const point = await js(`(()=>{const r=workspace.chart.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(r.left+250),y:Math.round(r.top+200)}})()`);
  for (let i = 0; i < 18; i++) { win.webContents.sendInputEvent({type:'mouseWheel',...point,deltaY:-80,deltaX:0}); await pause(25); }
  await pause(250);
  const after = await snapshot();
  const baseline = process.argv.includes('--baseline');
  const name = baseline ? 'baseline' : 'result';
  fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({before,after},null,2));
  fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({before,after}));
  if (!baseline) { assert.equal(after.auto,true); assert.ok(after.visible>0); assert.equal(after.inside,after.visible); }
  if (baseline) { await js('workspace.destroy()'); win.destroy(); app.exit(0); return; }
  const report = { baseline: {before,after}, cases: [], anchors: [], recovery: [], history: [], refresh: [], errors: [] };
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.includes('Binance market catalog is unavailable')) report.errors.push(event.message);
  });
  const settle = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const geometry = () => js(`(()=>{const c=workspace.chart,t=c.timeScale(),s=source,r=t.getVisibleLogicalRange(),p=c.panes()[0],h=p.getHeight(),scale=c.priceScale('right'),data=s.data().slice(Math.max(0,Math.ceil(r.from)),Math.max(0,Math.floor(r.to)+1));return {range:r,price:scale.getVisibleRange(),auto:scale.options().autoScale,mode:scale.options().mode,spacing:t.options().barSpacing,visible:data.length,inside:data.filter(d=>s.priceToCoordinate(d.high)>=-1&&s.priceToCoordinate(d.low)<=h+1).length}})()`);
  const pointAt = (axis=false, ratio=0.4) => js(`(()=>{const c=workspace.chart,r=c.panes()[0].getHTMLElement().getBoundingClientRect();return {x:Math.round(${axis ? 'r.right-12' : `r.left+c.priceScale('left').width()+c.timeScale().width()*${ratio}`}),y:Math.round(r.top+c.panes()[0].getHeight()*0.6)}})()`);
  const wheel = async (deltaY, modifiers=[], axis=false, ratio=0.4) => {
    const p = await pointAt(axis,ratio);
    win.webContents.sendInputEvent({type:'mouseWheel',...p,deltaX:0,deltaY,modifiers});
    await pause(16); await settle();
  };
  const button = async action => {
    const p = await js(`(()=>{const e=workspace.chartNavigation.controls.querySelector('[data-navigation-action=${action}]');const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...p});
    for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({type,...p,button:'left',clickCount:1});
    await settle();
  };
  const fit = (state,label) => {
    assert.equal(state.auto,true,label); assert.ok(state.visible>0,`${label}: empty`);
    assert.equal(state.inside,state.visible,`${label}: clipped candles`);
    assert.ok([state.range.from,state.range.to,state.price.from,state.price.to,state.spacing].every(Number.isFinite),label);
  };
  const near = (a,b,label,tolerance=1e-5) => {
    for (const key of ['from','to']) assert.ok(Math.abs(a[key]-b[key]) < tolerance,`${label}: ${JSON.stringify({a,b})}`);
  };
  await js('workspace.destroy()');
  for (const theme of ['light','dark']) {
    await win.webContents.session.clearStorageData();
    await win.reload();
    for (let i=0;i<150 && !await js('Boolean(window.ready)');i++) await pause(100);
    await js(`document.documentElement.dataset.theme='${theme}';window.primary=workspace;primary.loadingHistory=true;primary.splitLayoutId='2-columns';primary.applySplitLayout()`);
    for (let i=0;i<100 && !await js('primary.splitPanes[0]?.candles.length');i++) await pause(50);
    await js('clearInterval(primary.pollTimer);clearInterval(primary.candlePollTimer);clearTimeout(primary.splitPanes[0].refreshTimer);primary.splitPanes[0].refreshTimer=null;primary.favoriteTickerGeneration++;primary.closeFavoriteTickerStreams();primary.closeSocket();primary.cancelScheduledLiveChartPaint();primary.latestLivePricesByMarketId.clear();void 0');
    for (const subject of ['main','split']) {
      await js(`window.workspace=${subject==='main'?'primary':'primary.splitPanes[0]'};window.other=${subject==='main'?'primary.splitPanes[0]':'primary'};window.source=workspace.candleSeries||workspace.series;workspace.chartElement.focus()`);
      // Auxiliary panes can start without indicators; explicitly enable volume.
      await js(`if(workspace!==primary&&!workspace.activeIndicators.includes('volume'))workspace.host.querySelector('[data-split-indicator=volume]').click()`);
      await settle();
      for (const mode of [0,1,2]) {
        const label = `${theme}/${subject}/${mode}`;
        await js(`workspace.chartNavigation.setMode(${mode});workspace.chartNavigation.reset();other.chart.priceScale('right').setAutoScale(false);window.otherTime=other.chart.timeScale().getVisibleLogicalRange();window.otherPrice=other.chart.priceScale('right').getVisibleRange()`); await settle();
        fit(await geometry(),label);
        for (const delta of [120,-120]) {
          for (let i=0;i<40;i++) await wheel(delta);
          const limit=await geometry(); fit(limit,label);
          for (let i=0;i<6;i++) await wheel(delta);
          const repeat=await geometry(); near(limit.range,repeat.range,label);
          await wheel(-delta); const reversed=await geometry(); fit(reversed,label);
          assert.ok(Math.abs((reversed.range.to-reversed.range.from)-(limit.range.to-limit.range.from))>0.01,`${label}: reversal stuck`);
          report.cases.push({theme,subject,mode,delta,limit,reversed});
        }
        // A manual axis cannot leave newly visible candles clipped after zoom.
        await wheel(60,[],true); const manual=await geometry(); assert.equal(manual.auto,false);
        await wheel(60); const recovered=await geometry(); fit(recovered,`${label} wheel recovery`);
        await wheel(60,[],true); await button('zoom-out'); fit(await geometry(),`${label} button recovery`);
        assert.equal(await js('(workspace.chartSettings||workspace.settings).autoScale'),true);
        report.recovery.push({theme,subject,mode,manual,recovered});
        assert.equal(await js('other.chart.priceScale("right").options().autoScale'),false);
        near(await js('other.chart.timeScale().getVisibleLogicalRange()'),await js('otherTime'),`${label} other time`);
        near(await js('other.chart.priceScale("right").getVisibleRange()'),await js('otherPrice'),`${label} other price`);
        const axis=await pointAt(true);
        for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({type,...axis,button:'left',clickCount:2});
        await settle(); fit(await geometry(),`${label} axis reset`);
        await wheel(40); fit(await geometry(),`${label} reset persists`);
        // Native reset button must restore the persisted Auto setting as well.
        await wheel(60,[],true); await button('reset'); await settle(); fit(await geometry(),`${label} button reset`);
      }
      // Ordinary wheel needs no modifier: test left, middle and right positions
      // in all price modes, using real candle coordinates rather than just spans.
      for (const mode of [0,1,2]) for (const ratio of [0.2,0.5,0.8]) {
        await js(`workspace.chartNavigation.setMode(${mode});workspace.chartNavigation.reset();workspace.chart.timeScale().setVisibleLogicalRange({from:200,to:380})`); await settle();
        assert.equal(await js('(workspace.chartSettings||workspace.settings).scaleAnchor'),'cursor');
        const p=await pointAt(false,ratio);
        const anchor=await js(`(()=>{const t=workspace.chart.timeScale(),x=${p.x}-workspace.chartElement.getBoundingClientRect().left-workspace.chart.priceScale('left').width();return {index:t.coordinateToLogical(x),x}})()`);
        await wheel(80,[],false,ratio);
        const x=await js(`workspace.chart.timeScale().logicalToCoordinate(${anchor.index})`);
        assert.ok(Math.abs(x-anchor.x)<2,`${theme}/${subject}/${mode}/${ratio}: cursor anchor drift ${x-anchor.x}`);
        fit(await geometry(),'cursor fit');
        report.anchors.push({theme,subject,mode,ratio,...anchor,afterX:x});
      }
      await js('workspace.chartNavigation.setMode(0)'); await settle();
      // Price/volume share the time scale, and extrema labels follow real highs/lows.
      const labels=await js(`(()=>{const r=workspace.chart.timeScale().getVisibleLogicalRange(),all=workspace.chartCandles||workspace.candles,d=all.slice(Math.max(0,Math.ceil(r.from-.5)),Math.min(all.length,Math.floor(r.to+.5)+1)),h=workspace.chart.panes()[0].getHeight();return ['high','low'].map(kind=>{const c=d.reduce((a,b)=>kind==='high'?(a.high>b.high?a:b):(a.low<b.low?a:b));const e=workspace.extremaOverlay[kind+'Label'];const y=source.priceToCoordinate(c[kind]);return {kind,hidden:e.hidden,top:parseFloat(e.style.top),expected:Math.min(Math.max(y,38),Math.max(38,h-10))}})})()`);
      for (const l of labels) { assert.equal(l.hidden,false); assert.ok(Math.abs(l.top-l.expected)<1,JSON.stringify(l)); }
      const volume=await js(`(()=>{const c=workspace.chart,t=c.timeScale(),line=c.panes().slice(1).flatMap(p=>p.getSeries()).find(s=>s.seriesType()==='Histogram'),time=source.data().at(-10).time;return {found:!!line,x:t.timeToCoordinate(time),volumeX:line&&t.timeToCoordinate(line.data().find(d=>d.time===time)?.time)}})()`);
      assert.equal(volume.found,true); assert.equal(volume.x,volume.volumeX);
      // A live refresh preserves the user's current time window and manual range.
      await wheel(60,[],true); const beforeRefresh=await geometry();
      await js('if(workspace===primary)workspace.updateChartData({preserveViewport:true});else workspace.updateData()'); await settle();
      const refreshed=await geometry(); near(refreshed.range,beforeRefresh.range,'live time'); near(refreshed.price,beforeRefresh.price,'live manual price');
      await js(`document.documentElement.dataset.theme='${theme==='light'?'dark':'light'}'`); await settle();
      near((await geometry()).price,beforeRefresh.price,'theme manual price');
      await js(`document.documentElement.dataset.theme='${theme}'`); await settle();
      report.refresh.push({theme,subject,beforeRefresh,refreshed,labels,volume});
      await button('reset'); await wheel(-120); fit(await geometry(),'screenshot');
      fs.writeFileSync(path.join(output,`${theme}-${subject}.png`),(await win.webContents.capturePage()).toPNG());
      console.log('wheel passed',theme,subject);
    }
    // Prepend much lower history through the real data path, then include it by
    // zooming out. The visible lowest wick must sit at the configured bottom pad.
    await js(`window.workspace=primary;window.source=primary.candleSeries;workspace.chartNavigation.reset();workspace.chart.timeScale().setVisibleLogicalRange({from:0,to:180});window.originalHistoryFetch=workspace.fetchHistoricalCandleBatch;workspace.fetchHistoricalCandleBatch=async()=>{const first=workspace.candles[0],candles=Array.from({length:120},(_,i)=>({...first,time:first.time-(120-i)*3600,open:first.open-500,high:first.high-500,low:first.low-500,close:first.close-500}));return {candles,sourceCandles:candles,source:{targetMs:3600000,sourceInterval:'1h',sourceMs:3600000}}};workspace.loadingHistory=false;workspace.loadMoreHistory()`); await settle();
    await js('workspace.fetchHistoricalCandleBatch=originalHistoryFetch;clearTimeout(workspace.historyCooldownTimer);workspace.historyCooldownTimer=null;workspace.loadingHistory=true');
    for(let i=0;i<6;i++) await wheel(-120);
    fit(await geometry(),'lower history fit');
    const history=await js(`(()=>{const t=workspace.chart.timeScale(),r=t.getVisibleLogicalRange(),h=workspace.chart.panes()[0].getHeight(),d=source.data().slice(Math.max(0,Math.ceil(r.from)),Math.max(0,Math.floor(r.to)+1)),low=Math.min(...d.map(c=>c.low)),y=source.priceToCoordinate(low);return {count:source.data().length,low,y,height:h,bottomGap:(h-1-y)/h,padding:workspace.chartSettings.verticalPaddingPercent/100,edgeLabelPadding:workspace.chart.options().layout.fontSize/2/h}})()`);
    // Native ensureEdgeTickMarksVisible adds half a font height to the margin.
    assert.equal(history.count,620);assert.ok(history.low<1000);assert.ok(Math.abs(history.bottomGap-history.padding-history.edgeLabelPadding)<1/history.height,JSON.stringify(history));
    report.history.push({theme,...history});
    fs.writeFileSync(path.join(output,`${theme}-history-fit.png`),(await win.webContents.capturePage()).toPNG());
    assert.equal(await js('window.qaError??null'),null);
    await js('primary.destroy()');
  }
  assert.deepEqual(report.errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,cases:report.cases.length,anchors:report.anchors.length,recovery:report.recovery.length,history:report.history.length,refresh:report.refresh.length,output}));
  win.destroy();app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
