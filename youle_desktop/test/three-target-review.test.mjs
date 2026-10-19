import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewThreeTakeProfitTargets} from '../src/main/trading-strategy-runtime/three-target-review.mjs';
import {cloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';

for(const side of ['long','short'])test(`${side}: compressed targets preserve geometry and net ratio floor`,()=>{
  const sign=side==='long'?1:-1,entry=100,stop=entry-sign*10,final=entry+sign*(.2+10.2*.74);
  const value={side,trigger:{price:entry},stop:{price:stop},targets:[{price:final,label:'structure'}]},before=structuredClone(value);
  const result=reviewThreeTakeProfitTargets(value,{costRate:.002,tickSize:.01});
  assert.equal(result.targets.length,3);assert.equal(new Set(result.targets.map(t=>t.price)).size,3);
  assert.equal(result.targets.at(-1).price,final);
  assert.ok(result.targets.every(t=>(sign*(t.price-entry)-.2)/10.2>=.4));
  assert.deepEqual(value,before);
  assert.deepEqual(reviewThreeTakeProfitTargets(result,{costRate:.002,tickSize:.01}),result);
  assert.deepEqual(reviewThreeTakeProfitTargets(value,{costRate:.002,tickSize:.01,candles:[{closed:false,high:100000,low:.01}]}),result);
  assert.equal(reviewThreeTakeProfitTargets({...value,targets:[{price:entry+sign*(.2+10.2*.40000001)}]},{costRate:.002,tickSize:.01}),null);
});

for(const strategy of OFFICIAL_TRADING_CATALOG)for(const locale of ['zh-CN','zh-Hant','en'])for(const direction of ['long','short'])
test(`${strategy.id}/${locale}/${direction}: three exits and one left entry across all card surfaces`,()=>{
  const report=cloudPlanCardFixture(locale),plan=report.executionPlan,scenario=plan.scenarios[0];
  report.strategyId=strategy.id;plan.selectedMode='left';plan.requestedMode='left';
  Object.assign(plan.entryCondition,{direction,confirmation:'touch',trigger:{operator:'in_zone',lower:80681.26,upper:81490.77}});
  Object.assign(scenario,{side:direction,targets:direction==='long'?[82559.15,83200,84000]:[80000,79000,78000],riskReward:[.5,.9,1.4]});
  plan.positionSizing={leftPolicy:{version:'left-conditional-fallback-v1',referencePrice:82045.3,referenceAt:plan.createdAt}};
  const before=structuredClone(report),language=locale==='zh-Hant'?'zh-TW':locale;
  const card=cloudPlanCard(report),saved=mergeCloudExecutionPlans([report],[])[0];
  for(const html of [card.html,renderCurrentReports([report]).rendered.cards,renderCurrentSavedPlan(saved,language),executionPlanStickyHtml({cloudReport:report,language})]){
    assert.equal((html.match(/class="execution-plan-target"/g)||[]).length,3);
    assert.ok(html.includes(`execution-plan-price ${direction==='long'?'bullish':'bearish'}">${direction==='long'?'80681.26':'81490.77'}<`));
    assert.doesNotMatch(html,/80681.26 – 81490.77|Reference quote|行情参考|行情參考|zone reclaim|激活后|啟用後/);
  }
  assert.deepEqual(report,before);
});
