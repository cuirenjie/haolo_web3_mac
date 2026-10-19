const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),output=path.join(root,'output/cloud-results-visual-qa-20261018');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(locale) {
  const condition={schemaVersion:2,conditionId:uuid(3),revision:1,confirmation:'breakout_retest',breakoutConfirmation:'bar_close',
    interval:'1h',direction:'long',trigger:{operator:'cross_up',lower:100.12345678},retest:{operator:'in_zone',lower:100.12345678,upper:101.98765432},
    invalidation:{operator:'at_or_below',lower:95.12345678},expiresAt:1900000000000,liveEvidenceGate:{kind:'order_flow_pressure'}};
  const scenario={stop:95.12345678,targets:[110.98765432,120.12345678],conditionHash:'a'.repeat(64)};
  const executionPlan={schemaVersion:2,planId:uuid(2),revision:1,requestedMode:'auto',selectedMode:'right',conditionHash:'a'.repeat(64),
    entryCondition:condition,scenarios:[scenario],outcome:{action:'plan'}};
  const remote={id:uuid(2),runId:uuid(1),version:1,confirmationHash:'b'.repeat(64),monitoringPolicy:'entry_v2',scenario};
  const report={schemaVersion:1,runId:uuid(1),resultHash:'c'.repeat(64),locale,marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',strategyId:'order-flow',report:'QA',executionPlan,planRecords:[remote]};
  const alert={id:uuid(4),state:'monitoring',rule:{monitoringPolicy:'entry_v2',marketKey:'binance:usdm:BTCUSDT',interval:'1h',conditionHash:executionPlan.conditionHash,entryCondition:condition}};
  const event={sequence:2,alertId:alert.id,alert,data:{eventId:uuid(5),condition:'entry',price:100.12345678,occurredAt:1890000000000,
    evidence:{conditionId:condition.conditionId,conditionRevision:1,conditionHash:executionPlan.conditionHash}}};
  return {report,feed:{items:[alert],recentEvents:[event]}};
}
(async()=>{
  await app.whenReady();
  const load=name=>import(pathToFileURL(path.join(root,`src/main/${name}.mjs`)));
  const {cloudPlanCard}=await load('cloud-plan-contract'),{renderCloudAlertPanel}=await load('cloud-alert-view'),{executionPlanStickyHtml}=await load('execution-plan-sticky-view');
  const styles=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8'),palette=fs.readFileSync(path.join(root,'src/main/execution-plan-card.css'),'utf8');
  const recovery=ts.transpileModule(fs.readFileSync(path.join(root,'src/renderer/cloud-task-recovery.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const win=new BrowserWindow({width:900,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  const errors=[];win.webContents.on('console-message',(_e,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
  const results=[];
  for(const theme of ['light','dark'])for(const locale of ['zh-CN','en','zh-Hant']) {
    const {report,feed}=fixture(locale),html=`<!doctype html><html data-theme="${theme}" lang="${locale}"><head><meta charset="utf-8"><style>${styles}\n${palette}\nhtml,body{height:auto;overflow:auto}body{padding:20px;background:var(--bg);color:var(--text-primary)}.qa{max-width:800px;margin:auto}</style></head><body><main class="qa"><section class="message-execution-plan execution-plan-surface" style="--message-execution-plan-font-size:14px"><div class="execution-plan-card-content">${cloudPlanCard(report).html}</div></section>${renderCloudAlertPanel(feed,locale)}</main></body></html>`;
    const file=path.join(output,`${theme}-${locale}.html`);fs.writeFileSync(file,html);await win.loadFile(file);
    const layout=await win.webContents.executeJavaScript(`(()=>({overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText,cardColor:getComputedStyle(document.querySelector('.execution-plan-surface')).color}))()`);
    assert.equal(layout.overflow,false);assert.ok(layout.text.includes('100.12345678'));if(locale==='en')assert.doesNotMatch(layout.text,/\p{Script=Han}/u);
    fs.writeFileSync(path.join(output,`${theme}-${locale}.png`),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`{const exports={};${recovery}\nwindow.qaRecovery=exports.openCloudRecoveryDialog(async action=>({ok:true,items:[{key:'task',runId:'id',state:'running',marketId:'BTCUSDT',interval:'1h',strategyId:'wave',cancelRequested:false}]}),${JSON.stringify(locale)});void 0;}`);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('dialog').open`),true);
    fs.writeFileSync(path.join(output,`${theme}-${locale}-recovery.png`),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('window.qaRecovery()');
    const sticky=path.join(output,'sticky.html');fs.writeFileSync(sticky,executionPlanStickyHtml({cloudReport:report,theme,language:locale==='zh-Hant'?'zh-TW':locale}));
    win.setSize(460,650);await win.loadFile(sticky);
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.content').scrollWidth<=document.querySelector('.content').clientWidth`),true);
    fs.writeFileSync(path.join(output,`${theme}-${locale}-sticky.png`),(await win.webContents.capturePage()).toPNG());
    win.setSize(900,900);results.push({theme,locale,...layout});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,results,errors},null,2));
  win.destroy();console.log('Cloud result / reminder / recovery / sticky: 2 themes × 3 languages passed.');app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);});
