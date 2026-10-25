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
function setup(handler, overrides={}) {
  const records=new Map(),calls=[];
  let current=account;
  const journal={async get(owner,key){return structuredClone(records.get(`${owner}:${key}`)??null);},async put(owner,key,value){records.set(`${owner}:${key}`,structuredClone(value));},async list(owner){return [...records].filter(([key])=>key.startsWith(`${owner}:`)).map(([,v])=>v);}};
  let run;
  const api={async tradingCloudRequest(operation,payload,options){
    calls.push({operation,payload:structuredClone(payload),options});
    const custom=await handler?.({operation,payload,options,get run(){return run;},set run(value){run=value;}});
    if(custom!==undefined)return custom;
    if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'moving-average-analysis',legacyWindows:true,entryModes:['left','right']}]};
    if(operation==='marketSnapshot')return {marketKey:'binance:usdm:BTCUSDT',interval:'1h',snapshotId:'00000000-0000-0000-0000-000000000001'};
    if(operation==='createRun') {
      run={...payload,id:payload.clientRunId,state:'running'};
      return run;
    }
    if(operation==='cancelRun'){if(run)run.state='cancelled';return {id:payload.runId,state:'cancelled'};}
    if(operation==='run'){
      const plan={schemaVersion:2,planId:'00000000-0000-0000-0000-000000000002',revision:1,policyVersion:'entry-v2.1',
        context:run.context,appliedPreferences:{revision:3,configHash},requestedMode:'right',selectedMode:null,scenarios:[],
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
  const runtime=createCloudStrategyRuntime({owner:async()=>current,api:()=>api,journal,wait:async()=>{},pollMs:0,...overrides});
  return {runtime,journal,calls,records,api,setOwner(value){current=value;}};
}

test('cloud admission freezes the selected label independently from the DeepSeek runtime',async()=>{
  for (const modelDisplayAlias of ['gpt-5.6-sol','gpt-6-astra','gpt-6-sol']) {
    const s=setup();
    const input={...params,model:'deepseek-flash',modelDisplayAlias};
    await s.runtime.run('moving-average-analysis',input);
    const admission=s.calls.find(c=>c.operation==='createRun').payload;
    assert.equal(admission.modelId,'deepseek-flash');
    assert.equal(admission.modelDisplayAlias,modelDisplayAlias);
    assert.equal((await s.journal.get(account.ownerId,params.analysisJobId)).body.modelDisplayAlias,modelDisplayAlias);
    await s.runtime.run('moving-average-analysis',input);
    assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
    await assert.rejects(s.runtime.run('moving-average-analysis',{...input,modelDisplayAlias:'deepseek-flash'}),
      e=>e.code==='CLOUD_RUN_ID_REUSED');
  }
});

test('429 progress reads back off on the original run and still deliver the validated result',async()=>{
  const waits=[];let reads=0;
  const s=setup(({operation,run})=>{
    if(operation==='run'&&++reads<=3)throw Object.assign(Error('busy'),{status:429,code:'MOBILE_BUSY',retryAfterMs:reads===2?7000:null});
  },{random:()=>0,wait:async ms=>{waits.push(ms);}});
  const result=await s.runtime.run('moving-average-analysis',params);
  assert.deepEqual(waits,[1000,7000,4000]);
  assert.equal(result.analysisPlan.report,'云端报告');
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  assert.equal(s.calls.filter(c=>c.operation==='cancelRun').length,0);
  assert.ok(s.calls.filter(c=>c.operation==='run').every(c=>c.payload.runId===result.cloud.runId));
  assert.equal((await s.journal.get(account.ownerId,params.analysisJobId)).state,'succeeded');
});

test('repeated 429 uses capped jittered backoff and a successful read resets it',async()=>{
  let reads=0;const waits=[];
  const s=setup(({operation,run})=>{
    if(operation!=='run')return;
    reads++;
    if(reads<=7||reads===9)throw Object.assign(Error('busy'),{status:429});
    if(reads===8)return run;
  },{random:()=>0.5,wait:async ms=>{waits.push(ms);}});
  await s.runtime.run('moving-average-analysis',params);
  assert.deepEqual(waits,[1125,2250,4500,9000,16875,16875,16875,0,1125]);
});

test('429 deadline preserves the journal and a later resume only reads the existing run',async()=>{
  let clock=0,busy=true;const waits=[];
  const s=setup(({operation})=>{
    if(operation==='run'&&busy)throw Object.assign(Error('busy'),{status:429,retryAfterMs:60000});
  },{now:()=>clock,random:()=>0,timeoutMs:5000,wait:async ms=>{waits.push(ms);clock+=ms;}});
  await assert.rejects(s.runtime.run('moving-average-analysis',params),e=>e.code==='CLOUD_RUN_PENDING'&&e.retryable===true&&!!e.runId);
  assert.deepEqual(waits,[5000]);
  const saved=await s.journal.get(account.ownerId,params.analysisJobId);
  assert.equal(saved.state,'running');assert.equal(saved.cancelRequested,undefined);
  assert.equal((await s.runtime.pending())[0].runId,saved.runId);
  busy=false;
  const recovered=createCloudStrategyRuntime({owner:async()=>account,api:()=>s.api,journal:s.journal,
    now:()=>clock,wait:async()=>{},pollMs:0});
  assert.equal((await recovered.resume(params.analysisJobId)).cloud.runId,saved.runId);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  assert.equal(s.calls.filter(c=>c.operation==='cancelRun').length,0);
});

test('prepared admission recovery also tolerates status 429 without replaying POST',async()=>{
  let admission=true,reads=0;
  const s=setup(ctx=>{
    if(ctx.operation==='createRun'&&admission){admission=false;ctx.run={...ctx.payload,id:ctx.payload.clientRunId,state:'running'};throw Error('lost admission response');}
    if(ctx.operation==='run'&&++reads===1)throw Object.assign(Error('busy'),{status:429});
  },{random:()=>0});
  await assert.rejects(s.runtime.run('moving-average-analysis',params),/lost admission response/);
  assert.equal((await s.runtime.resume(params.analysisJobId)).ok,true);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
});

test('cancellation and owner changes during 429 backoff cannot resume result publication',async()=>{
  for(const action of ['cancel','owner']) {
    const controller=new AbortController();let s;
    s=setup(({operation})=>{if(operation==='run')throw Object.assign(Error('busy'),{status:429});},
      {random:()=>0,wait:async(_ms,_value,{signal})=>{
        if(action==='cancel'){controller.abort();signal.throwIfAborted();}
        else s.setOwner({...account,ownerId:'other',accountId:'other'});
      }});
    await assert.rejects(s.runtime.run('moving-average-analysis',params,{signal:controller.signal}),
      e=>e.code===(action==='cancel'?'TRADING_ANALYSIS_CANCELLED':'TRADING_PREFERENCE_OWNER_CHANGED'));
    assert.equal(s.calls.filter(c=>c.operation==='run').length,1);
    assert.equal(s.calls.filter(c=>c.operation==='cancelRun').length,action==='cancel'?1:0);
    assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  }
});

test('429 retry does not hide authentication errors, terminal failures or invalid results',async()=>{
  for(const status of [401,403,404,429]) {
    const s=setup(({operation})=>{if(operation==='run')throw Object.assign(Error('permanent'),{status,retryable:false});});
    await assert.rejects(s.runtime.run('moving-average-analysis',params),/permanent/);
    assert.equal(s.calls.filter(c=>c.operation==='run').length,1);
  }
  for(const terminalState of ['failed','cancelled','mismatch']) {
    let reads=0;
    const s=setup(({operation,run})=>{
      if(operation!=='run')return;
      if(++reads===1)throw Object.assign(Error('busy'),{status:429});
      return terminalState==='mismatch'?{...run,id:'wrong',state:'succeeded'}:{...run,state:terminalState,error:'MODEL_TIMEOUT'};
    },{random:()=>0});
    await assert.rejects(s.runtime.run('moving-average-analysis',params),
      e=>e.code===({failed:'MODEL_TIMEOUT',cancelled:'TRADING_ANALYSIS_CANCELLED',mismatch:'CLOUD_RESULT_CONTEXT_INVALID'}[terminalState]));
    assert.equal(s.calls.filter(c=>c.operation==='run').length,2);
  }
});

test('429 on submitting a new run is not automatically replayed',async()=>{
  const s=setup(({operation})=>{if(operation==='createRun')throw Object.assign(Error('busy admission'),{status:429});});
  await assert.rejects(s.runtime.run('moving-average-analysis',params),/busy admission/);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  assert.equal(s.calls.filter(c=>c.operation==='run').length,0);
});

test('pure analysis wakes on events then validates the full result; normal and resumed runs retain polling',async()=>{
  for(const pure of [true,false]) {
    let reads=0,streams=0,waits=0;
    const s=setup(({operation,run})=>operation==='run'&&++reads===1?run:undefined,{wait:async()=>{waits++;}});
    s.api.waitForTradingCloudRunEvent=async(_id,options)=>{streams++;assert.equal(options.expectedAccountId,account.accountId);return {cursor:4,completed:true};};
    const result=await s.runtime.run('moving-average-analysis',{...params,pureReferenceAnalysis:pure});
    assert.equal(result.analysisPlan.report,'云端报告');assert.equal(reads,2);
    assert.equal(streams,pure?1:0);assert.equal(waits,1);
    assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
    assert.equal(s.calls.find(c=>c.operation==='createRun').payload.pureReferenceAnalysis,undefined);
    await s.runtime.resume(params.analysisJobId);assert.equal(streams,pure?1:0);
  }
});

test('missing, broken or prematurely ended streams immediately read status and then resume existing polling',async()=>{
  for(const failure of [404,503,'eof','malformed']) {
    let reads=0,streams=0,waits=0;
    const s=setup(({operation,run})=>operation==='run'&&++reads<=2?run:undefined,{wait:async()=>{waits++;}});
    s.api.waitForTradingCloudRunEvent=async()=>{streams++;if(failure==='eof')return {cursor:0,completed:false};throw Object.assign(Error('stream'),{status:failure});};
    assert.equal((await s.runtime.run('moving-average-analysis',{...params,pureReferenceAnalysis:true})).ok,true);
    assert.equal(streams,1);assert.equal(waits,2);assert.equal(reads,3);assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  }
});

test('healthy bounded streams reconnect from their cursor, not from the beginning',async()=>{
  let reads=0;const cursors=[];
  const s=setup(({operation,run})=>operation==='run'&&++reads<3?run:undefined);
  s.api.waitForTradingCloudRunEvent=async(_id,options)=>{cursors.push(options.after);return {cursor:7,expired:cursors.length===1,completed:cursors.length===2};};
  await s.runtime.run('moving-average-analysis',{...params,pureReferenceAnalysis:true});assert.deepEqual(cursors,[0,7]);
});

test('a buffering stream cannot delay canonical polling and closes when the canonical result arrives',async()=>{
  let reads=0,streams=0,ticks=0,closed=false;
  const s=setup(({operation,run})=>operation==='run'&&++reads<3?run:undefined,{wait:async(ms)=>{assert.equal(ms,0);ticks++;}});
  s.api.waitForTradingCloudRunEvent=(_id,{signal})=>{streams++;return new Promise(resolve=>signal.addEventListener('abort',()=>{closed=true;resolve({cursor:0});},{once:true}));};
  await s.runtime.run('moving-average-analysis',{...params,pureReferenceAnalysis:true});
  assert.equal(reads,3);assert.equal(ticks,2);assert.equal(streams,1);assert.equal(closed,true);
});

test('event completion never bypasses run identity validation',async()=>{
  let reads=0;
  const s=setup(({operation,run})=>operation==='run'?(++reads===1?run:{...run,id:'wrong',state:'succeeded'}):undefined);
  s.api.waitForTradingCloudRunEvent=async()=>({cursor:1,completed:true});
  await assert.rejects(s.runtime.run('moving-average-analysis',{...params,pureReferenceAnalysis:true}),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
});

test('stop and account changes during an event wait cannot resume polling or replay admission',async()=>{
  for(const change of ['stop','owner']) {
    const controller=new AbortController();const s=setup(({operation,run})=>operation==='run'?run:undefined);
    s.api.waitForTradingCloudRunEvent=async()=>{if(change==='stop')controller.abort();else s.setOwner({...account,ownerId:'other'});throw Error('disconnected');};
    await assert.rejects(s.runtime.run('moving-average-analysis',{...params,pureReferenceAnalysis:true},{signal:controller.signal}),
      e=>e.code===(change==='stop'?'TRADING_ANALYSIS_CANCELLED':'TRADING_PREFERENCE_OWNER_CHANGED'));
    assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);assert.equal(s.calls.filter(c=>c.operation==='run').length,1);
  }
});

test('only pure analysis overlaps snapshot and account reads, and never admits until both complete',async()=>{
  for(const pure of [true,false]) {
    let release,readStarted=false,accountStarted=false;
    const gate=new Promise(r=>release=r);
    const s=setup(async({operation})=>{if(operation==='marketSnapshot'){readStarted=true;await gate;}},
      {connection:async()=>{accountStarted=true;return {id:'bound-account'};}});
    const pending=s.runtime.run('moving-average-analysis',{...params,pureReferenceAnalysis:pure});
    await new Promise(r=>setImmediate(r));assert.equal(readStarted,true);assert.equal(accountStarted,pure);
    assert.equal(s.calls.some(c=>c.operation==='createRun'),false);release();await pending;
    assert.equal(s.calls.find(c=>c.operation==='createRun').payload.connectionId,'bound-account');
  }
});

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

test('Wyckoff delegates default history, preserving explicit lookbacks and frozen retries',async()=>{
  for(const lookbackMs of [undefined,86400000]) {
    let first=true;
    const {runtime,calls}=setup(({operation,run})=>{
      if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'wyckoff',legacyWindows:true,entryModes:['right']}]};
      if(operation==='createRun'&&first){first=false;throw Object.assign(Error('unknown admission'),{status:503});}
      if(operation==='run')return {...run,state:'cancelled'};
    });
    const input={...params,analysisWindowCount:100,...(lookbackMs?{lookbackMs}:{})};
    await assert.rejects(runtime.run('wyckoff',input),/unknown admission/);
    await assert.rejects(runtime.run('wyckoff',input),e=>e.code==='TRADING_ANALYSIS_CANCELLED');
    const requests=calls.filter(c=>c.operation==='marketSnapshot');
    assert.equal(requests.length,1);
    assert.equal(requests[0].payload.windowCount,100);
    assert.equal(requests[0].payload.preferredWindowCount,undefined);
    assert.equal(requests[0].payload.analysisStrategy,'wyckoff');
    if(lookbackMs)assert.equal(requests[0].payload.lookbackMs,lookbackMs);
  }
});

test('Chart patterns delegates default history, preserving explicit lookbacks and frozen retries',async()=>{
  for(const lookbackMs of [undefined,86400000]) {
    let first=true;
    const {runtime,calls}=setup(({operation,run})=>{
      if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'chart-patterns',legacyWindows:true,entryModes:['right']}]};
      if(operation==='createRun'&&first){first=false;throw Object.assign(Error('unknown admission'),{status:503});}
      if(operation==='run')return {...run,state:'cancelled'};
    });
    const input={...params,analysisWindowCount:100,...(lookbackMs?{lookbackMs}:{})};
    await assert.rejects(runtime.run('chart-patterns',input),/unknown admission/);
    await assert.rejects(runtime.run('chart-patterns',input),e=>e.code==='TRADING_ANALYSIS_CANCELLED');
    const requests=calls.filter(c=>c.operation==='marketSnapshot');
    assert.equal(requests.length,1);
    assert.equal(requests[0].payload.windowCount,100);
    assert.equal(requests[0].payload.preferredWindowCount,undefined);
    assert.equal(requests[0].payload.analysisStrategy,'chart-patterns');
    if(lookbackMs)assert.equal(requests[0].payload.lookbackMs,lookbackMs);
  }
});

test('zoom changes cannot replace the frozen body after an unknown default-window admission',async()=>{
  let first=true;
  const {runtime,calls}=setup(({operation})=>{
    if(operation==='createRun'&&first){first=false;throw Error('unknown admission');}
  });
  await assert.rejects(runtime.run('moving-average-analysis',{...params,candles:Array(100).fill({time:1})}),/unknown admission/);
  await runtime.run('moving-average-analysis',{...params,candles:Array(600).fill({time:2})});
  const snapshots=calls.filter(c=>c.operation==='marketSnapshot');
  assert.equal(snapshots.length,1);assert.equal(snapshots[0].payload.windowCount,undefined);
  const admissions=calls.filter(c=>c.operation==='createRun');
  assert.deepEqual(admissions[0].payload,admissions[1].payload);
  assert.equal(admissions[0].options.idempotencyKey,admissions[1].options.idempotencyKey);
});

test('host repairs undersized explicit counts before admission without changing frozen retries',async()=>{
  for(const strategyId of ['order-flow','dow-theory']) {
    let first=true;
    const {runtime,calls}=setup(({operation,run})=>{
      if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:strategyId,legacyWindows:true,entryModes:['right']}]};
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
    if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'order-flow',legacyWindows:true,entryModes:['right']}]};
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
      if(operation==='capabilities')return {windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',strategies:[{id:'moving-average-analysis',legacyWindows:true,entryModes:['right'],history}]};
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
  for(const [entryV2WorkerReady,entryModes,code] of [[false,['right'],'ENTRY_WORKER_UNAVAILABLE'],[true,[],'ENTRY_POLICY_UNAVAILABLE']]) {
    const {runtime,calls}=setup(({operation})=>operation==='capabilities'?{windowsContract:'windows-v1',windowsWorkerReady:true,entryV2WorkerReady,
      strategies:[{id:'moving-average-analysis',legacyWindows:true,entryModes}]}:undefined);
    await assert.rejects(runtime.run('moving-average-analysis',params),e=>e.code===code);
    assert.equal(calls.some(c=>c.operation==='marketSnapshot'||c.operation==='createRun'),false);
  }
});

test('new right-side requests use Entry V2 regardless of retired legacy readiness',async()=>{
  for(const [rightLegacyWorkerReady,rightLegacy] of [[false,true],[true,false]]) {
    const {runtime,calls}=setup(({operation})=>operation==='capabilities'?{windowsContract:'windows-v1',windowsWorkerReady:true,entryV2WorkerReady:true,rightLegacyWorkerReady,
      strategies:[{id:'moving-average-analysis',legacyWindows:true,rightLegacy,entryModes:['right']}]}:undefined);
    await runtime.run('moving-average-analysis',{...params,entryMode:'right'});
    assert.equal(calls.find(c=>c.operation==='createRun').payload.executionPolicy,'entry-v2');
  }
});

test('automatic mode cannot start a new analysis',async()=>{
  const {runtime,calls}=setup();
  await assert.rejects(runtime.run('moving-average-analysis',{...params,entryMode:'auto'}),e=>e.code==='ENTRY_MODE_INVALID');
  assert.equal(calls.length,0);
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

for(const policy of ['entry-v2','right-legacy-v1'])test(`a pre-upgrade ${policy} right admission retries its paid job without capability negotiation`,async()=>{
  let first=true;
  const {runtime,journal,calls}=setup(({operation,run})=>{
    if(operation==='createRun'&&first){first=false;throw Error('uncertain original admission');}
    if(operation==='run')return {...run,state:'cancelled'};
  });
  const input={windowCount:null,lookbackMs:null,strategyId:'moving-average-analysis',marketKey:'binance:usdm:BTCUSDT',interval:'1h',instruction:'分析当前行情',
    executionPolicy:policy,requestedEntryMode:'right',origin:{sourceThreadId:'',storageSessionId:'',analysisJobId:params.analysisJobId},
    visibleRange:null,analysisKind:'strategy',positionManagementRequested:false,analysisContext:null,locale:'zh-CN',modelId:null,
    explicitModelSelection:false,preferencesRevision:3,preferencesHash:configHash,responseMode:'combined'};
  const runId='00000000-0000-0000-0000-000000000009';
  const body={clientContract:'windows-v1',clientRunId:runId,executionPolicy:policy,context:{taskId:'old-task'},strategy:'moving-average-analysis',locale:'zh-CN',preferencesRevision:3};
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

// M1-139 / M1-445: the Worker owns durable market retries; the client only
// observes the original run and pauses its execution clock while queued.
test('durable market waiting survives three hours and resumes the original run without admission replay',async()=>{
  let clock=100000,reads=0;const progress=[],pauses=[];
  const s=setup(({operation,run})=>{
    if(operation!=='run')return;
    reads++;
    if(reads<=2160)return {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:clock+300000,attempt:reads},progress:[{stage:'market_waiting'}]};
    if(reads===2161)return {...run,state:'running',marketRecovery:{state:'resuming'},progress:[{stage:'market_waiting'}]};
  },{now:()=>clock,timeoutMs:1000,pollMs:50,wait:async ms=>{pauses.push(ms);clock+=ms;}});
  const result=await s.runtime.run('moving-average-analysis',params,{onProgress:p=>progress.push(p.stage)});
  assert.equal(result.ok,true);assert.equal(clock,10900050);
  assert.ok(pauses.every(ms=>ms<=5000));
  assert.deepEqual(progress,['market_ready','market_waiting','market_resuming']);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  assert.equal(s.calls.filter(c=>c.operation==='marketSnapshot').length,1);
  assert.ok(s.calls.filter(c=>c.operation==='run').every(c=>c.payload.runId===result.cloud.runId));
});

test('market retryAt clock skew and past timestamps do not bypass bounded status checks',async()=>{
  for(const skew of [-3600000,3600000]) {
    let clock=7200000,reads=0;const waits=[];
    const s=setup(({operation,run})=>operation==='run'&&++reads<=4
      ? {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:clock+skew,attempt:1}}:undefined,
      {now:()=>clock,timeoutMs:100,wait:async ms=>{waits.push(ms);clock+=ms;}});
    assert.equal((await s.runtime.run('moving-average-analysis',params)).ok,true);
    assert.ok(waits.every(ms=>ms>=1000&&ms<=5000));
  }
});

test('waiting progress text and malformed recovery never disable the execution timeout',async()=>{
  for(const recovery of [undefined,{state:'waiting',retryAt:'999999',attempt:1},{state:'waiting',retryAt:999999,attempt:0}]) {
    let clock=0;
    const s=setup(({operation,run})=>operation==='run'?{...run,state:'queued',marketRecovery:recovery,progress:[{stage:'market_waiting'}]}:undefined,
      {now:()=>clock,timeoutMs:100,pollMs:100,wait:async ms=>clock+=ms});
    await assert.rejects(s.runtime.run('moving-average-analysis',params),e=>e.code==='CLOUD_RUN_PENDING');
    assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  }
});

test('the execution timeout resumes after a durable wait instead of remaining infinite',async()=>{
  let clock=0,reads=0;
  const s=setup(({operation,run})=>{
    if(operation!=='run')return;
    if(++reads<=3)return {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:100000,attempt:1}};
    return {...run,state:'running',marketRecovery:{state:'resuming'}};
  },{now:()=>clock,timeoutMs:1000,pollMs:500,wait:async ms=>clock+=ms});
  await assert.rejects(s.runtime.run('moving-average-analysis',params),e=>e.code==='CLOUD_RUN_PENDING');
  assert.equal(clock,16000);assert.equal(reads,5);
});

test('cancellation, account changes and terminal outcomes remain authoritative during durable market waiting',async()=>{
  for(const action of ['cancel','owner','failed']) {
    let clock=0,reads=0;const controller=new AbortController();let s;
    s=setup(({operation,run})=>{
      if(operation!=='run')return;
      if(++reads>1&&action==='failed')return {...run,state:'failed',error:'CONSENT_REVOKED',marketRecovery:{state:'waiting',retryAt:999999,attempt:1}};
      return {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:999999,attempt:1}};
    },{now:()=>clock,timeoutMs:100,wait:async(ms)=>{
      clock+=ms;if(action==='cancel')controller.abort();if(action==='owner')s.setOwner({...account,ownerId:'other'});
    }});
    await assert.rejects(s.runtime.run('moving-average-analysis',params,{signal:controller.signal}),
      e=>e.code===({cancel:'TRADING_ANALYSIS_CANCELLED',owner:'TRADING_PREFERENCE_OWNER_CHANGED',failed:'CONSENT_REVOKED'}[action]));
    assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
    assert.equal(s.calls.filter(c=>c.operation==='cancelRun').length,action==='cancel'?1:0);
  }
});

test('a restarted client observes the same durable waiting run and cannot create another analysis',async()=>{
  let waiting=false,reads=0,clock=1000;
  const s=setup(({operation,run})=>{
    if(operation!=='run')return;
    if(!waiting)throw Object.assign(Error('restart'),{code:'FIXTURE_RESTART'});
    if(++reads<=3)return {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:999999,attempt:1}};
  });
  await assert.rejects(s.runtime.run('moving-average-analysis',params),/restart/);
  waiting=true;
  const resumed=createCloudStrategyRuntime({owner:async()=>account,api:()=>s.api,journal:s.journal,
    now:()=>clock,timeoutMs:100,wait:async ms=>clock+=ms});
  assert.equal((await resumed.resume(params.analysisJobId)).ok,true);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  assert.equal(s.calls.filter(c=>c.operation==='marketSnapshot').length,1);
});

test('429 while observing durable waiting uses interruptible server cooldown without consuming execution budget',async()=>{
  let clock=1000,reads=0;const waits=[];
  const s=setup(({operation,run})=>{
    if(operation!=='run')return;
    if(++reads===1)return {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:999999,attempt:1}};
    if(reads===2)throw Object.assign(Error('status busy'),{status:429,retryAfterMs:900000});
  },{random:()=>0,now:()=>clock,timeoutMs:100,wait:async ms=>{waits.push(ms);clock+=ms;}});
  assert.equal((await s.runtime.run('moving-average-analysis',params)).ok,true);
  assert.equal(waits.reduce((a,b)=>a+b,0),905000);assert.ok(waits.every(ms=>ms<=5000));
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
});
test('temporary status transport failures cannot end a known durable market wait',async()=>{
  let clock=1000,reads=0;const waits=[];
  const s=setup(({operation,run})=>{
    if(operation!=='run')return;
    if(++reads===1)return {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:999999,attempt:1}};
    if(reads===2)throw Object.assign(Error('temporary API outage'),{status:503});
    if(reads===3)throw Object.assign(Error('connection reset'),{code:'ECONNRESET'});
  },{random:()=>0,now:()=>clock,timeoutMs:100,wait:async ms=>{waits.push(ms);clock+=ms;}});
  assert.equal((await s.runtime.run('moving-average-analysis',params)).ok,true);
  assert.deepEqual(waits,[5000,1000,2000]);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
});

test('temporary status outages during market recovery transitions retry the same run within the execution deadline',async()=>{
  let clock=1000,reads=0;const waits=[];
  const s=setup(({operation,run})=>{
    if(operation!=='run')return;
    reads++;
    if(reads===1||reads===5)return {...run,state:'queued',marketRecovery:{state:'waiting',retryAt:999999,attempt:reads===1?1:2}};
    if(reads===2)return {...run,state:'running',marketRecovery:{state:'resuming'}};
    if(reads===3)throw Object.assign(Error('status unavailable before next wait is visible'),{status:503});
    if(reads===4)throw Object.assign(Error('status transport reset'),{code:'ECONNRESET'});
  },{random:()=>0,now:()=>clock,timeoutMs:4000,wait:async ms=>{waits.push(ms);clock+=ms;}});
  assert.equal((await s.runtime.run('moving-average-analysis',params)).ok,true);
  assert.deepEqual(waits,[5000,0,1000,2000,5000]);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  assert.equal(s.calls.filter(c=>c.operation==='marketSnapshot').length,1);
});

test('an unknown market wait cannot make a status outage disable the execution deadline',async()=>{
  let clock=0;
  const s=setup(({operation})=>{if(operation==='run')throw Object.assign(Error('status down'),{status:503});},
    {random:()=>0,now:()=>clock,timeoutMs:2500,wait:async ms=>clock+=ms});
  await assert.rejects(s.runtime.run('moving-average-analysis',params),e=>e.code==='CLOUD_RUN_PENDING');
  assert.equal(clock,2500);
  assert.equal(s.calls.filter(c=>c.operation==='createRun').length,1);
  const record=await s.journal.get(account.ownerId,params.analysisJobId);
  assert.equal(record.state,'running');assert.equal(record.cancelRequested,undefined);
});
