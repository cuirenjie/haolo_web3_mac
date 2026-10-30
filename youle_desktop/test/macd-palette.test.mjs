import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTradingIndicatorSettings } from '../src/renderer/trading-expert-market.ts';
import { tradingIndicatorColors } from '../src/renderer/trading-expert-indicators.ts';
import { setTradingChartSeriesValues } from '../src/renderer/trading-chart-series-data.ts';
import { translateAppText } from '../src/renderer/app-language.mjs';

test('MACD palette survives storage and invalid/legacy values restore green up', () => {
  for (const [input, expected] of [['red-up', 'red-up'], ['green-up', 'green-up'], [null, 'green-up'], ['invalid', 'green-up']]) {
    const settings = normalizeTradingIndicatorSettings({'sub:macd': {parameters: [12,26,9], series: {histogram: {histogramPalette: input, histogramStyle: 'hollow'}}}});
    const restored = normalizeTradingIndicatorSettings(JSON.parse(JSON.stringify(settings)));
    assert.equal(restored['sub:macd'].series.histogram.histogramPalette, expected);
    assert.equal(restored['sub:macd'].series.histogram.histogramStyle, 'hollow');
    assert.equal(restored['sub:macd'].series.dif.histogramPalette, undefined);
    assert.equal(restored['sub:volume'].series.volume.histogramPalette, undefined);
  }
});

test('palette swaps actual historical and live series colors without changing values or other indicators', () => {
  const values = [1, -.5, 0], candles = values.map((_, i) => ({time: i + 100}));
  const descriptor = {key: 'histogram', values, colors: ['old', 'old', 'old']};
  let data = [];
  const series = {setData: next => data = next, update: point => { if(data.at(-1)?.time === point.time) data[data.length-1] = point; else data.push(point); }};
  for (const [palette, colors] of [['green-up',['#2EBD85','#F6465D','#2EBD85']], ['red-up',['#F6465D','#2EBD85','#F6465D']]]) {
    setTradingChartSeriesValues(series, candles, values, 0, tradingIndicatorColors('macd', descriptor, palette));
    assert.deepEqual(data.map(p => p.color), colors);
    assert.deepEqual(data.map(p => p.value), values);
  }
  const live = {...descriptor, values:[1,-.5,-2]};
  setTradingChartSeriesValues(series, candles, live.values, 0, tradingIndicatorColors('macd', live, 'red-up'));
  assert.equal(data.at(-1).color, '#2EBD85');
  assert.equal(data.at(-1).value, -2);
  assert.equal(tradingIndicatorColors('volume', descriptor, 'red-up'), descriptor.colors);
  assert.equal(tradingIndicatorColors('macd', {...descriptor,key:'dif'}, 'red-up'), descriptor.colors);
});

test('MACD label and both options translate in all six locales', () => {
  for (const language of ['zh-CN', 'en', 'zh-TW', 'ko', 'ja', 'vi']) {
    for (const text of ['MACD柱颜色', '绿涨红跌', '红涨绿跌']) {
      const translated = translateAppText(text, language);
      assert.ok(translated);
      if (language !== 'zh-CN') assert.notEqual(translated, text, `${language}: ${text}`);
    }
  }
});
