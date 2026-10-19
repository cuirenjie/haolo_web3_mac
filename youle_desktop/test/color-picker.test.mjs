import test from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_PALETTE, splitColor, withOpacity, normalizeColor, hsvToHex, hexToHsv, customColors } from '../src/renderer/color-picker.ts';
import { normalizeTradingChartSettings } from '../src/renderer/trading-expert-chart-settings.ts';
import { normalizeHorizontalLineTextStyle } from '../src/renderer/trading-horizontal-line-settings.ts';

test('color conversions retain RGB and opacity, including transparent black', () => {
  assert.equal(COLOR_PALETTE.length, 80);
  for (const hex of COLOR_PALETTE) { const {h,s,v}=hexToHsv(hex); assert.equal(hsvToHex(h,s,v),hex); }
  for (let opacity=0;opacity<=100;opacity++) assert.equal(splitColor(withOpacity('#2962ff',opacity)).opacity,opacity);
  assert.equal(withOpacity('#2962ff',50),'#2962ff80');
  assert.equal(withOpacity('#000000',0),'#00000000');
  for (const value of ['red','#ff00000','#fff','url(javascript:foo)','#ffffff;']) assert.equal(normalizeColor(value),undefined);
  assert.deepEqual(customColors(['#FF0000','#ff0000','bad','#2962ff80']),['#ff0000','#2962ff']);
});
test('chart and drawing settings retain alpha through normalization', () => {
  const settings=normalizeTradingChartSettings({risingColor:'#2962ff80',themes:{light:{backgroundColor:'#ffffff00'}}});
  assert.equal(settings.risingColor,'#2962FF80');
  assert.equal(settings.themes.light.backgroundColor,'#FFFFFF00');
  assert.equal(normalizeHorizontalLineTextStyle({textColor:'#2962ff80'}).textColor,'#2962ff80');
});
