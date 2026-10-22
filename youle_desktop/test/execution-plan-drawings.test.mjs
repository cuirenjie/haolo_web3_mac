import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {projectExecutionPlanDrawings, cloudAnalysisDrawingPlan, isExecutionPlanLevel} from '../src/shared/execution-plan-drawings.mjs';
import {buildTradingPlanPriceLines} from '../src/renderer/trading-plan-price-lines.ts';
import {normalizeTradingAiDrawingPatch, persistTradingAiDrawingPatch} from '../src/renderer/trading-expert-drawing.ts';
import {rememberTradingPlanDrawingHistory, projectStoredTradingPlanDrawings} from '../src/renderer/trading-plan-drawing-history.ts';
import {executionPlanStructuredCardBody} from '../src/main/execution-plan-card-view.mjs';
import {legacyReportCandidates} from '../src/main/cloud-plan-contract.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/plan-prices-sndk.json', import.meta.url)));
const {executionPlan: plan, drawingPatch: original} = fixture;
const models = patch => normalizeTradingAiDrawingPatch(patch).map(d => ({...d, source:'ai'}));
const levels = patch => patch.operations.filter(o => isExecutionPlanLevel(o.drawing));
function receipt(patch = original) {
  const report = `SNDK/USDT 币安永续 1H
当前动作：等待条件触发
方向判断：偏多
策略：裸K分析
做多触发价：1391.74
止损与失效：1360.64
分批止盈：第一目标 1411.46；第二目标 1421.63；第三目标 1453.96
风险收益比：第一目标 1:0.50；第二目标 1:0.80；第三目标 1:1.75`;
  const runId = '11111111-1111-4111-8111-111111111111';
  return {schemaVersion:1,executionPolicy:'right-legacy-v1',runId,resultHash:'a'.repeat(64),locale:'zh-CN',
    marketId:plan.market.marketId,interval:plan.market.interval,strategyId:plan.strategy.id,report,executionPlan:plan,
    drawingPatch:patch,origin:null,planRecords:legacyReportCandidates(report).map((c,i)=>({
      id:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,runId,confirmationHash:'b'.repeat(64),
      executionPolicy:'right-legacy-v1',monitoringPolicy:'windows_v1',version:1,cardIndex:i,card:{title:c.title,content:c.content},
    }))};
}

test('original SNDK receipt reproduces two wrong targets; projected chart exactly matches the final card', () => {
  assert.deepEqual(levels(original).map(o=>o.drawing.points[0].price),[1391.744,1360.636,1438.406,1453.96]);
  const before = structuredClone(fixture);
  const patch = projectExecutionPlanDrawings(original,plan,fixture.locale);
  assert.deepEqual(levels(patch).map(o=>o.drawing.points[0].price),[1391.74,1360.64,1411.46,1421.63,1453.96]);
  assert.deepEqual(patch.operations.filter(o=>!isExecutionPlanLevel(o.drawing)), original.operations.filter(o=>!isExecutionPlanLevel(o.drawing)));
  assert.deepEqual(fixture,before,'receipt and trading decisions are immutable');
  assert.deepEqual(projectExecutionPlanDrawings(patch,plan,fixture.locale),patch,'idempotent projection');
  const {lines}=buildTradingPlanPriceLines(models(patch));
  assert.deepEqual(lines.map(l=>l.label),['1391.740','1360.640','1411.460','1421.630','1453.960']);
  const scenario=plan.scenarios[0];
  const card=executionPlanStructuredCardBody({entry:{lower:scenario.trigger.price},stop:scenario.stop.price,
    targets:scenario.targets.map(t=>t.price),direction:scenario.side});
  for(const line of lines)assert.ok(card.includes(line.label),line.label);
});

for (const locale of ['zh-CN','zh-Hant','en']) test(`long/short alternatives retain numbering and one entry each, ${locale}`,()=>{
  const long=plan.scenarios[0];
  const short={...structuredClone(long),id:'short-scenario',side:'short',
    stop:{price:1420},targets:[{price:1370},{price:1350},{price:1320}]};
  const patch=projectExecutionPlanDrawings(original,{...plan,preferredSide:'neutral',scenarios:[long,short]},locale);
  const drawings=models(patch).reverse();
  const lines=buildTradingPlanPriceLines(drawings).lines;
  assert.equal(lines.filter(l=>l.kind==='plan-entry').length,2);
  assert.deepEqual(lines.filter(l=>l.kind==='take-profit').map(l=>l.shortLabel),
    Array(2).fill(locale==='en'?['TP3','TP2','TP1']:['第3止盈','第2止盈','第1止盈']).flat());
});

test('invalid context and prices fail; non-plan and Entry V2 projections stay unchanged',()=>{
  assert.throws(()=>projectExecutionPlanDrawings({...original,interval:'240'},plan),/context/);
  assert.throws(()=>projectExecutionPlanDrawings({...original,marketId:'BINANCE:FUTURES:BTCUSDT'},plan),/context/);
  assert.throws(()=>projectExecutionPlanDrawings(original,{...plan,scenarios:[{...plan.scenarios[0],targets:[{price:NaN}]}]}),/prices/);
  assert.equal(projectExecutionPlanDrawings(original,{schemaVersion:2}),original);
  for(const policy of ['entry-v2',undefined]) {
    const response={analysisPlan:{drawingPatch:original},executionPlan:plan,cloud:{executionPolicy:policy,planRecords:[{}]}};
    assert.equal(cloudAnalysisDrawingPlan(response),response.analysisPlan);
  }
  const response={analysisPlan:{drawingPatch:original},executionPlan:plan,cloud:{executionPolicy:'right-legacy-v1',planRecords:[]}};
  assert.equal(cloudAnalysisDrawingPlan(response),response.analysisPlan,'structure-only direct report');
  response.cloud.planRecords=[{}];
  assert.equal(levels(cloudAnalysisDrawingPlan(response).drawingPatch).length,5);
});

test('old history is repaired without restoring deleted plans or overwriting other analyses or sessions',()=>{
  const report=receipt(), source=models(original), before=structuredClone(source);
  assert.equal(report.planRecords.length,1,'fixture contains a real parsed plan card');
  rememberTradingPlanDrawingHistory('sndk-history',[report]);
  const result=projectStoredTradingPlanDrawings(source,'sndk-history');
  assert.equal(buildTradingPlanPriceLines(result).lines.length,5);
  assert.deepEqual(source,before);
  assert.equal(projectStoredTradingPlanDrawings(source,'different-thread'),source);
  assert.deepEqual(projectStoredTradingPlanDrawings([],'sndk-history'),[]);
  const partial=source.filter(d=>d.id!==levels(original)[0].drawing.id);
  assert.equal(projectStoredTradingPlanDrawings(partial,'sndk-history'),partial,'user deletion is authoritative');
  const different=source.map(d=>({...d,symbol:'BINANCE:FUTURES:BTCUSDT'}));
  assert.equal(projectStoredTradingPlanDrawings(different,'sndk-history'),different);
  const changed=source.map(d=>({...d,points:d.points.map(p=>({...p,price:p.price+1}))}));
  assert.equal(projectStoredTradingPlanDrawings(changed,'sndk-history'),changed);
  assert.deepEqual(projectStoredTradingPlanDrawings(result,'sndk-history'),result);
  rememberTradingPlanDrawingHistory('split-history',[{...report,origin:{analysisJobId:'job:pane:2'}}]);
  assert.equal(projectStoredTradingPlanDrawings(source,'split-history'),source);
  assert.equal(buildTradingPlanPriceLines(projectStoredTradingPlanDrawings(source,'split-history::split-pane:2')).lines.length,5);
});

test('corrected drawing metadata survives validated storage and keeps third target identity',()=>{
  const previous=globalThis.window, data=new Map();
  globalThis.window={localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}};
  try {
    const patch=projectExecutionPlanDrawings(original,plan,'en');
    persistTradingAiDrawingPatch('persisted',patch);
    const storedKey='haolo.trading-market.ai-drawings.v2.persisted';
    const stored=JSON.parse(data.get(storedKey));
    assert.equal(stored.filter(d=>d.planLevel?.role==='target').length,3);
    assert.equal(buildTradingPlanPriceLines(stored).lines.at(-1).shortLabel,'TP3');
    persistTradingAiDrawingPatch('persisted',patch);
    assert.equal(JSON.parse(data.get(storedKey)).length,patch.operations.length);
  } finally {globalThis.window=previous;}
});
