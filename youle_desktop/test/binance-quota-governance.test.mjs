import assert from 'node:assert/strict';
import test from 'node:test';
import { binanceAccountReadErrorResult } from '../src/shared/binance-account-errors.mjs';
import { createAccountReadCoordinator } from '../src/main/binance-account/read-coordinator.mjs';
import { createSnapshotComponents } from '../src/main/binance-account/snapshot-components.mjs';

test('legacy and new account quota errors survive IPC as account errors', () => {
  for (const code of ['BINANCE_UNAVAILABLE', 'BINANCE_BUDGET_DEFERRED', 'BINANCE_RATE_LIMITED']) {
    const { error } = binanceAccountReadErrorResult({code, status:429, message:'HTTP 429', retryAfterMs:13000});
    assert.equal(error.scope, 'binance_account');
    assert.equal(error.retryAfterMs, 13000);
    assert.equal(error.status, 429);
    assert.doesNotMatch(error.message, /模型|HTTP/);
  }
});

test('live account returns before income; income expiry, midnight, failure and rotation are isolated', async () => {
  let now=Date.UTC(2026,9,22,12),resolvePnl,calls=0;
  const c=createSnapshotComponents({now:()=>now});
  const config={scope:'a',zone:'UTC',core:async()=>({equity:100,unrealizedPnl:2,asOf:now}),
    pnl:()=>{calls++;return new Promise(r=>{resolvePnl=r;});}};
  const first=await c.read(config);
  assert.equal(first.equity,100);assert.equal(first.realizedPnlToday,null);
  await c.read(config);assert.equal(calls,1);
  resolvePnl({pnlStatus:'available',realizedPnlToday:3,pnlAsOf:now});
  await new Promise(r=>setImmediate(r));
  const next=await c.read(config);assert.equal(next.todayPnl,5);
  now+=60001;
  assert.equal((await c.read(config)).todayPnl,null);assert.equal(calls,2);
  c.invalidate();resolvePnl({pnlStatus:'available',realizedPnlToday:999,pnlAsOf:now});
  await new Promise(r=>setImmediate(r));
  const fresh=await c.read({...config,pnl:async()=>{throw Object.assign(new Error('busy'),{retryAfterMs:61000});}});
  assert.equal(fresh.todayPnl,null);
  await new Promise(r=>setImmediate(r));
  let bypass=0;await c.read({...config,pnl:async()=>{bypass++;}});assert.equal(bypass,0);
});

test('manual and automatic GET share cooldown and pending requests; mutation invalidates', async () => {
  let clock=0,calls=0;
  const c=createAccountReadCoordinator({now:()=>clock});
  const config={scope:'a',key:'snapshot',group:'a:snapshot'};
  const read=async()=>{calls++;throw Object.assign(new Error('busy'),{status:429,retryAfterMs:61000});};
  await assert.rejects(c.run(config,read));
  for(let i=0;i<10;i++)await assert.rejects(c.run(config,read),e=>e.retryAfterMs===61000);
  assert.equal(calls,1);
  clock=61001;
  assert.deepEqual(await c.run(config,async()=>({asOf:99})),{asOf:99});
  c.invalidate();
  let finish;
  const pending=c.run(config,()=>new Promise(r=>{finish=r;}));
  c.invalidate();finish({asOf:100});
  await assert.rejects(pending,e=>e.code==='ACCOUNT_CHANGED');
});

test('another dataset cooldown blocks a transient retry and account rotation discards success', async () => {
  let resume, calls=0;
  const c=createAccountReadCoordinator({sleep:()=>new Promise(r=>{resume=r;})});
  const pending=c.run({scope:'a',key:'core'},async()=>{calls++;throw {status:503};});
  await new Promise(r=>setImmediate(r));
  await assert.rejects(c.run({scope:'a',key:'income'},async()=>{throw Object.assign(new Error('limited'),{status:429,code:'BINANCE_RATE_LIMITED',retryAfterMs:60000});}));
  resume();await assert.rejects(pending,e=>e.code==='BINANCE_RATE_LIMITED');assert.equal(calls,1);
  c.invalidate();let finish,current=true;
  const late=c.run({scope:'a',key:'core',isCurrent:()=>current},()=>new Promise(r=>{finish=r;}));
  current=false;finish({equity:999});
  await assert.rejects(late,e=>e.code==='ACCOUNT_CHANGED');
});

test('income freshness uses exchange timestamps and still expires with a skewed desktop clock', async () => {
  let local=Date.UTC(2026,9,22,12),observed=local+480000;
  const c=createSnapshotComponents({now:()=>local});
  const config={scope:'skew',zone:'Asia/Shanghai',core:async()=>({equity:100,unrealizedPnl:2,asOf:observed}),
    pnl:async()=>({pnlStatus:'available',realizedPnlToday:3,pnlAsOf:observed})};
  await c.read(config);await new Promise(r=>setImmediate(r));
  assert.equal((await c.read(config)).todayPnl,5);
  local+=61000;observed+=61000;
  assert.equal((await c.read(config)).todayPnl,null);
});
