// Isolated hidden Electron, production renderer and CSS, real server fixtures.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {cloudReportFromResponse} from '../src/main/cloud-plan-contract.mjs';
import {renderCurrentReports} from '../test/support/right-renderer-parity.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'output','m1-463-visual');fs.mkdirSync(output,{recursive:true});
const cases=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/preference-plan-results.json'),'utf8')).cases;
const fixtures=[];
for(const c of cases)for(const locale of ['zh-CN','zh-Hant','en','ko'])for(const theme of ['light','dark'])for(const width of [266,410]){
  const [report]=cloudReportFromResponse(c.result);report.locale=locale;
  fixtures.push({id:`${c.name.replace('.json','')}-${locale}-${theme}-${width}`,theme,width,
    html:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards});
}
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures));
const css=['src/renderer/styles.css','src/main/execution-plan-card.css','src/renderer/plan-probability-reply.css'].map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'preview.html'),`<!doctype html><meta charset="UTF-8"><style>${css}</style><style>body{margin:0;padding:24px;height:auto;background:var(--bg)}main{margin:auto}.message-execution-plan-list{margin:0}</style><main></main>`);
const runner=String.raw`
const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{await app.whenReady();const results=[];
const win=new BrowserWindow({width:500,height:1500,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
await win.loadFile(path.join(__dirname,'preview.html'));
for(const f of JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json')))){
await win.webContents.executeJavaScript('('+((f)=>{document.documentElement.dataset.theme=f.theme;const main=document.querySelector('main');main.style.width=f.width+'px';main.innerHTML=f.html;}).toString()+')('+JSON.stringify(f)+')');
const r=await win.webContents.executeJavaScript('('+(()=>{const card=document.querySelector('.message-execution-plan'),bounds=card.getBoundingClientRect();const buttons=[...card.querySelectorAll('button')];buttons[0]?.focus();const s=getComputedStyle(card);return {targets:card.querySelectorAll('.execution-plan-target').length,blocked:!!card.querySelector('[data-plan-recommendation="blocked"]'),color:s.color,background:s.backgroundColor,focus:document.activeElement===buttons[0],overflow:[...card.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>bounds.right+1).map(e=>e.className)};}).toString()+')()');
assert.equal(r.targets,3,f.id);assert.deepEqual(r.overflow,[],f.id);assert.ok(r.focus,f.id+' keyboard focus');assert.notEqual(r.color,r.background,f.id+' contrast');results.push({id:f.id,...r});
if(f.id.includes('right-long-zh-CN')&&f.width===410){await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(__dirname,f.id+'.png'),(await win.webContents.capturePage()).toPNG());}
}
fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({passed:results.length,output:__dirname}));win.destroy();})().then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1);});
`;
const file=path.join(output,'runner.cjs');fs.writeFileSync(file,runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[file],{cwd:path.dirname(root),env,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
