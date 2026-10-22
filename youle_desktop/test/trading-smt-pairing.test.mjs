import test from 'node:test';
import assert from 'node:assert/strict';
import {runSmtDivergenceEngine} from '../src/main/trading-analysis/smt-divergence-engine.mjs';
import {selectSmtPair} from '../src/main/trading-analysis/smt-pairing.mjs';
import {smtDiagnosticPresentation,validSmtDiagnostics} from '../src/shared/smt-diagnostics.mjs';

const context={policyVersion:'smt-pairing-v1'};
function fixture() {
  let close=100;
  const candles=Array.from({length:300},(_,i)=>{
    const open=close;close*=Math.exp(Math.sin(i*.37)*.004+Math.cos(i*.23)*.002);
    return {time:1700000100+i*900,open,close,high:Math.max(open,close)*1.001,low:Math.min(open,close)*.999,volume:100};
  });
  const snapshot={marketId:'BINANCE:FUTURES:SNDKUSDT',interval:'15',snapshotTime:(candles.at(-1).time+900)*1000,candles};
  const market={marketId:'BINANCE:FUTURES:MUUSDT',symbol:'MU',source:'binance-public',kind:'correlated-market',candles:structuredClone(candles)};
  return {snapshot,market};
}

test('fixed candidates are selected deterministically on pre-signal windows',()=>{
  const {snapshot,market}=fixture(),second={...structuredClone(market),marketId:'BINANCE:FUTURES:WDCUSDT',symbol:'WDC'};
  const a=selectSmtPair(snapshot,[second,market],context),b=selectSmtPair(snapshot,[market,second],context);
  assert.equal(a.selected.market.marketId,market.marketId);
  assert.equal(b.selected.market.marketId,market.marketId);
  assert.equal(a.selected.check.selectionCutoff,snapshot.candles.at(-19).time);
  assert.equal(a.selected.check.baselineReturnCount,159);
});

for(const [kind,expected] of [
  ['short','SMT_COMPARISON_HISTORY_SHORT'],['alignment','SMT_ALIGNMENT_LOW'],
  ['stale','SMT_COMPARISON_STALE'],['flat','SMT_CORRELATION_UNDEFINED'],
  ['timeout','SMT_SOURCE_TIMEOUT'],['missing','SMT_MARKET_NOT_LISTED'],
  ['baseline','SMT_BASELINE_HISTORY_SHORT'],['unstable','SMT_CORRELATION_UNSTABLE'],
])test(`specific diagnosis: ${kind}`,()=>{
  const {snapshot,market}=fixture();
  if(kind==='short')market.candles=market.candles.slice(-42);
  if(kind==='alignment')market.candles=market.candles.slice(-60);
  if(kind==='stale')market.candles=market.candles.slice(0,-5);
  if(kind==='flat')market.candles=market.candles.map(c=>({...c,open:100,close:100,high:101,low:99}));
  if(kind==='timeout'||kind==='missing'){market.candles=[];market.failureCode=expected;}
  if(kind==='baseline'){snapshot.candles=snapshot.candles.slice(-70);market.candles=market.candles.slice(-70);}
  if(kind==='unstable')market.candles=market.candles.map(c=>({...c,open:10000/c.open,close:10000/c.close,high:10000/c.low,low:10000/c.high}));
  const result=runSmtDivergenceEngine(snapshot,[market],context);
  assert.equal(result.diagnostics.code,expected);
  assert.equal(result.pairQualified,false);assert.equal(result.currentSignal,null);
  for(const language of ['zh-CN','en','zh-Hant']) {
    const presentation=smtDiagnosticPresentation(result.diagnostics,language);
    assert.ok(validSmtDiagnostics({...result.diagnostics,...presentation}));
    if(language==='en')assert.doesNotMatch(presentation.summary,/[\u4e00-\u9fff]/);
    assert.notEqual(presentation.summary,'相关市场数据不足');
  }
});

test('a genuine completed scan differs from missing data; future candles cannot alter qualification',()=>{
  const {snapshot,market}=fixture();
  const before=runSmtDivergenceEngine(snapshot,[market],context);
  assert.equal(before.diagnostics.code,'SMT_NO_DIVERGENCE');assert.equal(before.status,'succeeded');
  market.candles.push({...market.candles.at(-1),time:snapshot.snapshotTime/1000,close:999,high:1000});
  assert.deepEqual(runSmtDivergenceEngine(snapshot,[market],context).diagnostics,before.diagnostics);
});

test('new pairs require the full long background window before signal bars',()=>{
  const {snapshot,market}=fixture();
  snapshot.candles=snapshot.candles.slice(-177);market.candles=market.candles.slice(-177);
  assert.equal(selectSmtPair(snapshot,[market],context).diagnostic.code,'SMT_BASELINE_HISTORY_SHORT');
});

test('data coverage remains available when correlation is unsuitable',()=>{
  const {snapshot,market}=fixture();
  market.candles=market.candles.map(c=>({...c,open:10000/c.open,close:10000/c.close,high:10000/c.low,low:10000/c.high}));
  const result=runSmtDivergenceEngine(snapshot,[market],context);
  assert.equal(result.coverage.comparisonCandles,'available');assert.equal(result.pairQualified,false);
  const p={...result.diagnostics,...smtDiagnosticPresentation(result.diagnostics)};
  assert.equal(validSmtDiagnostics({...p,checks:[{...p.checks[0],correlation:NaN}]}),false);
});
