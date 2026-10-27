import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cloudAnalysisDrawingPlan,isExecutionPlanLevel} from '../src/shared/execution-plan-drawings.mjs';
import {cloudReportFromResponse,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {normalizeTradingAiDrawingPatch} from '../src/renderer/trading-expert-drawing.ts';
import {buildTradingPlanPriceLines} from '../src/renderer/trading-plan-price-lines.ts';
import {rememberTradingPlanDrawingHistory,projectStoredTradingPlanDrawings,visibleTradingPlanDrawingPatch} from '../src/renderer/trading-plan-drawing-history.ts';
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/wyckoff-dual-cross-platform.json',import.meta.url))).cases;
const models=p=>normalizeTradingAiDrawingPatch(p).map(d=>({...d,source:'ai'}));
const prices=p=>p.operations.filter(o=>isExecutionPlanLevel(o.drawing)).map(o=>o.drawing.points[0].price);
function probability(r,values) {
  r.analysisPlan.profitProbability={schemaVersion:1,kind:'model_estimate',basis:'first_target_before_stop_conditional',
    history:{candleCount:120,from:1792310400000,to:1792326740000,asOf:1792326741009,interval:'1h'},
    assessments:r.cloud.planRecords.map((p,i)=>({planId:p.id,...p.scenario,
      stopLossProbabilityPercent:100-values[i],profitProbabilityPercent:values[i],
      summary:'Frozen plan estimate',evidenceIds:['history-window']}))};
}
for(const fixture of cases)for(const values of [[62,78],[78,62],[65,65],null])test(
  `${fixture.run.locale}/${fixture.bullish}/${fixture.blocked}/${values}: one set of five lines, both cards intact`,()=>{
    const r=structuredClone(fixture.run.desktopResult);
    if(values)probability(r,values);
    const before=structuredClone(r), plans=r.executionPlan.wyckoffPlanSet.plans;
    const index=!fixture.blocked&&values?.[1]>values?.[0]?1:0;
    const s=plans[index].scenarios[0]||plans[index].planPresentation.scenario;
    const expected=[s.entry,s.stop,...s.targets];
    const patch=cloudAnalysisDrawingPlan(r).drawingPatch;
    assert.deepEqual(prices(patch),expected);
    assert.deepEqual(patch.operations.filter(o=>!isExecutionPlanLevel(o.drawing)),r.analysisPlan.drawingPatch.operations.filter(o=>!isExecutionPlanLevel(o.drawing)));
    assert.equal(buildTradingPlanPriceLines(models(patch)).lines.length,5);
    assert.deepEqual(cloudAnalysisDrawingPlan({...r,analysisPlan:{...r.analysisPlan,drawingPatch:patch}}).drawingPatch,patch);
    assert.deepEqual(r,before);
    const reports=cloudReportFromResponse(r);
    assert.equal(reports.length,2);
    assert.deepEqual(normalizeCloudReports(reports),reports);
    const session=`history-${fixture.run.locale}-${fixture.bullish}-${fixture.blocked}-${values}`;
    rememberTradingPlanDrawingHistory(session,reports);
    const source=models(r.analysisPlan.drawingPatch), previous=structuredClone(source);
    const projected=projectStoredTradingPlanDrawings(source,session);
    assert.deepEqual(buildTradingPlanPriceLines(projected).lines.map(l=>l.price),expected);
    assert.deepEqual(source,previous);
    assert.equal(projectStoredTradingPlanDrawings(source,session+'-other'),source);
    assert.deepEqual(projectStoredTradingPlanDrawings(projected,session),projected);
    for(const report of reports)assert.deepEqual(prices(visibleTradingPlanDrawingPatch(report,session)),expected,'either card opens the same winner');
    const partial=source.filter(d=>d.id!==source.find(d=>isExecutionPlanLevel(d)).id);
    assert.equal(projectStoredTradingPlanDrawings(partial,session),partial,'deleted lines stay deleted');
  });
test('invalid/high probability cannot select an unrelated plan; inputs and single-plan paths stay unchanged',()=>{
  const r=structuredClone(cases.find(c=>!c.blocked).run.desktopResult);
  probability(r,[60,99]);r.analysisPlan.profitProbability.assessments[1].entry+=1;
  assert.deepEqual(prices(cloudAnalysisDrawingPlan(r).drawingPatch),prices(cloudAnalysisDrawingPlan(cases[0].run.desktopResult).drawingPatch));
  delete r.executionPlan.wyckoffPlanSet;
  assert.equal(cloudAnalysisDrawingPlan(r),r.analysisPlan);
});
