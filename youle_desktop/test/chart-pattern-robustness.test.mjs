import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTradingMarketSnapshot } from "../src/main/trading-analysis/protocol.mjs";
import { evaluateChannelOrBroadening, evaluateRounding, evaluateInverseCup, evaluateOldDuckHead, evaluateDiamond } from "../src/main/trading-analysis/chart-pattern-extended-engine.mjs";
import { evaluateWedgeReversal, evaluateFivePointReversal } from "../src/main/trading-analysis/chart-pattern-reversal-engine.mjs";
import { runChartPatternEngine } from "../src/main/trading-analysis/chart-pattern-engine.mjs";
import { runTradingChartPatternAnalysisPipeline, buildChartPatternActionPlan, buildChartPatternDrawingPatch, buildChartPatternReport } from "../src/main/trading-analysis/chart-pattern-pipeline.mjs";
import { patternBreakoutWindow, resolvePatternLifecycle, findClosedBreakout } from "../src/main/trading-analysis/chart-pattern-common.mjs";
import { chartPatternContext } from "../src/main/trading-analysis/chart-pattern-context.mjs";
import { evaluateFlagOrPennant } from "../src/main/trading-analysis/chart-pattern-continuation-engine.mjs";
import { evaluateBilateralPattern } from "../src/main/trading-analysis/chart-pattern-bilateral-engine.mjs";
import { translateTradingAnnotationText } from "../src/renderer/app-language.mjs";
import { withTradingReportLanguage } from "../src/main/trading-analysis/report-language.mjs";
const START = 1700000000;

test("lifecycle respects terminal chronology, breakout-candle targets and pre-breakout invalidation", () => {
  const levels={trigger:100,stop:90,targets:[105,110]};
  const state=values=>resolvePatternLifecycle(snapshot(values),{breakout:{state:'failed',index:3,failedAtIndex:4,buffer:0.2},
    actionLevels:levels,direction:'bullish',lastStructureIndex:2,structureDuration:20});
  assert.equal(state([95,95,95,111,98]).lifecycle,'completed');
  assert.equal(state([95,95,95,102,98,111]).lifecycle,'failed');
  const before=resolvePatternLifecycle(snapshot([95,95,95,89,102]),{breakout:{state:'confirmed',index:4,buffer:0.2},
    actionLevels:levels,direction:'bullish',lastStructureIndex:2,structureDuration:20});
  assert.equal(before.terminalReason,'structural-stop-crossed-before-breakout');
});

test("retest follows the sloping breakout boundary instead of a stale fixed trigger", () => {
  const s=snapshot([95,96,97,102,100.1,99.1]);
  const breakout={state:'confirmed',index:3,direction:'up',boundary:101,boundarySlope:-1,buffer:0.2};
  const c={id:'small',direction:'bullish',points:pivots(s,[[0,95],[1,96],[2,97]]),breakout,
    actionLevels:{trigger:101,stop:90,targets:[110,120]},lifecycleState:{terminalIndex:null}};
  assert.equal(resolvePatternLifecycle(s,{...c,lastStructureIndex:2,structureDuration:20}).lifecycle,'confirmed');
  assert.equal(chartPatternContext(s,c).retest.state,'held');
});

test("future price does not rewrite the breakout buffer and missing volume stays unknown", () => {
  const s=snapshot([99,99,99,100.2,101]);
  const later=snapshot([99,99,99,100.2,101,10000]);
  assert.deepEqual(findClosedBreakout(s,2,100,null,1),findClosedBreakout(later,2,100,null,1));
  const c={id:'x',direction:'neutral',points:pivots(s,[[0,99],[1,99],[2,99]]),breakout:{state:'developing'}};
  const noVolume={...s,candles:s.candles.map(b=>({...b,volume:0}))};
  assert.equal(chartPatternContext(noVolume,c).volume.formationRatio,null);
});

test("long flags retain impulse, retracement and boundary constraints", () => {
  const nodes=[[20,140],[40,130],[60,138],[80,128],[99,136]];
  const s=snapshot(controls([[0,98],[10,100],...nodes,[102,140]]));
  const c=evaluateFlagOrPennant(s,{...pivots(s,[[10,100]],'low')[0]},pivots(s,nodes),{atr:1});
  assert.equal(c?.patternId,'bull-flag');
  assert.ok(c.metrics.retracement<0.52);
});

test("multi-session flags exceed 120 bars without accepting unbounded duration or deep retracement", () => {
  const nodes=[[30,140],[80,130],[130,138],[180,128],[222,136]];
  const values=controls([[0,98],[10,100],...nodes,[225,139]]), s=snapshot(values);
  const flag=(data, ps, start=100, first='high')=>evaluateFlagOrPennant(data,pivots(data,[[10,start]],first==='high'?'low':'high')[0],pivots(data,ps,first),{atr:1});
  assert.equal(flag(s,nodes)?.patternId,'bull-flag');
  const r=snapshot(mirror(values));
  assert.equal(flag(r,nodes.map(([i,p])=>[i,350-p]),250,'low')?.patternId,'bear-flag');
  const longNodes=nodes.map(([i,p])=>[30+(i-30)*2,p]),long=snapshot(controls([[0,98],[10,100],...longNodes]));
  assert.equal(flag(long,longNodes),null);
  const deep=nodes.map(([i,p],n)=>[i,n%2?p-20:p]);
  assert.equal(flag(snapshot(controls([[0,98],[10,100],...deep])),deep),null);
});

test("head-and-shoulders can continue an established trend, with mirrored direction and neckline confirmation", () => {
  const nodes=[[30,110],[40,100],[50,120],[60,100],[70,110]];
  const s=snapshot(controls([[0,150],...nodes,[74,98]]));
  const top=evaluateFivePointReversal(s,pivots(s,nodes),{atr:1}).find(c=>c.patternId==='head-and-shoulders-top');
  assert.equal(top?.category,'continuation');
  assert.equal(top.breakout.direction,'down');
  const r=snapshot(mirror(s.candles.map(b=>b.close)));
  const bottom=evaluateFivePointReversal(r,pivots(r,nodes.map(([i,p])=>[i,350-p]),'low'),{atr:1})[0];
  assert.equal(bottom?.category,'continuation');
  assert.equal(bottom.breakout.direction,'up');
});

test("nearby parent boundary suppresses entry levels but preserves native-tool geometry and localized explanation", async () => {
  const s=snapshot(controls([[0,80],[30,110],[40,95],[50,109],[54,98]]));
  const child={id:'child-room',patternId:'double-top',patternName:'双顶',category:'reversal',direction:'bearish',
    tradeState:'awaiting-breakout',lifecycle:'developing',score:0.8,height:14,
    points:pivots(s,[[30,110],[40,95],[50,109]]).map((p,i)=>({...p,id:'point-'+i,label:'P'+i})),
    actionLevels:{trigger:95,stop:110,targets:[86,80]},breakout:{state:'developing'},evidenceIds:['child-room']};
  const parent={id:'parent-room',patternName:'下降通道',tradeState:'awaiting-breakout',direction:'neutral',
    points:pivots(s,[[0,120],[45,90]]),boundaries:{upper:{slope:0,intercept:120},lower:{slope:0,intercept:90}}};
  child.context=chartPatternContext(s,child,[parent,child]);
  assert.equal(child.context.parentRoom.state,'limited');
  assert.ok(child.context.parentRoom.rewardRisk<1);
  const action=buildChartPatternActionPlan(s,child);
  assert.equal(action.primaryBias,'neutral');
  assert.equal(action.shortTrigger,undefined);
  const theory={structures:{primaryActiveCandidate:child,displayCandidates:[child]},pivots:{profiles:[]},engine:{subengines:[]}};
  const patch=buildChartPatternDrawingPatch(s,theory);
  assert.ok(patch.operations.some(o=>o.drawing.id.endsWith('-structure')));
  assert.ok(!patch.operations.some(o=>/-level-/.test(o.drawing.id)));
  const english=await withTradingReportLanguage('en',()=>buildChartPatternReport(s,theory));
  assert.match(english,/insufficient room/i);
  assert.doesNotMatch(english,/[\p{Script=Han}]/u);
  assert.equal(chartPatternContext(s,child,[{...parent,metrics:{apexIndex:null}},child]).parentId,parent.id);
  assert.equal(chartPatternContext(s,child,[{...parent,metrics:{apexIndex:50}},child]).parentId,null);
  assert.equal(chartPatternContext(s,child,[{...parent,tradeState:'expired'},child]).parentRoom,null);
  const crossed={...s,candles:s.candles.map((b,i)=>i===54?{...b,close:85,low:84}:b)};
  assert.equal(chartPatternContext(crossed,child,[parent,child]).parentRoom,null);
});

test("climactic first test with weak retest is symmetric evidence, never a standalone entry", () => {
  const values=controls([[0,90],[40,110],[50,100],[60,110.2],[65,108]]);
  const volumes=values.map((_,i)=>i===40?4000:1000),s=snapshot(values,volumes);
  const c={id:'volume-context',direction:'bearish',points:pivots(s,[[40,110],[50,100],[60,110.2]]),breakout:{state:'developing'}};
  const evidence=chartPatternContext(s,c).climaxRetest;
  assert.equal(evidence.state,'observed');
  assert.equal(buildChartPatternActionPlan(s,c).primaryBias,'neutral');
  const r=snapshot(mirror(values),volumes),rc={...c,direction:'bullish',points:pivots(r,[[40,240],[50,250],[60,239.8]],'low')};
  assert.deepEqual(chartPatternContext(r,rc).climaxRetest,evidence);
  const missing={...s,candles:s.candles.map((b,i)=>i===35?{...b,volume:0}:b)};
  assert.equal(chartPatternContext(missing,c).climaxRetest.state,'unavailable');
  const strong=snapshot(values,volumes.map((v,i)=>i===60?5000:v));
  assert.equal(chartPatternContext(strong,c).climaxRetest.state,'not-observed');
});

test("bilateral parent room is checked separately for each direction in plans, reports and drawings", async () => {
  const nodes=[[30,102],[35,98],[40,102],[45,98],[50,102],[55,98]],s=snapshot(controls([[0,100],...nodes,[59,100]]));
  const child=evaluateBilateralPattern(s,pivots(s,nodes),{atr:1});
  assert.equal(child?.patternId,'rectangle');
  const parent={id:'wide-parent',patternName:'矩形整理',tradeState:'awaiting-breakout',direction:'neutral',
    points:pivots(s,[[0,104],[50,80]]),boundaries:{upper:{slope:0,intercept:104},lower:{slope:0,intercept:80}}};
  const c={...child,context:chartPatternContext(s,child,[parent,child])};
  assert.deepEqual(c.context.blockedDirections,['bullish']);
  assert.equal(c.context.entryBlockedReason,null);
  const action=buildChartPatternActionPlan(s,c);
  assert.equal(action.longTrigger,undefined);
  assert.ok(action.shortTrigger>0);
  const theory={structures:{primaryActiveCandidate:c,displayCandidates:[c]},pivots:{profiles:[]},engine:{subengines:[]}};
  const english=await withTradingReportLanguage('en',()=>buildChartPatternReport(s,theory));
  assert.doesNotMatch(english,/[\p{Script=Han}]/u);
  assert.match(english,/Long: limited room/);
  const patch=buildChartPatternDrawingPatch(s,theory);
  assert.equal(patch.operations.filter(o=>/-level-/.test(o.drawing.id)).length,4);
  const bothParent={...parent,boundaries:{...parent.boundaries,lower:{slope:0,intercept:96}}};
  const both={...child,context:chartPatternContext(s,child,[bothParent,child])};
  assert.equal(both.context.blockedDirections.length,2);
  assert.equal(buildChartPatternActionPlan(s,both).shortTrigger,undefined);
});

test("post-retest contraction needs three observed bars and disappears when the boundary fails", () => {
  const values=controls([[0,90],[20,100],[25,98],[30,100],[31,101],[32,100.8],[33,100.8],[34,100.9],[35,100.8]]);
  let s=snapshot(values);
  s={...s,candles:s.candles.map((b,i)=>i<=30?{...b,high:b.close+1,low:b.close-1}:b)};
  const c={id:'compression',direction:'bullish',tradeState:'active',points:pivots(s,[[20,100],[25,98],[30,100]]),
    breakout:{state:'confirmed',index:31,direction:'up',boundary:100.5,buffer:0.1}};
  assert.equal(chartPatternContext(s,c).retestCompression.state,'contracted');
  assert.equal(chartPatternContext({...s,candles:s.candles.slice(0,33)},c).retestCompression.state,'unavailable');
  const failed={...s,candles:s.candles.map((b,i)=>i===35?{...b,close:100,low:99.8}:b)};
  assert.equal(chartPatternContext(failed,c).retestCompression.state,'unavailable');
  assert.equal(chartPatternContext(failed,c).retest.state,'failed');
});

test("triangles and pennants cannot confirm after their boundaries have crossed", () => {
  const nodes=[[20,140],[30,122],[40,132],[50,126]];
  const s=snapshot(controls([[0,98],[10,100],...nodes,[51,127.5],[52,127.1],[53,126.8],[54,130]]));
  const points=pivots(s,nodes);
  const pennant=evaluateFlagOrPennant(s,pivots(s,[[10,100]],'low')[0],points,{atr:1});
  const triangle=evaluateBilateralPattern(s,points,{atr:1});
  for (const candidate of [pennant,triangle]) {
    assert.ok(candidate);
    assert.ok(candidate.metrics.apexIndex < 54);
    assert.equal(candidate.breakout.state,'developing');
    assert.equal(candidate.lifecycle,'expired');
  }
});

test("nested evidence is explicitly same timeframe and records competing active directions", () => {
  const s=snapshot(Array.from({length:100},(_,i)=>100+i/100));
  const parent={id:'parent',patternName:'上升通道',direction:'bullish',tradeState:'awaiting-breakout',
    points:pivots(s,[[10,110],[90,95]]),boundaries:{upper:{slope:0,intercept:120},lower:{slope:0,intercept:80}}};
  const child={id:'child',direction:'bearish',tradeState:'awaiting-breakout',points:pivots(s,[[40,105],[55,100],[65,104]]),breakout:{state:'developing'}};
  const context=chartPatternContext(s,child,[parent,child]);
  assert.equal(context.parentId,'parent');
  assert.equal(context.scope,'same-timeframe-multiple-scales');
  assert.deepEqual(context.conflictingCandidateIds,['parent']);
});
function snapshot(values, volumes = []) {
  const input = { marketId: "BINANCE:FUTURES:TESTUSDT", interval: "60",
    snapshotTime: (START + values.length * 3600) * 1000,
    candles: values.map((c, i) => ({time: START + i * 3600, open: c, close: c, high: c + 0.15, low: c - 0.15, volume: volumes[i] ?? 1000})) };
  // Focused lifecycle units use short sequences; end-to-end tests use the real normalizer.
  return values.length < 30 ? input : normalizeTradingMarketSnapshot(input);
}
function controls(items, count = items.at(-1)[0] + 1) {
  return Array.from({length: count}, (_, i) => {
    const right = items.findIndex(p => p[0] >= i);
    if (right <= 0) return items[right < 0 ? items.length - 1 : 0][1];
    const a = items[right - 1], b = items[right];
    return a[1] + (b[1] - a[1]) * (i - a[0]) / (b[0] - a[0]);
  });
}
function pivots(s, items, first = "high") {
  return items.map(([index, price], i) => ({ index, price, time: s.candles[index].time,
    type: i % 2 ? first === "high" ? "low" : "high" : first }));
}
function mirror(values) { return values.map(v => 350 - v); }

for (const [id, nodes] of [
  ["ascending-channel", [[20,120],[30,110],[40,125],[50,115],[60,130],[70,120]]],
  ["broadening-formation", [[20,110],[30,100],[40,115],[50,95],[60,120],[70,90]]],
  ["ascending-broadening-wedge", [[20,110],[30,105],[40,120],[50,108],[60,130],[70,111]]],
]) {
  test(`${id}: recognize geometry and its reflected counterpart without assigning an early direction`, () => {
    const values = controls([[0,100], ...nodes, [74, nodes.at(-1)[1]+2]]);
    const s = snapshot(values), candidate = evaluateChannelOrBroadening(s, pivots(s,nodes), {atr:1});
    assert.equal(candidate?.patternId, id);
    assert.equal(candidate.direction, "neutral");
    assert.equal(candidate.lifecycle, "developing");
    const reflected = snapshot(mirror(values));
    const other = evaluateChannelOrBroadening(reflected, pivots(reflected,nodes.map(([i,p])=>[i,350-p]),"low"), {atr:1});
    assert.equal(other?.patternId, id === "ascending-channel" ? "descending-channel" : id === "ascending-broadening-wedge" ? "descending-broadening-wedge" : id);
    assert.equal(other.direction, "neutral");
    assert.ok(candidate.longLevels.stop < candidate.longLevels.trigger);
    assert.ok(candidate.shortLevels.stop > candidate.shortLevels.trigger);
  });
}

test("channel cannot be fitted across closes outside its boundaries", () => {
  const nodes = [[20,120],[30,110],[40,125],[50,115],[60,130],[70,120]];
  const values = controls([[0,100],...nodes]);
  for(let i=31;i<39;i++) values[i]=160;
  const s=snapshot(values);
  assert.equal(evaluateChannelOrBroadening(s,pivots(s,nodes),{atr:1}), null);
});

test("rounding bottom/top require a broad middle, prior trend and balanced lips", () => {
  const values=Array.from({length:90},(_,i)=> i<25 ? 140-i*1.2 : i<=85 ? 85+25*((i-55)/30)**2 : 110);
  const s=snapshot(values), points=pivots(s,[[25,110],[55,85],[85,110]]);
  assert.equal(evaluateRounding(s,points,{atr:1})?.patternId,"rounding-bottom");
  const r=snapshot(mirror(values));
  assert.equal(evaluateRounding(r,pivots(r,[[25,240],[55,265],[85,240]],"low"),{atr:1})?.patternId,"rounding-top");
  const v=snapshot(controls([[0,140],[25,110],[55,85],[85,110],[89,110]]));
  assert.equal(evaluateRounding(v,points,{atr:1}),null);
});

test("inverse cup retains rounded shape and bearish target ordering", () => {
  const values=controls([[0,80],[25,105],[45,85],[48,84.5],[51,84.8],[70,104],[78,98],[85,107]],90);
  const s=snapshot(mirror(values));
  const c=evaluateInverseCup(s,pivots(s,[[25,245],[48,265.5],[70,246],[78,252]],"low"),{atr:1.5});
  assert.equal(c?.patternId,"inverse-cup-and-handle");
  assert.equal(c.direction,"bearish");
  assert.ok(c.actionLevels.targets[1]<c.actionLevels.targets[0]);
});

test("wedge permits a corrective continuation within the opposite prior trend", () => {
  const nodes=[[30,100],[38,90],[46,104],[54,96],[62,106],[70,101]];
  const s=snapshot(controls([[0,140],...nodes,[78,96]]));
  const c=evaluateWedgeReversal(s,pivots(s,nodes),{atr:1.8});
  assert.equal(c?.patternId,"rising-wedge");
  assert.equal(c.category,"continuation");
  assert.equal(c.direction,"bearish");
});

test("diamond requires expansion then contraction and a prior trend", () => {
  const nodes=[[20,110],[30,100],[40,120],[50,90],[60,125],[70,95],[80,118],[90,100],[100,112]];
  const values=controls([[0,80],...nodes,[102,108]]),s=snapshot(values);
  assert.equal(evaluateDiamond(s,pivots(s,nodes),{atr:2})?.patternId,"diamond-top");
  const r=snapshot(mirror(values));
  assert.equal(evaluateDiamond(r,pivots(r,nodes.map(([i,p])=>[i,350-p]),"low"),{atr:2})?.patternId,"diamond-bottom");
  assert.equal(evaluateDiamond(s,pivots(s,nodes.slice(0,7)),{atr:2}),null);
});

test("old duck head requires MA60 trend, crossover, higher pullback and shrinking volume", () => {
  const nodes=[[90,125],[104,113],[112,121],[120,116]];
  const values=controls([[0,105],[65,95],[75,105],...nodes,[124,121]]);
  const volumes=values.map((_,i)=>i>90?400:1000),s=snapshot(values,volumes);
  const c=evaluateOldDuckHead(s,pivots(s,nodes),{atr:2});
  assert.equal(c?.patternId,"old-duck-head");
  assert.ok(c.metrics.volumeContraction<0.85);
  const unconfirmed=snapshot(values);
  assert.equal(evaluateOldDuckHead(unconfirmed,pivots(unconfirmed,nodes),{atr:2}),null);
});

test("structure lifetime grows with formation duration, while entry freshness remains bounded", () => {
  assert.ok(patternBreakoutWindow(100)>12);
  assert.ok(patternBreakoutWindow(500)<=64);
});

test("explicitly open or not-yet-closed candle cannot confirm a breakout", async () => {
  const s=snapshot(controls([[0,80],[30,110],[40,95],[50,109.5],[54,100]],55));
  const base=await runTradingChartPatternAnalysisPipeline(s);
  const last={...s.candles.at(-1),time:START+55*3600,open:100,close:80,low:79,high:101,closed:false};
  const appended=await runTradingChartPatternAnalysisPipeline({...s,candles:[...s.candles,last]});
  assert.deepEqual(appended.theoryResult,base.theoryResult);
  assert.equal(appended.snapshot.inputHash,base.snapshot.inputHash);
});

test("engine has bounded multi-scale evidence and never gives historical candidates to the action plan", async () => {
  const s=snapshot(controls([[0,80],[30,104],[40,96],[50,112],[60,97],[70,104.5],[80,93],[110,90]],111));
  const r=await runTradingChartPatternAnalysisPipeline(s);
  assert.ok(r.theoryResult.structures.displayCandidates.length>0);
  assert.equal(r.analysisPlan.actionPlan.primaryBias,"neutral");
  assert.ok(r.analysisPlan.drawingPatch.operations.some(o=>o.drawing.lineStyle==="dotted"));
  assert.ok(!r.analysisPlan.drawingPatch.operations.some(o=>/-level-/.test(o.drawing.id)));
  assert.deepEqual(runChartPatternEngine(s),runChartPatternEngine(s));
});

test("new names and historical labels are localized in English and traditional Chinese", async () => {
  const s=snapshot(controls([[0,80],[30,104],[40,96],[50,112],[60,97],[70,104.5],[80,93],[110,90]],111));
  const en=await runTradingChartPatternAnalysisPipeline({...s,language:"en"});
  assert.doesNotMatch(en.analysisPlan.report+en.analysisPlan.narrative+JSON.stringify(en.analysisPlan.drawingPatch),/[\p{Script=Han}]/u);
  const tw=await runTradingChartPatternAnalysisPipeline({...s,language:"zh-TW"});
  assert.match(translateTradingAnnotationText(tw.analysisPlan.report,"zh-TW"),/歷史/);
});
