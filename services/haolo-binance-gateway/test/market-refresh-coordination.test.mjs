import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { GatewayCache } from "../src/cache.mjs";
import { BinanceRestGateway, resolvePublicMarketRequest } from "../src/binance-rest.mjs";
import { baseConfig } from "./helpers.mjs";

test("near-now endTime is not an immutable one-hour cache entry", () => {
  const config=baseConfig();
  const near=resolvePublicMarketRequest(`/fapi/v1/klines?symbol=ETHUSDT&interval=1h&endTime=${Date.now()}`,config);
  const closed=resolvePublicMarketRequest(`/fapi/v1/klines?symbol=ETHUSDT&interval=1h&endTime=${Date.now()-7200000}`,config);
  assert.equal(near.policy.fresh,1000);
  assert.equal(closed.policy.fresh,3600000);
});

test("strict freshness refreshes an old historical cache without changing its identity", async () => {
  let calls=0;
  const cache=new GatewayCache();
  const config=baseConfig();
  const gateway=new BinanceRestGateway({cache,config,fetchImpl:async()=>{calls++;return new Response(JSON.stringify([[Date.now(),"1"]]));}});
  const url="/fapi/v1/klines?symbol=ETHUSDT&interval=1m&endTime=100000&limit=2";
  const key=resolvePublicMarketRequest(url,config).cacheKey;
  await cache.set(key,[[100000,"old"]],3600000,3600000);
  const record=cache.publicRest.memory.get(cache.key(key));
  const parsed=JSON.parse(record.raw);parsed.storedAt=Date.now()-2000;record.raw=JSON.stringify(parsed);
  const fresh=await gateway.get(url,{freshness:"live"});
  assert.equal(calls,1);
  assert.notEqual(fresh.value[0][1],"old");
  assert.equal((await gateway.get(url,{freshness:"live"})).cacheStatus,"HIT");
});

test("a production coordination failure does not send upstream traffic", async () => {
  const cache=new GatewayCache({redisUrl:"redis://unavailable"});
  let calls=0;
  const gateway=new BinanceRestGateway({cache,config:baseConfig(),fetchImpl:async()=>{calls++;return new Response("{}");}});
  await assert.rejects(gateway.get("/fapi/v1/klines?symbol=ETHUSDT&interval=1m&limit=2"),error=>error.code==="MARKET_COORDINATION_UNAVAILABLE");
  assert.equal(calls,0);
});

test("real Redis: independent replicas share a cold refresh and see a peer's newer cache", {skip:!process.env.REDIS_TEST_URL}, async () => {
  const prefix=`refresh-test:${crypto.randomUUID()}:`;
  const caches=Array.from({length:4},()=>new GatewayCache({redisUrl:process.env.REDIS_TEST_URL,prefix}));
  await Promise.all(caches.map(cache=>cache.connect()));
  let calls=0,admissions=0;
  const gateways=caches.map(cache=>new BinanceRestGateway({cache,config:baseConfig(),fetchImpl:async()=>{
    calls++;await new Promise(resolve=>setTimeout(resolve,80));return new Response(JSON.stringify({price:calls}));
  }}));
  const url="/fapi/v1/openInterest?symbol=ETHUSDT";
  try {
    const values=await Promise.all(Array.from({length:32},(_,i)=>gateways[i%4].get(url,{beforeUpstream:()=>{admissions++;}})));
    assert.equal(calls,1);assert.equal(admissions,1);
    assert.ok(values.every(value=>value.value.price===1));
    const key=resolvePublicMarketRequest(url,baseConfig()).cacheKey;
    await caches[0].set(key,{price:1},0,60000);
    await caches[1].set(key,{price:2},2000,60000);
    assert.equal((await caches[0].get(key)).value.price,2,"stale L1 must recheck Redis");
    // A strict consumer must also bypass a long-lived local cache when a peer
    // refreshed it; ordinary freshUntil alone is insufficient for this read.
    const local=caches[0].publicRest.memory.get(caches[0].key(key));
    const record=JSON.parse(local.raw);record.storedAt=Date.now()-5000;record.freshUntil=Date.now()+60000;
    local.raw=JSON.stringify(record);
    await caches[1].set(key,{price:3},60000,60000);
    assert.equal((await gateways[0].get(url,{freshness:"live"})).value.price,3);
    assert.equal(calls,1);
    const held="rest:futures:orphan";
    const lock=caches[0].key(`rest-flight:${crypto.createHash("sha256").update(held).digest("hex")}`);
    await caches[0].redis.set(lock,"dead-owner",{PX:100});
    assert.equal(await caches[1].sharedSingleFlight(held,async()=>"recovered",{leaseMs:1000}),"recovered");
    await assert.rejects(caches[0].sharedSingleFlight("rest:throw",async()=>{throw new Error("upstream failed");}),/upstream failed/);
    assert.equal(await caches[1].sharedSingleFlight("rest:throw",async()=>"released"),"released");
    let renewCalls=0, result=null;
    const readResult=async()=>result;
    const factory=async()=>{renewCalls++;await new Promise(resolve=>setTimeout(resolve,650));return result="renewed";};
    const leader=caches[0].sharedSingleFlight("rest:renew",factory,{leaseMs:300,readResult});
    await new Promise(resolve=>setTimeout(resolve,400));
    const follower=caches[1].sharedSingleFlight("rest:renew",factory,{leaseMs:1000,readResult});
    assert.deepEqual(await Promise.all([leader,follower]),["renewed","renewed"]);
    assert.equal(renewCalls,1,"an active refresh renews its lease");
  } finally {
    const keys=await caches[0].redis.keys(`${prefix}*`);
    if(keys.length)await caches[0].redis.unlink(keys);
    await Promise.all(caches.map(cache=>cache.close()));
  }
});
