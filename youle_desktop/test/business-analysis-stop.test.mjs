import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {CodexBusinessTools, businessToolResponse} from '../src/main/codex-business-tools.mjs';
import {businessToolError, restoreBusinessToolError} from '../src/shared/business-tool-error.mjs';
import {tradingAnalysisStoppedMessage} from '../src/main/trading-analysis/failure.mjs';

const fatal = () => Object.assign(new Error('云端结果与当前任务不一致，未应用结果。'), {
  code:'CLOUD_RESULT_CONTEXT_INVALID',retryable:false,diagnosticId:'H-test',
});
function harness() {
  const sender={id:1,isDestroyed:()=>false},client={},events=[],stops=[];
  const broker=new CodexBusinessTools({owner:()=> 'owner',accountRead:async()=>({available:false}),
    dispatch:(_,p)=>events.push(p),onAnalysisFailure:async x=>stops.push(x)});
  const context=broker.bind('thread',{client,sender,userText:'威科夫和缠论分析'});
  broker.start('thread','turn',client);
  const call=(tool,args={})=>broker.invokeBound({tool,arguments:{context_id:context.token,...args}});
  return {broker,context,client,sender,events,stops,call};
}

test('terminal IPC error stops once and fences queued retries, changed parameters, aliases and recovery',async()=>{
  const h=harness();await h.call('haolo_account_read',{sections:['summary','positions']});
  const first=h.call('haolo_analysis',{strategyId:'wyckoff'});
  const queued=h.call('haolo_analysis',{strategyId:'chan',lookbackMs:480000000});
  const rejected=assert.rejects(first,e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID'&&e.retryable===false&&e.terminal);
  const queuedRejected=assert.rejects(queued,e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.events.length,1);
  h.broker.resolve(h.sender,{requestId:h.events[0].requestId,error:fatal().message,errorDetails:businessToolError(fatal())});
  await rejected;await queuedRejected;
  for(const [tool,args] of [['haolo_analysis',{strategyId:'wyckoff',interval:'60'}],['haolo_trading',{action:'analyze',strategyId:'chan'}]])
    await assert.rejects(h.call(tool,args),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  assert.equal(h.stops.length,1);assert.equal(h.events.length,1);
  h.broker.suspend('thread','turn');h.broker.resume('thread',h.client);h.broker.start('thread','recovery',h.client);
  await assert.rejects(h.call('haolo_analysis',{strategyId:'chan'}),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  assert.equal(h.events.filter(e=>e.arguments?.action==='analyze_only').length,1);
  assert.equal(h.broker.updateInput('thread',{client:h.client,sender:h.sender,userText:'修复后再分析'}),true);
  const next=h.call('haolo_analysis',{strategyId:'wyckoff'});
  await new Promise(resolve=>setImmediate(resolve));
  const event=h.events.findLast(e=>e.arguments?.action==='analyze_only');
  h.broker.resolve(h.sender,{requestId:event.requestId,result:{result:{report:'真实报告',symbol:'BTCUSDT',interval:'60'}}});
  assert.ok((await next).analysisRef);
  h.broker.cancel('thread');
});

test('transient errors retain retryability and delayed old failures cannot stop new user input',async()=>{
  const h=harness();await h.call('haolo_account_read',{});
  const first=h.call('haolo_analysis',{strategyId:'wyckoff'}),rejected=assert.rejects(first,e=>e.retryable===true);
  await new Promise(resolve=>setImmediate(resolve));
  h.broker.resolve(h.sender,{requestId:h.events[0].requestId,error:'timeout',errorDetails:{message:'timeout',code:'REQUEST_TIMEOUT',retryable:true}});
  await rejected;assert.equal(h.stops.length,0);
  const next=h.call('haolo_analysis',{strategyId:'wyckoff'}),late=assert.rejects(next,e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  await new Promise(resolve=>setImmediate(resolve));
  h.broker.updateInput('thread',{client:h.client,sender:h.sender,userText:'新的问题'});
  h.broker.resolve(h.sender,{requestId:h.events.at(-1).requestId,error:'mismatch',errorDetails:businessToolError(fatal())});
  await late;assert.equal(h.stops.length,0);assert.equal(h.context.analysisFailure,null);
  h.broker.cancel('thread');
});

test('failure latch survives interrupt errors; dynamic transport keeps stop policy',async()=>{
  const h=harness();await h.call('haolo_account_read',{});
  h.context.executeTrading=async()=>{throw fatal();};
  h.broker.onAnalysisFailure=async()=>{throw new Error('interrupt acknowledgement lost');};
  await assert.rejects(h.call('haolo_analysis',{strategyId:'wyckoff'}),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  assert.equal(h.context.analysisFailure.nextAction,'stop');
  const e=JSON.parse(businessToolResponse(null,restoreBusinessToolError(h.context.analysisFailure)).contentItems[0].text).error;
  assert.equal(e.retryable,false);assert.equal(e.terminal,true);assert.equal(e.nextAction,'stop');
  h.broker.cancel('thread');
});

test('desktop stop targets only the failed native turn and disables auto-recovery',async()=>{
  const source=fs.readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8');
  const ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const declaration=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='codexBusinessTools'));
  const initializer=declaration.declarationList.declarations[0].initializer;
  const callback=initializer.arguments[0].properties.find(p=>p.name?.getText(ast)==='onAnalysisFailure').initializer.getText(ast);
  const events=[],threads=new Set(),turns=new Set();
  const stop=vm.runInNewContext(`(${callback})`,{turnAutoRecoveryCoordinator:{cancel:(...args)=>events.push(['recovery',...args])},
    interruptedCodexThreadIds:threads,interruptedCodexTurnIds:turns,
    requestAppServer:async(...args)=>events.push(['interrupt',...args]),isTurnInterruptAcknowledgementTimeout:()=>false});
  const client={},context={client,sender:{isDestroyed:()=>false}};
  await stop({context,threadId:'origin',turnId:'failed-turn',isCurrent:()=>true});
  assert.equal(events[0][0],'recovery');assert.equal(events[0][1],'origin');
  assert.equal(events[1][1],client);assert.equal(events[1][2],'turn/interrupt');
  assert.equal(events[1][3].threadId,'origin');assert.equal(events[1][3].turnId,'failed-turn');
  assert.ok(threads.has('origin')&&turns.has('failed-turn'));
  await stop({context,threadId:'new',turnId:'new',isCurrent:()=>false});assert.equal(events.length,2);
});

test('terminal reason is explicit in all three locales and does not expose upstream payloads',()=>{
  for(const language of ['zh-CN','en','zh-Hant']) {
    const text=tradingAnalysisStoppedMessage({...fatal(),message:'private upstream credential'},{language});
    assert.match(text,language==='en'?/consistency.*stopped.*not retry/:language==='zh-Hant'?/一致性.*已停止.*不會自動重試/:/一致性.*已停止.*不会自动重试/);
    assert.doesNotMatch(text,/private upstream/);
  }
});

test('chart open failure interrupts once and fences all subsequent business recovery calls',async()=>{
  const h=harness();
  const pending=h.call('haolo_chart_open',{symbol:'BTCUSDT',interval:'1h'});
  const rejected=assert.rejects(pending,e=>e.code==='CHART_CONTEXT_UNAVAILABLE'&&e.terminal);
  await new Promise(resolve=>setImmediate(resolve));
  h.broker.resolve(h.sender,{requestId:h.events[0].requestId,error:'unavailable',errorDetails:{message:'unavailable',code:'CHART_CONTEXT_UNAVAILABLE',retryable:false}});
  await rejected;
  for(const [tool,args] of [['haolo_chart_open',{symbol:'BTCUSDT'}],['haolo_market',{operation:'context'}],['haolo_account_read',{}],['haolo_analysis',{strategyId:'chan'}]])
    await assert.rejects(h.call(tool,args),e=>e.terminal);
  assert.equal(h.stops.length,1);assert.equal(h.events.length,1);h.broker.cancel('thread');
});

test('serial strategies refresh stale account evidence once without requiring a model retry',async()=>{
  const h=harness();let reads=0,analyses=0;const forced=[];
  h.broker.accountRead=async args=>{reads++;forced.push(args.force);return {available:false};};
  h.context.executeTrading=async()=>{analyses++;return {result:{report:'verified report'}};};
  await h.call('haolo_analysis',{strategyId:'wyckoff'});
  h.context.accountReadAt=Date.now()-75_000;
  await h.call('haolo_analysis',{strategyId:'chan'});
  assert.equal(reads,2);assert.equal(analyses,2);assert.deepEqual(forced,[false,true]);
  await h.call('haolo_analysis',{strategyId:'price-action'});
  assert.equal(reads,2);assert.equal(analyses,3);h.broker.cancel('thread');
});

test('failure message names Chan, retains successful Wyckoff, and never claims a Chan result in three locales',()=>{
  for(const [language,strategyName,completed] of [['zh-CN','缠论','威科夫'],['zh-Hant','纏論','威科夫'],['en','Chan','Wyckoff']]){
    const message=tradingAnalysisStoppedMessage({code:'CHART_CONTEXT_UNAVAILABLE',message:'private detail'},
      {language,strategyName,completedStrategyNames:[completed]});
    assert.ok(message.includes(strategyName)&&message.includes(completed));
    assert.match(message,language==='en'?/did not complete; no conclusion.*retained/:/分析未完成.*未[生產].*結果?仍保留|分析未完成.*未生成.*结果仍保留/);
    assert.doesNotMatch(message,/private detail/);
  }
});

test('account refresh failure is visible before interrupt and cannot repeat the read or create an analysis',async()=>{
  const h=harness();let reads=0;h.context.completedStrategyIds=['wyckoff'];
  h.broker.accountRead=async()=>{reads++;throw Error('private network detail');};
  const pending=h.call('haolo_analysis',{strategyId:'chan'});
  const rejected=assert.rejects(pending,e=>e.code==='ACCOUNT_CONTEXT_UNAVAILABLE'&&e.terminal);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.stops.length,0);assert.equal(h.events.length,1);
  assert.equal(h.events[0].analysisFailure.strategyId,'chan');
  assert.deepEqual(h.events[0].analysisFailure.completedStrategyIds,['wyckoff']);
  h.broker.resolve(h.sender,{requestId:h.events[0].requestId,result:true});
  await rejected;assert.equal(h.stops.length,1);
  await assert.rejects(h.call('haolo_analysis',{strategyId:'chan'}),e=>e.terminal);
  assert.equal(reads,1);assert.equal(h.events.filter(x=>x.arguments?.action==='analyze_only').length,0);h.broker.cancel('thread');
});
