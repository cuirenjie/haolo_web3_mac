import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import {mergeCloudExecutionPlans,createCloudPlanRefresher} from '../src/renderer/cloud-plan-sync.ts';
import {createCloudReportRestorer} from '../src/renderer/cloud-report-restore.ts';
import {storeCloudIndicatorPatch,loadCloudIndicatorPatch,migrateCloudIndicatorPatches,renderIndicatorAnalysisPatch} from '../src/renderer/cloud-indicator-drawings.ts';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function report(n=1) {
  const condition={schemaVersion:2,conditionId:uuid(n+200),revision:1,direction:'long',interval:'1h',confirmation:'touch',trigger:{operator:'at_or_below',lower:100},expiresAt:1900000000000};
  const scenario={stop:95,targets:[110],conditionHash:'a'.repeat(64)};
  return {schemaVersion:1,runId:uuid(n),resultHash:'b'.repeat(64),locale:'en',marketId:'BTC',interval:'60',strategyId:'rsi-analysis',report:'Original report',
    executionPlan:{schemaVersion:2,planId:uuid(n+100),createdAt:1800000000000,requestedMode:'left',selectedMode:'left',conditionHash:'a'.repeat(64),entryCondition:condition,scenarios:[scenario],outcome:{action:'plan'}},
    planRecords:[{id:uuid(n+100),runId:uuid(n),version:1,confirmationHash:'c'.repeat(64),monitoringPolicy:'entry_v2',scenario,status:'pending',createdAt:'2027-01-15T08:00:00Z'}],
    origin:{sourceThreadId:'original',storageSessionId:'original',analysisJobId:'job:pane:1'}};
}
const response=r=>({cloud:{executionPolicy:'entry-v2',runId:r.runId,resultHash:r.resultHash,locale:r.locale,planRecords:r.planRecords,origin:r.origin},snapshot:r,strategy:{id:r.strategyId},executionPlan:r.executionPlan,analysisPlan:{report:r.report}});
const patch=(analysisId='first')=>({schemaVersion:1,analysisId,marketId:'BTC',interval:'60',indicatorId:'rsi',operations:[{op:'upsert',drawing:{id:'path',theory:'strategy',strategyId:'rsi-analysis',layer:'ai/strategy/rsi-analysis',tool:'path',points:[{time:100,value:20},{time:100,value:30},{time:99,value:50}],colorToken:'strategy-primary'}}]});
function storage() {const data=new Map();globalThis.window={localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)}};return data;}

test('server plan pagination merges more than eight reports and retains original history origin',()=>{
  const reports=Array.from({length:55},(_,i)=>report(i+1));
  const first=mergeCloudExecutionPlans(reports,[]);assert.equal(first.length,55);
  reports[0].origin=null;reports[0].planRecords[0].status='executing';
  const next=mergeCloudExecutionPlans(reports,first);assert.equal(next[0].cloudReport.origin.sourceThreadId,'original');assert.equal(next[0].status,'executing');
  assert.throws(()=>mergeCloudExecutionPlans([reports[0],reports[0]],[]),/CLOUD_PLAN_LIST_INVALID/);
});

test('account switch can refresh immediately while old account response is discarded',async()=>{
  let scope='A';const pending=[],applied=[],saved=[];
  const refresh=createCloudPlanRefresher({scope:()=>scope,load:()=>new Promise(resolve=>pending.push(resolve)),read:()=>[],apply:x=>applied.push(x),save:(owner)=>{saved.push(owner);return true;},changed:()=>{},cacheFailure:()=>assert.fail(),failure:()=>assert.fail()});
  const a=refresh();scope='B';const b=refresh();assert.equal(pending.length,2);
  pending[1]({ok:true,reports:[report(2)]});await b;pending[0]({ok:true,reports:[report(1)]});await a;
  assert.deepEqual(saved,['B']);assert.equal(applied.length,1);assert.equal(applied[0][0].cloudReport.runId,uuid(2));
});

test('recovery persists to the original aliased thread before drawing and avoids duplicate history',async()=>{
  const r=report(),calls=[];let items=[];
  const restore=createCloudReportRestorer({scope:()=> 'owner',resolve:()=> 'aliased',read:async id=>{calls.push(['read',id]);return items;},upsert:(id)=>calls.push(['upsert',id]),persist:async(id,value)=>{calls.push(['persist',id]);items=[{__youleCloudReports:[value]}];return id;},restoreDrawings:(_r,id)=>calls.push(['draw',id]),refresh:id=>calls.push(['refresh',id])});
  assert.equal(await restore(response(r),'key',()=>true),true);assert.deepEqual(calls,[['read','aliased'],['persist','aliased'],['draw','aliased'],['refresh','aliased']]);
  calls.length=0;await restore(response(r),'key',()=>true);assert.equal(calls.some(x=>x[0]==='persist'),false);
  items[0].__youleCloudReports[0].resultHash='d'.repeat(64);
  await assert.rejects(restore(response(r),'key',()=>true),/CLOUD_RESULT_CONTEXT_INVALID/);
});

test('failed history storage and late account replies cannot acknowledge or draw',async()=>{
  for(const switchOwner of [false,true]) {
    let scope='A';const calls=[];
    const restore=createCloudReportRestorer({scope:()=>scope,resolve:x=>x,read:async()=>{if(switchOwner)scope='B';return [];},upsert:()=>assert.fail(),persist:async()=>{throw Error('disk full');},restoreDrawings:()=>calls.push('draw'),refresh:()=>calls.push('refresh')});
    if(switchOwner)assert.equal(await restore(response(report()),'key',()=>true),false);
    else await assert.rejects(restore(response(report()),'key',()=>true),/disk full/);
    assert.deepEqual(calls,[]);
  }
});

test('indicator cache separates thread, pane and market and safely migrates only missing entries',()=>{
  const data=storage();storeCloudIndicatorPatch('thread::split-pane:1',patch());
  assert.equal(loadCloudIndicatorPatch('thread','BTC','60','rsi'),null);
  assert.equal(loadCloudIndicatorPatch('thread::split-pane:1','ETH','60','rsi'),null);
  storeCloudIndicatorPatch('saved::split-pane:1',patch('newer'));migrateCloudIndicatorPatches('thread::split-pane:1','saved::split-pane:1');
  assert.equal(loadCloudIndicatorPatch('saved::split-pane:1','BTC','60','rsi').analysisId,'newer');
  migrateCloudIndicatorPatches('thread::split-pane:1','fresh');assert.equal(loadCloudIndicatorPatch('fresh','BTC','60','rsi').analysisId,'first');
  data.set('haolo.trading.indicator-results.v1:corrupt','[null,{}]');storeCloudIndicatorPatch('corrupt',patch());
  assert.equal(loadCloudIndicatorPatch('corrupt','BTC','60','rsi').analysisId,'first');
});

test('shared indicator renderer restores original path geometry without adding time-series data',()=>{
  storage();globalThis.getComputedStyle=()=>({getPropertyValue:()=>''});globalThis.document={documentElement:{}};
  const added=[],removed=[];
  const api={attachPrimitive:p=>{added.push(p);p.attached({chart:{},series:api});},detachPrimitive:p=>removed.push(p),priceScale:()=>({setAutoScale(){}})};
  const runtime={pane:{addSeries:()=>assert.fail('annotation must not add a data series')},series:[{api}],analysisSeries:[],analysisMarkers:null,analysisSignature:''};
  const options={chart:{removeSeries:()=>assert.fail('no new series to remove')},runtime,host:{},dark:true,timeOffsetSeconds:28800,getCandles:()=>[]};
  renderIndicatorAnalysisPatch({...options,patch:storeCloudIndicatorPatch('x',patch())});
  assert.deepEqual(added[0].paths[0].points,patch().operations[0].drawing.points);
  renderIndicatorAnalysisPatch({...options,patch:loadCloudIndicatorPatch('x','BTC','60','rsi')});assert.equal(added.length,1);
  renderIndicatorAnalysisPatch({...options,patch:null});assert.deepEqual(removed,added);assert.equal(runtime.analysisSignature,'');
});

test('actual split-pane receiver activates the correct indicator and rejects wrong contexts',()=>{
  storage();const source=fs.readFileSync(new URL('../src/renderer/trading-expert-split-pane.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('split.ts',source,ts.ScriptTarget.Latest,true),methods=[];
  function visit(n){if(ts.isMethodDeclaration(n)&&['acceptIndicatorAnalysisDrawingPatch','renderCloudIndicatorPatch','restoreCloudIndicatorSelection','updateDrawingStorageSession'].includes(n.name.getText(ast)))methods.push(n.getText(ast));ts.forEachChild(n,visit);}visit(ast);
  const compiled=ts.transpileModule(`class Harness {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const rendered=[];
  const Harness=Function('normalizeTradingIndicatorAiDrawingPatch','storeCloudIndicatorPatch','loadCloudIndicatorPatch','migrateCloudIndicatorPatches','renderIndicatorAnalysisPatch','TRADING_INDICATORS','CHINA_TIME_OFFSET_SECONDS',compiled+';return Harness;')(
    value=>value,storeCloudIndicatorPatch,loadCloudIndicatorPatch,migrateCloudIndicatorPatches,o=>rendered.push(o),[{id:'rsi'}],28800);
  const pane=new Harness();Object.assign(pane,{drawingStorageSessionId:'thread::split-pane:1',market:{id:'BTC'},interval:'60',indicatorPanes:new Map(),activeIndicators:[],themeName:'dark',analysisContextMatches:(market,interval)=>market==='BTC'&&interval==='60',activateIndicator:(_scope,id)=>pane.indicatorPanes.set(id,{}),rebuildIndicatorPanes:()=>pane.indicatorPanes.set('rsi',{}),updateIndicatorButtons:()=>{},notifyIndicatorSelectionChange:()=>{}});
  assert.equal(pane.acceptIndicatorAnalysisDrawingPatch({...patch(),marketId:'ETH'}),false);
  assert.equal(pane.acceptIndicatorAnalysisDrawingPatch(patch()),true);assert.equal(rendered.at(-1).patch.analysisId,'first');
  pane.updateDrawingStorageSession('new');assert.equal(rendered.at(-1).patch,null);
  pane.updateDrawingStorageSession('thread::split-pane:1');assert.equal(rendered.at(-1).patch.analysisId,'first');assert.deepEqual(pane.activeIndicators,['rsi']);
});
