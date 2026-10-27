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
        assert.equal(card.html,baseline.cloudPlanCard(equivalent,{language,separateAction:true}).html,'preview card uses the original layout with the same prices');
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

function noSignalReport(mode='left') {
  const [report]=cloudReportFromResponse(fixtures.find(f=>f.name===`news-${mode}-long.json`).result);
  report.strategyId='harmonic';
  report.report='当前已收盘结构没有形成有效的入场条件。';
  report.executionPlan.outcome={capability:'supported',candidateStatus:'none',evaluationStatus:'completed',action:'wait',reason:'NO_QUALIFIED_CANDIDATE'};
  report.executionPlan.planPresentation.status='unavailable';
  report.executionPlan.planPresentation.reasons=['NO_QUALIFIED_CANDIDATE'];
  report.executionPlan.planPresentation.scenario=null;
  report.drawingPatch.operations=report.drawingPatch.operations.filter(o=>!['strategy-entry','strategy-stop','strategy-target'].includes(o.drawing.colorToken));
  return report;
}

test('no signal restores a read-only observation card without empty prices in fresh and restored reports',()=>{
  for(const locale of ['zh-CN','zh-Hant','en','ko','ja'])for(const mode of ['left','right'])for(const action of ['wait','unavailable']) {
    const report=noSignalReport(mode);report.locale=locale;
    report.executionPlan.outcome.action=action;
    const before=structuredClone(report);
    const [restored]=normalizeCloudReports(JSON.parse(JSON.stringify([report])));
    for(const candidate of [report,restored])for(const allowPlanAction of [false,true]) {
      const card=cloudPlanCard(candidate);
      assert.equal(card.readOnly,true);
      assert.match(card.html,/data-no-trading-signal/);
      assert.doesNotMatch(card.html,/execution-plan-metric|execution-plan-target|execution-plan-price/);
      const {rendered,actions,bindings}=renderCurrentReports([candidate],{allowPlanAction});
      assert.equal(rendered.bubbleContent,report.report);
      assert.ok(rendered.cards.includes(card.html));
      assert.doesNotMatch(rendered.cards,/data-message-action="add-to-plan"|data-message-execution-plan-action="sticky"/);
      if(['en','ko'].includes(locale))assert.doesNotMatch(card.html,/[\u4e00-\u9fff]/);
      assert.equal(actions,'');
      assert.deepEqual(bindings,[]);
    }
    assert.deepEqual(restored,before);
    assert.deepEqual(report,before);
  }
});

test('mixed reports show the observation card while only the valid plan is actionable',()=>{
  const empty=noSignalReport();
  const [ready]=cloudReportFromResponse(fixtures.find(f=>f.name==='ready-left-long.json').result);
  const [reference]=cloudReportFromResponse(fixtures.find(f=>f.name==='news-right-short.json').result);
  for(const reports of [[empty,ready,reference],[ready,reference,empty]]) {
    const {rendered,bindings}=renderCurrentReports(reports,{allowPlanAction:true});
    assert.equal((rendered.cards.match(/class="message-execution-plan execution-plan-surface"/g)||[]).length,3);
    assert.ok(rendered.bubbleContent.includes(empty.report));
    assert.equal(bindings.length,1);
    assert.equal(bindings[0][1].cloudReport.runId,ready.runId);
    assert.equal(bindings[0][0].split('\u0000').at(-1),String(reports.indexOf(ready)));
    assert.match(rendered.cards,/data-no-trading-signal/);
  }
});

test('failed or incomplete evaluation never masquerades as a completed no-signal analysis',()=>{
  for(const evaluationStatus of ['data_unavailable','model_failed','not_evaluated']) {
    const report=noSignalReport();
    Object.assign(report.executionPlan.outcome,{evaluationStatus,candidateStatus:'not_evaluated',action:'unavailable'});
    const [restored]=normalizeCloudReports([report]);
    assert.equal(cloudPlanCard(restored),null);
    const {rendered,actions,bindings}=renderCurrentReports([restored],{allowPlanAction:true});
    assert.equal(rendered.cards,'');
    assert.equal(rendered.bubbleContent,report.report);
    assert.equal(actions,'');assert.deepEqual(bindings,[]);
  }
});
