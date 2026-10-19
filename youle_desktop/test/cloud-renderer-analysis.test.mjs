import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudAnalysisWindow} from '../src/renderer/cloud-analysis-window.ts';
import {setup} from './helpers/cloud-renderer-harness.mjs';
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
