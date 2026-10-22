import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import ts from 'typescript';
import {createCloudPlanRefresher,cloudPlanSyncMessage} from '../src/renderer/cloud-plan-sync.ts';
import {cloudPlanSyncFailurePolicy} from '../src/main/cloud-plan-sync-policy.mjs';
import {cloudPlanListResponse,cloudPlanSyncDiagnostic} from '../src/main/cloud-plan-sync-response.mjs';
import {createCloudPlans} from '../src/main/trading-strategy-runtime/cloud-plans.mjs';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';

function harness(load) {
  const timers=new Map(),notices=[],writes=[],applied=[];
  let scope='account-A',calls=0,next=0,savedResolve;
  const saved=new Promise(resolve=>savedResolve=resolve);
  const retained=[{id:'existing-local-plan'}];
  const refresh=createCloudPlanRefresher({
    scope:()=>scope,load:()=>{calls++;return load(calls);},read:()=>retained,
    apply:plans=>applied.push(plans),save:(owner,plans)=>{writes.push({owner,plans});savedResolve();return true;},
    changed:()=>{},cacheFailure:()=>notices.push('cache'),failure:error=>notices.push(error),
    random:()=>0,schedule:(run,delay)=>{const id=++next;timers.set(id,{run,delay});return id;},
    cancel:id=>timers.delete(id),
  });
  return {refresh,timers,notices,writes,applied,retained,saved,get calls(){return calls;},
    set scope(value){scope=value;},async tick(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.run();await new Promise(setImmediate);}};
}

test('network failures stay silent, retain plans and automatically recover without another interaction',async()=>{
  const h=harness(async attempt=>attempt<3?{ok:false,error:{code:'ECONNRESET',message:'old generic analysis failure',retryable:true}}:{ok:true,reports:[]});
  await h.refresh();
  assert.deepEqual(h.notices,[]);
  assert.deepEqual(h.applied,[]);assert.deepEqual(h.writes,[]);
  assert.equal([...h.timers.values()][0].delay,2000);
  await h.tick();assert.equal([...h.timers.values()][0].delay,4000);
  await h.tick();
  assert.equal(h.calls,3);assert.equal(h.timers.size,0);
  assert.deepEqual(h.applied,[h.retained]);assert.equal(h.writes.length,1);
});

test('server retry-after survives the IPC envelope and repeated refresh events cannot skip it',async()=>{
  const h=harness(async()=>({ok:false,error:{code:'MOBILE_BUSY',status:429,retryable:true,retryAfterMs:90_000}}));
  await h.refresh();
  assert.equal([...h.timers.values()][0]?.delay,90_000);
  for(let i=0;i<20;i++)await h.refresh();
  assert.equal(h.calls,1);assert.equal(h.timers.size,1);assert.equal(h.notices.length,0);
});

test('logout cancels scheduled work and stale results cannot apply after the same account signs in again',async()=>{
  let resolve;
  const h=harness(()=>new Promise(r=>resolve=r));
  const old=h.refresh();h.refresh.reset();
  resolve({ok:true,reports:[]});await old;
  assert.deepEqual(h.applied,[]);
  const fresh=h.refresh();resolve({ok:true,reports:[]});await fresh;
  assert.equal(h.writes.length,1);
});

test('backoff is capped, success resets it and only one request can be active',async()=>{
  let failed=true,resolve;
  const h=harness(async()=>failed?{ok:false,error:{code:'ETIMEDOUT'}}:new Promise(r=>resolve=r));
  await h.refresh();
  const delays=[];
  for(let i=0;i<9;i++){delays.push([...h.timers.values()][0].delay);await h.tick();}
  assert.deepEqual(delays,[2000,4000,8000,16000,32000,60000,60000,60000,60000]);
  failed=false;await h.tick();const calls=h.calls;
  await h.refresh();await h.refresh();assert.equal(h.calls,calls);
  resolve({ok:true,reports:[]});await new Promise(setImmediate);
  failed=true;await h.refresh();assert.equal([...h.timers.values()][0].delay,2000);
  h.refresh.reset();assert.equal(h.timers.size,0);
});

test('switching accounts cancels the old timer, and logout also discards late errors',async()=>{
  const h=harness(async()=>({ok:false,error:{code:'REQUEST_TIMEOUT'}}));
  await h.refresh();const oldCallback=[...h.timers.values()][0].run;
  h.scope='account-B';await h.refresh();assert.equal(h.calls,2);assert.equal(h.timers.size,1);
  oldCallback();await new Promise(setImmediate);assert.equal(h.calls,2);
  h.scope=null;h.refresh.reset();assert.equal(h.timers.size,0);
  let reject;const late=harness(()=>new Promise((_,r)=>reject=r));
  const work=late.refresh();late.scope=null;late.refresh.reset();reject(new Error('late failure'));await work;
  assert.equal(late.timers.size,0);assert.deepEqual(late.notices,[]);
});

test('authentication, contract and permanent HTTP errors cannot be retried by stale metadata',async()=>{
  for(const error of [
    {status:401,code:'YOULE_AUTH_EXPIRED'},{status:403},{status:404},{status:409},
    {code:'HAOLO_AUTH_REQUIRED'},{code:'TRADING_PREFERENCE_OWNER_CHANGED'},
    {code:'CLOUD_RESULT_CONTEXT_INVALID'},{code:'CLOUD_REPORT_INVALID'},
  ]) {
    const h=harness(async()=>({ok:false,error:{...error,retryable:true,message:'specific failure'}}));
    await h.refresh();assert.equal(h.timers.size,0);assert.equal(h.notices.length,1);assert.equal(h.writes.length,0);
  }
  const malformed=harness(async()=>({ok:true,reports:[{invalid:true}]}));
  await malformed.refresh();assert.equal(malformed.timers.size,0);assert.equal(malformed.notices.length,1);assert.equal(malformed.applied.length,0);
});

test('raw transport causes, transient HTTP failures and cancellations survive envelope classification',async()=>{
  for(const error of [
    {message:'fetch failed',cause:{code:'ECONNRESET'}},{message:'net::ERR_INTERNET_DISCONNECTED'},
    {code:'REQUEST_TIMEOUT'},{name:'TimeoutError'},{status:408},{status:425},{status:429},{status:503},
  ]) {
    const response=await cloudPlanListResponse({perform:async()=>{throw error;}});
    const h=harness(async()=>response);await h.refresh();
    assert.equal(h.timers.size,1);assert.deepEqual(h.notices,[]);h.refresh.reset();
  }
  const response=await cloudPlanListResponse({perform:async()=>{throw Object.assign(Error('aborted'),{name:'AbortError'});}});
  const h=harness(async()=>response);await h.refresh();assert.equal(h.timers.size,0);assert.deepEqual(h.notices,[]);
  assert.equal(cloudPlanSyncFailurePolicy({retryAfterMs:NaN}).retryAfterMs,0);
});

test('three language envelopes describe plan synchronization and never expose upstream text',async()=>{
  for(const language of ['zh-CN','en','zh-Hant']) {
    const response=await cloudPlanListResponse({perform:async()=>{throw Object.assign(Error('private-upstream-body'),{code:'UNKNOWN_SERVER_FAILURE'});}},{language});
    assert.doesNotMatch(response.error.message,/private|分析|analysis|原任务|original task/);
    assert.match(response.error.message,language==='en'?/Cloud plans/:language==='zh-Hant'?/雲端計畫/:/云端计划/);
  }
});

test('diagnostics retain original exception and cause but redact credentials and never serialize plans or headers',async()=>{
  const events=[];
  const cause=Object.assign(Error('socket reset Bearer secretBearer123 https://host.test/path?token=url-secret password="secret password"'),{code:'ECONNRESET'});
  const error=Object.assign(Error('fetch failed token=access-secret user@example.com C:\\Users\\private\\file'),{
    code:'NETWORK_ERROR',cause,status:503,requestId:'request-123',
    payload:{detail:{code:'MOBILE_BUSY',message:'api_key="key-secret"'},plans:[{private:'plan-secret'}]},
    headers:{Authorization:'header-secret'},
  });
  cause.cause=error;
  const response=await cloudPlanListResponse({perform:async()=>{throw error;}},{accountId:'private-account',recordFailure:entry=>events.push(entry)});
  assert.equal(events.length,1);
  const entry=events[0];assert.equal(entry.originalError.code,'NETWORK_ERROR');assert.equal(entry.originalError.cause.code,'ECONNRESET');
  assert.equal(entry.originalError.serverCode,'MOBILE_BUSY');assert.equal(entry.status,503);
  assert.equal(entry.requestId,'request-123');assert.equal(entry.diagnosticId,response.error.diagnosticId);
  assert.equal(entry.originalError.cause.cause,null);
  assert.match(entry.accountHash,/^[a-f0-9]{16}$/);
  for(const secret of ['secretBearer123','url-secret','secret password','access-secret','user@example.com','private-account','key-secret','header-secret','plan-secret'])
    assert.ok(!JSON.stringify(entry).includes(secret),secret);
  assert.match(entry.originalError.cause.message,/socket reset/);
  assert.equal(response.error.originalError,undefined);
  const failedLog=await cloudPlanListResponse({perform:async()=>{throw cause;}},{recordFailure:()=>{throw Error('disk full');}});
  assert.equal(failedLog.ok,false);assert.equal(failedLog.error.retryable,true);
});

test('actual main IPC list handler writes a persistent diagnostic and leaves mutation handling unchanged',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'haolo-plan-sync-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const source=fs.readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const writer=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='appendAppServerLogLine').getText(ast);
  const start=source.indexOf("ipcMain.handle('tradingCloud:plans'");
  const handlerSource=source.slice(start,source.indexOf('\n});',start)+4);
  const handlers={},calls=[];
  const dependencies={fs,path,app:{getPath:()=>directory},ipcMain:{handle:(name,handler)=>handlers[name]=handler},
    assertExternalModelsIpcSender:()=>{},appLanguage:()=> 'en',getYouleApiClient:()=>({profile:{id:'private-account'}}),
    cloudPlanListResponse,cloudStrategyFailure:()=>({code:'UNCHANGED_MUTATION_ERROR'}),
    cloudPlans:{perform:async action=>{calls.push(action);throw Object.assign(Error('original socket failure'),{code:'ECONNRESET'});}}};
  Function(...Object.keys(dependencies),'let appServerLogPath=null;const APP_SERVER_LOG_MAX_BYTES=5*1024*1024;'+writer+'\n'+handlerSource)(...Object.values(dependencies));
  const result=await handlers['tradingCloud:plans']({}, {action:'list'});
  const log=fs.readFileSync(path.join(directory,'logs','app-server.log'),'utf8');
  assert.match(log,/\[cloud-plan-sync\]/);assert.match(log,/original socket failure/);assert.match(log,/ECONNRESET/);
  assert.ok(log.includes(result.error.diagnosticId));assert.doesNotMatch(log,/private-account/);
  const mutation=await handlers['tradingCloud:plans']({}, {action:'activate',input:{planId:'not-replayed'}});
  assert.deepEqual(calls,['list','activate']);assert.equal(mutation.error.code,'UNCHANGED_MUTATION_ERROR');
  assert.equal(fs.readFileSync(path.join(directory,'logs','app-server.log'),'utf8'),log);
});

test('HTTP Retry-After crosses real SDK, plan reader and IPC before a successful automatic GET retry',{timeout:5000},async t=>{
  const requests=[],events=[];
  const server=http.createServer((req,res)=>{
    requests.push({method:req.method,url:req.url});
    assert.equal(req.url,'/api/mobile/v1/trading-plans');
    res.setHeader('Content-Type','application/json');
    if(requests.length===1){res.writeHead(429,{'Retry-After':'3'});res.end(JSON.stringify({detail:{code:'MOBILE_BUSY'}}));}
    else res.end(JSON.stringify({items:[],receipts:{},nextCursor:null}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const api=new YouleApiClient({serviceFetch:fetch});Object.assign(api,{loaded:true,baseUrl,profile:{id:'test-account'},token:'isolated-fixture-token'});
  const plans=createCloudPlans({owner:async()=>({ownerId:'test-account',accountId:'test-account',baseUrl}),api:()=>api});
  const h=harness(()=>cloudPlanListResponse(plans,{recordFailure:entry=>events.push(entry)}));
  await h.refresh();assert.deepEqual(h.notices,[]);assert.equal(events[0].originalError.serverCode,'MOBILE_BUSY');
  assert.equal([...h.timers.values()][0].delay,3000);
  const [id,timer]=h.timers.entries().next().value;h.timers.delete(id);timer.run();
  await h.saved;
  assert.equal(h.writes.length,1);assert.equal(h.timers.size,0);assert.deepEqual(h.applied,[h.retained]);
  assert.deepEqual(requests,[{method:'GET',url:'/api/mobile/v1/trading-plans'},{method:'GET',url:'/api/mobile/v1/trading-plans'}]);
});

test('actual renderer wiring does not invoke Toast for transient failures in any locale',async()=>{
  const source=fs.readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
  const declaration=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='refreshCloudExecutionPlans')).getText(ast);
  const compiled=ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const language of ['zh-CN','en','zh-TW']) {
    let retry,failed=true;const notices=[],diagnostics=[];
    const state={auth:{authenticated:true},settings:{language},executionPlans:[{id:'retained'}],executionPlansScope:'A',activeView:'chat'};
    const dependencies={state,api:{tradingCloudPlans:async()=>failed
      ?cloudPlanListResponse({perform:async()=>{throw Object.assign(Error('original socket failure'),{code:'ECONNRESET'});}},{recordFailure:entry=>diagnostics.push(entry)})
      :{ok:true,reports:[]}},currentExecutionPlanStorageScope:()=>state.executionPlansScope,
      createCloudPlanRefresher:options=>createCloudPlanRefresher({...options,schedule:run=>{retry=run;return 1;},cancel:()=>{retry=null;}}),
      saveExecutionPlans:()=>true,render:()=>{},reconcileMissingExecutionPlanAlerts:()=>{},
      cloudPlanSyncMessage,errorMessage:error=>error.message,showToast:message=>notices.push(message),executionPlanCloudLoadedScope:null};
    const refresh=Function(...Object.keys(dependencies),compiled+';return refreshCloudExecutionPlans;')(...Object.values(dependencies));
    await refresh();assert.deepEqual(notices,[]);assert.equal(diagnostics.length,1);assert.equal(state.executionPlans[0].id,'retained');
    failed=false;retry();await new Promise(setImmediate);assert.deepEqual(notices,[]);assert.equal(state.executionPlans.length,1);refresh.reset();
  }
});

test('client-side merge errors use the diagnostic channel, and the main handler redacts before persisting',async()=>{
  const diagnostics=[];
  const refresh=createCloudPlanRefresher({scope:()=> 'A',load:async()=>({ok:true,reports:[{}]}),read:()=>[],apply:()=>assert.fail(),save:()=>true,
    changed:()=>{},cacheFailure:()=>{},failure:()=>{},diagnostic:error=>diagnostics.push(error)});
  await refresh();assert.equal(diagnostics[0].message,'CLOUD_REPORT_INVALID');
  const source=fs.readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8');
  const start=source.indexOf('ipcMain.handle("youle:debugLog"');
  const code=source.slice(start,source.indexOf('\n});',start)+4),lines=[];
  let handler;
  Function('ipcMain','assertExternalModelsIpcSender','appendAppServerLogLine','cloudPlanSyncDiagnostic',code)(
    {handle:(_name,value)=>handler=value},()=>{},(stream,line)=>lines.push({stream,line}),cloudPlanSyncDiagnostic);
  await handler({}, {event:'cloud-plan-sync.client-failed',payload:{...diagnostics[0],message:'CLOUD_REPORT_INVALID token=hidden-secret'}});
  assert.equal(lines[0].stream,'cloud-plan-sync');assert.match(lines[0].line,/CLOUD_REPORT_INVALID/);
  assert.doesNotMatch(lines[0].line,/hidden-secret/);assert.equal(JSON.parse(lines[0].line).stage,'renderer');
});
