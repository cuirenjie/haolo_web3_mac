import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createCloudStrategyRuntime} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {marketRecoveryPolicy,readMarketWhenAvailable} from '../src/main/trading-strategy-runtime/market-recovery.mjs';
import {marketRecoveryProgressMessage} from '../src/shared/market-recovery-progress.mjs';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';

const hash='a'.repeat(64);
const owner={ownerId:'isolated-owner',accountId:'isolated-owner',baseUrl:'https://example.invalid'};
const params={analysisJobId:'market-recovery-test',marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',
  preferencesRevision:1,preferencesHash:hash,analysisWindowCount:100};
const page={marketKey:'binance:usdm:BTCUSDT',interval:'1h',snapshotId:'00000000-0000-0000-0000-000000000001'};
const busy=(extra={})=>Object.assign(new Error('MARKET_UNAVAILABLE'),{status:429,code:'MARKET_UNAVAILABLE',retryable:true,...extra});
function fixture({read,wait,connection,timeoutMs=600000}={}) {
  const calls=[],writes=[],progress=[],waits=[];let current=owner,run,clock=0;
  const api={async tradingCloudRequest(operation,payload,options) {
    calls.push({operation,payload,options});
    if(operation==='capabilities')return {windowsContract:'windows-v1',windowsWorkerReady:true,entryV2WorkerReady:true,
      strategies:[{id:'harmonic',legacyWindows:true,entryModes:['left','right']}]};
    if(operation==='marketSnapshot')return await read?.(calls.filter(c=>c.operation===operation).length,options) ?? page;
    if(operation==='createRun'){run={...payload,id:payload.clientRunId,state:'running'};return run;}
    if(operation==='run') {
      const plan={schemaVersion:2,planId:'00000000-0000-0000-0000-000000000002',revision:1,policyVersion:'entry-v2.1',
        context:run.context,appliedPreferences:{revision:1,configHash:hash},requestedMode:'right',selectedMode:null,scenarios:[],
        outcome:{capability:'supported',candidateStatus:'none',evaluationStatus:'completed',action:'wait',reason:'NO_CANDIDATE'}};
      return {...run,state:'succeeded',desktopResult:{ok:true,clientContract:'windows-v1',strategy:{id:'harmonic'},
        snapshot:{marketId:params.marketId,interval:params.interval},executionPlan:plan,
        analysisPlan:{analysisId:'analysis',marketId:params.marketId,interval:params.interval,report:'verified result',executionPlan:plan,
          drawingPatch:{analysisId:'analysis',marketId:params.marketId,interval:params.interval,operations:[]}},
        cloud:{runId:run.id,context:run.context,appliedPreferences:{revision:1,configHash:hash},executionPolicy:'entry-v2',locale:run.locale,
          resultHash:'b'.repeat(64),planIds:[],planRecords:[],conditionReceipts:[]}}};
    }
    throw new Error('Unexpected operation '+operation);
  }};
  const runtime=createCloudStrategyRuntime({owner:async()=>current,api:()=>api,connection,random:()=>0,now:()=>clock,timeoutMs,
    wait:async(ms,value,options)=>{waits.push(ms);await wait?.(ms,options);clock+=ms;},
    journal:{async get(){return null},async put(...args){writes.push(args)},async list(){return []}}});
  return {runtime,calls,writes,progress,waits,setOwner:value=>current=value,
    run:options=>runtime.run('harmonic',params,{onProgress:p=>progress.push(p),...options})};
}

test('quota waits beyond ten minutes, obtains fresh snapshot, then admits exactly one harmonic analysis',async()=>{
  const f=fixture({timeoutMs:10,read:async attempt=>{if(attempt<4)throw busy({retryAfterMs:300000});}});
  const result=await f.run();
  assert.equal(f.waits.reduce((a,b)=>a+b,0),900000);
  assert.ok(f.waits.every(ms=>ms<=5000));
  assert.equal(f.calls.filter(c=>c.operation==='createRun').length,1);
  assert.equal(f.calls.filter(c=>c.operation==='marketSnapshot').length,4);
  assert.ok(f.calls.filter(c=>c.operation==='marketSnapshot').every(c=>c.payload.purpose==='analysis'));
  assert.equal(f.calls.find(c=>c.operation==='createRun').payload.context.snapshotId,page.snapshotId);
  assert.equal(result.analysisPlan.report,'verified result');
  assert.deepEqual(f.progress.map(p=>p.stage),['market_quota_wait','market_quota_wait','market_quota_wait','market_ready']);
});

test('transient transport and service failures recover without duplicating admission',async()=>{
  const failures=[Object.assign(Error('offline'),{code:'ECONNRESET'}),Object.assign(Error('timeout'),{code:'REQUEST_TIMEOUT'}),busy({status:503})];
  const f=fixture({read:async attempt=>{if(attempt<=failures.length)throw failures[attempt-1];}});
  await f.run();assert.deepEqual(f.waits,[1000,2000,4000]);
  assert.equal(f.calls.filter(c=>c.operation==='createRun').length,1);
  assert.ok(f.progress.slice(0,-1).every(p=>p.stage==='market_connection_wait'));
});

test('a long upstream cooldown is not shortened and cancellation clears all pre-admission work',async()=>{
  const controller=new AbortController();let f;
  f=fixture({read:async()=>{throw busy({status:418,retryAfterMs:86400000});},wait:async()=>{
    assert.equal(f.writes.length,0);assert.equal(f.calls.some(c=>c.operation==='createRun'),false);controller.abort();
  }});
  await assert.rejects(f.run({signal:controller.signal}),e=>e.name==='AbortError');
  assert.equal(f.calls.filter(c=>c.operation==='marketSnapshot').length,1);
  assert.equal(f.progress[0].retryAfterMs,86400000);
  assert.deepEqual(f.waits,[5000]);
});

test('changing account during cooldown stops the old task before another HTTP request',async()=>{
  let f;f=fixture({read:async()=>{throw busy({retryAfterMs:30000});},wait:async()=>f.setOwner({...owner,ownerId:'other'})});
  await assert.rejects(f.run(),e=>e.code==='TRADING_PREFERENCE_OWNER_CHANGED');
  assert.equal(f.calls.filter(c=>c.operation==='marketSnapshot').length,1);assert.equal(f.writes.length,0);
});

test('account binding is refreshed after market waiting before the only admission',async()=>{
  let connections=0;
  const f=fixture({read:async attempt=>{if(attempt===1)throw busy();},connection:async()=>({id:++connections===1?'old-binding':'fresh-binding'})});
  await f.runtime.run('harmonic',{...params,pureReferenceAnalysis:true});
  assert.equal(connections,2);
  assert.equal(f.calls.find(c=>c.operation==='createRun').payload.connectionId,'fresh-binding');
});

test('failed parallel binding read cancels the outstanding snapshot wait',async()=>{
  let release,aborts=0;
  const waiting=new Promise(resolve=>release=resolve);
  const f=fixture({read:async()=>{throw busy({retryAfterMs:30000});},
    connection:async()=>{await waiting;throw Object.assign(Error('binding unavailable'),{status:403});},
    wait:async(_ms,{signal})=>new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>{aborts++;reject(signal.reason);},{once:true});release();
    })});
  await assert.rejects(f.runtime.run('harmonic',{...params,pureReferenceAnalysis:true}),/binding unavailable/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(aborts,1);assert.equal(f.writes.length,0);
});

for(const failure of [
  {status:401,code:'AUTH_REQUIRED'},{status:403,code:'PERMISSION_DENIED'},
  {status:402,code:'ANALYSIS_CREDITS_REQUIRED'},{status:429,code:'MODEL_MEMBERSHIP_REQUIRED'},
  {status:500,code:'MARKET_INVALID'},{status:503,code:'MARKET_HISTORY_INSUFFICIENT'},
  {status:422,code:'MARKET_UNSUPPORTED'},{status:429,code:'MARKET_UNAVAILABLE',retryable:false},
])test(`nonrecoverable ${failure.code}/${failure.status} never waits or creates analysis`,async()=>{
  const error=Object.assign(new Error(failure.code),failure);
  const f=fixture({read:async()=>{throw error;}});
  await assert.rejects(f.run(),e=>e===error);assert.equal(f.waits.length,0);assert.equal(f.writes.length,0);
});

test('same job cannot start again while waiting and is released after cancellation',async()=>{
  let entered,hold=true;const gate=new Promise(resolve=>entered=resolve);const controller=new AbortController();
  const f=fixture({read:async()=>{if(hold)throw busy();},wait:async(_ms,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered();
  })});
  const first=f.run({signal:controller.signal});await gate;
  await assert.rejects(f.run(),e=>e.code==='CLOUD_RUN_ALREADY_PENDING');
  controller.abort();await assert.rejects(first,e=>e.name==='AbortError');hold=false;
  await f.run();assert.equal(f.calls.filter(c=>c.operation==='createRun').length,1);
});

test('policy handles new quota detail, bounded backoff and malformed Retry-After',async()=>{
  assert.deepEqual(marketRecoveryPolicy({detail:{code:'BINANCE_BUDGET_DEFERRED',retryAfterMs:16000}}),{stage:'market_quota_wait',retryAfterMs:16000});
  assert.equal(marketRecoveryPolicy(busy({message:'行情额度不足，请等待恢复。'})).stage,'market_quota_wait');
  assert.equal(marketRecoveryPolicy(busy({code:'ANALYSIS_CREDITS_REQUIRED',message:'分析积分不足'})),null);
  for(const raw of [-1,NaN,Infinity,Number.MAX_VALUE])assert.equal(marketRecoveryPolicy(busy({retryAfterMs:raw})).retryAfterMs,0);
  let attempts=0;const pauses=[];
  await readMarketWhenAvailable({read:async()=>{if(++attempts<9)throw busy();return page;},
    assertOwner:async()=>{},wait:async()=>{},random:()=>1,onProgress:p=>{if(p.retryAfterMs)pauses.push(p.retryAfterMs);}});
  assert.deepEqual(pauses,[1250,2500,5000,10000,20000,37500,37500,37500]);
});

test('real HTTP SDK preserves the snapshot purpose and Retry-After through recovery',{timeout:5000},async t=>{
  const requests=[],waits=[];
  const server=http.createServer((req,res)=>{
    requests.push({url:req.url,method:req.method});res.setHeader('Content-Type','application/json');
    if(requests.length===1){res.writeHead(429,{'Retry-After':'16'});res.end(JSON.stringify({detail:{code:'MARKET_UNAVAILABLE'}}));}
    else res.end(JSON.stringify(page));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const api=new YouleApiClient({serviceFetch:fetch});Object.assign(api,{loaded:true,baseUrl,profile:{id:'test-account'},token:'isolated-fixture-token'});
  const result=await readMarketWhenAvailable({read:()=>api.tradingCloudRequest('marketSnapshot',{
    market:page.marketKey,interval:'1h',limit:600,windowCount:100,purpose:'analysis'}),
    assertOwner:async()=>{},wait:async ms=>waits.push(ms),random:()=>0});
  assert.deepEqual(result.snapshot,page);assert.equal(waits.reduce((a,b)=>a+b,0),16000);
  assert.equal(requests.length,2);assert.ok(requests.every(r=>r.method==='GET'&&new URL(r.url,baseUrl).searchParams.get('purpose')==='analysis'));
});

test('actual renderer progress handler shows waiting and recovery in all three languages',()=>{
  const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);let callback;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='api.onTradingStrategyProgress')callback=node.arguments[0];ts.forEachChild(node,visit);}visit(ast);
  assert.ok(callback);const compiled=ts.transpileModule(`globalThis.progress = ${callback.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const language of ['zh-CN','en','zh-TW']) {
    const messages=[],phases=[];const context={marketRecoveryProgressMessage,state:{settings:{language}},
      firstString:v=>typeof v==='string'?v:'',tradingExpertAnalysisThreadByJobId:new Map([['job','thread']]),
      resolveTradingExpertAnalysisThreadId:v=>v,tradingExpertAnalysisJobIdsByThreadId:new Map([['thread',new Set(['job'])]]),
      updateTradingExpertThinkingState:(_id,phase,message)=>{phases.push(phase);messages.push(message);},refreshTradingExpertConversationSurface:()=>{}};
    vm.createContext(context);vm.runInContext(compiled,context);
    for(const stage of ['market_quota_wait','market_connection_wait','market_ready','market_waiting','market_resuming'])context.progress({analysisJobId:'job',stage,status:'running'});
    assert.equal(messages.length,5);assert.equal(new Set(messages).size,5);
    assert.deepEqual(phases,['market-waiting','market-waiting','preparing','market-waiting','preparing']);
    if(language==='en')assert.ok(messages.every(m=>!/[\u3400-\u9fff]/u.test(m)));
    else assert.match(messages[0],language==='zh-CN'?/等待行情额度恢复/:/等待行情額度恢復/);
    context.progress({analysisJobId:'old-job',stage:'market_quota_wait'});assert.equal(messages.length,5);
    for(const stage of ['service_waiting','service_ready'])context.progress({analysisJobId:'job',stage,status:'running'});
    assert.deepEqual(phases.slice(-2),['preparing','preparing']);
    assert.match(messages[5],language==='en'?/service.*busy/:language==='zh-CN'?/服务暂时繁忙/:/服務暫時繁忙/);
  }
});
