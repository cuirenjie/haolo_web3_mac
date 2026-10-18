// Validate saved, paid server results through the real desktop boundary.
// This replays completed receipts; it makes no model or network requests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateCloudResult} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {cloudReportFromResponse,cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';

const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const cases=[...OFFICIAL_TRADING_CATALOG.map(s=>s.id),'general','wave-entry'];
const evidence=[];
for(const name of cases){
  const filename=path.join(source,`${name}.result.json`),bytes=fs.readFileSync(filename);
  const run=JSON.parse(bytes),calls=JSON.parse(fs.readFileSync(path.join(source,`${name}.calls.json`),'utf8'));
  assert.equal(run.state,'succeeded',name);
  assert.ok(calls.length&&calls.every(c=>c.state==='completed'&&c.responseId),name);
  const result=validateCloudResult(run,{runId:run.id,body:{...run,preferencesRevision:run.appliedPreferences.revision},
    preferencesHash:run.appliedPreferences.configHash,requestedEntryMode:run.desktopResult.executionPlan.requestedMode,
    marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60'});
  const [report]=cloudReportFromResponse(result),card=cloudPlanCard(report),plan=result.executionPlan;
  if(name==='general'){
    assert.equal(plan.kind,'position_assessment');assert.equal(card,null);assert.deepEqual(run.planIds,[]);
  }else if(!plan.modelEvaluated){
    assert.equal(name,'wave');assert.equal(plan.outcome.reason,'NO_QUALIFIED_CANDIDATE');
    assert.ok(calls.every(c=>c.stage==='structure'));assert.equal(card,null);assert.deepEqual(run.planIds,[]);
  }else {
    assert.ok(calls.some(c=>c.stage==='entry'));assert.equal(plan.outcome.evaluationStatus,'completed');
    assert.ok(['plan','wait'].includes(plan.outcome.action));
    if(plan.outcome.action==='plan'){assert.ok(card);assert.ok(card.content.includes('not a fill'));}
    else {assert.equal(card,null);assert.deepEqual(run.planIds,[]);}
  }
  evidence.push({case:name,sha256:createHash('sha256').update(bytes).digest('hex'),
    outcome:plan.outcome,selectedMode:plan.selectedMode,modelEvaluated:plan.modelEvaluated,
    calls:calls.map(c=>({responseId:c.responseId,model:c.model,stage:c.stage,latencyMs:c.latencyMs,
      totalTokens:c.usage?.total_tokens??null})),
    scope:name==='wave-entry'?'controlled native review + real entry decision':'real gateway + local synthetic market/database'});
}
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify({passed:true,source,checkedAt:new Date().toISOString(),cases:evidence},null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:evidence.length,entryDecisions:evidence.filter(e=>e.case!=='general'&&e.modelEvaluated).length,
  nativeWait:evidence.filter(e=>!e.modelEvaluated&&e.case!=='general').length}));
