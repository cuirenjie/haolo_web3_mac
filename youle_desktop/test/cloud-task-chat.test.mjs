import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTaskChat} from '../src/main/trading-strategy-runtime/cloud-task-chat.mjs';
import {createCloudTaskChatController} from '../src/renderer/cloud-task-chat.ts';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';

const taskId='00000000-0000-4000-8000-000000000001', requestId='00000000-0000-4000-8000-000000000002';
const threadId=`cloud-task:${taskId}`, newRunId='00000000-0000-4000-8000-000000000003';
test('authenticated SDK sends an idempotent assistant round with the original task identity',async()=>{
  const calls=[],api=new YouleApiClient({serviceFetch:async(url,init)=>{calls.push({url,init});return new Response('{}',{status:200});}});
  Object.assign(api,{loaded:true,baseUrl:'https://example.test',profile:{id:'owner'},token:'test-only'});
  await api.tradingCloudRequest('createAssistantRun',{context:{taskId},prompt:'继续',locale:'zh-CN'},
    {expectedAccountId:'owner',expectedBaseUrl:'https://example.test',idempotencyKey:requestId});
  assert.equal(String(calls[0].url),'https://example.test/api/mobile/v1/assistant-runs');
  assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['Idempotency-Key'],requestId);
  assert.equal(JSON.parse(calls[0].init.body).context.taskId,taskId);
  assert.equal(calls[0].init.headers.Authorization,'Bearer test-only');
});
const task=()=>({id:taskId,title:'原会话',context:{taskId,marketKey:'binance:usdm:ETHUSDT',interval:'1h',version:1,
  snapshotId:'00000000-0000-4000-8000-000000000004'},createdAt:'2026-10-24T15:38:00Z',updatedAt:'2026-10-24T15:38:00Z',
  runs:Array.from({length:25},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`,
    context:{taskId},prompt:`第 ${i+1} 轮问题`,text:`第 ${i+1} 轮完整回复`,state:'succeeded',createdAt:'2026-10-24T15:38:00Z'}))});
function server(){
  const data=task(),stored=new Map(),receipts=new Map(),calls=[];
  let owner={ownerId:'owner',accountId:'account',baseUrl:'https://example.test'},lose=false,deleted=false;
  const journal={get:async(o,k)=>stored.get(`${o}:${k}`),put:async(o,k,v)=>{stored.set(`${o}:${k}`,structuredClone(v));}};
  const api={tradingCloudRequest:async(op,body,options)=>{
    calls.push({op,body:structuredClone(body),options});assert.equal(options.expectedAccountId,'account');
    if(op==='task'){if(deleted)throw Object.assign(Error('missing'),{code:'RESOURCE_NOT_FOUND',status:404});return structuredClone(data);}
    if(op==='cancelRun'){assert.equal(body.runId,newRunId);data.runs.at(-1).state='cancelled';return data.runs.at(-1);}
    assert.equal(op,'createAssistantRun');assert.equal(body.context.taskId,taskId);
    let result=receipts.get(options.idempotencyKey);
    if(!result){result={...body,id:newRunId,strategy:'assistant',state:'running',text:'正在回答',createdAt:'2026-10-25T00:00:00Z'};
      data.runs.push(result);receipts.set(options.idempotencyKey,result);}
    if(lose){lose=false;throw Error('network response lost');}
    return structuredClone(result);
  }};
  const make=(options={})=>createCloudTaskChat({owner:async()=>owner,api:()=>api,journal:()=>journal,...options});
  return {data,calls,stored,api,make,lose:()=>lose=true,delete:()=>deleted=true,switch:()=>owner={...owner,ownerId:'other'}};
}
test('continuation appends to original task and preserves every prior question/reply through reload',async()=>{
  const s=server(),original=structuredClone(s.data.runs),service=s.make();
  const first=await service.perform('send',{taskId,requestId,prompt:'继续解释原计划',modelId:'gpt-6-astra',locale:'zh-CN'});
  assert.equal(first.threadId,threadId);assert.equal(first.title,'原会话');assert.equal(first.items.length,52);
  assert.deepEqual(s.data.runs.slice(0,25),original);assert.deepEqual(first.activeRunIds,[newRunId]);
  s.data.runs.at(-1).state='succeeded';s.data.runs.at(-1).text='引用原计划的最终回复';
  const restarted=await s.make().perform('read',{taskId});
  assert.equal(restarted.items.at(-1).text,'引用原计划的最终回复');assert.deepEqual(restarted.activeRunIds,[]);
  assert.equal(restarted.items[0].text,'第 1 轮问题');assert.equal(s.calls.filter(c=>c.op==='createAssistantRun').length,1);
});
test('accepted admission is acknowledged without a fallible second history request',async()=>{
  const s=server(),request=s.api.tradingCloudRequest;let reads=0;
  s.api.tradingCloudRequest=async(...args)=>{
    if(args[0]==='task'&&++reads>1)throw Error('history connection lost after admission');
    return request(...args);
  };
  const accepted=await s.make().perform('send',{taskId,requestId,prompt:'继续'});
  assert.equal(reads,1);assert.equal(accepted.items.length,52);
  assert.equal(accepted.items.at(-2).text,'继续');assert.deepEqual(accepted.activeRunIds,[newRunId]);
  assert.equal(accepted.pending,null);
});

test('lost admission response and restart reuse the frozen request/key, never duplicate the round',async()=>{
  const s=server();s.lose();const input={taskId,requestId,prompt:'保留原历史',modelId:'gpt-6-astra'};
  await assert.rejects(s.make().perform('send',input),/lost/);
  const pending=await s.make().perform('read',{taskId});assert.equal(pending.pending.requestId,requestId);
  await assert.rejects(s.make().perform('send',{...input,requestId:newRunId}),{code:'CLOUD_TASK_SUBMISSION_UNCERTAIN'});
  await s.make().perform('send',{...input,modelId:'deepseek-flash'});
  const posts=s.calls.filter(c=>c.op==='createAssistantRun');assert.equal(posts.length,2);
  assert.deepEqual(posts[0],posts[1]);assert.equal(s.data.runs.length,26);
  await s.make().perform('send',input);assert.equal(s.calls.filter(c=>c.op==='createAssistantRun').length,2);
});
test('missing task, invalid prompt, foreign task and changed account never create a replacement conversation',async()=>{
  const s=server();s.delete();await assert.rejects(s.make().perform('send',{taskId,requestId,prompt:'继续'}),{code:'RESOURCE_NOT_FOUND'});
  assert.deepEqual(s.calls.map(c=>c.op),['task']);
  const bad=server();await assert.rejects(bad.make().perform('send',{taskId,requestId,prompt:'x'.repeat(8001)}),{code:'CLOUD_TASK_MESSAGE_INVALID'});
  assert.equal(bad.calls.some(c=>c.op==='createAssistantRun'),false);
  const foreign=server();foreign.data.context.taskId=newRunId;
  await assert.rejects(foreign.make().perform('send',{taskId,requestId,prompt:'继续'}),/INVALID/);
  const changed=server(),request=changed.api.tradingCloudRequest;
  changed.api.tradingCloudRequest=async(...args)=>{const r=await request(...args);changed.switch();return r;};
  await assert.rejects(changed.make().perform('send',{taskId,requestId,prompt:'继续'}),{code:'TRADING_PREFERENCE_OWNER_CHANGED'});
  assert.equal(changed.calls.some(c=>c.op==='createAssistantRun'),false);
});
test('stop only touches runs in the original task and retains full partial history',async()=>{
  const s=server(),service=s.make();await service.perform('send',{taskId,requestId,prompt:'继续'});
  const stopped=await service.perform('cancel',{taskId});assert.equal(stopped.items.length,52);
  assert.deepEqual(stopped.activeRunIds,[]);assert.equal(stopped.items.at(-1).text,'正在回答');
});
test('duplicate clicks cannot overlap admissions to the same task',async()=>{
  const s=server(),service=s.make(),input={taskId,requestId,prompt:'继续'};
  const result=await Promise.allSettled([service.perform('send',input),service.perform('send',input)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(result.find(r=>r.status==='rejected').reason.code,'CLOUD_TASK_BUSY');
  assert.equal(s.data.runs.length,26);
});
function renderer(){
  let scope='a';const applied=[],errors=[],drafts=[],timers=[];
  const history={ok:true,threadId,items:[{id:'original',text:'完整原历史'}],activeRunIds:[],pending:null};
  const deps={scope:()=>scope,request:async()=>structuredClone(history),apply:h=>applied.push(h),changed:()=>{},
    error:e=>errors.push(e),restoreDraft:(...args)=>drafts.push(args),schedule:fn=>{timers.push(fn);return timers.length;},cancel:()=>{}};
  return {deps,history,applied,errors,drafts,timers,switch:()=>scope='b'};
}
test('renderer enables sending after history load, polls replies in same thread and reloads all history',async()=>{
  const h=renderer(),calls=[];h.deps.request=async(action,input)=>{calls.push({action,input});
    return {...h.history,activeRunIds:action==='send'?[newRunId]:[]};};
  const ui=createCloudTaskChatController(h.deps);assert.equal(ui.ready(threadId),false);
  await ui.load(threadId);assert.equal(ui.ready(threadId),true);
  assert.equal(await ui.send(threadId,'继续','gpt-6-astra','zh-CN'),true);assert.equal(ui.busy(threadId),true);
  assert.equal(calls[1].input.taskId,taskId);assert.equal(calls[1].action,'send');
  await ui.load(threadId);assert.equal(ui.busy(threadId),false);
  assert.ok(h.applied.every(x=>x.threadId===threadId&&x.items[0].text==='完整原历史'));
});
test('renderer rejects stale history racing a send and discards old-account responses',async()=>{
  const h=renderer(),ui=createCloudTaskChatController(h.deps);await ui.load(threadId);
  let resolveRead;h.deps.request=async action=>action==='read'?new Promise(r=>resolveRead=r):{...h.history,activeRunIds:[newRunId]};
  const read=ui.load(threadId);await ui.send(threadId,'继续','gpt-6-astra','zh-CN');
  resolveRead({...h.history,items:[]});await read;assert.equal(ui.busy(threadId),true);
  h.deps.request=async()=>{h.switch();return h.history;};const before=h.applied.length;
  await ui.load(threadId);assert.equal(h.applied.length,before);
});
test('restart surfaces uncertain draft and retries its original admission id',async()=>{
  const h=renderer();h.history.pending={requestId,prompt:'上一条追问'};const ui=createCloudTaskChatController(h.deps);
  await ui.load(threadId);assert.deepEqual(h.drafts[0],[threadId,'上一条追问']);
  let captured;h.deps.request=async(action,input)=>{captured=input;return {...h.history,pending:null};};
  await ui.send(threadId,'上一条追问','gpt-6-astra','zh-CN');assert.equal(captured.requestId,requestId);
});

test('Japanese continuation language reaches the cloud without falling back to Chinese',async()=>{
 const s=server();await s.make().perform('send',{taskId,requestId,prompt:'元の計画について説明してください。',locale:'ja'});
 assert.equal(s.calls.find(call=>call.op==='createAssistantRun').body.locale,'ja');
});

const busy=()=>Object.assign(Error('busy'),{code:'MOBILE_BUSY',status:429});
test('task history and continuation admission recover only explicit rejection with one body/key',async()=>{
  const s=server(),original=s.api.tradingCloudRequest,counts={},posts=[];
  s.api.tradingCloudRequest=async(op,body,options)=>{
    counts[op]=(counts[op]||0)+1;
    if(op==='createAssistantRun')posts.push({body:structuredClone(body),key:options.idempotencyKey});
    if(counts[op]===1)throw busy();
    return original(op,body,options);
  };
  const service=s.make({wait:async()=>{},random:()=>0});
  await service.perform('send',{taskId,requestId,prompt:'继续'});
  assert.equal(counts.task,2);assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);
  assert.equal(s.data.runs.length,26);
});

test('stop while admission is busy prevents another POST and releases the unsent draft',async()=>{
  const s=server(),original=s.api.tradingCloudRequest;let posts=0,waiting;
  const entered=new Promise(r=>waiting=r);
  s.api.tradingCloudRequest=async(...args)=>{if(args[0]==='createAssistantRun'){posts++;throw busy();}return original(...args);};
  const service=s.make({wait:async(_ms,_value,{signal})=>{waiting();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const sending=assert.rejects(service.perform('send',{taskId,requestId,prompt:'继续'}),{code:'TRADING_ANALYSIS_CANCELLED'});
  await entered;
  const stopped=await service.perform('cancel',{taskId});await sending;
  assert.equal(posts,1);assert.equal(stopped.pending,null);assert.equal(s.data.runs.length,25);
});

test('stop racing acceptance retains the receipt and cancels exactly that run',async()=>{
  const s=server(),original=s.api.tradingCloudRequest;let accept,entered;
  const started=new Promise(r=>entered=r);
  s.api.tradingCloudRequest=async(...args)=>{
    if(args[0]==='createAssistantRun'){entered();await new Promise(r=>accept=r);}
    return original(...args);
  };
  const service=s.make();const sending=assert.rejects(service.perform('send',{taskId,requestId,prompt:'继续'}),{code:'TRADING_ANALYSIS_CANCELLED'});
  await started;const stop=service.perform('cancel',{taskId});await new Promise(r=>setImmediate(r));accept();
  const stopped=await stop;await sending;
  assert.deepEqual(stopped.activeRunIds,[]);assert.equal(stopped.pending,null);
  assert.equal(s.data.runs.at(-1).state,'cancelled');assert.equal(s.calls.filter(c=>c.op==='createAssistantRun').length,1);
  assert.equal(s.calls.filter(c=>c.op==='cancelRun').length,1);
});

test('a busy retry cannot clear an earlier uncertain paid receipt on stop',async()=>{
  const s=server();s.lose();const input={taskId,requestId,prompt:'继续'};
  await assert.rejects(s.make().perform('send',input),/lost/);
  const original=s.api.tradingCloudRequest;let waiting;const entered=new Promise(r=>waiting=r);
  s.api.tradingCloudRequest=async(...args)=>{if(args[0]==='createAssistantRun')throw busy();return original(...args);};
  const service=s.make({wait:async(_ms,_value,{signal})=>{waiting();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const sending=assert.rejects(service.perform('send',input),{code:'TRADING_ANALYSIS_CANCELLED'});
  await entered;await assert.rejects(service.perform('cancel',{taskId}),{code:'CLOUD_TASK_SUBMISSION_UNCERTAIN'});await sending;
  assert.equal((await service.perform('read',{taskId})).pending.requestId,requestId);
  await assert.rejects(service.perform('send',{...input,requestId:newRunId}),{code:'CLOUD_TASK_SUBMISSION_UNCERTAIN'});
  assert.equal(s.data.runs.length,26);
});

test('renderer stop during send ignores late acceptance UI and keeps the stop result',async()=>{
  const h=renderer(),ui=createCloudTaskChatController(h.deps);await ui.load(threadId);
  let finish;h.deps.request=async action=>action==='send'?new Promise(r=>finish=r):h.history;
  const sending=ui.send(threadId,'继续','gpt-6-astra','zh-CN');assert.equal(ui.canCancel(threadId),true);
  await ui.stop(threadId);finish({...h.history,activeRunIds:[newRunId]});await sending;
  assert.equal(ui.busy(threadId),false);assert.equal(h.errors.length,0);
});

test('later explicit rejection does not release an earlier uncertain receipt for a new paid round',async()=>{
  const s=server();s.lose();const input={taskId,requestId,prompt:'继续'};
  await assert.rejects(s.make().perform('send',input),/lost/);
  const original=s.api.tradingCloudRequest;
  s.api.tradingCloudRequest=async(...args)=>{
    if(args[0]==='createAssistantRun')throw Object.assign(Error('access changed'),{status:403,code:'MODEL_MEMBERSHIP_REQUIRED'});
    return original(...args);
  };
  await assert.rejects(s.make().perform('send',input),{status:403});
  await assert.rejects(s.make().perform('send',{...input,requestId:newRunId}),{code:'CLOUD_TASK_SUBMISSION_UNCERTAIN'});
  assert.equal(s.data.runs.length,26);
});
