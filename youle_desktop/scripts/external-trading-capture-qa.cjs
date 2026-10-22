// Isolated real renderer, drawings, capturePage, and final attachment collection.
// Run from the repository root with Vite on 5177. No external channel is contacted.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), out = path.join(root, '.cache/channel-capture-followup-M1-428');
const origin = process.env.HAOLO_QA_ORIGIN || 'http://127.0.0.1:5177';
fs.mkdirSync(out, {recursive:true});
app.setPath('userData', path.join(out, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const report = { checks:[], captures:[], errors:[] };
let win;
function instrument() {
  let desktop, serial=0;
  window.qaReplies=new Map();
  window.qaNative=(method,params)=>new Promise((resolve,reject)=>{
    const id=++serial;qaReplies.set(id,{resolve,reject});qaNativeCall(JSON.stringify({id,method,params}));
  });
  Object.defineProperty(window,'codexDesktop',{configurable:true,get:()=>desktop,set(api){
    desktop=api;
    const list=api.listThreads;
    api.listThreads=async()=>{const result=await list();result.data.push(...['wechat','feishu','telegram'].map(channel=>({id:`${channel}-channel-capture-qa`,name:channel,external_channel:channel,kind:'local_codex',last_message_at:new Date().toISOString()})));return result;};
    api.getWindowState=async()=>({mode:'app',bounds:{width:1440,height:960},appMinimumSize:{width:1000,height:700}});
    api.setWindowMode=async mode=>({mode});
    api.checkWindowsUpdate=async()=>({update_available:false,force_update:false});
    api.getTradingPreferenceProfile=async()=>({ok:true,completed:true,profile:{onboardingCompleted:true}});
    api.getBinancePublicMarketData=async request=>{
      if(request.path.endsWith('/klines')) {
        const step=3600000,end=Math.floor(Date.now()/step)*step;
        return {ok:true,status:200,data:Array.from({length:500},(_,i)=>{const t=end-(499-i)*step,o=1300+Math.sin(i/9)*25+i/20,c=o+Math.sin(i)*4;return [t,String(o),String(Math.max(o,c)+2),String(Math.min(o,c)-2),String(c),'100',t+step-1,'0',1,'0','0','0'];})};
      }
      if(request.path.endsWith('/exchangeInfo')) return {ok:true,status:200,data:{symbols:[]}};
      return {ok:true,status:200,data:request.parameters?.symbol?{lastPrice:'1330',openPrice:'1300',quoteVolume:'1'}:[]};
    };
    api.subscribeBinanceMarketStreams=async()=>({subscriptionId:'qa'});api.unsubscribeBinanceMarketStreams=async()=>{};api.onBinanceMarketEvent=()=>()=>{};
    api.manualDrawings=async p=>p.action==='session'?{owner:'qa-owner'}:{schemaVersion:4,version:1,marketKey:p.market||p.body?.marketKey,serverTime:Date.now(),entries:[]};
    api.captureTradingChart=params=>qaNative('capture',params);
    api.saveExternalTradingPlanImage=params=>qaNative('plan',params);
    api.localFileInfo=params=>qaNative('fileInfo',params);
    api.listMaterials=async()=>[];
  }});
}
const js=code=>win.webContents.executeJavaScript(`(async()=>{try{return {value:await eval(${JSON.stringify(code)})}}catch(e){return {error:String(e.stack)}}})()`,true).then(r=>{if(r.error)throw Error(r.error);return r.value;});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(code) {for(let i=0;i<200;i++){if(await js(code))return;await delay(100);}throw Error('Timeout: '+code);}
(async()=>{
  setTimeout(()=>app.exit(1),120000).unref();
  const {captureTradingChart}=await import(pathToFileURL(path.join(root,'src/main/trading-chart-capture.mjs')).href);
  const {saveExternalTradingPlanImage}=await import(pathToFileURL(path.join(root,'src/main/external-trading-plan-image.mjs')).href);
  const {cloudAccountPlanCardFixture}=await import(pathToFileURL(path.join(root,'test/support/cloud-plan-card-fixture.mjs')).href);
  let baseline='';
  if(process.env.QA_CAPTURE_BASELINE) {
    const ast=ts.createSourceFile('baseline.ts',fs.readFileSync(process.env.QA_CAPTURE_BASELINE,'utf8'),ts.ScriptTarget.Latest,true);
    const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='captureExternalTradingChartAttachment');
    baseline=ts.transpileModule(fn.getText(ast).replace('function captureExternalTradingChartAttachment(','function captureBefore('),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  }
  await app.whenReady();
  win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!(/^(about|data|blob|devtools):/.test(d.url)||d.url.startsWith(origin+'/')||d.url.startsWith(origin.replace('http:','ws:')+'/'))}));
  const debug=win.webContents.debugger;debug.attach('1.3');
  await win.loadURL('about:blank');await debug.sendCommand('Page.enable');await debug.sendCommand('Runtime.enable');
  await debug.sendCommand('Runtime.addBinding',{name:'qaNativeCall'});
  await debug.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`(${instrument.toString()})()`});
  await debug.sendCommand('Fetch.enable',{patterns:[{urlPattern:origin+'/main.ts*',requestStage:'Response'},{urlPattern:origin+'/trading-expert-market.ts*',requestStage:'Response'}]});
  debug.on('message',async(_e,method,p)=>{
    try {
      if(method==='Fetch.requestPaused') {
        const response=await debug.sendCommand('Fetch.getResponseBody',{requestId:p.requestId});
        let body=response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body;
        body+=new URL(p.request.url).pathname==='/main.ts'
          ? `\n${baseline}\nwindow.qa={state,render,capture:captureExternalTradingChartAttachment,tools:codexTradingTools,upsertItem,attachments:waitForWechatChannelReplyAttachments${baseline?',captureBefore':''}};`
          : '\nwindow.qaMarket={get workspace(){return activeWorkspace;}};';
        await debug.sendCommand('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(body).toString('base64')});
      } else if(method==='Runtime.bindingCalled'&&p.name==='qaNativeCall') {
        const {id,method,params}=JSON.parse(p.payload);let result;
        try {
          if(method==='capture') { result=await captureTradingChart(win,params,{app:{getPath:()=>out},clipboard:{}});report.captures.push(result); }
          else if(method==='plan') result=await saveExternalTradingPlanImage(params,{app:{getPath:()=>out},nativeImage:require('electron').nativeImage});
          else if(method==='fileInfo') result={size:fs.statSync(params.path.replace(/^file:\/\//,'')).size};
          else throw Error('Unexpected QA binding');
          await js(`qaReplies.get(${id}).resolve(${JSON.stringify(result)});qaReplies.delete(${id});void 0;`);
        } catch(e) {await js(`qaReplies.get(${id}).reject(Error(${JSON.stringify(e.message)}));qaReplies.delete(${id});void 0;`);}
      }
    } catch(e) {report.errors.push(e.stack);}
  });
  await win.loadURL(origin+'/');
  await until('!!window.qa && !!document.querySelector(".conversation-row[data-thread-id=wechat-channel-capture-qa]")');
  for(const channel of ['wechat','feishu','telegram']) {
    const thread=`${channel}-channel-capture-qa`;
    await js(`document.querySelector('.conversation-row[data-thread-id="${thread}"]').click()`);
    await until(`qa.state.currentThreadId==='${thread}' && qaMarket.workspace?.candles.length>10 && !qaMarket.workspace.marketLoading`);
    const before=await js(`(()=>{const w=qaMarket.workspace;return {marketId:w.selectedMarketId,interval:w.activeInterval,alert:w.alertContextSnapshot().interval};})()`);
    assert.equal(before.interval,'60');assert.equal(before.alert,'1h');
    if(baseline&&channel==='wechat') {
      assert.equal(await js(`qa.captureBefore('${thread}',false,${JSON.stringify(before)})`),null);
      assert.equal(report.captures.length,0);report.checks.push('Baseline 60/1h skips native capture, reproducing the incident');
    }
    const count=report.captures.length;
    const result=await js(`(async()=>{
      const thread='${thread}',turn='${channel}-turn',w=qaMarket.workspace,d=w.drawingController;
      const beforeIds=new Set(qa.state.itemOrder[thread]);
      const candles=d.getCandles(),a=candles.at(-50),b=candles.at(-12),marketId=w.selectedMarketId,interval=w.activeInterval;
      const patch={schemaVersion:1,analysisId:turn,drawingTurnId:turn,baseRevision:0,marketId,interval,operations:[
        {op:'upsert',drawing:{id:turn+'line',symbol:marketId,theory:'wyckoff',layer:'ai/wyckoff',tool:'path',points:[{time:a.time,price:a.low},{time:b.time,price:b.high}],colorToken:'wyckoff-range',locked:true,status:'confirmed',evidenceIds:[]}},
        {op:'upsert',drawing:{id:turn+'note',symbol:marketId,theory:'wyckoff',layer:'ai/wyckoff',tool:'note',points:[{time:b.time,price:b.high}],text:'截图验收：本轮威科夫绘图',colorToken:'wyckoff-note',locked:true,status:'confirmed',evidenceIds:[]}}
      ]};
      qa.tools.collectors.set(thread,[]);qa.tools.presentationResponseIds.set(thread,turn);
      const drawn=await qa.tools.deps.draw(thread,{result:{marketId,interval,drawingArtifacts:[{job:{analysisId:turn,theory:'wyckoff',storageSessionId:thread,marketId,symbol:w.selectedSymbol,interval,language:'zh-CN',drawingTurnId:turn},drawingPatch:patch}]}});
      const items=qa.tools.collectors.get(thread);qa.tools.collectors.delete(thread);qa.tools.presentationResponseIds.delete(thread);
      for(const item of items)qa.upsertItem(thread,item);
      qa.upsertItem(thread,{id:turn+'plan',type:'agentMessage',text:'Conclusion',phase:'final_answer',turnId:turn,__youleExecutionPlanPresentation:'execution-plan',__youleCloudReports:[${JSON.stringify(cloudAccountPlanCardFixture())}]});
      const attachments=await qa.attachments(thread,beforeIds,'Conclusion',{turnId:turn});
      return {drawn,items:items.map(i=>({turnId:i.turnId,attachments:i.attachments})),attachments,focused:qa.state.tradingExpertChartFocusMode};
    })()`);
    assert.equal(result.drawn.count,1);assert.equal(report.captures.length,count+1);
    assert.equal(result.attachments.length,2);assert.match(result.attachments[0].name,/haolo-kline-/);assert.match(result.attachments[1].name,/haolo-plan-/);
    assert.equal(result.items[0].turnId,`${channel}-turn`);assert.equal(result.focused,false);
    for(const file of result.attachments)assert.ok(fs.statSync(file.path).size>1000);
    fs.copyFileSync(result.attachments[0].path,path.join(out,`${channel}-kline.png`));
    report.checks.push(`${channel}: actual drawing → focus layout → capturePage → scoped native item → K-line + plan PNG`);
  }
  fs.writeFileSync(path.join(out,'capture-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks,captureCount:report.captures.length}));app.exit(0);
})().catch(async e=>{
  report.failure=e.stack;
  if(win) {report.state=await js('({thread:qa?.state.currentThreadId,chart:qaMarket?.workspace?.alertContextSnapshot(),ready:qaMarket?.workspace?.candles.length})').catch(()=>null);}
  fs.writeFileSync(path.join(out,'capture-report.json'),JSON.stringify(report,null,2));console.error(e);app.exit(1);
});
