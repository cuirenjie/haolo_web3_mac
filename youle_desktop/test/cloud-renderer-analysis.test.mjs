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
