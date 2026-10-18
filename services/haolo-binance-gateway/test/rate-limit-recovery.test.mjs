import test from 'node:test';
import assert from 'node:assert/strict';
import {GatewayCache} from '../src/cache.mjs';
import {BinanceRestGateway} from '../src/binance-rest.mjs';
import {createPublicGatewayServer} from '../src/public-server.mjs';
import {baseConfig,createJwt} from './helpers.mjs';

for(const scope of ['user-weight','egress-weight'])test(`HTTP ${scope}: cache survives 429 and the next window recovers without stale prices`,async()=>{
 const actualNow=Date.now;
 let now=Math.floor(actualNow()/60000)*60000+10000;
 Date.now=()=>now;
 const cache=new GatewayCache();
 let gateway,calls=0;
 try {
  const config=baseConfig({publicUserWeightPerMinute:scope==='user-weight'?1:10,
   publicFuturesUpstreamWeightPerMinute:scope==='egress-weight'?1:100});
  const restGateway=new BinanceRestGateway({config,cache,fetchImpl:async()=>{
   calls++;return new Response(JSON.stringify([[Math.floor(now/60000)*60000,'10','12','9',String(10+calls),'5',Math.floor(now/60000)*60000+59999]]));
  }});
  gateway=createPublicGatewayServer({config,restGateway,streamPool:{stats:()=>({}),subscribe:()=>()=>{}}});
  await gateway.listen();
  const origin=`http://127.0.0.1:${gateway.server.address().port}`;
  const headers={authorization:`Bearer ${createJwt(config.jwtSecret)}`};
  const read=symbol=>fetch(`${origin}/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=2`,{headers});
  const first=await read('BTCUSDT');assert.equal(first.status,200);
  const firstRows=await first.json();
  const limited=await read('ETHUSDT');assert.equal(limited.status,429);
  assert.equal(limited.headers.get('x-haolo-rate-limit-scope'),scope);
  const retry=Number(limited.headers.get('retry-after'))*1000;
  assert.ok(retry>0&&retry<=65000);
  const cached=await read('BTCUSDT');assert.equal(cached.status,200);
  assert.equal(cached.headers.get('x-haolo-cache'),'HIT');assert.deepEqual(await cached.json(),firstRows);
  assert.equal(calls,1,'429 and cache hits must not consume upstream traffic');
  now+=retry+1;
  const recovered=await read('ETHUSDT');assert.equal(recovered.status,200);
  assert.equal(recovered.headers.get('x-haolo-cache'),'MISS');
  const rows=await recovered.json();assert.ok(rows[0][0]>firstRows[0][0]);assert.equal(rows[0][4],'12');
  assert.equal(calls,2);
 } finally {if(gateway)await gateway.close();await cache.close();Date.now=actualNow;}
});
