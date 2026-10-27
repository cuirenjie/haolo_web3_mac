import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {buildPriceAlertRule,parsePriceAlertInput} from '../src/main/trading-alerts/price-alert.mjs';
import {projectExecutionPlanDrawings,isExecutionPlanLevel} from '../src/shared/execution-plan-drawings.mjs';
import {cloudReportFromResponse, normalizeCloudReports, cloudPlanCard, cloudPlanControls} from '../src/main/cloud-plan-contract.mjs';
import {executionPlanStickyHtml} from '../src/main/execution-plan-sticky-view.mjs';
import {mergeCloudExecutionPlans} from '../src/renderer/cloud-plan-sync.ts';
import {cloudPlanCardFixture} from './support/cloud-plan-card-fixture.mjs';
import {executionPlanCardHeading} from '../src/main/execution-plan-card-view.mjs';

test('Japanese survives the actual account settings serializer and cloud receipt',()=>{
 const source=readFileSync(new URL('../src/renderer/main.ts',import.meta.url),'utf8');
 const segment=source.slice(source.indexOf('function sharedAppSettings()'),source.indexOf('function activateAccountSettingsSync()'));
 const code=stripTypeScriptTypes(segment,{mode:'strip'});
 const check=new Function(`
  const state={settings:{language:'ja',theme:'light',fontSize:'default',taskCompletionPopupEnabled:true}};
  const sharedFontScales={default:1},document={body:{}},localStorage={setItem(){}},APP_THEME_STORAGE_KEY='theme';
  let sharedThemePreference='light',customThemeSelection=null;
  const decodeCustomTheme=()=>null,render=()=>{},applied=[];
  const applyAppLanguage=language=>applied.push(language),api={setAppLanguage:async({language})=>applied.push(language)};
  ${code}
  const receipt=sharedAppSettings();state.settings.language='en';applySharedAppSettings(receipt);
  return {receipt,language:state.settings.language,applied};
 `)();
 assert.equal(check.receipt['app.language'],'ja');assert.equal(check.language,'ja');assert.deepEqual(check.applied,['ja','ja']);
});

test('Japanese price alert preserves exact rule thresholds and complete localized copy',()=>{
 const spec=parsePriceAlertInput({confirmed:true,requestId:'japanese-price-12345',marketId:'BINANCE:FUTURES:BTCUSDT',interval:'1h',price:123.456,referencePrice:120,locale:'ja'});
 const rule=buildPriceAlertRule(spec,1700000000000);
 assert.equal(rule.root.condition.right.value,123.456);
 assert.match(rule.normalizedSummary,/メールを一度送信/);assert.match(rule.title,/無期限先物/);
});

test('Japanese plan annotations keep exact prices and long/short direction',()=>{
 const {drawingPatch,executionPlan}=JSON.parse(readFileSync(new URL('./fixtures/plan-prices-sndk.json',import.meta.url)));
 const original=structuredClone(executionPlan),patch=projectExecutionPlanDrawings(drawingPatch,executionPlan,'ja');
 const lines=patch.operations.filter(op=>isExecutionPlanLevel(op.drawing));
 assert.match(lines[0].drawing.text,/ロングエントリー/);assert.match(lines[1].drawing.text,/損切り/);
 assert.deepEqual(lines.map(op=>op.drawing.points[0].price),[1391.74,1360.64,1411.46,1421.63,1453.96]);
 assert.deepEqual(executionPlan,original);
});

test('Japanese cloud receipt survives durable restoration, saved plans and native sticky notes',()=>{
 const original=cloudPlanCardFixture('ja');
 original.report='確定した条件に基づく取引計画です。';
 const response={cloud:{...original,executionPolicy:'entry-v2'},snapshot:{marketId:original.marketId,interval:original.interval},
  strategy:{id:original.strategyId},analysisPlan:{report:original.report},executionPlan:original.executionPlan};
 const receipt=cloudReportFromResponse(response)[0];
 const restored=normalizeCloudReports(JSON.parse(JSON.stringify([receipt])))[0];
 assert.equal(restored.locale,'ja');
 assert.equal(restored.report,original.report);
 assert.deepEqual(restored.executionPlan,original.executionPlan);
 assert.deepEqual(restored.planRecords,original.planRecords);
 const saved=mergeCloudExecutionPlans([restored],[])[0];
 assert.equal(saved.cloudReport.locale,'ja');
 const card=cloudPlanCard(restored);
 const sticky=executionPlanStickyHtml({cloudReport:restored,language:'ja',title:card.title});
 assert.match(card.content,/損切り/);
 assert.doesNotMatch(card.content,/入场|仓位|止损|条件失效|[\uac00-\ud7af]/u);
 for(const value of ['82292.3','81682.2','83207.45','83512.5'])assert.ok(card.content.includes(value),value);
 assert.ok(sticky.includes(cloudPlanCard(restored,{separateAction:true}).html));
 assert.match(card.html,/プライスアクション/);
 assert.doesNotMatch(sticky,/裸K分析/);
 assert.deepEqual(cloudPlanControls('ja'),{label:'カードの文字サイズと付箋の操作',increase:'拡大',decrease:'縮小',sticky:'付箋'});
 assert.throws(()=>normalizeCloudReports([{...restored,locale:'fr'}]),/CLOUD_REPORT_INVALID/);
 const invalid=structuredClone(restored);invalid.planRecords[0].confirmationHash='invalid';
 assert.throws(()=>normalizeCloudReports([invalid]),/CLOUD_REPORT_INVALID/);
});

test('Japanese native plan headings translate every built-in strategy while preserving user names',()=>{
 const strategies={
  'price-action':'プライスアクション', 'order-flow':'オーダーフロー', 'chan':'纏論',
  'wyckoff':'ワイコフ', 'wave':'エリオット波動', 'chart-patterns':'チャートパターン',
  'harmonic':'ハーモニック', 'dow-theory':'ダウ理論', 'gann-theory':'ギャン理論',
  'smt-divergence':'SMT', 'ict-smc':'ICT / SMC', 'moving-average-analysis':'移動平均',
  'bollinger-bands-analysis':'ボリンジャーバンド', 'macd-analysis':'MACD',
  'rsi-analysis':'RSI', 'kdj-analysis':'KDJ', 'vpvr-analysis':'VPVR', 'trend-band':'トレンドバンド',
 };
 for(const [strategy,expected] of Object.entries(strategies)){
  const heading=executionPlanCardHeading('BTC · 1h',[{label:'Strategy',text:strategy}],'ja');
  assert.ok(heading.includes(expected),`${strategy}: ${heading}`);
  assert.doesNotMatch(heading,/裸K分析|订单流|缠论|威科夫|波浪理论|图表形态|谐波|江恩|背离|均线|布林带/);
 }
 assert.match(executionPlanCardHeading('BTC',[{label:'Strategy',text:'My custom strategy'}],'ja'),/My custom strategy/);
});
