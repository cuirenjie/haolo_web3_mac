import {cloudPlanCard,normalizeCloudReports,type CloudTradingReport} from '../main/cloud-plan-contract.mjs';
import {createSavedExecutionPlan,type SavedExecutionPlan} from './execution-plans.ts';
import {isGeneratedPlanRecord} from './saved-plan-source.ts';
import {cloudPlanSyncFailurePolicy} from '../main/cloud-plan-sync-policy.mjs';

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
    const sourceThreadId=local.sourceThreadId && !isGeneratedPlanRecord(local.sourceMessageId) && !local.sourceThreadId.startsWith('cloud-run:')
      ? local.sourceThreadId : report.origin?.sourceThreadId || local.sourceThreadId;
    return {...local,sourceThreadId,...(sourceThreadId.startsWith('cloud-task:') ? {sourceMessageId:report.runId} : {}),title:card.title,content:card.content,cloudReport:report,linkedAlertId:remote.linkedAlertId,status:remote.status,endReason:remote.endReason||null,
      statusUpdatedAt:new Date(remote.statusUpdatedAt||remote.activatedAt||createdAt).toISOString()} as SavedExecutionPlan;
  });
  return [...cloud,...previous.filter(plan=>!plan.cloudReport)];
}

export function createCloudPlanRefresher(options:{scope:()=>string|null;load:()=>Promise<any>;read:()=>readonly SavedExecutionPlan[];
  apply:(plans:SavedExecutionPlan[])=>void;save:(scope:string,plans:SavedExecutionPlan[])=>boolean;changed:()=>void;
  cacheFailure:()=>void;failure:(error:unknown)=>void;diagnostic?:(error:Record<string,unknown>)=>void;random?:()=>number;
  schedule?:(run:()=>void,delay:number)=>ReturnType<typeof setTimeout>;cancel?:(timer:ReturnType<typeof setTimeout>)=>void}) {
  type Refresh={scope:string;pending:boolean;failures:number;timer:ReturnType<typeof setTimeout>|null};
  const schedule=options.schedule||setTimeout,cancel=options.cancel||clearTimeout;
  let current:Refresh|null=null;
  const reset=()=>{if(current?.timer!=null)cancel(current.timer);current=null;};
  const isCurrent=(request:Refresh)=>current===request&&request.scope===options.scope();
  const refresh=async()=>{
    const scope=options.scope();if(!scope){reset();return;}
    if(current?.scope!==scope){reset();current={scope,pending:false,failures:0,timer:null};}
    const request=current;
    // Session/profile updates must not bypass backoff or duplicate a GET.
    if(request.pending||request.timer!==null)return;
    request.pending=true;
    try {
      const response=await options.load();if(!isCurrent(request))return;
      if(!response?.ok)throw Object.assign(new Error(response?.error?.message||'CLOUD_PLAN_LIST_UNAVAILABLE'),response?.error);
      const plans=mergeCloudExecutionPlans(response.reports,options.read());
      options.apply(plans);
      if(!options.save(scope,plans))options.cacheFailure();
      request.failures=0;
      options.changed();
    } catch(error) {
      if(!isCurrent(request))return;
      const policy=cloudPlanSyncFailurePolicy(error);
      const detail=error as {diagnosticId?:string;name?:string;message?:string;stack?:string};
      // Main-process failures already have a durable diagnostic. Record local
      // IPC/merge exceptions as well, without sending reports or account data.
      if(!detail?.diagnosticId)try {
        options.diagnostic?.({name:detail?.name,message:detail?.message||String(error),stack:detail?.stack,
          code:policy.code,status:policy.status});
      } catch { /* Diagnostics must not prevent retrying a read. */ }
      if(policy.retryable) {
        const base=Math.min(60_000,2000*2**Math.min(request.failures++,5));
        const delay=Math.max(policy.retryAfterMs,Math.min(60_000,Math.round(base*(1+0.2*(options.random||Math.random)()))));
        request.timer=schedule(()=>{
          request.timer=null;
          if(isCurrent(request))void refresh();
          else if(current===request)reset();
        },delay);
      } else if(!policy.silent)options.failure(error);
    } finally {request.pending=false;}
  };
  return Object.assign(refresh,{reset});
}

export function cloudPlanSyncMessage(kind:'cache'|'failed',language:string,detail='') {
  const index=language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0;
  const words={cache:['已读取云端计划，本机缓存写入失败。','Cloud plans loaded; the local cache could not be saved.','已讀取雲端計畫，本機快取寫入失敗。'],
    failed:['云端计划同步失败','Cloud plan synchronization failed','雲端計畫同步失敗']};
  return words[kind][index]+(detail?`: ${detail}`:'');
}
