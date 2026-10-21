import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { openBoundAnalysisChart } from '../src/renderer/trading-analysis-chart-context.ts';

const requested={marketId:'BINANCE:FUTURES:BTCUSDT',symbol:'BTCUSDT',interval:'60'};
const target={...requested,targetId:'old',storageSessionId:'thread',candles:[{close:1},{close:2}]};
function fixture(){
  const remembered=[],calls=[];let serial=0;
  const make=(session='thread',owner='owner')=>({
    analysisWorkspaceOwner:()=>owner,drawingStorageSessionMatches:id=>id===session,
    prepareAlertContext:async(market,interval,{assertActive,strictMarketId})=>{assertActive();assert.equal(strictMarketId,true);calls.push([market,interval]);},
    captureAnalysisTaskTarget:()=>({...target,targetId:`next-${++serial}`,candles:[{close:100},{close:101}]}),
  });
  const old=make();let active=old;
  const options={target,boundWorkspace:old,getActiveWorkspace:()=>active,requested,threadId:'thread',signal:new AbortController().signal,remember:(...x)=>remembered.push(x)};
  return {make,old,options,calls,remembered,setActive:value=>{active=value;}};
}
test('same conversation rebuild binds current chart and returns freshly captured candles',async()=>{
  const h=fixture(),rebuilt=h.make();h.setActive(rebuilt);
  h.old.prepareAlertContext=()=>{throw Error('must not access destroyed workspace');};
  const next=await openBoundAnalysisChart(h.options);
  assert.equal(next.candles[0].close,100);assert.equal(h.remembered[0][1],rebuilt);assert.equal(h.calls.length,1);
  assert.equal(target.candles[0].close,1,'frozen old evidence remains intact');
});
test('different conversation/account, released target and missing chart cannot rebind',async()=>{
  for(const mode of ['conversation','account','released','missing','target-session']){
    const h=fixture();
    if(mode==='conversation')h.setActive(h.make('other'));
    if(mode==='account')h.setActive(h.make('thread','other'));
    if(mode==='released')h.options.boundWorkspace=undefined;
    if(mode==='missing')h.setActive(null);
    if(mode==='target-session')h.options.target={...target,storageSessionId:'other'};
    await assert.rejects(openBoundAnalysisChart(h.options),e=>e.code==='CHART_CONTEXT_UNAVAILABLE'&&e.terminal);
    assert.equal(h.calls.length,0);assert.equal(h.remembered.length,0);
  }
});
test('one rebuild during loading is retried internally; repeated rebuilds terminate',async()=>{
  for(const twice of [false,true]){
    const h=fixture(),second=h.make(),third=h.make();
    h.old.prepareAlertContext=async(_m,_i,{assertActive})=>{h.setActive(second);assertActive();};
    if(twice)second.prepareAlertContext=async(_m,_i,{assertActive})=>{h.setActive(third);assertActive();};
    if(twice)await assert.rejects(openBoundAnalysisChart(h.options),e=>e.code==='CHART_CONTEXT_UNAVAILABLE');
    else {await openBoundAnalysisChart(h.options);assert.equal(h.remembered[0][1],second);}
    assert.equal(h.remembered.length,twice?0:1);
  }
});
test('cancellation, foreign replacement and invalid snapshots never publish a target',async()=>{
  for(const mode of ['abort','foreign','market','interval','session','candles']){
    const h=fixture(),controller=new AbortController();h.options.signal=controller.signal;
    if(mode==='abort')h.old.prepareAlertContext=async()=>controller.abort();
    else if(mode==='foreign')h.old.prepareAlertContext=async()=>h.setActive(h.make('other'));
    else h.old.captureAnalysisTaskTarget=()=>({...target,...{
      market:{marketId:'BINANCE:SPOT:BTCUSDT'},interval:{interval:'240'},session:{storageSessionId:'other'},candles:{candles:[]},
    }[mode]});
    await assert.rejects(openBoundAnalysisChart(h.options));assert.equal(h.remembered.length,0);
  }
});
test('same-chart load errors are not retried; explicit market and interval remain authoritative',async()=>{
  const h=fixture();let tries=0;
  h.old.prepareAlertContext=async()=>{tries++;throw Error('network failed');};
  await assert.rejects(openBoundAnalysisChart(h.options),/network failed/);assert.equal(tries,1);
  const g=fixture();g.options.requested={marketId:'BINANCE:SPOT:ETHUSDT',symbol:'ETHUSDT',interval:'240'};
  g.old.captureAnalysisTaskTarget=()=>({...target,...g.options.requested});
  await openBoundAnalysisChart(g.options);assert.deepEqual(g.calls,[[g.options.requested.marketId,'240']]);
});
test('production chart opener delegates the captured binding and registers the replacement',async()=>{
  const source=fs.readFileSync(new URL('../src/renderer/trading-expert-market.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('market.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='openTradingExpertAnalysisChart');
  const code=ts.transpileModule(fn.getText(ast).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const h=fixture(),active=h.make(),bindings=new Map([['old',h.old]]);
  const scope={openBoundAnalysisChart,activeWorkspace:active,tradingAnalysisTargetWorkspaces:bindings};vm.runInNewContext(code,scope);
  const next=await scope.openTradingExpertAnalysisChart(target,requested,'thread',new AbortController().signal);
  assert.equal(bindings.get(next.targetId),active);
});
