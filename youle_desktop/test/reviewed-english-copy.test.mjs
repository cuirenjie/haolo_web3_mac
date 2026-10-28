import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {translateAppText} from '../src/renderer/app-language.mjs';
import {japaneseText} from '../src/shared/japanese.mjs';
import {koreanText} from '../src/shared/korean.mjs';
import {vietnameseText} from '../src/shared/vietnamese.mjs';

test('referral rewards are not translated as trading-fee refunds', () => {
  const source='Refer members and earn USDT commission';
  assert.match(koreanText(source),/추천 보상/);
  assert.match(japaneseText(source),/紹介報酬/);
  assert.match(vietnameseText(source),/hoa hồng/);
});

test('curated English is effective for both Chinese source forms and reproducible', async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/prepare-reviewed-english-r3.mjs', import.meta.url)), '--check'], {windowsHide:true});
  const copy=JSON.parse(await readFile(new URL('../../tools/windows-english-reviewed-r3.json', import.meta.url),'utf8'));
  for(const [source, expected] of Object.entries(copy)) {
    assert.equal(translateAppText(source,'en'),expected,source);
    assert.equal(translateAppText(translateAppText(source,'zh-TW'),'en'),expected,source);
    assert.doesNotMatch(expected,/temporary folder|Other Organiser|Evolution's mail|smart body|Vikov|Dead fork|Golden fork/i,source);
  }
});

test('financial directions, destructive actions and validation limits retain their meaning', () => {
  for(const [source,expected] of Object.entries({
    '否':'No','只做多':'Long only','只做空':'Short only','强平':'Liquidation',
    '未找到选中的连接，已取消删除':'The selected connection could not be found. Deletion was cancelled.',
    '提示词不能超过 20000 个字符':'Prompt cannot exceed 20000 characters',
    '计划已执行，预警已切换为止损与止盈监控':'The plan has been executed; its alert now monitors stop-loss and take-profit conditions',
  })) assert.equal(translateAppText(source,'en'),expected);
  assert.equal(translateAppText('- 单笔最大风险：当前账户净值的 1.50%；','en'),'- Maximum risk per trade: 1.50% of current account equity;');
  assert.equal(translateAppText('浮盈达到 2.75R 后移动至覆盖交易成本的保本位置','en'),'Move the stop to breakeven, including trading costs, after an unrealized profit of 2.75R');
  assert.equal(translateAppText('BTCUSDT 10,000.00 -2.75% 1:0.4','en'),'BTCUSDT 10,000.00 -2.75% 1:0.4');
});

test('Japanese analysis examples are Japanese while model protocol remains intact', () => {
  const source='示例：用户上传图片并问“这个三买成立吗”，应输出 conversation、screenshot-question，所有行情参数为 null。';
  const result=japaneseText(source);
  assert.doesNotMatch(result,/这个|三买|成立吗/);
  assert.match(result,/第3種買い/);
  for(const key of ['conversation','screenshot-question','null']) assert.ok(result.includes(key));
  const shortPrompt=japaneseText('示例：用户说“@策略:缠论 帮我分析下”，应输出 chart-analysis 且 symbol、interval、lookbackMs、lookbackLabel 全部为 null。');
  assert.doesNotMatch(shortPrompt,/策略|缠论|帮我|分析下/);
  for(const key of ['chart-analysis','symbol','interval','lookbackMs','lookbackLabel','null']) assert.ok(shortPrompt.includes(key));
});
