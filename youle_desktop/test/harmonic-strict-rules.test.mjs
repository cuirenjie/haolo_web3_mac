import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateClassicDevelopingCandidate, evaluateHarmonicCandidate} from '../src/main/trading-analysis/harmonic-engine.mjs';
import {evaluateSharkCandidate, evaluateSharkDevelopingCandidate, sharkCompletionZone} from '../src/main/trading-analysis/harmonic-shark-engine.mjs';
import {evaluateCypherDevelopingCandidate} from '../src/main/trading-analysis/harmonic-cypher-engine.mjs';
import {buildHarmonicActionPlan} from '../src/main/trading-analysis/harmonic-pipeline.mjs';
import {buildExecutionPlanV1} from '../src/main/trading-strategy-runtime/execution-plan-builder.mjs';

function fixture(prices,mirror=false,tail=[]) {
  const flip=p=>mirror?500-p:p;
  const points=prices.map((p,i)=>({id:`p${i}`,price:flip(p),index:10+i*15,time:1700000000+(10+i*15)*3600,
    type:(i%2===0)!==mirror?'low':'high',status:'confirmed'}));
  const anchors=[[0,115],...prices.map((p,i)=>[10+i*15,p]),...tail];
  const candles=Array.from({length:anchors.at(-1)[0]+1},(_,i)=>{
    let s=0;while(s<anchors.length-2&&i>anchors[s+1][0])s++;
    const [a,p]=anchors[s],[b,q]=anchors[s+1],close=flip(p+(q-p)*(i-a)/(b-a));
    return {time:1700000000+i*3600,open:close,high:close,low:close,close,volume:100};
  });
  return {snapshot:{snapshotId:`fixture-${mirror}`,marketId:'BINANCE:FUTURES:TESTUSDT',interval:'60',candles},points};
}

for(const mirror of [false,true]) for(const [pattern,prices,last] of [
  ['gartley',[100,200,138.2,183.2],170],['bat',[100,200,150,175],160],
  ['butterfly',[100,200,121.4,170],150],['crab',[100,200,138.2,186],160],
  ['deep-crab',[100,200,111.4,155],140],['shark',[100,200,150,215],190],['cypher',[100,200,150,235],210],
])test(`${pattern} ${mirror}: obsolete anchors and overshot PRZ are rejected`,()=>{
  const {snapshot,points}=fixture(prices,mirror,[[60,last]]);
  const evaluate=s=>pattern==='shark'?evaluateSharkDevelopingCandidate(s,points,{atr:1})
    :pattern==='cypher'?evaluateCypherDevelopingCandidate(s,points,{atr:1})
    :evaluateClassicDevelopingCandidate(s,points,pattern,{atr:1});
  const good=evaluate(snapshot);assert.ok(good,pattern);
  const broken=structuredClone(snapshot),from=points.at(-1).price;
  broken.candles.at(-1)[mirror?'low':'high']=from+(mirror?-1:1);
  assert.equal(evaluate(broken),null);
  const overshot=structuredClone(snapshot);
  overshot.candles.at(-1)[mirror?'high':'low']=mirror?good.prz.high+1:good.prz.low-1;
  assert.equal(evaluate(overshot),null);
  const hidden=structuredClone(snapshot);
  hidden.candles[30][mirror?'low':'high']=points[1].price+(mirror?-1:1);
  assert.equal(evaluate(hidden),null);
});

for(const mirror of [false,true])for(const ratio of [.886,1,1.13])test(`Shark BC/0B hard band ${ratio}, mirror=${mirror}`,()=>{
  const c=210-ratio*110;
  const {snapshot,points}=fixture([100,200,150,210,c],mirror);
  const result=evaluateSharkCandidate(snapshot,points,{atr:1});
  assert.ok(result);
  assert.ok(Math.abs(result.ratios.cOb-ratio)<1e-10);
  assert.equal(result.measurements[2].label,'BC/0B');
  assert.equal(result.actionLevels.stop,mirror?result.prz.high:result.prz.low);
});
for(const ratio of [.885,1.131])test(`Shark rejects OB limit violation ${ratio} without tolerance`,()=>{
  const {snapshot,points}=fixture([100,200,150,210,210-ratio*110]);
  assert.equal(evaluateSharkCandidate(snapshot,points,{atr:100}),null);
});
test('Shark PRZ uses intersection and cannot widen with ATR',()=>{
  const {points}=fixture([100,200,150,210]);
  assert.deepEqual(sharkCompletionZone(points).levels,{obMinimum:112.54,obLimit:85.7,bcMinimum:112.92,bcLimit:75.6});
  assert.equal(sharkCompletionZone(points).low,85.7);
  assert.equal(sharkCompletionZone(points).high,112.54);
  assert.equal(sharkCompletionZone(fixture([100,200,199,201]).points),null);
});
for(const mirror of [false,true])test(`completed Crab wick stop invalidates despite close recovery ${mirror}`,()=>{
  const {snapshot,points}=fixture([100,200,138.2,186,38.2],mirror,[[75,45]]);
  const candidate=evaluateHarmonicCandidate(snapshot,points,'crab',{atr:1});assert.ok(candidate);
  snapshot.candles.at(-1)[mirror?'high':'low']=candidate.actionLevels.stop;
  assert.equal(evaluateHarmonicCandidate(snapshot,points,'crab',{atr:1}),null);
});
test('V1 preserves the drawn harmonic geometry and two targets even far from quote',()=>{
  const {snapshot,points}=fixture([100,200,138.2,186,38.2],false,[[75,45]]);
  const candidate=evaluateHarmonicCandidate(snapshot,points,'crab',{atr:1});
  const actionPlan=buildHarmonicActionPlan(snapshot,candidate);
  const result={snapshot,theoryResult:{structures:{primaryCandidate:candidate}},analysisPlan:{actionPlan}};
  const plan=buildExecutionPlanV1({id:'harmonic',version:'3.0.0'},result,{currentPrice:50,userRiskProfile:{minimumRiskRewardRatio:.1}});
  assert.equal(plan.scenarios[0].trigger.price,candidate.actionLevels.trigger);
  assert.equal(plan.scenarios[0].stop.price,candidate.actionLevels.stop);
  assert.deepEqual(plan.scenarios[0].targets.map(t=>t.price),candidate.actionLevels.targets);
  assert.equal(plan.action,'wait');
  const limited=buildExecutionPlanV1({id:'harmonic',version:'3.0.0'},result,{currentPrice:50,userRiskProfile:{maxTakeProfitPercent:1}});
  assert.ok(limited.executionBlocked);
  assert.deepEqual(limited.scenarios[0].targets,plan.scenarios[0].targets);
});

for(const change of ['binding','snapshot','candidate','direction','trigger','stop','targets','terminal'])test(`V1 rejects a mismatched harmonic plan: ${change}`,()=>{
  const {snapshot,points}=fixture([100,200,138.2,186,38.2],false,[[75,45]]);
  const candidate=evaluateHarmonicCandidate(snapshot,points,'crab',{atr:1});
  const result=structuredClone({snapshot,theoryResult:{structures:{primaryCandidate:candidate}},
    analysisPlan:{actionPlan:buildHarmonicActionPlan(snapshot,candidate)}});
  const plan=result.analysisPlan.actionPlan;
  if(change==='binding')delete plan.harmonicBinding;
  if(change==='snapshot')plan.harmonicBinding.snapshotId='stale';
  if(change==='candidate')plan.harmonicBinding.candidateId='undrawn';
  if(change==='direction')plan.primaryBias='bearish';
  if(change==='trigger')plan.longTrigger+=1;
  if(change==='stop')plan.longInvalidation-=1;
  if(change==='targets')plan.longTargets.push(200);
  if(change==='terminal')result.theoryResult.structures.primaryCandidate.tradeState='completed';
  const built=buildExecutionPlanV1({id:'harmonic',version:'3.0.0'},result);
  assert.equal(built.action,'wait');assert.deepEqual(built.scenarios,[]);
});

test('harmonic minimum ratio checks every native target without fabricating a better one',()=>{
  const {snapshot,points}=fixture([100,200,138.2,186,38.2],false,[[75,45]]);
  const candidate=evaluateHarmonicCandidate(snapshot,points,'crab',{atr:1});
  const result={snapshot,theoryResult:{structures:{primaryCandidate:candidate}},analysisPlan:{actionPlan:buildHarmonicActionPlan(snapshot,candidate)}};
  const base=buildExecutionPlanV1({id:'harmonic',version:'3.0.0'},result,{tickSize:1,userRiskProfile:{minimumRiskRewardRatio:.1}});
  assert.equal(base.scenarios[0].stop.price,candidate.actionLevels.stop);
  assert.deepEqual(base.scenarios[0].targets.map(t=>t.price),candidate.actionLevels.targets);
  const scenario=base.scenarios[0],cost=scenario.trigger.price*base.positionSizing.estimatedRoundTripCostRate;
  const risk=scenario.trigger.price-scenario.stop.price+cost;
  const threshold=(scenario.targets[0].price+scenario.targets[1].price-2*scenario.trigger.price-2*cost)/(2*risk);
  const blocked=buildExecutionPlanV1({id:'harmonic',version:'3.0.0'},result,{userRiskProfile:{minimumRiskRewardRatio:threshold}});
  assert.equal(blocked.executionBlocked,true);assert.equal(blocked.positionSizing.accountPlan,null);
  assert.deepEqual(blocked.scenarios[0].targets,base.scenarios[0].targets);
});
