// Isolated offscreen UI audit. Run from the canonical Windows repository root.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {cloudReportFromResponse,cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {renderCurrentReports,renderCurrentSavedPlan} from '../test/support/right-renderer-parity.mjs';
const protectOnly=process.argv.includes('--protect-only');
const root=fileURLToPath(new URL('..',import.meta.url)),output=path.join(root,protectOnly?'.cache/price-action-left-protect-card-qa':'.cache/price-action-left-card-qa');
fs.mkdirSync(output,{recursive:true});
const source=JSON.parse(fs.readFileSync(path.join(root,protectOnly?'test/fixtures/price-action-left-protect-receipts.json':'test/fixtures/price-action-left-dual-receipts.json'),'utf8'));
const receipts=protectOnly?Object.fromEntries(Object.entries(source).map(([key,value])=>[`protect-${key}`,value])):source;
const fixtures=[];
for(const route of protectOnly?['protect']:['protect','touch'])for(const locale of ['zh-CN','zh-Hant','en'])for(const theme of ['light','dark'])for(const [width,font] of [[410,13],[300,20]])for(const state of ['ready','wait','watch']){
  const report=cloudReportFromResponse(receipts[`${route}-${state==='watch'?'watch':locale}`])[0];
  report.locale=locale;
  const language=locale==='zh-Hant'?'zh-TW':locale,oldClock=Date.now;
  Date.now=()=>report.executionPlan.createdAt+(state==='wait'?31001:1);
  try{
    if(state!=='watch')Object.assign(report.executionPlan.positionSizing.leftPolicy,{entryState:'ready',quoteAt:report.executionPlan.createdAt});
    const card=cloudPlanCard(report),chat=renderCurrentReports([report]).rendered.cards;
    let saved='',sticky='';
    if(state!=='watch'){
      const pending=structuredClone(report);pending.planRecords[0].status='pending';
      saved=renderCurrentSavedPlan(mergeCloudExecutionPlans([pending],[])[0],language);
      sticky=executionPlanStickyHtml({cloudReport:report,language,theme,fontSize:font});
    }
    fixtures.push({id:`${route}-${locale}-${theme}-${width}-${state}`,width,font,theme,state,chat,saved,sticky,
      expected:state==='watch'?['watch']:['entry','stop'],expectedText:card.content});
  }finally{Date.now=oldClock;}
}
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures));
const css=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8')+fs.readFileSync(path.join(root,'src/main/execution-plan-card.css'),'utf8');
fs.writeFileSync(path.join(output,'preview.html'),`<!doctype html><meta charset="utf-8"><style>${css}</style><style>body{display:block;height:auto;overflow:auto;margin:0;padding:12px}main{display:flex;align-items:flex-start;gap:12px}.col{flex:none}iframe{border:0;width:100%;height:2800px}.message-execution-plan-list{margin:0}</style><main><div id="chat" class="col"></div><div id="saved" class="col"></div><div class="col"><iframe></iframe></div></main>`);
const runner=String.raw`
const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path');
const output=__dirname,fixtures=JSON.parse(fs.readFileSync(path.join(output,'fixtures.json'),'utf8'));
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const win=new BrowserWindow({width:1340,height:3000,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
 await win.loadFile(path.join(output,'preview.html'));const results=[];
 for(const f of fixtures){
  await win.webContents.executeJavaScript('('+((f)=>new Promise(resolve=>{
   document.documentElement.dataset.theme=f.theme;
   document.querySelectorAll('.col').forEach(c=>c.style.width=f.width+'px');
   document.querySelector('#chat').innerHTML=f.chat;document.querySelector('#saved').innerHTML=f.saved;
   document.querySelectorAll('.execution-plan-surface').forEach(c=>c.style.setProperty('--plan-font-size',f.font+'px'));
   const frame=document.querySelector('iframe');frame.onload=()=>resolve();frame.srcdoc=f.sticky||'<body></body>';
  })).toString()+')('+JSON.stringify(f)+')');
  const result=await win.webContents.executeJavaScript('('+(()=>{
   const roots=[document.querySelector('#chat'),document.querySelector('#saved'),document.querySelector('iframe').contentDocument.body];
   return roots.filter(r=>r.querySelector('.execution-plan-surface')).map(root=>{
    const card=root.querySelector('.execution-plan-surface'),content=root.querySelector('.execution-plan-card-content'),bounds=card.getBoundingClientRect();
    const bad=[...content.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>bounds.right+1;}).map(e=>e.className);
    return {width:bounds.width,height:bounds.height,overflow:bad,scroll:content.scrollWidth,client:content.clientWidth,text:content.textContent,color:root.ownerDocument.defaultView.getComputedStyle(card).backgroundColor};
   });
  }).toString()+')()');
  const passed=result.length===(f.state==='watch'?1:3)&&result.every(r=>!r.overflow.length&&r.scroll<=r.client+1&&r.height>0);
  results.push({id:f.id,passed,result});
  if((f.id.includes('protect-zh-CN-')&&f.width===410)||(f.id.includes('touch-en-dark-')&&f.width===300)||!passed){
    await new Promise(resolve=>setTimeout(resolve,150));
    fs.writeFileSync(path.join(output,f.id+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  if(!passed)throw Error(JSON.stringify(results.at(-1)));
 }
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({passed:results.length,surfaces:results.reduce((n,r)=>n+r.result.length,0),output}));win.destroy();
})().then(()=>app.exit(0)).catch(e=>{console.error(e.stack);app.exit(1);});
`;
fs.writeFileSync(path.join(output,'runner.cjs'),runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(output,'runner.cjs')],{cwd:path.resolve(root,'..'),env,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
