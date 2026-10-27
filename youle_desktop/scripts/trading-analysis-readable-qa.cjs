// Real chart geometry, screenshot-inspired synthetic prices, isolated profile.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/analysis-viewport-M1-467/chart');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,`profile-${Date.now()}`));app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms));let win,server;
(async()=>{
  await app.whenReady();
  const {createServer}=await import('vite');
  server=await createServer({configFile:path.join(root,'vite.config.mjs'),server:{port:0,hmr:false}});await server.listen();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^(https?|wss?):/.test(d.url)&&!d.url.startsWith(origin+'/')}));
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  const settle=()=>js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await win.loadURL(origin+'/@fs/'+path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/'));
  for(let i=0;i<160&&!await js('return !!window.ready');i++)await pause(50);
  assert.equal(await js('return !!window.ready'),true);
  await js(`
    document.querySelector('#host').style.cssText='width:100%;height:100%';workspace.loadingHistory=true;
    const pivots=[[0,85000],[390,85000],[410,84500],[425,81000],[445,82000],[467,79200],[479,81000],[485,80100],[491,80850],[496,79500],[499,80101]];
    workspace.candles=workspace.candles.map((c,i)=>{
      const k=pivots.findIndex(p=>p[0]>=i),b=pivots[k],a=pivots[Math.max(0,k-1)];
      const value=a[1]+(b[1]-a[1])*(i-a[0])/Math.max(1,b[0]-a[0]);
      const close=value+Math.sin(i*1.7)*70,open=close+Math.cos(i)*80;
      return {...c,open,close,high:Math.max(open,close)+80,low:Math.min(open,close)-80};
    });
    const sampleCandles=structuredClone(workspace.candles),originalMarketApi=window.codexDesktop.getBinancePublicMarketData;
    window.codexDesktop.getBinancePublicMarketData=async request=>{
      if(request.path.endsWith('/klines'))return {ok:true,status:200,data:sampleCandles.map(c=>
        [c.time*1000,String(c.open),String(c.high),String(c.low),String(c.close),'100',c.time*1000+3599999,'0',1,'0','0','0'])};
      if(request.path.endsWith('/ticker/24hr'))return {ok:true,status:200,data:request.parameters?.symbol?{lastPrice:'80101',openPrice:'81000',quoteVolume:'1'}:[]};
      return originalMarketApi(request);
    };
    workspace.updateChartData({resetViewport:true});
    window.d=workspace.drawingController;window.sequence=0;
    window.makePatch=()=>{
      const candles=d.getCandles(),point=(i,price)=>({time:candles[i].time,price});
      const shape=(id,points,colorToken,text,tool='path')=>({op:'upsert',drawing:{id,points,colorToken,text,tool,
        symbol:d.getSymbol(),interval:d.getInterval(),theory:'strategy',strategyId:'price-action',
        layer:'ai/strategy/price-action',locked:true,status:'confirmed',evidenceIds:[]}});
      return {schemaVersion:1,analysisId:'readable-'+(++sequence),baseRevision:0,marketId:d.getSymbol(),interval:d.getInterval(),operations:[
        shape('structure',[point(425,81000),point(445,82000),point(467,79200),point(479,81000),point(485,80100),point(491,80850)],'strategy-primary',''),
        shape('label',[point(445,82000)],'strategy-primary','LH','text'),
        ...[80266.49,79320.52,80890.50,81190.70,81639.60].map((p,i)=>shape('plan-'+i,[point(390,p),point(499,p)],i===0?'strategy-entry':i===1?'strategy-stop':'strategy-target','入场 止损 止盈'))]};
    };
    window.inspect=()=>{
      const chart=d.getChart(),range=chart.timeScale().getVisibleLogicalRange(),series=d.getCandleSeries(),bounds=d.plotBounds();
      const prices=[80266.49,79320.52,80890.50,81190.70,81639.60],ys=prices.map(p=>series.priceToCoordinate(p));
      return {range,width:bounds.width,height:bounds.height,spacing:chart.timeScale().options().barSpacing,
        price:chart.priceScale('right').getVisibleRange(),ys,
        planOccupancy:(Math.max(...ys)-Math.min(...ys))/bounds.height,
        labels:[...d.orderLineContent.querySelectorAll('[data-trading-plan-price-line]')].map(g=>{
          const b=g.querySelector('.trading-order-line-label-bg').getBBox();return {top:b.y,bottom:b.y+b.height};}),
        visibleCandles:d.getCandles().slice(Math.max(0,Math.ceil(range.from)),Math.floor(range.to)+1)
          .map(c=>({high:series.priceToCoordinate(c.high),low:series.priceToCoordinate(c.low)}))};
    };
  `);
  const rows=[];
  for(const theme of ['light','dark'])for(const width of [1200,620])for(const mode of [0,1,2]){
    const name=`${theme}-${width}-mode${mode}`;win.setSize(width,900);
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();d.clearAllDrawings();
      workspace.chart.priceScale('right').applyOptions({mode:${mode},autoScale:true});window.patch=makePatch();
      d.storeAiDrawingPatch(patch);workspace.chart.timeScale().setVisibleLogicalRange({from:395,to:520});`);
    await settle();await js('d.redraw()');
    const before=await js('return inspect()');
    if(name==='light-1200-mode0')fs.writeFileSync(path.join(output,'before.png'),(await win.webContents.capturePage()).toPNG());
    await js('await workspace.acceptAnalysisDrawingPatch(patch,0,undefined,()=>true,100)');
    await settle();await js('d.redraw()');const after=await js('return inspect()');
    assert.equal(after.labels.length,5,name);
    assert.ok(after.labels.every(l=>l.top>=6&&l.bottom<=after.height-6),name+': labels');
    assert.ok(after.visibleCandles.every(c=>c.high>=0&&c.low<=after.height),name+': candles');
    assert.ok(after.planOccupancy>.55,name+JSON.stringify(after));
    assert.ok(after.range.from>=422&&after.range.from<490,name+': recent structure');
    assert.ok(after.spacing>=7.8,name+': candle width');
    if(width===1200)assert.ok(after.planOccupancy>before.planOccupancy*1.35,name+': magnification');
    rows.push({name,before,after});
    if(mode===0)fs.writeFileSync(path.join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());
  }
  // Native wheel zoom remains under user control after completion.
  await js('workspace.chart.timeScale().setVisibleLogicalRange({from:470,to:505});d.redraw()');await settle();
  assert.ok(Math.abs((await js('return inspect()')).range.from-470)<.01);
  assert.equal(await js('return String(window.qaError||"")'),'');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:rows.length+1,rows},null,2));
  console.log(JSON.stringify({passed:rows.length+1,output}));win.destroy();await server.close();app.exit(0);
})().catch(async error=>{console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));
  if(win&&!win.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());
  win?.destroy();if(server)await server.close();app.exit(1);});
