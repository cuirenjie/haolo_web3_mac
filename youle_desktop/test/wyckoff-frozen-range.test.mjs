import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {normalizeTradingMarketSnapshot} from '../src/main/trading-analysis/protocol.mjs';
import {runWyckoffTheoryEngine} from '../src/main/trading-analysis/wyckoff-engine.mjs';
import {buildWyckoffDrawingPatch, normalizeWyckoffModelReview, runTradingWyckoffAnalysisPipeline} from '../src/main/trading-analysis/wyckoff-pipeline.mjs';
import {translateTradingAnnotationText} from '../src/renderer/app-language.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/wyckoff-btc-retest-20261022.json',import.meta.url)));
const all=[...fixture.historyPrefix,...fixture.snapshot.candles];
const rows=all.slice(-240);
function params(candles=rows, now=fixture.snapshot.fetchedAt) {
  return {marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',snapshotTime:now,tickSize:fixture.snapshot.tickSize,
    candles:candles.map(c=>({...c,time:c.time/1000}))};
}
const analyze=(candles=rows, now)=>runWyckoffTheoryEngine(normalizeTradingMarketSnapshot(params(candles,now)));
const primary=analyze().structures.primaryCandidate;
const review={schemaVersion:1,verdict:'approve',summary:'Range and retest match the supplied evidence.',showProjectionZone:false};

test('real original 100 bars and partial candle preserve the incident input hash',()=>{
  assert.equal(normalizeTradingMarketSnapshot(params(fixture.snapshot.candles)).inputHash,fixture.provenance.originalInputHash);
  assert.equal(fixture.snapshot.candles.filter(c=>c.closeTime<=fixture.snapshot.fetchedAt).length,99);
});

test('real BTC preserves the pre-breakout box and confirms the observed 82624.1 retest',()=>{
  assert.equal(primary.pattern,'accumulation');
  assert.equal(primary.status,'confirmed');
  assert.ok(Math.abs(primary.range.support-fixture.expected.support)<1e-6);
  assert.ok(Math.abs(primary.range.resistance-fixture.expected.resistance)<1e-6);
  assert.equal(primary.range.frozen,true);
  const sos=primary.events.findLast(e=>e.code==='SOS');
  const lps=primary.events.find(e=>e.code==='LPS'&&e.price===fixture.expected.retestPrice);
  assert.equal(sos.status,'confirmed');assert.equal(lps.status,'confirmed');
  assert.ok(primary.range.baseEndTime<sos.time&&sos.time<lps.time);
  assert.equal(primary.events.at(-1).status,'tentative');
  assert.equal(primary.events.at(-1).time,rows.at(-1).time/1000);
  assert.ok(primary.events.some(e=>e.code==='SOS'&&e.status==='invalidated'));
});

test('240 and 600 bars select the same relevant box, with exact frozen boundaries and ID',()=>{
  const longer=analyze(all).structures.primaryCandidate;
  for(const field of ['id','support','resistance','baseEndTime','tolerance'])assert.equal(longer.range[field],primary.range[field],field);
});

test('prefix replays cannot use future candles to rewrite an already formed box',()=>{
  const firstBreak=primary.lifecycle.episodes[0].breakout;
  let verified=0;
  for(let n=firstBreak+1;n<rows.length;n+=7){
    const prefix=rows.slice(0,n), result=analyze(prefix,prefix.at(-1).closeTime);
    const candidate=result.structures.candidates.find(c=>c.range.id===primary.range.id);
    assert.ok(candidate,`frozen range at prefix ${n}`);
    for(const key of ['support','resistance','baseEndTime','tolerance'])assert.equal(candidate.range[key],primary.range[key]);
    assert.ok(candidate.events.every(e=>e.time<=prefix.at(-1).time/1000));
    verified++;
  }
  assert.ok(verified>=5);
});

test('late retest beyond fixed endpoint offsets and mirrored distribution are recognized',()=>{
  assert.ok(primary.events.findLast(e=>e.code==='LPS').candleIndex-primary.range.baseEndIndex>24);
  const mirrored=rows.map(c=>({...c,open:200000-c.open,close:200000-c.close,high:200000-c.low,low:200000-c.high}));
  const c=analyze(mirrored).structures.primaryCandidate;
  assert.equal(c.pattern,'distribution');assert.equal(c.status,'confirmed');
  assert.ok(Math.abs(c.range.support-(200000-primary.range.resistance))<1e-6);
  assert.ok(c.events.some(e=>e.code==='SOW'&&e.status==='confirmed'));
  assert.ok(c.events.some(e=>e.code==='LPSY'&&e.status==='confirmed'&&e.price===200000-fixture.expected.retestPrice));
});

test('a closed re-entry invalidates the current episode without erasing the frozen range',()=>{
  const changed=structuredClone(rows);
  const last=changed.at(-1), close=primary.range.resistance-primary.range.tolerance;
  Object.assign(last,{open:close+20,close,low:close-20,high:close+40});
  const c=analyze(changed,last.closeTime).structures.candidates.find(c=>c.range.id===primary.range.id&&c.pattern==='accumulation');
  assert.ok(c);assert.equal(c.status,'invalidated');
  assert.equal(c.events.findLast(e=>e.code==='SOS').status,'invalidated');
  assert.equal(c.range.resistance,primary.range.resistance);
});

test('open breakout never confirms SOS or phase D/E, and same bar cannot also be LPS',()=>{
  const firstBreak=primary.lifecycle.episodes[0].breakout, prefix=rows.slice(0,firstBreak+1);
  const result=analyze(prefix,prefix.at(-1).time+1800000);
  const c=result.structures.candidates.find(c=>c.range.id===primary.range.id&&c.pattern==='accumulation');
  assert.ok(c);assert.equal(c.events.findLast(e=>e.code==='SOS').status,'tentative');
  assert.ok(!c.events.some(e=>e.code==='LPS'));
  assert.ok(c.phases.filter(p=>['D','E'].includes(p.code)).every(p=>p.status==='tentative'));
});

test('trend with tiny alternating closes and isolated wick is not a two-sided range',()=>{
  for(const sign of [1,-1]){
    const trend=rows.map((c,i)=>{
      const close=1000+sign*(i*.35+(i%2)*.3);
      return {...c,open:close-sign*.1,close,high:close+.4+(i===80?8:0),low:close-.4,volume:100};
    });
    assert.equal(analyze(trend).structures.candidates.length,0);
  }
  assert.equal(analyze(rows.slice(-59)).structures.candidates.length,0);
});

test('model event subset cannot remove the latest breakout/retest, box stops at formation end',()=>{
  const snapshot=normalizeTradingMarketSnapshot(params()), theory=analyze();
  const selected=normalizeWyckoffModelReview(JSON.stringify({...review,selectedEventIds:[primary.events[0].id,'invented']}),theory);
  const patch=buildWyckoffDrawingPatch(snapshot,theory,selected);
  const drawings=patch.operations.map(o=>o.drawing);
  assert.equal(drawings.find(d=>d.tool==='rectangle').points[1].time,primary.range.baseEndTime);
  const lps=primary.events.find(e=>e.code==='LPS'&&e.price===82624.1);
  assert.ok(drawings.some(d=>d.evidenceIds.includes(lps.id)&&d.tool==='note'));
  const lifecycle=drawings.find(d=>d.id.endsWith('-breakout-retest'));
  assert.equal(lifecycle.status,'confirmed');
  assert.equal(lifecycle.points.at(-1).price,82624.1);
  assert.ok(lifecycle.points.some(p=>p.price===84875.2));
  assert.ok(drawings.some(d=>d.status==='tentative'&&d.text?.includes('仍待后续确认')));
  assert.ok(!drawings.some(d=>d.evidenceIds.includes('invented')));
  const automatic=normalizeWyckoffModelReview(JSON.stringify(review),theory);
  const failed=buildWyckoffDrawingPatch(snapshot,theory,automatic).operations.map(o=>o.drawing).filter(d=>d.text?.includes('已失效'));
  assert.ok(failed.length>0);
  assert.ok(failed.every(d=>d.status==='tentative'&&d.colorToken==='wyckoff-note'));
});

for(const language of ['zh-CN','en','zh-TW'])test(`real drawing/report states localize: ${language}`,async()=>{
  const result=await runTradingWyckoffAnalysisPipeline({...params(),language},{modelRegistry:{async analyze(){return {providerId:'fixture',modelId:'fixture',text:JSON.stringify(review)};}}});
  const notes=result.analysisPlan.drawingPatch.operations.map(o=>translateTradingAnnotationText(o.drawing.text||'',language)).join('\n');
  assert.ok(notes.includes('LPS')&&notes.includes('SOS'));
  assert.match(notes,language==='en'?/awaiting|confirmation/:language==='zh-TW'?/確認/:/确认/);
  if(language==='en')assert.ok(!/\p{Script=Han}/u.test(notes+result.analysisPlan.report));
});

function synthetic(baseCount, delay=30, sign=1) {
  const candles=Array.from({length:baseCount},(_,i)=>{
    const close=100+4*Math.sin(i*Math.PI/9),open=100+4*Math.sin((i-1)*Math.PI/9);
    return {open,close,high:Math.max(open,close)+.3,low:Math.min(open,close)-.3,volume:100};
  });
  candles.push({open:103,close:107,high:107.2,low:102.8,volume:300});
  for(let i=0;i<delay;i++)candles.push({open:110,close:110+(i%2)*.1,high:110.4,low:109.7,volume:100});
  candles.push({open:105.4,close:105,high:105.6,low:104.2,volume:50});
  return candles.map((c,i)=>({...c,...(sign<0?{open:200-c.open,close:200-c.close,high:200-c.low,low:200-c.high}:{}),
    time:1700000000000+i*3600000,closeTime:1700000000000+(i+1)*3600000}));
}

for(const size of [60,73,97,121,159,180])for(const sign of [1,-1])
test(`base length ${size}, direction ${sign}: delayed retest, no same-bar confirmation`,()=>{
  const candles=synthetic(size,45,sign), result=analyze(candles,candles.at(-1).closeTime);
  const c=result.structures.candidates.find(c=>c.direction===(sign>0?'bullish':'bearish')
    && c.events.some(e=>e.code===(sign>0?'LPS':'LPSY')&&e.time===candles.at(-1).time/1000));
  assert.ok(c);assert.ok(c.range.frozen);
  const breakout=c.events.findLast(e=>e.code===(sign>0?'SOS':'SOW'));
  const retest=c.events.findLast(e=>e.code===(sign>0?'LPS':'LPSY'));
  assert.equal(breakout.status,'confirmed');assert.equal(retest.status,'confirmed');
  assert.equal(breakout.candleIndex,size);assert.equal(retest.candleIndex,size+46);
  assert.ok(c.range.baseEndIndex<breakout.candleIndex);
});

test('a wick outside the box that closes inside never becomes SOS/SOW',()=>{
  for(const sign of [1,-1]){
    const candles=synthetic(97,0,sign).slice(0,98),last=candles.at(-1);
    Object.assign(last,sign>0?{open:103,close:102,high:108,low:101.8}:{open:97,close:98,high:98.2,low:92});
    const result=analyze(candles,last.closeTime);
    assert.ok(!result.structures.candidates.some(c=>c.events.some(e=>['SOS','SOW'].includes(e.code)&&e.candleIndex===97)));
  }
});
