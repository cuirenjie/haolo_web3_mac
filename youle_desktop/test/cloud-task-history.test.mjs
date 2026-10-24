import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudTaskHistory} from '../src/main/trading-strategy-runtime/cloud-task-history.mjs';
import {createCloudPlans} from '../src/main/trading-strategy-runtime/cloud-plans.mjs';

const taskId='00000000-0000-4000-8000-000000000001';
const runId='00000000-0000-4000-8000-000000000002';
const olderId='00000000-0000-4000-8000-000000000003';
const fixture=()=>({id:taskId,title:'原来的 ETH 会话',context:{taskId},createdAt:'2026-10-24T15:00:00Z',updatedAt:'2026-10-24T15:38:00Z',
  runs:[{id:olderId,prompt:'前一轮问题',text:'前一轮回复',context:{taskId},createdAt:'2026-10-24T15:00:00Z'},
    {id:runId,prompt:'@策略:裸K分析',text:'原始分析回复',context:{taskId},createdAt:'2026-10-24T15:38:00Z'}]});

test('opens original task identity, title, timestamps and all rounds without adding a recovery notice',()=>{
  const task=fixture(),before=JSON.stringify(task),history=cloudTaskHistory(task,runId);
  assert.equal(history.threadId,`cloud-task:${taskId}`);assert.equal(history.title,task.title);
  assert.deepEqual(history.items.map(item=>item.text),['前一轮问题','前一轮回复','@策略:裸K分析','原始分析回复']);
  assert.equal(history.items[3].id,runId);assert.equal(history.createdAt,task.createdAt);
  assert.equal(JSON.stringify(task),before);
  assert.deepEqual(cloudTaskHistory(task,runId),history);
});
test('rejects unrelated, missing, or duplicate runs instead of substituting a report',()=>{
  const task=fixture();assert.throws(()=>cloudTaskHistory(task,taskId),/INVALID/);
  task.runs[1].context={taskId:olderId};assert.throws(()=>cloudTaskHistory(task,runId),/INVALID/);
  task.runs=[fixture().runs[0],fixture().runs[0]];assert.throws(()=>cloudTaskHistory(task),/INVALID/);
});
test('plan source resolution follows owned plan -> exact run -> existing task using GET operations only',async()=>{
  const task=fixture(),ops=[],writes=[];const plan={id:'plan',runId,saved:true};
  const owner={ownerId:'owner',accountId:'account',baseUrl:'https://example.test'};
  const service=createCloudPlans({owner:async()=>owner,sources:()=>({rememberOrigin:async(...args)=>writes.push(args)}),
    api:()=>({tradingCloudRequest:async(op,payload,options)=>{
      ops.push(op);assert.equal(options.expectedAccountId,'account');
      if(op==='plan')return plan;if(op==='run')return {id:runId,context:{taskId}};
      assert.equal(op,'task');assert.equal(payload.taskId,taskId);return task;
    }})});
  const first=await service.perform('history',{planId:'plan',runId});
  assert.deepEqual(ops,['plan','run','task']);assert.equal(first.threadId,`cloud-task:${taskId}`);
  assert.equal(writes[0][2].sourceThreadId,first.threadId);
  const again=await service.perform('history',{taskId});assert.deepEqual(again,first);
  assert.deepEqual(ops,['plan','run','task','task']);
});
test('account switch or missing original task never returns or persists fabricated history',async()=>{
  const initial={ownerId:'a',accountId:'a',baseUrl:'https://example.test'};let owner=initial,writes=0;
  const service=createCloudPlans({owner:async()=>owner,sources:()=>({rememberOrigin:async()=>writes++}),
    api:()=>({tradingCloudRequest:async()=>{owner={...owner,ownerId:'b'};return fixture();}})});
  await assert.rejects(service.perform('history',{taskId}),{code:'TRADING_PREFERENCE_OWNER_CHANGED'});assert.equal(writes,0);
  owner=initial;
  const missing=createCloudPlans({owner:async()=>owner,api:()=>({tradingCloudRequest:async()=>{throw Object.assign(Error('missing'),{code:'RESOURCE_NOT_FOUND'});}})});
  await assert.rejects(missing.perform('history',{taskId}),{code:'RESOURCE_NOT_FOUND'});
});
