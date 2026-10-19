// Replay validated production results through real chart receivers in a hidden,
// isolated Electron profile. No network analyses, account edits or orders.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const input=path.resolve(process.argv[2]||path.join(root,'.cache/analysis-matrix-20261019'));
const output=path.join(input,'charts');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const receipt=JSON.parse(fs.readFileSync(path.join(input,'receipt.json'),'utf8'));
 const partial=process.argv.includes('--partial');
 if(!partial){assert.equal(receipt.passed,true);assert.equal(receipt.cases.length,51);}
 const results=receipt.cases.filter(row=>row.state==='succeeded').map(row=>({row,result:JSON.parse(fs.readFileSync(path.join(input,row.key.replaceAll(':','-')+'.json'),'utf8'))}));
 const {createServer}=await import('vite');
 const fixture=fs.readFileSync(path.join(root,'test/fixtures/trading-chart-navigation.html'),'utf8').replace(
  "const step = request.parameters.interval === '1d' ? 86400000 : 3600000;",
  "const step = ({'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'1w':604800}[request.parameters.interval]||3600)*1000;");
 const server=await createServer({configFile:path.join(root,'vite.config.mjs'),plugins:[{name:'isolated-matrix-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url!=='/__matrix-fixture.html')return next();res.setHeader('Content-Type','text/html');res.end(fixture);});}}],server:{port:0,strictPort:false,hmr:false}});await server.listen();
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 await app.whenReady();const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code,true),checks=[],errors=[];
 win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.includes('Binance market catalog is unavailable'))errors.push(event.message);});
 try{
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en','zh-TW']){
   await win.webContents.session.clearStorageData();
   await win.loadURL(base+'/__matrix-fixture.html');
   for(let n=0;n<100&&!await js('Boolean(window.ready)');n++)await pause(50);
   assert.equal(await js('Boolean(window.ready)'),true);
   await js(`(async()=>{document.querySelector('#host').style.cssText='width:100%;height:100%';document.documentElement.dataset.theme=${JSON.stringify(theme)};
    (await import('/app-language.mjs')).applyAppLanguage(${JSON.stringify(language)},{root:document.body});
    workspace.applyChartTheme();workspace.loadingHistory=true;workspace.splitLayoutId='3-columns';workspace.applySplitLayout();})()`);
   for(let n=0;n<100&&!await js('workspace.splitPanes.length===2&&workspace.splitPanes.every(p=>p.candles.length)');n++)await pause(50);
   assert.equal(await js('workspace.splitPanes.length'),2);
   for(const {row,result} of results){
    const paneIndex=Number(row.key.match(/:pane:(\d+)$/)?.[1]||0);
    const state=await js(`(async()=>{
     const result=${JSON.stringify(result)},row=${JSON.stringify(row)},index=${paneIndex};
     const w=index?workspace.splitPanes[index-1]:workspace;
     const symbol=row.marketId.split(':').at(-1),market={...(w.market||w.selectedMarketMeta),id:row.marketId,symbol,baseAsset:symbol.replace('USDT',''),quoteAsset:'USDT',displaySymbol:symbol.replace('USDT','/USDT')};
     if(index){w.market=market;w.interval=row.interval;w.updateToolbarState();}else{w.selectMarket(market);w.activeInterval=row.interval;w.updateSymbolUi();w.updateIntervalPressedButtons(row.interval);}
     w.loadedMarketId=row.marketId;w.loadedInterval=row.interval;
     const step={'15':900,'240':14400,'1D':86400}[row.interval],end=Math.floor(Date.now()/1000/step)*step,scale=symbol==='BTCUSDT'?82500:symbol==='ETHUSDT'?2400:105;
     w.candles=Array.from({length:500},(_,i)=>{const close=scale*(1+.01*Math.sin(i/17));return {time:end-(499-i)*step,open:close*.999,close,high:close*1.002,low:close*.998,volume:100+i};});
     if(index){w.updateData([]);w.renderLatestOhlc();}else w.updateChartData({resetViewport:true});
     const patch=result.analysisPlan.drawingPatch,indicator=result.analysisPlan.indicatorDrawingPatch;
     if(patch)workspace.storeAnalysisDrawingPatch(patch,index);
     let accepted=null;if(indicator)accepted=workspace.acceptIndicatorAnalysisDrawingPatch(indicator,index);
     await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
     const d=index?w.getDrawingController():w.drawingController;
     const saved=d.aiDrawings.filter(p=>p.symbol===row.marketId&&p.interval===row.interval);
     const runtime=indicator?w.indicatorPanes.get(indicator.indicatorId):null;
     return {paneIndex:index,marketId:row.marketId,interval:row.interval,drawings:saved.length,expectedDrawings:patch?.operations.length||0,indicatorAccepted:accepted,
       indicatorSeries:runtime?.analysisSeries?.length||0,indicatorSignature:runtime?.analysisSignature||'',error:window.qaError||null};
    })()`);
    assert.equal(state.error,null);assert.equal(state.drawings,state.expectedDrawings,row.key);
    if(result.analysisPlan.indicatorDrawingPatch){assert.equal(state.indicatorAccepted,true,row.key);assert.ok(state.indicatorSignature,row.key);}
    checks.push({theme,language,strategyId:row.strategyId,...state});
   }
   await js('workspace.splitPanes.forEach(p=>p.rebuildIndicatorPanes());void 0');
   fs.writeFileSync(path.join(output,`${theme}-${language}.png`),(await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,partial?'partial-receipt.json':'receipt.json'),JSON.stringify({passed:true,partial,checks,errors},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length,themes:2,languages:3}));
 }finally{win.destroy();await server.close();}
 app.exit(0);
})().catch(e=>{fs.writeFileSync(path.join(output,'failure.log'),e.stack||String(e));console.error(e.stack);app.exit(1);});
