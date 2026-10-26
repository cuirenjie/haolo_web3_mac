import {normalizeCloudReports,type CloudTradingReport} from '../main/cloud-plan-contract.mjs';

type Item={id?:string;__youleCloudReports?:CloudTradingReport[];[key:string]:any};
export function createProbabilitySupplementWatcher(options:{
  scope:()=>string|null;
  read:(runId:string,resultHash:string)=>Promise<any>;
  items:(threadId:string)=>Record<string,Item>;
  apply:(threadId:string,item:Item)=>void;
  wait?:(milliseconds:number)=>Promise<void>;
}) {
  const active=new Set<string>();
  const wait=options.wait||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  async function watch(threadId:string,report:CloudTradingReport,scope:string,key:string) {
    let resolved=false;
    const deadline=Date.now()+90000;
    try {
      for(let i=0;i<45&&options.scope()===scope;i++) {
        await wait(2000);
        if(options.scope()!==scope)return;
        if(Date.now()>=deadline)return;
        const matches=()=>Object.values(options.items(threadId)).filter(item=>item.__youleCloudReports?.some(
          r=>r.runId===report.runId&&r.resultHash===report.resultHash));
        if(!matches().length)return;
        try {
          let timer:ReturnType<typeof setTimeout>|undefined;
          const value=await Promise.race([options.read(report.runId,report.resultHash),new Promise<never>((_,reject)=>{
            timer=setTimeout(()=>reject(new Error('Optional read timed out')),Math.min(10000,deadline-Date.now()));
          })]).finally(()=>clearTimeout(timer));
          if(options.scope()!==scope)return;
          if(value.runId!==report.runId||value.resultHash!==report.resultHash)return;
          const supplement=value.supplement;
          if(!supplement||supplement.schemaVersion!==1||supplement.baseResultHash!==report.resultHash)return;
          if(supplement.state==='pending')continue;
          if(!['ready','omitted'].includes(supplement.state))return;
          resolved=true;
          for(const item of matches()) {
            const reports=item.__youleCloudReports!.map(r=>r.runId===report.runId&&r.resultHash===report.resultHash
              ? normalizeCloudReports([{...r,probabilitySupplement:supplement}])[0] : r);
            // Preserve the text, completion flag, message identity and drawing
            // playback state. Only bound optional card data changes.
            options.apply(threadId,{...item,__youleCloudReports:reports});
          }
          return;
        } catch { /* Optional reads never change successful analysis state. */ }
      }
    } finally {
      active.delete(key);
      if(!resolved&&options.scope()===scope) {
        for(const item of Object.values(options.items(threadId))) {
          if(!item.__youleCloudReports?.some(r=>r.runId===report.runId&&r.resultHash===report.resultHash&&r.probabilitySupplement?.state==='pending'))continue;
          const reports=item.__youleCloudReports.map(r=>r.runId===report.runId&&r.resultHash===report.resultHash
            ? {...r,probabilitySupplement:{...r.probabilitySupplement!,state:'omitted' as const}}:r);
          options.apply(threadId,{...item,__youleCloudReports:reports});
        }
      }
    }
  }
  return (threadId:string,item:Item)=>{
    const scope=options.scope();if(!scope)return;
    for(const report of item.__youleCloudReports||[]) {
      if(report.probabilitySupplement?.state!=='pending')continue;
      const key=`${scope}:${threadId}:${report.runId}`;
      if(active.has(key))continue;
      active.add(key);void watch(threadId,report,scope,key);
    }
  };
}
