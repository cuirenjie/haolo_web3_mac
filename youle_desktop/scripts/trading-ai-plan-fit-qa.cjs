// Actual chart and playback, synthetic data, isolated profile and local-only network.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.cache/ai-plan-fit-M1-450');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${Date.now()}`)); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
let win, server;
(async () => {
  const timeout = setTimeout(() => app.exit(1), 120000); timeout.unref();
  await app.whenReady();
  const { createServer } = await import('vite');
  server = await createServer({ configFile: path.join(root, 'vite.config.mjs'),
    server: { port: 5220, strictPort: true, hmr: false, fs: { allow: [root] } } });
  await server.listen();
  win = new BrowserWindow({ show: false, width: 1200, height: 850,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({
    cancel: /^(https?|wss?):/.test(details.url) && !/^https?:\/\/127\.0\.0\.1:5220\//.test(details.url),
  }));
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  const settle = () => js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await win.loadURL(`http://127.0.0.1:5220/@fs/${path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/')}`);
  for (let i = 0; i < 150 && !await js('return Boolean(window.ready)'); i++) await pause(50);
  assert.equal(await js('return Boolean(window.ready)'), true, await js('return String(window.qaError)'));
  await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;
    document.querySelector('#host').style.cssText='width:100%;height:100%';
    window.sequence=0;
    window.makePatch=controller=>{
      const candles=controller.getCandles(),symbol=controller.getSymbol(),interval=controller.getInterval();
      const points=price=>[{time:candles.at(-35).time,price},{time:candles.at(-2).time,price}];
      const shape=(id,anchors,token,text)=>({op:'upsert',drawing:{id,tool:'path',points:anchors,text,symbol,interval,
        theory:'strategy',strategyId:'price-action',layer:'ai/strategy/price-action',colorToken:token,locked:true,status:'confirmed',evidenceIds:[]}});
      const levels=[['entry',1325],['stop',1500],['target',1200],['target',1100],['target',1000]];
      return {schemaVersion:1,analysisId:'qa-fit-'+(++sequence),drawingTurnId:'qa-turn-'+sequence,baseRevision:0,marketId:symbol,interval,
        operations:[shape('geometry',[points(1450)[0],points(1550)[1]],'strategy-primary','结构'),
          ...levels.map(([role,price],i)=>shape('plan-'+i,points(price),'strategy-'+role,'入场 止损 止盈'))]};
    };
    window.inspect=controller=>{
      const b=controller.plotBounds(),chart=controller.getChart();
      return {height:b.height,range:controller.aiPlanPriceRange(),mode:chart.priceScale('right').options().mode,
        auto:chart.priceScale('right').options().autoScale,
        labels:[...controller.orderLineContent.querySelectorAll('[data-trading-plan-price-line]')].map(g=>{
          const r=g.querySelector('.trading-order-line-label-bg').getBBox();
          return {price:+g.dataset.orderPriceLevel,top:r.y,bottom:r.y+r.height};}),
        geometry:[1450,1550].map(p=>controller.getCandleSeries().priceToCoordinate(p)),
        candles:controller.getCandles().slice(-35).flatMap(c=>[controller.getCandleSeries().priceToCoordinate(c.high),controller.getCandleSeries().priceToCoordinate(c.low)])};
    };`);
  const rows = [];
  const verify = (r, name) => {
    assert.equal(r.labels.length, 5, name);
    assert.ok(r.labels.every(l => l.top >= 6 && l.bottom <= r.height - 6), JSON.stringify({ name, r }));
    assert.ok(r.geometry.every(y => y >= 0 && y <= r.height), name + ' geometry');
    assert.ok(r.candles.every(y => y >= 0 && y <= r.height), name + ' candles');
  };
  for (const theme of ['light', 'dark']) for (const width of [1200, 620]) for (const mode of [0, 1, 2]) {
    const name = `${theme}-${width}-mode${mode}`;
    win.setSize(width, 850);
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();
      d.aiPlanAutoscale?.destroy();d.aiPlanAutoscale=null;d.clearAllDrawings();d.drawingVisibility.setAll(false);
      workspace.chart.priceScale('right').applyOptions({mode:${mode},autoScale:true,invertScale:false});
      window.patch=makePatch(d);window.original=JSON.stringify(patch);d.storeAiDrawingPatch(patch);`);
    await settle(); await js('d.redraw()');
    const before = await js('return inspect(d)');
    assert.ok(before.labels.length < 5, name + ' reproduces clipped levels before fitting');
    if (name === 'light-1200-mode0') fs.writeFileSync(path.join(output, 'before.png'), (await win.webContents.capturePage()).toPNG());
    await js('await workspace.acceptAnalysisDrawingPatch(patch,0,undefined,()=>true,100)');
    await settle(); await js('d.redraw()');
    const after = await js('return inspect(d)'); verify(after, name);
    assert.equal(await js('return JSON.stringify(patch)===original'), true);
    rows.push({ name, before, after });
    if (mode === 0) fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(name + ' passed');
  }
  await js('workspace.chart.priceScale("right").applyOptions({mode:0,invertScale:true});d.fitCompletedAiPlan()');
  await settle(); verify(await js('return inspect(d)'), 'inverted');
  await js('workspace.chart.priceScale("right").applyOptions({invertScale:false});workspace.chartNavigation.setVerticalLocked(true);d.fitCompletedAiPlan()');
  await settle(); verify(await js('return inspect(d)'), 'vertical-lock');
  await js('workspace.chartNavigation.setVerticalLocked(false);workspace.chartSettings.autoScale=false;await workspace.acceptAnalysisDrawingPatch(makePatch(d),0,undefined,()=>true,100)');
  await settle(); await pause(100); verify(await js('return inspect(d)'), 'manual-mode-completion');
  await js('workspace.chart.priceScale("right").setVisibleRange({from:1280,to:1370});d.redraw()');
  await settle(); assert.ok((await js('return inspect(d)')).labels.length < 5, 'later manual zoom is not overridden');
  await js('d.drawingVisibility.setLayers({plansHidden:true});d.redraw()');
  assert.equal(await js('return d.aiPlanPriceRange()'), null, 'hidden plan stops contributing range');
  await js('d.drawingVisibility.setLayers({plansHidden:false});d.showExecutionPlanDrawing(patch)');
  await settle(); verify(await js('return inspect(d)'), 'open-existing-plan');
  await js('d.clearAllDrawings();d.redraw()');
  assert.equal(await js('return d.aiPlanPriceRange()'), null, 'cleared plan stops contributing range');
  await js('workspace.splitLayoutId="2-columns";workspace.applySplitLayout()');
  for (let i = 0; i < 100 && !await js('return Boolean(workspace.splitPanes[0]?.candles.length)'); i++) await pause(50);
  await js('window.sd=workspace.splitPanes[0].getDrawingController();await workspace.acceptAnalysisDrawingPatch(makePatch(sd),1,undefined,()=>true,100)');
  await settle(); const split = await js('return inspect(sd)'); verify(split, 'split');
  assert.equal(await js('return d.aiPlanPriceRange()'), null, 'split fit leaves main plot alone');
  assert.equal(await js('return String(window.qaError||"")'), '');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: rows.length + 9, rows, split }, null, 2));
  console.log(JSON.stringify({ passed: rows.length + 9, output }));
  win.destroy(); await server.close(); app.exit(0);
})().catch(async error => {
  console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack));
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  win?.destroy(); if (server) await server.close(); app.exit(1);
});
