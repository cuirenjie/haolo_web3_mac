import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import fs from 'node:fs';
import {YouleApiClient} from '../src/main/youle-api-client.mjs';
import {createCloudStrategyRuntime} from '../src/main/trading-strategy-runtime/cloud-runtime.mjs';
import {cloudAnalysisWindow} from '../src/renderer/cloud-analysis-window.ts';
import {OFFICIAL_TRADING_CATALOG} from '../src/shared/official-trading-catalog.mjs';

const captured=[];
after(()=>{
  if(process.env.HAOLO_WINDOW_CAPTURE)fs.writeFileSync(process.env.HAOLO_WINDOW_CAPTURE,JSON.stringify(captured,null,2));
});
for(const {id:strategy} of OFFICIAL_TRADING_CATALOG)test(`${strategy}: actual host and SDK delegate horizon across chart zoom`,async()=>{
  let baseline;
  for(const size of [20,100,300,600]) {
    const records=new Map(),queries=[];
    const api=new YouleApiClient({serviceFetch:async(url,init)=>{
      const uri=new URL(url);
      let body;
      if(uri.pathname.endsWith('/trading-capabilities'))body={windowsWorkerReady:true,entryV2WorkerReady:true,windowsContract:'windows-v1',
        strategies:[{id:strategy,legacyWindows:true,entryModes:['right']}]};
      else if(uri.pathname.endsWith('/market-snapshots')){
        queries.push(Object.fromEntries(uri.searchParams));
        assert.equal(init.headers.Authorization,'Bearer fixture-token');
        body={snapshotId:'00000000-0000-0000-0000-000000000001',marketKey:'binance:usdm:BTCUSDT',interval:'1h'};
      } else return new Response(JSON.stringify({detail:{code:'PARITY_CAPTURE_STOP'}}),{status:400,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
    }});
    Object.assign(api,{loaded:true,baseUrl:'https://haolo.example',token:'fixture-token',profile:{id:'fixture'}});
    const runtime=createCloudStrategyRuntime({owner:async()=>({ownerId:'fixture',accountId:'fixture',baseUrl:api.baseUrl}),api:()=>api,
      journal:{get:async(_o,k)=>records.get(k),put:async(_o,k,v)=>records.set(k,structuredClone(v))}});
    const candles=Array.from({length:size},(_,i)=>({time:1700000000+i*3600}));
    await assert.rejects(runtime.run(strategy,{analysisJobId:`zoom-${size}`,marketId:'BINANCE:FUTURES:BTCUSDT',interval:'60',
      preferencesRevision:0,preferencesHash:'a'.repeat(64),candles,...cloudAnalysisWindow(strategy,candles)}),e=>e.code==='PARITY_CAPTURE_STOP');
    const query=queries[0];
    assert.equal(queries.length,1);assert.equal(query.analysisStrategy,strategy);
    assert.equal(query.windowCount,undefined);assert.equal(query.preferredWindowCount,undefined);
    if(strategy==='vpvr-analysis')assert.equal(query.visibleTo,String(candles.at(-1).time*1000));
    else {assert.equal(query.visibleFrom,undefined);if(baseline)assert.deepEqual(query,baseline);}
    baseline=query;
    captured.push({strategy,size,query});
  }
});
