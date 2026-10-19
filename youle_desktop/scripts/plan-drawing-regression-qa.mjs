// From the canonical repository root: node youle_desktop/scripts/plan-drawing-regression-qa.mjs
// Isolated offscreen Electron fixtures: production SVG/card renderers and CSS,
// no authenticated profile, account operations, or live app interaction.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import electronExecutable from 'electron';
import {spawnSync} from 'node:child_process';
import {TradingDrawingController,tradingDrawingLabelSpan} from '../src/renderer/trading-expert-drawing.ts';
import {screenshotReport} from '../test/support/plan-metrics-fixture.mjs';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from '../test/support/right-renderer-parity.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),output=path.join(root,'.cache','plan-drawing-M1-392');
fs.mkdirSync(output,{recursive:true});
const c=Object.assign(Object.create(TradingDrawingController.prototype),{userDrawingEnabled:true,labelMaskPrefix:'qa',activeTool:'cursor'});
const bounds={width:800,height:320},drawings=[];
for(const [id,tool,points] of [
  ['descending','trend-line',[{x:80,y:40},{x:720,y:280}]],
  ['ascending','trend-line',[{x:80,y:280},{x:720,y:40}]],
  ['reversed','trend-line',[{x:720,y:280},{x:80,y:40}]],
  ['horizontal','horizontal-line',[{x:200,y:160}]],
  ['vertical','vertical-line',[{x:400,y:160}]],
  ['ray','ray',[{x:80,y:40},{x:400,y:160}]],
]){
  const drawing={id,tool,symbol:'BINANCE:FUTURES:BTCUSDT',text:'',points:[]};
  const [a,b]=tradingDrawingLabelSpan(drawing,points,bounds);
  const line=`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"`;
  const body=line+' stroke="#2962ff" stroke-width="3"/>';
  const hit=line+' stroke="transparent" stroke-width="16" pointer-events="stroke"/>';
  drawings.push({id,html:c.renderDrawingFrame(drawing,points,bounds,false,true,body,hit,'')});
}
const cards=[];
for(const language of ['zh-CN','zh-TW','en'])for(const theme of ['light','dark'])for(const width of [266,410]){
  const report=screenshotReport(language==='zh-TW'?'zh-Hant':language);
  report.executionPlan.context={interval:'1h'};
  const card=cloudPlanCard(report),saved=mergeCloudExecutionPlans([report],[])[0];
  cards.push({id:`${language}-${theme}-${width}`,language,theme,width,
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,
    saved:renderCurrentSavedPlan(saved,language),sticky:executionPlanStickyHtml({cloudReport:report,title:card.title,language,theme,fontSize:12})});
}
fs.writeFileSync(path.join(output,'qa-fixtures.json'),JSON.stringify({drawings,cards}));
const drawingCss=fs.readFileSync(path.join(root,'src/renderer/trading-drawing-toolbar.css'),'utf8');
fs.writeFileSync(path.join(output,'drawing.html'),`<!doctype html><html><meta charset="utf-8"><style>${drawingCss}
body{margin:0;background:#fff;color:#131722;font:14px Arial,'Microsoft YaHei'}html[data-theme=dark] body{background:#161a21;color:#eee}svg{display:block;margin-top:32px}h2{margin:12px 24px;font-size:16px}.grid{stroke:#e6ebf2;stroke-width:1}html[data-theme=dark] .grid{stroke:#303642}</style><body><h2>画线占位文字避让</h2><svg width="800" height="320" class="trading-drawing-layer"><g class="grid">${[40,80,120,160,200,240,280].map(y=>`<line x1="0" y1="${y}" x2="800" y2="${y}"/>`).join('')}</g><g id="fixture"></g></svg></body></html>`);
const cardCss=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8')+fs.readFileSync(path.join(root,'src/main/execution-plan-card.css'),'utf8');
fs.writeFileSync(path.join(output,'cards.html'),`<!doctype html><html><meta charset="utf-8"><style>${cardCss}
body{margin:0;padding:20px;display:flex;gap:20px;overflow:auto;height:auto;background:#eee}section{flex-shrink:0}h3{font:14px Arial;margin:0 0 12px}.message-execution-plan-list{margin:0}iframe{width:100%;height:650px;border:0}</style><body></body></html>`);
const runner=String.raw`
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'qa-fixtures.json')));
app.setPath('userData',path.join(__dirname,'isolated-profile'));app.disableHardwareAcceleration();
(async()=>{
 await app.whenReady();const rows=[];
 const win=new BrowserWindow({show:false,width:840,height:420,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});
 const evaluate=fn=>win.webContents.executeJavaScript('('+fn.toString()+')()');
 const paint=()=>evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const theme of ['light','dark'])for(const drawing of fixtures.drawings){
  await win.loadFile(path.join(__dirname,'drawing.html'));
  await win.webContents.executeJavaScript('document.documentElement.dataset.theme='+JSON.stringify(theme)+';document.querySelector("#fixture").innerHTML='+JSON.stringify(drawing.html));
  for(const state of ['idle','selected','hover','focus','dragging','drawing','capture']){
   win.webContents.sendInputEvent({type:'mouseMove',x:810,y:10});
   await win.webContents.executeJavaScript('('+((state)=>{
    document.activeElement?.blur();
    const layer=document.querySelector('svg'),group=document.querySelector('[data-drawing-id]');
    layer.classList.remove('dragging-drawing','drawing-active');document.documentElement.classList.remove('trading-chart-capturing');
    group.dataset.selected=['selected','dragging','drawing','capture'].includes(state)?'true':'false';
    if(state==='focus')group.querySelector('[data-drawing-text-position="center"]').focus();
    if(state==='dragging')layer.classList.add('dragging-drawing');
    if(state==='drawing')layer.classList.add('drawing-active');
    if(state==='capture')document.documentElement.classList.add('trading-chart-capturing');
   }).toString()+')('+JSON.stringify(state)+')');
   if(state==='hover'){
    const point=await evaluate(()=>{const t=document.querySelector('[data-drawing-text-position="center"]'),matrix=t.getScreenCTM();return {x:Math.round(matrix.e),y:Math.round(matrix.f)};});
    win.webContents.sendInputEvent({type:'mouseMove',...point});
   }
   await paint();
   const result=await evaluate(()=>{
    const label=document.querySelector('[data-drawing-text-position="center"]'),mask=document.querySelector('.trading-drawing-add-text-mask');
    return {labelOpacity:getComputedStyle(label).opacity,labelVisibility:getComputedStyle(label).visibility,maskOpacity:getComputedStyle(mask).opacity};
   });
   const visible=['selected','hover','focus'].includes(state);
   assert.equal(result.maskOpacity,visible?'1':'0',JSON.stringify({theme,id:drawing.id,state,result}));
   assert.equal(result.labelOpacity,state==='capture'?'1':visible?'1':'0');
   if(state==='capture')assert.equal(result.labelVisibility,'hidden');
   rows.push({theme,drawing:drawing.id,state,...result});
   if(state==='selected')fs.writeFileSync(path.join(__dirname,'drawing-'+theme+'-'+drawing.id+'.png'),(await win.webContents.capturePage()).toPNG());
   // Inspect actual raster pixels with text hidden: the geometry must be cut
   // around its anchor while the background grid remains available.
   if(['idle','selected'].includes(state)){
    const p=await evaluate(()=>{document.querySelectorAll('[data-horizontal-line-add-text] text').forEach(t=>t.style.visibility='hidden');const m=document.querySelector('[data-drawing-text-position="center"]').getScreenCTM();return {x:m.e,y:m.f,viewportWidth:innerWidth};});
    await paint();const shot=await win.webContents.capturePage(),size=shot.getSize(),pixels=shot.toBitmap({scaleFactor:1});let blue=0;
    const scale=size.width/p.viewportWidth,px=Math.round(p.x*scale),py=Math.round(p.y*scale);
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const i=((py+dy)*size.width+px+dx)*4;if(pixels[i]>210&&pixels[i+1]>60&&pixels[i+1]<150&&pixels[i+2]<90)blue++;}
    if((blue>0)!==(state==='idle'))fs.writeFileSync(path.join(__dirname,'pixel-failure.png'),shot.toPNG({scaleFactor:1}));
    assert.equal(blue>0,state==='idle',JSON.stringify({theme,id:drawing.id,state,blue,p,size,bytes:pixels.length}));
    await evaluate(()=>document.querySelectorAll('[data-horizontal-line-add-text] text').forEach(t=>t.style.visibility=''));
   }
  }
 }
 const cardRows=[];
 for(const f of fixtures.cards){
  win.setSize(f.width*3+100,760);await win.loadFile(path.join(__dirname,'cards.html'));
  await win.webContents.executeJavaScript('('+((f)=>{
   document.documentElement.dataset.theme=f.theme;document.documentElement.lang=f.language;
   document.body.innerHTML='<section id="chat"><h3>聊天</h3>'+f.chat+'</section><section id="saved"><h3>计划</h3>'+f.saved+'</section><section id="sticky"><h3>便利贴</h3><iframe></iframe></section>';
   document.querySelectorAll('section').forEach(el=>el.style.width=f.width+'px');document.querySelector('iframe').srcdoc=f.sticky;
  }).toString()+')('+JSON.stringify(f)+')');
  await evaluate(()=>new Promise(resolve=>{const frame=document.querySelector('iframe');if(frame.contentDocument?.readyState==='complete'&&frame.contentDocument.querySelector('h2'))resolve();else frame.onload=resolve;}));
  await paint();
  const result=await evaluate(()=>['chat','saved','sticky'].map(id=>{
   const scope=id==='sticky'?document.querySelector('iframe').contentDocument:document.querySelector('#'+id);
   const heading=scope.querySelector('h2'),content=scope.querySelector('.execution-plan-card-content');
   return {surface:id,heading:heading.textContent,visible:scope.body?.innerText||scope.innerText,overflow:content.scrollWidth>content.clientWidth+1};
  }));
  for(const row of result){assert.equal(row.heading,'BTC · 1h');assert.ok(!row.visible.includes('15m'));assert.equal(row.overflow,false,JSON.stringify({id:f.id,...row}));}
  cardRows.push({id:f.id,surfaces:result.map(({visible,...row})=>row)});
  if(f.language==='zh-CN'&&f.width===410)fs.writeFileSync(path.join(__dirname,'cards-'+f.theme+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 fs.writeFileSync(path.join(__dirname,'visual-report.json'),JSON.stringify({drawingStates:rows.length,cardSurfaces:cardRows.length*3,rows,cards:cardRows},null,2));
 console.log(JSON.stringify({drawingStates:rows.length,cardSurfaces:cardRows.length*3,passed:true}));win.destroy();app.quit();
})().catch(error=>{console.error(error);app.exit(1);});
`;
fs.writeFileSync(path.join(output,'qa-runner.cjs'),runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const run=spawnSync(electronExecutable,[path.join(output,'qa-runner.cjs')],{cwd:root,env,encoding:'utf8',timeout:180000,windowsHide:true});
fs.writeFileSync(path.join(output,'visual.log'),(run.stdout||'')+(run.stderr||''));
console.log(run.stdout||'');if(run.status!==0){console.error(run.stderr||run.error);process.exit(run.status||1);}
