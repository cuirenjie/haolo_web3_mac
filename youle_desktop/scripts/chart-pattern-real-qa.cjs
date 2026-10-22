// Isolated real renderer + frozen public incident OHLCV; no account/model calls.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/chart-patterns-M1-444');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,`profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report={checks:[],screenshots:[]};
let win;
(async()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/wyckoff-btc-retest-20261022.json')));
  const candles=[...fixture.historyPrefix,...fixture.snapshot.candles].slice(-240).map(c=>({...c,time:c.time/1000}));
  const {runTradingChartPatternAnalysisPipeline}=await import(pathToFileURL(path.join(root,'src/main/trading-analysis/chart-pattern-pipeline.mjs')));
  const patches={};
  for(const language of ['zh-CN','en','zh-TW']){
    const result=await runTradingChartPatternAnalysisPipeline({marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',
      snapshotTime:fixture.snapshot.fetchedAt,tickSize:fixture.snapshot.tickSize,candles,language});
    patches[language]=result.analysisPlan.drawingPatch;
  }
  fs.writeFileSync(path.join(output,'patches.json'),JSON.stringify(patches,null,2));
  await app.whenReady();
  win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:/.test(details.url)&&!details.url.startsWith('http://127.0.0.1:5214/')}));
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
  await win.loadURL(`http://127.0.0.1:5214/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  for(let i=0;i<100&&!await js('return Boolean(window.ready)');i++)await pause(100);
  check('real chart ready',await js('return Boolean(window.ready)'));
  await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';
    workspace.candles=${JSON.stringify(candles)};workspace.updateChartData({resetViewport:true});
    workspace.chart.timeScale().setVisibleLogicalRange({from:135,to:255});
    window.lang=await import('/app-language.mjs');window.draw=await import('/trading-expert-drawing.ts');
    window.native=await import('/chart-pattern-native-tools.ts');
    d.drawings=[{id:'manual-kept',tool:'trend-line',symbol:d.getSymbol(),points:[{time:d.getCandles().at(-60).time,price:80500},{time:d.getCandles().at(-30).time,price:81000}]}];
    window.manual=JSON.stringify(d.drawings);`);
  report.context=await js('return {symbol:d.getSymbol(),interval:d.getInterval()}');
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en','zh-TW']){
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();lang.applyAppLanguage('${language}',{root:document.body});
      let patch=${JSON.stringify(patches[language])};patch={...patch,marketId:d.getSymbol(),interval:d.getInterval(),drawingTurnId:'qa-${theme}-${language}',
        operations:patch.operations.map(o=>({...o,drawing:{...o.drawing,symbol:d.getSymbol()}}))};
      patch=draw.localizeTradingAiDrawingPatch(patch,'${language}');d.storeAiDrawingPatch(patch);window.accepted=JSON.stringify(d.aiDrawings);d.redraw();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
    await pause(150);
    check(`${theme}/${language} multiple structures rendered`,await js('return d.aiContent.querySelectorAll("[data-drawing-id$=structure]").length>=2'));
    check(`${theme}/${language} historical state visible`,await js(`return /${language==='en'?'Historical reference':language==='zh-TW'?'歷史參考':'历史参考'}/.test(d.aiContent.textContent)`));
    check(`${theme}/${language} manual layer preserved`,await js('return JSON.stringify(d.drawings)===manual'));
    check(`${theme}/${language} all shape coordinates finite`,await js('return !/NaN|Infinity/.test(d.aiContent.innerHTML)'));
    check(`${theme}/${language} accepted drawing anchors and bindings unchanged`,await js('return JSON.stringify(d.aiDrawings)===accepted'));
    check(`${theme}/${language} native trend lines and multi-point tools match manual geometry`,await js(`
      const shapes=d.aiDrawings.filter(x=>x.tool==='path'&&!/-level-/.test(x.id));let lines=0,polylines=0;
      for(const source of shapes){
        const display=native.chartPatternNativeDrawingModel(source);
        const tag=source.points.length===2?'line':'polyline';
        const actual=d.aiContent.querySelector('[data-drawing-id="'+source.id+'"] '+tag);
        if(!actual)continue;
        const group=document.createElementNS('http://www.w3.org/2000/svg','g');
        group.innerHTML=d.renderDrawing({...display,source:'manual'},d.plotBounds(),false,false);
        const expected=group.querySelector(tag);
        const attributes=tag==='line'?['x1','y1','x2','y2']:['points'];
        if(!expected||attributes.some(a=>actual.getAttribute(a)!==expected.getAttribute(a)))return false;
        if(tag==='line')lines++;else polylines++;
      }
      return lines>=2&&polylines>=2;`));
    if(language==='en')check(`${theme}/${language} no untranslated labels`,await js('return !/\\p{Script=Han}/u.test(d.aiContent.textContent)'));
    const name=`${theme}-${language}.png`;
    fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage()).toPNG());report.screenshots.push(name);
  }
  check('native annotations retain existing text interaction targets',await js('return d.aiTextHitContent.querySelectorAll("[data-ai-text-size-trigger]").length>0'));
  await js('d.aiTextSizeToolbar.querySelector("[data-ai-text-size-action=toggle-visibility]").click();d.redraw()');
  check('existing visibility control hides the AI layer only',await js('return d.drawingVisibility.aiHidden&&d.aiContent.childElementCount===0&&JSON.stringify(d.drawings)===manual'));
  await js('d.aiTextSizeToolbar.querySelector("[data-ai-text-size-action=toggle-visibility]").click();d.redraw()');
  check('existing visibility control restores native shapes',await js('return !d.drawingVisibility.aiHidden&&d.aiContent.querySelectorAll("[data-drawing-id$=structure]").length>=2'));
  check('existing clear strategy operation removes chart patterns only',await js('return d.clearAiAnalysisForCurrentContext("chart-patterns")&&!d.aiDrawings.some(x=>x.strategyId==="chart-patterns")&&JSON.stringify(d.drawings)===manual'));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots,context:report.context,output}));app.exit(0);
})().catch(async error=>{
  console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));
  if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);
});
setTimeout(()=>app.exit(1),90000).unref();
