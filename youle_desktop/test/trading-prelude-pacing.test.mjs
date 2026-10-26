import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingPreludePacer } from '../src/renderer/trading-prelude-pacing.ts';

const user = {id:'user',kind:'user_text',role:'user'};
const receipt = {id:'trading-send-receipt-user',kind:'agent_text',role:'ceo_assistant',text:'收到'};
const first = {...receipt,id:'trading-harmonic-progress-123-abc-1',text:'正在理解'};
const second = {...receipt,id:'trading-harmonic-progress-123-abc-2',text:'正在提交'};
const report = {...receipt,id:'report',text:'完整报告'};
const phases = {[first.id]:'preparing',[second.id]:'loading'};

function harness() {
  let now = 0, scope = 'account-1', visible = 'draft', timerId = 0;
  const timers = new Map(), refreshed = [];
  const pacer = new TradingPreludePacer({
    refresh: threadId => refreshed.push(threadId), scope:()=>scope, isVisible:id=>id===visible, now:()=>now,
    afterRender:callback=>callback(),
    setTimer:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},
    clearTimer:id=>timers.delete(id),
  });
  return {pacer,timers,refreshed,
    project:(messages,pending='user',thread=visible)=>pacer.project(thread,messages,pending,id=>phases[id]),
    time:value=>{now=value;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}},
    visible:id=>{visible=id;},scope:value=>{scope=value;},
  };
}

test('a burst is displayed as receipt, understanding and submission at uniform one-second intervals',()=>{
  const h=harness(), all=[user,receipt,first,second];
  assert.deepEqual(h.project([user,receipt]),[user,receipt]);
  assert.deepEqual(h.project(all),[user,receipt]);
  h.time(999);assert.deepEqual(h.project(all),[user,receipt]);
  h.time(1000);assert.deepEqual(h.project(all),[user,receipt,first]);
  assert.deepEqual(h.project(all),[user,receipt,first],'rerenders cannot advance a second bubble');
  h.time(1999);assert.deepEqual(h.project(all),[user,receipt,first]);
  h.time(2000);assert.deepEqual(h.project(all),all);
  h.time(3000);assert.deepEqual(h.project(all),all);
  assert.equal(h.pacer.isWaiting('draft'),false);
  assert.equal(h.timers.size,0);
});

test('a fast report waits behind the three bubbles without changing its canonical content',()=>{
  const h=harness(), all=[user,receipt,first,second,report];
  h.project([user,receipt]);
  assert.deepEqual(h.project(all),[user,receipt]);
  assert.equal(all.at(-1),report);
  h.time(1000);assert.deepEqual(h.project(all),all.slice(0,3));
  h.time(2000);assert.deepEqual(h.project(all),all.slice(0,4));
  h.time(3000);assert.deepEqual(h.project(all),all);
});

test('late arrivals and delayed timers never release both later bubbles together',()=>{
  const h=harness(), all=[user,receipt,first,second];
  h.project([user,receipt]);
  h.time(10000);assert.deepEqual(h.project(all),[user,receipt,first]);
  assert.deepEqual(h.project(all),[user,receipt,first]);
  h.time(10999);assert.deepEqual(h.project(all),[user,receipt,first]);
  h.time(11000);assert.deepEqual(h.project(all),all);
});

test('stops, errors and failed preflight are immediate and cancel scheduled work',()=>{
  for(const type of ['stop','error','quota']){
    const h=harness(), error={...report,id:'error'};
    h.project([user,receipt,first,second]);
    let all=[user,receipt,first,second,error];
    if(type==='stop')h.pacer.cancelThread('draft');
    if(type==='error')phases.error='error';
    if(type==='quota')all=[user,receipt,first,error];
    assert.deepEqual(h.project(all),all);
    assert.equal(h.pacer.isWaiting('draft'),false);
    assert.equal(h.timers.size,0);
    delete phases.error;
  }
});

test('history, ordinary answers and other conversations are never replayed or delayed',()=>{
  const h=harness(), all=[user,receipt,first,second,report];
  assert.deepEqual(h.project(all,null),all);
  assert.deepEqual(h.project(all,'other-user'),all);
  const ordinary=harness();ordinary.project([user,receipt]);
  assert.deepEqual(ordinary.project([user,receipt,report]),[user,receipt,report]);
  const active=harness();active.project([user,receipt,first,second]);
  active.visible('other');active.time(1000);
  assert.equal(active.refreshed.length,0);
  active.visible('draft');assert.deepEqual(active.project(all),all);
});

test('thread migration preserves cadence, while account switching prevents a stale timer refresh',()=>{
  const h=harness(), all=[user,receipt,first,second];
  h.project(all);
  h.pacer.moveThread('draft','promoted');h.visible('promoted');
  h.time(1000);assert.deepEqual(h.refreshed,['promoted']);
  assert.deepEqual(h.project(all),all.slice(0,3));
  h.scope('account-2');h.time(2000);
  assert.deepEqual(h.refreshed,['promoted']);
  assert.deepEqual(h.project(all,'none'),all);
});

test('the interval starts after DOM work, so a slow initial render cannot shorten the first gap',()=>{
  let now=0;
  const commits=[];
  const pacer=new TradingPreludePacer({refresh:()=>{},scope:()=>1,isVisible:()=>true,now:()=>now,
    afterRender:callback=>commits.push(callback),setTimer:()=>1,clearTimer:()=>{}});
  const all=[user,receipt,first,second];
  const project=()=>pacer.project('draft',all,'user',id=>phases[id]);
  assert.deepEqual(project(),all.slice(0,2));
  now=200;commits.shift()();
  now=1199;assert.deepEqual(project(),all.slice(0,2));
  now=1200;assert.deepEqual(project(),all.slice(0,3));
  now=1210;commits.shift()();
  now=2209;assert.deepEqual(project(),all.slice(0,3));
  now=2210;assert.deepEqual(project(),all);
});

test('a follow-up has its own cadence and does not hide the preceding turn',()=>{
  const h=harness(), previous=[user,receipt,first,second,report];
  h.project(previous,null);
  const nextUser={...user,id:'next-user'},nextReceipt={...receipt,id:'trading-send-receipt-next-user'};
  const nextFirst={...first,id:'trading-harmonic-progress-456-def-1'},nextSecond={...second,id:'trading-harmonic-progress-456-def-2'};
  phases[nextFirst.id]='preparing';phases[nextSecond.id]='loading';
  const all=[...previous,nextUser,nextReceipt,nextFirst,nextSecond];
  assert.deepEqual(h.project(all,'next-user'),all.slice(0,7));
  h.time(1000);assert.deepEqual(h.project(all,'next-user'),all.slice(0,8));
  h.time(2000);assert.deepEqual(h.project(all,'next-user'),all);
});
