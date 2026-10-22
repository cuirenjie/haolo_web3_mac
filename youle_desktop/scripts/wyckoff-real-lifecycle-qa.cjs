// Isolated real renderer + frozen public incident OHLCV; no account/model calls.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/wyckoff-lifecycle-M1-442');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,`profile-${Date.now()}`));
app.disableHardwareAcceleration();
const pause=ms=>new Promise(r=>setTimeout(r,ms)),report={checks:[],screenshots:[]};
let win;
(async()=>{
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/wyckoff-btc-retest-20261022.json')));
  const candles=[...fixture.historyPrefix,...fixture.snapshot.candles].slice(-240).map(c=>({...c,time:c.time/1000}));
  const {runTradingWyckoffAnalysisPipeline}=await import(pathToFileURL(path.join(root,'src/main/trading-analysis/wyckoff-pipeline.mjs')));
  const patches={};
  for(const language of ['zh-CN','en','zh-TW']){
    const result=await runTradingWyckoffAnalysisPipeline({marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',
      snapshotTime:fixture.snapshot.fetchedAt,tickSize:fixture.snapshot.tickSize,candles,language},
      {modelRegistry:{async analyze(){return {providerId:'fixture',modelId:'fixture',text:JSON.stringify({schemaVersion:1,
        verdict:'approve',summary:language==='en'?'The supplied range and retest are supported.':'已提供的箱体与回踩有量价证据支持。',showProjectionZone:false})};}}});
    patches[language]=result.analysisPlan.drawingPatch;
  }
  fs.writeFileSync(path.join(output,'patches.json'),JSON.stringify(patches,null,2));
  await app.whenReady();
  win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:/.test(details.url)&&!details.url.startsWith('http://127.0.0.1:5213/')}));
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
  await win.loadURL(`http://127.0.0.1:5213/@fs/${path.join(root,'test/fixtures/trading-chart-navigation.html').replaceAll('\\','/')}`);
  for(let i=0;i<100&&!await js('return Boolean(window.ready)');i++)await pause(100);
  check('real chart ready',await js('return Boolean(window.ready)'));
  await js(`window.d=workspace.drawingController;workspace.loadingHistory=true;document.querySelector('#host').style.cssText='width:100%;height:100%';
    workspace.candles=${JSON.stringify(candles)};workspace.updateChartData({resetViewport:true});
    workspace.chart.timeScale().setVisibleLogicalRange({from:60,to:270});
    window.lang=await import('/app-language.mjs');window.draw=await import('/trading-expert-drawing.ts');
    d.drawings=[{id:'manual-kept',tool:'trend-line',symbol:d.getSymbol(),points:[{time:d.getCandles().at(-60).time,price:80500},{time:d.getCandles().at(-30).time,price:81000}]}];
    window.manual=JSON.stringify(d.drawings);`);
  report.context=await js('return {symbol:d.getSymbol(),interval:d.getInterval()}');
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en','zh-TW']){
    await js(`document.documentElement.dataset.theme='${theme}';workspace.applyChartTheme();lang.applyAppLanguage('${language}',{root:document.body});
      let patch=${JSON.stringify(patches[language])};patch={...patch,marketId:d.getSymbol(),interval:d.getInterval(),drawingTurnId:'qa-${theme}-${language}',
        operations:patch.operations.map(o=>({...o,drawing:{...o.drawing,symbol:d.getSymbol()}}))};
      patch=draw.localizeTradingAiDrawingPatch(patch,'${language}');d.storeAiDrawingPatch(patch);d.redraw();
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
    await pause(150);
    check(`${theme}/${language} rectangle rendered`,await js('return Boolean(d.aiContent.querySelector("[data-drawing-id$=range] rect"))'));
    check(`${theme}/${language} lifecycle path rendered`,await js('return Boolean(d.aiContent.querySelector("[data-drawing-id$=breakout-retest]"))'));
    check(`${theme}/${language} breakout and retest labels`,await js('return /SOS/.test(d.aiContent.textContent)&&/LPS/.test(d.aiContent.textContent)'));
    check(`${theme}/${language} pending state visible`,await js(`return /${language==='en'?'confirmation':language==='zh-TW'?'確認':'确认'}/.test(d.aiContent.textContent)`));
    check(`${theme}/${language} manual layer preserved`,await js('return JSON.stringify(d.drawings)===manual'));
    check(`${theme}/${language} all shape coordinates finite`,await js('return !/NaN|Infinity/.test(d.aiContent.innerHTML)'));
    if(language==='en')check(`${theme}/${language} no untranslated labels`,await js('return !/\\p{Script=Han}/u.test(d.aiContent.textContent)'));
    const name=`${theme}-${language}.png`;
    fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage()).toPNG());report.screenshots.push(name);
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots,context:report.context,output}));app.exit(0);
})().catch(async error=>{
  console.error(error);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));
  if(win)fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1);
});
setTimeout(()=>app.exit(1),90000).unref();
