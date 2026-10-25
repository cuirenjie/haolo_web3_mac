import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateCloudEntryResult} from '../src/main/trading-strategy-runtime/cloud-entry-result.mjs';
import {cloudReportFromResponse,cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {renderCurrentReports} from './support/right-renderer-parity.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/preference-plan-results.json',import.meta.url),'utf8')).cases;
// Compare against the pre-change production card, not a rewritten snapshot.
const baselineText=execFileSync('git',['show','HEAD:youle_desktop/src/main/cloud-plan-contract.mjs'],{encoding:'utf8'})
  .replace(/(from\s+['"])([^'"]+)(['"])/g,(all,start,path,end)=>start+new URL(path,new URL('../src/main/cloud-plan-contract.mjs',import.meta.url)).href+end);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(baselineText).toString('base64'));

for(const {name,result,record} of fixtures) {
  test(`real server transport, restoration, prices and activation binding: ${name}`,()=>{
    validateCloudEntryResult(result,record);
    const [report]=cloudReportFromResponse(result),plan=report.executionPlan;
    const preview=plan.planPresentation.status!=='actionable';
    const scenario=preview?plan.planPresentation.scenario:plan.scenarios[0];
    assert.ok(scenario.riskReward[0]>=2-1e-10);
    const restored=normalizeCloudReports(JSON.parse(JSON.stringify([report])));
    assert.deepEqual(restored,[report]);
    for(const locale of ['zh-CN','zh-Hant','en','ko']) {
      const language=locale==='zh-Hant'?'zh-TW':locale;
      const card=cloudPlanCard(report,{language});
      assert.ok(card);
      assert.doesNotMatch(card.html,/data-plan-preferences|data-plan-recommendation|保本提醒|Account risk cap|not recommended|不建议开仓/);
      if(!preview)assert.equal(card.html,baseline.cloudPlanCard(report,{language}).html,'actionable card HTML must be unchanged');
      else {
        const equivalent=structuredClone(report),s=equivalent.executionPlan.planPresentation.scenario;
        Object.assign(equivalent.executionPlan,{outcome:{action:'plan'},selectedMode:s.mode,
          entryCondition:{direction:s.side,mode:s.mode,interval:s.executionInterval,confirmation:'bar_close',trigger:s.trigger,expiresAt:2000000000000},
          scenarios:[{...s,eligible:true}],executionBlocked:false});
        // Preview uses the existing card fields and no action/recommendation row.
        equivalent.executionPlan.scenarios[0].positionSizing={...s.positionSizing,executionBlocked:false,accountPlan:null};
        assert.equal(card.html,baseline.cloudPlanCard(equivalent,{language}).html,'preview card uses the original layout with the same prices');
      }
      assert.equal(card.readOnly===true,preview);
      const rendered=renderCurrentReports([{...report,locale}],{allowPlanAction:true});
      assert.ok(rendered.rendered.cards.includes('execution-plan-surface'));
      assert.equal(rendered.bindings.length,preview?0:1);
      if(preview)assert.equal(rendered.actions,'');
      if(locale==='en'||locale==='ko')assert.doesNotMatch(card.html,/[\u4e00-\u9fff]/);
    }
    if(preview) {
      assert.equal(result.cloud.planRecords.length,0);
      assert.equal(plan.entryCondition,undefined);
      assert.ok(cloudPlanCard(report,{language:'en'}).content.includes('not recommended'));
      if(name.startsWith('news'))assert.ok(cloudPlanCard(report,{language:'en'}).content.includes('major data releases'));
    } else {
      const rule=result.cloud.planRecords[0].alertPreview;
      assert.deepEqual(rule.targets,scenario.targets);
      assert.deepEqual(rule.preferenceExitPolicy,scenario.positionSizing.preferenceExitPolicy);
    }
  });
  if(!name.startsWith('ready'))for(const mutation of ['price','ratio','eligible','side','condition','drawing','cost']) {
    test(`reject mismatched or actionable preview: ${name}/${mutation}`,()=>{
      const changed=structuredClone(result),p=changed.executionPlan.planPresentation,s=p.scenario;
      if(mutation==='price')s.targets[0]+=1;
      if(mutation==='ratio')s.riskReward[0]=.01;
      if(mutation==='eligible')s.eligible=true;
      if(mutation==='side')s.side=s.side==='long'?'short':'long';
      if(mutation==='condition')s.entryCondition={schemaVersion:2};
      if(mutation==='cost')s.positionSizing.estimatedRoundTripCostRate=.5;
      if(mutation==='drawing')changed.analysisPlan.drawingPatch.operations.find(o=>o.drawing.colorToken==='strategy-target').drawing.points[0].price+=1;
      assert.throws(()=>validateCloudEntryResult(changed,record));
    });
  }
  else for(const field of ['moveStopToBreakEven','breakEvenTriggerR','breakEvenTriggerPrice','breakEvenPrice']) {
    test(`reject reminder disagreement during transport and restore: ${name}/${field}`,()=>{
      const changed=structuredClone(result),exits=changed.cloud.planRecords[0].alertPreview.preferenceExitPolicy;
      exits[field]=typeof exits[field]==='boolean'?!exits[field]:exits[field]+1;
      assert.throws(()=>validateCloudEntryResult(changed,record));
      assert.throws(()=>cloudReportFromResponse(changed));
    });
  }
}

test('missing prices still render an unavailable card without activation',()=>{
  const [report]=cloudReportFromResponse(fixtures.find(f=>f.name.startsWith('news')).result);
  report.executionPlan.planPresentation.status='unavailable';
  report.executionPlan.planPresentation.scenario=null;
  report.drawingPatch.operations=report.drawingPatch.operations.filter(o=>!['strategy-entry','strategy-stop','strategy-target'].includes(o.drawing.colorToken));
  assert.equal(normalizeCloudReports([report]).length,1);
  assert.match(cloudPlanCard(report,{language:'en'}).content,/unavailable/);
  assert.equal(renderCurrentReports([report],{allowPlanAction:true}).bindings.length,0);
});
