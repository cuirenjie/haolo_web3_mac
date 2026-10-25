import {cloudTaskHistory} from './cloud-task-history.mjs';
import {cloudStrategyFailure} from './cloud-error.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const terminal = run => ['succeeded','failed','cancelled'].includes(run.state);
const fail = code => { throw Object.assign(new Error(code),{code}); };
const models = new Set(['deepseek-flash','gpt-5.6-sol','gpt-6-sol','gpt-6-astra']);

// A new run is a round within the existing task, never a replacement task.
// Persist admission before POST so a lost response/restart reuses the same key.
export function createCloudTaskChat({owner,api,journal}) {
  const locks = new Set();
  return {async perform(action,input={}) {
    const captured = await owner(), taskId = input.taskId;
    if (!uuid.test(taskId || '')) fail('CLOUD_TASK_HISTORY_INVALID');
    const check = async () => {
      const current = await owner();
      if (current.ownerId !== captured.ownerId || current.baseUrl !== captured.baseUrl) fail('TRADING_PREFERENCE_OWNER_CHANGED');
    };
    const request = async (op,payload,key) => {
      await check();
      const result = await api().tradingCloudRequest(op,payload,{expectedAccountId:captured.accountId,
        expectedBaseUrl:captured.baseUrl,...(key ? {idempotencyKey:key} : {})});
      await check(); return result;
    };
    const readTask = async () => {
      const task = await request('task',{taskId});
      if (task.id !== taskId) fail('CLOUD_TASK_HISTORY_INVALID');
      cloudTaskHistory(task); // Validate every round before accepting history.
      return task;
    };
    const snapshot = (task,record) => {
      const latest = task.runs.at(-1);
      const failure = latest?.state === 'failed' ? {runId:latest.id,...cloudStrategyFailure({code:
        typeof latest.error === 'string' ? latest.error : latest.error?.code || 'CLOUD_TASK_REPLY_FAILED'},
        {language:latest.locale || 'zh-CN'})} : null;
      return {...cloudTaskHistory(task),failure,activeRunIds:task.runs.filter(run => !terminal(run)).map(run => run.id),
        pending:record && !record.runId && !record.acknowledged
          ? {requestId:record.requestId,prompt:record.body.prompt} : null};
    };
    const read = async () => {
      const task = await readTask(), record = await journal().get(captured.ownerId,taskId);
      await check();
      const accepted = record?.runId && task.runs.find(run => run.id === record.runId);
      if (accepted && terminal(accepted) && !record.acknowledged) {
        await journal().put(captured.ownerId,taskId,{...record,acknowledged:true});
      }
      return snapshot(task,record);
    };
    if (action === 'read') return read();
    if (!['send','cancel'].includes(action)) fail('CLOUD_PLAN_ACTION_INVALID');
    const lock = `${captured.ownerId}:${taskId}`;
    if (locks.has(lock)) fail('CLOUD_TASK_BUSY');
    locks.add(lock);
    try {
      const task = await readTask();
      const running = task.runs.filter(run => !terminal(run));
      if (action === 'cancel') {
        for (const run of running) await request('cancelRun',{runId:run.id},`chat-stop:${run.id}`);
        return read();
      }
      const prompt = String(input.prompt || '').trim();
      if (!prompt || prompt.length > 8000 || !uuid.test(input.requestId || '')) fail('CLOUD_TASK_MESSAGE_INVALID');
      let record = await journal().get(captured.ownerId,taskId);
      await check();
      if (record?.requestId === input.requestId) {
        if (record.body.prompt !== prompt) fail('CLOUD_TASK_SUBMISSION_UNCERTAIN');
        if (record.runId) return read();
      } else {
        if (record && !record.acknowledged && !record.runId) fail('CLOUD_TASK_SUBMISSION_UNCERTAIN');
        if (running.length) fail('CLOUD_TASK_BUSY');
        if (input.modelId && !models.has(input.modelId)) fail('MODEL_SELECTION_INVALID');
        const locale = input.locale === 'ja' ? 'ja' : input.locale === 'ko' ? 'ko' : input.locale === 'en' ? 'en' : /zh-(TW|Hant)/.test(input.locale || '') ? 'zh-Hant' : 'zh-CN';
        let context = {...task.context,taskId};
        // Index assistant admission requires a current, owned market snapshot.
        if (context.marketKey.startsWith('index:')) {
          const snapshot = await request('marketSnapshot',{market:context.marketKey,interval:context.interval,limit:500});
          context = {...context,snapshotId:snapshot.snapshotId};
        }
        record = {requestId:input.requestId,body:{context,prompt,locale,attachmentIds:[],
          ...(input.modelId ? {modelId:input.modelId} : {})},acknowledged:false};
        await journal().put(captured.ownerId,taskId,record);
      }
      let run;
      try {
        run = await request('createAssistantRun',record.body,`chat:${taskId}:${record.requestId}`);
      } catch (error) {
        // Explicit validation/access rejection did not accept a paid round.
        if ([400,401,402,403,404,409,422].includes(error.status)) {
          await journal().put(captured.ownerId,taskId,{...record,acknowledged:true});
        }
        throw error;
      }
      if (!uuid.test(run.id || '') || run.context?.taskId !== taskId || run.strategy !== 'assistant'
        || run.prompt !== record.body.prompt) fail('CLOUD_TASK_HISTORY_INVALID');
      record = {...record,runId:run.id,acknowledged:terminal(run)};
      await journal().put(captured.ownerId,taskId,record);
      await check();
      // The POST receipt already confirms admission. A second GET failing here
      // must not turn an accepted message into a failed send with a retry draft.
      // Keep the complete verified history and append/update this server round;
      // normal polling then reads its progress from the same task.
      const existing = task.runs.some(item => item.id === run.id);
      return snapshot({...task,updatedAt:run.updatedAt || run.createdAt || task.updatedAt,
        runs:existing ? task.runs.map(item => item.id === run.id ? run : item) : [...task.runs,run]},record);
    } finally { locks.delete(lock); }
  }};
}
