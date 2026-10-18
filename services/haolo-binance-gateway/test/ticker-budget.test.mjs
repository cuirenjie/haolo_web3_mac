import assert from "node:assert/strict";
import test from "node:test";
import { GatewayCache } from "../src/cache.mjs";
import { BinanceRestGateway, resolvePublicMarketRequest } from "../src/binance-rest.mjs";
import { createPublicGatewayServer } from "../src/public-server.mjs";
import { baseConfig } from "./helpers.mjs";

const batch = (symbols) => `/fapi/v1/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
const rows = [{ symbol: "BTCUSDT", lastPrice: "81234.56789012" }, { symbol: "ETHUSDT", lastPrice: "2378.90123456" }];

test("ticker weights follow distinct Futures and Spot endpoint contracts", () => {
  const config=baseConfig();
  for (const [url, expected] of [
    ["/fapi/v1/ticker/24hr?symbol=BTCUSDT",1], ["/fapi/v1/ticker/24hr",40],
    [batch(["BTCUSDT","ETHUSDT"]),40], ["/api/v3/ticker/24hr?symbol=BTCUSDT",2],
    ["/api/v3/ticker/24hr",80],
    ...[1,20,21,100].map(n=>["/api/v3/ticker/24hr?symbols="+encodeURIComponent(JSON.stringify(Array.from({length:n},(_,i)=>`COIN${i}USDT`))),n<=20?2:40]),
  ]) assert.equal(resolvePublicMarketRequest(url,config).weight,expected,url);
  for(const url of [batch([]),batch(["BTCUSDT"])+"&symbol=ETHUSDT"])
    assert.throws(()=>resolvePublicMarketRequest(url,config),e=>e.statusCode===400);
});

test("concurrent Futures subsets share one real catalogue read and retain separate exact projections", async () => {
  const cache=new GatewayCache();let reads=0,charged=0;
  const gateway=new BinanceRestGateway({config:baseConfig(),cache,fetchImpl:async url=>{
    reads++;assert.equal(url.searchParams.has("symbols"),false);
    await new Promise(r=>setTimeout(r,30));return Response.json(rows);
  }});
  const opts={beforeUpstream:route=>{charged+=route.weight;}};
  try {
    const [btc,eth,all]=await Promise.all([gateway.get(batch(["BTCUSDT"]),opts),gateway.get(batch(["ETHUSDT"]),opts),gateway.get("/fapi/v1/ticker/24hr",opts)]);
    assert.deepEqual(btc.value,[rows[0]]);assert.deepEqual(eth.value,[rows[1]]);assert.deepEqual(all.value,rows);
    assert.equal(reads,1);assert.equal(charged,40);
    const reordered=await gateway.get(batch(["ETHUSDT","BTCUSDT","ETHUSDT"]),opts);
    assert.deepEqual(reordered.value,rows);assert.equal(reordered.cacheStatus,"HIT");assert.equal(reads,1);
    assert.equal(btc.value[0].lastPrice,"81234.56789012","prices remain exact strings");
    const spotA=resolvePublicMarketRequest("/api/v3/ticker/24hr?symbols="+encodeURIComponent('["ETHUSDT","BTCUSDT"]'),baseConfig());
    const spotB=resolvePublicMarketRequest("/api/v3/ticker/24hr?symbols="+encodeURIComponent('["BTCUSDT","ETHUSDT"]'),baseConfig());
    assert.equal(spotA.cacheKey,spotB.cacheKey);
  } finally {await cache.close();}
});

test("ten-symbol polling stays within unchanged 300 weight budget, rejects real exhaustion, then recovers", async t => {
  let clock=Math.floor(Date.now()/60000)*60000+1000;
  t.mock.method(Date,"now",()=>clock);
  const cache=new GatewayCache();let reads=0;
  const config=baseConfig({allowAnonymousPublic:true,downstreamRequestsPerMinute:300,downstreamBurstRequestsPerMinute:1200,publicUserWeightPerMinute:300});
  const rest=new BinanceRestGateway({config,cache,fetchImpl:async()=>{reads++;return Response.json(rows);}});
  const server=createPublicGatewayServer({config,restGateway:rest,streamPool:{stats:()=>({}),subscribe:()=>()=>{}}});
  await server.listen();
  const request=batch(Array.from({length:10},(_,i)=>i===0?"BTCUSDT":`COIN${i}USDT`));
  const origin=`http://127.0.0.1:${server.server.address().port}`;
  try {
    for(let i=0;i<6;i++) {
      const response=await fetch(origin+request);
      assert.equal(response.status,200);assert.deepEqual(await response.json(),[rows[0]]);
      clock+=8000;
    }
    assert.equal(reads,6,"six upstream polls consume 240, not the former 480");
    let response=await fetch(origin+request);assert.equal(response.status,200);await response.arrayBuffer();
    clock+=2500;
    response=await fetch(origin+request);
    assert.equal(response.status,200,"bounded stale fallback remains explicitly labelled");
    assert.equal(response.headers.get("x-haolo-cache"),"STALE");
    assert.equal(response.headers.get("x-haolo-rate-limit-scope"),"user-weight");
    assert.ok(Number(response.headers.get("retry-after"))>0);await response.arrayBuffer();
    assert.equal(reads,7,"real over-budget call does not reach Binance");
    clock=Math.floor(clock/60000)*60000+61000;
    response=await fetch(origin+request);
    assert.equal(response.status,200);assert.notEqual(response.headers.get("x-haolo-cache"),"STALE");
    assert.equal(response.headers.get("x-haolo-rate-limit-source"),null);await response.arrayBuffer();
    assert.equal(reads,8);
  } finally {await server.close();await cache.close();}
});
