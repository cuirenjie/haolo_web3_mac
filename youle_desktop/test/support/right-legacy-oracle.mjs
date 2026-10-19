// Independent test oracle: execute the original Git source, never the migrated
// private implementation. HAOLO_RIGHT_BASELINE_ROOT must name a read-only fixture
// materialized from b79ec878 under this repository's output directory.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const baseline=process.env.HAOLO_RIGHT_BASELINE_ROOT;
assert.ok(baseline,'HAOLO_RIGHT_BASELINE_ROOT is required for the independent comparison');
assert.equal(readFileSync(resolve(baseline,'SOURCE_COMMIT'),'utf8').trim(),'b79ec878e78c407cae5fda219ddcaa0b6a431f6f');
const original=relative=>pathToFileURL(resolve(baseline,'youle_desktop',relative));
const clean=value=>JSON.parse(JSON.stringify(value));
export async function verifyOriginal({input,actual,engineRoot}) {
  // Reconstruct the old Windows profile independently from the same saved
  // entries, not from the new server's generic mobile risk conversion.
  const {tradingRiskProfileFromEntries}=await import(original('src/main/personal-context/memory-store.mjs'));
  input={...input,riskProfile:tradingRiskProfileFromEntries(input.riskProfile?.entries||[])};
  const strategy=input.action==='price_action'||input.action==='general'?'price-action':input.action;
  const adapterFile=pathToFileURL(resolve(engineRoot,`${input.action==='general'?'price-action':strategy}.mjs`));
  const adapter=await import(adapterFile);
  const {indicatorParams}=await import(pathToFileURL(resolve(engineRoot,'indicator-adapter.mjs')));
  const convert=adapter[Object.keys(adapter).find(name=>name.endsWith('Params'))]||indicatorParams;
  const params={...convert(input,input.action==='general'?30:strategy==='vpvr-analysis'?20:80),
    ...(input.action==='general'?{analysisContext:input.analysisContext,positionManagementRequested:input.positionManagementRequested}: {})};
  const originalImport=/import\s*\{\s*(\w+)\s*\}\s*from\s*['"]\.\/desktop\/src\/main\/trading-analysis\/([^'"]+)/.exec(readFileSync(adapterFile,'utf8'));
  assert.ok(originalImport);
  const pipeline=input.action==='general'?(await import(original('src/main/trading-analysis/price-action-pipeline.mjs'))).runTradingPriceActionAnalysisPipeline:
    (await import(original(`src/main/trading-analysis/${originalImport[2]}`)))[originalImport[1]];
  const prompts=[];let reviewIndex=0;
  const modelRegistry={async analyze(_provider,request,options){
    prompts.push({prompt:request.prompt,reasoningEffort:options.reasoningEffort});
    const review=input.reviews?.[reviewIndex++];assert.ok(review,'original review receipt missing');
    return {...review,requestId:request.requestId};
  }};
  const now=Date.now;Date.now=()=>input.snapshot.fetchedAt;
  let expected;
  try {
    if(input.action==='general')expected=await pipeline(params,{providerId:'mobile',modelRegistry});
    else {
      const manifest=JSON.parse(readFileSync(original(`resources/trading-strategies/builtins/${strategy}/strategy.json`),'utf8'));
      const {TradingStrategyCoordinator}=await import(original('src/main/trading-strategy-runtime/coordinator.mjs'));
      const run=async(p,options)=>{
        if(strategy!=='wave')return pipeline(p,options);
        const {runTradingWaveAnalysisWithAutoExpansion}=await import(original('src/renderer/trading-expert-wave-expansion.ts'));
        let pool=p.candles,pageIndex=0;
        const expanded=await runTradingWaveAnalysisWithAutoExpansion({initialCandles:pool.slice(-100),getAvailableCandles:()=>pool,
          loadMoreHistory:input.waveInput?.historyPages?.length?async()=>{const page=input.waveInput.historyPages[pageIndex++];if(page)pool=[...page.map(c=>({...c,time:c.time/1000})),...pool];}:undefined,
          analyze:async candles=>{try{return {ok:true,result:await pipeline({...p,candles},options)};}catch(error){if(error.code==='TRADING_WAVE_INSUFFICIENT_DATA')return {ok:false,error:{code:error.code}};throw error;}}});
        assert.equal(expanded.response.ok,true);return expanded.response.result;
      };
      expected=await new TradingStrategyCoordinator({registry:{require:()=>({manifest}),adapter:()=>({run})},modelRegistry,providerId:'mobile'}).run(strategy,params);
    }
  } finally {Date.now=now;}
  assert.deepEqual(actual.snapshot,clean(expected.snapshot),'original snapshot');
  for(const field of ['report','narrative','drawingPatch','indicatorDrawingPatch','analysisId','executionPlan']) {
    assert.deepEqual(actual.analysisPlan[field],expected.analysisPlan[field]===undefined?undefined:clean(expected.analysisPlan[field]),`original ${strategy}/${input.locale}/${input.responseMode} ${field}`);
  }
  if(input.action!=='general') {
    assert.deepEqual(actual.executionPlan,clean(expected.executionPlan),'original native execution plan');
    assert.deepEqual(actual.strategyResult,clean(expected.strategyResult),'original strategy result');
  }
  const main=readFileSync(original('src/main/main.mjs'),'utf8');
  const block=main.slice(main.indexOf('"You are a read-only market theory review component'),main.indexOf('if (signal?.aborted) throw signal.reason || tradingAnalysisAbortError();',main.indexOf('"You are a read-only market theory review component')));
  const instructions=[...block.matchAll(/^\s*("(?:[^"\\]|\\.)*"),?\s*$/gm)].map(match=>JSON.parse(match[1])).join('\n');
  assert.ok(instructions.startsWith('You are a read-only market theory review component'));
  return {ok:true,prompts,instructions};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  let text='';for await(const chunk of process.stdin)text+=chunk;
  console.log(JSON.stringify(await verifyOriginal(JSON.parse(text))));
}
