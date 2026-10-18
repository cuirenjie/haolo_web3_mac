import {cloudReportFromResponse,type CloudTradingReport} from '../main/cloud-plan-contract.mjs';

type Item={__youleCloudReports?:CloudTradingReport[];[key:string]:any};
export function createCloudReportRestorer(options:{scope:()=>string;resolve:(id:string)=>string;
  read:(id:string)=>Promise<Item[]>;upsert:(id:string,item:Item)=>void;persist:(id:string,report:CloudTradingReport)=>Promise<string>;
  restoreDrawings:(report:CloudTradingReport,storage:string)=>void;refresh:(id:string)=>void}) {
  return async(result:unknown,_key:string,isCurrent:()=>boolean)=>{
    const report=cloudReportFromResponse(result)[0];
    if(!report?.origin?.sourceThreadId||!report.origin.storageSessionId)return false;
    const scope=options.scope(),current=()=>isCurrent()&&scope===options.scope();
    let threadId=options.resolve(report.origin.sourceThreadId);
    if(!current())return false;
    const items=await options.read(threadId);if(!current())return false;
    const existing=items.find(item=>item.__youleCloudReports?.some(r=>r.runId===report.runId));
    if(existing) {
      if(existing.__youleCloudReports?.find(r=>r.runId===report.runId)?.resultHash!==report.resultHash)throw new Error('CLOUD_RESULT_CONTEXT_INVALID');
      options.upsert(threadId,existing);
    } else {
      threadId=await options.persist(threadId,report);if(!current())return false;
    }
    const storage=report.origin.storageSessionId===report.origin.sourceThreadId?threadId:report.origin.storageSessionId;
    options.restoreDrawings(report,storage);options.refresh(threadId);return current();
  };
}
