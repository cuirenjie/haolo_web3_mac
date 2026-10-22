// Full renderer regression: background shell renders must retain chart text input.
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '../.cache/text-shell-qa');
const baseline = process.argv.includes('--baseline');
fs.mkdirSync(out, {recursive:true});
app.setPath('userData', path.join(out, `profile-${Date.now()}`));
app.disableHardwareAcceleration();
const origin = process.env.HAOLO_QA_ORIGIN || 'http://127.0.0.1:5177';
const delay = ms => new Promise(r=>setTimeout(r,ms));
const report = {checks:[], baseline};
let win;
function instrument() {
  window.qa = {handlers:{}, renders:0, focus:[], composition:[], requests:0, entries:{}};
  const html = Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  Object.defineProperty(Element.prototype,'innerHTML',{...html,set(value){if(this.id==='app')qa.renders++;html.set.call(this,value)}});
  for(const type of ['focusin','focusout'])document.addEventListener(type,e=>qa.focus.push({type,target:e.target.id||e.target.className,related:e.relatedTarget?.id||e.relatedTarget?.className,at:performance.now()}),true);
  for(const type of ['compositionstart','compositionupdate','compositionend'])document.addEventListener(type,e=>qa.composition.push({type,data:e.data}),true);
  let desktop;
  Object.defineProperty(window,'codexDesktop',{configurable:true,get:()=>desktop,set(api){
    desktop=api;
    for(const name of ['onStatus','onSkills']){const original=api[name];api[name]=cb=>{qa.handlers[name]=cb;return original?.call(api,cb)||(()=>{})}}
    api.getWindowState=async()=>({mode:'login',bounds:{width:1440,height:960},appMinimumSize:{width:1000,height:700}});
    api.setWindowMode=async mode=>({mode});
    api.checkWindowsUpdate=async()=>({current_version:'0.0.0',update_available:false,force_update:false});
    api.getTradingPreferenceProfile=async()=>({ok:true,completed:true,profile:{onboardingCompleted:true}});
    api.getBinancePublicMarketData=async request=>{
      if(request.path.endsWith('/klines')){
        const step=3600000,end=Math.floor(Date.now()/step)*step;
        return {ok:true,status:200,data:Array.from({length:500},(_,i)=>{const t=end-(499-i)*step,o=1300+Math.sin(i/9)*25+i/20,c=o+Math.sin(i)*4;return [t,String(o),String(Math.max(o,c)+2),String(Math.min(o,c)-2),String(c),'100',t+step-1,'0',1,'0','0','0']})};
      }
      if(request.path.endsWith('/exchangeInfo'))return {ok:true,status:200,data:{symbols:[]}};
      return {ok:true,status:200,data:request.parameters?.symbol?{lastPrice:'1330',openPrice:'1300',quoteVolume:'1'}:[]};
    };
    api.subscribeBinanceMarketStreams=async()=>({subscriptionId:'qa'});
    api.unsubscribeBinanceMarketStreams=async()=>{};api.onBinanceMarketEvent=()=>()=>{};
    api.manualDrawings=async p=>{qa.requests++;if(p.action==='session')return {owner:'qa-owner'};
      if(p.action==='write')for(const op of p.body.operations)qa.entries[op.id]=structuredClone(op);
      return {schemaVersion:4,version:1,marketKey:p.market||p.body?.marketKey,serverTime:Date.now(),entries:Object.values(qa.entries)}};
  }});
}
const js = async code=>{try{return await win.webContents.executeJavaScript(code,true)}catch(error){throw Error(error.message+'\n'+code.slice(0,800))}};
async function until(code,ms=20000){const start=Date.now();while(Date.now()-start<ms){if(await js(code))return;await delay(50)}throw Error('Timeout: '+code)}
async function click(selector,count=1){
  const p=await js(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility());if(!el)throw Error('Missing visible target: '+${JSON.stringify(selector)});const r=el.getBoundingClientRect();const p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};if(!el.contains(document.elementFromPoint(p.x,p.y)))throw Error('Obscured target: '+${JSON.stringify(selector)});return p})()`);
  for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...p,button:'left',clickCount:count});await delay(150);
}
async function refresh(){
  const before=await js('qa.renders');
  await js("qa.handlers.onStatus({state:'ready',command:'mock-browser',pid:1,port:5177})");
  await until(`qa.renders>${before}`,4000);
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
}
async function check(label,code){const passed=await js(code);report.checks.push({label,passed});if(!baseline)assert.equal(passed,true,label)}
(async()=>{
  setTimeout(()=>app.exit(1),120000).unref();await app.whenReady();
  win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{offscreen:true,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!(/^(about|data|blob|devtools):/.test(d.url)||d.url.startsWith(origin+'/')||d.url.startsWith(origin.replace('http:','ws:')+'/'))}));
  await win.loadURL('about:blank');win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`(${instrument.toString()})()`});
  await win.loadURL(origin+'/');await until("!!document.querySelector('.desktop-shell')");await delay(1500);
  await click('[data-action="new-chat"]');
  await until("!!document.querySelector('[data-drawing-tool=text]')");await delay(1200);
  await click('[data-drawing-action="select-group-tool"][data-drawing-tool="text"]');
  const point=await js("(()=>{const r=document.querySelector('.trading-drawing-layer').getBoundingClientRect();return {x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height*.4)}})()");
  for(const type of ['mouseMove','mouseDown','mouseUp'])win.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
  await until("!!document.querySelector('.trading-horizontal-line-inline-input')");
  await js("qa.input=document.querySelector('.trading-horizontal-line-inline-input');qa.renders=0;qa.focus=[]");
  await check('new text has keyboard focus','document.activeElement===qa.input');
  await refresh();
  await check('first full shell render retains input and focus','qa.input.isConnected && document.activeElement===qa.input');
  await refresh();
  await check('second full shell render cannot discard the blank draft','qa.input.isConnected && document.activeElement===qa.input');
  if(!baseline){
    for(let i=0;i<6;i++){await delay(2000);await refresh()}
    await check('idle draft retains focus across 12 seconds and repeated background renders','qa.renders>=8 && qa.input.isConnected && document.activeElement===qa.input && qa.input.value==="" && qa.focus.length===0');
    await win.webContents.insertText('保留选中文字');
    await delay(100);
    report.inputBeforeSelection=await js('({value:qa.input.value,start:qa.input.selectionStart,end:qa.input.selectionEnd,focus:document.hasFocus(),nativeMove:typeof document.body.moveBefore})');
    await js('qa.input.setSelectionRange(2,4,"backward")');await refresh();
    report.inputAfterSelection=await js('({value:qa.input.value,start:qa.input.selectionStart,end:qa.input.selectionEnd,direction:qa.input.selectionDirection})');
    await check('typed content and backward selection survive the full shell render','qa.input.value==="保留选中文字" && qa.input.selectionStart===2 && qa.input.selectionEnd===4 && qa.input.selectionDirection==="backward"');
    await js('qa.input.select();qa.composition=[]');
    await win.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'中文输入中',selectionStart:5,selectionEnd:5});
    for(let i=0;i<3;i++)await refresh();
    await check('native IME composition remains active through shell replacement','qa.composition.some(e=>e.type==="compositionstart") && !qa.composition.some(e=>e.type==="compositionend") && qa.input.value==="中文输入中" && document.activeElement===qa.input');
    await win.webContents.insertText('文字确认保存');
    for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Enter'});
    await until('Object.values(qa.entries).some(op=>op.drawing?.text==="文字确认保存")');
    await refresh();await refresh();
    await check('explicit Enter persists and synchronizes text through later renders','!qa.input.isConnected && document.querySelector(".trading-drawing-layer").textContent.includes("文字确认保存")');
    await click('[data-inline-annotation]',2);
    await until("!!document.querySelector('.trading-horizontal-line-inline-input')");
    await js('qa.input=document.querySelector(".trading-horizontal-line-inline-input");qa.input.select()');
    await win.webContents.insertText('修改后待确认');await refresh();await refresh();
    await check('existing text editing survives repeated full renders','qa.input.isConnected && document.activeElement===qa.input && qa.input.value==="修改后待确认"');
    for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Escape'});
    await until('!qa.input.isConnected');
    await check('explicit Escape still restores the saved text','!qa.input.isConnected && document.querySelector(".trading-drawing-layer").textContent.includes("文字确认保存")');
    await click('[data-inline-annotation]',2);await until("!!document.querySelector('.trading-horizontal-line-inline-input')");
    await js('qa.input=document.querySelector(".trading-horizontal-line-inline-input");qa.input.select()');await win.webContents.insertText('主动离开保存');
    await click('#composerInput');
    await check('an intentional outside click still commits editing','!qa.input.isConnected && document.activeElement.id==="composerInput" && document.querySelector(".trading-drawing-layer").textContent.includes("主动离开保存")');
    await check('no temporary workspace is left outside the application shell','document.querySelectorAll("[data-trading-market-workspace]").length===1 && document.querySelector("#app").contains(document.querySelector("[data-trading-market-workspace]"))');
    await click('[data-drawing-action="select-group-tool"][data-drawing-tool="trend-line"]');
    const line=await js('(()=>{const r=document.querySelector(".trading-drawing-layer").getBoundingClientRect();return {x:Math.round(r.x+r.width*.25),y:Math.round(r.y+r.height*.65)}})()');
    win.webContents.sendInputEvent({type:'mouseMove',...line});
    win.webContents.sendInputEvent({type:'mouseDown',...line,button:'left',clickCount:1});await delay(60);
    win.webContents.sendInputEvent({type:'mouseMove',x:line.x+140,y:line.y-60,button:'left'});await delay(60);
    win.webContents.sendInputEvent({type:'mouseUp',x:line.x+140,y:line.y-60,button:'left',clickCount:1});await delay(150);
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,x:line.x+140,y:line.y-60,button:'left',clickCount:1});await delay(150);
    await click('[data-drawing-selection-action="settings"]');await until('!!document.querySelector("dialog:modal")');
    await js('qa.dialog=document.querySelector("dialog:modal");qa.dialogFocus=qa.dialog.querySelector("textarea,input");qa.dialogFocus?.focus()');
    await refresh();await refresh();
    await check('drawing settings remain modal and focused during shell updates','qa.dialog.isConnected && qa.dialog.matches(":modal") && (!qa.dialogFocus || document.activeElement===qa.dialogFocus)');
    await click('dialog:modal [data-line-cancel]');
    await js('qa.workspace=document.querySelector("[data-trading-market-workspace]")');
    await click('[data-conversation-static-action="account"]');await until('!!document.querySelector(".binance-account-page")');
    await check('intentional navigation parks the chart without an orphaned body surface','!qa.workspace.isConnected && !document.querySelector("[data-trading-market-workspace]")');
    await click('[data-action="new-chat"]');await until('!!document.querySelector("[data-trading-market-workspace]")');
    await check('returning to the task restores the same chart and saved annotation','document.querySelector("[data-trading-market-workspace]")===qa.workspace && qa.workspace.textContent.includes("主动离开保存")');
  }
  report.state=await js("({renders:qa.renders,requests:qa.requests,inputConnected:qa.input.isConnected,active:document.activeElement.id||document.activeElement.className,focus:qa.focus})");
  fs.writeFileSync(path.join(out,baseline?'baseline.png':'verified.png'),(await win.webContents.capturePage()).toPNG());
  report.result=report.checks.every(x=>x.passed)?'PASS':'REPRODUCED';
  fs.writeFileSync(path.join(out,baseline?'baseline.json':'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
})().catch(async error=>{report.error=error.stack;if(win){report.state=await js("({renders:qa.renders,focus:qa.focus,active:document.activeElement.id||document.activeElement.className,body:document.body.innerText.slice(0,1200)})").catch(()=>null);fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG())}fs.writeFileSync(path.join(out,baseline?'baseline.json':'report.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report));app.exit(1)});
