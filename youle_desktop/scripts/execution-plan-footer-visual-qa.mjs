// Isolated, hidden Electron fixtures using production card markup and sizing.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import electronExecutable from 'electron';
import {spawnSync} from 'node:child_process';
import {cloudAccountPlanCardFixture} from '../test/support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from '../test/support/right-renderer-parity.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {executionPlanStickyHtml,executionPlanStickyBounds,EXECUTION_PLAN_STICKY_HEIGHT_SCRIPT,EXECUTION_PLAN_STICKY_WIDTH_SCRIPT} from '../src/main/execution-plan-sticky-view.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'.cache',process.env.HAOLO_PLAN_FOOTER_QA_OUTPUT||'execution-plan-footer-M1-391');
fs.mkdirSync(output,{recursive:true});
const fixtures=[];
for(const language of ['zh-CN','zh-TW','en'])for(const theme of ['light','dark'])for(const fontSize of [11,12,13,14,16,18,20]){
  const report=cloudAccountPlanCardFixture(language==='zh-TW'?'zh-Hant':language);
  const plan=report.executionPlan,scenario=plan.scenarios[0];
  report.interval='15';plan.entryCondition.interval='15m';
  Object.assign(scenario,{entry:80681.26,stop:80472.52,targets:[82268.7,82454.1,82559.15],riskReward:[.49,.64,.73]});
  Object.assign(plan.entryCondition.trigger,{lower:scenario.entry});
  Object.assign(plan.entryCondition.invalidation,{lower:scenario.stop});
  plan.entryCondition.expiresAt=Date.parse('2026-10-20T05:13:00Z');
  scenario.entryCondition=structuredClone(plan.entryCondition);
  scenario.positionSizing.netRiskReward=[.49,.64,.73];
  Object.assign(scenario.positionSizing.accountPlan,{notional:5.82,quantity:5.82/scenario.entry,entryPrice:scenario.entry,estimatedStopLoss:.09});
  plan.positionSizing=structuredClone(scenario.positionSizing);
  Object.assign(report.planRecords[0],{scenario:structuredClone(scenario),expiresAt:plan.entryCondition.expiresAt,createdAt:'2026-10-19T17:20:00Z',saved:true,linkedAlertId:'fixture-alert'});
  const payload={cloudReport:report,language,theme,fontSize};
  fixtures.push({id:`${language}-${theme}-${fontSize}`,language,theme,fontSize,html:executionPlanStickyHtml(payload),bounds:executionPlanStickyBounds(payload),
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,saved:renderCurrentSavedPlan(mergeCloudExecutionPlans([report],[])[0],language)});
}
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures));
fs.writeFileSync(path.join(output,'measurement.json'),JSON.stringify({width:EXECUTION_PLAN_STICKY_WIDTH_SCRIPT,height:EXECUTION_PLAN_STICKY_HEIGHT_SCRIPT}));
const styles=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8')+fs.readFileSync(path.join(root,'src/main/execution-plan-card.css'),'utf8');
fs.writeFileSync(path.join(output,'preview.html'),`<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style><style>body{display:flex;gap:24px;margin:0;padding:24px;overflow:auto;height:auto;background:#eee}section{width:328px;flex-shrink:0}h3{font-size:14px}.message-execution-plan-list{margin:0}</style></head><body></body></html>`);
const runner=String.raw`
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json')));
const scripts=JSON.parse(fs.readFileSync(path.join(__dirname,'measurement.json')));
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const results=[];
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
 for(const f of fixtures){
  win.setSize(f.bounds.width,f.bounds.height);
  await win.loadURL('data:text/html;base64,'+Buffer.from(f.html).toString('base64'));
  const width=Math.max(240,Math.min(520,await win.webContents.executeJavaScript(scripts.width)));
  win.setSize(width,f.bounds.height);
  const height=Math.max(180,Math.min(720,await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve('+scripts.height+'))))')));
  win.setSize(width,height);
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const result=await win.webContents.executeJavaScript('('+(()=>{
   const card=document.querySelector('.card'),content=document.querySelector('.content'),expiry=document.querySelector('.execution-plan-expiry'),controls=document.querySelector('.controls');
   const c=card.getBoundingClientRect(),t=controls.getBoundingClientRect();
   const sameTypography=[...controls.children].every(action=>['fontSize','lineHeight'].every(property=>getComputedStyle(action)[property]===getComputedStyle(controls.firstElementChild)[property]));
   return {width:innerWidth,height:innerHeight,ratio:c.width/c.height,contentFits:content.scrollHeight<=content.clientHeight+1&&content.scrollWidth<=content.clientWidth+1,
    dimensions:{scrollHeight:content.scrollHeight,clientHeight:content.clientHeight,scrollWidth:content.scrollWidth,clientWidth:content.clientWidth},sameTypography,noExpiry:!expiry,bottom:c.bottom-t.bottom,
    targets:document.querySelectorAll('.execution-plan-target').length};
  }).toString()+')()');
  results.push({id:f.id,...result});
  fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(results,null,2));
  if (!result.contentFits) fs.writeFileSync(path.join(__dirname,'failure-'+f.id+'.png'),(await win.webContents.capturePage()).toPNG());
  assert.ok(result.contentFits&&result.sameTypography&&result.noExpiry&&result.targets===3&&result.bottom>=16&&result.bottom<19,f.id+JSON.stringify(result));
  if(f.fontSize===12){
   assert.ok(Math.abs(result.ratio-.85)<.03&&result.width===316,f.id+' default aspect '+result.ratio);
   fs.writeFileSync(path.join(__dirname,'sticky-'+f.id+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 for(const f of fixtures.filter(f=>f.fontSize===12)){
  win.setSize(740,620);await win.loadFile(path.join(__dirname,'preview.html'));
  await win.webContents.executeJavaScript('('+((f)=>{document.documentElement.lang=f.language;document.documentElement.dataset.theme=f.theme;document.body.innerHTML='<section><h3>聊天</h3>'+f.chat+'</section><section><h3>计划</h3>'+f.saved+'</section>';const added=document.querySelector('.message-add-to-plan');added.disabled=true;added.textContent='已添加到计划';}).toString()+')('+JSON.stringify(f)+')');
  await new Promise(resolve=>setTimeout(resolve,150));
  const footerCheck=await win.webContents.executeJavaScript('('+(()=>{
   const added=document.querySelector('.message-add-to-plan'),style=getComputedStyle(added);
   const buttons=[...document.querySelectorAll('.message-execution-plan-controls button')];
   const expiry=document.querySelector('.execution-plan-card .execution-plan-expiry'),created=document.querySelector('.execution-plan-created-at');
   return {sameGray:style.opacity==='1'&&buttons.every(button=>getComputedStyle(button).color===style.color),
    aligned:buttons.every(button=>['fontSize','lineHeight','fontFamily','height'].every(key=>getComputedStyle(button)[key]===style[key])&&Math.abs(button.getBoundingClientRect().top-added.getBoundingClientRect().top)<1),
    time:created.textContent,noExpiry:!expiry};
  }).toString()+')()');
  assert.ok(footerCheck.sameGray&&footerCheck.aligned&&footerCheck.noExpiry&&/^\d{2}\/\d{2} \d{2}:\d{2}$/.test(footerCheck.time),f.id+JSON.stringify(footerCheck));
  fs.writeFileSync(path.join(__dirname,'cards-'+f.id+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 win.destroy();console.log(JSON.stringify({passed:results.length,output:__dirname}));
})().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
`;
const runnerPath=path.join(output,'runner.cjs');fs.writeFileSync(runnerPath,runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(electronExecutable,[runnerPath],{cwd:path.resolve(root,'..'),env,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
