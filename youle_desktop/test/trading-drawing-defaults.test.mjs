import assert from 'node:assert/strict';
import test from 'node:test';
import { manualDrawingDefaults, manualFibLevelColor } from '../src/renderer/trading-drawing-defaults.ts';
import { TRADING_DRAWING_TOOLS } from '../src/renderer/trading-expert-drawing.ts';

test('line defaults match TradingView Trendline and the supplied 2px blue reference', () => {
  for(const id of ['trend-line','ray','extended-line','info-line','trend-angle','horizontal-line','horizontal-ray','vertical-line','cross-line','arrow','multi-point-path']) {
    assert.deepEqual(manualDrawingDefaults(id), {color:'#2962ff',lineWidth:2,lineStyle:'solid',opacity:1,fillOpacity:0},id);
  }
});

test('brushes and shapes retain the documented tool-specific colors, widths and fills', () => {
  for(const [id,color,width,fill,opacity] of [
    ['brush','#00bcd4',2,0,1], ['highlighter','#f23645',20,0,.2],
    ['rectangle','#9c27b0',2,.2,1], ['rotated-rectangle','#4caf50',2,.2,1],
    ['circle','#ff9800',2,.2,1], ['ellipse','#f23645',2,.2,1],
    ['triangle','#089981',2,.2,1], ['arc','#e91e63',2,.2,1],
    ['double-curve','#673ab7',2,0,1], ['multi-point-polyline','#00bcd4',2,.2,1],
    ['anchored-vwap','#1e88e5',1,0,1], ['long-position','#808080',1,.2,1],
  ]) {
    assert.deepEqual(manualDrawingDefaults(id),{color,lineWidth:width,lineStyle:'solid',fillOpacity:fill,opacity},id);
  }
  assert.deepEqual([0,.236,.382,.5,.618,.786,1].map(manualFibLevelColor),['#808080','#f23645','#ff9800','#4caf50','#089981','#00bcd4','#808080']);
});

test('every tool has finite defaults and changing a returned profile cannot alter later drawings', () => {
  for(const t of TRADING_DRAWING_TOOLS) {
    const style=manualDrawingDefaults(t.id);
    assert.match(style.color,/^#[\da-f]{6}$/);
    assert.ok(style.lineWidth>0 && style.lineWidth<=40);
    assert.ok(style.opacity>=0 && style.opacity<=1);
    assert.ok(style.fillOpacity>=0 && style.fillOpacity<=1);
  }
  manualDrawingDefaults('trend-line').color='#000000';
  assert.equal(manualDrawingDefaults('trend-line').color,'#2962ff');
});
