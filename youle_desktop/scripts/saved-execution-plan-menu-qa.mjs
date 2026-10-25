// Isolated Electron QA: production saved-card renderer and menu wiring, no live account/API writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'vite';
import ts from 'typescript';
import {createSavedExecutionPlan} from '../src/renderer/execution-plans.ts';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {cloudAccountPlanCardFixture,legacyCloudPlanCardFixture} from '../test/support/cloud-plan-card-fixture.mjs';
import {renderCurrentSavedPlan} from '../test/support/right-renderer-parity.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),output=path.join(root,'.cache','saved-plan-menu-20261025');
fs.mkdirSync(output,{recursive:true});
const source=fs.readFileSync(path.join(root,'src/renderer/main.ts'),'utf8'),ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
const names=['getSavedPlanMenu','bindExecutionPlanEvents'];
const glue=ts.transpileModule('var savedPlanMenu;\n'+names.map(name=>ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const fixtures=[];
for(const language of ['zh-CN','zh-TW','en']) for(const theme of ['light','dark']) for(const status of ['pending','executing','ended']) {
  const report=cloudAccountPlanCardFixture(language==='zh-TW'?'zh-Hant':language);
  const plan=createSavedExecutionPlan({candidate:{...cloudPlanCard(report),cloudReport:report},sourceThreadId:'source-thread',sourceMessageId:'source-message'});
  plan.status=status;
  fixtures.push({language,theme,plan,html:renderCurrentSavedPlan(plan,language)});
}
const legacyReport=legacyCloudPlanCardFixture('wyckoff');
const legacy=createSavedExecutionPlan({candidate:{...cloudPlanCard(legacyReport),cloudReport:legacyReport},sourceThreadId:'legacy-thread',sourceMessageId:'legacy-message'});
delete legacy.cloudReport;
fixtures.push({language:'zh-CN',theme:'light',plan:legacy,html:renderCurrentSavedPlan(legacy)});
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures));
fs.writeFileSync(path.join(output,'entry.ts'),`
import {createSavedExecutionPlanMenu,navigateSavedPlan,savedPlanSourceThreadId} from '../../src/renderer/saved-execution-plan-menu.ts';
import {resolveSavedPlanSource} from '../../src/renderer/saved-plan-source.ts';
let state:any,calls:any[],scope:string,hidden:Set<string>,syncing:Set<string>,busy:boolean,runtime:any,root:HTMLElement,current:any;
const mount=(f:any)=>{
  document.querySelectorAll('dialog').forEach(d=>d.remove());
  document.documentElement.dataset.theme=f.theme;document.documentElement.lang=f.language;
  document.querySelector('#host')!.innerHTML='<div id="app" class="execution-plans-page"><section class="execution-plan-list">'+f.html+'</section></div>';
  root=document.querySelector('#app')!;current=f;scope='owner';calls=[];hidden=new Set();syncing=new Set();busy=false;
  state={auth:{authenticated:true},settings:{language:f.language},activeView:'plans',currentThreadId:'other',executionPlans:[structuredClone(f.plan)]};
  const record=(action:string)=>(...args:any[])=>{calls.push({action,args});};
  const deps={root,state,authenticatedWorkspaceGeneration:1,hiddenThreadIds:hidden,
    currentExecutionPlanStorageScope:()=>scope,executionPlanAlertSyncBusyIds:syncing,executionPlanDeleteBusyIds:new Set(),isThreadBusy:()=>busy,
    createSavedExecutionPlanMenu,navigateSavedPlan,savedPlanSourceThreadId,
    savedPlanSourceForNavigation:(plan:any)=>resolveSavedPlanSource(plan,id=>id,id=>hidden.has(id)),
    ensureSavedPlanSource:async(plan:any)=>resolveSavedPlanSource(plan,id=>id,id=>hidden.has(id)) || (plan.cloudReport ? 'original-cloud-task' : ''),
    updateExecutionPlanLifecycle:async(...args:any[])=>record('lifecycle')(...args),
    deleteExecutionPlan:async(id:string,valid:()=>boolean)=>{if(valid())record('delete')(id);},
    initializeTradingExpertTaskThread:record('initialize'),selectThread:async(id:string)=>{record('select')(id);state.activeView='chat';state.currentThreadId=id;},
    showTradingExecutionPlanChart:async(report:any,context:any,id:string,valid:()=>boolean)=>{if(!valid())throw Error('stale navigation');record('chart')(report,context,id);},
    showToast:record('error'),errorMessage:String,render:()=>{},
  };
  runtime=Function(...Object.keys(deps),${JSON.stringify(glue)}+';return {bind:bindExecutionPlanEvents};')(...Object.values(deps));
  runtime.bind();runtime.bind();
};
(window as any).qa={mount,calls:()=>calls,state:()=>state,switchAccount:()=>{scope='other';},
  stale:()=>{state.executionPlans[0].status='ended';},busy:()=>{busy=true;},hideSource:()=>{hidden.add(savedPlanSourceThreadId(state.executionPlans[0]));},
  sync:()=>{syncing.add(state.executionPlans[0].id);},bind:()=>runtime.bind(),
  rerender:()=>{root.querySelector('.execution-plan-list')!.innerHTML=current.html;runtime.bind();},
};
`);
await build({configFile:false,root,logLevel:'error',build:{outDir:output,emptyOutDir:false,lib:{entry:path.join(output,'entry.ts'),name:'SavedPlanQa',formats:['iife'],fileName:()=> 'bundle.js'},minify:false}});
const styles=['src/renderer/styles.css','src/main/execution-plan-card.css','src/renderer/execution-plan-menu.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><style>${styles}</style><style>body{margin:0;padding:60px;background:var(--bg)}.execution-plans-page{padding:0}#app{width:370px}.execution-plan-list{display:block}</style><div id="host"></div><script src="./bundle.js"></script>`);
fs.writeFileSync(path.join(output,'runner.cjs'),String.raw`
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const win=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}});
 const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json'))),results=[];
 const js=code=>win.webContents.executeJavaScript(code),pause=()=>new Promise(r=>setTimeout(r,60));
 const click=async selector=>{const p=await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing element");const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await pause();};
 const key=async keyCode=>{win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await pause();};
 const mount=async f=>{await js('qa.mount('+JSON.stringify(f)+')');await pause();};
 const shot=async name=>fs.writeFileSync(path.join(__dirname,name+'.png'),(await win.webContents.capturePage()).toPNG());
 const card='[data-saved-plan-menu-trigger]',action=name=>'[data-saved-plan-menu-action="'+name+'"]';
 await win.loadFile(path.join(__dirname,'index.html'));
 for(const [i,f] of fixtures.entries()){
  await mount(f);
  const geometry=await js('(()=>{const e=document.querySelector("'+card+'"),s=getComputedStyle(e);return {width:e.clientWidth,scroll:e.scrollWidth,tab:e.tabIndex,role:e.getAttribute("role"),cursor:s.cursor}})()');
  assert.equal(geometry.tab,0);assert.equal(geometry.role,'button');assert.equal(geometry.cursor,'pointer');assert.ok(geometry.scroll<=geometry.width+1);
  if(i<6)await shot('card-'+i);
  await click(card);
  assert.deepEqual(await js('[...document.querySelectorAll("[data-saved-plan-menu-action]")].map(b=>[b.dataset.savedPlanMenuAction,b.disabled])'),[f.plan.status==='ended'?'reopen':'end','chart','conversation','delete'].map(a=>[a,false]));
  assert.equal(await js('getComputedStyle(document.querySelector(".execution-plan-heading"),"::after").width'),'6px');
  assert.equal(await js('getComputedStyle(document.querySelector(".execution-plan-heading"),"::after").height'),'10px');
  assert.equal(await js('getComputedStyle(document.querySelector("[data-saved-plan-menu-action=delete]")).color'),await js('getComputedStyle(document.querySelector("[data-saved-plan-menu-action=conversation]")).color'));
  const menuGeometry=await js('(()=>{const e=document.querySelector("dialog");return {width:e.clientWidth,scroll:e.scrollWidth,color:getComputedStyle(e).backgroundColor}})()');
  assert.ok(menuGeometry.scroll<=menuGeometry.width+1);if(f.theme==='dark')assert.notEqual(menuGeometry.color,'rgb(255, 255, 255)');
  if(f.plan.status==='pending')await shot('menu-'+i);
  if(f.plan.status==='ended'){
   await click(action('reopen'));assert.deepEqual(await js('qa.calls()'),[{action:'lifecycle',args:[f.plan.id,'pending']}]);
  }else{
   for(const reason of ['take_profit','stop_loss','cancelled','expired']){
    await click(action('end'));
    assert.deepEqual(await js('[...document.querySelectorAll("[data-saved-plan-menu-action]")].map(b=>b.dataset.savedPlanMenuAction)'),['take_profit','stop_loss','cancelled','expired','back']);
    if(reason==='take_profit'&&f.plan.status==='pending')await shot('end-'+i);
    await click(action(reason));
    assert.deepEqual(await js('qa.calls().at(-1)'),{action:'lifecycle',args:[f.plan.id,'ended',reason]});
    if(reason!=='expired')await click(card);
   }
  }
  await click(card);await click(action('delete'));assert.deepEqual(await js('qa.calls().at(-1)'),{action:'delete',args:[f.plan.id]});
  await click(card);await click(action('conversation'));assert.deepEqual(await js('qa.calls().at(-1)'),{action:'select',args:[f.plan.sourceThreadId]});
  assert.equal(await js('qa.calls().some(c=>c.action==="initialize")'),false);
  await mount(f);await click(card);await click(action('chart'));
  const calls=await js('qa.calls()');assert.deepEqual(calls.map(c=>c.action),['initialize','select','chart']);
  assert.equal(calls[1].args[0],f.plan.sourceThreadId);assert.deepEqual(calls[2].args[1],{marketId:'BINANCE:FUTURES:BTCUSDT',interval:f.plan.cloudReport?'60':'1h'});
  results.push({language:f.language,theme:f.theme,status:f.plan.status,legacy:!f.plan.cloudReport,geometry,menuGeometry,actions:true});
 }
 const f=fixtures[0];
 await mount(f);await js('qa.rerender();qa.rerender()');await click(card);await click(action('delete'));assert.equal(await js('qa.calls().length'),1);
 await mount(f);await click(card);await js('qa.switchAccount()');await click(action('delete'));assert.deepEqual(await js('qa.calls()'),[]);
 await mount(f);await click(card);await click(action('end'));await js('qa.stale()');await click(action('stop_loss'));assert.deepEqual(await js('qa.calls()'),[]);
 await mount(f);await click(card);await js('qa.stale();qa.bind()');assert.equal(await js('!!document.querySelector("dialog[open]")'),false);
 await mount(f);await js('qa.hideSource()');await click(card);assert.deepEqual(await js('[...document.querySelectorAll("[data-saved-plan-menu-action]")].map(b=>b.disabled)'),[false,false,false,false]);await click(action('chart'));assert.equal(await js('qa.calls().find(c=>c.action==="select").args[0]'),'original-cloud-task');
 await mount(fixtures.at(-1));await js('qa.hideSource()');await click(card);assert.deepEqual(await js('[...document.querySelectorAll("[data-saved-plan-menu-action]")].map(b=>b.disabled)'),[false,true,true,false]);await key('Escape');
 await mount(f);await js('qa.busy()');await click(card);assert.deepEqual(await js('[...document.querySelectorAll("[data-saved-plan-menu-action]")].map(b=>b.disabled)'),[false,true,false,false]);await key('Escape');
 await mount(f);await js('qa.sync()');await click(card);assert.equal(await js('!!document.querySelector("dialog[open]")'),false);
 await mount(f);await js('document.querySelector("'+card+'").focus()');await key('Return');assert.ok(await js('!!document.querySelector("dialog[open]")'));
 await key('Down');assert.equal(await js('document.activeElement.dataset.savedPlanMenuAction'),'chart');await key('End');assert.equal(await js('document.activeElement.dataset.savedPlanMenuAction'),'delete');
 await key('Escape');assert.equal(await js('!!document.querySelector("dialog[open]")'),false);assert.equal(await js('document.activeElement.dataset.savedPlanMenuTrigger'),'true');
 await key('Space');assert.ok(await js('!!document.querySelector("dialog[open]")'));await click(action('end'));await click(action('back'));assert.ok(await js('!!document.querySelector("[data-saved-plan-menu-action=chart]")'));await key('Escape');
 await click(card);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:10,y:10});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:10,y:10});await pause();assert.equal(await js('!!document.querySelector("dialog[open]")'),false);
 fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify({passed:results,accountSwitch:true,staleMenu:true,rerender:true,keyboard:true,unavailableSource:true,busy:true},null,2));
 win.destroy();console.log(JSON.stringify({passed:results.length,output:__dirname}));
})().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[path.join(output,'runner.cjs')],{cwd:path.resolve(root,'..'),env,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
