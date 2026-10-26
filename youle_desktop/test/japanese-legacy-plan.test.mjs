import test from 'node:test';
import assert from 'node:assert/strict';
import * as legacy from '../src/main/legacy-execution-plan-presentation.mjs';
import * as renderer from '../src/renderer/execution-plans.ts';
import {parseExecutionPlanAlertInput} from '../src/main/trading-alerts/execution-plan-alert.mjs';
import {normalizeCloudReports,legacyReportCandidates,cloudPlanCard} from '../src/main/cloud-plan-contract.mjs';
import {legacyCloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {buildExecutionPlanV1,formatExecutionPlanMarkdown} from '../src/main/trading-strategy-runtime/execution-plan-builder.mjs';
import {japaneseText} from '../src/shared/japanese.mjs';

for(const side of ['long','short'])test(`Japanese ${side} legacy receipt preserves report, first target and exact prices`,()=>{
 const long=side==='long',stop=long?120.01:130.56,target=long?130.56:120.01;
 const report=`## BTC/USDT Binance 無期限先物 1H · ${long?'ロング':'ショート'}条件付きプラン\n現在のアクション：条件成立まで待機\n方向性の判断：${long?'ロング':'ショート'}\nストラテジー：プライスアクション\n${long?'ロング':'ショート'}トリガー：123.45\n損切りと無効化：${stop}\n段階的な利確：第1目標 ${target}、第2目標 ${long?140.67:110.67}\nリスクリワード比：1:2`;
 for(const parser of [legacy,renderer]){
  const [card]=parser.executionPlanCandidatesFromText(report);
  assert.equal(card.content,report.split('\n').slice(1).join('\n'));
  assert.equal(parser.executionPlanHasConcreteTradingPlan(card),true);
  assert.equal(parser.executionPlanHasStructuredTradingFields(card),true);
  assert.deepEqual(parser.executionPlanBinanceMarketDetails(card),{symbol:'BTCUSDT',direction:side.toUpperCase()});
  const spec=parseExecutionPlanAlertInput({...card,planId:'ja-legacy',status:'pending'});
  assert.deepEqual([spec.direction,spec.entry,spec.stopLoss,spec.takeProfit],[side,123.45,stop,target]);
  assert.equal(spec.title,card.title);
  const observation={...card,content:card.content.replace(`方向性の判断：${long?'ロング':'ショート'}`,'方向性の判断：中立')};
  assert.equal(parser.executionPlanHasConcreteTradingPlan(observation),false);
 }
 const receipt=legacyCloudPlanCardFixture('price-action','ja',side);
 receipt.report=report;receipt.planRecords[0].card=legacyReportCandidates(report)[0];
 const restored=normalizeCloudReports([receipt])[0];
 assert.equal(restored.report,report);assert.equal(restored.planRecords[0].card.content,receipt.planRecords[0].card.content);
 const card=cloudPlanCard(restored);assert.match(card.html,/[ロングショート]/u);
 assert.doesNotMatch(card.html,/方向判断|币安永续|多头|空头|分批止盈|止损/);
 assert.throws(()=>parseExecutionPlanAlertInput({...receipt.planRecords[0].card,planId:'ja-invalid',status:'pending',content:report.replace(`損切りと無効化：${stop}`,'損切りと無効化：123.45')}),/必须满足/);
});

test('Japanese native formatter translates system values without changing plan calculations',()=>{
 const result={snapshot:{marketId:'BINANCE:FUTURES:ETHUSDT',interval:'60',snapshotTime:1000},
  analysisPlan:{actionPlan:{primaryBias:'bearish',currentPrice:2460.54,shortTrigger:2470.047,shortInvalidation:2481.86,shortTarget:2338.6,shortTargets:[2452.12,2443.38,2338.6]}},theoryResult:{}};
 const plan=buildExecutionPlanV1({id:'price-action',name:'裸K分析',version:'1.0.0'},result,{tickSize:.01,executionTime:1000,currentPrice:2460.54});
 const frozen=structuredClone(plan),english=formatExecutionPlanMarkdown(plan,{language:'en'}),japanese=formatExecutionPlanMarkdown(plan,{language:'ja'});
 assert.deepEqual(plan,frozen);
 assert.doesNotMatch(japanese,/等待|形成合格方案|方向判断|裸K分析|风险收益比|目标|止损|做多|做空|入场|当前|账户|条件方案/);
 const a=legacyReportCandidates(english),b=legacyReportCandidates(japanese);
 assert.equal(b.length,a.length);assert.ok(b.length);
 for(let i=0;i<a.length;i++){
  const parse=card=>parseExecutionPlanAlertInput({...card,planId:'native-ja',status:'pending'});
  const x=parse(a[i]),y=parse(b[i]);
  for(const key of ['marketId','interval','direction','entry','stopLoss','takeProfit'])assert.equal(y[key],x[key],key);
 }
 assert.equal(japaneseText('自定义指令：保持原文'),japaneseText('自定义指令：保持原文',false));
});
