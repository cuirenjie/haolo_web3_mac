import {cloudReportFromResponse} from '../cloud-plan-contract.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const cloudTaskThreadId = id => uuid.test(id || '') ? `cloud-task:${id}` : '';

// This is the existing server task, including every stored round. It never
// starts a local thread or manufactures messages from a saved plan snapshot.
export function cloudTaskHistory(task, expectedRunId) {
  const id = cloudTaskThreadId(task?.id);
  if (!id || !Array.isArray(task.runs) || task.context?.taskId !== task.id
    || expectedRunId && !task.runs.some(run => run.id === expectedRunId)) throw new Error('CLOUD_TASK_HISTORY_INVALID');
  const items = [], seen = new Set();
  for (const run of task.runs) {
    if (!uuid.test(run.id || '') || seen.has(run.id) || run.context?.taskId !== task.id) throw new Error('CLOUD_TASK_HISTORY_INVALID');
    seen.add(run.id);
    const createdAt = run.createdAt;
    if (typeof run.prompt === 'string' && run.prompt.trim()) {
      items.push({id:`cloud-task-user:${run.id}`,type:'userMessage',text:run.prompt,content:[{text:run.prompt}],createdAt});
    }
    const reports = run.desktopResult ? cloudReportFromResponse({...run.desktopResult,
      cloud:{...run.desktopResult.cloud,probabilitySupplement:run.probabilitySupplement}}).map(report => ({...report,
      origin:{sourceThreadId:id,storageSessionId:id,analysisJobId:''}})) : [];
    if (reports.some(report => report.runId !== run.id)) throw new Error('CLOUD_TASK_HISTORY_INVALID');
    if (typeof run.text === 'string' && run.text.trim() || reports.length) {
      items.push({id:run.id,type:'agentMessage',phase:'final_answer',text:run.text || reports[0].report,
        __youleNativeResponseComplete:['succeeded','failed','cancelled'].includes(run.state),
        __youleExecutionPlanPresentation:reports.length ? 'execution-plan' : 'plain',
        createdAt:run.completedAt ? new Date(run.completedAt).toISOString() : createdAt,
        ...(reports.length ? {__youleCloudReports:reports,__youleExecutionPlanPresentation:'execution-plan'} : {})});
    }
  }
  return {threadId:id,taskId:task.id,title:task.title,createdAt:task.createdAt,updatedAt:task.updatedAt,items};
}
