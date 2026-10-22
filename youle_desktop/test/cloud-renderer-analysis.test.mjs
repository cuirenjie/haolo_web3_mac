import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudAnalysisWindow} from '../src/renderer/cloud-analysis-window.ts';
import {setup} from './helpers/cloud-renderer-harness.mjs';

test('text reveal and drawing run concurrently; completion waits for both in either finish order',async()=>{
  for(const first of ['text','drawing']) {
    let textStarted=false,drawingStarted=false,releaseText,releaseDrawing;
    const textGate=new Promise(r=>releaseText=r),drawingGate=new Promise(r=>releaseDrawing=r);
    const s=setup({dependencyOverrides:{commitTradingAnalysisDrawingPatch:async()=>{drawingStarted=true;await drawingGate;}}});
    const pending=s.workspace.runGeneralConversation({instruction:'@策略:裸K',pureReferenceAnalysis:true,onReportReady:async(_result,isActive)=>{
      textStarted=true;assert.equal(isActive(),true);await textGate;
    }},'price-action');
    await new Promise(r=>setImmediate(r));assert.equal(textStarted,true);assert.equal(drawingStarted,true);assert.deepEqual(s.finished,[]);
    (first==='text'?releaseText:releaseDrawing)();await new Promise(r=>setImmediate(r));assert.deepEqual(s.finished,[]);
    (first==='text'?releaseDrawing:releaseText)();await pending;assert.deepEqual(s.finished,['test-job']);
  }
});

test('pure-reference reports include all panes before playback; original jobs stay cancellable until drawings settle',async()=>{
  let release,ready=false;const gate=new Promise(r=>release=r),drawn=[];
  const s=setup({dependencyOverrides:{commitTradingAnalysisDrawingPatch:async(job,patch,pane,_onPhase,shouldContinue,speedMultiplier)=>{assert.equal(ready,true);assert.equal(s.finished.length,0);assert.equal(shouldContinue(),true);assert.equal(speedMultiplier,1.3);drawn.push(pane);await gate;}}});
  const pending=s.workspace.runGeneralConversation({instruction:'@策略:缠论',pureReferenceAnalysis:true,onReportReady:result=>{
    assert.equal(s.calls.length,2);assert.equal(result.report,'Canonical server report');ready=true;
  }},'chan');
  await new Promise(r=>setImmediate(r));assert.equal(ready,true);assert.deepEqual(drawn,[0]);assert.deepEqual(s.finished,[]);
  release();await pending;assert.deepEqual(drawn,[0,1]);assert.deepEqual(s.finished,['test-job']);
  assert.ok(s.calls.every(call=>call.pureReferenceAnalysis===true));
});

test('ordinary analysis never enables event delivery or an early-report callback',async()=>{
  let ready=false;const s=setup();await s.workspace.runGeneralConversation({instruction:'analyze',onReportReady:()=>{ready=true;}},'chan');
  assert.equal(ready,false);assert.ok(s.calls.every(call=>call.pureReferenceAnalysis===undefined));
  assert.ok(s.drawings.every(drawing=>drawing.speedMultiplier===undefined));
});

test('drawing errors after early publication retain the report and plan, with an explicit drawing failure',async()=>{
  let early;
  const s=setup({dependencyOverrides:{commitTradingAnalysisDrawingPatch:async()=>{throw Error('drawing storage failed');}}});
  const result=await s.workspace.runGeneralConversation({instruction:'@指标:MACD',pureReferenceAnalysis:true,onReportReady:r=>{early=r.report;}},'macd-analysis');
  assert.equal(early,'Canonical server report');assert.equal(result.drawingDeferred,true);assert.ok(result.report.startsWith(early));assert.ok(result.report.length>early.length);
});

test('stop during early-report playback prevents later panes and never completes the job',async()=>{
  let active=true,ready=false;const drawn=[];
  const s=setup({dependencyOverrides:{tradingAnalysisJobs:{start:x=>({...x,analysisId:'job'}),isActive:()=>active,complete:()=>assert.fail('cancelled job completed'),fail:()=>{}},
    commitTradingAnalysisDrawingPatch:async(_job,_patch,pane)=>{assert.equal(ready,true);drawn.push(pane);active=false;throw Error('盘面分析已由用户停止');}}});
  await assert.rejects(s.workspace.runGeneralConversation({instruction:'@策略:缠论',pureReferenceAnalysis:true,onReportReady:()=>{ready=true;}},'chan'),/停止/);
  assert.deepEqual(drawn,[0]);
});
for(const [method,id] of [['runChanConversation','chan'],['runWaveConversation','wave'],['runWyckoffConversation','wyckoff'],['runOrderFlowConversation','order-flow'],['runGeneralConversation',undefined]]) {
  test(`${method} completes from empty local candles and preserves original chat and pane targets`,async()=>{
    const s=setup();const result=await s.workspace[method]({sourceThreadId:'original-chat',instruction:'analyze'});
    assert.equal(result.report,'Canonical server report');assert.equal(result.candleCount,84);
    assert.equal(s.calls.length,2);assert.equal(s.calls[0].strategyId,id);assert.equal(s.calls[1].marketId,'BINANCE:FUTURES:ETHUSDT');
    assert.equal(s.calls[1].analysisJobId,'test-job:pane:1');
    for(const call of s.calls) {assert.equal(call.sourceThreadId,'original-chat');assert.equal(call.storageSessionId,'original-thread');
      for(const key of ['candles','contextCandles','comparisonMarkets','orderFlow'])assert.equal(call[key],undefined);}
    assert.deepEqual(s.drawings.map(x=>x.pane),[0,1]);assert.deepEqual(s.indicatorDrawings.map(x=>x.pane),[0,1]);assert.deepEqual(s.finished,['test-job']);
  });
}
test('cloud failure is surfaced once with no local strategy retry',async()=>{
  const s=setup({apiFailure:true});await assert.rejects(s.workspace.runWaveConversation({instruction:'analyze'}),e=>e.code==='ENTRY_WORKER_UNAVAILABLE');
  assert.equal(s.calls.length,1);assert.deepEqual(s.drawings,[]);assert.deepEqual(s.failed,['ENTRY_WORKER_UNAVAILABLE']);
});

test('nonretryable split-pane errors stop immediately and prevent queued panes or late drawings',async()=>{
  const s=setup(),submitted=[],reports=[];
  let finishLate;
  const snapshots=Array.from({length:4},(_,i)=>({paneIndex:i+1,market:{id:'BTCUSDT'},interval:'60',candles:[]}));
  const options={job:{analysisId:'job',language:'en'},snapshots,snapshotFailures:[],minimumCandles:0,
    analysisLabel:'analysis',analysisProgressPhase:'analyzing',drawingProgressPhase:'drawing',drawingsRequested:true,
    onProgress:(_phase,message)=>reports.push(message),analyze:async snapshot=>{
      submitted.push(snapshot.paneIndex);
      if(snapshot.paneIndex===1)return {ok:false,error:{code:'CLOUD_RESULT_CONTEXT_INVALID',retryable:false,message:'mismatch'}};
      return new Promise(resolve=>{finishLate=resolve;});
    }};
  await assert.rejects(s.workspace.runSplitPaneAnalyses(options),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID'&&e.retryable===false);
  assert.deepEqual(submitted,[1,2]);assert.equal(reports.length,1,'no misleading completion notification');
  finishLate({ok:true,analysisPlan:{report:'late report',drawingPatch:{operations:[]}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(submitted,[1,2]);assert.equal(s.drawings.length,0);
  const transient=await s.workspace.runSplitPaneAnalyses({...options,analyze:async()=>({ok:false,error:{code:'REQUEST_TIMEOUT',retryable:true,message:'timeout'}})});
  assert.equal(transient.failed,4,'retryable pane failures retain partial-result behavior');
});
test('VPVR requires a bounded real viewport while ordinary analysis only sends a count',()=>{
  assert.deepEqual(cloudAnalysisWindow('wave',[]),{analysisWindowCount:100});
  assert.throws(()=>cloudAnalysisWindow('vpvr-analysis',[]),/VPVR_VISIBLE_RANGE_REQUIRED/);
  const bars=Array.from({length:20},(_,i)=>({time:1700000000+i*60,close:999}));
  assert.deepEqual(cloudAnalysisWindow('vpvr-analysis',bars),{analysisWindowCount:20,visibleRange:{visibleFrom:1700000000000,visibleTo:1700001140000}});
});

test('bare strategy selection supplies enough server history for order flow and Dow on every pane',async()=>{
  for(const strategyId of ['order-flow','dow-theory']) {
    const s=setup();
    s.workspace.candles=Array.from({length:100},(_,i)=>({time:1700000000+i*3600}));
    await s.workspace.runGeneralConversation({instruction:'analyze'},strategyId);
    assert.equal(s.calls.length,2);
    for(const call of s.calls)assert.equal(call.analysisWindowCount,120,`${strategyId}/${call.marketId}`);
  }
});

test('all official strategy windows cover admission history including one forming bar',async()=>{
  const {OFFICIAL_TRADING_CATALOG}=await import('../src/shared/official-trading-catalog.mjs');
  // Independent API contract: [minimum total, minimum closed].
  const admission={chan:[30,30],wave:[30,30],wyckoff:[60,60],'order-flow':[120,119],
    'dow-theory':[120,119],'gann-theory':[80,79],'price-action':[80,80],'ict-smc':[80,80],
    'smt-divergence':[80,80],harmonic:[80,80],'chart-patterns':[80,80],
    'moving-average-analysis':[90,90],'macd-analysis':[80,80],'bollinger-bands-analysis':[80,80],
    'rsi-analysis':[80,80],'kdj-analysis':[80,80]};
  assert.deepEqual(OFFICIAL_TRADING_CATALOG.map(s=>s.id).filter(id=>id!=='vpvr-analysis').sort(),Object.keys(admission).sort());
  for(const [id,[total,closed]] of Object.entries(admission)) {
    for(const size of [0,20,80,100,119,120,300,650]) {
      const candles=Array.from({length:size},(_,i)=>({time:1700000000+i*3600}));
      const {analysisWindowCount:count}=cloudAnalysisWindow(id,candles,20);
      assert.ok(count>=total && count-1>=closed,`${id}: ${count} does not meet admission`);
      assert.ok(count>=Math.min(size,600)&&count<=600);
    }
  }
});

test('captured order flow targets request sufficient history without changing chart identity',async()=>{
  const s=setup();
  await s.workspace.runOrderFlowConversation({instruction:'analyze',analysisTarget:{
    market:s.workspace.selectedMarketMeta,symbol:'BTCUSDT',interval:'60',storageSessionId:'captured-pane',
    visibleCandles:Array.from({length:100},(_,i)=>({time:1700000000+i*3600})),
  }});
  assert.equal(s.calls.length,1);
  assert.equal(s.calls[0].analysisWindowCount,120);
  assert.equal(s.calls[0].storageSessionId,'captured-pane');
  assert.equal(s.calls[0].marketId,'BINANCE:FUTURES:BTCUSDT');
});
