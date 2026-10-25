// Real bundled app-server + real billed model. Frozen synthetic history only.
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {createAudit,relayFor,root,parseAnswer} from './context-model-ab.mjs';
import {buildManagedLongContextModelCatalog} from '../src/main/app-server-client.mjs';
import {requestWithThreadHistoryRecovery} from '../src/main/thread-history-recovery.mjs';
// Rejected experiment is opt-in; the normal run uses the actual retained catalog.
const rejectedEarlyPolicy=process.argv.includes('--rejected-early-policy');
const candidateThreshold=rejectedEarlyPolicy?128000:undefined;

const runtime=path.join(root,'youle_desktop/resources/bin/haolo_ai.exe');
const state={market:'BINANCE:FUTURES:ETHUSDT',analysisInterval:'1h',confirmationInterval:'15m',snapshotId:'snapshot-B-928',conditionId:'cond-C-413',revision:3,
  trigger:1855.7,invalidation:1831.2,target:1897.3,actualPositionDirection:'SHORT',actualEntry:1902.6,protectiveOrders:'unknown',quantity:null,
  authorization:'analysis_only',pending:'verify_protective_orders',locale:'zh-Hant',expiresAt:'2026-10-25T06:30:00Z',action:'WAIT',artifactId:'frozen-20261025'};
const initial={...state,market:'BINANCE:SPOT:BTCUSDT',confirmationInterval:'1h',snapshotId:'snapshot-A-184',revision:1,invalidation:1820};
const userText='只做分析审计，禁止下单或创建预警。下面历史的 archiveObservations 是已经完成的辅助核对材料，之后发生的状态更新才决定当前状态。完整保留当前任务的关键字段，未知数据保持未知；已有仓位与候选入场计划是两件事。';
const history=[{type:'message',role:'user',content:[{type:'input_text',text:userText}]}];
for(let chunk=0;chunk<8;chunk++){
  const rows=Array.from({length:375},(_,j)=>{const i=chunk*375+j;return `row=${String(i).padStart(6,'0')}; t=${1792872300000+i*60000}; open=${84000+i%317}.11; high=${84007+i%317}.22; low=${83992+i%317}.33; close=${84003+i%317}.44; vol=${101+i%71}.987; state=closed; archiveOnly=true.`;}).join('\n');
  const facts=chunk===0?initial:chunk===3?state:chunk===7?{confirmedCurrentState:state,missingEvidence:'No news or account equity was read; never infer no position.'}:null;
  history.push({type:'message',role:'user',content:[{type:'input_text',text:`保存核对批次 ${chunk+1}。${chunk===3?'本次明确更正市场和确认周期，替代之前版本。':chunk===7?'最后核对当前未完成事项，不执行任何交易动作。':'历史档案仅供追溯。'}`}]},
    {type:'function_call',call_id:`frozen-${chunk}`,name:'read_frozen_evidence',arguments:JSON.stringify({batch:chunk+1})},
    {type:'function_call_output',call_id:`frozen-${chunk}`,output:JSON.stringify({batch:chunk+1,archiveObservations:rows,...(facts?{taskState:facts}:{})})},
    {type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:`批次 ${chunk+1} 已核对。保留已确认状态和原始证据。`} ]});
}
const fields=Object.keys(state).join(',');
const question=`请根据已保存的任务状态返回 JSON，字段为 ${fields}, reasoning。未知数量填 null，不得虚构数据或执行操作。reasoning 使用繁体中文解释当前待确认条件、已有仓位和保护单缺口，不少于 50 字。只输出 JSON。`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function startClient(home,cwd,relay,threshold,events){
  const catalog=buildManagedLongContextModelCatalog(execFileSync(runtime,['debug','models','--bundled'],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}));
  if(threshold!==undefined)for(const m of catalog.models)if(m.slug==='deepseek-flash')m.auto_compact_token_limit=threshold;
  fs.mkdirSync(home,{recursive:true});fs.mkdirSync(cwd,{recursive:true});
  const catalogPath=path.join(home,'catalog.json');fs.writeFileSync(catalogPath,JSON.stringify(catalog));
  const settings=['model="deepseek-flash"','model_provider="fixture"','model_reasoning_effort="low"',`model_catalog_json=${JSON.stringify(catalogPath)}`,
    'features.remote_plugin=false','features.plugins=false','features.apps=false',
    'model_providers.fixture.name="Context quality audit"',`model_providers.fixture.base_url=${JSON.stringify(relay.localBaseUrl())}`,
    'model_providers.fixture.wire_api="responses"','model_providers.fixture.requires_openai_auth=false','model_providers.fixture.supports_websockets=false',
    'model_providers.fixture.request_max_retries=0','model_providers.fixture.stream_max_retries=0'];
  const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','COMSPEC','PATHEXT'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  env.CODEX_HOME=home;env.USERPROFILE=path.dirname(home);
  const child=spawn(runtime,[...settings.flatMap(s=>['-c',s]),'app-server','--stdio'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map(),completed=new Map();let nextId=0,stderr='';
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
    if(m.method){events.push(m);if(m.method==='turn/completed')completed.set(m.params.turn.id,m.params.turn);}
    const slot=pending.get(m.id);if(!slot)return;clearTimeout(slot.timer);pending.delete(m.id);m.error?slot.reject(Error(m.error.message)):slot.resolve(m.result);
  });
  const raw=(method,params)=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out`));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  const rpc=(method,params)=>requestWithThreadHistoryRecovery({request:raw,method,params,codexHome:home});
  const stop=async()=>{for(const p of pending.values())clearTimeout(p.timer);pending.clear();if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}lines.close();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();};
  await raw('initialize',{clientInfo:{name:'haolo_context_quality_audit',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  return {rpc,stop,async turn(threadId,text){const first=events.length;const r=await rpc('turn/start',{threadId,model:'deepseek-flash',effort:'low',input:[{type:'text',text,textElements:[]}]});
    const until=Date.now()+600000;while(!completed.has(r.turn.id)){if(Date.now()>until)throw Error('Real model turn timeout; not replayed');await pause(250);}
    const terminal=completed.get(r.turn.id);if(terminal.status!=='completed')throw Error(`Turn ${terminal.status}: ${JSON.stringify(terminal.error||{})}`);
    const messages=events.slice(first).filter(e=>e.method==='item/completed'&&e.params.item?.type==='agentMessage').map(e=>e.params.item.text);
    return messages.at(-1)||'';},getStderr:()=>stderr};
}
async function main(){
  if(!process.argv.includes('--run'))throw Error('Explicit --run required: real paid models');
  const prefix=`ctx-long-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,8)}`;
  const directory=path.join(root,'output/context-model-ab-20261025',prefix),audit=createAudit(directory,prefix),results=[];
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({prefix,kind:'native-long-context',state,historyBytes:JSON.stringify(history).length,baselineThreshold:300000,optimizedThreshold:candidateThreshold??'retained-catalog',rejectedEarlyPolicy,oracleVersion:2,oracleCorrection:'All other fields remain unchanged includes action WAIT. Plan cancellation is assessed separately in the explanation; the previous CANCEL oracle was ambiguous. Historical ID/prices must remain.',syntheticEvidence:true},null,2));
  console.log(JSON.stringify({event:'started',directory,prefix,historyBytes:JSON.stringify(history).length}));
  for(const optimized of [false,true]){
    const arm=optimized?'optimized':'baseline',events=[],relay=await relayFor(audit,optimized),home=path.join(directory,arm,'home'),cwd=path.join(directory,arm,'workspace');
    let client;
    try{
      client=await startClient(home,cwd,relay,optimized?candidateThreshold:300000,events);
      const started=await client.rpc('thread/start',{cwd,approvalPolicy:'never',sandbox:'read-only',ephemeral:false,
        developerInstructions:'This is a frozen synthetic evidence quality audit. Do not call tools, read files, browse, trade, or perform operations. Answer the requested JSON using existing history only. Maintain distinctions between historical records, superseded values, current constraints, missing evidence and actual positions. A context summary must preserve all confirmed task-state fields and unresolved work.'});
      const thread=started.thread;
      for(let i=0;i<history.length;i+=12)await client.rpc('thread/inject_items',{threadId:thread.id,items:history.slice(i,i+12)});
      for(let phase=0;phase<3;phase++){
        audit.setActive({caseId:'native-long',arm,phase:`turn-${phase}`});
        const prompt=phase===0?question:phase===1?`继续原审计任务：唯一修正结构失效价为 1828.35，并撤销候选条件计划。所有其他已确认字段保持。${question}`:`继续核对，不能把历史 revision=1 当作当前版本，也不能把撤销入场计划解释为已平仓。再次返回相同完整 JSON，解释实际保护单仍未知。`;
        const text=await client.turn(thread.id,prompt),value=parseAnswer(text),expected=phase===0?state:{...state,invalidation:1828.35};
        const failures=value?Object.entries(expected).filter(([k,v])=>value[k]!==v).map(([k,v])=>({key:k,want:v,actual:value[k]})):['invalid JSON'];
        if(typeof value?.reasoning!=='string'||value.reasoning.length<50)failures.push('missing substantive explanation');
        if(phase>0&&!/(撤[銷销]|取消)/.test(value?.reasoning||''))failures.push('missing plan cancellation explanation');
        results.push({arm,phase,text,value,pass:!failures.length,failures});
        fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
        console.log(JSON.stringify({event:'quality',arm,phase,pass:!failures.length,failures}));
      }
      const historyText=fs.readFileSync(thread.path,'utf8');
      fs.writeFileSync(path.join(directory,`${arm}-events.json`),JSON.stringify(events,null,2));
      const compactEvents=events.filter(e=>e.method==='item/completed'&&e.params.item?.type==='contextCompaction');
      const integrity={originalArchiveRetained:historyText.includes('row=000000')&&historyText.includes('row=002999'),initialStateRetained:historyText.includes('snapshot-A-184'),latestStateRetained:historyText.includes('snapshot-B-928'),compactions:compactEvents.length};
      fs.writeFileSync(path.join(directory,`${arm}-integrity.json`),JSON.stringify(integrity,null,2));
      if(optimized&&rejectedEarlyPolicy&&compactEvents.length===0)throw Error('Native compaction was not exercised');
      if((!optimized||!rejectedEarlyPolicy)&&compactEvents.length)throw Error('Retained capacity policy unexpectedly compacted');
    }finally{await client?.stop();await relay.stop();}
  }
  const summary={prefix,requests:audit.audit.requests.length,checks:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass),directory};
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({event:'complete',...summary}));
  if(summary.failed.length)process.exitCode=1;
}
main().catch(e=>{console.error(JSON.stringify({fatal:e.message}));process.exitCode=1;});
