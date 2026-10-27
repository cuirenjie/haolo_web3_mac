import assert from 'node:assert/strict';
import test from 'node:test';
import {createCloudAlertFeed, validEvent} from '../src/main/trading-strategy-runtime/cloud-alert-feed.mjs';
import {cloudAlertNotification} from '../src/main/cloud-alert-view.mjs';
import {priceAlertDeliveryDescription, priceAlertSummary} from '../src/shared/price-alert-copy.mjs';

const now=1900000000000;
const owner={ownerId:'host::one',accountId:'one',baseUrl:'host'};
const priceEvent=(sequence=1)=>{
  const alert={id:'dc7da639-547a-4608-b562-49db777b97fb',ruleHash:'a'.repeat(64),confirmedVersion:1,
    rule:{marketKey:'binance:usdm:BTCUSDT',interval:'1h',operator:'gte',threshold:100,confirmation:'intrabar'}};
  return {sequence,sourceSequence:sequence+10,alertId:alert.id,alert,data:{eventId:`price-${sequence}`,
    ruleHash:alert.ruleHash,ruleVersion:1,marketKey:alert.rule.marketKey,interval:'1h',condition:'price',
    price:100,occurredAt:now,evidence:{source:'public_trade',tradeId:42}}};
};
const page=events=>({version:2,events,cursor:events.at(-1).sequence,head:events.at(-1).sequence});
function setup() {
  const db=new Map(),shown=[];let current=owner,fail=false;
  const args={owner:async()=>current,api:()=>{throw Error('desktop must not send mail or evaluate prices');},eventsMode:true,now:()=>now,
    journal:{async get(o,k){return structuredClone(db.get(o+'/'+k));},async put(o,k,v){db.set(o+'/'+k,structuredClone(v));}},
    notify:async value=>{if(fail)throw Error('window failed');shown.push(cloudAlertNotification(value));}};
  return {args,db,shown,feed:createCloudAlertFeed(args),fail:v=>fail=v,switch:()=>current={...owner,ownerId:'host::two'},
    guard:async()=>{if(current!==owner)throw Error('SESSION_CHANGED');}};
}

test('new cloud price events show once across reconnect and restart, even below an old plan-only cursor',async()=>{
  const h=setup();h.db.set(owner.ownerId+'/feed',{cursor:100});
  const p=page([priceEvent(),priceEvent(2)]);
  await h.feed.deliver(owner,p,h.guard);
  await createCloudAlertFeed(h.args).deliver(owner,p,h.guard);
  assert.equal(h.shown.length,2);
  assert.equal(h.shown[0].alertId,'cloud-price-'+priceEvent().alert.id);
  assert.equal(h.shown[0].marketId,'BINANCE:FUTURES:BTCUSDT');
  assert.equal(h.shown[0].interval,'1h');assert.equal(h.shown[0].triggeredAt,now);
});

test('price receipts survive a popup failure; stale catchup is history only and account changes are fenced',async()=>{
  const h=setup();h.fail(true);
  await assert.rejects(h.feed.deliver(owner,page([priceEvent()]),h.guard),/window failed/);
  assert.equal(await h.feed.cursor(owner),0);
  h.fail(false);await createCloudAlertFeed(h.args).deliver(owner,page([priceEvent()]),h.guard);
  const stale=priceEvent(2);stale.data.occurredAt-=3600000;
  await h.feed.deliver(owner,page([stale]),h.guard);assert.equal(h.shown.length,1);
  h.switch();await assert.rejects(h.feed.deliver(owner,page([priceEvent(3)]),h.guard),/SESSION_CHANGED/);
  assert.equal(h.shown.length,1);assert.deepEqual((await h.feed.snapshot()).recentEvents,[]);
});

test('price notification validates the frozen rule, version, market and evidence before showing',async()=>{
  for(const mutate of [
    e=>e.data.ruleHash='b'.repeat(64),e=>e.data.ruleVersion=2,e=>e.data.marketKey='binance:spot:BTCUSDT',
    e=>e.data.interval='5m',e=>e.data.price=NaN,e=>e.data.evidence=null,e=>e.data.condition='entry',
    e=>e.alert.rule.threshold=-1,e=>e.alert.rule.operator='unknown',e=>e.alert.rule.monitoringPolicy='unknown',
    e=>e.alert.confirmedVersion=undefined,e=>e.alertId='other',
  ]) {
    const h=setup(),bad=priceEvent();mutate(bad);
    await h.feed.deliver(owner,page([bad,priceEvent(2)]),h.guard);
    assert.equal(h.shown.length,1);assert.equal(h.shown[0].evidenceId,'price-2');
    assert.equal(h.db.get(owner.ownerId+'/delivery-v2').failedCount,1);
  }
});

test('price, compound and legacy plan events keep their own labels without weakening entry_v2 validation',()=>{
  for(const operator of ['gte','lte','gt','lt','cross_over','cross_under']) {
    const e=priceEvent();e.alert.rule.operator=operator;
    assert.equal(validEvent(e,new Map()),true);
    delete e.data.condition;assert.equal(validEvent(e,new Map()),true,'legacy candle price event');
  }
  const compound=priceEvent();compound.alert.rule={kind:'compound_v1',marketKey:compound.data.marketKey,interval:'1h'};
  compound.data.condition='compound';compound.data.evidence={value:true};
  assert.equal(validEvent(compound,new Map()),true);
  assert.match(cloudAlertNotification({alert:compound.alert,event:compound},'en').body,/Compound/);
  compound.data.evidence.value=false;assert.equal(validEvent(compound,new Map()),false);
  const plan=priceEvent();plan.alert.rule={kind:'execution_plan',monitoringPolicy:'windows_v1',marketKey:plan.data.marketKey,interval:'1h',side:'long',entry:100,stop:90,targets:[110,120]};
  plan.data.condition='target:1';assert.equal(validEvent(plan,new Map()),true);
  plan.data.condition='target:2';assert.equal(validEvent(plan,new Map()),false);
  plan.alert.rule.monitoringPolicy='entry_v2';plan.data.condition='entry';assert.equal(validEvent(plan,new Map()),false);
});

test('all five languages explain both delivery channels and show the actual target and trigger price',()=>{
  const markers={'zh-CN':['邮件','桌面'],'zh-Hant':['郵件','桌面'],en:['Email','desktop'],ko:['이메일','데스크톱'],ja:['メール','デスクトップ']};
  for(const [language,words] of Object.entries(markers)) {
    for(const text of [priceAlertDeliveryDescription(language),priceAlertSummary('gte',100,language)])
      for(const word of words)assert.ok(text.includes(word),text);
    const event=priceEvent();event.data.price=101;
    const note=cloudAlertNotification({alert:event.alert,event},language);
    assert.ok(note.title.endsWith(' · BTCUSDT'));assert.doesNotMatch(note.title,/binance:|usdm:|spot:/i);
    assert.ok(note.body.includes('≥ 100'));assert.ok(note.body.includes('101'));
    assert.ok(!note.body.includes('undefined'));
    if(['en','ko'].includes(language))assert.doesNotMatch(note.title+note.body,/\p{Script=Han}/u);
  }
});

test('spot popup titles also show only the symbol while their chart context remains intact',()=>{
  const event=priceEvent();event.alert.rule.marketKey='binance:spot:ETHUSDT';
  const note=cloudAlertNotification({alert:event.alert,event});
  assert.equal(note.title,'预警触发 · ETHUSDT');assert.equal(note.marketId,'BINANCE:SPOT:ETHUSDT');
});
