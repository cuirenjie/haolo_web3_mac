import {cloudPlanCard,normalizeCloudReports,type CloudTradingReport} from '../main/cloud-plan-contract.mjs';
import {createSavedExecutionPlan,type SavedExecutionPlan} from './execution-plans.ts';

export function mergeCloudExecutionPlans(values:unknown,previous:readonly SavedExecutionPlan[]):SavedExecutionPlan[] {
  if(!Array.isArray(values)||values.length>5000)throw new Error('CLOUD_PLAN_LIST_INVALID');
  const reports:CloudTradingReport[]=values.flatMap(report=>normalizeCloudReports([report])),seen=new Set<string>();
  const cloud=reports.map(incoming=>{
    const remote=incoming.planRecords[0],card=cloudPlanCard(incoming);
    if(!remote||!card||seen.has(remote.id)||!['pending','executing','ended'].includes(remote.status))throw new Error('CLOUD_PLAN_LIST_INVALID');
    seen.add(remote.id);
    const existing=previous.find(plan=>plan.id===remote.id);
    const report={...incoming,origin:incoming.origin||existing?.cloudReport?.origin||null};
    const createdAt=remote.createdAt||new Date(incoming.executionPlan.createdAt).toISOString();
    const local=existing||createSavedExecutionPlan({candidate:{...card,cloudReport:report},createdAt,
      sourceThreadId:report.origin?.sourceThreadId||`cloud-run:${report.runId}`,sourceMessageId:`cloud-report:${report.runId}`,sourceTitle:card.title});
    return {...local,title:card.title,content:card.content,cloudReport:report,linkedAlertId:remote.linkedAlertId,status:remote.status,endReason:remote.endReason||null,
      statusUpdatedAt:new Date(remote.statusUpdatedAt||remote.activatedAt||createdAt).toISOString()} as SavedExecutionPlan;
  });
  return [...cloud,...previous.filter(plan=>!plan.cloudReport)];
}

export function createCloudPlanRefresher(options:{scope:()=>string|null;load:()=>Promise<any>;read:()=>readonly SavedExecutionPlan[];
  apply:(plans:SavedExecutionPlan[])=>void;save:(scope:string,plans:SavedExecutionPlan[])=>boolean;changed:()=>void;
  cacheFailure:()=>void;failure:(error:unknown)=>void}) {
  const pending=new Set<string>();
  return async()=>{
    const scope=options.scope();if(!scope||pending.has(scope))return;pending.add(scope);
    try {
      const response=await options.load();if(scope!==options.scope())return;
      if(!response?.ok)throw new Error(response?.error?.message||'CLOUD_PLAN_LIST_UNAVAILABLE');
      const plans=mergeCloudExecutionPlans(response.reports,options.read());
      options.apply(plans);
      if(!options.save(scope,plans))options.cacheFailure();
      options.changed();
    } catch(error) {if(scope===options.scope())options.failure(error);}
    finally {pending.delete(scope);}
  };
}

export function cloudPlanSyncMessage(kind:'cache'|'failed',language:string,detail='') {
  const index=language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0;
  const words={cache:['已读取云端计划，本机缓存写入失败。','Cloud plans loaded; the local cache could not be saved.','已讀取雲端計畫，本機快取寫入失敗。'],
    failed:['云端计划同步失败','Cloud plan synchronization failed','雲端計畫同步失敗']};
  return words[kind][index]+(detail?`: ${detail}`:'');
}
