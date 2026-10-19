import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { tradingAnalysisSnapshotUnavailable } from "../src/main/trading-analysis/failure.mjs";
import ts from "typescript";
import { BinancePublicMarketService } from "../src/main/binance-public-market-service.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { binanceCandleHistoryComplete, binanceCandleBackfillLimit } from "../src/shared/binance-candle-request.mjs";
import { fetchTradingCandles, fetchLatestTradingCandles, recordBinanceMarketRateLimit,
  binanceMarketRateLimitMessage, tradingMarketStatsFromCandles, tradingAnalysisCandlesRequireCurrentRefresh } from "../src/renderer/trading-expert-market.ts";

const request = { marketType: "futures", path: "/fapi/v1/klines",
  parameters: { symbol: "ETHUSDT", interval: "1m", limit: 501 } };
const bars = (now = Date.now(), count = 5) => {
  const last = Math.floor(now / 60_000) * 60_000;
  return Array.from({length: count}, (_, i) => {
    const time = last - (count - 1 - i) * 60_000;
    return [time, "10", "12", "9", "11", "5", time + 59_999];
  });
};
async function withRenderer(api, run) {
  const previous = globalThis.window;
  globalThis.window = { codexDesktop: { getBinancePublicMarketData: api } };
  try { return await run(); } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
}

test("chart and analysis latest requests share one upstream read despite fresh intent", async () => {
  let calls = 0;
  const governor = new BinanceRequestGovernor();
  const service = new BinancePublicMarketService({fetch: (url, init) => governor.fetch(async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 10));
    return new Response(JSON.stringify(bars()));
  }, url, init)});
  try {
    const results = await withRenderer(value => service.request(value), () => Promise.all(
      Array.from({length: 12}, () => fetchTradingCandles("ETHUSDT", "1", 5, Date.now(), "perpetual", undefined, {forceFresh:true}))));
    assert.equal(calls, 1);
    assert.equal(results.length, 12);
    assert.equal(results[0].candles.length, 5);
    results[0].candles[0].close = 999;
    assert.equal(results[1].candles[0].close, 11, "each analysis gets independent frozen input arrays");
  } finally { await service.close(); }
});

test("renderer cooldown cannot hide a usable main-process cache for another symbol", async () => {
  recordBinanceMarketRateLimit(60_000, "futures");
  let ipc = 0;
  await withRenderer(async () => { ipc++; return {ok:true,status:200,cached:true,data:bars()}; },
    () => fetchTradingCandles("BTCUSDT", "1", 5));
  assert.equal(ipc, 1);
});

test("strict current analysis rejects a gateway stale response", async () => {
  await withRenderer(async () => ({ok:true,status:200,stale:true,data:bars()}), async () => {
    const browsing = await fetchTradingCandles("ETHUSDT", "1", 5);
    assert.equal(browsing.candles.length,5,"browsing can show same-pair cached candles during recovery");
    await assert.rejects(fetchTradingCandles("ETHUSDT", "1", 5, Date.now(), "perpetual", undefined, {forceFresh:true}), /旧 K 线/);
    await assert.rejects(fetchTradingCandles("ETHUSDT", "1S", 5, Date.now(), "perpetual", undefined, {forceFresh:true}), /旧 K 线/);
  });
});

test("manual retry reuses a deferred result while other cached symbols remain readable", async () => {
  let now = 1_000_000, calls = 0, limited = false;
  const service = new BinancePublicMarketService({now:()=>now, fetch: async () => {
    calls++;
    return limited ? new Response("{}", {status:429,headers:{"retry-after":"31","x-haolo-rate-limit-source":"gateway-downstream","x-haolo-rate-limit-scope":"egress-weight"}})
      : new Response(JSON.stringify(bars(now)));
  }});
  await service.request(request);
  limited = true;
  const other = {...request, parameters:{...request.parameters,symbol:"BTCUSDT"}};
  const rejected = await service.request(other);
  assert.equal(rejected.diagnostics.limitScope, "egress-weight");
  for (let i=0;i<20;i++) assert.equal((await service.request(other)).retryAfterMs,31_000);
  assert.equal((await service.request(request)).ok,true);
  assert.equal(calls,2);
  now+=31_001; limited=false;
  assert.equal((await service.request(other)).ok,true);
  assert.equal(calls,3);
  await service.close();
});

test("cache identity ignores parameter insertion order and stale replies cannot reset their age", async () => {
  let now=1_000_000, calls=0, stale=false;
  const service=new BinancePublicMarketService({now:()=>now,fetch:async()=>{
    calls++;
    return new Response(JSON.stringify(bars(now)), {headers: stale
      ? {"x-haolo-cache":"STALE","x-haolo-data-fetched-at":"1000000"}
      : {"x-haolo-data-fetched-at":"1000000"}});
  }});
  try {
    await service.request(request);
    await service.request({...request,parameters:{limit:501,interval:"1m",symbol:"ETHUSDT"}});
    assert.equal(calls,1);
    now+=2000;stale=true;
    assert.equal((await service.request(request)).fetchedAt,1000000);
    now+=2000;
    assert.equal((await service.request(request)).fetchedAt,1000000);
    now+=300000;
    assert.equal((await service.request(request)).ok,false,"retention is bounded by data age, not retry time");
  } finally {await service.close();}
});

test("a forming long-interval candle with endTime and a server cache HIT do not become fresh history", async () => {
  let now=Date.now(),calls=0;
  const service=new BinancePublicMarketService({now:()=>now,fetch:async()=>{
    calls++;
    return new Response(JSON.stringify(bars(now)), {headers:{"x-haolo-data-fetched-at":String(now-2000),"x-haolo-cache":"HIT"}});
  }});
  try {
    const value={...request,parameters:{symbol:"ETHUSDT",interval:"1h",limit:2,endTime:now-120000}};
    await service.request(value); now+=1001;
    await service.request(value);
    assert.equal(calls,2);
    assert.equal((await service.request({...value,freshness:"live"})).stale,true);
  } finally {await service.close();}
});

test("rate-limit wording distinguishes client, gateway and Binance", () => {
  assert.match(binanceMarketRateLimitMessage(31000,{origin:"gateway_downstream",limitScope:"egress-weight"}),/行情网关繁忙.*31/);
  assert.match(binanceMarketRateLimitMessage(31000,{origin:"local_budget"}),/客户端/);
  assert.match(binanceMarketRateLimitMessage(31000,{origin:"gateway_upstream"}),/Binance/);
});

test("calendar months, fixed 30-day bars, unfinished history and tail coverage are checked separately", () => {
  const jan=Date.UTC(2026,0,1)/1000,feb=Date.UTC(2026,1,1)/1000,mar=Date.UTC(2026,2,1)/1000;
  const month=[{time:jan,closed:true},{time:feb,closed:true},{time:mar,closed:false}];
  assert.equal(binanceCandleHistoryComplete(month,30*86400000,Date.UTC(2026,2,15),"1M"),true);
  assert.equal(binanceCandleHistoryComplete(month,30*86400000,Date.UTC(2026,2,15)),false);
  assert.equal(binanceCandleHistoryComplete([{time:0,closed:true},{time:30*86400,closed:false}],30*86400000,31*86400000),true);
  assert.equal(binanceCandleHistoryComplete([{time:60,closed:false},{time:120,closed:false}],60000,121000),false);
});

test("small incremental gaps request a small limit and retain all OHLCV and finality", async () => {
  const rows = bars();
  const requests=[];
  await withRenderer(async value => { requests.push(value); return {ok:true,data:rows,status:200}; }, async () => {
    const batch = await fetchLatestTradingCandles("ETHUSDT", "1", rows[0][0], undefined, "perpetual");
    assert.ok(requests[0].parameters.limit < 100);
    assert.equal(batch.candles.length,5);
    assert.deepEqual(batch.candles[0], {time:rows[0][0]/1000,open:10,high:12,low:9,close:11,volume:5,closed:true});
    assert.equal(batch.candles.at(-1).closed,false);
  });
  assert.equal(binanceCandleBackfillLimit(Date.now()-100000000,60000,"perpetual"),499);
});

test("observed fixed-minute watermarks expire and out-of-order responses cannot lower them", () => {
  let now=59_900;
  const governor=new BinanceRequestGovernor({now:()=>now});
  const response=weight=>new Response("{}",{headers:{"x-mbx-used-weight-1m":String(weight)}});
  governor.observeResponse("futures",response(1500),now);
  governor.observeResponse("futures",response(1400),now);
  assert.equal(governor.usedWeight("futures",now),1500);
  now=61_001;
  assert.equal(governor.usedWeight("futures",now),0);
});

test("queued prefetch cannot reserve the capacity before an interactive chart", async () => {
  let release;
  const governor=new BinanceRequestGovernor({maxConcurrency:1,limits:{futures:6},safetyRatio:0.5});
  const busy=governor.fetch(()=>new Promise(resolve=>{release=()=>resolve(new Response("{}"));}),"https://fapi.binance.com/fapi/v1/time");
  await new Promise(resolve=>setImmediate(resolve));
  const background=governor.fetch(async()=>new Response("{}"),"https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&limit=499",{}, {priority:10});
  const chart=governor.fetch(async()=>new Response("{}"),"https://fapi.binance.com/fapi/v1/klines?symbol=ETHUSDT&limit=499",{}, {priority:90});
  release(); await busy;
  assert.equal((await chart).status,200);
  assert.equal((await background).status,429);
});

test("the real analysis refresh method rejects missing history before requesting a quote", async () => {
  const source=await readFile(new URL("../src/renderer/trading-expert-market.ts",import.meta.url),"utf8");
  const start=source.indexOf("  private async refreshCurrentMarketSnapshotForAnalysis(");
  const end=source.indexOf("  private commitMarketSnapshot(",start);
  const javascript=ts.transpileModule(`class Harness {${source.slice(start,end)}};globalThis.Harness=Harness`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const now=Date.now();
  const rows=bars(now,5).map(row=>({time:row[0]/1000,open:10,high:12,low:9,close:11,volume:5,closed:row[6]<now}));
  const batch={candles:[rows[0],...rows.slice(2)],sourceCandles:[],source:{sourceMs:60000,targetMs:60000,sourceInterval:"1m"}};
  let quotes=0;
  const context=vm.createContext({Date,Error,tradingAnalysisSnapshotUnavailable,binanceCandleHistoryComplete,tradingAnalysisCandlesRequireCurrentRefresh,
    fetchTradingCandles:async()=>batch,fetchTradingMarketStats:async()=>{quotes++;return{lastPrice:11};},
    window:{setTimeout:fn=>fn()},MARKET_LIVE_PRICE_MAX_AGE_MS:10000});
  vm.runInContext(javascript,context);
  const instance=new context.Harness();
  instance.latestLivePricesByMarketId=new Map();
  await assert.rejects(instance.refreshCurrentMarketSnapshotForAnalysis({id:"BINANCE:FUTURES:ETHUSDT",symbol:"ETHUSDT",provider:"binance",marketType:"perpetual"},"1"),/旧 K 线/);
  assert.equal(quotes,0);
  assert.equal(binanceCandleHistoryComplete(rows,60000,now),true);
  assert.equal(binanceCandleHistoryComplete(rows.slice(0,-1),60000,now),false);
  // Current, complete snapshots must remain usable; missing stats cannot
  // rewrite their candles or prevent deterministic OHLCV-based analysis.
  batch.candles=rows;
  context.fetchTradingMarketStats=async()=>{throw new Error("stats temporarily unavailable");};
  context.tradingMarketStatsFromCandles=tradingMarketStatsFromCandles;
  context.setTradingMarketCandleCache=()=>{};
  context.tradingMarketCandleCacheKey=()=>"test";
  instance.disposed=true;
  const current=await instance.refreshCurrentMarketSnapshotForAnalysis({id:"BINANCE:FUTURES:ETHUSDT",symbol:"ETHUSDT",provider:"binance",marketType:"perpetual"},"1");
  assert.deepEqual(current.candles,rows);
  let refreshes=0;
  const delays=[];
  context.window.setTimeout=(fn,ms)=>{delays.push(ms);fn();};
  context.fetchTradingMarketStats=async()=>({});
  context.fetchTradingCandles=async()=>{refreshes++;return refreshes===1?{...batch,candles:rows.slice(0,-1)}:batch;};
  const recovered=await instance.refreshCurrentMarketSnapshotForAnalysis({id:"BINANCE:FUTURES:ETHUSDT",symbol:"ETHUSDT",provider:"binance",marketType:"perpetual"},"1");
  assert.equal(refreshes,2,"a minute-boundary tail must not end the retry loop early");
  assert.deepEqual(delays,[1100],"retry crosses the shared live-cache TTL");
  assert.deepEqual(recovered.candles,rows);
  refreshes=0;
  context.fetchTradingCandles=async()=>{refreshes++;throw Object.assign(new Error("cooldown"),{retryAfterMs:31000});};
  await assert.rejects(instance.refreshCurrentMarketSnapshotForAnalysis({id:"BINANCE:FUTURES:ETHUSDT",symbol:"ETHUSDT",provider:"binance",marketType:"perpetual"},"1"),/cooldown/);
  assert.equal(refreshes,1,"long cooldown has one probe, not three immediate attempts");
  context.fetchTradingCandles=async()=>{throw new Error("fresh candles unavailable");};
  instance.latestLivePricesByMarketId.set("BINANCE:FUTURES:ETHUSDT",{price:100,receivedAt:Date.now()});
  await assert.rejects(instance.refreshCurrentMarketSnapshotForAnalysis({id:"BINANCE:FUTURES:ETHUSDT",symbol:"ETHUSDT",provider:"binance",marketType:"perpetual"},"1",rows),{ code: "TRADING_ANALYSIS_SNAPSHOT_STALE" });
});
