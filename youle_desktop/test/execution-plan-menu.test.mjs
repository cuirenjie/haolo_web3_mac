import {visibleTradingPlanDrawingPatch} from '../src/renderer/trading-plan-drawing-history.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {cloudPlanDrawingPatch} from '../src/shared/execution-plan-drawings.mjs';
import {TradingAiDrawingSets} from '../src/renderer/trading-ai-drawing-sets.ts';
import {planMenuOptions, planMenuFacts, planMenuText, planChartContext} from '../src/renderer/execution-plan-menu.ts';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {cloudAccountPlanCardFixture, legacyCloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {parsePlanInvitation, verifyPlanInvitation, savePlanShareImage} from '../src/main/execution-plan-share.mjs';

const candidate = (report = cloudAccountPlanCardFixture()) => ({...cloudPlanCard(report), cloudReport: report});
const context = () => ({key: 'thread/message/0', scope: 'user', candidate: candidate(), complete: true, busy: false, chartBusy: false});
const now = Date.parse('2026-10-18T12:32:21Z');
test('conversation menu matches mobile for unsaved, saved, ended and expired plans', () => {
  const c = context();
  assert.deepEqual(planMenuOptions(c, now), ['add','chart','sticky','share'].map(action => ({action, enabled: true})));
  for (const status of ['pending', 'executing', 'ended']) {
    c.saved = {id: 'saved', status}; assert.equal(planMenuOptions(c, now)[0].action, 'view');
  }
  delete c.saved;
  assert.equal(planMenuOptions(c, now + 86400000)[0].action, 'view');
  c.candidate.cloudReport.planRecords[0].saved = true;
  assert.equal(planMenuOptions(c, now)[0].action, 'view');
});
test('incomplete, ineligible and busy plans cannot invoke unavailable actions', () => {
  const c = context(); c.complete = false;
  assert.deepEqual(planMenuOptions(c, now).map(o=>o.enabled), [false,true,true,false]);
  c.complete = true; c.candidate.cloudReport.planRecords[0].scenario.eligible = false;
  assert.equal(planMenuOptions(c, now)[0].enabled, false);
  c.chartBusy = true; assert.equal(planMenuOptions(c, now)[1].enabled, false);
  c.busy = true; assert.ok(planMenuOptions(c, now).every(o=>!o.enabled));
});
test('legacy and cloud chart targets remain bound to the original report, not its execution timeframe', () => {
  const c = candidate(); c.cloudReport.executionPlan.entryCondition.interval = '15m';
  assert.deepEqual(planChartContext(c), {marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '60'});
  const legacy = candidate(legacyCloudPlanCardFixture('wyckoff'));
  assert.equal(planMenuFacts(legacy, now).canShare, true);
  delete legacy.cloudReport;
  assert.deepEqual(planChartContext(legacy), {marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '1h'});
  assert.throws(()=>planChartContext({title:'unrelated',content:''}));
});
test('all menu choices have Simplified Chinese, Traditional Chinese and English labels', () => {
  for (const language of ['zh-CN','zh-TW','en']) for (const key of ['add','view','chart','sticky','share','menu','close']) assert.ok(planMenuText(key, language));
  assert.equal(planMenuText('view','en'), 'View plan'); assert.equal(planMenuText('share','zh-TW'), '分享計畫');
});

const row = () => ({status:'active',id:'link-1',code:'Hao123',url:'https://haolo.com/?invite=Hao123&referral_token=public-token'});
test('invitation parser rejects inactive, foreign, credentialed and ambiguous links', () => {
  assert.deepEqual(parsePlanInvitation(row()), {id:'link-1',code:'Hao123',url:row().url});
  for (const patch of [{status:'disabled'},{url:'http://haolo.com/?invite=Hao123&referral_token=t'},
    {url:row().url.replace('haolo.com','attacker.test')},{url:row().url+'&invite=Hao123'},
    {url:row().url+'&access_token=secret'},{url:row().url+'#fragment'}, {url:row().url.replace('https://','https://secret@')}]) assert.equal(parsePlanInvitation({...row(),...patch}),null);
});
function client(options={}) {
  let calls=[];
  const c = {authRevision:1,baseUrl:'https://haolo.com',load:async()=>{},requireAuth:()=>{},clientHeaders:({auth})=>({auth}),
    requestJson: async (url, request) => {
      calls.push({url, request});
      if (url.includes('/me/links')) { if(options.switchAccount)c.authRevision++; return {items: options.items ?? [row()]}; }
      return {valid:!options.invalid,invite_code:'Hao123',referral_token:'public-token'};
    }};
  return {c,calls};
}
test('each share export verifies ownership and public resolution without public auth', async () => {
  const {c,calls}=client(); await verifyPlanInvitation(c); await verifyPlanInvitation(c,'link-1');
  assert.equal(calls.length,4); assert.equal(calls[0].request.headers.auth,true); assert.equal(calls[1].request.headers.auth,false);
  assert.match(calls[1].url,/invite_code=Hao123&referral_token=public-token/);
});
test('the authenticated client exposes invitation verification through its own instance', async () => {
  const {c,calls}=client(); Object.setPrototypeOf(c,YouleApiClient.prototype);
  assert.equal((await c.verifyPlanShareInvitation()).id,'link-1');
  assert.equal(calls.length,2); assert.deepEqual(calls[0].request.headers,{auth:true});
});
test('sharing fails closed after logout, revoked links, missing setup or changed ownership', async () => {
  for (const [options,id,message] of [[{switchAccount:true},null,'SESSION_CHANGED'],[{invalid:true},null,'INVITATION_UNAVAILABLE'],
    [{items:[]},null,'INVITATION_SETUP_REQUIRED'],[{},'foreign-link','INVITATION_UNAVAILABLE']]) {
    await assert.rejects(verifyPlanInvitation(client(options).c,id),new RegExp(message));
  }
});
test('image save validates PNG, respects cancel and rechecks account after the native dialog', async () => {
  const dataUrl='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  await assert.rejects(savePlanShareImage({dataUrl:'data:text/plain;base64,AA=='}),/INVALID_PLAN_IMAGE/);
  const dialog={showSaveDialog:async()=>({canceled:true})};
  assert.deepEqual(await savePlanShareImage({dataUrl,dialog,language:'en'}),{saved:false});
  dialog.showSaveDialog=async()=>({canceled:false,filePath:'must-not-write.png'});
  assert.deepEqual(await savePlanShareImage({dataUrl,dialog,valid:()=>false}),{saved:false});
});
test('image export writes the exact preview PNG to the user-selected destination', async () => {
  const folder=new URL('../.cache/plan-menu-export-test/',import.meta.url);fs.mkdirSync(folder,{recursive:true});
  const destination=new URL('plan.png',folder);
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2sAAAAASUVORK5CYII=','base64');
  const dialog={showSaveDialog:async()=>({canceled:false,filePath:destination})};
  assert.deepEqual(await savePlanShareImage({dataUrl:'data:image/png;base64,'+bytes.toString('base64'),dialog,language:'zh-CN'}),{saved:true});
  assert.deepEqual(fs.readFileSync(destination),bytes);
});

const chartSource=fs.readFileSync(new URL('../src/renderer/trading-expert-market.ts',import.meta.url),'utf8');
const chartAst=ts.createSourceFile('market.ts',chartSource,ts.ScriptTarget.Latest,true);
const chartFunction=chartAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='showTradingExecutionPlanChart').getText(chartAst).replace(/^export /,'');
const chartJs=ts.transpileModule(chartFunction,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
test('chart action loads the source market before restoring its frozen drawing and rejects switched sessions', async () => {
  const report=cloudAccountPlanCardFixture(),calls=[];
  report.drawingPatch={marketId:report.marketId,interval:report.interval,analysisId:'analysis',baseRevision:1,operations:[]};
  let valid=true;
  const workspace={drawingStorageSessionMatches:id=>id==='source',
    prepareAlertContext:async(marketId,interval,options)=>{calls.push({action:'load',marketId,interval});options.assertActive();},
    showExecutionPlanDrawing:async(patch,assertActive)=>{assertActive();calls.push({action:'drawing',patch});}};
  const run=Function('normalizeCloudReports','visibleTradingPlanDrawingPatch','activeWorkspace',chartJs+';return showTradingExecutionPlanChart;')(normalizeCloudReports,visibleTradingPlanDrawingPatch,workspace);
  const context={marketId:report.marketId,interval:report.interval};
  await run(report,context,'source',()=>valid);
  assert.deepEqual(calls.map(c=>c.action),['load','drawing']);assert.equal(calls[1].patch.drawingTurnId,`plan:${report.runId}`);
  assert.equal(report.drawingPatch.drawingTurnId,undefined,'the signed report remains immutable');
  calls.length=0;workspace.prepareAlertContext=async()=>{valid=false;};
  await assert.rejects(run(report,context,'source',()=>valid));assert.equal(calls.length,0);
  valid=true;await assert.rejects(run(report,context,'other',()=>valid));
});
test('selecting a plan drawing chooses the exact frozen set and preserves other markets', () => {
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const sets=new TradingAiDrawingSets(storage,'source',v=>v),btc={marketId:'BTC',interval:'60'},eth={marketId:'ETH',interval:'15'};
  for(const id of ['a','b'])sets.upsert(btc,'turn',id,[{id,symbol:'BTC',interval:'60'}]);
  sets.upsert(eth,'other','eth',[{id:'eth',symbol:'ETH',interval:'15'}]);
  assert.equal(sets.select(btc,'a'),true);assert.equal(sets.select(btc,'missing'),false);
  assert.deepEqual(sets.selectedDrawings([]).map(d=>d.id),['a','eth']);
  const restored=new TradingAiDrawingSets(storage,'source',v=>v);assert.deepEqual(restored.selectedDrawings([]).map(d=>d.id),['a','eth']);
});
