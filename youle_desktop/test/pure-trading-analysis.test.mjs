import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { resolvePureTradingAnalysis, pureTradingAnalysisRequest } from '../src/renderer/pure-trading-analysis.ts';
import { tradingStrategyCatalog, tradingIndicatorCatalog } from '../src/renderer/trading-strategy-runtime/catalog.ts';
import { setup } from './helpers/cloud-renderer-harness.mjs';
import { normalizeCloudReports } from '../src/main/cloud-plan-contract.mjs';
import { cloudPlanCardFixture, legacyCloudPlanCardFixture } from './support/cloud-plan-card-fixture.mjs';
import { renderCurrentReports } from './support/right-renderer-parity.mjs';
import { revealPureAnalysisReport } from '../src/renderer/pure-analysis-presentation.ts';

const catalog = [...tradingStrategyCatalog(), ...tradingIndicatorCatalog()];
const target = {schemaVersion:1,targetId:'captured',storageSessionId:'origin',marketId:'BINANCE:FUTURES:BTCUSDT',
  market:{id:'BINANCE:FUTURES:BTCUSDT',symbol:'BTCUSDT',baseAsset:'BTC',quoteAsset:'USDT',provider:'binance',marketType:'perpetual'},
  symbol:'BTCUSDT',interval:'240',visibleCandles:Array.from({length:90},(_,i)=>({time:1700000000+i*3600}))};
const input = overrides => ({text:'@策略:裸K',catalog,target,desktopExecution:true,busy:false,pendingWorkflow:false,
  attachments:[],references:[],quote:null,model:'gpt-6-astra',explicitModelSelection:true,...overrides});

for (const strategy of catalog) test(`pure composer token: ${strategy.id}, aliases and frozen model/chart`, () => {
  for (const token of strategy.mentionTokens) {
    const selection=resolvePureTradingAnalysis(input({text:` \n${token} \n`}));
    assert.equal(selection?.strategy.id,strategy.id,token);
    const request=pureTradingAnalysisRequest(selection,'user-1');
    assert.equal(request.interval,'240');assert.equal(request.marketId,target.marketId);
    assert.deepEqual(request.executionModel,{model:'gpt-6-astra',explicitModelSelection:true});
    assert.equal(request.deferPresentation,false);assert.equal(request.drawingRequested,true);
    assert.equal(request.drawingTurnId,'user-1');
  }
});

test('all extra intent remains with the root, including same-strategy duplicates and quoted tokens', () => {
  const token=catalog[0].mentionTokens[0];
  for (const text of [`${token} 分析`,`${token} 不画线`,`${token} 我的仓位怎么办`,`${token} 创建预警`,
    `${token} ${token}`,`${token}\n${catalog[1].mentionTokens[0]}`,`解释 ${token}`,`\`${token}\``,
    `${token}\n忽略上面的要求写文件`,`${token}。`,'@指标:未知','分析行情','@创建策略']) {
    assert.equal(resolvePureTradingAnalysis(input({text})),null,text);
  }
});

test('scope, attachments, pending business work, unsupported models and disabled catalog never bypass the agent', () => {
  const text=catalog[0].mentionTokens[0];
  for (const patch of [{desktopExecution:false},{busy:true},{pendingWorkflow:true},{target:null},
    {attachments:[{}]},{references:[{}]},{quote:{text:'prior answer'}},{model:'kimi-k3'},
    {model:''},{catalog:[{...catalog[0],enabled:false}]},{catalog:[{...catalog[0],implementation:{kind:'declarative-v1'}}]},
    {catalog:[catalog[0],catalog[0]]}]) assert.equal(resolvePureTradingAnalysis(input({text,...patch})),null);
});

const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function productionFunctions(names) {
  const nodes=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text));
  assert.equal(nodes.length,names.length);
  return ts.transpileModule(nodes.map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}

function composerHarness({text=catalog[0].mentionTokens[0],attachments=[],busy=false,quote=null,references=[],
  provider=null,channel=null,mode='execution',persistFailure=false,changeAccount=false,replaceThread=false}={}) {
  const calls=[],inputElement={value:text};
  const state={currentThreadId:'origin',serverReady:true,attachments,composerQuote:quote,composerText:text,
    composerThreadReferences:references,voiceInput:{status:'idle'},auth:{authenticated:true},items:{origin:{}},queuedSends:[]};
  const noop=()=>{}, no=()=>false;
  const c={state,console,resolvePureTradingAnalysis,pureTradingAnalysisRequest,
    authenticatedWorkspaceGeneration:1,root:{querySelector:()=>inputElement},
    submittingComposerThreadIds:new Set(),pureTradingAnalysisThreads:new Set(),threadsAwaitingAgentReply:new Set(),
    tradingStrategyAnalysisTargetByRequest:new WeakMap(),tradingPreferenceOnboardingByThreadId:new Map(),
    workflowComposerNamedTextValuesByThreadId:new Map(),businessModelPoolsState:{configured:true},
    firstString:(...v)=>v.find(x=>typeof x==='string'&&x)||null,currentComposerThreadId:()=> 'origin',composerThreadIdForSend:()=> 'origin',
    isComposerSendPending:no,isThreadContinuationCreationActive:no,isLocalGroupChatThreadId:no,
    activeWorkflowRunForThread:()=>null,switchingThreadId:null,isThreadResumeInFlight:no,
    isVideoExpertThreadId:no,isImageGenerationThreadMode:no,isMediaCreationMode:no,isLocalCodexThread:()=>true,
    isBlankNewThread:no,isLocalBlankThreadId:no,threadModelSelection:()=>({userSelected:true}),threadModelSettings:()=>({}),
    mediaCreationVisibleComposerText:(_id,value)=>value,workflowComposerInvocationContract:()=>null,newThreadModeForThread:()=>mode,
    deepSeekMediaComposerValidationError:()=>null,workflowComposerTopologyValidation:()=>null,
    isTradingExpertSurfaceThreadId:()=>true,collapseTradingExpertWatchlist:noop,
    captureTradingExpertAnalysisTarget:()=>target,tradingStrategyCatalog:()=>tradingStrategyCatalog(),tradingIndicatorCatalog:()=>tradingIndicatorCatalog(),
    channelIdFromThreadId:()=>channel,providerFromThreadId:()=>provider,localGroupChatRecord:()=>null,
    codexConversationModeForThread:()=>mode,hasThreadCodexWork:()=>busy,activeTradingExpertAnalysisJobIds:()=>[],
    tradingAlertConversationStateForThread:()=>null,personalStrategyConversationStateForThread:()=>null,
    activeComposerThreadReferences:()=>references,selectedChatModelValue:()=> 'gpt-6-astra',
    codexTradingTools:{capture:()=> 'context',release:id=>calls.push(['release',id]),updateAttachments:noop},
    recoverStaleCodexWorkForComposer:noop,isConversationSupplementWindowOpen:no,
    groupIdForThreadContext:()=> 'default',isDefaultThreadGroup:()=>true,expandSystemDashboardForNewMessage:noop,
    cloneLocalAttachments:x=>x,mediaCreationSubmissionAttachments:(_id,x)=>x,cloneComposerQuote:x=>x,cloneComposerThreadReferences:x=>x,
    beginPendingComposerSend:(id,value,atts,q,refs)=>{
      const item={id:'user-1',type:'userMessage',text:value,createdAt:'2026-10-21T10:00:00Z'};
      state.items[id][item.id]=item;return {itemId:item.id,attachments:atts,quote:q,threadReferences:refs};
    },clearTradingExpertComposerAfterSend:noop,commitSelectedNewThreadGroupForSend:noop,
    revealThreadGroupForComposerSend:no,render:noop,
    composerAgentText:text=>text,prepareContextBudgetForSend:async()=>{calls.push(['budget']);return {ok:true};},
    failPendingComposerSend:(_id,_item,message)=>calls.push(['failed',message]),
    setPendingComposerSendStatus:()=>null,messageAttachmentFromLocal:x=>x,
    promoteLocalBlankThreadForSend:async id=>id,consumptionVisibleQuestion:x=>x,
    persistTradingExpertTranscriptItems:async(id,items)=>{
      calls.push(['persist',id,items]);if(persistFailure)throw Error('history unavailable');
      if(changeAccount)c.authenticatedWorkspaceGeneration++;
      return {threadId:replaceThread?'replacement':id};
    },clearPendingComposerSend:(...args)=>calls.push(['clear',...args]),
    rebindTradingExpertAnalysisTargetStorageSession:(value,id)=>({...value,storageSessionId:id}),
    runTradingStrategyChartRequest:async(id,strategy,request,user)=>calls.push(['analysis',id,strategy,request,user,c.tradingStrategyAnalysisTargetByRequest.get(request)]),
    syncComposerSendButton:noop,syncTradingExpertCollapseControlsState:noop,errorMessage:e=>e.message,
    refreshTradingExpertConversationSurface:noop,resolveTradingExpertAnalysisThreadId:id=>id,
    sendCurrentChannelMessage:async()=>calls.push(['channel']),
    sendCurrentProviderMessage:async()=>calls.push(['provider']),
    prepareThreadReferencesForSend:async()=>({ok:true}),isMultiModelClusterThread:no,
    setMessageStreamFollow:noop,beginCodexSend:()=>1,setCodexThreadBusy:noop,
    sendAgentText:async(...args)=>calls.push(['root',...args]),
  };
  vm.createContext(c);vm.runInContext(productionFunctions(['sendCurrentMessage','isPureTradingAnalysisThread']),c);
  return {c,calls,state,send:()=>c.sendCurrentMessage()};
}

function attachRealRunner(h,{report=cloudPlanCardFixture(),error=null,gate=null,persisted=true,drawingGate=null}={}) {
  const {c,calls,state}=h,jobs=new Set(),thinking=new Map();
  const noop=()=>{};
  Object.assign(c,{
    pureAnalysisReportReveals:new Map(), revealPureAnalysisReport:(text,options)=>revealPureAnalysisReport(text,{...options,wait:async()=>{}}),
    api:{tradingCloudRecovery:async(...args)=>calls.push(['ack',...args])},
    beginTradingExpertAnalysisJob:()=>{jobs.add('job');return 'job';},
    finishTradingExpertAnalysisJob:()=>jobs.delete('job'),activeTradingExpertAnalysisJobIds:()=>[...jobs],
    updateTradingExpertThinkingState:(id,phase)=>thinking.set(id,phase),
    clearTradingExpertThinkingState:id=>thinking.delete(id),
    refreshTradingExpertConversationSurface:id=>calls.push(['refresh',id,c.pureTradingAnalysisThreads.size,c.submittingComposerThreadIds.size]),
    ensureTradingExpertChartIndicatorVisible:noop,
    runTradingExpertStrategyConversation:async(id,request)=>{
      calls.push(['cloud',id,request]);
      if(gate)await gate;
      if(error)throw error;
      const result={symbol:'BTCUSDT',report:report.report,narrative:'short status only',cloudReports:[report]};
      const presentation=request.onReportReady?.(result,()=>true);
      const outcomes=await Promise.allSettled([presentation,drawingGate]);
      for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
      return result;
    },
    appLanguageLocale:()=> 'zh-CN',tradingAnalysisCompletionText:()=> 'completed',
    localHistoryAheadThreadIds:new Set(),englishSafeAssistantText:x=>x,normalizeCloudReports,
    upsertItem:(id,item)=>{state.items[id]??={};state.items[id][item.id]=item;},
    patchConversationRow:noop,recordRendererTranscriptDiagnostic:noop,recordTradingRendererFailure:noop,
    persistCompletedTradingExpertTranscript:async(id,items)=>{calls.push(['transcript',id,items]);return persisted;},
    isTradingAnalysisCancellation:e=>e.code==='TRADING_ANALYSIS_CANCELLED',
    isTradingAnalysisQuotaFailure:()=>false,buildTradingStrategyFailureReport:(_s,e)=>`Failed: ${e.message}`,
    describeTradingAnalysisFailure:e=>({summary:e?.message||'drawing failed'}),
    localGroupChatBusyThreadIds:new Set(),activeChannelCodexInteractions:new Map(),interruptingTurnId:null,
    hasActiveCompletedTradingAnalysis:()=>false,isThreadBusy:()=>false,
    shouldOpenConversationSupplementWindow:()=>false,conversationSupplementRoutingStateForThread:()=>({}),
  });
  c.codexTradingTools.isToolTurn=()=>false;
  vm.runInContext(productionFunctions(['runTradingStrategyChartRequest','appendTradingExpertReport','appendTradingExpertProgress',
    'isComposerThreadBusy','isConversationSupplementWindowOpen','composerSubmitActionForThread','canInterruptThread','interruptCurrentTurn']),c);
  return {jobs,thinking};
}

test('real composer + runner deliver the full report and actionable plan, then restore the send state',async()=>{
  for(const report of [cloudPlanCardFixture(),legacyCloudPlanCardFixture('price-action','zh-CN')]) {
    const h=composerHarness(),r=attachRealRunner(h,{report});await h.send();
    const cloud=h.calls.filter(c=>c[0]==='cloud');assert.equal(cloud.length,1);
    assert.equal(cloud[0][2].model,'gpt-6-astra');assert.equal(cloud[0][2].explicitModelSelection,true);
    assert.equal(cloud[0][2].reasoningEffort,'max');assert.equal(cloud[0][2].analysisTarget.marketId,target.marketId);
    assert.equal(cloud[0][2].drawingRequested,true);assert.equal(cloud[0][2].executionPlanRequested,true);
    assert.equal(cloud[0][2].pureReferenceAnalysis,true);
    const final=h.calls.find(c=>c[0]==='transcript')[2].at(-1);
    assert.equal(final.phase,'final_answer');assert.equal(final.text,report.report);
    assert.equal(final.__youleExecutionPlanPresentation,'execution-plan');
    assert.equal(final.__youleCloudReports[0].report,report.report);
    const rendered=renderCurrentReports(final.__youleCloudReports);
    assert.match(rendered.rendered.cards,/message-execution-plan/);
    assert.match(rendered.actions,/data-execution-plan-index/);
    assert.equal(h.calls.find(c=>c[0]==='transcript')[2][0].id,'user-1');
    assert.equal(h.calls.filter(c=>c[0]==='ack').length,1);
    assert.deepEqual(h.calls.at(-1),['refresh','origin',0,0]);
    assert.equal(r.jobs.size,0);assert.equal(r.thinking.size,0);
    assert.equal(h.calls.some(c=>['root','budget'].includes(c[0])),false);
  }
});

test('the complete report is visible during drawing, keeps stop/busy ownership and persists exactly once',async()=>{
  let release;const drawingGate=new Promise(r=>release=r),h=composerHarness(),r=attachRealRunner(h,{drawingGate});
  const pending=h.send();await new Promise(resolve=>setImmediate(resolve));
  const reports=Object.values(h.state.items.origin).filter(item=>item.phase==='final_answer');
  assert.equal(reports.length,1);assert.equal(reports[0].text,cloudPlanCardFixture().report);
  assert.equal(h.c.isComposerThreadBusy('origin'),true);assert.equal(h.c.canInterruptThread('origin'),true);
  assert.equal(r.jobs.size,1);assert.equal(h.calls.some(c=>c[0]==='ack'),false);
  release();await pending;
  const persisted=h.calls.find(c=>c[0]==='transcript')[2];
  assert.equal(persisted.filter(item=>item.id===reports[0].id).length,1);
  assert.equal(Object.values(h.state.items.origin).filter(item=>item.__youleCloudReports?.length).length,1);
  assert.equal(persisted.filter(item=>item.text==='completed').at(-1)?.phase,'commentary');
  assert.equal(h.c.isComposerThreadBusy('origin'),false);
});

test('stopping drawing retains the completed report and acknowledges only its saved delivery',async()=>{
  let reject;const drawingGate=new Promise((_,r)=>reject=r),h=composerHarness();attachRealRunner(h,{drawingGate});
  h.c.cancelTradingExpertAnalysis=async()=>reject(Object.assign(Error('stop drawing'),{code:'TRADING_ANALYSIS_CANCELLED'}));
  const pending=h.send();await new Promise(r=>setImmediate(r));await h.c.interruptCurrentTurn('origin');await pending;
  const items=h.calls.find(c=>c[0]==='transcript')[2];
  assert.ok(items.some(item=>item.text===cloudPlanCardFixture().report));assert.match(items.at(-1).text,/停止/);
  assert.equal(items.at(-1).phase,'final_answer');
  assert.equal(h.calls.filter(c=>c[0]==='ack').length,1);assert.equal(h.calls.filter(c=>c[0]==='cloud').length,1);
});

test('presentation failure after the report keeps the original report and plan without another analysis',async()=>{
  let reject;const drawingGate=new Promise((_,r)=>reject=r),h=composerHarness();attachRealRunner(h,{drawingGate});
  const pending=h.send();await new Promise(r=>setImmediate(r));reject(Error('drawing presentation failed'));await pending;
  const items=h.calls.find(c=>c[0]==='transcript')[2],reports=items.filter(item=>item.__youleCloudReports?.length);
  assert.equal(reports.length,1);assert.equal(reports[0].text,cloudPlanCardFixture().report);
  assert.ok(reports[0].__youleCloudReports?.length);
  assert.equal(items.at(-1).text,'drawing presentation failed');
  assert.equal(h.calls.filter(c=>c[0]==='ack').length,1);assert.equal(h.calls.filter(c=>c[0]==='cloud').length,1);
  assert.equal(h.c.isComposerThreadBusy('origin'),false);
});

test('account switching during drawing cannot persist or acknowledge an earlier visible report into the next account',async()=>{
  let release;const drawingGate=new Promise(r=>release=r),h=composerHarness(),r=attachRealRunner(h,{drawingGate});
  const pending=h.send();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(Object.values(h.state.items.origin).some(item=>item.text===cloudPlanCardFixture().report));
  h.c.authenticatedWorkspaceGeneration++;h.state.auth.authenticated=false;
  release();await pending;
  assert.equal(h.calls.some(c=>['transcript','ack'].includes(c[0])),false);
  assert.equal(r.jobs.size,0);assert.equal(h.c.pureTradingAnalysisThreads.size,0);
});

test('cloud failure stops once; report-persistence failure retains recovery and never repeats inference',async()=>{
  for(const options of [{error:Error('cloud unavailable')},{persisted:false}]) {
    const h=composerHarness(),r=attachRealRunner(h,options);await h.send();
    assert.equal(h.calls.filter(c=>c[0]==='cloud').length,1);
    assert.equal(h.calls.some(c=>['ack','root'].includes(c[0])),false);
    assert.equal(r.jobs.size,0);assert.equal(r.thinking.size,0);
    const final=h.calls.find(c=>c[0]==='transcript')[2].at(-1);
    assert.equal(final.phase,'final_answer');
    if(options.error)assert.match(final.text,/cloud unavailable/);
    else assert.equal(final.text,cloudPlanCardFixture().report);
  }
});

test('stop cancels only the active analysis; model changes and duplicate sends cannot replace the frozen request',async()=>{
  let reject;const gate=new Promise((_,r)=>reject=r),h=composerHarness(),r=attachRealRunner(h,{gate});
  h.c.cancelTradingExpertAnalysis=async id=>{assert.equal(id,'job');reject(Object.assign(Error('stopped'),{code:'TRADING_ANALYSIS_CANCELLED'}));};
  const pending=h.send();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.c.isComposerThreadBusy('origin'),true);assert.equal(h.c.canInterruptThread('origin'),true);
  assert.equal(h.c.isConversationSupplementWindowOpen('origin'),false);
  assert.equal(h.c.composerSubmitActionForThread('origin'),'interrupt');
  h.c.selectedChatModelValue=()=> 'deepseek-flash';
  await h.send();await h.c.interruptCurrentTurn('origin');await pending;
  assert.equal(h.calls.filter(c=>c[0]==='cloud').length,1);
  assert.equal(h.calls.find(c=>c[0]==='cloud')[2].model,'gpt-6-astra');
  assert.equal(r.jobs.size,0);assert.equal(r.thinking.size,0);
  assert.equal(h.c.isComposerThreadBusy('origin'),false);
  assert.match(h.calls.find(c=>c[0]==='transcript')[2].at(-1).text,/停止/);
  assert.equal(h.calls.some(c=>['ack','root'].includes(c[0])),false);
});

test('history thread replacement while saving the report still blocks duplicate sends',async()=>{
  const h=composerHarness();h.c.pureTradingAnalysisThreads.add('origin');
  h.c.resolveTradingExpertAnalysisThreadId=id=>id==='origin'?'replacement':id;
  h.c.composerThreadIdForSend=()=> 'replacement';
  assert.equal(h.c.isPureTradingAnalysisThread('replacement'),true);
  await h.send();assert.equal(h.calls.length,0);
});

test('a late cloud response after an account switch cannot publish a report or acknowledge recovery',async()=>{
  let resolve;const gate=new Promise(r=>resolve=r),h=composerHarness(),r=attachRealRunner(h,{gate});
  const pending=h.send();await new Promise(r=>setImmediate(r));
  h.c.authenticatedWorkspaceGeneration++;h.state.auth.authenticated=false;
  resolve();await pending;
  assert.equal(h.calls.some(c=>['transcript','ack'].includes(c[0])),false);
  assert.equal(r.jobs.size,0);assert.equal(r.thinking.size,0);
  assert.equal(h.c.pureTradingAnalysisThreads.size,0);
});

test('real composer sends exactly one cloud analysis, persists user input and never samples or compacts the root',async()=>{
  const h=composerHarness();await h.send();
  assert.deepEqual(h.calls.map(c=>c[0]),['persist','clear','analysis','release']);
  const [,id,strategy,request,user,frozen]=h.calls.find(c=>c[0]==='analysis');
  assert.equal(id,'origin');assert.equal(strategy.id,catalog[0].id);assert.equal(user.id,'user-1');
  assert.equal(request.executionModel.model,'gpt-6-astra');assert.equal(frozen.interval,'240');
  assert.equal(h.c.submittingComposerThreadIds.size,0);assert.equal(h.c.pureTradingAnalysisThreads.size,0);
});

test('history failure and account changes stop before analysis, with no automatic root retry',async()=>{
  for(const options of [{persistFailure:true},{changeAccount:true}]) {
    const h=composerHarness(options);await h.send();
    assert.equal(h.calls.some(c=>['analysis','root','budget'].includes(c[0])),false);
    assert.equal(h.c.pureTradingAnalysisThreads.size,0);
  }
});

test('replacement history thread keeps the original market and current storage ownership',async()=>{
  const h=composerHarness({replaceThread:true});await h.send();
  const call=h.calls.find(c=>c[0]==='analysis');assert.equal(call[1],'replacement');
  assert.equal(call[5].storageSessionId,'replacement');assert.equal(call[5].marketId,target.marketId);
  assert.equal(h.c.submittingComposerThreadIds.size,0);assert.equal(h.c.pureTradingAnalysisThreads.size,0);
});

for(const options of [{text:'@策略:缠论 分析原因'},{text:'@策略:缠论 @指标:MACD'},
  {attachments:[{uploadStatus:'uploaded',name:'file.txt'}]},{quote:{text:'old answer'}},{references:[{}]}]) {
  test(`real composer preserves root dispatch: ${JSON.stringify(options)}`,async()=>{
    const h=composerHarness(options);await h.send();assert.equal(h.calls.filter(c=>c[0]==='root').length,1);
    assert.equal(h.calls.some(c=>['analysis','persist'].includes(c[0])),false);
  });
}

test('busy root queues pure mentions; channel and provider conversations retain their own senders',async()=>{
  for(const options of [{busy:true},{channel:'wechat'},{provider:'kimi'}]) {
    const h=composerHarness(options);await h.send();
    assert.equal(h.calls.some(c=>c[0]==='analysis'),false);
    if(options.busy)assert.equal(h.state.queuedSends.length,1);
    else assert.ok(h.calls.some(c=>c[0]===(options.channel?'channel':'provider')));
  }
});

for(const strategy of catalog) test(`cloud and Drawing Gateway inputs remain unchanged: ${strategy.id}`,async()=>{
  const selection=resolvePureTradingAnalysis(input({text:strategy.mentionTokens[0]}));
  const request=pureTradingAnalysisRequest(selection,'user-1');
  const s=setup();
  const result=await s.workspace.runGeneralConversation({...request,...request.executionModel,analysisTarget:target},strategy.id);
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].model,'gpt-6-astra');
  assert.equal(s.calls[0].explicitModelSelection,true);assert.equal(s.calls[0].reasoningEffort,'max');
  assert.equal(s.calls[0].interval,'240');assert.equal(s.calls[0].responseMode,'full');
  assert.equal(result.report,'Canonical server report');assert.notEqual(result.report,result.narrative);
  assert.equal(s.drawings.length,1);assert.equal(s.indicatorDrawings.length,1);
  assert.deepEqual(s.failed,[]);
});
