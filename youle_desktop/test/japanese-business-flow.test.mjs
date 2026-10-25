import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {buildPriceAlertRule,parsePriceAlertInput} from '../src/main/trading-alerts/price-alert.mjs';
import {projectExecutionPlanDrawings,isExecutionPlanLevel} from '../src/shared/execution-plan-drawings.mjs';

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
