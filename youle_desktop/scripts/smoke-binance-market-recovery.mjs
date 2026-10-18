// Read-only market verification. Never logs credentials, tickets or socket URLs.
import assert from "node:assert/strict";
import fs from "node:fs";
import WebSocket from "ws";
import { resolveBinanceGatewayConfig } from "../src/main/binance-gateway-config.mjs";
import { createBinanceGatewayNetworkFetch } from "../src/main/binance-gateway-network.mjs";
import { createBinanceGatewayClient } from "../src/main/binance-gateway-client.mjs";
import { BinanceNetworkRouter } from "../src/main/binance-network-router.mjs";
import { BinanceRequestGovernor } from "../src/main/binance-request-governor.mjs";
import { BinancePublicMarketService } from "../src/main/binance-public-market-service.mjs";
import { decodeMarketPayload } from "../src/main/market-wire-codec.mjs";

const argument = name => process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
assert.ok(process.argv.includes("--live"), "Pass --live for read-only production checks");
assert.ok(argument("session-file"), "Provide --session-file with an existing access session");
const { token }=JSON.parse(fs.readFileSync(argument("session-file"),"utf8"));
assert.ok(token,"Access session required");
const config=resolveBinanceGatewayConfig({},JSON.parse(fs.readFileSync(new URL("../resources/binance-gateway.json",import.meta.url),"utf8")));
const network=createBinanceGatewayNetworkFetch(config);
const client=createBinanceGatewayClient({config,apiClient:{getTrustedAccessToken:async()=>token},fetchImpl:network});
const router=new BinanceNetworkRouter({config,gatewayClient:client,directFetch:network});
const governor=new BinanceRequestGovernor();
let gatewayReads=0,socket;
const service=new BinancePublicMarketService({timeoutMs:0,fetch:(url,init)=>governor.fetch(async(...args)=>{
  gatewayReads++;return router.publicGatewayOnlyFetch(...args);
},url,init,{timeoutMs:30000})});
const report={at:new Date().toISOString(),checks:[],scope:"Public BTCUSDT candles and one public kline stream; no trading/account endpoints"};
const save=()=>{if(argument("report"))fs.writeFileSync(argument("report"),JSON.stringify(report,null,2));};
const request=marketType=>({marketType,path:marketType==="spot"?"/api/v3/klines":"/fapi/v1/klines",
  parameters:{symbol:"BTCUSDT",interval:"1m",limit:20},freshness:"live"});
function validate(result) {
  assert.equal(result.ok,true);assert.equal(result.stale===true,false);
  assert.equal(result.data.length,20);
  for(let i=0;i<result.data.length;i++) {
    const row=result.data[i], [open,high,low,close,volume]=row.slice(1,6).map(Number);
    assert.ok([open,high,low,close,volume].every(Number.isFinite));
    assert.ok(high>=Math.max(open,close)&&low<=Math.min(open,close)&&volume>=0);
    if(i)assert.equal(row[0]-result.data[i-1][0],60000);
  }
  const tail=result.data.at(-1);
  assert.ok(tail[0]<=Date.now()&&tail[6]>=Date.now()-1500,`latest candle must cover current minute: tail=${tail[0]}, close=${tail[6]}, now=${Date.now()}`);
}
try {
  for(const marketType of ["futures","spot"]) {
    const before=gatewayReads,started=Date.now();
    const values=await Promise.all(Array.from({length:12},()=>service.request(request(marketType),{signal:AbortSignal.timeout(35000)})));
    values.forEach(validate);
    assert.equal(gatewayReads-before,1);
    report.checks.push({check:"concurrent current candles",marketType,consumers:12,gatewayReads:gatewayReads-before,
      rows:values[0].data.length,elapsedMs:Date.now()-started,diagnostics:values[0].diagnostics});save();
  }
  const endpoint=new URL(await client.marketStreamEndpoint({marketType:"futures",combined:true}));
  endpoint.searchParams.set("streams","btcusdt@kline_1m");
  const lags=[];
  const closed=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("No finalized kline within 75 seconds")),75000);
    socket=new WebSocket(endpoint.href,{lookup:network.lookup,handshakeTimeout:12000});
    const finish=(error,value)=>{clearTimeout(timer);if(error)reject(error);else resolve(value);};
    socket.on("error",()=>finish(new Error("Public market WebSocket unavailable")));
    socket.on("message",raw=>{
      try {
        const message=decodeMarketPayload(JSON.parse(String(raw)));
        const event=message.data||message;
        if(event.e!=="kline")return;
        lags.push(Date.now()-Number(event.E));
        if(event.k.x===true)finish(null,event.k);
      } catch {finish(new Error("Invalid public market frame"));}
    });
  });
  socket.close();
  report.stream={events:lags.length,maxEventLagMs:Math.max(...lags),closedOpenTime:closed.t};save();
  await new Promise(resolve=>setTimeout(resolve,1500));
  const result=await service.request(request("futures"),{signal:AbortSignal.timeout(35000)});
  report.finalRest={at:Date.now(),tail:result.data?.at(-1)?.[0],diagnostics:result.diagnostics,stale:result.stale===true};save();
  validate(result);
  const row=result.data.find(row=>Number(row[0])===Number(closed.t));
  assert.ok(row,"finalized stream candle must exist in REST history");
  assert.deepEqual(row.slice(1,6).map(Number),[closed.o,closed.h,closed.l,closed.c,closed.v].map(Number));
  const sorted=lags.slice().sort((a,b)=>a-b);
  report.checks.push({check:"finalized WebSocket candle equals REST OHLCV",events:lags.length,
    p95EventLagMs:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*0.95))],maxEventLagMs:Math.max(...lags),closedOpenTime:closed.t});
  assert.ok(lags.length>=1&&Math.max(...lags)<5000,"stream event lag exceeds five seconds");
  report.passed=true;
} catch(error) {
  report.passed=false;report.error={name:error.name,code:error.code||"",message:String(error.message).slice(0,240)};
  process.exitCode=1;
} finally {
  socket?.terminate();await service.close();router.close();network.close();save();
  console.log(JSON.stringify(report,null,2));
}
