import assert from 'node:assert/strict';
import test from 'node:test';
import { DrawingReplica, drawingToWire, drawingFromWire, canonicalDrawingMarket, drawingCacheKey, drainDrawingOutbox, DesktopDrawingSync } from '../src/renderer/manual-drawing-sync.ts';
import { manualDrawingRequest } from '../src/main/manual-drawing-sync.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const market='binance:usdm:BTCUSDT';
const shape=()=>({id:crypto.randomUUID(),tool:'trend-line',symbol:market,drawingScope:'main',points:[{time:1700000000000,price:100},{time:1700003600000,price:110}]});
const receipt=(entries=[])=>({schemaVersion:4,version:1,marketKey:market,serverTime:Date.now(),entries});
class Storage {
  items=new Map();get length(){return this.items.size;}key(i){return [...this.items.keys()][i]??null;}
  getItem(k){return this.items.get(k)??null;}setItem(k,v){this.items.set(k,String(v));}removeItem(k){this.items.delete(k);}
}
test('Market, interval, pane and UTC coordinates roundtrip',()=>{
  assert.equal(canonicalDrawingMarket('BINANCE:FUTURES:btcusdt'),market);
  assert.notEqual(canonicalDrawingMarket('BINANCE:SPOT:BTCUSDT'),market);
  const native={...shape(),symbol:'BINANCE:FUTURES:BTCUSDT',interval:'60',drawingScope:'indicator:macd',points:[{time:1700000000,price:-2},{time:1700003600,price:0}],color:'#123456',locked:true};
  const wire=drawingToWire(native);
  assert.equal(wire.drawingScope,'indicator:MACD');assert.equal(wire.interval,'1h');assert.equal(wire.points[0].time,1700000000000);
  const restored=drawingFromWire(wire,native.symbol);assert.deepEqual(restored.points,native.points);assert.equal(restored.drawingScope,native.drawingScope);assert.equal(restored.locked,true);
});

test('Two-anchor annotations and image opacity survive local restart without blocking compatible drawing uploads', () => {
  const annotations = ['note', 'callout', 'table', 'image'].map(tool => drawingToWire({
    ...shape(), tool, text: tool === 'table' ? '第一格|第二格|\n||\n||' : '内容',
    ...(tool === 'image' ? { imageOpacity: .55 } : {}),
  }));
  const line = drawingToWire(shape()), replica = new DrawingReplica();
  replica.merge(receipt()); replica.edit([], [...annotations, line]);
  const upload = replica.begin(market, '1h');
  assert.deepEqual(upload.operations.map(op => op.id), [line.id]);
  replica.acknowledge();
  const restored = new DrawingReplica(replica.serialize());
  restored.merge(receipt([{ id: line.id, changeId: 'server-line', changedAt: Date.now(), drawing: line }]));
  for (const annotation of annotations) {
    const saved = restored.drawings().find(d => d.id === annotation.id);
    assert.deepEqual(saved, annotation);
    assert.equal(drawingFromWire(saved, market).imageOpacity, annotation.imageOpacity);
  }
  assert.equal(restored.dirty, false);
});
test('Per-object newer edit wins, independent additions merge and deletion beats a delayed old request',()=>{
  const a=new DrawingReplica(),b=new DrawingReplica();a.merge(receipt());b.merge(receipt());
  const d=shape();a.edit([],[d]);const old=structuredClone(a.entries[d.id]);
  b.merge(receipt([old]));b.edit([d],[{...d,color:'#abcdef'}]);const newer=structuredClone(b.entries[d.id]);
  a.merge(receipt([newer]));assert.equal(a.drawings()[0].color,'#abcdef');
  a.acknowledge();b.edit(b.drawings(),[]);const deletion=structuredClone(b.entries[d.id]);
  a.merge(receipt([deletion]));assert.deepEqual(a.drawings(),[]);
  const separate=shape();a.edit([],[separate]);a.merge(receipt([deletion]));assert.deepEqual(a.drawings(),[separate]);
  assert.ok(deletion.changedAt>old.changedAt);
});
test('Equal timestamps converge; opening or changing JSON field order never counts as an edit',()=>{
  const d=shape(),stamp=Date.now(),a={id:d.id,changeId:'a',changedAt:stamp,drawing:d},b={...a,changeId:'b',drawing:null};
  const replica=new DrawingReplica();replica.merge(receipt([a]));
  replica.edit([d],[Object.fromEntries(Object.entries(d).reverse())]);assert.equal(replica.dirty,false);
  replica.pending[d.id]=b;replica.merge(receipt([a]));assert.deepEqual(replica.drawings(),[]);
});
test('Ambiguous request survives restart with identical body and does not acknowledge later edits',()=>{
  let replica=new DrawingReplica();replica.merge(receipt());const d=shape();replica.edit([],[d]);
  const first=JSON.stringify(replica.begin(market,'1h'));replica=new DrawingReplica(replica.serialize());
  replica.edit([d],[{...d,color:'#abcdef'}]);replica.merge(receipt());
  assert.equal(JSON.stringify(replica.begin(market,'1h')),first);
  replica.acknowledge();assert.equal(replica.dirty,true);assert.notEqual(JSON.stringify(replica.begin(market,'1h')),first);
});
test('An inactive task outbox drains after restart and leaves other accounts untouched',async()=>{
  const storage=new Storage(),replica=new DrawingReplica();replica.edit([],[shape()]);
  const own=drawingCacheKey(owner,market,'old-session','main'),other=drawingCacheKey('other',market,'old-session','main');
  storage.setItem(own,replica.serialize());storage.setItem(other,replica.serialize());const requests=[];
  await drainDrawingOutbox(async params=>{requests.push(params);return receipt();},owner,storage);
  assert.deepEqual(requests.map(r=>r.action),['read','write']);assert.equal('taskId' in requests[1],false);
  assert.equal(new DrawingReplica(storage.getItem(own)).dirty,false);assert.equal(new DrawingReplica(storage.getItem(other)).dirty,true);
});
test('Only an explicit clock rejection replaces a future-dated mutation; normal retry remains immutable',()=>{
  const replica=new DrawingReplica();replica.merge(receipt());replica.offset=600000;replica.edit([],[shape()]);
  const original=replica.begin(market,'1h');const originalBody=JSON.stringify(original);
  replica.merge(receipt());assert.equal(JSON.stringify(replica.begin(market,'1h')),originalBody);
  replica.correctRejectedClock();const next=replica.begin(market,'1h');
  assert.notEqual(next.mutationId,original.mutationId);assert.ok(next.operations[0].changedAt<=Date.now()+100);
  assert.equal(replica.drawings().length,1);
});
test('Authenticated main-process bridge limits routes and rejects stale account responses',async()=>{
  const requests=[];
  const api={load:async()=>{},token:'test-token',profile:{id:owner},baseUrl:'https://haolo.test',requireAuth(){if(!this.token)throw Error('auth');},authHeaders(){return {Authorization:'Bearer test-token'};},async requestJson(url,options){requests.push({url,options});return receipt();}};
  assert.deepEqual(await manualDrawingRequest(api,{action:'session'}),{owner});
  await manualDrawingRequest(api,{action:'read',owner,market});assert.equal(requests[0].url,`https://haolo.test/api/mobile/v1/new-task/manual-sync?market=${encodeURIComponent(market)}`);
  await assert.rejects(manualDrawingRequest(api,{action:'read',owner:'other',market}),/ACCOUNT_CHANGED/);
  await assert.rejects(manualDrawingRequest(api,{action:'list',owner}),/ACTION_INVALID/);
  await assert.rejects(manualDrawingRequest(api,{action:'resolve',owner,localId:'anything'}),/ACTION_INVALID/);
  api.requestJson=async()=>{api.profile={id:'other'};return receipt();};
  await assert.rejects(manualDrawingRequest(api,{action:'read',owner,market}),/ACCOUNT_CHANGED/);
});
test('Different new task sessions share automatically; history stays frozen and does not publish',async()=>{
  const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
  const storage=new Storage(),window=new EventTarget();globalThis.window=window;globalThis.localStorage=storage;globalThis.document={hidden:false,documentElement:{dataset:{language:'en'}}};
  const entries={}, requests=[]; let accountOwner=owner, online=true;
  window.codexDesktop={manualDrawings:async params=>{
    requests.push(params);
    if(params.action==='session')return {owner:accountOwner};
    if(!online)throw Error('offline');
    const key=params.owner+':'+(params.market||params.body.marketKey), bucket=entries[key]??={};
    if(params.action==='write')for(const op of params.body.operations){const old=bucket[op.id];if(!old||op.changedAt>old.changedAt||(op.changedAt===old.changedAt&&op.changeId>old.changeId))bucket[op.id]=structuredClone(op);}
    return receipt(Object.values(bucket));
  }};
  function client(sessionId){
    const client={data:[],session:sessionId,newTask:true,symbol:'BINANCE:FUTURES:BTCUSDT'};
    client.sync=new DesktopDrawingSync({session:()=>client.session,isNewTask:()=>client.newTask,symbol:()=>client.symbol,interval:()=> '60',scope:'main',snapshot:()=>client.data,apply:d=>{client.data=d;},busy:()=>false,status:()=>{}});
    return client;
  }
  const a=client('windows-new-a'),b=client('windows-new-b'),tick=()=>new Promise(r=>setTimeout(r,20));
  try{
    await tick();const d=drawingFromWire(shape(),a.symbol);a.data=[d];a.sync.changed();await a.sync.sync();await b.sync.sync();
    assert.equal(b.data[0].id,d.id); assert.ok(requests.every(r=>!('taskId' in r)));
    b.data=[{...b.data[0],color:'#abcdef'}];b.sync.changed();await b.sync.sync();await a.sync.sync();assert.equal(a.data[0].color,'#abcdef');
    a.newTask=false;a.sync.contextChanged();a.data=[{...a.data[0],color:'#123456'}];a.sync.changed();await a.sync.sync();await b.sync.sync();
    assert.equal(b.data[0].color,'#abcdef');assert.equal(a.data[0].color,'#123456');
    b.data=[];b.sync.changed();await b.sync.sync();await a.sync.sync();assert.equal(a.data[0].color,'#123456');
    a.newTask=true;a.session='fresh-new-task';a.data=[];a.sync.contextChanged();await tick();assert.deepEqual(a.data,[]);
    a.symbol='BINANCE:FUTURES:ETHUSDT';a.sync.contextChanged();await tick();const eth={...d,id:crypto.randomUUID(),symbol:a.symbol};a.data=[eth];a.sync.changed();await a.sync.sync();
    b.symbol=a.symbol;b.sync.contextChanged();await tick();assert.equal(b.data[0].id,eth.id);
    b.symbol='BINANCE:SPOT:ETHUSDT';b.sync.contextChanged();await tick();assert.deepEqual(b.data,[]);
    online=false;a.session='offline-new-task';a.data=[];a.sync.contextChanged();await tick();assert.equal(a.data[0].id,eth.id);
    accountOwner='other-account';await a.sync.sync();assert.deepEqual(a.data,[]);
  }finally{a.sync.destroy();b.sync.destroy();await tick();Object.assign(globalThis,previous);}
});

test('A late new-task response cannot replace a historical chart',async()=>{
  const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
  const window=new EventTarget();globalThis.window=window;globalThis.localStorage=new Storage();globalThis.document={hidden:false,documentElement:{dataset:{language:'en'}}};
  let resolveRead, pending=false,newTask=true,data=[],taskId='blank';
  window.codexDesktop={manualDrawings:async p=>p.action==='session'?{owner}:pending?await new Promise(r=>resolveRead=r):receipt()};
  const sync=new DesktopDrawingSync({session:()=>taskId,isNewTask:()=>newTask,symbol:()=> 'BINANCE:FUTURES:BTCUSDT',interval:()=> '60',scope:'main',snapshot:()=>data,apply:d=>data=d,busy:()=>false,status:()=>{}});
  try{
    await new Promise(r=>setTimeout(r,20));pending=true;const request=sync.sync();await new Promise(r=>setTimeout(r,0));
    newTask=false;taskId='history';const historical=drawingFromWire(shape(),'BINANCE:FUTURES:BTCUSDT');data=[historical];sync.contextChanged();resolveRead(receipt());await request;
    assert.deepEqual(data,[historical]);
  }finally{sync.destroy();Object.assign(globalThis,previous);}
});

test('Clearing a shared market synchronizes that market without clearing another pair or historical surface',async()=>{
  const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
  const window=new EventTarget();globalThis.window=window;globalThis.localStorage=new Storage();globalThis.document={hidden:false,documentElement:{dataset:{language:'en'}}};
  const entries={};window.codexDesktop={manualDrawings:async p=>{
    if(p.action==='session')return {owner};const key=p.market||p.body.marketKey,bucket=entries[key]??={};
    if(p.action==='write')for(const op of p.body.operations)bucket[op.id]=structuredClone(op);
    return receipt(Object.values(bucket));
  }};
  const clients=[];
  function client(pair,id,newTask=true){const c={data:[],newTask};c.sync=new DesktopDrawingSync({session:()=>id,isNewTask:()=>c.newTask,symbol:()=>pair,interval:()=> '60',scope:'main',snapshot:()=>c.data,apply:d=>c.data=d,busy:()=>false,status:()=>{}});clients.push(c);return c;}
  const btc=client('BINANCE:FUTURES:BTCUSDT','btc'),eth=client('BINANCE:FUTURES:ETHUSDT','eth'),history=client('BINANCE:FUTURES:BTCUSDT','history',false),tick=()=>new Promise(r=>setTimeout(r,20));
  try{
    await tick();btc.data=[drawingFromWire(shape(),'BINANCE:FUTURES:BTCUSDT')];btc.sync.changed();await btc.sync.sync();
    eth.data=[drawingFromWire({...shape(),symbol:'binance:usdm:ETHUSDT'},'BINANCE:FUTURES:ETHUSDT')];eth.sync.changed();await eth.sync.sync();history.data=structuredClone(btc.data);
    const before=btc.data;btc.data=[];btc.sync.clearKnown(before);await tick();await btc.sync.sync();await eth.sync.sync();
    assert.deepEqual(btc.data,[]);assert.equal(eth.data.length,1);assert.equal(history.data.length,1);assert.equal(Object.values(entries[market])[0].drawing,null);
  }finally{clients.forEach(c=>c.sync.destroy());await tick();Object.assign(globalThis,previous);}
});
