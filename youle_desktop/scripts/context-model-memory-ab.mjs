// Opt-in real-model audit of current-thread exclusion from group background.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,createAudit,relayFor,respond,makeCase,check} from './context-model-ab.mjs';
import {excludeCurrentThreadMemory} from '../src/main/group-memory-context.mjs';

async function main(){
  if(!process.argv.includes('--run'))throw Error('Explicit --run required: real billed model');
  const prefix=`ctx-ab-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,8)}`;
  const directory=path.join(root,'output/context-model-ab-20261025',prefix),audit=createAudit(directory,prefix),results=[];
  const current='15ce6460-8038-4f6f-929c-bb3efac20c3f',other='ebba88af-67c9-4e3b-bf19-67e2aa6cc951';
  const files=[`rollout-2026-10-25-${current}.jsonl`,`rollout-2026-10-25-${other}.jsonl`];
  const duplicate=Array.from({length:45},(_,i)=>`历史复核 ${i+1}：只分析，不下单、不启动预警，不得猜测持仓。最初 trigger=1820 已作废，请等待新证据更新。`).join('\n');
  const background=new Map([[files[0],`当前任务历史片段：${duplicate}`],[files[1],'其他任务的待办编号是 D-741。仅保留此编号，不引入该任务的市场或价格。']]);
  const histories=[{role:'user',content:duplicate},{role:'assistant',content:'保留历史供追溯，以之后的证据及更正为准。'}];
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({prefix,kind:'group-memory-exclusion',model:'deepseek-flash',effort:'low',syntheticEvidence:true,expectedRequests:4,currentThreadId:current,files,retainedFiles:excludeCurrentThreadMemory(files,current)},null,2));
  console.log(JSON.stringify({event:'started',directory}));
  for(const optimized of [false,true]){
    const arm=optimized?'optimized':'baseline',test=makeCase(0),relay=await relayFor(audit,optimized);
    const retained=optimized?excludeCurrentThreadMemory(files,current):files;
    const backgroundText=retained.map(f=>background.get(f)).join('\n');
    const input=[...histories,...test.input,{role:'user',content:'上述 JSON 还需加入 otherTaskMarker，填写同组其他任务的待办编号。'}];
    const payload={model:'deepseek-flash',reasoning:{effort:'low'},stream:true,store:false,max_output_tokens:4096,
      prompt_cache_key:`${prefix}:${arm}`,instructions:`Evaluate frozen synthetic evidence faithfully. Background fragments are historical context; newer explicit corrections win.\n${backgroundText}`,input};
    try{
      audit.setActive({caseId:'group-memory',arm,phase:'initial'});
      const first=await respond(relay,payload);
      results.push({arm,phase:'initial',text:first.text,check:check(first.text,{...test.expected,otherTaskMarker:'D-741'})});
      fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
      audit.setActive({caseId:'group-memory',arm,phase:'followup'});
      const next=await respond(relay,{...payload,input:[...input,...first.output,{role:'user',content:test.followup+' 保留 otherTaskMarker 字段。'}]});
      results.push({arm,phase:'followup',text:next.text,check:check(next.text,{...test.followupExpected,otherTaskMarker:'D-741'})});
      fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
    }finally{await relay.stop();}
  }
  const summary={prefix,requests:audit.audit.requests.length,checks:results.length,passed:results.filter(r=>r.check.pass).length,failed:results.filter(r=>!r.check.pass),directory};
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({event:'complete',...summary}));
  if(summary.failed.length)process.exitCode=1;
}
main().catch(e=>{console.error(JSON.stringify({fatal:e.message}));process.exitCode=1;});
