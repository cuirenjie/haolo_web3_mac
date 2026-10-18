import assert from 'node:assert/strict';
import test from 'node:test';
import {createCloudRecoveryController,cloudTaskText} from '../src/renderer/cloud-task-recovery.ts';

test('closing or switching accounts discards late recovery data and never acknowledges it',async()=>{
  let resolve; const calls=[];
  const c=createCloudRecoveryController(async action=>{calls.push(action);return new Promise(r=>{resolve=r;});},()=>{});
  const pending=c.act('resume','old');c.reset();
  resolve({ok:true,result:{analysisPlan:{report:'private old account'}}});await pending;
  assert.equal(c.state.report,'');assert.deepEqual(c.state.items,[]);assert.deepEqual(calls,['resume']);
});

test('a recovered report is retained until explicitly acknowledged; pending work is never silently resubmitted',async()=>{
  const calls=[];
  const c=createCloudRecoveryController(async(action,key)=>{
    calls.push({action,key});
    return action==='resume'?{ok:true,result:{analysisPlan:{report:'frozen original report'}}}:{ok:true,items:[]};
  },()=>{});
  await c.act('list');assert.equal(calls.length,1);
  await c.act('resume','key');assert.equal(c.state.report,'frozen original report');
  assert.equal(c.state.viewedKey,'key');assert.equal(calls.some(x=>x.action==='acknowledge'),false);
  await c.act('acknowledge','key');assert.equal(c.state.report,'');
});

test('cloud recovery labels cover Simplified Chinese, English and Traditional Chinese',()=>{
  for(const locale of ['zh-CN','en','zh-TW'])for(const key of ['title','note','resume','cancelPending','succeeded'])assert.ok(cloudTaskText(key,locale));
  assert.equal(cloudTaskText('title','en'),'Cloud tasks');
  assert.equal(cloudTaskText('title','zh-TW'),'雲端任務');
});

test('recovery acknowledges only after the original transcript and chart save succeeds',async()=>{
  for(const saved of [false,true]) {
    const calls=[];
    const c=createCloudRecoveryController(async action=>{calls.push(action);return action==='resume'?{ok:true,result:{analysisPlan:{report:'original'}}}:{ok:true,items:[]};},()=>{},
      async(_result,key,isCurrent)=>{assert.equal(key,'original-key');assert.equal(isCurrent(),true);calls.push('durable-save');return saved;});
    await c.act('resume','original-key');
    assert.deepEqual(calls,saved?['resume','durable-save','acknowledge','list']:['resume','durable-save','list']);
  }
});

test('a failed save or an account change during restoration leaves the task unacknowledged',async()=>{
  for(const reset of [false,true]) {
    const calls=[];let c;
    c=createCloudRecoveryController(async action=>{calls.push(action);return {ok:true,result:{analysisPlan:{report:'original'}}};},()=>{},async()=>{
      if(reset){c.reset();return true;}throw Error('disk full');
    });
    await c.act('resume','key');
    assert.deepEqual(calls,['resume']);
    assert.equal(c.state.error,reset?'':'LOAD_FAILED');
  }
});
