// Screenshot-inspired geometry on the actual chart; no user profile or network.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache/wyckoff-viewport-M1-468/chart');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
(async () => {
  await app.whenReady();
  const { createServer } = await import('vite');
  server = await createServer({ configFile: path.join(root, 'vite.config.mjs'), server: { port: 0, hmr: false } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.session.webRequest.onBeforeRequest((request, callback) => callback({
    cancel: /^(https?|wss?):/.test(request.url) && !request.url.startsWith(origin + '/'),
  }));
  const js = code => win.webContents.executeJavaScript(`(async()=>{${code}})()`, true);
  const settle = () => js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));d.redraw();await new Promise(r=>requestAnimationFrame(r));');
  await win.loadURL(origin + '/@fs/' + path.join(root, 'test/fixtures/trading-chart-navigation.html').replaceAll('\\', '/'));
  for (let i = 0; i < 160 && !await js('return !!window.ready'); i++) await pause(50);
  assert.equal(await js('return !!window.ready'), true);
  await js(`
    document.querySelector('#host').style.cssText='width:100%;height:100%';workspace.loadingHistory=true;
    const pivots=[[0,82100],[280,81200],[325,83000],[360,84875.20],[390,81500],[436,81900],[460,80100],[480,80511.19],[489,79178.60],[499,80240.80]];
    workspace.candles=workspace.candles.map((c,i)=>{
      const k=pivots.findIndex(p=>p[0]>=i),b=pivots[k],a=pivots[Math.max(0,k-1)];
      const value=a[1]+(b[1]-a[1])*(i-a[0])/Math.max(1,b[0]-a[0]);
      const close=value+Math.sin(i*1.7)*60,open=close+Math.cos(i)*70;
      return {...c,open,close,high:Math.max(open,close)+60,low:Math.min(open,close)-60};
    });
    window.sampleCandles=structuredClone(workspace.candles);
    const originalMarketApi=window.codexDesktop.getBinancePublicMarketData;
    window.codexDesktop.getBinancePublicMarketData=async request=>{
      if(request.path.endsWith('/klines'))return {ok:true,status:200,data:sampleCandles.map(c=>
        [c.time*1000,String(c.open),String(c.high),String(c.low),String(c.close),'100',c.time*1000+3599999,'0',1,'0','0','0'])};
      if(request.path.endsWith('/ticker/24hr'))return {ok:true,status:200,data:request.parameters?.symbol?{lastPrice:'80240.80',openPrice:'81000',quoteVolume:'1'}:[]};
      return originalMarketApi(request);
    };
    workspace.updateChartData({resetViewport:true});window.d=workspace.drawingController;window.sequence=0;
    window.makePatch=(withPlan=true)=>{
      const candles=d.getCandles(),step=candles[1].time-candles[0].time;
      const point=(i,price)=>({time:candles[0].time+i*step,price});
      const shape=(id,points,colorToken,text,tool='path',plan=false)=>({op:'upsert',drawing:{
        id,points,colorToken,text,tool,symbol:d.getSymbol(),interval:d.getInterval(),
        theory:plan?'strategy':'wyckoff',...(plan?{strategyId:'wyckoff'}:{}),
        layer:plan?'ai/strategy/wyckoff':'ai/wyckoff',locked:true,status:'confirmed',evidenceIds:[]}});
      const operations=[
        shape('range',[point(280,83629.27),point(480,80511.19)],'wyckoff-range','','rectangle'),
        ...[['A',325],['B',360],['D',436],['E',480]].flatMap(([code,i])=>[
          shape('phase-'+code,[point(i,83629.27),point(i,80511.19)],'wyckoff-phase',''),
          shape('phase-label-'+code,[point(i,83629.27)],'wyckoff-phase','Phase '+code,'note')]),
        shape('supply-label',[point(500,83629.27)],'wyckoff-supply','区间上沿 83,629.27','note'),
        shape('demand-label',[point(500,80511.19)],'wyckoff-demand','区间下沿 80,511.19','note'),
        shape('projection',[point(480,80511.19),point(489,79178.60),point(499,80240.80),point(506,80511.19),point(515,77393.11)],'wyckoff-projection',''),
        shape('projection-label',[point(515,77393.11)],'wyckoff-projection','派发候选条件目标 77,393.11','note'),
        ...(withPlan?[80999.90,81809.90,80385.10,79801.10,79393.20].map((price,i)=>
          shape('plan-'+i,[point(20,price),point(499,price)],i===0?'strategy-entry':i===1?'strategy-stop':'strategy-target','入场 止损 止盈','path',true)):[])];
      return {schemaVersion:1,analysisId:'wyckoff-full-'+(++sequence),baseRevision:0,marketId:d.getSymbol(),interval:d.getInterval(),operations};
    };
    window.inspect=()=>{
      const chart=d.getChart(),range=chart.timeScale().getVisibleLogicalRange(),series=d.getCandleSeries(),bounds=d.plotBounds();
      const anchors=patch.operations.filter(op=>op.drawing.theory==='wyckoff').flatMap(op=>op.drawing.points)
        .map(p=>({x:chart.timeScale().logicalToCoordinate((p.time-d.getCandles()[0].time)/(d.getCandles()[1].time-d.getCandles()[0].time)),y:series.priceToCoordinate(p.price)}));
      return {range,width:bounds.width,height:bounds.height,spacing:chart.timeScale().options().barSpacing,anchors,
        lowestCandle:Math.min(...d.getCandles().map(c=>c.low)),
        labels:[...d.aiContent.querySelectorAll('text')].map(t=>{const b=t.getBBox();return {text:t.textContent,x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height};}),
        planLabels:d.orderLineContent.querySelectorAll('[data-trading-plan-price-line]').length,
        visibleCandles:d.getCandles().slice(Math.max(0,Math.ceil(range.from)),Math.floor(range.to)+1)
          .map(c=>({high:series.priceToCoordinate(c.high),low:series.priceToCoordinate(c.low)}))};
    };
  `);
  const rows = [];
  for (const theme of process.argv.includes('--split-only') ? [] : ['light', 'dark']) for (const width of [1200, 620]) for (const mode of [0, 1, 2]) for (const withPlan of [true, false]) {
    const name = `${theme}-${width}-mode${mode}-${withPlan ? 'plan' : 'structure'}`;
    win.setSize(width, 900);
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.clearAllDrawings();
      workspace.chart.priceScale('right').applyOptions({mode:${mode},autoScale:true});window.patch=makePatch(${withPlan});
      d.storeAiDrawingPatch(patch);workspace.chart.timeScale().setVisibleLogicalRange({from:405,to:525});`);
    await settle();
    const before = await js('return inspect()');
    if (name === 'light-1200-mode0-plan') fs.writeFileSync(path.join(output, 'before.png'), (await win.webContents.capturePage()).toPNG());
    await js('await workspace.acceptAnalysisDrawingPatch(patch,0,undefined,()=>true,100)');
    await settle();
    const after = await js('return inspect()');
    fs.writeFileSync(path.join(output, 'last-case.json'), JSON.stringify({ name, before, after }, null, 2));
    assert.ok(after.range.from < 280 && after.range.to > 515, name + ': full horizontal structure');
    assert.ok(after.anchors.every(p => p.x > 0 && p.x < after.width && p.y > 0 && p.y < after.height), name + ': all structure anchors');
    assert.ok(after.lowestCandle > 70000, name + ': fixture prices remain stable across background refresh');
    assert.ok((Math.max(...after.anchors.map(p=>p.y))-Math.min(...after.anchors.map(p=>p.y)))/after.height > .5, name + ': usable structure height');
    assert.ok(after.labels.length >= 7, name + ': phase and projection labels present');
    assert.ok(after.labels.every(b => b.x >= 0 && b.right <= after.width && b.y >= 0 && b.bottom <= after.height), name + ': labels contained');
    assert.equal(after.planLabels, withPlan ? 5 : 0, name);
    assert.ok(after.visibleCandles.every(c => c.high >= 0 && c.low <= after.height), name + ': candle extrema');
    rows.push({ name, before, after });
    if (mode === 0 && withPlan) fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  // Reopening a saved plan must use the same final fit. Later manual navigation
  // remains in control; redraw alone must never reset the user's time window.
  await js('window.patch=makePatch();workspace.chart.timeScale().setVisibleLogicalRange({from:450,to:510});d.showExecutionPlanDrawing(patch)');
  await settle();
  assert.ok((await js('return inspect()')).range.from < 280);
  await js('workspace.chart.timeScale().setVisibleLogicalRange({from:470,to:505});d.redraw()');
  await settle();
  assert.ok(Math.abs((await js('return inspect()')).range.from - 470) < .01);
  await js('window.mainDrawing=d;window.mainDrawings=JSON.stringify(d.aiDrawings);workspace.splitLayoutId="2-columns";workspace.applySplitLayout()');
  for (let i=0;i<100&&!await js('return Boolean(workspace.splitPanes[0]?.candles.length)');i++) await pause(50);
  await js('window.d=workspace.splitPanes[0].getDrawingController();window.patch=makePatch();await workspace.acceptAnalysisDrawingPatch(patch,1,undefined,()=>true,100)');
  await settle();
  const split=await js('return inspect()');
  assert.ok(split.range.from<280&&split.range.to>515,'split full structure');
  assert.ok(split.anchors.every(p=>p.x>0&&p.x<split.width&&p.y>0&&p.y<split.height),'split anchors');
  assert.equal(await js('return JSON.stringify(mainDrawing.aiDrawings)===mainDrawings'),true,'split leaves main drawings unchanged');
  assert.equal(await js('return String(window.qaError||"")'), '');
  const reportName=process.argv.includes('--split-only')?'split-report.json':'report.json';
  fs.writeFileSync(path.join(output, reportName), JSON.stringify({ passed: rows.length + 3, rows, split }, null, 2));
  console.log(JSON.stringify({ passed: rows.length + 3, output }));
  win.destroy();await server.close();app.exit(0);
})().catch(async error => {
  console.error(error);fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack));
  if (win && !win.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  win?.destroy();if (server) await server.close();app.exit(1);
});
