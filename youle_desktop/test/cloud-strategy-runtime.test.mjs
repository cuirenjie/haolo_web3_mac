import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createCloudStrategyRuntime,cloudMarketContext,cloudAccountConnection} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';

test('account selection consumes server effective consent and excludes missing or revoked bindings', () => {
  const target = {marketKey:'binance:usdm:BTCUSDT'};
  const bound = {id:'legacy-or-new',analysisConsent:true,credentialsBound:true};
  assert.deepEqual(cloudAccountConnection([bound],target),{id:bound.id,unavailable:false});
  assert.deepEqual(cloudAccountConnection([{...bound,analysisConsent:false}],target),{id:null,unavailable:true});
  assert.deepEqual(cloudAccountConnection([{...bound,credentialsBound:false}],target),{id:null,unavailable:true});
  assert.deepEqual(cloudAccountConnection([{...bound,revoked:true}],target),{id:null,unavailable:false});
  assert.deepEqual(cloudAccountConnection([],target),{id:null,unavailable:false});
  assert.equal(cloudAccountConnection([bound],{marketKey:'binance:spot:BTCUSDT'}),null);
  assert.equal(cloudAccountConnection([bound],{marketKey:'binance:usdm:BTCUSDC'}),null);
  assert.deepEqual(cloudAccountConnection([{...bound,id:'disabled',analysisConsent:false},bound],target),
    {id:bound.id,unavailable:false});
});

const configHash='a'.repeat(64);
const account={ownerId:'account@service',accountId:'account',baseUrl:'https://haolo.example'};
const params={analysisJobId:'job-1',marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',preferencesRevision:3,preferencesHash:configHash};
function setup(handler) {
  const records=new Map(),calls=[];
  let current=account;
  const journal={async get(owner,key){return structuredClone(records.get(`${owner}:${key}`)??null);},async put(owner,key,value){records.set(`${owner}:${key}`,structuredClone(value));},async list(owner){return [...records].filter(([key])=>key.startsWith(`${owner}:`)).map(([,v])=>v);}};
  let run;
  const api={async tradingCloudRequest(operation,payload,options){
    calls.push({operation,payload:structuredClone(payload),options});
    const custom=await handler?.({operation,payload,options,get run(){return run;},set run(value){run=value;}});
    if(custom!==undefined)return custom;
    if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'moving-average-analysis',legacyWindows:true,entryModes:['left','right','auto']}]};
    if(operation==='marketSnapshot')return {marketKey:'binance:usdm:BTCUSDT',interval:'1h',snapshotId:'00000000-0000-0000-0000-000000000001'};
    if(operation==='createRun') {
      run={...payload,id:payload.clientRunId,state:'running'};
      return run;
    }
    if(operation==='cancelRun'){if(run)run.state='cancelled';return {id:payload.runId,state:'cancelled'};}
    if(operation==='run'){
      const plan={schemaVersion:2,planId:'00000000-0000-0000-0000-000000000002',revision:1,policyVersion:'entry-v2.1',
        context:run.context,appliedPreferences:{revision:3,configHash},requestedMode:'auto',selectedMode:null,scenarios:[],
        outcome:{capability:'supported',candidateStatus:'none',evaluationStatus:'completed',action:'wait',reason:'NO_CANDIDATE'}};
      return {...run,state:'succeeded',desktopResult:{ok:true,clientContract:'windows-v1',strategy:{id:'moving-average-analysis'},
        snapshot:{marketId:params.marketId,interval:params.interval},executionPlan:plan,
        analysisPlan:{analysisId:'analysis',marketId:params.marketId,interval:params.interval,report:'云端报告',executionPlan:plan,
          drawingPatch:{analysisId:'analysis',marketId:params.marketId,interval:params.interval,operations:[]}},
        cloud:{runId:run.id,context:run.context,appliedPreferences:{revision:3,configHash},executionPolicy:'entry-v2',locale:run.locale,
          resultHash:'b'.repeat(64),planIds:[],planRecords:[],conditionReceipts:[]}}};
    }
    throw Error(operation);
  }};
  const runtime=createCloudStrategyRuntime({owner:async()=>current,api:()=>api,journal,wait:async()=>{},pollMs:0});
  return {runtime,journal,calls,records,setOwner(value){current=value;}};
}

test('official analysis sends identities and preferences, never local core inputs or credentials',async()=>{
  const {runtime,calls}=setup();
  const result=await runtime.run('moving-average-analysis',{...params,candles:[{secret:'local'}],userRiskProfile:{local:'private'},apiKey:'never-send'});
  assert.equal(result.analysisPlan.report,'云端报告');
  const submitted=calls.find(c=>c.operation==='createRun');
  assert.equal(submitted.payload.preferencesRevision,3);
  assert.equal(submitted.payload.executionPolicy,'entry-v2');
  assert.equal(submitted.options.expectedAccountId,account.accountId);
  assert.equal(submitted.payload.clientRunId,result.cloud.runId);
  for(const field of ['candles','userRiskProfile','apiKey'])assert.equal(submitted.payload[field],undefined);
  assert.equal((await runtime.pending()).length,1);
  await runtime.acknowledge(params.analysisJobId);
  assert.equal((await runtime.pending()).length,0);
});

test('host repairs undersized viewport hints before admission without changing frozen retries',async()=>{
  for(const strategyId of ['order-flow','dow-theory']) {
    let first=true;
    const {runtime,calls}=setup(({operation,run})=>{
      if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:strategyId,legacyWindows:true,entryModes:['auto']}]};
      if(operation==='createRun'&&first){first=false;throw Object.assign(Error('unknown admission'),{status:503});}
      if(operation==='run')return {...run,state:'cancelled'};
    });
    const input={...params,analysisWindowCount:100};
    await assert.rejects(runtime.run(strategyId,input),/unknown admission/);
    await assert.rejects(runtime.run(strategyId,input),e=>e.code==='TRADING_ANALYSIS_CANCELLED');
    const snapshots=calls.filter(c=>c.operation==='marketSnapshot');
    assert.equal(snapshots.length,1);
    assert.equal(snapshots[0].payload.windowCount,120);
    const admissions=calls.filter(c=>c.operation==='createRun');
    assert.deepEqual(admissions[0].payload,admissions[1].payload);
    assert.equal(admissions[0].options.idempotencyKey,admissions[1].options.idempotencyKey);
  }
});

test('explicit time ranges stay exact and insufficient history does not trigger another admission',async()=>{
  const {runtime,calls}=setup(({operation})=>{
    if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'order-flow',legacyWindows:true,entryModes:['auto']}]};
    if(operation==='createRun')throw Object.assign(Error('history'),{code:'MARKET_HISTORY_INSUFFICIENT',status:409});
  });
  await assert.rejects(runtime.run('order-flow',{...params,analysisWindowCount:100,lookbackMs:86400000}),e=>e.code==='MARKET_HISTORY_INSUFFICIENT');
  assert.equal(calls.find(c=>c.operation==='marketSnapshot').payload.lookbackMs,86400000);
  assert.equal(calls.filter(c=>c.operation==='createRun').length,1);
});

test('new snapshots follow published server history and reject incompatible metadata before admission',async()=>{
  for(const history of [
    {minimumCandles:150,minimumClosedCandles:149,windowCount:150},
    {minimumCandles:150,minimumClosedCandles:150,windowCount:150},
    {minimumCandles:700,minimumClosedCandles:699,windowCount:700},
    {minimumCandles:90,minimumClosedCandles:90,windowCount:'91'},
  ]) {
    const {runtime,calls}=setup(({operation})=>{
      if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'moving-average-analysis',legacyWindows:true,entryModes:['auto'],history}]};
    });
    if(history.windowCount===150&&history.minimumClosedCandles===149){
      await runtime.run('moving-average-analysis',{...params,analysisWindowCount:100});
      assert.equal(calls.find(c=>c.operation==='marketSnapshot').payload.windowCount,150);
    }else{
      await assert.rejects(runtime.run('moving-average-analysis',{...params,analysisWindowCount:100}),e=>e.code==='CLOUD_HISTORY_REQUIREMENTS_INVALID');
      assert.equal(calls.some(c=>['marketSnapshot','createRun'].includes(c.operation)),false);
    }
  }
});

test('failed runs preserve bounded server error codes in string and object forms through resume',async()=>{
  for(const [serverError,code] of [
    ['ORDER_FLOW_DATA_UNAVAILABLE','ORDER_FLOW_DATA_UNAVAILABLE'],
    [{code:'MARKET_HISTORY_INSUFFICIENT'},'MARKET_HISTORY_INSUFFICIENT'],
    ['private upstream text with a token','CLOUD_ANALYSIS_FAILED'],
    [{code:'x'.repeat(200)},'CLOUD_ANALYSIS_FAILED'],
    [null,'CLOUD_ANALYSIS_FAILED'],
  ]) {
    const {runtime,calls}=setup(({operation,run})=>operation==='run'?{...run,state:'failed',error:serverError}:undefined);
    await assert.rejects(runtime.run('moving-average-analysis',params),e=>e.code===code&&!!e.runId);
    await assert.rejects(runtime.resume(params.analysisJobId),e=>e.code===code);
    assert.equal(calls.filter(c=>c.operation==='createRun').length,1);
  }
});

test('new runs require entry-mode and worker acceptance; legacy availability does not bypass either gate',async()=>{
  for(const [entryV2WorkerReady,entryModes,code] of [[false,['auto'],'ENTRY_WORKER_UNAVAILABLE'],[true,[],'ENTRY_POLICY_UNAVAILABLE']]) {
    const {runtime,calls}=setup(({operation})=>operation==='capabilities'?{windowsContract:'windows-v1',windowsWorkerReady:true,entryV2WorkerReady,
      strategies:[{id:'moving-average-analysis',legacyWindows:true,entryModes}]}:undefined);
    await assert.rejects(runtime.run('moving-average-analysis',params),e=>e.code===code);
    assert.equal(calls.some(c=>c.operation==='marketSnapshot'||c.operation==='createRun'),false);
  }
});

test('right compatibility requires its own worker and strategy gates without Entry V2 fallback',async()=>{
  for(const [rightLegacyWorkerReady,rightLegacy,code] of [[false,true,'ENTRY_WORKER_UNAVAILABLE'],[true,false,'ENTRY_POLICY_UNAVAILABLE']]) {
    const {runtime,calls}=setup(({operation})=>operation==='capabilities'?{windowsContract:'windows-v1',windowsWorkerReady:true,entryV2WorkerReady:true,rightLegacyWorkerReady,
      strategies:[{id:'moving-average-analysis',legacyWindows:true,rightLegacy,entryModes:['right']}]}:undefined);
    await assert.rejects(runtime.run('moving-average-analysis',{...params,entryMode:'right'}),e=>e.code===code);
    assert.equal(calls.some(c=>c.operation==='marketSnapshot'||c.operation==='createRun'),false);
  }
});

test('original thread and pane identities survive recovery without being accepted as server input',async()=>{
  const {runtime,calls}=setup();
  const result=await runtime.run('moving-average-analysis',{...params,sourceThreadId:'original-thread',storageSessionId:'original-pane'});
  assert.deepEqual(result.cloud.origin,{sourceThreadId:'original-thread',storageSessionId:'original-pane',analysisJobId:params.analysisJobId});
  assert.deepEqual((await runtime.resume(params.analysisJobId)).cloud.origin,result.cloud.origin);
  assert.equal(calls.find(c=>c.operation==='createRun').payload.origin,undefined);
});

test('an old journal entry resumes its frozen legacy protocol without new capability negotiation',async()=>{
  const body={clientContract:'windows-v1',clientRunId:'00000000-0000-0000-0000-000000000003',strategy:'moving-average-analysis',
    context:{taskId:'original-task'},preferencesRevision:3};
  const {runtime,journal,calls}=setup(({operation})=>operation==='run'?{...body,id:body.clientRunId,state:'succeeded',desktopResult:{
    ok:true,clientContract:'windows-v1',strategy:{id:'moving-average-analysis'},snapshot:{marketId:params.marketId,interval:params.interval},
    executionPlan:{schemaVersion:1},analysisPlan:{marketId:params.marketId,interval:params.interval,report:'Legacy',executionPlan:{schemaVersion:1}},
    cloud:{runId:body.clientRunId,context:body.context,appliedPreferences:{revision:3,configHash}}}}:undefined);
  await journal.put(account.ownerId,'legacy',{key:'legacy',runId:body.clientRunId,body,state:'prepared',preferencesHash:configHash,
    marketId:params.marketId,interval:params.interval});
  const result=await runtime.resume('legacy');
  assert.equal(result.executionPlan.schemaVersion,1);
  assert.ok(calls.every(c=>c.operation==='run'));
});

test('an uncertain admission is explicitly retried with identical body/key, without refetching a snapshot',async()=>{
  let once=true;
  const {runtime,calls}=setup(({operation})=>{if(operation==='createRun'&&once){once=false;throw Object.assign(Error('network'),{status:503});}});
  await assert.rejects(runtime.run('moving-average-analysis',params),/network/);
  const result=await runtime.run('moving-average-analysis',params);
  assert.equal(result.ok,true);
  const submissions=calls.filter(c=>c.operation==='createRun');
  assert.equal(submissions.length,2);
  assert.deepEqual(submissions[0].payload,submissions[1].payload);
  assert.equal(submissions[0].options.idempotencyKey,submissions[1].options.idempotencyKey);
  assert.equal(calls.filter(c=>c.operation==='marketSnapshot').length,1);
});

test('a pre-upgrade right Entry V2 admission retries the same paid job without capability negotiation',async()=>{
  let first=true;
  const {runtime,journal,calls}=setup(({operation,run})=>{
    if(operation==='createRun'&&first){first=false;throw Error('uncertain original admission');}
    if(operation==='run')return {...run,state:'cancelled'};
  });
  const input={windowCount:null,lookbackMs:null,strategyId:'moving-average-analysis',marketKey:'binance:usdm:BTCUSDT',interval:'1h',instruction:'分析当前行情',
    executionPolicy:'entry-v2',requestedEntryMode:'right',origin:{sourceThreadId:'',storageSessionId:'',analysisJobId:params.analysisJobId},
    visibleRange:null,analysisKind:'strategy',positionManagementRequested:false,analysisContext:null,locale:'zh-CN',modelId:null,
    explicitModelSelection:false,preferencesRevision:3,preferencesHash:configHash,responseMode:'combined'};
  const runId='00000000-0000-0000-0000-000000000009';
  const body={clientContract:'windows-v1',clientRunId:runId,executionPolicy:'entry-v2',context:{taskId:'old-task'},strategy:'moving-average-analysis',locale:'zh-CN',preferencesRevision:3};
  await journal.put(account.ownerId,params.analysisJobId,{key:params.analysisJobId,runId,state:'prepared',body,requestedEntryMode:'right',
    inputHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),preferencesHash:configHash,marketId:params.marketId,interval:params.interval});
  await assert.rejects(runtime.run('moving-average-analysis',{...params,entryMode:'right'}),/uncertain original admission/);
  await assert.rejects(runtime.run('moving-average-analysis',{...params,entryMode:'right'}),e=>e.code==='TRADING_ANALYSIS_CANCELLED');
  const submissions=calls.filter(c=>c.operation==='createRun');
  assert.equal(submissions.length,2);assert.deepEqual(submissions[0].payload,body);assert.deepEqual(submissions[1].payload,body);
  assert.equal(calls.some(c=>c.operation==='capabilities'||c.operation==='marketSnapshot'),false);
});

test('abort after an uncertain POST sends cancellation for the already journaled run ID',async()=>{
  const controller=new AbortController();
  const {runtime,calls}=setup(({operation})=>{if(operation==='createRun'){controller.abort();throw controller.signal.reason;}});
  await assert.rejects(runtime.run('moving-average-analysis',params,{signal:controller.signal}),e=>e.code==='TRADING_ANALYSIS_CANCELLED');
  const created=calls.find(c=>c.operation==='createRun'),cancelled=calls.find(c=>c.operation==='cancelRun');
  assert.equal(cancelled.payload.runId,created.payload.clientRunId);
  assert.equal(cancelled.options.signal,undefined);
});

test('a failed cancellation remains durable and is retried before any resume or new admission',async()=>{
  const controller=new AbortController();let failCancel=true;
  const {runtime,calls}=setup(({operation})=>{
    if(operation==='createRun'){controller.abort();throw controller.signal.reason;}
    if(operation==='cancelRun'&&failCancel)throw Error('offline');
  });
  await assert.rejects(runtime.run('moving-average-analysis',params,{signal:controller.signal}),e=>e.code==='CLOUD_CANCEL_PENDING');
  assert.equal((await runtime.pending())[0].cancelRequested,true);
  failCancel=false;
  await assert.rejects(runtime.resume(params.analysisJobId),e=>e.code==='TRADING_ANALYSIS_CANCELLED');
  assert.equal(calls.filter(c=>c.operation==='createRun').length,1);
});

test('an account switch while awaiting a response prevents result publication or new-account writes',async()=>{
  let state;
  state=setup(({operation})=>{if(operation==='run')state.setOwner({...account,ownerId:'other',accountId:'other'});});
  await assert.rejects(state.runtime.run('moving-average-analysis',params),e=>e.code==='TRADING_PREFERENCE_OWNER_CHANGED');
  assert.ok([...state.records.keys()].every(key=>key.startsWith(account.ownerId)));
  assert.equal(state.calls.filter(c=>c.operation==='cancelRun').length,0);
});

test('wrong chart or preference revision cannot become a rendered result',async()=>{
  const {runtime}=setup(({operation,run})=>operation==='run'?{...run,state:'succeeded',desktopResult:{ok:true,clientContract:'windows-v1',strategy:{id:'moving-average-analysis'},cloud:{runId:run.id,context:run.context,appliedPreferences:{revision:2,configHash}}}}:undefined);
  await assert.rejects(runtime.run('moving-average-analysis',params),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
});

test('unavailable cloud strategy never submits or invokes a local fallback',async()=>{
  const {runtime,calls}=setup();
  await assert.rejects(runtime.run('wave',params),e=>e.code==='WINDOWS_STRATEGY_UNSUPPORTED');
  assert.equal(calls.some(c=>c.operation==='createRun'),false);
  assert.throws(()=>cloudMarketContext({...params,marketId:'file:///private'}),e=>e.code==='CLOUD_MARKET_UNSUPPORTED');
});


test('cancelling after a server commit retains the result for recovery, never falsely reports cancellation',async()=>{
  const controller=new AbortController();
  const {runtime}=setup(({operation,payload})=>{
    if(operation==='createRun'){controller.abort();throw controller.signal.reason;}
    if(operation==='cancelRun')return {id:payload.runId,state:'succeeded'};
  });
  await assert.rejects(runtime.run('moving-average-analysis',params,{signal:controller.signal}),e=>e.code==='CLOUD_RUN_PENDING');
  assert.equal((await runtime.pending())[0].state,'succeeded');
});

test('resume fences uncertain admission on abort and rejects a simultaneous duplicate resume',async()=>{
  let first=true,hold,release; const controller=new AbortController();
  const {runtime,calls}=setup(async({operation})=>{
    if(operation==='createRun'&&first){first=false;throw Error('offline');}
    if(operation==='run'){if(hold)await hold;throw Object.assign(Error('absent'),{status:404});}
    if(operation==='createRun'){controller.abort();throw controller.signal.reason;}
  });
  await assert.rejects(runtime.run('moving-average-analysis',params),/offline/);
  hold=new Promise(resolve=>{release=resolve;});
  const pending=runtime.resume(params.analysisJobId,{signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(runtime.resume(params.analysisJobId),e=>e.code==='CLOUD_RUN_ALREADY_PENDING');
  release();
  await assert.rejects(pending,e=>e.code==='TRADING_ANALYSIS_CANCELLED');
  assert.equal(calls.filter(c=>c.operation==='cancelRun').length,1);
});
