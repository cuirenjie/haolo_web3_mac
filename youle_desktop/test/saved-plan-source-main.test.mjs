import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradingTranscriptHost} from './helpers/trading-transcript-host.mjs';
import {createCloudPlans} from '../src/main/trading-strategy-runtime/cloud-plans.mjs';
import {cloudAccountPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import fs from 'node:fs';

test('missing plan source cannot opt into creating a replacement thread',async t=>{
  const host=createTradingTranscriptHost(t,[],'target',{missingSourceId:'missing'});
  await assert.rejects(host.persist({restoreMissingThread:true,items:[{id:'one',role:'assistant',text:'report',createdAt:'2026-10-25T00:00:00Z'}]}),/thread not loaded/);
  assert.equal(host.calls.filter(c=>c.method==='thread/start').length,0);
});
test('source bindings are account scoped and never activate, delete, or alter a cloud plan',async()=>{
  const owner={ownerId:'owner-a',accountId:'a',baseUrl:'https://example.test'};
  const report=cloudAccountPlanCardFixture(),plan={...report.planRecords[0],saved:true};
  const calls=[],writes=[];
  const service=createCloudPlans({owner:async()=>owner,api:()=>({tradingCloudRequest:async(op)=>{calls.push(op);return plan;}}),
    sources:()=>({rememberOrigin:async(...args)=>writes.push(args)})});
  const sourceThreadId='00000000-0000-4000-8000-000000000099';
  assert.deepEqual(await service.perform('source',{planId:plan.id,runId:plan.runId,sourceThreadId}),{sourceThreadId});
  assert.deepEqual(calls,['plan']);assert.equal(writes[0][0],owner.ownerId);assert.equal(writes[0][1],plan.runId);
  await assert.rejects(service.perform('source',{planId:plan.id,runId:'different-run',sourceThreadId}),{code:'CLOUD_PLAN_SOURCE_INVALID'});
  assert.equal(writes.length,1);
  await assert.rejects(service.perform('source',{planId:plan.id,runId:plan.runId,sourceThreadId:'cloud-run:placeholder'}),{code:'CLOUD_PLAN_SOURCE_INVALID'});
});
test('cloud plan list hydrates each report with the exact run origin and rejects an account switch during lookup',async()=>{
  // The card-only fixture intentionally omits transport receipts. Use a full
  // synthetic server result so this checks the real saved-plan validation path.
  const {result,record}=JSON.parse(fs.readFileSync(new URL('./fixtures/wyckoff-retest-public.json',import.meta.url),'utf8')).cases.find(c=>c.kind==='long'&&c.locale==='zh-CN');
  result.ok=true;
  Object.assign(result.analysisPlan,{marketId:result.snapshot.marketId,interval:result.snapshot.interval,analysisId:result.analysisPlan.drawingPatch.analysisId});
  const plan={...structuredClone(result.cloud.planRecords[0]),saved:true};
  const run={id:result.cloud.runId,strategy:result.strategy.id,clientContract:'windows-v1',context:record.body.context,locale:result.cloud.locale,executionPolicy:'entry-v2',desktopResult:result};
  const original={ownerId:'a',accountId:'a',baseUrl:'https://example.test'};let owner=original;
  const origin={sourceThreadId:'exact-source',storageSessionId:'exact-source',analysisJobId:'job'};
  const sources={origins:async id=>{assert.equal(id,'a');return {[run.id]:origin,'another-run':{sourceThreadId:'wrong'}};}};
  const service=createCloudPlans({owner:async()=>owner,sources:()=>sources,api:()=>({tradingCloudRequest:async op=>{
    assert.equal(op,'plans');return {items:[plan],receipts:{[plan.id]:run}};
  }})});
  const listed=await service.perform('list');assert.deepEqual(listed.reports[0].origin,origin);
  sources.origins=async()=>{owner={...owner,ownerId:'b'};return {};};
  await assert.rejects(service.perform('list'),{code:'TRADING_PREFERENCE_OWNER_CHANGED'});
});
