// Actual Windows chart + independent split pane, isolated profile and synthetic
// OHLCV. Run Vite with the repository config on HAOLO_QA_PORT (default 5227).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/indicator-time-axis-M1-457');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile-' + process.pid));
app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
let win;
(async () => {
  await app.whenReady();
  win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({
    cancel: /^(https?|wss?):/.test(details.url) && !/^(http|ws):\/\/127\.0\.0\.1:/.test(details.url),
  }));
  const origin = `http://127.0.0.1:${process.env.HAOLO_QA_PORT || 5227}`;
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  const settle = () => js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));');
  await win.loadURL(origin + '/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  for (let i = 0; i < 150 && !await js('return Boolean(window.ready)'); i++) await pause(50);
  assert.equal(await js('return Boolean(window.ready)'), true);
  await js(`window.primary=workspace;
    document.querySelector('#host').style.cssText='width:100%;height:100%';
    clearInterval(primary.pollTimer);clearInterval(primary.candlePollTimer);primary.favoriteTickerGeneration++;
    primary.closeFavoriteTickerStreams();primary.closeSocket();primary.cancelScheduledLiveChartPaint();primary.latestLivePricesByMarketId.clear();
    primary.loadingHistory=true;primary.splitLayoutId='2-columns';primary.applySplitLayout();`);
  for (let i = 0; i < 150 && !await js('return Boolean(primary.splitPanes[0]?.candles.length)'); i++) await pause(50);
  assert.equal(await js('return Boolean(primary.splitPanes[0]?.candles.length)'), true);
  await js(`window.secondary=primary.splitPanes[0];clearTimeout(secondary.refreshTimer);secondary.refreshTimer=null;
    secondary.candles=primary.candles.map(c=>({...c}));
    window.indicatorModule=await import('/cloud-indicator-drawings.ts');
    window.languageModule=await import('/app-language.mjs');
    for(const w of [primary,secondary]) {w.activeIndicators=['volume','macd','rsi','kdj'];w.rebuildIndicatorPanes();if(w===primary)w.updateChartData();else w.updateData();w.chart.applyOptions({rightPriceScale:{minimumWidth:100}});}
    window.inspect=w=>{const candles=w===primary?w.chartCandles:w.candles;return {
      indices:candles.map(c=>w.chart.timeScale().timeToIndex(c.time+28800,false)),
      coordinates:candles.map(c=>w.chart.timeScale().timeToCoordinate(c.time+28800)),
      prices:(w.candleSeries||w.series).data(),
      indicators:[...w.indicatorPanes].map(([id,r])=>[id,r.series.map(s=>s.api.data())]),
    }};
    window.apply=(w,p)=>w.acceptIndicatorAnalysisDrawingPatch({...p,marketId:w===primary?w.selectedMarketId:w.market.id,interval:w===primary?w.activeInterval:w.interval});
    window.clean=w=>{for(const r of w.indicatorPanes.values())indicatorModule.clearIndicatorAnalysisRuntime(w.chart,r);};
    window.base=()=>{window.bases=[inspect(primary),inspect(secondary)];};
    window.check=()=>[primary,secondary].map((w,i)=>({same:JSON.stringify(inspect(w))===JSON.stringify(bases[i]),
      changedKeys:Object.keys(bases[i]).filter(k=>JSON.stringify(inspect(w)[k])!==JSON.stringify(bases[i][k])),
      firstX:[bases[i].coordinates.at(-1),inspect(w).coordinates.at(-1)],
      indicatorDiff:inspect(w).indicators.flatMap(([id,series],j)=>series.flatMap((data,k)=>{const old=bases[i].indicators[j]?.[1]?.[k]||[];const n=data.findIndex((p,q)=>JSON.stringify(p)!==JSON.stringify(old[q]));return n<0&&old.length===data.length?[]:[{id,k,lengths:[old.length,data.length],index:n,before:old[n],after:data[n]}];})),
      indices:inspect(w).indices.every((x,j)=>x===j),
      primitives:[...w.indicatorPanes.values()].filter(r=>r.analysisPrimitive).length,
      extraSeries:[...w.indicatorPanes.values()].reduce((n,r)=>n+r.analysisSeries.length,0)}));`);
  await settle();
  const input = await js('return {marketId:primary.selectedMarketId,interval:primary.activeInterval,candles:primary.candles,snapshotTime:(primary.candles.at(-1).time+3600)*1000}');
  const patches = [];
  for (const id of ['kdj', 'rsi', 'macd']) {
    const pipeline = await import(pathToFileURL(path.join(root, `src/main/trading-analysis/${id}-analysis-pipeline.mjs`)).href);
    const run = pipeline[Object.keys(pipeline).find(k => /^run.*AnalysisPipeline$/.test(k))];
    patches.push((await run(input)).analysisPlan.indicatorDrawingPatch);
  }
  await js(`window.patches=${JSON.stringify(patches)};base();`);
  const rows = [];
  const verify = async label => {
    await settle(); const checks = await js('return check()');
    for (const check of checks) { assert.equal(check.same, true, label + ' immutable data and x positions '+JSON.stringify(check)); assert.equal(check.indices, true, label + ' contiguous candle indices'); assert.equal(check.extraSeries, 0, label + ' no annotation series'); }
    assert.equal(await js('return String(window.qaError||"")'), '', label + ' renderer errors');
    rows.push({ label, checks });
  };

  // Negative control on the first run against pre-fix HEAD: exact same renderer
  // inputs must reproduce empty columns. Not needed once this fix is committed.
  const oldSource = execFileSync('git', ['show', 'HEAD:youle_desktop/src/renderer/cloud-indicator-drawings.ts'], { cwd: path.dirname(root), encoding: 'utf8' });
  let negativeControl = null;
  if (oldSource.includes('strictlyAscendingTradingIndicatorPathPoints')) {
    const compiled = ts.transpileModule(oldSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    const entry = await (await fetch(origin + '/trading-expert-market.ts')).text();
    const library = entry.match(/from "([^"]*lightweight-charts[^"]*)"/)[1];
    const legacy = compiled.replace(/from ['"]lightweight-charts['"]/, `from ${JSON.stringify(origin + library)}`)
      .replace(/from ['"]\.\/trading-ai-native-style.ts['"]/, `from ${JSON.stringify(origin + '/trading-ai-native-style.ts')}`);
    await js(`window.oldRenderer=await import(URL.createObjectURL(new Blob([${JSON.stringify(legacy)}],{type:'text/javascript'})));
      const r=primary.indicatorPanes.get('kdj');oldRenderer.renderIndicatorAnalysisPatch({chart:primary.chart,runtime:r,patch:patches[0],host:primary.host,dark:false,timeOffsetSeconds:28800});`);
    await settle();
    negativeControl = await js('return {candleCount:primary.candles.length,lastIndex:inspect(primary).indices.at(-1),changed:!check()[0].same}');
    assert.ok(negativeControl.changed && negativeControl.lastIndex >= negativeControl.candleCount, 'old renderer reproduces extra time positions');
    fs.writeFileSync(path.join(output, 'before-fix.png'), (await win.webContents.capturePage()).toPNG());
    await js('clean(primary);base();');
  }
  for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en', 'zh-TW']) {
    await js(`document.documentElement.dataset.theme='${theme}';languageModule.applyAppLanguage('${locale}',{root:document.body});primary.applyChartTheme();
      for(const w of [primary,secondary]) {clean(w);w.chart.timeScale().setVisibleLogicalRange({from:420,to:503});}`);
    await settle();await js('base();for(const p of patches)for(const w of [primary,secondary])apply(w,p);');
    await verify(theme + '-' + locale + '-apply');
    assert.deepEqual(await js('return check().map(c=>c.primitives)'), [3, 3]);
    await js('for(const p of patches)for(const w of [primary,secondary])apply(w,p);'); await verify(theme + '-' + locale + '-repeat');
    for (const mode of ['zoom', 'invert']) {
      await js(mode === 'zoom' ? 'for(const w of [primary,secondary])w.chart.timeScale().setVisibleLogicalRange({from:450,to:503});'
        : 'for(const w of [primary,secondary])for(const r of w.indicatorPanes.values())r.series[0].api.priceScale().applyOptions({invertScale:true});');
      await settle();await js('base();for(const p of patches)for(const w of [primary,secondary])apply(w,p);');
      await verify(theme + '-' + locale + '-' + mode);
    }
    await js('for(const w of [primary,secondary]){w.rebuildIndicatorPanes();if(w===primary)w.updateChartData();else w.updateData();}'); await verify(theme + '-' + locale + '-rebuild-restore');
    if (locale === 'zh-CN') fs.writeFileSync(path.join(output, theme + '-fixed.png'), (await win.webContents.capturePage()).toPNG());
    await js('clean(primary);clean(secondary);'); await verify(theme + '-' + locale + '-clear');
  }
  // All catalog indicators use this same receiver, including future analysis
  // plugins. Exercise non-increasing times rather than a friendly aligned line.
  const ids = await js("return (await import('/trading-expert-indicators.ts')).TRADING_INDICATORS.map(x=>x.id)");
  for (const id of ids) {
    await js(`for(const w of [primary,secondary]){clean(w);w.activeIndicators=${JSON.stringify(id === 'volume' ? ['volume'] : ['volume', id])};w.rebuildIndicatorPanes();if(w===primary)w.updateChartData();else w.updateData();clean(w);}base();
      for(const w of [primary,secondary]){const t=w.candles.at(-10).time+1800;
        apply(w,{schemaVersion:1,analysisId:'generic',indicatorId:'${id}',operations:[{op:'upsert',drawing:{id:'generic-path',strategyId:'custom-analysis',theory:'strategy',layer:'ai/strategy/custom-analysis',tool:'path',colorToken:'strategy-primary',points:[{time:t,value:20},{time:t,value:40},{time:t-3600,value:30}]}}]});}`);
    await verify('catalog-' + id);
  }
  assert.equal(await js(`const refs=[primary,secondary].flatMap(w=>[...w.indicatorPanes.values()].map(r=>r.analysisPrimitive).filter(Boolean));
    primary.destroy();return refs.length>0&&refs.every(p=>p.chart===null&&p.series===null);`), true, 'destroy releases both charts and annotation primitives');
  rows.push({ label: 'destroy-main-and-split', detached: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: rows.length, negativeControl, rows }, null, 2));
  console.log(JSON.stringify({ passed: rows.length, negativeControl, output })); win.destroy(); app.quit();
})().catch(async error => {
  console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack));
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  win?.destroy(); app.exit(1);
});
