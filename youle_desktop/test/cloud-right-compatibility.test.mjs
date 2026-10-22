import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {bindLegacyCloudCandidate,legacyReportCandidates,normalizeCloudReports,cloudReportFromResponse} from '../src/main/cloud-plan-contract.mjs';
import {validateCloudResult} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {verifyRendererParity,renderCurrentReports} from './support/right-renderer-parity.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const text=`### SOL/USDT 币安永续 1H
当前动作：不交易
方向判断：偏空
空头触发：75.12，推荐：10 倍杠杆、2523.22 USDT 的空单
止损与失效：止损 75.68
分批止盈：止盈 74.28，推荐仓位 2523.21 USDT
风险收益比：目标1为 1:0.97，如果止损：约 -23.85 USDT，如果全部止盈：约 +23.16 USDT`;
function fixture(n=1) {
  const appliedPreferences={revision:1,configHash:'a'.repeat(64),policyVersion:'right-legacy-v1'};
  const context={taskId:uuid(100),snapshotId:uuid(101),marketKey:'binance:usdm:SOLUSDT',interval:'1h',version:1};
  const record={runId:uuid(n),marketId:'BINANCE:FUTURES:SOLUSDT',interval:'60',requestedEntryMode:'right',preferencesHash:appliedPreferences.configHash,
    body:{clientContract:'windows-v1',executionPolicy:'right-legacy-v1',strategy:'price-action',locale:'zh-CN',context,preferencesRevision:1}};
  const executionPlan={schemaVersion:1,scenarios:[],expiresAt:1900000000000};
  const native={ok:true,clientContract:'windows-v1',strategy:{id:'price-action'},snapshot:{marketId:record.marketId,interval:record.interval},executionPlan,
    analysisPlan:{marketId:record.marketId,interval:record.interval,report:text,executionPlan}};
  const canonicalJson=JSON.stringify(native);
  const card=legacyReportCandidates(text)[0];
  const remote={id:uuid(n+200),runId:record.runId,executionPolicy:'right-legacy-v1',monitoringPolicy:'windows_v1',version:1,confirmationHash:'b'.repeat(64),cardIndex:0,card,
    executionPlan,context,appliedPreferences,expiresAt:executionPlan.expiresAt,scenario:{side:'short',entry:75.12,stop:75.68,targets:[74.28],eligible:true},
    alertPreview:{side:'short',entry:75.12,stop:75.68,targets:[74.28],monitoringPolicy:'windows_v1',confirmation:'intrabar',exitConfirmation:'intrabar',marketKey:context.marketKey,interval:context.interval,expiresAt:executionPlan.expiresAt}};
  const result={...native,cloud:{runId:record.runId,context,appliedPreferences,locale:'zh-CN',executionPolicy:'right-legacy-v1',resultHash:'c'.repeat(64),planIds:[remote.id],planRecords:[remote],
    nativeReceipt:{canonicalJson,hash:createHash('sha256').update(canonicalJson).digest('hex')}}};
  return {record,result,run:{...record.body,id:record.runId,desktopResult:result},report:cloudReportFromResponse(result)[0]};
}

function ladderFixture() {
  const f = fixture(), native = f.result;
  const levels = [74.28, 73, 71.5];
  native.executionPlan.scenarios = [{ side: 'short', trigger: {price: 75.12}, stop: {price: 75.68},
    targets: levels.map(price => ({price})) }];
  native.cloud.planRecords[0].scenario.targets = levels;
  const {cloud, ...signed} = native;
  cloud.nativeReceipt.canonicalJson = JSON.stringify(signed);
  cloud.nativeReceipt.hash = createHash('sha256').update(cloud.nativeReceipt.canonicalJson).digest('hex');
  return f;
}

test('complete native targets survive validation and history while the monitor retains TP1', () => {
  const {run, record} = ladderFixture(), before = structuredClone(run);
  const result = validateCloudResult(run, record);
  const report = cloudReportFromResponse(result)[0];
  assert.deepEqual(report.planRecords[0].scenario.targets, [74.28, 73, 71.5]);
  assert.deepEqual(report.planRecords[0].alertPreview.targets, [74.28]);
  assert.deepEqual(run, before, 'validation must not truncate or rewrite signed results');
  assert.equal(validateCloudResult(fixture().run, fixture().record).ok, true, 'old single-target receipts stay valid');
});

test('additional targets must belong to one frozen native scenario, with valid direction and order', () => {
  for (const mutate of [
    r => r.cloud.planRecords[0].scenario.targets[1] = 72,
    r => r.cloud.planRecords[0].scenario.targets.reverse(),
    r => r.cloud.planRecords[0].scenario.targets.push(70),
    r => r.cloud.planRecords[0].scenario.targets[1] = NaN,
    r => r.cloud.planRecords[0].scenario.targets[1] = -1,
    r => r.cloud.planRecords[0].scenario.targets[1] = 74.28,
    r => r.executionPlan.scenarios.push(structuredClone(r.executionPlan.scenarios[0])),
    r => r.executionPlan.scenarios[0].side = 'long',
    r => r.executionPlan.scenarios[0].trigger.price = 75.11,
    r => r.executionPlan.scenarios[0].stop.price = 75.69,
    r => r.executionPlan.scenarios[0].targets = [{price: 74.28}, {price: 72}],
    r => r.cloud.planRecords[0].alertPreview.targets = [74.28, 73, 71.5],
  ]) {
    const {run, record} = ladderFixture();
    mutate(run.desktopResult);
    // Re-sign native edits to exercise semantic checks, not just receipt hashes.
    const {cloud, ...native} = run.desktopResult;
    cloud.nativeReceipt.canonicalJson = JSON.stringify(native);
    cloud.nativeReceipt.hash = createHash('sha256').update(cloud.nativeReceipt.canonicalJson).digest('hex');
    assert.throws(() => validateCloudResult(run, record), e => e.code === 'CLOUD_RESULT_CONTEXT_INVALID');
  }
});

test('identical cards in separate panes retain independent run and plan identities',()=>{
  const reports=[fixture(1).report,fixture(2).report],candidate=legacyReportCandidates(text)[0],used=new Set();
  const first=bindLegacyCloudCandidate(reports,candidate,used),second=bindLegacyCloudCandidate(reports,candidate,used);
  assert.equal(first.cloudReport.runId,uuid(1));assert.equal(second.cloudReport.runId,uuid(2));
  assert.notEqual(first.cloudReport.planRecords[0].id,second.cloudReport.planRecords[0].id);
  assert.throws(()=>bindLegacyCloudCandidate(reports,candidate,used),/CLOUD_REPORT_INVALID/);
  assert.throws(()=>bindLegacyCloudCandidate(reports,candidate),/CLOUD_REPORT_INVALID/);
  const duplicate=structuredClone(reports);duplicate[1].planRecords[0].id=duplicate[0].planRecords[0].id;
  assert.throws(()=>normalizeCloudReports(duplicate),/CLOUD_REPORT_INVALID/);
  for(const report of reports)verifyRendererParity(report);
  verifyRendererParity(reports);
});

test('right results bind native receipt, original rounded card prices, locale and expiration',()=>{
  const {run,record}=fixture();
  assert.equal(validateCloudResult(run,record).ok,true);
  for(const mutate of [r=>r.locale='en',r=>r.executionPolicy='entry-v2',
    r=>r.desktopResult.cloud.locale='en',r=>r.desktopResult.cloud.planRecords[0].expiresAt++,
    r=>r.desktopResult.cloud.planRecords[0].alertPreview.expiresAt++,r=>r.desktopResult.cloud.planRecords[0].scenario.entry=75.120001,
    r=>r.desktopResult.analysisPlan.report+='changed']) {
    const changed=structuredClone(run);mutate(changed);
    assert.throws(()=>validateCloudResult(changed,record),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  }
});

test('right selected-card history cannot relabel or replace the original candidate',()=>{
  const {report}=fixture();
  for(const mutate of [r=>r.planRecords[0].cardIndex=1,r=>r.planRecords[0].card.title='different',r=>r.selectedCardIndex=1]) {
    const changed=structuredClone(report);mutate(changed);
    assert.throws(()=>normalizeCloudReports([changed]),/CLOUD_REPORT_INVALID/);
  }
});

test('mixed pre-upgrade V2 and original right cards retain separate actions on history recovery',()=>{
  const legacy=fixture().report,planId=uuid(700),runId=uuid(701);
  const condition={conditionId:uuid(702),revision:1,direction:'long',interval:'1h',confirmation:'touch',trigger:{operator:'at_or_above',lower:80},expiresAt:1900000000000};
  const scenario={stop:75,targets:[90],conditionHash:'d'.repeat(64)};
  const v2={schemaVersion:1,runId,resultHash:'e'.repeat(64),locale:'zh-CN',marketId:legacy.marketId,interval:legacy.interval,strategyId:'price-action',report:'Existing V2 analysis',
    executionPlan:{schemaVersion:2,planId,entryCondition:condition,requestedMode:'right',selectedMode:'right',conditionHash:scenario.conditionHash,scenarios:[scenario],outcome:{action:'plan'}},
    planRecords:[{id:planId,runId,confirmationHash:'f'.repeat(64),monitoringPolicy:'entry_v2',version:1,scenario}]};
  for(const reports of [[legacy,v2],[v2,legacy]]) {
    const {rendered,actions,bindings}=renderCurrentReports(reports);
    assert.equal((rendered.cards.match(/data-execution-plan-index=/g)||[]).length,2);
    assert.match(rendered.bubbleContent,/Existing V2 analysis/);
    assert.equal((actions.match(/data-execution-plan-index=/g)||[]).length,2);
    assert.equal(bindings.length,2);
    assert.deepEqual(bindings.map(([,candidate])=>candidate.cloudReport.runId),reports.map(report=>report.runId));
    assert.deepEqual(bindings.map(([key])=>key.split('\u0000').at(-1)),['0','1']);
  }
});
