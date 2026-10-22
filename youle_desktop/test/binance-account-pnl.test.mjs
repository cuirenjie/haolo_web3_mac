import assert from 'node:assert/strict';
import test from 'node:test';
import {createSnapshotComponents} from '../src/main/binance-account/snapshot-components.mjs';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {createAccountPnlUpdates} from '../src/renderer/binance-account-pnl.ts';
import {createBinanceAccountUiState,renderBinanceAccountPage} from '../src/renderer/binance-account-ui.ts';
import {translateAppText} from '../src/renderer/app-language.mjs';

const settle=()=>new Promise(r=>setImmediate(r));
function clock() {
  let time=Date.UTC(2026,9,23,4), next=0;
  const timers=new Map();
  return {now:()=>time,setTimer(fn,ms){const id=++next;timers.set(id,{fn,at:time+ms});return id;},
    clearTimer:id=>timers.delete(id), async advance(ms){
      const end=time+ms;
      while(true){const due=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;
        time=due[1].at;timers.delete(due[0]);due[1].fn();await settle();}
      time=end; await settle();
    }};
}
const core=(now,version=1)=>({equity:100,unrealizedPnl:2,asOf:now,bindingVersion:version});
const income=(now,value=3)=>({pnlStatus:'available',realizedPnlToday:value,pnlAsOf:now,pnlServerTime:now,
  pnlExpiresAfterMs:60000,pnlRefreshAfterMs:53000});

test('SDK chooses income-only endpoint and emits completion before another core refresh',async()=>{
  const events=[],calls=[];let finish;
  const client=new YouleApiClient({onAccountPnl:value=>events.push(value)});
  client.loaded=true;client.baseUrl='https://offline.invalid';client.token='fixture-session';
  client.serviceFetch=async url=>{
    calls.push(new URL(url).pathname);
    if(url.includes('/today-pnl')){assert.match(url,/bindingVersion=1/);return new Promise(r=>{finish=()=>r(Response.json({...income(Date.now(),0),bindingVersion:1}));});}
    return Response.json({...core(Date.now()),pnlEndpointVersion:1});
  };
  const first=await client.getAccountConnectionSnapshot('one',{includeTodayPnl:true,nonBlockingPnl:true});
  await settle();assert.equal(first.realizedPnlToday,null);assert.equal(first.pnlStatus,'loading');
  finish();await settle();await settle();
  assert.equal(events.length,1);assert.equal(events[0].realizedPnlToday,0);
  assert.equal(events[0].pnlScopeId,first.pnlScopeId);
  assert.equal(calls.filter(v=>v.endsWith('/snapshot')).length,1);
  assert.equal('equity' in events[0],false);assert.doesNotMatch(JSON.stringify(events),/fixture-session/);
  client.accountSnapshotComponents.invalidate();
});

test('legacy server remains compatible and avoids unsupported income route',async()=>{
  const client=new YouleApiClient();client.loaded=true;client.token='fixture';client.baseUrl='https://offline.invalid';
  const paths=[];client.serviceFetch=async url=>{paths.push(url);return Response.json({...core(Date.now()),...(url.includes('pnlTimeZone')?income(Date.now()):{})});};
  await client.getAccountConnectionSnapshot('a',{includeTodayPnl:true,nonBlockingPnl:true});await settle();await settle();
  assert.ok(paths.every(v=>v.includes('/snapshot')));
  const second=await client.getAccountConnectionSnapshot('a',{includeTodayPnl:true,nonBlockingPnl:true});
  assert.equal(second.todayPnl,5);
});

test('retry runs independently, respects server delay, and expires original income on failure',async()=>{
  const time=clock(),events=[];let calls=0,busy=false;
  const c=createSnapshotComponents(time);
  const config={scope:'one',zone:'UTC',core:async()=>core(time.now()),onUpdate:v=>events.push(v),
    pnl:async()=>{calls++;return busy?{pnlStatus:'unavailable',pnlReason:'BINANCE_BUDGET_DEFERRED',pnlRetryAfterMs:61000}:income(time.now());}};
  await c.read(config);await settle();assert.equal(events.at(-1).realizedPnlToday,3);
  busy=true;await time.advance(53000);assert.equal(calls,2);
  assert.equal(events.at(-1).realizedPnlToday,3);
  for(let i=0;i<10;i++) await c.read(config);
  assert.equal(calls,2);
  await time.advance(7000);assert.equal(events.at(-1).realizedPnlToday,null);
  await time.advance(53000);assert.equal(calls,2);
  busy=false;await time.advance(1000);assert.equal(calls,3);
  assert.equal(events.at(-1).realizedPnlToday,3);
  c.invalidate();
});

test('binding replacement and account invalidation discard late success events',async()=>{
  const time=clock(),events=[],resolves=[];let version=1;
  const c=createSnapshotComponents(time);
  const config={scope:'a',zone:'UTC',core:async()=>core(time.now(),version),onUpdate:v=>events.push(v),pnl:()=>new Promise(r=>resolves.push(r))};
  const first=await c.read(config);await settle();version=2;
  const second=await c.read(config);await settle();
  assert.notEqual(first.pnlScopeId,second.pnlScopeId);
  resolves[0](income(time.now(),999));await settle();assert.equal(events.length,0);
  c.invalidate();resolves[1](income(time.now(),999));await settle();assert.equal(events.length,0);
});

test('same observation reuse does not reset age; dormant readers stop queries but still clear expired values',async()=>{
  const time=clock(),events=[];const original=time.now();let calls=0;
  const c=createSnapshotComponents(time);
  const config={scope:'a',zone:'UTC',core:async()=>core(original),onUpdate:v=>events.push(v),pnl:async()=>{calls++;return income(time.now());}};
  await c.read(config);await settle();await time.advance(53000);
  assert.equal(calls,2);await time.advance(60000);
  assert.equal(calls,2);assert.equal(events.at(-1).realizedPnlToday,null);
  c.invalidate();
});

test('a delayed older core response cannot restore the previous binding or its income',async()=>{
  const time=clock(),c=createSnapshotComponents(time),events=[];let finishOld,calls=0;
  const config={scope:'a',zone:'UTC',onUpdate:v=>events.push(v),
    pnl:async snapshot=>{calls++;return {...income(time.now(),snapshot.bindingVersion),bindingVersion:snapshot.bindingVersion};}};
  const old=c.read({...config,core:()=>new Promise(resolve=>{finishOld=resolve;})});
  const current=await c.read({...config,core:async()=>core(time.now(),2)});
  await settle();finishOld(core(time.now()+1,1));
  const late=await old;
  assert.equal(late.bindingVersion,2);assert.equal(late.pnlScopeId,current.pnlScopeId);
  assert.equal(late.realizedPnlToday,2);assert.equal(calls,1);assert.equal(events.length,1);
  c.invalidate();
});

test('income expires at local midnight even when the sixty-second lifetime has not elapsed',async()=>{
  const time=clock(),events=[],c=createSnapshotComponents(time);
  // Synthetic server is 23:59:59 UTC, independent of the desktop wall clock.
  const observed=Date.UTC(2026,9,23,23,59,59);
  await c.read({scope:'a',zone:'UTC',core:async()=>core(observed),onUpdate:v=>events.push(v),
    pnl:async()=>({...income(observed),pnlRefreshPending:true,pnlRetryAfterMs:61000})});
  await settle();assert.equal(events.at(-1).realizedPnlToday,3);
  await time.advance(1000);assert.equal(events.at(-1).realizedPnlToday,null);
  c.invalidate();
});

function snapshot(){return {schemaVersion:1,currency:'USDT',estimatedTotalAssets:100,marginBalance:100,walletBalance:98,
  availableBalance:90,initialMargin:10,unrealizedPnl:2,realizedPnlToday:null,todayPnl:null,todayPnlPercent:null,
  positions:[],positionHistory:[],openOrders:[],walletBreakdown:[],warnings:[],fetchedAt:'now',sources:{realizedPnl:'unavailable'},
  pnlScopeId:'s',pnlSequence:0,bindingVersion:1,pnlStatus:'loading'};}

test('renderer merges only income into the newest balances and handles event-before-response and old sequences',()=>{
  let now=0;const updates=createAccountPnlUpdates(()=>now);
  updates.remember({connectionId:'a',pnlScopeId:'s',pnlSequence:1,bindingVersion:1,...income(100,3)});
  const fresh=snapshot();fresh.marginBalance=200;fresh.unrealizedPnl=4;
  const merged=updates.apply(fresh);
  assert.equal(merged.marginBalance,200);assert.equal(merged.todayPnl,7);assert.equal(merged.todayPnlPercent,7/193*100);
  assert.equal(updates.apply({...fresh,pnlScopeId:'other'}).todayPnl,null);
  assert.equal(updates.apply({...fresh,bindingVersion:2}).todayPnl,null);
  updates.remember({connectionId:'a',pnlScopeId:'s',pnlSequence:0,bindingVersion:1,...income(100,999)});
  assert.equal(updates.apply(fresh).realizedPnlToday,3);
  now=60000;assert.equal(updates.apply(fresh).realizedPnlToday,null);
});

test('P&L pending, waiting, real zero and hidden balances retain three-language UI semantics',()=>{
  const state=createBinanceAccountUiState();state.loaded=true;state.status={bound:true};state.snapshot=snapshot();
  assert.match(renderBinanceAccountPage(state),/更新中/);
  state.snapshot.pnlStatus='waiting';assert.match(renderBinanceAccountPage(state),/等待更新/);
  state.snapshot.realizedPnlToday=state.snapshot.todayPnl=0;
  assert.doesNotMatch(renderBinanceAccountPage(state),/等待更新|更新中/);
  state.snapshot.realizedPnlToday=null;state.balancesVisible=false;
  assert.doesNotMatch(renderBinanceAccountPage(state),/等待更新|更新中/);
  assert.equal(translateAppText('更新中','en'),'Updating');
  assert.equal(translateAppText('等待更新','en'),'Waiting for update');
  assert.equal(translateAppText('等待更新','zh-TW'),'等待更新');
});

test('credential failure before the initial snapshot is retained; old sequence or binding cannot invalidate it',()=>{
  const updates=createAccountPnlUpdates(),fresh=snapshot();
  const failure={connectionId:'a',pnlScopeId:'s',pnlSequence:1,bindingVersion:1,
    pnlStatus:'waiting',realizedPnlToday:null,pnlError:{code:'BINANCE_CREDENTIALS_INVALID'}};
  updates.remember(failure);
  assert.throws(()=>updates.apply(fresh),{code:'BINANCE_CREDENTIALS_INVALID'});
  assert.doesNotThrow(()=>updates.apply({...fresh,bindingVersion:2}));
  updates.remember({...failure,pnlSequence:2,pnlError:undefined,...income(Date.now(),0)});
  updates.remember(failure);
  assert.equal(updates.apply(fresh).realizedPnlToday,0);
});
