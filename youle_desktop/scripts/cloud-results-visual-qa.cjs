const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),output=path.join(root,'output/planning-ui-cleanup-20261018');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));app.disableHardwareAcceleration();

(async()=>{
  await app.whenReady();
  const load=file=>import(pathToFileURL(path.join(root,file)));
  const cloud=await load('src/main/cloud-plan-contract.mjs');
  const view=await load('src/main/execution-plan-card-view.mjs');
  const {cloudPlanCardFixture}=await load('test/support/cloud-plan-card-fixture.mjs');
  const modules=new Map([[path.join(root,'src/main/cloud-plan-contract.mjs'),cloud]]);
  function loadTs(file) {
    if(modules.has(file))return modules.get(file);
    const exports={};modules.set(file,exports);
    const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    Function('require','exports',js)(name=>loadTs(path.resolve(path.dirname(file),name)),exports);
    return exports;
  }
  const plans=loadTs(path.join(root,'src/renderer/execution-plans.ts'));
  const alertsUi=loadTs(path.join(root,'src/renderer/trading-alerts-ui.ts'));
  const source=fs.readFileSync(path.join(root,'src/renderer/main.ts'),'utf8');
  const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
  const names=['renderExecutionPlansPage','renderExecutionPlanCard','renderExecutionPlanActions','renderExecutionPlanEndMenu','renderExecutionPlanCardContent','executionPlanStatusMeta','executionPlanCreatedLabel'];
  const functions=names.map(name=>{
    const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
    assert.ok(node,name);return node.getText(ast);
  });
  const compiled=ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderPlans(locale,empty) {
    const report=cloudPlanCardFixture(locale),card=cloud.cloudPlanCard(report,{language:locale});
    const state={settings:{language:locale},executionPlanFilter:'pending',executionPlans:empty?[]:[{
      id:'qa-plan',title:card.title,content:card.content,createdAt:report.planRecords[0].createdAt,status:'pending',cloudReport:report,
    }]};
    const deps={...plans,...view,...cloud,state,renderPlanningNavigation:alertsUi.renderPlanningNavigation,
      escapeHtml:escape,escapeAttr:escape,syncExecutionPlansForCurrentAccount:()=>{},executionPlanAlertSyncBusyIds:new Set(),executionPlanDeleteBusyIds:new Set()};
    return Function(...Object.keys(deps),compiled+';return renderExecutionPlansPage();')(...Object.values(deps));
  }
  function renderAlerts(locale,empty) {
    const state=alertsUi.createTradingAlertsUiState();state.loaded=true;
    state.alerts=empty?[]:[{
      alertId:'qa-alert',status:'monitoring',enabled:true,
      rule:{ruleId:'execution-plan-alert-qa',title:'BTC/USDT 1H',
        normalizedSummary:locale==='en'
          ?'Pending｜BTC entry at 82292.3\nExecuting｜BTC stop at 81682.2\nExecuting｜BTC target at 83207.45'
          :'待执行｜BTC 价格达到 82292.3 时触发开多预警\n执行中｜BTC 价格达到 81682.2 时触发止损预警\n执行中｜BTC 价格达到 83207.45 时触发止盈预警',
        root:{type:'condition',condition:{conditionId:'execution-plan-entry'}},
        contexts:[{contextId:'plan-market',marketSelector:{kind:'fixed',marketIds:['BINANCE:FUTURES:BTCUSDT']},intervals:['1h']}],
        evaluationPolicy:{clock:'bar_update'},triggerPolicy:{mode:'once'},revision:1},
    }];
    return alertsUi.renderTradingAlertsPage(state);
  }
  const styles=fs.readFileSync(path.join(root,'src/renderer/styles.css'),'utf8');
  const palette=fs.readFileSync(path.join(root,'src/main/execution-plan-card.css'),'utf8');
  const languageUrl=pathToFileURL(path.join(root,'src/renderer/app-language.mjs')).href;
  const win=new BrowserWindow({width:1400,height:950,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true}});
  const errors=[];win.webContents.on('console-message',(_e,_level,message)=>{if(/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
  const results=[];
  for(const theme of ['light','dark'])for(const locale of ['zh-CN','en','zh-TW'])for(const width of [1400,900])for(const empty of [false,true])for(const page of ['plans','alerts']) {
    const id=`${page}-${theme}-${locale}-${width}-${empty?'empty':'populated'}`;
    const html=`<!doctype html><html data-theme="${theme}" lang="${locale}"><head><meta charset="utf-8"><style>${styles}\n${palette}\nhtml,body{margin:0;width:100%;height:100%}body{display:flex;background:var(--bg);color:var(--text-primary)}</style></head><body>${page==='plans'?renderPlans(locale,empty):renderAlerts(locale,empty)}</body></html>`;
    const file=path.join(output,id+'.html');fs.writeFileSync(file,html);win.setSize(width,950);await win.loadFile(file);
    await win.webContents.executeJavaScript(`import(${JSON.stringify(languageUrl)}).then(m=>m.localizeAppTree(document.body,${JSON.stringify(locale)}))`);
    const layout=await win.webContents.executeJavaScript(`(()=>{
      const main=document.querySelector('main'),list=document.querySelector('.trading-alert-list-scroll');
      const filters=main.querySelector('.trading-alert-subfilters');
      const content=main.querySelector('.execution-plan-list,.execution-plan-empty,.trading-alert-list-scroll');
      return {overflow:document.documentElement.scrollWidth>innerWidth,text:main.innerText,
        tabs:main.querySelectorAll('[data-planning-section]').length,filters:filters?.querySelectorAll('button').length||0,
        cards:main.querySelectorAll('.execution-plan-card,.trading-alert-card').length,
        cleanSequence:(filters||main.firstElementChild).nextElementSibling===content,
        alertContent:list?.firstElementChild?.className||'',
        unwanted:main.querySelectorAll('dialog,.cloud-alert-panel,[data-action="open-cloud-tasks"]').length};
    })()`);
    assert.equal(layout.overflow,false,id);assert.equal(layout.tabs,2,id);assert.equal(layout.filters,empty?0:3,id);
    assert.equal(layout.cards,empty?0:1,id);assert.equal(layout.cleanSequence,true,id);assert.equal(layout.unwanted,0,id);
    assert.doesNotMatch(layout.text,/云端任务|雲端任務|云端计划提醒|雲端計畫提醒|Cloud tasks|Cloud plan reminders|ORDERED_REPLAY_REQUIRED/);
    if(page==='alerts')assert.equal(layout.alertContent,empty?'trading-alert-empty':'trading-alert-card-grid',id);
    if(locale==='en')assert.doesNotMatch(layout.text,/\p{Script=Han}/u,id);
    if(width===1400&&!empty)fs.writeFileSync(path.join(output,id+'.png'),(await win.webContents.capturePage()).toPNG());
    results.push({id,...layout});
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,results,errors},null,2));
  win.destroy();console.log(`Plans / alerts: ${results.length} layouts passed.`);app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);});
