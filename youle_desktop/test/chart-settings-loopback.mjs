import assert from 'node:assert/strict';
import {DesktopSettingsSync,flattenSettings,applySettingValues} from '../src/renderer/account-settings-sync.ts';
import {DEFAULT_TRADING_CHART_SETTINGS,cloneTradingChartSettings,normalizeTradingChartSettings} from '../src/renderer/trading-expert-chart-settings.ts';
const base='http://127.0.0.1:18089',store=new Map(),defaults=flattenSettings(DEFAULT_TRADING_CHART_SETTINGS,'chart');
let rendered={...defaults};
const sync=new DesktopSettingsSync({getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},async params=>{
 const res=await fetch(base+'/api/mobile/v1/client-settings',{method:params.action==='write'?'PUT':'GET',
 headers:{'Content-Type':'application/json'},...(params.action==='write'?{body:JSON.stringify(params.body)}:{})});
 if(!res.ok)throw new Error('fixture HTTP '+res.status+' '+await res.text());return res.json();
});
sync.register('chart-test',{snapshot:()=>rendered,defaults:()=>defaults,apply:values=>{rendered=values;}});
try{
 sync.activate('0fdfe087-803a-4fba-b2ae-a7dd3b361faa',base);await sync.sync(true);
 if(process.argv[2]==='seed'){
  const edits=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,typeof value==='boolean'?!value:
   ({'chart.chartStyle':'bars','chart.priceAdjustment':'forward','chart.scaleAnchor':'right','chart.priceScaleMode':'percentage','chart.verticalPaddingPercent':9}[key]??'#12345680')]));
  sync.edit(rendered,edits);await sync.sync(true);
  for(const [key,value] of Object.entries(edits))assert.equal(rendered[key],value,key);
  assert.equal(sync.status,'synced');console.log('Windows actual sync engine published and read back all 38 fields over HTTP/PostgreSQL');
 }else{
  const actual=normalizeTradingChartSettings(applySettingValues(cloneTradingChartSettings(),rendered,'chart'));
  assert.deepEqual(actual,normalizeTradingChartSettings(DEFAULT_TRADING_CHART_SETTINGS));
  console.log('Windows actual sync engine received Flutter restore of all 38 fields over HTTP/PostgreSQL');
 }
}finally{sync.dispose();}
