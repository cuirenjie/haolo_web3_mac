// Read-only replay of previously downloaded, account-owned incident receipts.
// Inputs stay in the ignored local cache; no credentials or new cloud runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {validateCloudResult, createCloudStrategyRuntime} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {cloudReportFromResponse, normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {renderCurrentReports} from '../test/support/right-renderer-parity.mjs';
import {CodexBusinessTools} from '../src/main/codex-business-tools.mjs';
import {businessToolError} from '../src/shared/business-tool-error.mjs';
import {cloudStrategyFailure} from '../src/main/trading-strategy-runtime/cloud-error.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.resolve(process.argv[2] || path.join(root,'.cache/cloud-right-M1-421'));
const records=JSON.parse(fs.readFileSync(path.join(directory,'records.json'),'utf8'));
assert.equal(records.length,4,'use all four failed Wyckoff attempts');
const baselineRef=process.argv[3] || '59a7109';
const sourcePath='youle_desktop/src/main/trading-strategy-runtime/cloud-right-result.mjs';
let oldSource=execFileSync('git',['show',`${baselineRef}:${sourcePath}`],{cwd:root,encoding:'utf8'});
oldSource=oldSource.replace(/from '(\.\.?\/[^']+)'/g,(_,relative)=>
  `from '${pathToFileURL(path.resolve(root,path.dirname(sourcePath),relative)).href}'`);
const baseline=await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`);
const rows=[];
for(const record of records) {
  const raw=fs.readFileSync(path.join(directory,`${record.runId}.json`),'utf8'),run=JSON.parse(raw),before=JSON.stringify(run);
  assert.equal(run.state,'succeeded');
  assert.throws(()=>baseline.validateCloudRightResult(run.desktopResult,record),e=>e.code==='CLOUD_RESULT_CONTEXT_INVALID');
  const result=validateCloudResult(run,record);
  assert.equal(JSON.stringify(run),before,'validation cannot alter receipt or targets');
  const reports=normalizeCloudReports(JSON.parse(JSON.stringify(cloudReportFromResponse(result))));
  for(const plan of reports[0].planRecords) {
    assert.equal(plan.scenario.targets.length,3);
    assert.deepEqual(plan.alertPreview.targets,[plan.scenario.targets[0]]);
  }
  const rendered=renderCurrentReports(reports);
  assert.ok(rendered.rendered.cards.length>0);assert.equal(rendered.bindings.length,reports[0].planRecords.length);
  const displayedPrices=(rendered.rendered.cards.replace(/<[^>]+>/g,' ').match(/\d[\d,.]*/g)||[]).map(value=>Number(value.replaceAll(',','')));
  for(const price of reports[0].planRecords[0].scenario.targets)
    assert.ok(displayedPrices.some(shown=>Math.abs(shown-price)<0.000001),'every native target must appear in the rendered card');
  assert.equal(reports[0].report,run.desktopResult.analysisPlan.report);
  // Resume the actual queued local journal entry with the exact durable result.
  let saved=structuredClone(record),reads=0;
  const runtime=createCloudStrategyRuntime({owner:async()=>({ownerId:'replay'}),
    api:()=>({tradingCloudRequest:async(operation)=>{assert.equal(operation,'run');reads++;return structuredClone(run);}}),
    journal:{get:async()=>saved,put:async(_owner,_key,value)=>{saved=structuredClone(value);}}});
  const resumed=await runtime.resume(record.key);
  assert.equal(reads,1);assert.equal(saved.state,'succeeded');
  assert.deepEqual(resumed.cloud.planRecords[0].scenario.targets,result.cloud.planRecords[0].scenario.targets);
  // Inject a real contract mismatch, pass it through the renderer's IPC shape,
  // and verify the host stops once instead of admitting a second paid run.
  const altered=structuredClone(run);altered.desktopResult.cloud.planRecords[0].scenario.targets[1]+=1;
  let mismatch;try{validateCloudResult(altered,record);}catch(error){mismatch=error;}
  assert.equal(mismatch?.code,'CLOUD_RESULT_CONTEXT_INVALID');
  const events=[],stops=[],client={},sender={isDestroyed:()=>false};
  const broker=new CodexBusinessTools({owner:()=> 'replay',accountRead:async()=>({available:false}),
    dispatch:(_,p)=>events.push(p),onAnalysisFailure:async x=>stops.push(x)});
  const context=broker.bind('replay',{client,sender,userText:record.body.prompt});broker.start('replay','turn',client);
  const invoke=(args)=>broker.invokeBound({tool:'haolo_analysis',arguments:{context_id:context.token,...args}});
  await broker.invokeBound({tool:'haolo_account_read',arguments:{context_id:context.token,sections:['summary','positions']}});
  const pending=invoke({strategyId:'wyckoff'}),rejection=assert.rejects(pending,e=>e.code===mismatch.code&&e.terminal&&e.retryable===false);
  await new Promise(resolve=>setImmediate(resolve));
  const failure=businessToolError(cloudStrategyFailure(mismatch));
  broker.resolve(sender,{requestId:events[0].requestId,error:failure.message,errorDetails:failure});
  await rejection;
  await assert.rejects(invoke({strategyId:'chan',lookbackMs:566408520}),e=>e.code===mismatch.code);
  assert.equal(events.length,1);assert.equal(stops.length,1);broker.cancel('replay');
  rows.push({runId:record.runId,sha256:createHash('sha256').update(raw).digest('hex'),cloudState:run.state,
    baseline:'CLOUD_RESULT_CONTEXT_INVALID',validation:'passed',targetsPreserved:3,monitorTargets:1,
    historyAndCard:'passed',resumeReads:reads,journalState:saved.state,terminalStop:'passed',
    analysisAdmissions:events.filter(event=>event.arguments?.action==='analyze_only').length});
}
const evidence={task:'M1-421',verifiedAt:new Date().toISOString(),baselineRef,runs:rows};
fs.writeFileSync(path.join(directory,'verification.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
