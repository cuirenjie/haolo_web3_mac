import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { patchTradingChartLibrary } from '../scripts/trading-chart-library-patch.mjs';

const require=createRequire(import.meta.url);
const source=readFileSync(path.join(path.dirname(require.resolve('lightweight-charts/package.json')),'dist/lightweight-charts.development.mjs'),'utf8');
const patched=patchTradingChartLibrary(source);
const start=patched.indexOf('_haoloMapRenderPoints(createItem) {')+'_haoloMapRenderPoints(createItem) {'.length;
const map=new Function('createItem',patched.slice(start,patched.indexOf('\n    }',start)));

test('library patch fails closed on dependency changes and covers line/histogram and candle/bar renderers',()=>{
  assert.throws(()=>patchTradingChartLibrary(source+'\n'),/source changed/);
  assert.equal(patched.split('this._internal__items = this._haoloMapRenderPoints(').length,3);
  assert.ok(patched.includes('class SeriesHistogramPaneView extends LinePaneViewBase'));
  assert.ok(patched.includes('class SeriesCandlesticksPaneView extends BarsPaneViewBase'));
});

test('native render points retain closed bars while updating tails, backfill, corrections, colors and replacement domains',()=>{
  let rows=Array.from({length:5000},(_,i)=>({_internal_index:i,_internal_value:[i]}));
  let created=0;
  const context={_internal__series:{_internal_conflatedBars:()=>({_internal_rows:()=>rows})},_internal__items:[]};
  const render=()=>context._internal__items=map.call(context,row=>{created++;return{_internal_time:row._internal_index,value:row._internal_value[0],color:'blue',_internal_x:NaN}});
  render();assert.equal(created,5000);const first=context._internal__items[0];first._internal_x=42;
  for(let i=0;i<100;i++){rows[4999]={_internal_index:4999,_internal_value:[i]};render();assert.equal(context._internal__items[4999].value,i);}
  assert.equal(created,5100);assert.equal(context._internal__items[0],first);assert.equal(first._internal_x,42);
  // Upstream _updateOptions recolors retained items, including cloned items.
  context._internal__items=context._internal__items.map(item=>({...item,color:'red'}));render();assert.equal(context._internal__items[0].color,'red');
  rows[50]={_internal_index:50,_internal_value:[12345]};render();assert.equal(context._internal__items[50].value,12345);
  rows.forEach(row=>row._internal_index++);render();assert.equal(context._internal__items[50]._internal_time,51);
  rows.unshift({_internal_index:0,_internal_value:[-1]});render();assert.equal(context._internal__items[0].value,-1);
  rows.pop();render();assert.equal(context._internal__items.length,5000);
  rows=rows.map(row=>({...row,_internal_value:[row._internal_value[0]*2]}));render();assert.equal(context._internal__items[51].value,24690);
  rows=[];render();assert.deepEqual(context._internal__items,[]);assert.deepEqual(context._haoloRenderRows,[]);
});
