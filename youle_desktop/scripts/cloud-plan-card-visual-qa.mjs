// Run from the fixed repository root: node youle_desktop/scripts/cloud-plan-card-visual-qa.mjs
// Isolated UI fixtures use production renderers/CSS; no account or network calls.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import electronExecutable from 'electron';
import {spawnSync} from 'node:child_process';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {executionPlanDisplayLines} from '../src/renderer/execution-plans.ts';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {cloudPlanCardFixture,legacyCloudPlanCardFixture,cloudAccountPlanCardFixture} from '../test/support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from '../test/support/right-renderer-parity.mjs';
import {screenshotReport,screenshotMetrics} from '../test/support/plan-metrics-fixture.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(root,'.cache',process.env.HAOLO_PLAN_CARD_QA_OUTPUT||'cloud-plan-card-qa');
fs.mkdirSync(output,{recursive:true});
const fixtures=[];
for(const strategy of OFFICIAL_TRADING_CATALOG)for(const locale of ['zh-CN','zh-Hant','en'])for(const policy of ['entry-v2','right-legacy-v1'])for(const theme of ['light','dark'])for(const [width,fontSize] of [[410,12],[300,20]]){
  const report=policy==='entry-v2'?cloudPlanCardFixture(locale):legacyCloudPlanCardFixture(strategy.id,locale);
  report.strategyId=strategy.id;
  if(width===300&&policy==='entry-v2')Object.assign(report.executionPlan.entryCondition,{confirmation:'breakout_retest',breakoutConfirmation:'bar_close',
    trigger:{operator:'in_zone',lower:82292.3,upper:82320.51},retest:{operator:'in_zone',lower:82123.12345,upper:82234.23456},confirmedBreakout:true,liveEvidenceGate:true});
  const language=locale==='zh-Hant'?'zh-TW':locale,card=cloudPlanCard(report),saved=mergeCloudExecutionPlans([report],[])[0];
  fixtures.push({id:`${strategy.id}-${locale}-${policy}-${theme}-${width}`,width,fontSize,theme,
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,saved:renderCurrentSavedPlan(saved,language),
    sticky:executionPlanStickyHtml({cloudReport:report,title:card.title,lines:executionPlanDisplayLines(card.content),language,theme,fontSize})});
}
// Account figures add another shared row. Exercise the real structured path
// with large amounts and cumulative loss/profit in the same responsive matrix.
for(const locale of ['zh-CN','zh-Hant','en'])for(const theme of ['light','dark'])for(const [width,fontSize] of [[410,12],[300,20]]){
  const report=cloudPlanCardFixture(locale),scenario=report.executionPlan.scenarios[0];
  Object.assign(scenario,{entry:82292.3,eligible:true,riskReward:[1.25,2.5],positionSizing:{side:'long',entry:82292.3,stop:scenario.stop,targets:[...scenario.targets],accountStatus:'available',
    accountPlan:{mode:'manage_existing',notional:123456.78,estimatedStopLoss:1234.56,targetOrders:[
      {targetIndex:0,price:scenario.targets[0],notional:61728.39,estimatedNetProfit:-123.45},
      {targetIndex:1,price:scenario.targets[1],notional:61728.39,estimatedNetProfit:2468.9}]}}});
  const language=locale==='zh-Hant'?'zh-TW':locale,card=cloudPlanCard(report),saved=mergeCloudExecutionPlans([report],[])[0];
  fixtures.push({id:`account-${locale}-entry-v2-${theme}-${width}`,width,fontSize,theme,
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,saved:renderCurrentSavedPlan(saved,language),
    sticky:executionPlanStickyHtml({cloudReport:report,title:card.title,language,theme,fontSize})});
}
// Compact V2 sizing comes from the actual server producer. Cover each direction
// and the saved executing state (whose entry deadline is intentionally hidden).
for(const locale of ['zh-CN','zh-Hant','en'])for(const theme of ['light','dark'])for(const [width,fontSize] of [[410,12],[300,20],[266,12]])for(const direction of ['long','short'])for(const status of ['pending','executing']){
  const report=cloudAccountPlanCardFixture(locale,direction),language=locale==='zh-Hant'?'zh-TW':locale;
  const saved=mergeCloudExecutionPlans([report],[])[0];saved.status=status;
  fixtures.push({id:`account-v2-${locale}-${direction}-${status}-${theme}-${width}`,width,fontSize,theme,status,
    expected:['146.61','73.30','73.31','-1.38','+0.67','+1.61',locale==='en'?'Target position':locale==='zh-Hant'?'止盈倉位':'止盈仓位'],
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,saved:renderCurrentSavedPlan(saved,language),
    sticky:executionPlanStickyHtml({cloudReport:report,language,theme,fontSize})});
}
// Recreate the user's latest circled values at the screenshot's approximate
// CSS width (Windows 150% scale), using the shared production card renderers.
for(const theme of ['light','dark']){
  const report=cloudAccountPlanCardFixture(),plan=report.executionPlan,scenario=plan.scenarios[0];
  scenario.stop=80727.49;scenario.targets=[83809.91,85327.61];
  plan.entryCondition.invalidation.lower=scenario.stop;
  scenario.entryCondition=structuredClone(plan.entryCondition);
  const sizing=scenario.positionSizing,account=sizing.accountPlan;
  account.quantity=.00079795;account.notional=account.quantity*scenario.entry;
  const unitLoss=scenario.entry-scenario.stop+scenario.entry*sizing.estimatedRoundTripCostRate;
  account.estimatedStopLoss=account.quantity*unitLoss;
  sizing.netRiskReward=scenario.targets.map(target=>(target-scenario.entry-scenario.entry*sizing.estimatedRoundTripCostRate)/unitLoss);
  scenario.riskReward=[...sizing.netRiskReward];plan.positionSizing=structuredClone(sizing);
  report.planRecords[0].scenario=structuredClone(scenario);
  const saved=mergeCloudExecutionPlans([report],[])[0];
  fixtures.push({id:`account-screenshot-original-copy-${theme}`,width:266,fontSize:12,theme,
    expected:['建议开仓 65.66','止盈仓位 32.83','预计止损 -1.38','盈亏比 1:0.78','预计盈利 +0.54','盈亏比 1:1.66','预计盈利 +1.69'],
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,saved:renderCurrentSavedPlan(saved),
    sticky:executionPlanStickyHtml({cloudReport:report,language:'zh-CN',theme,fontSize:12})});
}
// The three-exit screenshot regression uses the same frozen calculation basis
// in each language, side, theme and surface, including the narrow sticky card.
for(const locale of ['zh-CN','zh-Hant','en'])for(const theme of ['light','dark'])for(const direction of ['long','short'])for(const [width,fontSize] of [[410,12],[300,20],[266,12]]){
  const report=screenshotReport(locale,direction),language=locale==='zh-Hant'?'zh-TW':locale;
  const saved=mergeCloudExecutionPlans([report],[])[0];
  fixtures.push({id:`account-metrics-screenshot-${locale}-${direction}-${theme}-${width}`,width,fontSize,theme,targetCount:3,
    expected:['80681.26','4.96','1.63','1.70','-0.09','1:1.00','1:1.13','1:1.21','+0.03','+0.06','+0.10'],
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,saved:renderCurrentSavedPlan(saved,language),
    sticky:executionPlanStickyHtml({cloudReport:report,language,theme,fontSize})});
}
for(const locale of ['zh-CN','zh-Hant','en'])for(const theme of ['light','dark']){
  const report=screenshotReport(locale,'long',1,screenshotMetrics),language=locale==='zh-Hant'?'zh-TW':locale;
  const saved=mergeCloudExecutionPlans([report],[])[0];
  fixtures.push({id:`account-metrics-history-${locale}-${theme}`,width:266,fontSize:12,theme,targetCount:3,
    expected:[locale==='en'?'previous entry basis':locale==='zh-Hant'?'舊入場口徑':'旧入场口径'],
    chat:renderCurrentReports([report],{allowPlanAction:true}).rendered.cards,saved:renderCurrentSavedPlan(saved,language),
    sticky:executionPlanStickyHtml({cloudReport:report,language,theme,fontSize:12})});
}
const selected=process.env.HAOLO_PLAN_CARD_QA_FILTER?fixtures.filter(f=>f.id.includes(process.env.HAOLO_PLAN_CARD_QA_FILTER)):fixtures;
if(!selected.length)throw new Error('No matching UI fixtures');
fs.writeFileSync(path.join(output,'fixtures.json'),JSON.stringify(selected));
const styles=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8')+fs.readFileSync(path.join(root,'src/main/execution-plan-card.css'),'utf8');
fs.writeFileSync(path.join(output,'preview.html'),`<!doctype html><html><head><meta charset="UTF-8"><style>${styles}</style>
<style>body{display:block;margin:0;padding:16px;height:auto;overflow:auto;background:var(--plan-bg,#eee);font-family:'Segoe UI','Microsoft YaHei UI',sans-serif}main{display:flex;gap:16px;align-items:flex-start}.column{flex:none}h3{font:14px sans-serif;margin:0 0 12px;color:#888}iframe{border:0;height:1200px;width:100%}.message-execution-plan-list{margin:0}.execution-plan-card{margin:0}</style></head>
<body><main><section class="column" id="chat"><h3>聊天</h3><div></div></section><section class="column" id="saved"><h3>计划列表</h3><div></div></section><section class="column" id="sticky"><h3>便利贴</h3><iframe></iframe></section></main></body></html>`);
// Electron does not need to import TypeScript: it measures the generated HTML.
const runner=String.raw`
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const output=__dirname,fixtures=JSON.parse(fs.readFileSync(path.join(output,'fixtures.json'),'utf8'));
app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-timer-throttling');
(async()=>{
 await app.whenReady();
 const win=new BrowserWindow({width:1340,height:1400,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:true}});
 await win.loadFile(path.join(output,'preview.html'));
 const results=[];
 for(const f of fixtures){
  await win.webContents.executeJavaScript('('+((f)=>new Promise(resolve=>{
   document.documentElement.dataset.theme=f.theme;
   document.documentElement.lang=f.id.includes('-en-')?'en':f.id.includes('zh-Hant')?'zh-TW':'zh-CN';
   for(const col of document.querySelectorAll('.column'))col.style.width=f.width+'px';
   document.querySelector('#chat>div').innerHTML=f.chat;
   for(const button of document.querySelectorAll('#chat .message-add-to-plan')){button.disabled=true;button.textContent='已添加到计划';}
   document.querySelector('#saved>div').innerHTML=f.saved;
   for(const card of document.querySelectorAll('.execution-plan-surface'))card.style.setProperty('--plan-font-size',f.fontSize+'px');
   const frame=document.querySelector('iframe');frame.onload=()=>resolve();frame.srcdoc=f.sticky;
  })).toString()+')('+JSON.stringify(f)+')');
  const result=await win.webContents.executeJavaScript('('+((expected)=>{
   const frame=document.querySelector('iframe');
   const docs=[{name:'chat',root:document.querySelector('#chat')},{name:'saved',root:document.querySelector('#saved')},{name:'sticky',root:frame.contentDocument.body}];
   return docs.map(({name,root})=>{
    const card=root.querySelector('.execution-plan-surface'),content=root.querySelector('.execution-plan-card-content');
    const metrics=[...root.querySelectorAll('.execution-plan-metric')].map(e=>e.getBoundingClientRect());
    const heading=root.querySelector('.execution-plan-heading').getBoundingClientRect();
    const expiry=root.querySelector('.execution-plan-expiry');
    const targetBounds=root.querySelector('.execution-plan-targets').getBoundingClientRect();
    const toolbar=root.querySelector('.message-execution-plan-controls')?.getBoundingClientRect(),panel=content.getBoundingClientRect();
    const expiryStyle=expiry?root.ownerDocument.defaultView.getComputedStyle(expiry):null;
    const footer=root.querySelector('.execution-plan-inline-footer');
    const trailing=footer?.querySelector('.controls,.execution-plan-created-at');
    const footerTypographyMatches=!expiry||[...footer?.querySelectorAll('.sticky-action,.execution-plan-created-at')||[]].every(e=>{
     const style=e.ownerDocument.defaultView.getComputedStyle(e);
     return style.fontSize===expiryStyle.fontSize&&style.lineHeight===expiryStyle.lineHeight;
    });
    const createdTime=root.querySelector('.execution-plan-created-at');
    const shortCreatedTime=!createdTime||/^\d{2}\/\d{2} \d{2}:\d{2}$/.test(createdTime.textContent);
    const footerAligned=!expiry||!trailing||(Math.abs(expiry.getBoundingClientRect().top+expiry.getBoundingClientRect().height/2-trailing.getBoundingClientRect().top-trailing.getBoundingClientRect().height/2)<1
      && expiry.getBoundingClientRect().right+6<=trailing.getBoundingClientRect().left);
    const expirySingleLine=!expiry||(expiry.getBoundingClientRect().height<=parseFloat(expiryStyle.lineHeight)+1&&expiry.scrollWidth<=expiry.clientWidth+1);
    const bounds=card.getBoundingClientRect();
    const expectAction=name==='chat'&&Boolean(content.querySelector('[data-conditional-plan]'));
    const actionRows=[...content.querySelectorAll('.execution-plan-card-line')].filter(e=>/^(?:当前动作：|當前動作：|Current action:)/.test(e.textContent));
    const actionBounds=actionRows[0]?.getBoundingClientRect();
    const rightItems=[root.querySelectorAll('.execution-plan-metric')[1],...root.querySelectorAll('.execution-plan-ratio,.execution-plan-target-profit')];
    const rightColumnAligned=rightItems.every(e=>Math.abs(e.getBoundingClientRect().left-metrics[1].left)<1);
    const rightText=[];
    for(const item of rightItems){
     const walker=item.ownerDocument.createTreeWalker(item,4);
     for(let node;node=walker.nextNode();){
      if(!node.textContent.trim())continue;
      const range=item.ownerDocument.createRange();range.selectNodeContents(node);
      rightText.push(...[...range.getClientRects()].map(r=>r.right));
     }
    }
    const leftInset=metrics[0].left-bounds.left,rightInset=bounds.right-Math.max(...rightText);
    const overflow=[...root.querySelectorAll('.execution-plan-price,.execution-plan-target-main,.execution-plan-card-value,.execution-plan-badges,.execution-plan-expiry,.execution-plan-ratio')].filter(e=>{
     const r=e.getBoundingClientRect();return r.right>bounds.right+1||r.left<bounds.left-1;
    }).map(e=>({class:e.className,text:e.textContent}));
    return {name,width:bounds.width,scrollWidth:content.scrollWidth,clientWidth:content.clientWidth,overflow,footerAligned,footerTypographyMatches,shortCreatedTime,expirySingleLine,expiryZone:!expiry||/\(UTC[+-]\d+(?::\d{2})?\)$/.test(expiry.textContent),expiryWithoutYear:!expiry||!/>?\b\d{4}-/.test(expiry.textContent),rightColumnAligned,leftInset,rightInset,
     expiryBelowTargets:!expiry||expiry.getBoundingClientRect().top>=targetBounds.bottom,
     controlsOutsideRight:!toolbar||((Math.abs(toolbar.top-panel.bottom-4)<1&&toolbar.right<=panel.right&&panel.right-toolbar.right<=13)
       && [...root.querySelectorAll('.message-add-to-plan')].every(button=>{
        const bounds=button.getBoundingClientRect(),style=getComputedStyle(button);
        const addedOpacity=getComputedStyle(button).opacity,addedColor=getComputedStyle(button).color;
        return Math.abs(bounds.top+bounds.height/2-toolbar.top-toolbar.height/2)<1
         && Math.abs(bounds.left-panel.left-12)<1&&Math.abs(bounds.top-panel.bottom-4)<1
         && [...root.querySelectorAll('.message-execution-plan-controls button')].every(other=>{
          const otherStyle=getComputedStyle(other);
          return ['fontFamily','fontSize','lineHeight','fontWeight','letterSpacing','color'].every(property=>style[property]===otherStyle[property])
           && addedOpacity==='1'&&addedColor===otherStyle.color;
         })
         && style.borderTopWidth==='0px'&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&style.boxShadow==='none'
         && getComputedStyle(button,'::before').width==='10px';
       })),
     actionPlacement:expectAction ? actionRows.length===1&&/等待条件触发|等待條件觸發|Wait for the trigger/.test(actionRows[0].textContent)
       &&actionBounds.top>=targetBounds.bottom&&Math.abs(actionBounds.left-metrics[0].left)<1&&actionBounds.bottom<=panel.bottom-12
       : !/等待条件触发|等待條件觸發|Wait for the trigger/.test(content.textContent),
     accountVisible:expected.every(value=>content.textContent.includes(value)),
     originalAccountCopy:[...content.querySelectorAll('.execution-plan-account-detail')].every(e=>!/(?:USDT|USDC|BUSD|BTC|×|计划仓位|計畫倉位|Planned size|全仓净盈亏|全倉淨盈虧|Net P&L)/.test(e.textContent)),
     metricsBelowHeading:metrics.every(r=>r.top>=heading.bottom-1),prices:root.querySelectorAll('.execution-plan-price').length,targets:root.querySelectorAll('.execution-plan-target').length,details:root.querySelectorAll('.execution-plan-details').length,expiry:root.querySelectorAll('.execution-plan-expiry').length,ratios:root.querySelectorAll('.execution-plan-ratio').length,pricesAligned:Math.abs(root.querySelectorAll('.execution-plan-price')[0].getBoundingClientRect().top-root.querySelectorAll('.execution-plan-price')[1].getBoundingClientRect().top)<1,
     color:root.ownerDocument.defaultView.getComputedStyle(card).backgroundColor,
     overflowingElements:[...content.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>content.getBoundingClientRect().right+1).map(e=>({class:e.className,width:e.clientWidth,scroll:e.scrollWidth,text:e.textContent.slice(0,60)}))};
   });
  }).toString()+')('+JSON.stringify(f.expected||[])+')');
  const bad=result.filter(r=>r.scrollWidth>r.clientWidth+1||r.overflow.length||!r.metricsBelowHeading||r.prices!==2||r.targets!==(f.targetCount||2)||r.expiry!==0||!r.footerAligned||!r.footerTypographyMatches||!r.shortCreatedTime||!r.expirySingleLine||!r.expiryZone||!r.expiryWithoutYear||!r.expiryBelowTargets||!r.controlsOutsideRight||!r.actionPlacement||!r.rightColumnAligned||(f.width===410&&Math.abs(r.leftInset-r.rightInset)>1)||r.ratios!==(f.targetCount||2)||!r.pricesAligned||!r.accountVisible||!r.originalAccountCopy||((f.id.includes('-entry-v2-')||f.id.startsWith('account-v2-')||f.id.startsWith('account-screenshot-'))&&r.details!==(r.name==='chat'?1:0)));
  results.push({id:f.id,result,passed:!bad.length});
  if(f.id.startsWith('price-action-')||f.id.startsWith('account-')||bad.length){
   await new Promise(resolve=>setTimeout(resolve,150));
   fs.writeFileSync(path.join(output,f.id+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  if(bad.length){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(results,null,2));throw Error(f.id+': '+JSON.stringify(bad));}
  if(results.length%50===0)console.log('Verified '+results.length+'/'+fixtures.length+' UI fixtures');
 }
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({passed:results.length,surfaces:results.length*3,output}));win.destroy();
})().then(()=>app.exit(0)).catch(e=>{console.error(e.stack);app.exit(1);});
`;
const runnerPath=path.join(output,'runner.cjs');fs.writeFileSync(runnerPath,runner);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(electronExecutable,[runnerPath],{cwd:path.resolve(root,'..'),env,windowsHide:true,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
