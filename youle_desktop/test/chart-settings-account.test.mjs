import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_TRADING_CHART_SETTINGS as defaults, cloneTradingChartSettings, normalizeTradingChartSettings} from '../src/renderer/trading-expert-chart-settings.ts';
import {SettingsReplica, flattenSettings, applySettingValues} from '../src/renderer/account-settings-sync.ts';
import {TradingDrawingVisibility} from '../src/renderer/trading-drawing-visibility.ts';

test('all 38 chart fields roundtrip through mobile wire keys and desktop normalization',()=>{
  const flat=flattenSettings(defaults,'chart');assert.equal(Object.keys(flat).length,38);
  const desktop=new SettingsReplica(),mobile=new SettingsReplica();
  const changes={...flat,'chart.chartStyle':'bars','chart.verticalLocked':true,
    'chart.drawingVisibility.plansHidden':true,'chart.drawingVisibility.aiHidden':true,
    'chart.themes.dark.backgroundColor':'#12345680','chart.scaleAnchor':'right'};
  mobile.edit(flat,changes);
  const receipt={schemaVersion:1,version:1,serverTime:Date.now(),entries:Object.values(mobile.entries)};
  desktop.merge(receipt);
  const rendered=normalizeTradingChartSettings(applySettingValues(cloneTradingChartSettings(),desktop.values(),'chart'));
  assert.equal(rendered.verticalLocked,true);assert.equal(rendered.chartStyle,'bars');assert.equal(rendered.scaleAnchor,'right');
  assert.equal(rendered.drawingVisibility.plansHidden,true);assert.equal(rendered.drawingVisibility.aiHidden,true);
  assert.equal(rendered.themes.dark.backgroundColor,'#12345680');
  const reset=flattenSettings(cloneTradingChartSettings(),'chart');desktop.edit(flattenSettings(rendered,'chart'),reset);
  mobile.pending={};mobile.merge({schemaVersion:1,version:2,serverTime:Date.now(),entries:Object.values(desktop.entries)});
  const after=normalizeTradingChartSettings(applySettingValues(cloneTradingChartSettings(),mobile.values(),'chart'));
  assert.deepEqual(after,normalizeTradingChartSettings(defaults));
});

test('account projection never republishes edits or changes individual hidden drawing state',t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'window'),storage=new Map(),win=new EventTarget();
  win.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  Object.defineProperty(globalThis,'window',{configurable:true,value:win});
  t.after(()=>{state.destroy();if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;});
  const edits=[],state=new TradingDrawingVisibility('session',edited=>edits.push(edited));
  const drawing={id:'manual-a',symbol:'BTC'};state.toggle(drawing);edits.length=0;
  state.applyAccountLayers({...defaults.drawingVisibility,aiHidden:true,plansHidden:true});
  assert.deepEqual(edits,[false]);assert.equal(state.isHidden(drawing),true);
  state.setLayers({manualHidden:true});assert.equal(edits.at(-1),true);
  state.applyAccountLayers({...defaults.drawingVisibility});assert.equal(edits.at(-1),false);
  assert.equal(state.isHidden(drawing),true);assert.equal(state.aiHidden,false);
});
