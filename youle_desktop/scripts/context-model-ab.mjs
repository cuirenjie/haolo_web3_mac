// Opt-in paid comparison using the operator's existing Haolo session. All
// account/market observations below are synthetic; no tools or trades execute.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {ModelRequestRelay} from '../src/main/model-request-relay.mjs';
import {analysisEvidence} from '../src/main/codex-analysis-evidence.mjs';
import zlib from 'node:zlib';

export const root=fileURLToPath(new URL('../..',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
export function credentials() {
  const s=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'haolo_desktop','haolo-session.json'),'utf8'));
  if(s.profile?.id==='b956f354-5c37-4410-97d0-a29a7fda413a'||s.profile?.email==='935655474@qq.com') throw Error('Customer account prohibited');
  const key=s.modelKeys.find(k=>k.provider==='deepseek'), billing=s.modelKeys.find(k=>k.provider==='codex');
  if(!key?.apiKey||!billing?.apiKeyId||new URL(key.baseUrl).origin!=='https://haolo.pro') throw Error('Authenticated operator model route required');
  return {key,billing,ownerHash:hash(s.profile.id).slice(0,16)};
}
export function createAudit(directory, prefix) {
  const auth=credentials();
  const filename=path.join(directory,'requests.json');
  const audit={prefix,startedAt:new Date().toISOString(),ownerHash:auth.ownerHash,billingKeyId:auth.billing.apiKeyId,routeKeyId:auth.key.apiKeyId,requests:[]};
  const save=()=>fs.writeFileSync(filename,JSON.stringify(audit,null,2)+'\n');
  let active={caseId:'unset',arm:'unset',phase:'unset'};
  fs.mkdirSync(directory,{recursive:true});save();
  const transport=async (url,init) => {
    if(audit.requests.length>=40)throw Error('Live evaluation request cap reached');
    let bytes=Buffer.from(init.body),encoding=new Headers(init.headers).get('content-encoding');
    if(encoding==='zstd')bytes=zlib.zstdDecompressSync(bytes);
    if(encoding==='gzip')bytes=zlib.gunzipSync(bytes);
    const payload=JSON.parse(bytes);
    const row={...active,ordinal:audit.requests.length+1,startedAt:new Date().toISOString(),inputBytes:bytes.length,payloadHash:hash(bytes),model:payload.model};
    const correlation=`${prefix}:${row.ordinal}`;
    row.interactionId=correlation;
    const headers=new Headers(init.headers);
    headers.set('Authorization',`Bearer ${auth.key.apiKey}`);
    headers.set('X-Haolo-Conversation-ID',`${prefix}:${active.caseId}:${active.arm}`);
    headers.set('X-Haolo-Interaction-ID',correlation);
    headers.set('X-Haolo-Source-Type','haolo_context_ab');
    audit.requests.push(row); save();
    // Synthetic requests only; credentials are never persisted.
    fs.writeFileSync(path.join(directory,`request-${row.ordinal}.json`),JSON.stringify(payload));
    console.log(JSON.stringify({event:'request',...active,ordinal:row.ordinal,inputBytes:bytes.length}));
    const start=performance.now();
    let response;
    try {response=await fetch(url,{...init,headers});}
    catch(e){row.error=e.name;row.elapsedMs=performance.now()-start;save();throw e;}
    row.httpStatus=response.status; row.requestId=response.headers.get('x-request-id');row.clientRequestId=response.headers.get('x-client-request-id');
    row.billingContract=response.headers.get('x-haolo-recovery-billing');
    let pending='';const decoder=new TextDecoder();
    const stream=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
      pending+=decoder.decode(chunk,{stream:true});let end;
      while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);
        const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
        try {const e=JSON.parse(data);if(e.type==='response.output_text.delta'&&e.delta&&row.firstTextMs==null)row.firstTextMs=performance.now()-start;
          if(e.type==='response.completed'){row.usage=e.response?.usage;row.responseId=e.response?.id;row.output=e.response?.output;row.responseStatus=e.response?.status;}
          if(e.type==='response.failed'||e.error){row.modelError=e.response?.error?.code||e.error?.code||e.type;}
        }catch{}
      }controller.enqueue(chunk);
    },flush(){row.elapsedMs=performance.now()-start;row.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({event:'finished',ordinal:row.ordinal,status:row.httpStatus,usage:row.usage,error:row.modelError}));}}));
    return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
  return {audit,save,setActive:value=>{active=value;},auth,transport};
}
export async function relayFor(audit,optimized) {
  const relay=new ModelRequestRelay({upstreamBaseUrl:audit.auth.key.baseUrl,fetch:audit.transport,
    managedAnalysis:true,deepSeekBilling:{keyId:audit.auth.billing.apiKeyId},contextProjectionEnabled:optimized});
  await relay.start();return relay;
}
export async function respond(relay,payload) {
  const r=await fetch(`${relay.localBaseUrl()}/responses`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(300000)});
  const raw=await r.text();if(!r.ok)throw Error(`Model HTTP ${r.status}`);
  let complete, failure;
  for(const line of raw.split('\n'))if(line.startsWith('data:')){try {const e=JSON.parse(line.slice(5));if(e.type==='response.completed')complete=e.response;if(e.type==='response.failed')failure=e.response?.error?.code||'model_failed';}catch{}}
  if(!complete||failure)throw Error(failure||'Missing completed response; not retried');
  const text=(complete.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
  if(!text)throw Error('Missing final model answer');
  return {text,output:complete.output,usage:complete.usage};
}
export function parseAnswer(text){try{return JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{return null;}}

export function makeCase(id) {
  const market=id===0?'BINANCE:SPOT:ETHUSDT':'BINANCE:FUTURES:BTCUSDT', interval=id===0?'15m':'1h';
  const trigger=id===0?1832.45:83113.27, invalidation=id===0?1810.75:82731.19;
  const target=id===0?1860.5:83971.41,oldTrigger=id===0?1820:82900;
  const observation='2026-10-25T01:00:00Z', expiresAt='2026-10-25T04:00:00Z', conditionId=`cond-${id}-v2`;
  const anchors=`权威更新：市场=${market}，分析周期=${interval}，触发价=${trigger}，结构失效价=${invalidation}，目标价=${target}；观察时间=${observation}；有效至=${expiresAt}。当前 close 尚未触发，必须等待已收盘K线高于触发价；禁止因盘中刺破即入场。条件标识=${conditionId}。账户权益、实际持仓和现有保护单均未读取，仓位数量不可计算。没有新闻、资金费率、持仓量或爆仓证据。用户只授权分析，没有授权下单或启动预警。`;
  const report=Array.from({length:45},(_,i)=>`观察 ${i+1}: 仅为离线固定样本，价格围绕阻力震荡，成交量相对上一完整周期为 ${(1+(i%11)/10).toFixed(1)}；这不是新触发或账户证据。`).join('\n')+'\n'+anchors;
  const evidence={analysisRef:`analysis-${id}-v2`,answerRequired:true,result:analysisEvidence({cloudReports:[{marketId:market,interval,strategyId:'price-action',report}],marketId:market,interval}),
    account:{status:'unavailable',positions:null,protectiveOrders:null},conditionId,expiresAt};
  const initial=`仅使用本次已读证据。返回 JSON: {market,interval,trigger,invalidation,target,observation,expiresAt,conditionId,action,quantity,newsEvidence,orderPlaced,reasoning}。action 只能是 WAIT/CANCEL/ENTER；quantity 未知填 null，newsEvidence/orderPlaced 用布尔值。reasoning 用中文解释确认条件、已有仓位未知和触发失效之间的区别，不要把待入场当作持仓安全。`;
  const input=[{role:'user',content:`任务约束：只分析，不下单、不启动预警，不得猜测持仓。最初参数 trigger=${oldTrigger} 已作废。`},
    {type:'function_call',call_id:`evidence-${id}`,name:'read_evidence',arguments:'{}'},
    {type:'function_call_output',call_id:`evidence-${id}`,output:JSON.stringify(evidence)},
    {role:'user',content:initial}];
  const expected={market,interval,trigger,invalidation,target,observation,expiresAt,conditionId,action:'WAIT',quantity:null,newsEvidence:false,orderPlaced:false};
  const correction=id===0?1807.65:82681.23;
  const followup=`继续同一任务：唯一修改是结构失效价改为 ${correction}，并撤销此前的条件观察计划。请返回相同 JSON 字段并解释：原有市场周期、触发价、目标、时间、ID 和权限保持，action 应反映我刚才的撤销。不要把未知的持仓当作零持仓。`;
  return {input,expected,followup,followupExpected:{...expected,invalidation:correction,action:'CANCEL'}};
}
export function check(text,expected) {
  const value=parseAnswer(text), failures=[];
  if(!value)return {pass:false,failures:['invalid JSON'],value:null};
  for(const [key,want] of Object.entries(expected))if(value[key]!==want)failures.push({key,want,actual:value[key]});
  if(typeof value.reasoning!=='string'||value.reasoning.length<30)failures.push('missing substantive explanation');
  return {pass:!failures.length,failures,value};
}
async function main(){
  if(!process.argv.includes('--run'))throw Error('Explicit --run is required: uses real billed model');
  const prefix=`ctx-ab-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,8)}`;
  const directory=path.join(root,'output','context-model-ab-20261025',prefix);
  const audit=createAudit(directory,prefix), results=[];
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({prefix,kind:'projection',model:'deepseek-flash',effort:'low',ordering:'AB then BA',expectedRequests:16,syntheticEvidence:true},null,2));
  console.log(JSON.stringify({event:'started',directory,prefix}));
  for(let repeat=0;repeat<2;repeat++)for(let c=0;c<2;c++)for(const optimized of repeat===0?[false,true]:[true,false]){
    const test=makeCase(c),arm=optimized?'optimized':'baseline',caseId=`facts-${c}-r${repeat}`;
    const relay=await relayFor(audit,optimized);
    try{
      const payload={model:'deepseek-flash',reasoning:{effort:'low'},stream:true,store:false,max_output_tokens:4096,
        prompt_cache_key:`${prefix}:${caseId}:${arm}`,instructions:'Evaluate the supplied synthetic evidence faithfully. Never invent missing observations. Answer only the requested JSON object, with a substantive reasoning field.',input:test.input};
      audit.setActive({caseId,arm,phase:'initial'});
      const first=await respond(relay,payload);results.push({caseId,arm,phase:'initial',text:first.text,check:check(first.text,test.expected)});
      fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
      audit.setActive({caseId,arm,phase:'followup'});
      const next=await respond(relay,{...payload,input:[...test.input,...first.output,{role:'user',content:test.followup}]});
      results.push({caseId,arm,phase:'followup',text:next.text,check:check(next.text,test.followupExpected)});
      fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
    }finally{await relay.stop();}
  }
  const summary={prefix,requests:audit.audit.requests.length,checks:results.length,passed:results.filter(r=>r.check.pass).length,failed:results.filter(r=>!r.check.pass),directory};
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({event:'complete',...summary}));
  if(summary.failed.length)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({fatal:e.message}));process.exitCode=1;});
