import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {cloudReportFromResponse,cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {leftRouteView,validLeftObservation} from '../src/main/price-action-left-card.mjs';
import {normalizeTradingAiDrawingPatch,persistTradingAiDrawingPatch,tradingDrawingSessionStorageKey} from '../src/renderer/trading-expert-drawing.ts';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {tradingTranscriptInjectionItems,parseTradingTranscriptMarkerText} from '../src/main/trading-expert-transcript.mjs';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/price-action-left-dual-receipts.json',import.meta.url)));

for(const route of ['protect','touch'])for(const locale of ['zh-CN','zh-Hant','en'])test(`${route}/${locale}: real backend receipt, drawings, card, saved and durable history`,()=>{
  const result=fixtures[`${route}-${locale}`],report=cloudReportFromResponse(result)[0],before=structuredClone(report);
  const card=cloudPlanCard(report),language=locale==='zh-Hant'?'zh-TW':locale;
  assert.ok(card&&!card.readOnly);
  assert.doesNotMatch(card.content,/Watch plans cannot|观察预案不能|觀察預案不能/);
  assert.ok(card.content.includes(route==='protect'?(locale==='en'?'4h reclaim':'4小'):(locale==='en'?'1h zone-touch':'1小')));
  assert.doesNotMatch(card.html,/Setup source|方案来源|方案來源|Maximum holding hours|最长持有|最長持有/);
  const parsed=normalizeTradingAiDrawingPatch(report.drawingPatch);
  const watchIds=report.drawingPatch.operations.filter(o=>o.drawing.id.includes('-left-watch-')).map(o=>o.drawing.id);
  assert.ok(watchIds.length);
  assert.ok(watchIds.every(id=>parsed.some(d=>d.id===id&&d.status==='tentative')));
  const storage=new Map();globalThis.window={localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
  persistTradingAiDrawingPatch('dual-fixture',report.drawingPatch);
  assert.ok(storage.has(tradingDrawingSessionStorageKey('ai','dual-fixture')));
  const items=tradingTranscriptInjectionItems([{id:'dual',role:'assistant',text:report.report,createdAt:new Date().toISOString(),cloudReports:[report]}]);
  const restored=parseTradingTranscriptMarkerText(items[0].content[0].text).cloudReports[0];
  assert.deepEqual(restored,report);
  const savedReport=structuredClone(report);savedReport.planRecords[0].status='pending';
  const saved=mergeCloudExecutionPlans([savedReport],[])[0];
  assert.ok(renderCurrentReports([restored]).rendered.cards.includes(card.html));
  const savedCard=cloudPlanCard(report,{language,separateAction:true});
  const savedHtml=renderCurrentSavedPlan(saved,language);
  assert.ok(savedHtml.includes(savedCard.html),'saved plan preserves the original body');
  assert.ok(savedCard.actionHtml && savedHtml.includes(savedCard.actionHtml),'saved plan retains its action');
  const stickyCard=cloudPlanCard(report,{language,separateAction:true});
  const sticky=executionPlanStickyHtml({cloudReport:report,language});
  assert.ok(sticky.includes(stickyCard.html),'sticky preserves the original plan body');
  assert.ok(stickyCard.actionHtml && sticky.includes(stickyCard.actionHtml),'sticky retains the condition action in its footer');
  assert.match(renderCurrentReports([report]).actions,/add-to-plan/);
  assert.deepEqual(report,before);
});

for(const route of ['protect','touch'])test(`${route}: observation-only cards cannot become executable plans or sticky actions`,()=>{
  const report=cloudReportFromResponse(fixtures[`${route}-watch`])[0];
  const rendered=renderCurrentReports([report]),card=cloudPlanCard(report);
  assert.equal(card,null);
  assert.equal(rendered.rendered.cards,'');
  assert.equal(rendered.actions,'');assert.equal(rendered.bindings.length,0);
  assert.doesNotMatch(rendered.rendered.cards,/data-message-execution-plan-action="sticky"|add-to-plan/);
  assert.throws(()=>mergeCloudExecutionPlans([report],[]),/CLOUD_PLAN_LIST_INVALID/);
  assert.ok(validLeftObservation(report.executionPlan.leftObservation));
  for(const mutate of [p=>p.canCreateAlert=true,p=>p.plans[0].zone.lower=-1,p=>p.plans[0].actionable=true,p=>p.version='unknown']){
    const tampered=structuredClone(report);mutate(tampered.executionPlan.leftObservation);
    assert.throws(()=>normalizeCloudReports([tampered]),/CLOUD_REPORT_INVALID/);
  }
});

test('current-price label has a bounded lifetime and does not rewrite frozen directions/prices',()=>{
  const report=cloudReportFromResponse(fixtures['touch-en'])[0],plan=report.executionPlan,p=plan.positionSizing.leftPolicy;
  p.entryState='ready';p.quoteAt=plan.createdAt;
  const before=structuredClone(plan);
  assert.equal(leftRouteView(plan,'en',p.quoteAt+1).action,plan.entryCondition.direction);
  assert.equal(leftRouteView(plan,'en',p.quoteAt+30001).action,'wait');
  assert.equal(leftRouteView(plan,'en',p.quoteAt-1).action,'wait');
  assert.equal(leftRouteView(plan,'en',plan.entryCondition.expiresAt).action,'blocked');
  assert.deepEqual(plan,before);
});
