import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createCloudPriceAlerts, cloudPriceAlertCard} from '../src/main/trading-alerts/cloud-price-alerts.mjs';
import {parsePriceAlertInput} from '../src/main/trading-alerts/price-alert.mjs';
import {cloudPriceAlertFixture} from './helpers/cloud-price-alert-fixture.mjs';
import {applyTradingAlertsSnapshot,createTradingAlertsUiState,renderTradingAlertsPage} from '../src/renderer/trading-alerts-ui.ts';
import {formatPriceAlertLabel,priceAlertInterval} from '../src/renderer/trading-price-alert.ts';
import {chartPriceAlerts, publishChartPriceAlerts, publishCreatedChartPriceAlert, subscribeChartPriceAlerts, refreshChartPriceAlerts} from '../src/renderer/trading-price-alert-store.ts';
const owner = {ownerId:'host::user',accountId:'user',email:'fixture@example.invalid',baseUrl:'host'};
const input = (patch={}) => ({requestId:'price-alert-00000001',confirmed:true,marketId:'BINANCE:FUTURES:BTCUSDT',interval:'1h',price:120,referencePrice:100,...patch});
const setup = () => {const api=cloudPriceAlertFixture(); const create=()=>createCloudPriceAlerts({owner:async()=>owner,api:()=>api});return {api,create,service:create()};};

test('new server protects the complete create chain with a single alert readback', async()=>{
  const {api,service}=setup(); api.singleReadback=true; api.hideList=true;
  const result=await service.create(input());
  assert.ok(result.alert.alertId);
  assert.deepEqual(api.calls.map(c=>c.operation),['capabilities','createPriceAlertDraft','confirmPriceAlert','priceAlert']);
});
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

test('chart markers include only active cloud price alerts and preserve exact market/level/version',async()=>{
  const {service,api}=setup(); const {alert}=await service.create(input());
  const snapshot={...await service.snapshot(),cloudLoaded:true};
  assert.deepEqual(chartPriceAlerts(snapshot),[{alertId:alert.alertId,marketId:input().marketId,interval:'1h',price:120,version:2,operator:'gte'}]);
  assert.deepEqual(chartPriceAlerts({...snapshot,cloudLoaded:false}),[]);
  for(const status of ['paused','completed','deleted','error']) {
    assert.deepEqual(chartPriceAlerts({...snapshot,alerts:[{...alert,status}]}),[]);
  }
  assert.deepEqual(chartPriceAlerts({...snapshot,alerts:[{...alert,enabled:false}]}),[]);
  api.items[0].rule.marketKey='binance:spot:BTCUSDT';
  assert.equal(chartPriceAlerts({...await service.snapshot(),cloudLoaded:true})[0].marketId,'BINANCE:SPOT:BTCUSDT');
});

test('drag replacement verifies the new alert before deleting the old one and is retry-safe',async()=>{
  const {service,create,api}=setup(); const {alert}=await service.create(input());
  const replacement=input({requestId:'replacement-00000001',price:90,replacesAlertId:alert.alertId,replacesVersion:alert.cloud.version});
  const moved=await service.create(replacement);
  assert.notEqual(moved.alert.alertId,alert.alertId);
  assert.equal(moved.alert.cloud.threshold,90);
  assert.equal(moved.alert.cloud.operator,'lte');
  assert.deepEqual((await service.snapshot()).alerts.map(a=>a.alertId),[moved.alert.alertId]);
  const deletion=api.calls.findIndex(c=>c.operation==='priceAlertAction');
  const confirmation=api.calls.findLastIndex(c=>c.operation==='confirmPriceAlert');
  assert.ok(confirmation<deletion);
  assert.ok(api.calls.slice(confirmation+1,deletion).some(c=>c.operation==='priceAlerts'));
  assert.equal((await create().create(replacement)).alert.alertId,moved.alert.alertId);
  assert.equal(api.items.length,2);
});

test('a failed replacement save keeps the original alert active',async()=>{
  const {service,api}=setup(); const {alert}=await service.create(input());
  api.available=false;
  await assert.rejects(service.create(input({requestId:'replacement-00000002',price:90,replacesAlertId:alert.alertId,replacesVersion:2})),{code:'PRICE_ALERT_CLOUD_UNAVAILABLE'});
  assert.equal(api.items.length,1);assert.equal(api.items[0].enabled,true);
  assert.equal(api.calls.some(c=>c.operation==='priceAlertAction'),false);
});

test('failed old-alert deletion retries the same replacement without duplicating it',async()=>{
  const {service,create,api}=setup(); const {alert}=await service.create(input());
  const original=api.tradingCloudRequest;
  let failDelete=true;
  api.tradingCloudRequest=async(...args)=>{
    if(failDelete&&args[0]==='priceAlertAction')throw Object.assign(Error('offline'),{code:'NETWORK_ERROR'});
    return original(...args);
  };
  const replacement=input({requestId:'replacement-00000003',price:95,replacesAlertId:alert.alertId,replacesVersion:2});
  await assert.rejects(service.create(replacement),{code:'PRICE_ALERT_REPLACEMENT_INCOMPLETE'});
  assert.equal((await service.snapshot()).alerts.length,2);
  failDelete=false;
  const moved=await create().create(replacement);
  assert.equal(api.items.length,2);
  assert.deepEqual((await service.snapshot()).alerts.map(a=>a.alertId),[moved.alert.alertId]);
});

test('replacement rejects stale versions, different markets and unverified readback',async()=>{
  const {service,api}=setup(); const {alert}=await service.create(input());
  const replacement=input({requestId:'replacement-00000004',price:95,replacesAlertId:alert.alertId,replacesVersion:2});
  await assert.rejects(service.create({...replacement,replacesVersion:1}),{code:'VERSION_CONFLICT'});
  await assert.rejects(service.create({...replacement,marketId:'BINANCE:SPOT:BTCUSDT'}),{code:'CLOUD_RESULT_CONTEXT_INVALID'});
  assert.equal(api.items.length,1);
  const original=api.tradingCloudRequest;
  api.tradingCloudRequest=async(...args)=>{
    const result=await original(...args);
    if(args[0]==='priceAlerts'&&api.items.length>1)result.items=result.items.filter(a=>a.id===alert.cloud.id);
    return result;
  };
  await assert.rejects(service.create(replacement),{code:'PRICE_ALERT_READBACK_FAILED'});
  assert.equal(api.items[0].state,'arming');
  assert.equal(api.calls.some(c=>c.operation==='priceAlertAction'),false);
});

test('an account switch between replacement save and delete prevents cross-account mutation',async()=>{
  const {api,service}=setup(); const {alert}=await service.create(input());
  let changed=false;
  const original=api.tradingCloudRequest;
  api.tradingCloudRequest=async(...args)=>{
    const result=await original(...args);
    if(args[0]==='confirmPriceAlert')changed=true;
    return result;
  };
  const guarded=createCloudPriceAlerts({owner:async()=>({...owner,ownerId:changed?'another':owner.ownerId}),api:()=>api});
  await assert.rejects(guarded.create(input({requestId:'replacement-00000005',price:95,replacesAlertId:alert.alertId,replacesVersion:2})),{code:'TRADING_PREFERENCE_OWNER_CHANGED'});
  assert.equal(api.items[0].state,'arming');
  assert.equal(api.calls.some(c=>c.operation==='priceAlertAction'),false);
});

test('replacement reuses the original read, retains final deletion verification and returns a verified receipt',async()=>{
  const {api,service}=setup();const {alert}=await service.create(input());api.calls.length=0;
  const spec=input({requestId:'replacement-fast-0001',price:95,replacesAlertId:alert.alertId,replacesVersion:2});
  const result=await service.create(spec);
  assert.equal(result.readbackVerified,true);assert.equal(result.requestId,spec.requestId);assert.equal(result.replacedAlertId,alert.alertId);
  assert.deepEqual(api.calls.map(c=>c.operation),['capabilities','priceAlerts','createPriceAlertDraft','confirmPriceAlert','priceAlerts','priceAlertAction','priceAlerts']);
});

test('replacement reads capabilities and original concurrently but writes only after both finish',async()=>{
  const {api,service}=setup();const {alert}=await service.create(input());api.calls.length=0;
  const original=api.tradingCloudRequest;let unblock;const waiting=new Promise(r=>unblock=r);const started=[];
  api.tradingCloudRequest=async(...args)=>{started.push(args[0]);if(started.length<=2)await waiting;return original(...args);};
  const result=service.create(input({requestId:'replacement-fast-0002',price:95,replacesAlertId:alert.alertId,replacesVersion:2}));
  await nextTurn();assert.deepEqual(started,['capabilities','priceAlerts']);assert.equal(api.items.length,1);
  unblock();await result;
});

test('a changed original version during replacement is still rejected by the server',async()=>{
  const {api,service}=setup();const {alert}=await service.create(input());
  const original=api.tradingCloudRequest;
  api.tradingCloudRequest=async(...args)=>{const result=await original(...args);if(args[0]==='confirmPriceAlert')api.items[0].version++;return result;};
  await assert.rejects(service.create(input({requestId:'replacement-fast-0003',price:95,replacesAlertId:alert.alertId,replacesVersion:2})),{code:'PRICE_ALERT_REPLACEMENT_INCOMPLETE'});
  assert.equal(api.items[0].state,'arming');assert.equal(api.items.length,2);
});

test('verified receipts merge only the affected chart markers and invalidate an older pending read',async()=>{
  const {service}=setup();const first=await service.create(input());
  const other=await service.create(input({requestId:'price-other-00000001',price:150}));
  const spec=input({requestId:'replacement-fast-0004',price:95,replacesAlertId:first.alert.alertId,replacesVersion:2});
  const result=await service.create(spec);
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  let resolveSnapshot,latest;const snapshot=new Promise(r=>resolveSnapshot=r);
  globalThis.window=Object.assign(new EventTarget(),{setInterval:()=>1,clearInterval:()=>{},codexDesktop:{tradingAlertsSnapshot:()=>snapshot}});
  globalThis.document={hidden:false};let unsubscribe;
  try {
    unsubscribe=subscribeChartPriceAlerts(value=>latest=value);
    const old={cloudLoaded:true,alerts:[first.alert,other.alert]};publishChartPriceAlerts(old);
    assert.equal(publishCreatedChartPriceAlert({...result,readbackVerified:false},spec),false);
    assert.equal(publishCreatedChartPriceAlert(result,{...spec,requestId:'another-request'}),false);
    assert.equal(publishCreatedChartPriceAlert(result,{...spec,price:96}),false);
    assert.equal(publishCreatedChartPriceAlert(result,spec),true);
    assert.deepEqual(latest.map(a=>a.price),[150,95]);
    resolveSnapshot(old);await refreshChartPriceAlerts();
    assert.deepEqual(latest.map(a=>a.price),[150,95],'a pre-save response cannot restore the old line');
    assert.equal(publishCreatedChartPriceAlert({...result,alert:{...result.alert,status:'completed',enabled:false}},spec),true);
    assert.deepEqual(latest.map(a=>a.price),[150],'an alert triggered during saving is not drawn as active');
  } finally {unsubscribe?.();globalThis.window=previousWindow;globalThis.document=previousDocument;}
});

for(const fails of [false,true])test(`actual IPC returns the verified create receipt before a ${fails?'failed':'pending'} full-list refresh`,async()=>{
  const source=readFileSync(new URL('../src/main/main.mjs',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('async function tradingAlertIpcCall('),source.indexOf('\nfunction getAnalysisModelRecoveryStore('));
  let finish,created=0,checked=0,sent=0;
  const snapshot=new Promise((resolve,reject)=>finish=()=>fails?reject(Error('list offline')):resolve({cloudLoaded:true,alerts:[]}));
  const receipt={readbackVerified:true,alert:{alertId:'fixture'}};
  const context={assertExternalModelsIpcSender:()=>{},requireFreshTradingPremiumAccess:async()=>checked++,
    cloudPriceAlerts:{create:async()=>{created++;return receipt;}},tradingAlertsCombinedSnapshot:()=>snapshot,
    sendToRenderer:()=>sent++,appLanguage:()=> 'en',cloudStrategyFailure:e=>({code:e.code||'error'})};
  const invoke=vm.runInNewContext(`(${body})`,context);let outcome;
  const request=invoke({},'createPriceAlert',input()).then(value=>outcome=value);
  await nextTurn();assert.equal(outcome?.ok,true);assert.equal(outcome.data,receipt);assert.equal(sent,0);
  assert.equal(checked,1);assert.equal(created,1);finish();await request;await nextTurn();assert.equal(sent,fails?0:1);
  context.requireFreshTradingPremiumAccess=async()=>{throw Object.assign(Error('membership'),{code:'TRIAL_REQUIRED'});};
  assert.equal((await invoke({},'createPriceAlert',input())).error.code,'TRIAL_REQUIRED');assert.equal(created,1);
});
