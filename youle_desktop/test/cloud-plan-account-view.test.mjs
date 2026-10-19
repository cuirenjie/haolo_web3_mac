import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudPlanAccountView} from '../src/main/cloud-plan-account-view.mjs';
import {cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {cloudAccountPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';
import {defaultTakeProfitPercent,takeProfitNotionals} from '../src/main/take-profit-allocation.mjs';

const view=report=>cloudPlanAccountView(report.executionPlan,report.marketId,report.planRecords[0]);
const syncReceipt=report=>{report.planRecords[0].scenario=structuredClone(report.executionPlan.scenarios[0]);return report;};
const words={
  'zh-CN':['建议开仓','预计止损','预计盈利','止盈仓位','当前动作：','等待条件触发'],
  'zh-Hant':['建議開倉','預計止損','預計盈利','止盈倉位','當前動作：','等待條件觸發'],
  en:['Suggested position','Est. loss','Est. profit','Target position','Current action: ','Wait for the trigger'],
};

test('real server sizing uses legacy allocations without changing frozen quantity, budget or receipt',()=>{
  for(const side of ['long','short']){
    const report=cloudAccountPlanCardFixture('zh-CN',side),before=structuredClone(report);
    const sizing=report.executionPlan.scenarios[0].positionSizing;
    for(const field of ['side','entry','stop','targets'])assert.equal(Object.hasOwn(sizing,field),false,field);
    const account=view(report);
    assert.equal(account.quantity,0.00178165);
    assert.equal(account.notional,146.61591594650002);
    assert.equal(account.leverage,10);
    assert.equal(account.baseAsset,'BTC');assert.equal(account.currency,'USDT');
    assert.equal(Object.hasOwn(account,'targetOrders'),false,'display estimates must not be stored orders');
    assert.equal(account.allocationNotional,146.61);
    assert.deepEqual(account.targetEstimates.map(row=>row.notional),[73.30,73.31]);
    const scenario=report.executionPlan.scenarios[0],sign=side==='long'?1:-1;
    for(const [index,target] of scenario.targets.entries()){
      // Independent calculation from the raw server entry, quantity and cost,
      // not from the adapter's R/R-to-money conversion or rounded prices.
      const order=account.targetEstimates[index];
      const expected=order.notional*(sign*(target-scenario.entry)/scenario.entry-sizing.estimatedRoundTripCostRate);
      assert.equal(order.estimatedNetProfit,Math.floor((expected+Number.EPSILON)*100)/100);
    }
    assert.deepEqual(report,before,'presentation must not rewrite the frozen result');
  }
});

for(const strategy of OFFICIAL_TRADING_CATALOG)test(`${strategy.id}: server account DTO survives history, chat, saved plans and sticky cards`,()=>{
  for(const locale of Object.keys(words))for(const side of ['long','short']){
    const original=cloudAccountPlanCardFixture(locale,side);original.strategyId=strategy.id;
    const report=normalizeCloudReports(JSON.parse(JSON.stringify([original])))[0],before=structuredClone(report);
    const language=locale==='zh-Hant'?'zh-TW':locale;
    const saved=mergeCloudExecutionPlans([report],[])[0];
    for(const html of [renderCurrentReports([report]).rendered.cards,
      renderCurrentSavedPlan(saved,language),executionPlanStickyHtml({cloudReport:report,language})]){
      for(const value of [...words[locale],'146.61','73.30','73.31','-1.38','+0.66','+1.60'])assert.ok(html.includes(value),value);
      assert.equal((html.match(/class="execution-plan-account-detail execution-plan-target-profit execution-plan-estimate"/g)||[]).length,2);
      assert.equal((html.match(/class="execution-plan-account-detail execution-plan-target-amount"/g)||[]).length,2);
      assert.doesNotMatch(html,/\+1\.34|\+1\.88|NaN|Infinity/);
      const amounts=[...html.matchAll(/<div class="execution-plan-account-detail[^\"]*">([\s\S]*?)<\/div>/g)].map(match=>match[1]);
      assert.equal(amounts.length,6,'opening, loss, two target amounts and two cumulative profits');
      assert.doesNotMatch(amounts.join(''),/USDT|BTC|×|计划仓位|計畫倉位|Planned size|全仓净盈亏|全倉淨盈虧|Net P&amp;L/);
      assert.doesNotMatch(html,/class="execution-plan-(?:account-summary|quantity)"/);
      assert.match(html,/execution-plan-card-number-bearish">-1\.38</);
      assert.match(html,/execution-plan-card-number-bullish">\+0\.66</);
    }
    const executing=renderCurrentSavedPlan({...saved,status:'executing'},language);
    assert.doesNotMatch(executing,/class="execution-plan-expiry"/);
    assert.ok(executing.includes('146.61'));
    assert.deepEqual(report,before);assert.deepEqual(saved.cloudReport.executionPlan,report.executionPlan);
    assert.equal(renderCurrentReports([report]).rendered.bubbleContent,report.report);
  }
});

test('unavailable, blocked, incomplete and mismatched account records never borrow a global sizing',()=>{
  const changes=[
    r=>r.executionPlan.scenarios[0].positionSizing.accountStatus='unbound',
    r=>r.executionPlan.scenarios[0].positionSizing.accountStatus='unavailable',
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan=null,
    r=>r.executionPlan.scenarios[0].positionSizing.executionBlocked=true,
    r=>r.executionPlan.executionBlocked=true,
    r=>r.executionPlan.scenarios[0].eligible=false,
    r=>r.executionPlan.scenarios[0].side='short',
    r=>r.executionPlan.scenarios[0].conditionHash='b'.repeat(64),
    r=>r.executionPlan.scenarios[0].entryCondition.revision++,
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan.entryPrice++,
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan.notional++,
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan.quantity=0,
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan.quantity=NaN,
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan.equity=0,
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan.leverage=Infinity,
    r=>r.executionPlan.scenarios[0].positionSizing.accountPlan.snapshotAt=undefined,
    r=>r.executionPlan.scenarios[0].positionSizing.quantityIsOrder=true,
    r=>r.executionPlan.scenarios[0].positionSizing.entry=r.executionPlan.scenarios[0].entry,
    r=>delete r.executionPlan.scenarios[0].positionSizing,
    r=>r.marketId='BINANCE:SPOT:BTCUSDT',
    r=>r.marketId='BINANCE:FUTURES:BTCUSDC',
  ];
  for(const change of changes){
    const report=cloudAccountPlanCardFixture();change(report);syncReceipt(report);
    assert.equal(view(report),undefined,change.toString());
    assert.doesNotMatch(cloudPlanCard(report).html,/146\.61|预计盈利|预计止损|止盈仓位/,change.toString());
  }
  for(const change of [r=>r.planRecords[0].id='other',r=>r.planRecords[0].scenario.targets.reverse(),r=>r.planRecords[0].scenario.positionSizing.accountPlan.quantity++]){
    const report=cloudAccountPlanCardFixture();change(report);assert.equal(view(report),undefined);
  }
});

test('missing or invalid net outcomes stay absent, and explicit exits retain cumulative semantics',()=>{
  for(const invalid of [undefined,null,NaN,Infinity,'1.3']){
    const report=cloudAccountPlanCardFixture(),sizing=report.executionPlan.scenarios[0].positionSizing;
    sizing.netRiskReward[0]=invalid;syncReceipt(report);
    const html=cloudPlanCard(report).html;
    assert.ok(html.includes('146.61'));assert.ok(html.includes('73.30'));
    assert.doesNotMatch(html,/预计盈利|NaN|Infinity/,'missing earlier profit cannot form a cumulative later profit');
  }
  for(const invalid of [undefined,null,-1,NaN,Infinity]){
    const report=cloudAccountPlanCardFixture();report.executionPlan.scenarios[0].positionSizing.accountPlan.estimatedStopLoss=invalid;syncReceipt(report);
    assert.doesNotMatch(cloudPlanCard(report).html,/预计盈利|预计止损|NaN|Infinity/);
  }
  const report=cloudAccountPlanCardFixture(),scenario=report.executionPlan.scenarios[0];
  scenario.positionSizing.accountPlan.targetOrders=[{targetIndex:0,price:scenario.targets[0],notional:70,estimatedNetProfit:.5},
    {targetIndex:1,price:scenario.targets[1],notional:76.6159159465,estimatedNetProfit:1}];syncReceipt(report);
  const html=cloudPlanCard(report).html;
  assert.match(html,/预计盈利/);assert.match(html,/\+0\.50</);assert.match(html,/\+1\.50</);
  assert.doesNotMatch(html,/全仓净盈亏/);
  scenario.positionSizing.accountPlan.targetOrders.shift();syncReceipt(report);
  assert.doesNotMatch(cloudPlanCard(report).html,/预计盈利|全仓净盈亏/);
});

test('retest cards display the actual entry zone and bind sizing to its conservative endpoint',()=>{
  for(const direction of ['long','short']){
    const report=cloudAccountPlanCardFixture('zh-CN',direction),plan=report.executionPlan,scenario=plan.scenarios[0];
    const condition=plan.entryCondition;
    Object.assign(condition,{confirmation:'breakout_retest',breakoutConfirmation:'bar_close',
      trigger:{operator:direction==='long'?'cross_up':'cross_down',lower:82000},
      retest:{operator:'in_zone',lower:direction==='long'?82280:scenario.entry,upper:direction==='long'?scenario.entry:82300}});
    scenario.confirmation=condition.confirmation;scenario.entryCondition=structuredClone(condition);syncReceipt(report);
    const html=cloudPlanCard(report).html;
    assert.ok(html.includes(direction==='long'?'82280.00 – 82292.21':'82292.21 – 82300.00'));
    assert.ok(html.includes('146.61'));
    scenario.entry++;syncReceipt(report);assert.equal(view(report),undefined);
  }
});

test('frozen history is not revalued against the clock or unrelated top-level account amounts',()=>{
  const report=cloudAccountPlanCardFixture(),before=cloudPlanCard(report).html;
  report.executionPlan.positionSizing.accountPlan.notional=999999;
  assert.equal(cloudPlanCard(report).html,before);
  const account=view(report);account.targetEstimates[0].estimatedNetProfit=999;
  assert.equal(cloudPlanCard(report).html,before);
});

test('legacy target allocation preserves cents and the last remainder for one, two and three targets',()=>{
  assert.deepEqual(takeProfitNotionals(17.019,[33,33,34]),{notional:17.01,amounts:[5.61,5.61,5.79]});
  assert.deepEqual(takeProfitNotionals(65.669,[50,50]),{notional:65.66,amounts:[32.83,32.83]});
  for(const count of [1,2,3]){
    const report=cloudAccountPlanCardFixture(),scenario=report.executionPlan.scenarios[0];
    scenario.targets=Array.from({length:count},(_,i)=>83207.09+300*i);
    scenario.positionSizing.netRiskReward=Array.from({length:count},(_,i)=>i+1);
    syncReceipt(report);
    const account=view(report);
    assert.equal(account.targetEstimates.length,count);
    assert.equal(account.targetEstimates.reduce((sum,row)=>sum+Math.round(row.notional*100),0),14661);
    assert.deepEqual(Array.from({length:count},(_,i)=>defaultTakeProfitPercent(i,count)),count===1?[100]:count===2?[50,50]:[33,33,34]);
  }
  for(const value of [0,-1,NaN,Infinity,Number.MAX_VALUE])assert.equal(takeProfitNotionals(value,[50,50]),undefined);
  for(const percentages of [[],[50],[100,100],[-1,101],[NaN,50]])assert.equal(takeProfitNotionals(100,percentages),undefined);
});

test('explicit exits are authoritative, including missing or malformed arrays',()=>{
  for(const targetOrders of [[],null,{}]){
    const report=cloudAccountPlanCardFixture();report.executionPlan.scenarios[0].positionSizing.accountPlan.targetOrders=targetOrders;syncReceipt(report);
    assert.equal(view(report).targetEstimates,undefined);
    assert.doesNotMatch(cloudPlanCard(report).html,/止盈仓位|预计盈利/);
  }
});

test('conditional action remains waiting in each language and blocked plans never invite entry',()=>{
  for(const locale of Object.keys(words)){
    const report=cloudAccountPlanCardFixture(locale);
    const html=cloudPlanCard(report).html;
    assert.ok(html.includes(words[locale][4]));assert.ok(html.includes(words[locale][5]));
    assert.doesNotMatch(html,/现价做多|现价做空|at market/);
    assert.ok(html.lastIndexOf('execution-plan-details')>html.lastIndexOf('execution-plan-target-profit'));
    report.executionPlan.executionBlocked=true;
    assert.ok(cloudPlanCard(report).html.includes(locale==='en'?'Do not trade':locale==='zh-Hant'?'暫不交易':'暂不交易'));
  }
  const report=cloudAccountPlanCardFixture();
  report.executionPlan.positionSizing.executionBlocked=true;
  assert.match(cloudPlanCard(report).html,/等待条件触发/,'unrelated global sizing does not override this scenario');
  delete report.executionPlan.scenarios[0].positionSizing;
  assert.match(cloudPlanCard(report).html,/暂不交易/,'a legacy global sizing restriction remains visible');
});
