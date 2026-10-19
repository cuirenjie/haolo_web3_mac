import assert from 'node:assert/strict';
import test from 'node:test';
import {createCloudAlertFeed} from '../src/main/trading-strategy-runtime/cloud-alert-feed.mjs';
import {renderCloudAlertPanel,cloudAlertNotification} from '../src/main/cloud-alert-view.mjs';
import {createCloudAlertPanelController} from '../src/renderer/cloud-alert-panel.ts';
const account={ownerId:'owner-a',accountId:'a',baseUrl:'https://service.example'};
const alert={id:'alert',rule:{monitoringPolicy:'entry_v2',marketKey:'binance:usdm:BTCUSDT',interval:'5m',conditionHash:'a'.repeat(64),
  entryCondition:{schemaVersion:2,conditionId:'condition',revision:1,confirmation:'touch',trigger:{operator:'at_or_below',lower:95},expiresAt:2000000000000}}};
const event={sequence:11,alertId:alert.id,alert,data:{eventId:'event-1',condition:'entry',price:95,occurredAt:1900000000000,
  evidence:{conditionId:'condition',conditionRevision:1,conditionHash:alert.rule.conditionHash}}};
function setup() {
  const saved=new Map(),notifications=[],changes=[],calls=[];let current=account,failNotify=false,switchRequest=false;
  const journal={async get(owner){return saved.get(owner)||null;},async put(owner,_key,value){saved.set(owner,structuredClone(value));}};
  const api={async tradingCloudRequest(_op,payload){calls.push(payload);if(switchRequest)current={...account,ownerId:'b',accountId:'b'};
    return {schemaVersion:1,items:[alert],events:payload.after===10?[event]:[],recentEvents:[event],nextCursor:payload.after==null?10:11};}};
  const args={owner:async()=>current,api:()=>api,journal,notify:async value=>{if(failNotify)throw Error('notification failed');notifications.push(value.event.data.eventId);},changed:value=>changes.push(value)};
  return {args,feed:createCloudAlertFeed(args),saved,calls,notifications,changes,failNotify:value=>{failNotify=value;},switchRequest:()=>{switchRequest=true;},switchOwner:()=>{current={...account,ownerId:'b',accountId:'b'};}};
}
test('first synchronization shows history without replay; subsequent delivery survives process restart exactly by the persisted cursor',async()=>{
  const s=setup();await s.feed.refresh();assert.deepEqual(s.notifications,[]);assert.equal(s.saved.get(account.ownerId).cursor,10);
  await createCloudAlertFeed(s.args).refresh();assert.deepEqual(s.notifications,['event-1']);
  await createCloudAlertFeed(s.args).refresh();assert.deepEqual(s.notifications,['event-1']);
  assert.equal(s.saved.get(account.ownerId).cursor,11);
});
test('a notification failure retains a durable pending event and retries without consuming its cursor',async()=>{
  const s=setup();await s.feed.refresh();s.failNotify(true);await assert.rejects(s.feed.refresh(),/notification failed/);
  assert.equal(s.saved.get(account.ownerId).cursor,10);assert.equal(s.saved.get(account.ownerId).pending,'event-1');
  assert.equal(s.changes.at(-1).accountId,account.accountId);assert.equal(s.changes.at(-1).baseUrl,account.baseUrl);
  assert.equal(s.changes.at(-1).error.code,'CLOUD_ALERT_FEED_UNAVAILABLE');
  s.failNotify(false);await createCloudAlertFeed(s.args).refresh();assert.deepEqual(s.notifications,['event-1']);
});
test('account switching fences notification publication and writes; old snapshots are inaccessible',async()=>{
  const s=setup();await s.feed.refresh();s.switchRequest();await assert.rejects(s.feed.refresh(),e=>e.code==='TRADING_PREFERENCE_OWNER_CHANGED');
  assert.deepEqual(s.notifications,[]);assert.equal(s.saved.get('b'),undefined);assert.deepEqual((await s.feed.snapshot()).items,[]);
  assert.equal(s.changes.length,1);
});
test('mismatched condition evidence cannot be notified or acknowledged',async()=>{
  const s=setup();await s.feed.refresh();const bad=structuredClone(event);bad.data.evidence.conditionHash='b'.repeat(64);
  s.args.api=()=>({async tradingCloudRequest(){return {schemaVersion:1,items:[alert],events:[bad],recentEvents:[],nextCursor:11};}});
  await assert.rejects(createCloudAlertFeed(s.args).refresh(),e=>e.code==='CLOUD_ALERT_FEED_INVALID');
  assert.equal(s.saved.get(account.ownerId).cursor,10);assert.deepEqual(s.notifications,[]);
});
test('reminder presentation preserves conditions, escapes text and states that a trigger is not a fill in three languages',()=>{
  const malicious={...alert,rule:{...alert.rule,marketKey:'<img src=x onerror=alert(1)>'}};
  for(const language of ['zh-CN','en','zh-Hant']) {
    const html=renderCloudAlertPanel({items:[malicious],recentEvents:[event]},language);
    assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('95'));
    const note=cloudAlertNotification({alert,event},language);assert.ok(note.body.includes('95'));
    assert.match(note.body,language==='en'?/do not indicate fills/:/不表示成交/);
  }
});
test('renderer discards a feed response that arrived after an account switch',async()=>{
  let current=account,finish;const ui=createCloudAlertPanelController({owner:()=>current,language:()=> 'en',changed:()=>{},load:()=>new Promise(r=>{finish=r;})});
  const pending=ui.refresh();current={...account,accountId:'b'};finish({ok:true,...account,items:[alert],recentEvents:[]});await pending;
  assert.ok(!ui.render().includes('BTCUSDT'));
  ui.apply({...account,items:[alert],recentEvents:[]});assert.ok(!ui.render().includes('BTCUSDT'));
});

test('invalid recent history and malformed predicates fail before notification or cursor changes',async()=>{
  for(const mutate of [reply=>{reply.recentEvents=[{sequence:1}];},reply=>{reply.items[0].rule.entryCondition.trigger={operator:'in_zone',lower:100,upper:90};}]) {
    const s=setup();await s.feed.refresh();
    const reply=structuredClone({schemaVersion:1,items:[alert],events:[event],recentEvents:[event],nextCursor:11});mutate(reply);
    s.args.api=()=>({async tradingCloudRequest(){return reply;}});
    await assert.rejects(createCloudAlertFeed(s.args).refresh(),e=>e.code==='CLOUD_ALERT_FEED_INVALID');
    assert.equal(s.saved.get(account.ownerId).cursor,10);assert.deepEqual(s.notifications,[]);
  }
});
