// Hidden, isolated Electron rendering of production card/reply HTML and styles.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {cloudAccountPlanCardFixture} from '../test/support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports} from '../test/support/right-renderer-parity.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'.cache','plan-probability-20261025');
fs.mkdirSync(output,{recursive:true});
const fixtures=[];
for(const locale of ['zh-CN','zh-Hant','en','ko'])for(const theme of ['light','dark'])for(const width of [266,410]) {
  const report=cloudAccountPlanCardFixture(locale),scenario=report.planRecords[0].scenario;
  const summary={
    'zh-CN':'近期已收盘结构支持当前条件方向，但价格仍可能反向穿越止损位。',
    'zh-Hant':'近期已收盤結構支持目前條件方向，但價格仍可能反向穿越止損位。',
    en:'Recent closed-candle structure supports this conditional direction, but a reversal through the stop remains possible.',
    ko:'최근 마감된 캔들 구조는 이 방향을 지지하지만, 가격이 반전해 손절 수준에 도달할 위험이 있습니다.',
  }[locale];
  report.profitProbability={schemaVersion:1,kind:'model_estimate',basis:'first_target_before_stop_conditional',
    history:{candleCount:120,from:1792310400000,to:1792326740000,asOf:1792326741009,interval:'1h'},
    assessments:[{planId:report.planRecords[0].id,side:scenario.side,entry:scenario.entry,stop:scenario.stop,targets:scenario.targets,
      conditionHash:scenario.conditionHash,stopLossProbabilityPercent:37.25,profitProbabilityPercent:62.75,evidenceIds:['history-window'],summary}]};
  fixtures.push({id:`${locale}-${theme}-${width}`,theme,width,html:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards});
}
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(fixtures));
const styles=['src/renderer/styles.css','src/main/execution-plan-card.css','src/renderer/plan-probability-reply.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'preview.html'),`<!doctype html><html><meta charset="UTF-8"><style>${styles}</style>
<style>:root{--font-wechat:"Segoe UI","Microsoft YaHei",sans-serif}body{margin:0;padding:24px;height:auto;background:var(--bg)}main{width:410px;margin:auto}.message-execution-plan-list{margin:0}</style><main></main></html>`);
const runner=String.raw`
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const results=[];
 const win=new BrowserWindow({width:480,height:1100,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
 await win.loadFile(path.join(__dirname,'preview.html'));
 for(const f of JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json')))) {
  await win.webContents.executeJavaScript('('+((f)=>{
   document.documentElement.dataset.theme=f.theme;
   document.querySelector('main').style.width=f.width+'px';document.querySelector('main').innerHTML=f.html;
  }).toString()+')('+JSON.stringify(f)+')');
  for(const open of [false,true]) {
   const result=await win.webContents.executeJavaScript('('+((open)=>{
    document.querySelector('details').open=open;
    const reply=document.querySelector('.plan-probability-reply'),footer=document.querySelector('.message-execution-plan-footer');
    const bounds=reply.getBoundingClientRect(),style=getComputedStyle(reply),summary=reply.querySelector('summary');
    summary.focus();
    return {replyBelowFooter:bounds.top>=footer.getBoundingClientRect().bottom,
      formulaRemoved:!reply.querySelector('.plan-probability-formula')&&!reply.textContent.includes('100% −'),
      overflow:[...reply.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().right>bounds.right+1).map(e=>e.className),
      readable:style.color!==style.backgroundColor&&style.backgroundColor!=='rgba(0, 0, 0, 0)',
      color:style.color,background:style.backgroundColor,focus:document.activeElement===summary,open:reply.querySelector('details').open};
   }).toString()+')('+open+')');
   results.push({id:f.id,open,...result});
   assert.ok(result.replyBelowFooter,f.id+' reply must follow plan controls');assert.ok(result.formulaRemoved,f.id+' formula remains');assert.deepEqual(result.overflow,[],f.id+' overflow');
   assert.ok(result.readable&&result.focus&&result.open===open,f.id+' theme/details/focus');
  }
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  if(f.id.startsWith('zh-CN')&&f.width===410)fs.writeFileSync(path.join(__dirname,f.id+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({passed:results.length,output:__dirname}));win.destroy();
})().then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
`;
const target=path.join(output,'runner.cjs');fs.writeFileSync(target,runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(path.join(root,'node_modules/electron/dist/electron.exe'),[target],{cwd:path.dirname(root),env,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
