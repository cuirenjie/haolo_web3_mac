// Reformat this round's paid native responses under the final presentation code.
// A changed model prompt is rejected and requires another paid native review.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {BUILTIN_TRADING_STRATEGY_ADAPTERS} from '../src/main/trading-strategy-runtime/builtins/index.mjs';
import {TradingStrategyCoordinator} from '../src/main/trading-strategy-runtime/coordinator.mjs';
import {createTradingStrategyRegistry} from '../src/main/trading-strategy-runtime/registry.mjs';
const base='youle_desktop/output/real-model-revalidation-20261016';
const cases=JSON.parse(fs.readFileSync('../haolo_front_web3/output/real-model-revalidation-20261016/cases.json'));
const native=new Map();
for(const folder of ['native','native-repaired','native-wave-final'])for(const row of JSON.parse(fs.readFileSync(`${base}/${folder}/matrix.json`)))native.set(row.strategy,{...row,folder});
fs.mkdirSync(`${base}/windows-final`,{recursive:true});const rows=[];
for(const adapter of BUILTIN_TRADING_STRATEGY_ADAPTERS){
 const input=cases.find(c=>c.id===adapter.id);if(!input)continue;
 let n=0;const record=native.get(adapter.id);
 const registry={async analyze(_id,request){
  const call=record?.calls[n++];
  if(!call?.ok||createHash('sha256').update(request.prompt).digest('hex')!==call.promptSha256)throw Error('PAID_PROMPT_CHANGED_'+adapter.id);
  return {text:call.text,modelId:call.model,providerId:'paid-response-replay',latencyMs:call.latencyMs};
 }};
 const coordinator=new TradingStrategyCoordinator({registry:createTradingStrategyRegistry({adapters:BUILTIN_TRADING_STRATEGY_ADAPTERS}),modelRegistry:registry,providerId:'paid-response-replay'});
 const result=await coordinator.run(adapter.id,{...input.windowsParams,language:'en',responseMode:'full'});
 fs.writeFileSync(`${base}/windows-final/${adapter.id}.result.json`,JSON.stringify(result,null,2));
 rows.push({strategy:adapter.id,mode:record?'paid-native-response-replay-same-prompt':'deterministic',paidSource:record?.folder,modelCallsReplayed:n});
}
fs.writeFileSync(`${base}/windows-final/replay.json`,JSON.stringify(rows,null,2));console.log(JSON.stringify({cases:rows.length}));
