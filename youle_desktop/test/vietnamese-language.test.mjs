import test from 'node:test';
import assert from 'node:assert/strict';
import {vietnameseText,isVietnameseProse} from '../src/shared/vietnamese.mjs';
import {VIETNAMESE_CATALOG} from '../src/shared/vietnamese-catalog.mjs';
import {APP_LANGUAGES,normalizeAppLanguage,translateAppText,appLanguageOptions} from '../src/renderer/app-language.mjs';
import {panelCopy} from '../extensions/haolo-chrome/panel-copy.js';
import {vietnamesePanelCopy} from '../extensions/haolo-chrome/panel-copy-vi.js';
import {taskMessage,setPanelLanguage,panelLanguage} from '../extensions/haolo-chrome/task-messages.js';
import {normalizeAssistantOutputLanguage,withAssistantOutputLanguageMessage} from '../src/main/assistant-output-language.mjs';
import {buildPriceAlertRule,parsePriceAlertInput} from '../src/main/trading-alerts/price-alert.mjs';
import {projectExecutionPlanDrawings,isExecutionPlanLevel} from '../src/shared/execution-plan-drawings.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {translateTradingPeriodLabel} from '../src/renderer/app-language.mjs';

test('Vietnamese settings and model language accept regional aliases',()=>{
 assert.ok(APP_LANGUAGES.includes('vi'));
 assert.ok(appLanguageOptions().some(r=>r.value==='vi'&&r.label==='Tiếng Việt'));
 for(const value of ['vi','vi-VN','vi_VN']){
  assert.equal(normalizeAppLanguage(value),'vi');assert.equal(normalizeAssistantOutputLanguage(value),'vi');
 }
 assert.match(withAssistantOutputLanguageMessage([{role:'user',content:'Analyze BTC'}],'vi')[0].content,/professional Vietnamese/);
 assert.equal(translateAppText('止损','vi'),'Cắt lỗ');
 assert.equal(translateAppText('止盈','vi'),'Chốt lời');
});
test('Vietnamese prose validation rejects foreign answers and retains standard symbols',()=>{
 for(const text of ['Chờ giá vượt 123.45 trước khi vào lệnh. Chưa gửi lệnh nào.','Giá mua đã tăng cao.','BTCUSDT 123.45 USDT'])assert.ok(isVietnameseProse(text),text);
 for(const text of ['这是中文结论','確認をお待ちください。','확인을 기다리세요.','Wait for a confirmed breakout before entering.'])assert.equal(isVietnameseProse(text),false,text);
});
test('Vietnamese preserves numeric evidence and interpolated user input',()=>{
 for(const text of ['123.456','-0.75%','82,000.00','BTCUSDT','https://haolo.com'])assert.equal(vietnameseText(text),text);
 assert.equal(vietnameseText('任务已发送到 Haolo · 用户原文 BTC 123.45'),vietnameseText('任务已发送到 Haolo · {0}').replace('{0}','用户原文 BTC 123.45'));
 const spec=parsePriceAlertInput({confirmed:true,requestId:'vietnamese-price-12345',marketId:'BINANCE:FUTURES:BTCUSDT',interval:'1h',price:123.456,referencePrice:120,locale:'vi'});
 const rule=buildPriceAlertRule(spec,1700000000000);
 assert.equal(rule.root.condition.right.value,123.456);assert.match(rule.normalizedSummary,/Gửi email/);
 const {drawingPatch,executionPlan}=JSON.parse(readFileSync(new URL('./fixtures/plan-prices-sndk.json',import.meta.url)));
 const original=structuredClone(executionPlan);const patch=projectExecutionPlanDrawings(drawingPatch,executionPlan,'vi');
 const lines=patch.operations.filter(op=>isExecutionPlanLevel(op.drawing));
 assert.match(lines[0].drawing.text,/Vào lệnh mua/);assert.match(lines[1].drawing.text,/Cắt lỗ/);
 assert.deepEqual(lines.map(op=>op.drawing.points[0].price),[1391.74,1360.64,1411.46,1421.63,1453.96]);assert.deepEqual(executionPlan,original);
});
test('packaged Vietnamese catalogs contain no untranslated East Asian prose',()=>{
 const placeholders = value => [...value.matchAll(/\$?\{([\w.]+)\}/g)].map(match => match[1]).sort();
 for(const [source,target] of Object.entries(VIETNAMESE_CATALOG)) {
  assert.doesNotMatch(target,/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u,source);
  assert.deepEqual(placeholders(target), placeholders(source), source);
 }
 for(const [source,row] of Object.entries(panelCopy)){
  assert.ok(vietnamesePanelCopy[source],source);
  for(const alias of [source,...row])assert.equal(taskMessage(alias,'vi'),vietnamesePanelCopy[source]);
  const slots=s=>[...s.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();assert.deepEqual(slots(vietnamesePanelCopy[source]),slots(source));
 }
 setPanelLanguage('vi-VN');assert.equal(panelLanguage(),'vi');assert.equal(taskMessage('用户原始输入 BTC 123.45'),'用户原始输入 BTC 123.45');
});


test('Vietnamese dynamic usage and payment accessibility copy keeps inserted data', () => {
 assert.equal(vietnameseText('查看28/10/2026的使用明细'), 'Xem chi tiết sử dụng ngày 28/10/2026');
 assert.equal(vietnameseText('/月'), '/tháng');
 assert.equal(vietnameseText('复制Binance收款账号'), 'Sao chép tài khoản nhận tiền qua Binance');
 assert.equal(vietnameseText('TRC20 USDT 收款二维码'), 'Mã QR nhận USDT qua TRC20');
});

test('Vietnamese short durations and financial drawing labels keep precise values', () => {
 assert.equal(vietnameseText('2天'), '2 ngày');
 assert.equal(vietnameseText('2.5秒'), '2.5 giây');
 assert.equal(vietnameseText('最低净盈亏比：1:2.75'), 'Tỷ lệ lợi nhuận/rủi ro ròng tối thiểu: 1:2.75');
});


test('Vietnamese custom chart periods retain arbitrary counts and all supported units', () => {
 for (const [source, expected] of [['25分钟','25 phút'], ['3小时','3 giờ'], ['2天','2 ngày'], ['7周','7 tuần'], ['12月','12 tháng'], ['3年','3 năm']])
  assert.equal(translateTradingPeriodLabel(source, 'vi-VN'), expected);
});
test('cold Vietnamese phrase fallback completes without blocking the renderer for seconds', () => {
 const moduleUrl = new URL('../src/shared/vietnamese.mjs', import.meta.url).href;
 const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
  import {vietnameseText} from ${JSON.stringify(moduleUrl)};
  console.log(vietnameseText('25分钟'));
  console.log(vietnameseText('UNKNOWN_' + 'x'.repeat(10000)).length);
 `], {encoding:'utf8', timeout:8000});
 assert.equal(result.trim(), '25 phút\n10008');
});
