// Hidden Electron integration: production renderer wiring, native clicks, both
// themes, all locales, and the exact preview/export PNG. No live account writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'vite';
import ts from 'typescript';
import {cloudAccountPlanCardFixture,legacyCloudPlanCardFixture} from '../test/support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports} from '../test/support/right-renderer-parity.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)), output=path.join(root,'.cache','plan-menu-20261021');
fs.mkdirSync(output,{recursive:true});
const source=fs.readFileSync(path.join(root,'src/renderer/main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const glue=['getMessagePlanMenu','messageExecutionPlanCardKey'].map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)).join('\n');
const fixtures=[];
for(const language of ['zh-CN','zh-TW','en'])for(const theme of ['light','dark']) {
  const report=cloudAccountPlanCardFixture(language==='zh-TW'?'zh-Hant':language);
  report.planRecords[0].expiresAt=report.executionPlan.entryCondition.expiresAt=Date.now()+3600000;
  fixtures.push({language,theme,report,html:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards});
}
const legacy=legacyCloudPlanCardFixture('wyckoff');legacy.planRecords[0].expiresAt=Date.now()+3600000;
fixtures.push({language:'zh-CN',theme:'light',report:legacy,html:renderCurrentReports([legacy],{allowPlanAction:true}).rendered.cards});
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures));
fs.writeFileSync(path.join(output,'entry.ts'),`
import {createExecutionPlanMenu,createPlanDialog,planMenuText,planChartContext} from '../../src/renderer/execution-plan-menu.ts';
import {showPlanShare,planShareSnapshot,renderPlanShareImage} from '../../src/renderer/execution-plan-share.ts';
import {cloudPlanCard} from '../../src/main/cloud-plan-contract.mjs';
import * as plans from '../../src/renderer/execution-plans.ts';
import * as view from '../../src/main/execution-plan-card-view.mjs';
const root=document.querySelector('#app');
let current:any,calls:any[]=[],state:any,scoped='owner',generation=1,verifyCalls=0,invalid=false;
const link={id:'link',code:'Hao123',url:'https://haolo.com/?invite=Hao123&referral_token=public-token'};
const key=(t:string,m:string,i:number)=>[t,m,i].join('\\0');
let runtime:any;
const stubRun=(action:string)=>(...args:any[])=>{calls.push({action,args});};
const mount=(f:any)=>{
  document.querySelectorAll('dialog').forEach(d=>d.remove());
  document.documentElement.dataset.theme=f.theme; document.documentElement.lang=f.language;
  root.innerHTML=f.html; calls=[];scoped='owner';invalid=false;
  state={auth:{authenticated:true},activeView:'chat',settings:{language:f.language},executionPlans:[],currentThreadId:'mixed-thread'};
  current={title:cloudPlanCard(f.report).title,content:cloudPlanCard(f.report).content,cloudReport:f.report};
  const candidates=new Map([[key('mixed-thread','mixed-message',0),current]]);
  const deps={...plans,...view,root,state,authenticatedWorkspaceGeneration:generation,
    executionPlanCandidatesBySource:candidates,executionPlanCandidateKey:key,executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set(),
    syncExecutionPlansForCurrentAccount:()=>{},currentExecutionPlanStorageScope:()=>scoped,isThreadBusy:()=>false,
    createExecutionPlanMenu,createPlanDialog,planMenuText,planChartContext,showPlanShare,cloudPlanCard,
    addExecutionPlanFromMessageAction:async()=>{calls.push({action:'add'});state.executionPlans=[{...current,id:f.report.planRecords[0].id,status:'pending'}];},
    createExecutionPlanStickyFromMessageAction:stubRun('sticky'),initializeTradingExpertTaskThread:stubRun('initialize-chart'),
    selectThread:async(id:string)=>{state.currentThreadId=id;calls.push({action:'select-thread'});},showTradingExecutionPlanChart:stubRun('chart'),
    openExecutionPlansPage:stubRun('view'),renderExecutionPlanCardContent:(text:string)=>view.executionPlanCardBody(plans.executionPlanDisplayLines(text)),
    errorMessage:(error:any)=>String(error),showToast:stubRun('error'),
    api:{verifyPlanShareInvitation:async()=>{verifyCalls++;if(invalid)throw Error('INVITATION_UNAVAILABLE');return link;},
      copyAttachmentToClipboard:stubRun('copy'),savePlanShareImage:async()=>{calls.push({action:'save'});return {saved:true};},openExternal:async()=>{}},
  };
  runtime=Function(...Object.keys(deps),${JSON.stringify(ts.transpileModule('var messagePlanMenu;\n'+glue,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)}+';return getMessagePlanMenu();')(...Object.values(deps));
  runtime.bind(root);runtime.bind(root);
};
(window as any).qa={mount,calls:()=>calls,state:()=>state,candidate:()=>current,
  switchAccount:()=>{scoped='other';},invalidate:()=>{invalid=true;},verifyCalls:()=>verifyCalls,
  snapshot:()=>planShareSnapshot(current,state.settings.language),
  screenshot:async()=>renderPlanShareImage(planShareSnapshot(current,state.settings.language),link,state.settings.language),
};
`);
await build({configFile:false,root,logLevel:'error',build:{outDir:output,emptyOutDir:false,
  lib:{entry:path.join(output,'entry.ts'),name:'PlanMenuQa',formats:['iife'],fileName:()=> 'bundle.js'},minify:false}});
const styles=['src/renderer/styles.css','src/main/execution-plan-card.css','src/renderer/execution-plan-menu.css'].map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><style>${styles}</style><style>body{margin:0;padding:60px;height:100vh;background:var(--bg)}#app{width:348px}.message-execution-plan-list{margin:0}</style><div id="app"></div><script src="./bundle.js"></script>`);
fs.writeFileSync(path.join(output,'runner.cjs'),String.raw`
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const win=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
 const results=[],fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json')));
 const js=script=>win.webContents.executeJavaScript(script);
 const click=async selector=>{const p=await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing "+'+JSON.stringify(selector)+');const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await new Promise(r=>setTimeout(r,70));};
 const shot=async name=>fs.writeFileSync(path.join(__dirname,name+'.png'),(await win.webContents.capturePage()).toPNG());
 await win.loadFile(path.join(__dirname,'index.html'));
 for(const [i,f] of fixtures.entries()){
  await js('qa.mount('+JSON.stringify(f)+')');
  const geometry=await js('(()=>{const e=document.querySelector("[data-plan-menu-trigger]"),h=e.querySelector(".execution-plan-heading"),s=getComputedStyle(h,"::after");return {width:e.clientWidth,scroll:e.scrollWidth,arrow:s.clipPath,content:s.content,tab:e.tabIndex,role:e.getAttribute("role")}})()');
  assert.equal(geometry.tab,0);assert.equal(geometry.role,'button');assert.ok(geometry.scroll<=geometry.width+1);assert.match(geometry.arrow,/polygon/);
  await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await shot('card-'+i);await click('[data-plan-menu-trigger]');
  assert.deepEqual(await js('[...document.querySelectorAll("[data-plan-menu-action]")].map(b=>[b.dataset.planMenuAction,b.disabled])'),[['add',false],['chart',false],['sticky',false],['share',false]]);
  const theme=await js('getComputedStyle(document.querySelector("dialog")).backgroundColor');
  if(f.theme==='dark')assert.notEqual(theme,'rgb(255, 255, 255)');
  await shot('menu-'+i);await click('[data-plan-menu-action=add]');
  assert.equal((await js('qa.calls().filter(c=>c.action==="add").length')),1);
  await click('[data-plan-menu-trigger]');assert.equal(await js('document.querySelector("[data-plan-menu-action]").dataset.planMenuAction'),'view');
  await click('[data-plan-menu-action=view]');assert.ok(await js('qa.calls().some(c=>c.action==="view")'));
  await click('[data-plan-menu-trigger]');await click('[data-plan-menu-action=chart]');
  assert.deepEqual(await js('qa.calls().find(c=>c.action==="chart").args[1]'),{marketId:f.report.marketId,interval:f.report.interval});
  await click('[data-plan-menu-trigger]');await click('[data-plan-menu-action=sticky]');assert.ok(await js('qa.calls().some(c=>c.action==="sticky")'));
  const snapshot=await js('qa.snapshot()');assert.deepEqual(Object.keys(snapshot).sort(),['badges','entry','expiresAt','long','stop','targets','title','venue']);assert.match(snapshot.title,/BTC\/USDT/);assert.ok(!JSON.stringify(snapshot).includes('notional'));
  await click('[data-plan-menu-trigger]');await click('[data-plan-menu-action=share]');
  await js('new Promise((resolve,reject)=>{let n=0;const check=()=>{const i=document.querySelector(".execution-plan-share-preview");if(i&&!i.hidden&&i.complete)resolve();else if(++n>100)reject(Error("preview timeout"));else setTimeout(check,30)};check()})');
  await shot('share-'+i);
  const data=await js('document.querySelector(".execution-plan-share-preview").src');fs.writeFileSync(path.join(__dirname,'poster-'+i+'.png'),Buffer.from(data.split(',')[1],'base64'));
  const before=await js('qa.verifyCalls()');
  await click('.execution-plan-share-dialog footer button:nth-child(4)');
  assert.ok(await js('qa.calls().some(c=>c.action==="copy")'));assert.equal(await js('qa.verifyCalls()'),before+1);
  await click('.execution-plan-share-dialog footer button:nth-child(5)');assert.ok(await js('qa.calls().some(c=>c.action==="save")'));
  await js('qa.invalidate()');await click('.execution-plan-share-dialog footer button:nth-child(4)');
  assert.equal(await js('qa.calls().filter(c=>c.action==="copy").length'),1);
  assert.equal(await js('document.querySelector(".execution-plan-share-preview").hidden'),true);
  assert.equal(await js('getComputedStyle(document.querySelector(".execution-plan-share-preview")).display'),'none');
  results.push({language:f.language,theme:f.theme,legacy:i===fixtures.length-1,geometry,menuBackground:theme,actions:true,share:true});
 }
 const f=fixtures[0];
 await js('qa.mount('+JSON.stringify(f)+')');await click('[data-plan-menu-trigger]');await js('qa.switchAccount()');await click('[data-plan-menu-action=add]');assert.deepEqual(await js('qa.calls()'),[]);
 await js('qa.mount('+JSON.stringify(f)+')');await click('[data-plan-menu-trigger]');await js('qa.candidate().cloudReport.planRecords[0].expiresAt=Date.now()-1');await click('[data-plan-menu-action=add]');assert.equal(await js('qa.calls().filter(c=>c.action==="add").length'),0);assert.ok(await js('!!document.querySelector("dialog[open]")'));
 await js('qa.mount('+JSON.stringify(f)+');document.querySelector("[data-plan-menu-trigger]").focus()');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});await new Promise(r=>setTimeout(r,50));assert.ok(await js('!!document.querySelector(".execution-plan-option-menu[open]")'));
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await new Promise(r=>setTimeout(r,50));assert.ok(await js('!document.querySelector("dialog")'));
 fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify({passed:results,accountSwitch:true,deadlineCrossing:true,keyboard:true},null,2));
 win.destroy();console.log(JSON.stringify({passed:results.length,output:__dirname}));
})().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const run=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(output,'runner.cjs')],{cwd:path.resolve(root,'..'),env,windowsHide:true,stdio:'inherit'});
if(run.error)throw run.error;process.exitCode=run.status??1;
