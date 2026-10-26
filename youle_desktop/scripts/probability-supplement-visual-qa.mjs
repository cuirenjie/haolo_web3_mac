import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {cloudAccountPlanCardFixture} from '../test/support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports} from '../test/support/right-renderer-parity.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'.cache','probability-supplement-20261027');
fs.mkdirSync(output,{recursive:true});
const fixtures=[];
for(const locale of ['zh-CN','zh-Hant','en','ko','ja'])for(const theme of ['light','dark'])for(const width of [266,410]) {
  const report=cloudAccountPlanCardFixture(locale),s=report.planRecords[0].scenario;
  report.probabilitySupplement={schemaVersion:1,state:'pending',baseResultHash:report.resultHash};
  const pending=renderCurrentReports([report],{allowPlanAction:true}).rendered.cards;
  report.profitProbability={schemaVersion:1,kind:'model_estimate',basis:'first_target_before_stop_conditional',
    history:{candleCount:120,from:1792310400000,to:1792326740000,asOf:1792326741009,interval:'1h'},
    assessments:[{planId:report.planRecords[0].id,side:s.side,entry:s.entry,stop:s.stop,targets:s.targets,
      conditionHash:s.conditionHash,stopLossProbabilityPercent:51,profitProbabilityPercent:49,evidenceIds:['history-window'],summary:'Frozen plan assessment.'}]};
  fixtures.push({id:`${locale}-${theme}-${width}`,theme,width,pending,ready:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards});
}
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures));
const styles=['src/renderer/styles.css','src/main/execution-plan-card.css','src/renderer/plan-probability-reply.css'].map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'preview.html'),`<!doctype html><html><meta charset="UTF-8"><style>${styles}</style><style>body{margin:0;padding:24px;height:auto;background:var(--bg)}main{margin:auto}.message-execution-plan-list{margin:0}</style><main></main></html>`);
const runner=String.raw`
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const results=[];
 const win=new BrowserWindow({width:480,height:1100,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
 await win.loadFile(path.join(__dirname,'preview.html'));
 for(const f of JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json')))) {
  for(const phase of ['pending','ready']) {
   const result=await win.webContents.executeJavaScript('('+((f,phase)=>{
    document.documentElement.dataset.theme=f.theme;const main=document.querySelector('main');main.style.width=f.width+'px';main.innerHTML=f[phase];
    const element=main.querySelector(phase==='pending'?'.plan-probability-pending':'.plan-probability-reply'),footer=main.querySelector('.message-execution-plan-footer');
    const bounds=element.getBoundingClientRect(),style=getComputedStyle(element);
    const luminance=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(x=>{x=Number(x)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};
    const a=luminance(style.color),b=luminance(style.backgroundColor);
    return {below:bounds.top>=footer.getBoundingClientRect().bottom,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),
      overflow:element.scrollWidth>element.clientWidth+1,waiting:!!main.querySelector('.plan-probability-pending'),
      low:element.textContent.includes('49%'),plan:main.querySelector('.message-execution-plan-card')?.outerHTML||footer.parentElement.outerHTML};
   }).toString()+')('+JSON.stringify(f)+','+JSON.stringify(phase)+')');
   assert.ok(result.below&&!result.overflow&&result.contrast>=4.5,f.id+' '+phase+JSON.stringify(result));
   assert.equal(result.waiting,phase==='pending');assert.equal(result.low,phase==='ready');
   results.push({id:f.id,phase,...result,plan:undefined});
   if(f.id.startsWith('zh-CN')&&f.width===410)fs.writeFileSync(path.join(__dirname,f.id+'-'+phase+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,output:__dirname}));win.destroy();
})().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});`;
const target=path.join(output,'runner.cjs');fs.writeFileSync(target,runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[target],{env,cwd:path.dirname(root),windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
