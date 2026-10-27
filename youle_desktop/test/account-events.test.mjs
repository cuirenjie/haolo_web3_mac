import assert from 'node:assert/strict';
import test from 'node:test';
import {createAccountEventClient} from '../src/main/account-event-client.mjs';
import {createCloudAlertFeed} from '../src/main/trading-strategy-runtime/cloud-alert-feed.mjs';

const owner={ownerId:'https://service.example::a',accountId:'a',baseUrl:'https://service.example'};
const now=1900000000000;
const alert={id:'alert',title:'fixture',rule:{monitoringPolicy:'entry_v2',marketKey:'binance:usdm:BTCUSDT',interval:'5m',conditionHash:'a'.repeat(64),
  entryCondition:{schemaVersion:2,conditionId:'condition',revision:1,confirmation:'touch',trigger:{operator:'at_or_below',lower:95},expiresAt:2000000000000}}};
const event=(sequence=1,age=0)=>({sequence,sourceSequence:sequence+10,alertId:alert.id,alert,data:{eventId:`event-${sequence}`,condition:'entry',price:95,occurredAt:now-age,
  evidence:{conditionId:'condition',conditionRevision:1,conditionHash:alert.rule.conditionHash}}});
const page=(events,head=events.at(-1)?.sequence||0)=>({version:2,events,cursor:events.at(-1)?.sequence||0,head});
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};
function feedFixture() {
  const db=new Map(),notifications=[];let fail=false,current=owner;
  const args={owner:async()=>current,api:()=>{throw Error('business requests forbidden');},eventsMode:true,now:()=>now,
    journal:{async get(o,k){return structuredClone(db.get(`${o}/${k}`));},async put(o,k,v){db.set(`${o}/${k}`,structuredClone(v));}},
    notify:async value=>{if(fail)throw Error('notification unavailable');notifications.push(value.event.data.eventId);}};
  return {args,db,notifications,feed:createCloudAlertFeed(args),fail:value=>{fail=value;},switch:()=>{current={...owner,ownerId:'other',accountId:'other'};},
    guard:async()=>{if(current!==owner)throw Error('SESSION_CHANGED');}};
}
test('durable cursor replays duplicate pages and process restart without duplicate alerts or business calls',async()=>{
  const h=feedFixture(),p=page([event(),event(2)]);
  await h.feed.deliver(owner,p,h.guard);
  await createCloudAlertFeed(h.args).deliver(owner,p,h.guard);
  assert.deepEqual(h.notifications,['event-1','event-2']);
  assert.equal(await h.feed.cursor(owner),2);
  assert.equal((await h.feed.snapshot()).recentEvents.length,2);
});
test('notification failure retains full pending event and restart catches up',async()=>{
  const h=feedFixture();h.fail(true);
  await assert.rejects(h.feed.deliver(owner,page([event()]),h.guard),/notification/);
  assert.equal(await h.feed.cursor(owner),0);
  assert.equal(h.db.get(`${owner.ownerId}/delivery-v2`).pending.data.eventId,'event-1');
  h.fail(false);await createCloudAlertFeed(h.args).deliver(owner,page([event()]),h.guard);
  assert.equal(await h.feed.cursor(owner),1);
});
test('offline catchup is history only and legacy delivered events are not notified again',async()=>{
  const h=feedFixture();h.db.set(`${owner.ownerId}/feed`,{cursor:12});
  await h.feed.deliver(owner,page([event(),event(2),event(3,3600000)]),h.guard);
  assert.deepEqual(h.notifications,[]);
  assert.equal((await h.feed.snapshot()).recentEvents.length,3);
});
test('sequence gaps and corrupt envelopes cannot silently advance receipt',async()=>{
  for(const p of [page([event(2)]),page([{...event(),sourceSequence:null}]),{...page([event()]),cursor:2}]){
    const h=feedFixture();await assert.rejects(h.feed.deliver(owner,p,h.guard));
    assert.equal(await h.feed.cursor(owner),0);assert.deepEqual(h.notifications,[]);
  }
});
test('poison evidence is durably marked failed while valid later reminders progress across restart',async()=>{
  const h=feedFixture(),bad={...event(),data:{...event().data,evidence:{}}};
  const p=page([bad,event(2)]);
  await h.feed.deliver(owner,p,h.guard);
  await createCloudAlertFeed(h.args).deliver(owner,p,h.guard);
  assert.equal(await h.feed.cursor(owner),2);
  assert.deepEqual(h.notifications,['event-2']);
  const saved=h.db.get(`${owner.ownerId}/delivery-v2`);
  assert.equal(saved.failedCount,1);assert.equal(saved.failedReceipts[0].sourceSequence,11);
  assert.equal(saved.failedReceipts[0].code,'CLOUD_ALERT_EVIDENCE_INVALID');
  assert.equal(saved.failedDigest.length,64);assert.equal(saved.recentEvents.length,1);
});
test('oversized server evidence has a failed receipt and journal failure cannot skip it',async()=>{
  const h=feedFixture(),p=page([{sequence:1,sourceSequence:11,rejected:'EVENT_TOO_LARGE'},event(2)]);
  const put=h.args.journal.put;h.args.journal.put=async()=>{throw Error('disk unavailable');};
  await assert.rejects(h.feed.deliver(owner,p,h.guard),/disk/);
  assert.equal(await h.feed.cursor(owner),0);assert.deepEqual(h.notifications,[]);
  h.args.journal.put=put;await h.feed.deliver(owner,p,h.guard);
  assert.equal(h.db.get(`${owner.ownerId}/delivery-v2`).failedReceipts[0].code,'EVENT_TOO_LARGE');
  assert.deepEqual(h.notifications,['event-2']);
});
test('retention gap is durable and never resets an ahead/corrupt cursor or another account',async()=>{
  const h=feedFixture();await h.feed.gap(owner,{reason:'history_expired',cursor:5});
  await h.feed.deliver(owner,page([event(6)]),h.guard);
  assert.equal((await h.feed.snapshot()).historyGap,true);
  await assert.rejects(h.feed.gap(owner,{reason:'cursor_ahead',cursor:0}));
  h.switch();await assert.rejects(h.feed.deliver(owner,page([event(7)]),h.guard));
  assert.deepEqual((await h.feed.snapshot()).recentEvents,[]);
});
test('simultaneous replay is serialized and inbox is bounded',async()=>{
  const h=feedFixture();await Promise.all([h.feed.deliver(owner,page([event()]),h.guard),h.feed.deliver(owner,page([event()]),h.guard)]);
  for(let i=2;i<=301;i+=100)await h.feed.deliver(owner,page(Array.from({length:100},(_,j)=>event(i+j,3600000))),h.guard);
  assert.equal((await h.feed.snapshot()).recentEvents.length,200);
  assert.deepEqual(h.notifications,['event-1']);
});

function streamFixture({responseStatus,hang=false,failReminders=false,ignoreAbort=false,slowCancel=false,cursor:readCursor,owner:readOwner}={}) {
  const calls=[],states=[],statuses=[],deliveries=[],timers=new Map();let id=0,wire,current=owner,clock=now;
  const client={token:'token',authHeaders:()=>({Authorization:'Bearer token'}),serviceFetch:async(url,options)=>{
    calls.push({url,options});
    if(hang)return new Promise((_,reject)=>{if(!ignoreAbort)options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
    if(responseStatus)return new Response('',{status:responseStatus,headers:{'Retry-After':'60'}});
    const body=new ReadableStream({start(c){wire=c;if(!ignoreAbort)options.signal.addEventListener('abort',()=>{try{c.error(Error('aborted'));}catch{}},{once:true});},cancel(){if(slowCancel)return new Promise(()=>{});}});
    return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
  }};
  const app=createAccountEventClient({owner:readOwner || (async()=>current),api:()=>client,cursor:readCursor|| (async()=>3),
    reminders:async(o,v,valid)=>{await valid();if(failReminders)throw Error('notification unavailable');deliveries.push(v);},gap:async()=>{},state:v=>states.push(v),status:v=>statuses.push(v),
    schedule:(fn,delay)=>{const key=++id;timers.set(key,{fn,delay});return key;},cancel:key=>timers.delete(key),random:()=>0,now:()=>clock});
  const emit=(kind,value)=>wire.enqueue(new TextEncoder().encode(`event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`));
  return {app,calls,states,statuses,deliveries,timers,client,emit,wire:()=>wire,advance:ms=>clock+=ms,switch:()=>{current={...owner,ownerId:'other'};}};
}

test('clean short EOF backs off while stable connection rotation remains fast',async()=>{
  const h=streamFixture();h.app.start();await settle();
  for(const delay of [2000,4000,8000,16000,32000,60000,60000]) {
    h.emit('state',{version:2,topics:{settings:'1',drawings:'2',plans:'3'}});
    h.wire().close();await settle();
    const [key,timer]=[...h.timers][0];assert.equal(timer.delay,delay);
    h.timers.delete(key);timer.fn();await settle();
  }
  h.advance(30000);h.emit('check',{version:2});h.wire().close();await settle();
  assert.equal([...h.timers.values()][0].delay,1000);
  h.app.stop();assert.equal(h.timers.size,0);
});

test('stop and watchdog finish even when transport ignores abort or cancellation stalls',async()=>{
  for(const hang of [false,true]) {
    const h=streamFixture({hang,ignoreAbort:true,slowCancel:true});h.app.start();await settle();
    [...h.timers.values()][0].fn();await settle();
    assert.equal(h.app.running,false);assert.equal([...h.timers.values()][0].delay,2000);
    h.app.stop();assert.equal(h.timers.size,0);
  }
});

test('a delayed cursor cannot send an old account request after stop',async()=>{
  let finish;const h=streamFixture({cursor:()=>new Promise(resolve=>finish=resolve)});
  h.app.start();await settle();h.app.stop();await settle();
  assert.equal(h.app.running,false);finish(3);await settle();assert.equal(h.calls.length,0);
});
test('stop cancels initial account lookup and a restart ignores its late result',async()=>{
  let finish,first=true;
  const h=streamFixture({owner:()=>first?(first=false,new Promise(resolve=>finish=resolve)):Promise.resolve(owner)});
  h.app.start();await settle();h.app.stop();await settle();
  assert.equal(h.app.running,false);assert.equal(h.calls.length,0);
  h.app.start();await settle();assert.equal(h.calls.length,1);
  finish({...owner,ownerId:'old-account'});await settle();
  assert.equal(h.app.scope,owner.ownerId);assert.equal(h.calls.length,1);
  h.app.stop();await settle();assert.equal(h.app.running,false);
});
test('one SSE connection replaces business polling; partial chunks and healthy checks are accepted',async()=>{
  const h=streamFixture();h.app.start();await settle();
  h.emit('state',{version:2,topics:{settings:'1',drawings:'2:3',plans:'4'}});await settle();
  for(let i=0;i<10;i++)h.emit('check',{version:2});await settle();
  assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/sync\/events\?after=3$/);
  assert.equal(h.calls[0].options.method,'GET');assert.equal(h.states.length,1);
  assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].delay,45000);
  await h.app.wake();await settle();assert.equal(h.calls.length,1);
  h.app.stop();await settle();assert.equal(h.timers.size,0);
});
test('account change cancels the old stream and never publishes its delayed event',async()=>{
  const h=streamFixture();h.app.start();await settle();h.switch();
  h.emit('reminders',page([event()]));await settle();assert.equal(h.deliveries.length,0);
  await h.app.wake();await settle();assert.equal(h.calls.length,2);
  h.app.stop();await settle();
});
test('server 429 backoff is honored without a fallback polling loop',async()=>{
  const h=streamFixture({responseStatus:429});h.app.start();await settle();
  assert.equal([...h.timers.values()][0].delay,60000);assert.equal(h.calls.length,1);
  assert.equal(h.statuses.at(-1).state,'reconnecting');h.app.stop();
});
test('state remains available while notification failure backs off across reconnects',async()=>{
  const h=streamFixture({failReminders:true});h.app.start();await settle();
  for(const delay of [2000,4000,8000]) {
    h.emit('state',{version:2,topics:{settings:'1',drawings:'2',plans:'3'}});
    h.emit('reminders',page([event(4)]));await settle();
    const [key,timer]=[...h.timers][0];assert.equal(timer.delay,delay);
    h.timers.delete(key);timer.fn();await settle();
  }
  assert.equal(h.states.length,3);assert.equal(h.deliveries.length,0);
  h.app.stop();await settle();
});
test('hung headers are cancelled within 20 seconds and reconnect is bounded',async()=>{
  const h=streamFixture({hang:true});h.app.start();await settle();
  const header=[...h.timers.values()][0];assert.equal(header.delay,20000);header.fn();await settle();
  assert.equal(h.calls[0].options.signal.aborted,true);
  assert.equal([...h.timers.values()][0].delay,2000);h.app.stop();
});
test('truncated or oversized SSE payloads disconnect rather than consume events',async()=>{
  for(const bytes of ['event: reminders\ndata: {', 'x'.repeat(2*1024*1024+1)]) {
    const h=streamFixture();h.app.start();await settle();h.wire().enqueue(new TextEncoder().encode(bytes));h.wire().close();await settle();
    assert.equal(h.deliveries.length,0);assert.equal(h.statuses.at(-1).state,'reconnecting');h.app.stop();
  }
});

test('one transport chunk may contain many bounded complete frames',async()=>{
  const h=streamFixture();h.app.start();await settle();
  const frame=`event: check\ndata: ${JSON.stringify({version:2,padding:'x'.repeat(750000)})}\n\n`;
  h.wire().enqueue(new TextEncoder().encode(frame.repeat(3)));await settle();
  assert.equal(h.statuses.at(-1).state,'connected');assert.equal(h.calls.length,1);
  h.app.stop();await settle();
});
