import assert from 'node:assert/strict';
import test from 'node:test';
import {completeTradingModelProse,boundedTradingAnnotation} from '../src/main/trading-analysis/model-output-language.mjs';
import {englishAnalysisText,englishTradingInterval,withTradingReportLanguage,tradingReportText,tradingReportTime} from '../src/main/trading-analysis/report-language.mjs';
import {buildPriceActionStrategyReport} from '../src/main/trading-analysis/price-action-strategy-pipeline.mjs';

test('real-model English summaries retain the complete risk qualification',()=>{
  const summary='Confirmed strokes frame a broad range; the rebound above the central zone is tentative';
  assert.ok(summary.length>80);
  assert.equal(completeTradingModelProse(summary,'summary'),summary);
  assert.throws(()=>completeTradingModelProse('a'.repeat(2001),'summary'),/shorter complete explanation/);
  const note=boundedTradingAnnotation('Summary: '+summary+'; await a confirmed top before increasing directional conviction.');
  assert.ok(note.length<=120);
  assert.ok(note.endsWith('…'));
  assert.ok(('Summary: '+summary+'; await a confirmed top before increasing directional conviction.').startsWith(note.slice(0,-1)));
  assert.equal(boundedTradingAnnotation('Support 102.45'),'Support 102.45');
});

test('SMT does not concatenate translated adjacent placeholders',()=>{
  assert.equal(englishAnalysisText('对照市场创出更高高点，另一市场未同步确认'),'the comparison market makes a higher high, while the primary market does not confirm it');
  assert.equal(englishAnalysisText('ETH 未同步确认 · 等待 MSS'),'SMT divergence with ETH · await MSS');
  assert.match(englishAnalysisText('末笔向下，最新收盘位于最近中枢上方，最近 48 根 K 线动量为正'),/stroke is downward/);
});

test('English intervals, UTC timestamps and punctuation preserve quoted user input',()=>{
  for (const [code, expected] of Object.entries({'5m':'5-minute','5M':'5-month','1h':'1-hour','60':'60-minute','1D':'1-day','1W':'1-week'})) assert.equal(englishTradingInterval(code),expected);
  withTradingReportLanguage('en',()=>{
    assert.match(tradingReportText('本次使用 {0} 根 {1} OHLCV K 线，覆盖 {2} 至 {3}；确定性引擎识别 {4} 个交易区间、{5} 个吸筹/派发候选和 {6} 个候选事件。主区间价格包含率 {7}。',100,'60','start','end',1,2,3,'90%'),/60-minute timeframe/);
    assert.equal(englishAnalysisText('1 confirmed touches'), '1 confirmed touch');
    assert.match(tradingReportText('本次使用 {0} 根 {1} 已收盘 K 线，排除 {2} 根未收盘 K 线。{3}',600,'60',0,''),/60-minute/);
    assert.match(tradingReportText('最近摆动：{0}。','HH 160；HL 145'),/HH 160; HL 145/);
    assert.equal(tradingReportTime(1720000000000),'2024-07-03 09:46:40 UTC');
    assert.equal(tradingReportText('分析要求：{0}','请分析；保留原文。'),'Analysis request: 请分析；保留原文。');
    assert.match(tradingReportText('{0}. **{1}–{2}**（{3}，中心 {4}）',1,150,151,'VAH',151),/reference level 151/);
  });
  for(const language of ['zh-CN','zh-TW'])withTradingReportLanguage(language,()=>{
    assert.equal(tradingReportText('分析要求：{0}','原文。'),'分析要求：原文。');
    assert.equal(tradingReportTime(1720000000000),new Date(1720000000000).toLocaleString('zh-CN',{hour12:false}));
  });
});

test('repeated candlestick occurrences retain distinct times and distinguish chart selection',()=>{
  const snapshot={candles:[{time:1720000000,close:100},{time:1720003600,close:100}],interval:'60'};
  const pattern={name:'高浪线',direction:'neutral',candleCount:1,explanation:'small body',formationStatus:'confirmed',confirmation:'not-required',actionable:false};
  const result={setups:{primaryActiveCandidate:null,historicalCandidates:[]},candlePressure:{latest:{close:100,bodyRatio:.1,closeLocation:.5,facts:[]}},zones:[],pivots:{swings:[]},marketStructure:{regime:'unknown'},candlestickPatterns:{recentPatterns:[{...pattern,endTime:1720000000},{...pattern,endTime:1720003600}]}};
  const report=withTradingReportLanguage('en',()=>buildPriceActionStrategyReport(snapshot,result));
  assert.match(report,/2024-07-03 09:46:40 UTC/);
  assert.match(report,/2024-07-03 10:46:40 UTC/);
  assert.match(report,/report lists up to six recent occurrences; the chart highlights a subset of up to four/);
  assert.match(report,/timestamps and OHLC prices/);
});
