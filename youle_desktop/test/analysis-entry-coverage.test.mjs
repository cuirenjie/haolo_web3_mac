import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {waitForAnalysisAdmission} from '../src/main/trading-strategy-runtime/admission-recovery.mjs';

const source=fs.readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('main.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=new Map(ast.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name.text,n.getText(ast)]));
const handlers=new Map();
for(const node of ast.statements){
  if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(ast)==='ipcMain.handle'){
    const [name,callback]=node.expression.arguments;handlers.set(name.text,callback.getText(ast));
  }
}
for(const entry of ['strategy','general','automation'])test(`${entry} actual host entry propagates stop and progress before any paid admission`,async()=>{
  const controller=new AbortController();let ready,reads=0,paid=0,finished=0;const events=[];
  const waiting=new Promise(r=>ready=r);
  const context={
    assertExternalModelsIpcSender:()=>{},assertExecutionModelMembership:async()=>{},requireFreshTradingPremiumAccess:async()=>{},
    sendToEventSender:(sender,...args)=>sender.send(...args),
    firstString:(...x)=>x.find(Boolean),isPersonalStrategyId:()=>false,appLanguage:()=> 'zh-CN',normalizeAppLanguage:x=>x,
    beginTradingAnalysisRequest:()=>({controller,controllerKey:'key'}),finishTradingAnalysisRequest:()=>finished++,
    normalizeTradingAnalysisJobId:p=>p.analysisJobId,recordTradingAnalysisFailure:()=> 'diagnostic',
    cloudStrategyFailure:(_e,{aborted})=>({code:aborted?'TRADING_ANALYSIS_CANCELLED':'unexpected'}),
    getCloudStrategyRuntime:()=>({run:async()=>{paid++;}}),
    resolveTradingAutomationAnalysis:()=>({mode:'analysis',provider:'binance',marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60'}),
    getAutomationStore:()=>({appendRunEvent:async(_id,e)=>events.push(e)}),
    tradingStrategyParamsWithPersonalRisk:async(p,options={})=>{
      assert.equal(options.signal,controller.signal);assert.equal(typeof options.onProgress,'function');
      return waitForAnalysisAdmission({...options,assertOwner:async()=>{},
        request:async()=>{reads++;throw Object.assign(Error('busy'),{code:'MOBILE_BUSY',status:429});},
        wait:async(_ms,_value,{signal})=>{ready();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
    },
  };
  const text=entry==='general'?handlers.get('tradingAnalysis:runGeneral'):functions.get(entry==='strategy'?'runTradingStrategyRequest':'executeTradingAutomationAnalysis');
  const invoke=vm.runInNewContext(`(${text})`,context);
  const event={sender:{isDestroyed:()=>false,send:(...x)=>events.push(x)}},params={analysisJobId:'job'};
  const work=entry==='automation'?invoke({job:{},run:{id:'run'},prompt:'分析',abortController:controller,eventWrites:[]}):
    entry==='strategy'?invoke(event,'price-action',params):invoke(event,params);
  const outcome=work.then(value=>({value}),error=>({error}));
  await Promise.race([waiting,outcome.then(result=>{throw result.error||Error('entry completed before admission');})]);
  controller.abort();const result=await outcome;
  assert.equal(reads,1);assert.equal(paid,0);assert.ok(events.length>0);
  if(entry==='automation')assert.equal(result.error.name,'AbortError');
  else {assert.equal(result.value.error.code,'TRADING_ANALYSIS_CANCELLED');assert.equal(finished,1);}
});

test('all legacy named analysis IPC aliases invoke the shared strategy entry',async()=>{
  for(const [name,id] of [['runChanTest','chan'],['runOrderFlow','order-flow'],['runWave','wave'],['runWyckoff','wyckoff']]){
    const seen=[];const invoke=vm.runInNewContext(`(${handlers.get(`tradingAnalysis:${name}`)})`,{
      assertExternalModelsIpcSender:()=>{},runTradingStrategyRequest:async(...args)=>seen.push(args),
    });
    await invoke({sender:{}},{analysisJobId:'shared'});assert.equal(seen[0][1],id);assert.equal(seen[0][2].analysisJobId,'shared');
  }
});
