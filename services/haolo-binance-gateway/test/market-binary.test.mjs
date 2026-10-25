import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { compressMarketFrame, decodeMarketWireFrame, negotiateMarketTransport } from '../src/market-binary-codec.mjs';
import { createMarketFrameEncoder } from '../src/market-frame.mjs';
import { createPublicGatewayServer } from '../src/public-server.mjs';
import { GatewayCache } from '../src/cache.mjs';
import { baseConfig } from './helpers.mjs';

const event = a => ({stream:'btcusdt@aggTrade',data:{e:'aggTrade',E:1792860000000+a,s:'BTCUSDT',a,
  p:'65123.12345678',q:'0.00000100',f:a,l:a,T:1792860000000+a,m:false,nq:'0.00000100',unknown:{nested:[null,true,'保留']}}});

test('binary codec is versioned, opt-in, mirrored and every frame stands alone', async () => {
  assert.equal(negotiateMarketTransport(['hmz1','hmc2'],false),'hmc2');
  assert.equal(negotiateMarketTransport(['hmz1','hmc2'],true),'hmz1');
  assert.equal(negotiateMarketTransport(['hmc1'],true),'hmc1');
  assert.deepEqual(await readFile(new URL('../src/market-binary-codec.mjs',import.meta.url)),
    await readFile(new URL('../../../youle_desktop/src/main/market-binary-codec.mjs',import.meta.url)));
  const encode = createMarketFrameEncoder();
  for(const sequence of [18,1,500,2]) {
    const original=event(sequence), packed=encode(original,true,'hmz1');
    assert.equal(packed.binary,true);assert.ok(packed.bytes < packed.jsonBytes*.8);
    assert.deepEqual(decodeMarketWireFrame(packed.text,true),original);
    for(let i=0;i<2000;i++) assert.strictEqual(encode(original,true,'hmz1'),packed);
  }
  assert.equal(compressMarketFrame('{}'),null);
  const text=JSON.stringify({unknown:'raw'});
  assert.deepEqual(decodeMarketWireFrame(text,false),JSON.parse(text));
});

test('malformed binary frames cannot inflate unbounded data or silently alter precision', () => {
  const frame=compressMarketFrame(JSON.stringify(event(1)));
  for(const mutate of [b=>b.subarray(0,6),b=>{b[0]=0;return b;},b=>{b.writeUInt32BE(0xffffffff,3);return b;},
    b=>{b.writeUInt32BE(1,3);return b;},b=>b.subarray(0,9)]) {
    assert.throws(()=>decodeMarketWireFrame(mutate(Buffer.from(frame)),true));
  }
});

test('real negotiated sockets deliver all events in order to new and old clients without double compression', async () => {
  const listeners=new Set();
  const gateway=createPublicGatewayServer({config:baseConfig({marketCompactEnabled:true,marketCompactPercent:100,
    marketBinaryEnabled:true,wsCompressionPercent:100}),restGateway:{cache:new GatewayCache()},
    accessTokenVerifier:{verify:async token=>({userId:token})}, onDiagnostic:()=>{},
    streamPool:{stats:()=>({}),subscribe(_m,_s,publish){listeners.add(publish);return()=>listeners.delete(publish);}}});
  await gateway.listen();
  const origin=`http://127.0.0.1:${gateway.server.address().port}`,clients=[];
  try {
    const results=[];
    for(const offered of [['hmz1','hmc2'],['hmc2'],['hmc1'],[]]) {
      const response=await fetch(origin+'/api/market/v1/tickets',{method:'POST',headers:{authorization:`Bearer fixture-${clients.length}`},body:JSON.stringify({codecs:offered})});
      const ticket=await response.json();
      assert.equal(ticket.codec,offered[0]||'json');
      const socket=new WebSocket(origin.replace('http','ws')+`/stream/futures?streams=btcusdt@aggTrade&ticket=${ticket.ticket}`);
      clients.push(socket);
      const received=[];
      results.push(new Promise(resolve=>socket.on('message',(raw,binary)=>{received.push(decodeMarketWireFrame(raw,binary));if(received.length===100)resolve(received);})));
      await once(socket,'open');
    }
    for(let i=0;i<100;i++) {const shared=event(i);for(const publish of listeners)publish(shared);}
    const result=await Promise.race([Promise.all(results),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('delivery timeout')),5000);t.unref();})]);
    for(const received of result)assert.deepEqual(received,Array.from({length:100},(_,i)=>event(i)));
  } finally {for(const socket of clients)socket.terminate();await gateway.close();}
});
