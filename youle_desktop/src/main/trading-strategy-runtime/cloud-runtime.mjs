import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual} from 'node:util';
import {validateCloudEntryResult} from './cloud-entry-result.mjs';
import {validateCloudRightResult} from './cloud-right-result.mjs';
import {cloudStrategyMinimumHistory} from '../../shared/cloud-strategy-history.mjs';
import {marketRecoveryPolicy,readMarketWhenAvailable} from './market-recovery.mjs';

const intervals = {'1':'1m','3':'3m','5':'5m','15':'15m','30':'30m','60':'1h','120':'2h','240':'4h','360':'6h','480':'8h','720':'12h','1D':'1d','1W':'1w'};
const fail = (code, detail={}) => Object.assign(new Error(code), {code,...detail});
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = new Set(['succeeded','failed','cancelled']);

export function cloudAccountConnection(connections, target) {
  if (!target.marketKey.startsWith('binance:usdm:') || !target.marketKey.endsWith('USDT')) return null;
  // The server projects effective consent for both new and legacy bindings.
  // Keep credentials and compatibility decisions on the server.
  const active = connections.filter(item => item.revoked !== true);
  const authorized = active.find(item => item.analysisConsent === true && item.credentialsBound === true);
  return {id:authorized?.id || null, unavailable:active.length > 0 && !authorized};
}

export function cloudMarketContext(params) {
  const id = String(params.marketId || '');
  const binance = /^BINANCE:(SPOT|FUTURES):([A-Z0-9_\p{Script=Han}]{2,40})$/u.exec(id);
  const ifind = /^IFIND:STOCK:(\d{6}\.(SH|SZ|BJ))$/.exec(id);
  const marketKey = binance ? `binance:${binance[1] === 'FUTURES' ? 'usdm' : 'spot'}:${binance[2]}` : ifind ? `ifind:${ifind[1]}` : null;
  if (!marketKey || !intervals[params.interval]) throw fail('CLOUD_MARKET_UNSUPPORTED');
  return {marketKey, interval:intervals[params.interval]};
}

export function validateCloudResult(run, record) {
  const result = run.desktopResult;
  const context = record.body.context;
  if (run.id !== record.runId || run.clientContract !== 'windows-v1' || run.strategy !== record.body.strategy
    || !isDeepStrictEqual(run.context,context)
    || result?.ok !== true || result.clientContract !== 'windows-v1'
    || result.strategy?.id !== record.body.strategy || result.cloud?.runId !== record.runId
    || !isDeepStrictEqual(result.cloud.context,context)
    || result.cloud.appliedPreferences?.revision !== record.body.preferencesRevision
    || result.cloud.appliedPreferences?.configHash !== record.preferencesHash
    || result.snapshot?.marketId !== record.marketId || result.snapshot?.interval !== record.interval
    || result.analysisPlan?.marketId !== record.marketId || result.analysisPlan?.interval !== record.interval
    || typeof result.analysisPlan.report !== 'string' || result.analysisPlan.report.length > 500000
    || !isDeepStrictEqual(result.analysisPlan.executionPlan,result.executionPlan)) {
    throw fail('CLOUD_RESULT_CONTEXT_INVALID');
  }
  for (const patch of [result.analysisPlan.drawingPatch, result.analysisPlan.indicatorDrawingPatch].filter(Boolean)) {
    if (patch.marketId !== record.marketId || patch.interval !== record.interval
      || (record.body.executionPolicy!=='right-legacy-v1' && patch.analysisId !== result.analysisPlan.analysisId) || !Array.isArray(patch.operations)
      || patch.operations.length > 5000) throw fail('CLOUD_RESULT_CONTEXT_INVALID');
  }
  // Rendering still uses the existing allowlisted chart patch validator.
  if (record.body.executionPolicy==='right-legacy-v1'
    && (run.executionPolicy!=='right-legacy-v1'||run.locale!==record.body.locale||result.cloud.locale!==record.body.locale)) {
    throw fail('CLOUD_RESULT_CONTEXT_INVALID');
  }
  if (record.body.executionPolicy==='entry-v2') validateCloudEntryResult(result,record);
  if (record.body.executionPolicy==='right-legacy-v1') validateCloudRightResult(result,record);
  return {...result,cloud:{...result.cloud,...(record.origin ? {origin:record.origin} : {})}};
}

export function createCloudStrategyRuntime({owner, api, journal, connection, wait=delay, pollMs=1000, timeoutMs=1860000, now=Date.now, random=Math.random}) {
  const active = new Set();
  const assertOwner = async captured => {
    const current = await owner();
    if (current.ownerId !== captured.ownerId || current.baseUrl !== captured.baseUrl) throw fail('TRADING_PREFERENCE_OWNER_CHANGED');
  };
  const request = async (captured, operation, payload={}, options={}) => {
    await assertOwner(captured);
    const response = await api().tradingCloudRequest(operation,payload,{
      ...options,expectedAccountId:captured.accountId,expectedBaseUrl:captured.baseUrl,
    });
    await assertOwner(captured);
    return response;
  };
  async function cancelRecord(captured, record) {
    record.cancelRequested = true;
    await journal.put(captured.ownerId, record.key, record);
    const response = await request(captured,'cancelRun',{runId:record.runId},{idempotencyKey:`cancel:${record.runId}`});
    if (!terminal.has(response.state)) throw fail('CLOUD_CANCEL_PENDING');
    record.state = response.state;
    record.acknowledged = response.state === 'cancelled';
    await journal.put(captured.ownerId, record.key, record);
    return response.state;
  }
  async function readRun(captured, record, {signal,deadline}) {
    let retries = 0;
    while (true) {
      signal?.throwIfAborted();
      await assertOwner(captured);
      if (now() >= deadline) throw fail('CLOUD_RUN_PENDING', {runId:record.runId,retryable:true});
      try {
        return await request(captured,'run',{runId:record.runId},{signal});
      } catch (error) {
        signal?.throwIfAborted();
        await assertOwner(captured);
        // Only retry the read of an already journaled run. A busy status
        // endpoint says nothing about the Worker outcome and must never replay
        // admission, cancel the run, or overwrite its durable state as failed.
        const readPolicy = marketRecoveryPolicy(error);
        if (!readPolicy) throw error;
        const remaining = deadline - now();
        if (remaining <= 0) throw fail('CLOUD_RUN_PENDING', {runId:record.runId,retryable:true});
        const backoff = Math.min(15000, Math.max(1000,pollMs) * 2 ** Math.min(retries++,4));
        const jittered = Math.ceil(backoff * (1 + random() * 0.25));
        const retryAfter = Number(readPolicy.retryAfterMs);
        const retryMs = Math.max(jittered, Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 0);
        if (Number.isFinite(deadline)) await wait(Math.min(retryMs,remaining),undefined,{signal});
        else {
          for (let pending=retryMs;pending>0;) {
            const slice=Math.min(5000,pending);
            await wait(slice,undefined,{signal});
            signal?.throwIfAborted();
            await assertOwner(captured);
            pending-=slice;
          }
        }
      }
    }
  }
  async function poll(captured, record, {signal,onProgress,timeoutMs:pollTimeout=timeoutMs,pureReferenceAnalysis=false,deadline=now()+pollTimeout}={}) {
    let lastProgress = '';
    let marketWaiting = false;
    let observedAt = now();
    let useEvents = pureReferenceAnalysis && typeof api().waitForTradingCloudRunEvent === 'function';
    let eventCursor = 0;
    let eventWait = null;
    const eventController = new AbortController();
    const eventSignal = signal ? AbortSignal.any([signal,eventController.signal]) : eventController.signal;
    try {
      while (true) {
        signal?.throwIfAborted();
        const run = await readRun(captured,record,{signal,deadline:marketWaiting ? Infinity : deadline});
        if (run.id !== record.runId) throw fail('CLOUD_RESULT_CONTEXT_INVALID');
        const observedNow = now();
        // Only an explicit, authenticated server queue state pauses the local
        // execution clock. Progress text alone never extends a task's budget.
        if (marketWaiting) deadline += Math.max(0,observedNow - observedAt);
        observedAt = observedNow;
        const wasMarketWaiting = marketWaiting;
        const recovery = run.marketRecovery;
        marketWaiting = run.state === 'queued' && recovery?.state === 'waiting'
          && Number.isSafeInteger(recovery.retryAt) && recovery.retryAt > 0
          && Number.isSafeInteger(recovery.attempt) && recovery.attempt > 0;
        if (run.state === 'succeeded') {
          const result = validateCloudResult(run,record);
          signal?.throwIfAborted();
          await assertOwner(captured);
          record.state = 'succeeded';
          await journal.put(captured.ownerId,record.key,record);
          return result;
        }
        if (terminal.has(run.state)) {
          record.state = run.state;
          await journal.put(captured.ownerId,record.key,record);
          const errorCode = typeof run.error === 'string' ? run.error : run.error?.code;
          const code = typeof errorCode === 'string' && /^[A-Z][A-Z0-9_]{2,99}$/.test(errorCode)
            ? errorCode : 'CLOUD_ANALYSIS_FAILED';
          throw fail(run.state === 'cancelled' ? 'TRADING_ANALYSIS_CANCELLED' : code, {runId:record.runId});
        }
        const serverProgress = run.progress?.at(-1);
        const progress = marketWaiting ? {stage:'market_waiting'}
          : wasMarketWaiting || serverProgress?.stage === 'market_waiting'
            ? {stage:'market_resuming'} : serverProgress;
        if (progress && fingerprint(progress) !== lastProgress) {
          lastProgress = fingerprint(progress);
          onProgress?.({stage:progress.stage,status:'running'});
        }
        if (marketWaiting) {
          // This is only a status read; the Worker owns retryAt and upstream
          // admission. Keep checks short even when server/client clocks differ.
          const pause = Math.min(5000,Math.max(1000,recovery.retryAt - now()));
          await wait(pause,undefined,{signal});
          continue;
        }
        if (now() >= deadline) throw fail('CLOUD_RUN_PENDING', {runId:record.runId,retryable:true});
        if (useEvents) {
          try {
            await assertOwner(captured);
            eventWait ||= api().waitForTradingCloudRunEvent(record.runId, {
              signal:eventSignal, after:eventCursor, expectedAccountId:captured.accountId, expectedBaseUrl:captured.baseUrl,
              timeoutMs:Math.min(15000, Math.max(1, deadline - now())),
            }).then(event=>({event}),error=>({error}));
            // Keep the existing polling cadence as a watchdog. A proxy that
            // buffers SSE must never make result delivery slower than before.
            const tickController = new AbortController();
            const tickSignal = signal ? AbortSignal.any([signal,tickController.signal]) : tickController.signal;
            let wake;
            try {
              wake = await Promise.race([eventWait,wait(pollMs,undefined,{signal:tickSignal}).then(()=>null)]);
            } finally { tickController.abort(); }
            if (!wake) continue;
            eventWait = null;
            if (wake.error) throw wake.error;
            const event = wake.event;
            await assertOwner(captured);
            signal?.throwIfAborted();
            eventCursor = event.cursor;
            // Reconnect a healthy bounded stream from its cursor. EOF or a
            // broken stream uses only the original polling path afterwards.
            useEvents = event.expired === true;
          } catch (error) {
            signal?.throwIfAborted();
            await assertOwner(captured);
            if (error.code === 'TRADING_PREFERENCE_OWNER_CHANGED') throw error;
            useEvents = false;
          }
          continue;
        }
        await wait(pollMs,undefined,{signal});
      }
    } catch(error) {
      if (signal?.aborted) {
        try { if (await cancelRecord(captured,record) === 'succeeded') throw fail('CLOUD_RUN_PENDING'); }
        catch (cancelError) { if(cancelError.code==='CLOUD_RUN_PENDING')throw cancelError; throw fail('CLOUD_CANCEL_PENDING',{runId:record.runId}); }
        throw fail('TRADING_ANALYSIS_CANCELLED');
      }
      throw error;
    } finally { eventController.abort(); }
  }
  async function run(strategyId, params, options={}) {
    const captured = await owner();
    const key = String(params.analysisJobId || params.requestId || randomUUID());
    const lock = `${captured.ownerId}:${key}`;
    if (active.has(lock)) throw fail('CLOUD_RUN_ALREADY_PENDING');
    active.add(lock);
    let record;
    try {
      const target = cloudMarketContext(params);
      let visibleRange = null;
      if (strategyId === 'vpvr-analysis') {
        const candles = params.candles;
        if(params.visibleRange)visibleRange={visibleFrom:params.visibleRange.visibleFrom,visibleTo:params.visibleRange.visibleTo};
        else {
          if (!Array.isArray(candles) || candles.length < 20 || candles.length > 600) throw fail('VPVR_VISIBLE_RANGE_REQUIRED');
          visibleRange = {visibleFrom:Math.round(candles[0].time*1000),visibleTo:Math.round(candles.at(-1).time*1000)};
        }
        if (!Number.isSafeInteger(visibleRange.visibleFrom) || !Number.isSafeInteger(visibleRange.visibleTo)
          || visibleRange.visibleFrom <= 0 || visibleRange.visibleFrom >= visibleRange.visibleTo) throw fail('VPVR_VISIBLE_RANGE_REQUIRED');
      }
      const requestedCount=params.analysisWindowCount??null;
      if(requestedCount!==null&&(!Number.isSafeInteger(requestedCount)||requestedCount<20||requestedCount>600))throw fail('ANALYSIS_WINDOW_INVALID');
      const lookbackMs=Number(params.lookbackMs)>0?Number(params.lookbackMs):null;
      if(lookbackMs!==null&&(!Number.isSafeInteger(lookbackMs)||lookbackMs>315360000000))throw fail('ANALYSIS_WINDOW_INVALID');
      const input = {windowCount:requestedCount,lookbackMs,strategyId,...target,instruction:String(params.instruction || '分析当前行情').slice(0,8000),
        executionPolicy:'entry-v2',requestedEntryMode:params.entryMode || 'right',
        origin:{sourceThreadId:String(params.sourceThreadId || '').slice(0,300),
          storageSessionId:String(params.storageSessionId || '').slice(0,300),analysisJobId:key},
        visibleRange,analysisKind:params.analysisKind === 'general' ? 'general' : 'strategy',
        positionManagementRequested:params.positionManagementRequested===true,
        analysisContext:params.analysisContext || null,
        locale:params.language === 'ko' ? 'ko' : params.language === 'en' ? 'en' : ['zh-TW','zh-Hant'].includes(params.language) ? 'zh-Hant' : 'zh-CN',
        modelId:params.model || params.modelId || params.model_id || null,
        modelDisplayAlias:params.modelDisplayAlias || params.__haoloModelDisplayAlias || params.model || params.modelId || null,
        explicitModelSelection:params.explicitModelSelection===true,
        preferencesRevision:params.preferencesRevision, preferencesHash:params.preferencesHash,
        responseMode:params.responseMode === 'direct' ? 'direct' : 'combined'};
      if (!Number.isSafeInteger(input.preferencesRevision) || !/^[a-f0-9]{64}$/.test(input.preferencesHash || '')) throw fail('PREFERENCE_REVISION_REQUIRED');
      if (!['left','right'].includes(input.requestedEntryMode)) throw fail('ENTRY_MODE_INVALID');
      record = await journal.get(captured.ownerId,key);
      // An interrupted pre-upgrade job retains its frozen protocol. Never
      // replay a legacy admission as a new V2 run or charge for the same job twice.
      const compatibleInputs = [input];
      if (record && !Object.hasOwn(record.body, 'modelDisplayAlias')) {
        const {modelDisplayAlias, ...legacyInput} = input;
        compatibleInputs.push(legacyInput);
      }
      if (record && !compatibleInputs.some(candidate => record.inputHash === fingerprint(candidate)
        || (input.requestedEntryMode==='right' && record.body.executionPolicy==='right-legacy-v1'
          && record.inputHash===fingerprint({...candidate,executionPolicy:'right-legacy-v1'})))) throw fail('CLOUD_RUN_ID_REUSED');
      options.signal?.throwIfAborted();
      if (record?.cancelRequested && record.state !== 'succeeded') { await cancelRecord(captured,record); if(record.state!=='succeeded')throw fail('TRADING_ANALYSIS_CANCELLED'); }
      if (!record) {
        const capabilities = await request(captured,'capabilities',{}, {signal:options.signal});
        if (capabilities.windowsContract !== 'windows-v1' || !capabilities.windowsWorkerReady) throw fail('WINDOWS_WORKER_UNAVAILABLE');
        if (!capabilities.strategies?.some(s => s.id === strategyId && s.legacyWindows)) throw fail('WINDOWS_STRATEGY_UNSUPPORTED');
        if (!capabilities.entryV2WorkerReady) throw fail('ENTRY_WORKER_UNAVAILABLE');
        if (!capabilities.strategies?.some(s => s.id === strategyId && s.entryModes?.includes(input.requestedEntryMode))) throw fail('ENTRY_POLICY_UNAVAILABLE');
        // Defaults are selected by the server. Explicit counts still satisfy
        // admission minima; journaled admissions retain their frozen body/key.
        const minimumHistory = cloudStrategyMinimumHistory(strategyId,capabilities.strategies.find(s=>s.id===strategyId)?.history);
        const windowCount = requestedCount === null ? null : Math.max(requestedCount,minimumHistory);
        const snapshotController = new AbortController();
        const snapshotSignal = options.signal ? AbortSignal.any([options.signal,snapshotController.signal]) : snapshotController.signal;
        const readSnapshot = () => readMarketWhenAvailable({
          read:() => request(captured,'marketSnapshot',{market:target.marketKey,interval:target.interval,limit:600,purpose:'analysis',analysisStrategy:strategyId,...(visibleRange||{...(windowCount?{windowCount}:{}),...(lookbackMs?{lookbackMs}:{})})},{signal:snapshotSignal}),
          assertOwner:() => assertOwner(captured),signal:snapshotSignal,wait,random,onProgress:options.onProgress,
        });
        // Independent fresh reads can overlap after capability/history checks.
        // No cached market result or account consent replaces either read.
        const fast = params.pureReferenceAnalysis === true;
        let marketRead, parallelAccount;
        try {
          [marketRead,parallelAccount] = fast
            ? await Promise.all([readSnapshot(), connection?.(captured,target)])
            : [await readSnapshot(), undefined];
        } finally { snapshotController.abort(); }
        const {snapshot,deferred} = marketRead;
        if (snapshot.marketKey !== target.marketKey || snapshot.interval !== target.interval || !snapshot.snapshotId) throw fail('CLOUD_MARKET_CONTEXT_INVALID');
        // A long market cooldown must not reuse an account binding captured
        // before the wait; revocation and rebinding must take effect first.
        const account = fast && !deferred ? parallelAccount : await connection?.(captured,target);
        await assertOwner(captured);
        options.signal?.throwIfAborted();
        const runId = randomUUID();
        record = {key,runId,inputHash:fingerprint(input),preferencesHash:input.preferencesHash,
          requestedEntryMode:input.requestedEntryMode,origin:input.origin,
          marketId:params.marketId,interval:params.interval,state:'prepared',
          body:{clientContract:'windows-v1',clientRunId:runId,executionPolicy:input.executionPolicy,
            context:{taskId:/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.origin.sourceThreadId) ? input.origin.sourceThreadId : randomUUID(),marketKey:target.marketKey,interval:target.interval,snapshotId:snapshot.snapshotId,version:1},
            strategy:strategyId,prompt:input.instruction,locale:input.locale,preferencesRevision:input.preferencesRevision,analysisKind:input.analysisKind,
            positionManagementRequested:input.positionManagementRequested,analysisContext:input.analysisContext,
            responseMode:input.responseMode,explicitModelSelection:input.explicitModelSelection,...(input.modelId ? {modelId:input.modelId} : {}),
            ...(input.modelDisplayAlias ? {modelDisplayAlias:input.modelDisplayAlias} : {}),
            ...(account?.id ? {connectionId:account.id} : {}),accountBindingUnavailable:account?.unavailable===true}};
        await journal.put(captured.ownerId,key,record);
      }
      if (record.state === 'prepared') {
        options.signal?.throwIfAborted();
        // Abort is safe: cancellation can fence this preassigned ID even when
        // the admission response was lost. Explicit retry reuses this exact body.
        const admitted = await request(captured,'createRun',record.body,{signal:options.signal,idempotencyKey:`windows:${record.runId}`});
        if (admitted.id !== record.runId) throw fail('CLOUD_RESULT_CONTEXT_INVALID');
        record.state = admitted.state;
        await journal.put(captured.ownerId,key,record);
      }
      return await poll(captured,record,{...options,pureReferenceAnalysis:params.pureReferenceAnalysis === true});
    } catch(error) {
      if (options.signal?.aborted && record && !record.cancelRequested) {
        try { if (await cancelRecord(captured,record) === 'succeeded') throw fail('CLOUD_RUN_PENDING'); }
        catch (cancelError) { if(cancelError.code==='CLOUD_RUN_PENDING')throw cancelError; throw fail('CLOUD_CANCEL_PENDING',{runId:record.runId}); }
        throw fail('TRADING_ANALYSIS_CANCELLED');
      }
      throw error;
    } finally { active.delete(lock); }
  }
  return {run,
    async pending() { const captured=await owner(); const rows=await journal.list(captured.ownerId); await assertOwner(captured); return rows.filter(r=>!r.acknowledged).map(r=>({key:r.key,runId:r.runId,state:r.state,marketId:r.marketId,interval:r.interval,strategyId:r.body.strategy,cancelRequested:!!r.cancelRequested})); },
    async resume(key,options={}) {
      const captured=await owner(),lock=`${captured.ownerId}:${key}`;
      if(active.has(lock))throw fail('CLOUD_RUN_ALREADY_PENDING');
      active.add(lock);
      let record;
      const deadline=now()+(options.timeoutMs??timeoutMs);
      try {
        record=await journal.get(captured.ownerId,key);
        if(!record)throw fail('CLOUD_RUN_NOT_FOUND');
        if(record.cancelRequested && record.state!=='succeeded'){
          await cancelRecord(captured,record);
          if(record.state!=='succeeded')throw fail('TRADING_ANALYSIS_CANCELLED');
        }
        if(record.state==='prepared') {
          // Inspect before an explicit same-key retry, including after app restart.
          try { await readRun(captured,record,{signal:options.signal,deadline}); }
          catch(error) {
            if(error.status!==404)throw error;
            options.signal?.throwIfAborted();
            const admitted=await request(captured,'createRun',record.body,{signal:options.signal,idempotencyKey:`windows:${record.runId}`});
            if(admitted.id!==record.runId)throw fail('CLOUD_RESULT_CONTEXT_INVALID');
            record.state=admitted.state;
            await journal.put(captured.ownerId,key,record);
          }
        }
        return await poll(captured,record,{...options,deadline});
      } catch(error) {
        if(options.signal?.aborted && record && !record.cancelRequested){
          try {if(await cancelRecord(captured,record)==='succeeded')throw fail('CLOUD_RUN_PENDING');}
          catch(cancelError){if(cancelError.code==='CLOUD_RUN_PENDING')throw cancelError;throw fail('CLOUD_CANCEL_PENDING',{runId:record.runId});}
          throw fail('TRADING_ANALYSIS_CANCELLED');
        }
        throw error;
      } finally {active.delete(lock);}
    },
    async cancel(key) {const captured=await owner();const record=await journal.get(captured.ownerId,key);if(!record)throw fail('CLOUD_RUN_NOT_FOUND');return {state:await cancelRecord(captured,record)};},
    async acknowledgeGroup(key) {const captured=await owner();const rows=await journal.list(captured.ownerId);await assertOwner(captured);for(const r of rows)if((r.key===key||r.key.startsWith(`${key}:pane:`))&&terminal.has(r.state))await journal.put(captured.ownerId,r.key,{...r,acknowledged:true});},
    async acknowledge(key) {const captured=await owner();const record=await journal.get(captured.ownerId,key);if(record&&terminal.has(record.state))await journal.put(captured.ownerId,key,{...record,acknowledged:true});},
  };
}
