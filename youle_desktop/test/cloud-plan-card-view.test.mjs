import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {cloudPlanCard,normalizeCloudReports} from '../src/main/cloud-plan-contract.mjs';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {renderCurrentReports,renderCurrentSavedPlan} from './support/right-renderer-parity.mjs';
import {cloudPlanCardFixture,legacyCloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';
import {executionPlanDisplayLines} from '../src/renderer/execution-plans.ts';

test('screenshot cloud plan matches the mobile compact layout while keeping its frozen text and receipt',()=>{
  const report=cloudPlanCardFixture(),before=structuredClone(report),card=cloudPlanCard(report);
  assert.match(card.html,/>BTC · 1h<\/h2>/);
  assert.match(card.html,/execution-plan-badge bullish">做多</);
  assert.match(card.html,/execution-plan-badge strategy" title="裸K分析">裸K分析</);
  assert.match(card.html,/execution-plan-price bullish">82292\.30</);
  assert.match(card.html,/execution-plan-price bearish">81682\.20</);
  assert.equal((card.html.match(/class="execution-plan-target"/g)||[]).length,2);
  for(const value of ['83207.45','83512.50'])assert.ok(card.html.includes(value),value);
  assert.doesNotMatch(card.html,/入场方式|执行周期|入场条件|条件失效|条件满足仅提醒/);
  assert.equal(card.content,`BINANCE:FUTURES:BTCUSDT · 1h · 条件交易计划
入场方式: 自动判断 / 右侧
执行周期: 1h · 做多
入场条件: 等待已收盘 K 线满足条件； 价格从下方向上穿越 82292.3
止损 / 结构失效: 81682.2
止盈参考: 83207.45 / 83512.5
条件失效: 价格达到或低于 81682.2
有效至（UTC）: 2026-10-18T15:32:21.009Z
条件满足仅提醒，不表示成交，不会自动下单。`);
  assert.deepEqual(report,before);
});

for(const locale of ['zh-CN','zh-Hant','en'])test(`restored ${locale} cards share chat, saved-plan and sticky layout`,()=>{
  const original=cloudPlanCardFixture(locale),report=normalizeCloudReports(JSON.parse(JSON.stringify([original])))[0];
  const card=cloudPlanCard(report),language=locale==='zh-Hant'?'zh-TW':locale;
  const {rendered,actions,bindings}=renderCurrentReports([report]);
  const saved=mergeCloudExecutionPlans([report],[])[0];
  for(const html of [rendered.cards,renderCurrentSavedPlan(saved,language),executionPlanStickyHtml({cloudReport:report,language,title:card.title})]){
    assert.ok(html.includes(card.html));
    assert.equal((html.match(/<h2 /g)||[]).length,1);
    assert.match(html,/class="execution-plan-details/);
  }
  assert.match(actions,/data-execution-plan-index="0"/);
  assert.equal(bindings[0][1].cloudReport.planRecords[0].id,original.executionPlan.planId);
  assert.equal(saved.content,card.content);
  assert.deepEqual(saved.cloudReport.executionPlan,original.executionPlan);
  assert.ok(card.html.includes(locale==='en'?'Entry trigger':locale==='zh-Hant'?'入場觸發價':'入场触发价'));
  assert.ok(card.content.includes(locale==='en'?'Condition invalidation':locale==='zh-Hant'?'條件失效':'条件失效'));
  assert.equal(rendered.bubbleContent,original.report);
});

test('all predicates, sides and modes preserve exact conditional prices and bounded zones',()=>{
  for(const operator of ['at_or_above','at_or_below','cross_up','cross_down','in_zone'])for(const direction of ['long','short'])for(const mode of ['auto','left','right']){
    const report=cloudPlanCardFixture(),condition=report.executionPlan.entryCondition;
    report.executionPlan.requestedMode=mode;report.executionPlan.selectedMode=mode==='auto'?'right':mode;
    condition.direction=direction;condition.confirmation='touch';
    condition.trigger={operator,lower:0.04565741,...(operator==='in_zone'?{upper:0.04750929}:{})};
    condition.invalidation={operator:'at_or_below',lower:0.04152439};
    const card=cloudPlanCard(normalizeCloudReports([report])[0]);
    assert.ok(card.content.includes('0.04565741'));
    assert.ok(card.content.includes('0.04152439'));
    assert.ok(card.html.includes(`execution-plan-price ${direction==='long'?'bullish':'bearish'}">0.045657`));
    if(operator==='in_zone'){
      assert.ok(card.html.includes('0.045657 – 0.047509'));
      assert.ok(card.content.includes('[0.04565741, 0.04750929]'));
    }
    assert.doesNotMatch(card.html,/建议开仓|预计盈利/);
  }
});

test('breakout-retest keeps confirmation, zone, snapshot and live-evidence requirements',()=>{
  for(const locale of ['zh-CN','zh-Hant','en'])for(const confirmation of ['touch','bar_close']){
    const report=cloudPlanCardFixture(locale),condition=report.executionPlan.entryCondition;
    Object.assign(condition,{confirmation:'breakout_retest',breakoutConfirmation:confirmation,retest:{operator:'in_zone',lower:82123.12345,upper:82234.23456},confirmedBreakout:true,liveEvidenceGate:true});
    const card=cloudPlanCard(normalizeCloudReports([report])[0]);
    assert.ok(card.content.includes('[82123.12345, 82234.23456]'));
    const entry=card.content.split('\n').find(line=>/^(入场条件|入場條件|Entry condition):/.test(line));
    assert.ok(entry);
    assert.ok(entry.includes(locale==='en'?'Fresh trades':locale==='zh-Hant'?'重新核驗':'重新核验'));
    assert.match(card.html,/class="execution-plan-details/);
  }
});

test('optional invalidation stays absent and non-plan outcomes never produce cards',()=>{
  const report=cloudPlanCardFixture();delete report.executionPlan.entryCondition.invalidation;
  assert.doesNotMatch(cloudPlanCard(report).content,/条件失效:/);
  report.executionPlan.outcome.action='wait';assert.equal(cloudPlanCard(report),null);
  report.executionPlan.outcome.action='plan';report.executionPlan.scenarios=[];assert.equal(cloudPlanCard(report),null);
});

test('headings retain market identity, month/minute distinctions and escape untrusted metadata',()=>{
  for(const interval of ['1m','1M']){
    const report=cloudPlanCardFixture();report.marketId='BINANCE:FUTURES:ETHUSDC';report.executionPlan.entryCondition.interval=interval;
    assert.ok(cloudPlanCard(report).html.includes(`>ETH/USDC · ${interval}</h2>`));
  }
  const report=cloudPlanCardFixture();report.marketId='BINANCE:SPOT:BTCUSDT';
  assert.match(cloudPlanCard(report).html,/>BINANCE:SPOT:BTCUSDT · 1h/);
  report.marketId='<img src=x onerror=alert(1)>';report.strategyId='<script>alert(1)</script>';
  const html=cloudPlanCard(report).html;assert.doesNotMatch(html,/<img|<script/);assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);
});

for(const strategy of OFFICIAL_TRADING_CATALOG)test(`${strategy.id}: both cloud policies use latest cards in every surface, language and direction`,()=>{
  for(const locale of ['zh-CN','zh-Hant','en'])for(const direction of ['long','short'])for(const policy of ['entry-v2','right-legacy-v1']){
    const report=policy==='entry-v2'?cloudPlanCardFixture(locale):legacyCloudPlanCardFixture(strategy.id,locale,direction);
    report.strategyId=strategy.id;
    if(policy==='entry-v2')report.executionPlan.entryCondition.direction=direction;
    const before=structuredClone(report),language=locale==='zh-Hant'?'zh-TW':locale;
    const card=cloudPlanCard(report),chat=renderCurrentReports([report]),saved=mergeCloudExecutionPlans([report],[])[0];
    const sticky=executionPlanStickyHtml({cloudReport:report,title:card.title,lines:executionPlanDisplayLines(card.content),language});
    for(const html of [chat.rendered.cards,renderCurrentSavedPlan(saved,language),sticky]){
      assert.match(html,/class="execution-plan-metrics"/);
      assert.equal((html.match(/class="execution-plan-target"/g)||[]).length,2);
      assert.ok(html.includes(`execution-plan-badge ${direction==='long'?'bullish':'bearish'}`));
      assert.match(html,/execution-plan-badge strategy/);
      assert.equal((html.match(/class="execution-plan-expiry"/g)||[]).length,1);
      assert.match(html,/<time datetime="2026-10-18T15:32:21\.009Z"/);
      assert.ok(html.includes('<strong>83207.45</strong>'));
      if(policy==='entry-v2')assert.doesNotMatch(html,/入场方式|入場方式|Entry mode|Condition invalidation/);
    }
    const badge=card.html.match(/execution-plan-badge strategy" title="([^"]+)"/)[1];
    assert.notEqual(badge,strategy.id,'official strategy badge must use a display name');
    assert.deepEqual(report,before);
    assert.deepEqual(saved.cloudReport.executionPlan,report.executionPlan);
  }
});

test('expiry uses device local time with an offset; executing list alone hides it for both policies',()=>{
  for(const report of [cloudPlanCardFixture(),legacyCloudPlanCardFixture('wyckoff')]){
    const date=new Date(report.planRecords[0].expiresAt),pad=n=>String(n).padStart(2,'0');
    const local=`${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const html=cloudPlanCard(report).html;
    assert.ok(html.includes(`>${local} (UTC`));
    assert.doesNotMatch(html.match(/<time[^>]*>([^<]+)<\/time>/)[1],/\d{4}-/);
    assert.ok(html.indexOf('execution-plan-expiry')<html.indexOf('execution-plan-price'));
    const saved=mergeCloudExecutionPlans([report],[])[0];
    for(const status of ['pending','ended','executing']){
      const markup=renderCurrentSavedPlan({...saved,status});
      assert.equal(markup.includes('class="execution-plan-expiry"'),status!=='executing');
    }
    assert.match(executionPlanStickyHtml({cloudReport:report}),/class="execution-plan-expiry"/);
    assert.match(cloudPlanCard(report,{language:'en'}).html,/>Valid until /);
  }
  const legacy=legacyCloudPlanCardFixture('price-action');
  for(const invalid of [undefined,null,NaN,Infinity,-1,8640000000000001,'bad']){
    legacy.planRecords[0].expiresAt=invalid;
    assert.doesNotMatch(cloudPlanCard(legacy).html,/class="execution-plan-expiry"|Invalid Date/);
  }
});

test('expiry offsets match the displayed local date, fractional zones and daylight saving at the deadline',()=>{
  const contract=new URL('../src/main/cloud-plan-contract.mjs',import.meta.url).href;
  const fixture=new URL('./support/cloud-plan-card-fixture.mjs',import.meta.url).href;
  for(const [zone,iso,expected] of [
    ['Asia/Shanghai','2026-10-18T16:34:15.116Z','10-19 00:34 (UTC+8)'],
    ['UTC','2026-10-18T16:34:15.116Z','10-18 16:34 (UTC+0)'],
    ['Asia/Kolkata','2026-10-18T16:34:15.116Z','10-18 22:04 (UTC+5:30)'],
    ['Asia/Kathmandu','2026-10-18T16:34:15.116Z','10-18 22:19 (UTC+5:45)'],
    ['America/St_Johns','2026-01-18T16:34:15.116Z','01-18 13:04 (UTC-3:30)'],
    ['America/New_York','2026-07-18T16:34:15.116Z','07-18 12:34 (UTC-4)'],
    ['America/New_York','2026-01-18T16:34:15.116Z','01-18 11:34 (UTC-5)'],
  ]){
    const source=`import {cloudPlanCard} from ${JSON.stringify(contract)};import {cloudPlanCardFixture} from ${JSON.stringify(fixture)};const report=cloudPlanCardFixture();report.executionPlan.entryCondition.expiresAt=Date.parse(${JSON.stringify(iso)});process.stdout.write(cloudPlanCard(report).html);`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',source],{env:{...process.env,TZ:zone},encoding:'utf8',windowsHide:true});
    assert.equal(run.status,0,run.stderr);
    assert.ok(run.stdout.includes(`>${expected}</time>`),`${zone}: ${expected}`);
    assert.ok(run.stdout.includes(`datetime="${iso}"`));
  }
});

test('structured ratios follow mobile engine-first values and never recalculate missing ratios',()=>{
  const report=cloudPlanCardFixture(),plan=report.executionPlan,scenario=plan.scenarios[0];
  assert.equal((cloudPlanCard(report).html.match(/盈亏比 —/g)||[]).length,2);
  scenario.riskReward=[1.234,2.456];
  plan.preferredSide='long';plan.riskReward=[{targetIndex:0,ratio:1.789}];
  let html=cloudPlanCard(report).html;
  assert.match(html,/盈亏比 1:1\.79/);assert.match(html,/盈亏比 1:2\.46/);
  plan.preferredSide='short';
  html=cloudPlanCard(report).html;
  assert.match(html,/盈亏比 1:1\.23/);assert.doesNotMatch(html,/1:1\.79/);
});

test('structured account amounts require exact scenario binding; missing exits cannot imply cumulative profit',()=>{
  const report=cloudPlanCardFixture(),plan=report.executionPlan,scenario=plan.scenarios[0];
  Object.assign(scenario,{entry:82292.3,eligible:true,positionSizing:{side:'long',entry:82292.3,stop:scenario.stop,targets:[...scenario.targets],accountStatus:'available',
    accountPlan:{mode:'new_position',notional:100,estimatedStopLoss:5,targetOrders:[
      {targetIndex:0,price:scenario.targets[0],notional:50,estimatedNetProfit:1.11},
      {targetIndex:1,price:scenario.targets[1],notional:50,estimatedNetProfit:2.22}]}}});
  const before=structuredClone(report);
  let html=cloudPlanCard(report).html;
  for(const text of ['建议开仓','100.00','预计止损','-5.00','止盈仓位','+1.11','+3.33'])assert.ok(html.includes(text),text);
  assert.match(html,/execution-plan-card-number-bearish">-5\.00</);
  assert.deepEqual(report,before);
  for(const mutate of [s=>s.side='short',s=>s.entry++,s=>s.targets.reverse(),s=>s.accountStatus='unavailable',s=>s.executionBlocked=true]){
    const copy=structuredClone(report);mutate(copy.executionPlan.scenarios[0].positionSizing);
    assert.doesNotMatch(cloudPlanCard(copy).html,/建议开仓|预计盈利|止盈仓位/);
  }
  const invalid=structuredClone(report);
  Object.assign(invalid.executionPlan.scenarios[0].positionSizing.accountPlan,{notional:0,estimatedStopLoss:-5});
  assert.doesNotMatch(cloudPlanCard(invalid).html,/建议开仓|预计止损/);
  scenario.positionSizing.accountPlan.targetOrders.shift();
  html=cloudPlanCard(report).html;
  assert.match(html,/止盈仓位/);assert.doesNotMatch(html,/预计盈利|NaN/);
  plan.executionBlocked=true;
  assert.doesNotMatch(cloudPlanCard(report).html,/建议开仓|止盈仓位/);
});
