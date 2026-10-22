import assert from 'node:assert/strict';
import test from 'node:test';
import {createCloudPriceAlerts, cloudPriceAlertCard} from '../src/main/trading-alerts/cloud-price-alerts.mjs';
import {parsePriceAlertInput} from '../src/main/trading-alerts/price-alert.mjs';
import {cloudPriceAlertFixture} from './helpers/cloud-price-alert-fixture.mjs';
import {applyTradingAlertsSnapshot,createTradingAlertsUiState,renderTradingAlertsPage} from '../src/renderer/trading-alerts-ui.ts';
import {formatPriceAlertLabel,priceAlertInterval} from '../src/renderer/trading-price-alert.ts';
const owner = {ownerId:'host::user',accountId:'user',email:'fixture@example.invalid',baseUrl:'host'};
const input = (patch={}) => ({requestId:'price-alert-00000001',confirmed:true,marketId:'BINANCE:FUTURES:BTCUSDT',interval:'1h',price:120,referencePrice:100,...patch});
const setup = () => {const api=cloudPriceAlertFixture(); const create=()=>createCloudPriceAlerts({owner:async()=>owner,api:()=>api});return {api,create,service:create()};};
test('confirmation, market, timeframe and displayed precision are validated',()=>{
  for (const patch of [{confirmed:false},{price:0},{price:Infinity},{price:'120'},{referencePrice:NaN},{marketId:'HYPERLIQUID:PERPETUAL:BTC'},{interval:'garbage'},{requestId:'../../escape'}]) assert.throws(()=>parsePriceAlertInput(input(patch)));
  assert.equal(formatPriceAlertLabel(82234.77,2),'82,234.77');
  assert.equal(formatPriceAlertLabel(.02171,5),'0.02171');
  for(const [from,to] of [['60','1h'],['15','15m'],['1D','1d'],['1M','1M']])assert.equal(priceAlertInterval(from),to);
});
for(const [price,operator] of [[120,'gte'],[80,'lte'],[100,'gte']]) test(`cloud saves exact level ${price} with ${operator} and persists visible card`,async()=>{
  const {api,service,create}=setup();
  const [a,b]=await Promise.all([service.create(input({price})),service.create(input({price}))]);
  assert.equal(a.alert.alertId,b.alert.alertId);assert.equal(api.items.length,1);
  assert.equal(api.items[0].rule.operator,operator);assert.equal(api.items[0].rule.threshold,price);
  assert.equal(api.items[0].rule.confirmation,'intrabar');assert.equal(api.items[0].state,'arming');
  const state=createTradingAlertsUiState();applyTradingAlertsSnapshot(state,{...(await create().snapshot()),cloudLoaded:true});
  const html=renderTradingAlertsPage(state);assert.ok(html.includes(a.alert.alertId));assert.ok(html.includes('云端监控'));assert.ok(!html.includes('data-trading-alert-action="edit"'));
  applyTradingAlertsSnapshot(state,{alerts:[]});assert.equal(state.alerts.length,1,'local notifications cannot erase cloud cards');
  applyTradingAlertsSnapshot(state,{alerts:[],cloudLoaded:true});assert.equal(state.alerts.length,0,'authoritative account snapshot clears old cloud cards');
  assert.ok(api.calls.every(c=>c.options.expectedAccountId===owner.accountId));
});
test('lost cloud readback retries same create/confirm receipts across client restart',async()=>{
  const {api,service,create}=setup();api.hideList=true;
  await assert.rejects(service.create(input()),{code:'PRICE_ALERT_READBACK_FAILED'});assert.equal(api.items.length,1);
  api.hideList=false;await create().create(input());assert.equal(api.items.length,1);
  await assert.rejects(create().create(input({price:130})),{code:'IDEMPOTENCY_CONFLICT'});
});
test('pause/resume/delete operate on cloud version',async()=>{
  const {api,service}=setup();const {alert}=await service.create(input());
  const paused=await service.mutate('pause',{alertId:alert.alertId,version:alert.cloud.version});assert.equal(api.items[0].state,'paused');
  await assert.rejects(service.mutate('resume',{alertId:alert.alertId,version:alert.cloud.version}),{code:'VERSION_CONFLICT'});
  const resumed=await service.mutate('resume',{alertId:alert.alertId,version:paused.alert.cloud.version});assert.equal(api.items[0].state,'arming');
  await service.mutate('delete',{alertId:alert.alertId,version:resumed.alert.cloud.version});assert.deepEqual((await service.snapshot()).alerts,[]);
});
test('no local fallback when cloud unavailable, no email, cancelled or owner changes',async()=>{
  const {api,service}=setup();api.available=false;await assert.rejects(service.create(input()),{code:'PRICE_ALERT_CLOUD_UNAVAILABLE'});assert.equal(api.items.length,0);
  await assert.rejects(service.create(input({confirmed:false})));assert.equal(api.items.length,0);
  await assert.rejects(createCloudPriceAlerts({api:()=>api,owner:async()=>({...owner,email:''})}).create(input()),{code:'PRICE_ALERT_EMAIL_REQUIRED'});
  let n=0;await assert.rejects(createCloudPriceAlerts({api:()=>api,owner:async()=>({...owner,ownerId:++n===1?'one':'two'})}).create(input()),{code:'TRADING_PREFERENCE_OWNER_CHANGED'});
});
test('three locale summaries and monthly chart contexts are preserved',async()=>{
  for(const [locale,expected] of [['zh-CN','价格'],['en','Email once'],['zh-Hant','價格']]){
    const {service,api}=setup();const {alert}=await service.create(input({locale,interval:'1M'}));assert.ok(alert.rule.normalizedSummary.includes(expected));
    assert.equal(alert.rule.contexts[0].intervals[0],'1M');assert.equal(api.items[0].locale,locale);
  }
  assert.equal(cloudPriceAlertCard({id:'bad'}),null);
});

test('cloud card summaries follow the current UI language after switching locales',async()=>{
  const {service}=setup();await service.create(input());
  const state=createTradingAlertsUiState();applyTradingAlertsSnapshot(state,{...await service.snapshot(),cloudLoaded:true});
  const original=globalThis.document;
  try {
    for(const [lang,label] of [['en','Email once'],['zh-Hant','價格 ≥'],['zh-CN','价格 ≥']]) {
      globalThis.document={documentElement:{lang}};
      assert.ok(renderTradingAlertsPage(state).includes(label));
    }
  } finally {if(original)globalThis.document=original;else delete globalThis.document;}
});
