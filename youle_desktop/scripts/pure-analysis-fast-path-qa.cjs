// Isolated native renderer smoke test. All service responses are fixtures;
// external requests are blocked and the user's profile is never opened.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const newThreadScenario=process.argv.includes('--new-thread');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.cache/pure-analysis-M1-429',newThreadScenario?'native-new-thread':'native');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,`profile-${Date.now()}`));
app.disableHardwareAcceleration();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function instrument(report,newThreadScenario) {
  window.qa={calls:[],saved:[],errors:[],playbacks:[],draftFrames:0,revealFrames:[],visibleFrames:[],beforeReport:[],playing:false};
  const seenReportText=new Map();
  new MutationObserver(()=>{
    for(const row of document.querySelectorAll('[data-message-id^="pure-trading-"][data-message-id$="-report"]')) {
      const text=row.innerText,id=row.dataset.messageId;
      if(seenReportText.get(id)===text)continue;seenReportText.set(id,text);
      qa.visibleFrames.push({id,text,playing:qa.playing,thinking:document.querySelectorAll('.thinking-row').length,
        progress:document.querySelectorAll('[data-message-id^="trading-"][data-message-id*="-progress-"]').length,
        cards:row.querySelectorAll('.message-execution-plan').length});
    }
  }).observe(document,{childList:true,subtree:true,characterData:true});
  addEventListener('error',event=>qa.errors.push(event.message));
  addEventListener('unhandledrejection',event=>qa.errors.push(String(event.reason)));
  let desktop;
  Object.defineProperty(window,'codexDesktop',{configurable:true,get:()=>desktop,set(api){
    desktop=api;
    if(newThreadScenario){
      const start=api.startThread,list=api.listThreads;let created=null;
      api.startThread=async p=>{const result=await start.call(api,p);created={...result.thread,id:'qa-promoted-thread',name:'QA 纯引用正式会话'};return {...result,thread:created};};
      api.listThreads=async()=>{const result=await list.call(api);return {...result,data:created?[created,...result.data]:result.data};};
    }
    api.checkWindowsUpdate=async()=>({current_version:'0.1.177',update_available:false,force_update:false});
    api.recordTradingAnalysisFailure=async failure=>qa.calls.push({kind:'failure',failure});
    api.getTradingPreferenceProfile=async()=>({ok:true,completed:true,profile:{onboardingCompleted:true}});
    api.persistTradingTranscript=async p=>{qa.saved.push(p.items);return {threadId:p.threadId,persistedItemIds:p.items.map(i=>i.id)};};
    api.tradingCloudRecovery=async(...args)=>{qa.calls.push({kind:'recovery',args});return [];};
    api.runTradingStrategyAnalysis=async p=>{
      qa.beforeReport.push(document.querySelectorAll('.thinking-row').length);
      qa.calls.push({kind:'analysis',request:p});await new Promise(r=>setTimeout(r,120));
      const frozen={...report,strategyId:p.strategyId,marketId:p.marketId,interval:p.interval};
      const drawing={id:p.analysisJobId+'-line',symbol:p.marketId,interval:p.interval,theory:'strategy',strategyId:p.strategyId,
        layer:'ai/strategy/'+p.strategyId,tool:'path',points:[{time:Math.floor(Date.now()/3600000)*3600-3600,price:82000},{time:Math.floor(Date.now()/3600000)*3600,price:82000}],
        colorToken:'strategy-primary',locked:true,status:'confirmed',evidenceIds:['qa']};
      return {ok:true,cloud:{executionPolicy:'entry-v2',runId:frozen.runId,resultHash:frozen.resultHash,locale:'zh-CN',planRecords:frozen.planRecords},
        executionPlan:frozen.executionPlan,strategy:{id:p.strategyId},snapshot:{marketId:p.marketId,interval:p.interval,candles:Array(100)},model:{modelId:p.model},
        analysisPlan:{report:report.report,narrative:'SHORT STATUS ONLY',drawingPatch:{schemaVersion:1,analysisId:p.analysisJobId,baseRevision:0,
          marketId:p.marketId,interval:p.interval,operations:[{op:'upsert',drawing}]}}};
    };
    const send=api.sendMessage;
    api.sendMessage=async(...args)=>{qa.calls.push({kind:'root'});return send.apply(api,args);};
    api.getBinancePublicMarketData=async request=>{
      if(request.path.endsWith('/klines')){
        const step=3600000,end=Math.floor(Date.now()/step)*step;
        return {ok:true,status:200,data:Array.from({length:500},(_,i)=>{
          const time=end-(499-i)*step,close=82000+Math.sin(i/9)*250;
          return [time,String(close-50),String(close+100),String(close-100),String(close),'100',time+step-1,'0',1,'0','0','0'];
        })};
      }
      if(request.path.endsWith('/exchangeInfo'))return {ok:true,status:200,data:{symbols:[{symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',status:'TRADING',contractType:'PERPETUAL'}]}};
      if(request.path.endsWith('/ticker/24hr'))return {ok:true,status:200,data:request.parameters?.symbol?{lastPrice:'82000',openPrice:'81000',quoteVolume:'1'}:[]};
      return {ok:true,status:200,data:[]};
    };
    api.subscribeBinanceMarketStreams=async()=>({subscriptionId:'qa'});
    api.unsubscribeBinanceMarketStreams=async()=>{};api.onBinanceMarketEvent=()=>()=>{};
  }});
}
(async()=>{
  const {pathToFileURL}=require('node:url');
  const {cloudPlanCardFixture}=await import(pathToFileURL(path.join(root,'test/support/cloud-plan-card-fixture.mjs')));
  const report=cloudPlanCardFixture();report.report='完整分析报告 QA：趋势证据、入场条件、止损、止盈与失效条件全部保留。'+'\n\n逐段输出已校验的证据和条件，同时保留原逐笔绘图过程。'.repeat(5);
  const {createServer}=await import('vite');
  const server=await createServer({configFile:path.join(root,'vite.config.mjs'),server:{port:0,strictPort:false,hmr:false},plugins:[{
    name:'pure-analysis-isolated-test-hooks',transform(code,id){
      if(id.replaceAll('\\','/').split('?')[0]===path.join(root,'src/renderer/trading-expert-ai-playback.ts').replaceAll('\\','/'))return code
        .replace('this.options = options;', 'this.options = {...options,setDraft:(drawing,opacity)=>{if(drawing)window.qa.draftFrames++;options.setDraft(drawing,opacity);}};')
        .replace('options.onPhase?.("completed");','window.qa.playing=false;options.onPhase?.("completed");')
        .replace('const generation = ++this.generation;', `window.qa.playing=true;window.qa.playbacks.push({speedMultiplier:options.speedMultiplier,revealing:window.pureQa.snapshot().revealing,busy:window.pureQa.snapshot().pure.length>0,sidebarWorking:Boolean(document.querySelector('[data-thread-row="'+window.pureQa.snapshot().threadId+'"] .conversation-row-spinner')),startedAt:performance.now()});\nconst generation = ++this.generation;`);
      if(id.replaceAll('\\','/').split('?')[0]!==path.join(root,'src/renderer/main.ts').replaceAll('\\','/'))return;
      return code.replace('pureAnalysisReportReveals.set(reportId, text);','pureAnalysisReportReveals.set(reportId, text);window.qa.revealFrames.push({text,playing:window.qa.playing,cards:document.querySelectorAll(".message-execution-plan").length});')+`\nwindow.pureQa={send:sendCurrentMessage,setBusy:(id,busy)=>{setCodexThreadBusy(id,busy);patchConversationRow(id);},select:()=>selectChatModelForThread(currentComposerThreadId(),chatModelOptions.find(m=>m.value==='gpt-6-astra')||chatModelOptions[0]),snapshot:()=>({threadId:currentComposerThreadId(),model:selectedChatModelValue(),target:captureTradingExpertAnalysisTarget(),pure:[...pureTradingAnalysisThreads],revealing:pureAnalysisReportReveals.size,pending:[...submittingComposerThreadIds],error:state.error,mode:codexConversationModeForThread(currentComposerThreadId()),surface:isTradingExpertSurfaceThreadId(currentComposerThreadId())})};`;
    }
  }]});await server.listen();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  await app.whenReady();const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!(/^(about|data|blob|devtools):/.test(details.url)||details.url.startsWith(origin+'/'))}));
  win.webContents.debugger.attach('1.3');await win.loadURL('about:blank');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`(${instrument.toString()})(${JSON.stringify(report)},${newThreadScenario})`});
  const js=code=>win.webContents.executeJavaScript(code,true);
  async function until(expression){for(let i=0;i<120;i++){if(await js(expression))return;await delay(100);}throw Error(`Timeout: ${expression}`);}
  try{
    await win.loadURL(origin+'/');
    await until('Boolean(window.pureQa&&document.querySelector("#composerInput"))');
    await until('Boolean(pureQa.snapshot().target)');
    if(newThreadScenario){
      await js(`document.querySelector('[data-action="new-chat"]').click()`);
      await until('pureQa.snapshot().threadId?.startsWith("local-blank-")&&Boolean(pureQa.snapshot().target)');
    }
    await js('pureQa.select()');await delay(300);
    const initial=await js('pureQa.snapshot()');assert.equal(initial.surface,true);
    const sidebarChecks=[];
    if(newThreadScenario)await js('pureQa.setBusy("mock-thread-1",true)');
    for(const token of ['@策略:裸K','@指标:MACD']){
      await js(`(()=>{const input=document.querySelector('#composerInput');input.value=${JSON.stringify(token)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composerForm').requestSubmit();})()`);
      await until(`qa.calls.filter(c=>c.kind==='analysis').length===${token.includes('MACD')?2:1}`);
      await until('pureQa.snapshot().pure.length===0&&pureQa.snapshot().pending.length===0');
      await until('!document.querySelector(".thinking-row")&&!document.querySelector("#composerForm .stop-button")');
      await until(`![...document.querySelectorAll('.turn-result-toggle')].some(el=>/待完成|Pending/.test(el.textContent))`);
      await until(`document.body.innerText.split(${JSON.stringify(report.report)}).length>=${token.includes('MACD')?3:2}`);
      assert.equal(await js('qa.calls.filter(c=>c.kind==="root").length'),0);
      assert.equal(await js('Boolean(document.querySelector(".message-execution-plan"))'),true);
      assert.equal(await js(`document.body.innerText.includes(${JSON.stringify(report.report)})`),true);
      assert.equal(await js('Boolean(document.querySelector("#composerForm .stop-button"))'),false);
      assert.equal(await js('qa.calls.filter(c=>c.kind==="failure").length'),0);
      const expectedReports=token.includes('MACD')?2:1;
      assert.equal(await js('document.querySelectorAll(".turn-result-toggle").length'),expectedReports,'one process header per report');
      assert.equal(await js('document.querySelectorAll(".message-execution-plan").length'),expectedReports);
      assert.equal(await js('/云端报告和条件校验已完成|分析与绘图已完成/.test(document.body.innerText)'),false,'no trailing completion bubbles');
      await js('[...document.querySelectorAll("[data-action=toggle-turn-result]")].at(-1).click()');
      await until('document.body.innerText.includes("正在逐笔绘制分析标注")');
      await js('[...document.querySelectorAll("[data-action=toggle-turn-result]")].at(-1).click()');
      await until('!/云端报告和条件校验已完成|分析与绘图已完成/.test(document.body.innerText)');
      const sidebar=await js('({workingThreadIds:[...document.querySelectorAll("[data-thread-row]")].filter(r=>r.querySelector(".conversation-row-spinner")).map(r=>r.dataset.threadRow),staleRows:[...document.querySelectorAll("[data-thread-row]")].filter(r=>r.dataset.threadRow.startsWith("local-blank-")).map(r=>r.dataset.threadRow),currentRows:[...document.querySelectorAll("[data-thread-row]")].filter(r=>r.dataset.threadRow===pureQa.snapshot().threadId).length})');
      assert.deepEqual(sidebar.workingThreadIds,newThreadScenario?['mock-thread-1']:[],JSON.stringify(sidebar));
      assert.equal(sidebar.currentRows,1,JSON.stringify(sidebar));
      if(newThreadScenario)assert.equal(sidebar.staleRows.length,0,JSON.stringify(sidebar));
      sidebarChecks.push({token,...sidebar});
    }
    if(newThreadScenario){
      await js('pureQa.setBusy("mock-thread-1",false)');
      await until('document.querySelectorAll(".conversation-row-spinner").length===0');
    }
    const evidence=await js('({calls:qa.calls,saved:qa.saved,errors:qa.errors,playbacks:qa.playbacks,draftFrames:qa.draftFrames,revealFrames:qa.revealFrames,visibleFrames:qa.visibleFrames,beforeReport:qa.beforeReport,final:pureQa.snapshot()})');
    assert.equal(evidence.playbacks.length,2);
    evidence.playbacks.forEach(playback=>{assert.equal(playback.speedMultiplier,1.5);assert.equal(playback.revealing,1);assert.equal(playback.busy,true);assert.equal(playback.sidebarWorking,true);});
    assert.ok(evidence.revealFrames.filter(frame=>frame.playing).length>2,'text streams while the original drawing is playing');
    assert.ok(evidence.revealFrames.every(frame=>frame.text.length<report.report.length),'partial frames precede the full report');
    assert.equal(evidence.final.revealing,0);
    assert.ok(evidence.beforeReport.every(count=>count>0),'thinking bubbles remain before reveal');
    const partialFrames=evidence.visibleFrames.filter(frame=>frame.text.includes('完整分析报告 QA')&&!frame.text.includes('全部保留'));
    assert.ok(partialFrames.length>2,'the real DOM must visibly grow, not only internal state');
    assert.ok(partialFrames.every(frame=>frame.thinking===0&&frame.progress===0&&frame.cards===0),'only the growing report is visible during reveal');
    assert.ok(evidence.draftFrames>2,'original incremental drawing animation must run');
    for(const call of evidence.calls.filter(c=>c.kind==='analysis')){
      assert.equal(call.request.model,initial.model);assert.equal(call.request.reasoningEffort,'max');
      assert.equal(call.request.responseMode,'full');assert.equal(call.request.marketId,initial.target.marketId);
    }
    assert.ok(evidence.saved.some(items=>items.some(item=>item.role==='assistant'&&item.cloudReports?.length&&item.text.includes('完整分析报告 QA'))));
    assert.deepEqual(evidence.errors,[]);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(500);
    fs.writeFileSync(path.join(out,'report.png'),(await win.webContents.capturePage()).toPNG());
    // Additional prose must still go through the ordinary root agent.
    await js(`(()=>{const input=document.querySelector('#composerInput');input.value='@指标:MACD 解释原因';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#composerForm').requestSubmit();})()`);
    await until('qa.calls.some(c=>c.kind==="root")');
    assert.equal(await js('qa.calls.filter(c=>c.kind==="analysis").length'),2);
    fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({passed:true,...evidence,newThreadScenario,sidebarChecks,ordinaryRootDispatch:true},null,2));
    console.log('Native renderer: pure strategy + indicator, complete report, plan card, history, settled send button, sidebar completion and ordinary root dispatch passed.');
  }catch(error){
    fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify(await js('({qa:window.qa,state:window.pureQa?.snapshot(),text:document.body.innerText})'),null,2));
    throw error;
  }finally{win.webContents.debugger.detach();await server.close();win.destroy();}
  app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);});
