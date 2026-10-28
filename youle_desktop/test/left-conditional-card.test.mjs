import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cloudReportFromResponse,cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {leftRouteView} from '../src/main/price-action-left-card.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {assertStickyCardParity,assertSeparatedCardParity} from './support/sticky-card-parity.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/left-conditional-receipts.json',import.meta.url)));

for(const [key,receipt] of Object.entries(fixtures))test(`${key}: formal conditional plan survives chat, saved plans and sticky`,()=>{
 const report=cloudReportFromResponse(receipt)[0],p=report.executionPlan,language=report.locale==='zh-Hant'?'zh-TW':report.locale;
 const original=Date.now;Date.now=()=>p.createdAt+1;
 try{
  assert.equal(p.outcome.action,'plan');assert.equal(p.outcome.candidateStatus,'qualified');
  assert.equal(p.positionSizing.leftPolicy.version,'left-conditional-fallback-v1');
  assert.equal(leftRouteView(p,language).action,'wait');
  const card=cloudPlanCard(report),chat=renderCurrentReports([report]);
  assert.ok(!card.readOnly);assert.ok(chat.actions.includes('data-execution-plan-message-id'));
  assert.doesNotMatch(card.content,/观察预案|觀察預案|watch plan/i);
  const pending=structuredClone(report);pending.planRecords[0].status='pending';
  const saved=mergeCloudExecutionPlans([pending],[])[0];
  assert.ok(chat.rendered.cards.includes(card.html));
  assertSeparatedCardParity(renderCurrentSavedPlan(saved,language),report,language);
  assertStickyCardParity(report,language);
  assert.deepEqual(normalizeCloudReports([report]),[report]);
  assert.equal(leftRouteView(p,language,p.expiresAt).action,'blocked');
  if(report.locale==='en')assert.doesNotMatch(card.content,/[\u4e00-\u9fff]/);
 }finally{Date.now=original;}
});
