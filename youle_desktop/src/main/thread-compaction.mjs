import { canonicalDeepSeekModel } from "./deepseek-model-policy.mjs";
export const THREAD_COMPACTION_TIMEOUT_MS = 120_000;
export const THREAD_SETTINGS_UPDATE_TIMEOUT_MS = 30_000;
export const THREAD_COMPACTION_MAX_SINGLE_ITEM_TOKENS = 400_000;
const THREAD_COMPACTION_MAX_ATTEMPTS = 2;
const THREAD_COMPACTION_RETRY_DELAY_MS = 500;
const THREAD_COMPACTION_EFFORT = "low";
const DEEPSEEK_EXECUTION_MODEL = "deepseek-flash";
const THREAD_COMPACTION_INTERRUPT_GRACE_MS = 5_000;

/**
 * Read the effective settings returned at the top level of thread/start or
 * thread/resume. The nested Thread payload intentionally does not contain the
 * active model.
 */
export function threadSettingsFromResumeResult(result = {}) {
  return normalizeThreadSettings({
    model: result?.model,
    effort: result?.reasoningEffort ?? result?.reasoning_effort,
    serviceTier: result?.serviceTier ?? result?.service_tier ?? null,
  });
}

/**
 * Queue a thread/settings/update and wait until app-server confirms matching
 * settings. Some app-server versions confirm through a
 * thread/settings/updated notification, while others include the applied
 * settings in the JSON-RPC response. A bare queued acknowledgement is not
 * enough.
 */
export async function ensureThreadSettingsAndWait({
  serverClient,
  threadId,
  currentSettings,
  targetSettings,
  updateSettings,
  verifySettings,
  timeoutMs = THREAD_SETTINGS_UPDATE_TIMEOUT_MS,
} = {}) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) throw new Error("threadId is required");
  if (typeof serverClient?.on !== "function" || typeof serverClient?.off !== "function") {
    throw new Error("serverClient must support notification events");
  }
  if (typeof updateSettings !== "function") throw new Error("updateSettings is required");

  const current = normalizeThreadSettings(currentSettings);
  const target = normalizeThreadSettings(targetSettings, { requireModel: true });
  if (threadSettingsSatisfy(current, target)) {
    return { changed: false, requestResult: null, threadSettings: current };
  }

  let timer = null;
  let resolveApplied;
  let rejectApplied;
  let confirmationState = "waiting";
  const applied = new Promise((resolve, reject) => {
    resolveApplied = resolve;
    rejectApplied = reject;
  });
  const confirmApplied = (value, source) => {
    if (confirmationState !== "waiting") return;
    confirmationState = source;
    resolveApplied(value);
  };
  const onNotification = (message) => {
    if (message?.method !== "thread/settings/updated") return;
    const sameThread = notificationThreadId(message) === normalizedThreadId;
    const settings = notificationThreadSettings(message);
    if (!sameThread || !threadSettingsSatisfy(settings, target)) return;
    confirmApplied({ message, threadSettings: settings }, "notification");
  };
  const cleanup = () => {
    clearTimeout(timer);
    serverClient.off("notification", onNotification);
  };

  const updateParams = {
    threadId: normalizedThreadId,
    model: target.model,
    ...(Object.hasOwn(target, "effort") ? { effort: target.effort } : {}),
    ...(Object.hasOwn(target, "serviceTier") ? { serviceTier: target.serviceTier } : {}),
  };

  serverClient.on("notification", onNotification);
  timer = setTimeout(() => {
    if (confirmationState !== "waiting") return;
    const error = new Error(`Thread settings update timed out after ${timeoutMs}ms`);
    error.code = "THREAD_SETTINGS_CONFIRMATION_TIMEOUT";
    confirmationState = "timed_out";
    rejectApplied(error);
  }, timeoutMs);

  let lastVerifiedAppliedResult = null;
  const readVerifiedSettings = async () => {
    const verificationResult = await verifySettings();
    const verifiedSettings = responseThreadSettings(verificationResult);
    if (!threadSettingsSatisfy(verifiedSettings, target)) return null;
    lastVerifiedAppliedResult = {
      message: null,
      threadSettings: verifiedSettings,
      verificationResult,
      verified: true,
    };
    confirmApplied(lastVerifiedAppliedResult, "verification");
    return lastVerifiedAppliedResult;
  };

  const requestPromise = Promise.resolve()
    .then(() => updateSettings(updateParams))
    .then(async (requestResult) => {
      const responseSettings = responseThreadSettings(requestResult);
      if (threadSettingsSatisfy(responseSettings, target)) {
        confirmApplied({ message: null, threadSettings: responseSettings }, "response");
      } else if (typeof verifySettings === "function") {
        // The current protocol's response is intentionally empty. A metadata-
        // only resume is cheap enough to confirm the applied state immediately,
        // while notifications and the timeout check remain as race fallbacks.
        try {
          await readVerifiedSettings();
        } catch {
          // Keep waiting for the normal confirmation path.
        }
      }
      return requestResult;
    });

  try {
    try {
      const [requestResult, appliedResult] = await Promise.all([requestPromise, applied]);
      return {
        changed: true,
        requestResult,
        message: appliedResult.message,
        threadSettings: appliedResult.threadSettings,
        ...(appliedResult.verificationResult ? { verificationResult: appliedResult.verificationResult } : {}),
        ...(appliedResult.verified ? { verified: true } : {}),
      };
    } catch (error) {
      // Some app-server builds acknowledge the update without returning the
      // applied settings and do not emit thread/settings/updated. Only for that
      // confirmation timeout, read the authoritative thread state once. Never
      // turn a request failure or a mismatching setting into success.
      if (error?.code !== "THREAD_SETTINGS_CONFIRMATION_TIMEOUT" || typeof verifySettings !== "function") {
        throw error;
      }
      const requestResult = await requestPromise;
      const appliedResult = lastVerifiedAppliedResult || await readVerifiedSettings();
      if (!appliedResult) throw error;
      return {
        changed: true,
        requestResult,
        verificationResult: appliedResult.verificationResult,
        message: appliedResult.message,
        threadSettings: appliedResult.threadSettings,
        verified: true,
      };
    }
  } finally {
    cleanup();
  }
}

/**
 * Resume a thread without model overrides, synchronize its effective model,
 * wait until that change is observable, and only then start compaction.
 */
export async function compactThreadWithSettings({
  serverClient,
  threadId,
  targetSettings,
  resumeThread,
  updateSettings,
  verifySettings,
  startCompaction,
  interruptCompaction,
  onSettingsRestoreError,
  onResumed,
  settingsTimeoutMs = THREAD_SETTINGS_UPDATE_TIMEOUT_MS,
  compactionTimeoutMs = THREAD_COMPACTION_TIMEOUT_MS,
  compactionMaxAttempts = THREAD_COMPACTION_MAX_ATTEMPTS,
  compactionRetryDelayMs = THREAD_COMPACTION_RETRY_DELAY_MS,
} = {}) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) throw new Error("threadId is required");
  if (typeof resumeThread !== "function") throw new Error("resumeThread is required");
  if (typeof startCompaction !== "function") throw new Error("startCompaction is required");

  const resumeResult = await resumeThread();
  onResumed?.(resumeResult);
  const requestedSettings = normalizeThreadSettings(targetSettings, { requireModel: true });
  const compactionSettings = threadCompactionExecutionSettings(requestedSettings);
  let activeSettings = threadSettingsFromResumeResult(resumeResult);
  let shouldRestoreRequestedSettings = false;
  let operationError = null;

  try {
    const applied = await ensureThreadSettingsAndWait({
      serverClient,
      threadId: normalizedThreadId,
      currentSettings: activeSettings,
      targetSettings: compactionSettings,
      updateSettings,
      verifySettings,
      timeoutMs: settingsTimeoutMs,
    });
    activeSettings = applied.threadSettings;
    shouldRestoreRequestedSettings = !threadSettingsSatisfy(activeSettings, requestedSettings);

    const maxAttempts = Math.max(1, Math.min(
      THREAD_COMPACTION_MAX_ATTEMPTS,
      Math.trunc(Number(compactionMaxAttempts)) || 1,
    ));
    const retryDelayMs = Math.max(0, Math.trunc(Number(compactionRetryDelayMs)) || 0);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await startThreadCompactionAndWait({
          serverClient,
          threadId: normalizedThreadId,
          startCompaction,
          interruptCompaction,
          timeoutMs: compactionTimeoutMs,
        });
        return result;
      } catch (error) {
        const retryReason = threadCompactionRetryReason(error);
        const willRetry = Boolean(retryReason && attempt < maxAttempts);
        if (!willRetry) throw error;
        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    throw new Error("Thread compaction failed");
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (shouldRestoreRequestedSettings) {
      try {
        await ensureThreadSettingsAndWait({
          serverClient,
          threadId: normalizedThreadId,
          currentSettings: activeSettings,
          targetSettings: requestedSettings,
          updateSettings,
          verifySettings,
          timeoutMs: settingsTimeoutMs,
        });
      } catch (restoreError) {
        // Compaction itself has already reached a terminal state here. A
        // best-effort settings restore must not turn a completed compaction
        // into a failure and prompt the renderer to compact the same history
        // again. Preserve an earlier operation failure, and report a restore-
        // only failure out of band for diagnostics.
        try {
          onSettingsRestoreError?.(restoreError);
        } catch {
          // Diagnostic callbacks must never replace the operation result.
        }
        if (operationError && (typeof operationError === "object" || typeof operationError === "function")) {
          operationError.threadSettingsRestoreError = restoreError;
        }
      }
    }
  }
}

/**
 * Compaction cannot make progress when one indivisible history item already
 * occupies most of the usable window. Detect that shape before asking Codex to
 * enter its remove-oldest-and-retry loop.
 */
export function oversizedThreadCompactionItem(
  threadResult,
  maxSingleItemTokens = THREAD_COMPACTION_MAX_SINGLE_ITEM_TOKENS,
) {
  const limit = Math.max(1, Math.trunc(Number(maxSingleItemTokens)) || THREAD_COMPACTION_MAX_SINGLE_ITEM_TOKENS);
  const turns = Array.isArray(threadResult?.thread?.turns) ? threadResult.thread.turns : [];
  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const item of items) {
      const estimatedTokens = estimateHistoryValueTokens(item, limit);
      if (estimatedTokens < limit) continue;
      return {
        estimatedTokens,
        itemId: firstString(item?.id) || null,
        itemType: firstString(item?.type) || null,
        turnId: firstString(turn?.id, item?.turnId, item?.turn_id) || null,
      };
    }
  }
  return null;
}

/**
 * Start a manual compaction and keep the caller blocked until app-server reports
 * that the compaction turn actually finished. The notification listener is
 * attached before startCompaction runs so an immediate app-server response
 * cannot race a fast compaction notification.
 */
export async function startThreadCompactionAndWait({
  serverClient,
  threadId,
  startCompaction,
  interruptCompaction,
  timeoutMs = THREAD_COMPACTION_TIMEOUT_MS,
} = {}) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) throw new Error("threadId is required");
  if (typeof serverClient?.on !== "function" || typeof serverClient?.off !== "function") {
    throw new Error("serverClient must support notification events");
  }
  if (typeof startCompaction !== "function") throw new Error("startCompaction is required");

  let settled = false;
  let resolveCompletion;
  let rejectCompletion;
  let candidateTurnId = null;
  let compactionTurnId = null;
  let sawCompactionItem = false;
  let timer = null;
  let timingOut = false;

  const cleanup = () => {
    clearTimeout(timer);
    serverClient.off("notification", onNotification);
    serverClient.off("status", onStatus);
  };
  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveCompletion(value);
  };
  const fail = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectCompletion(error instanceof Error ? error : new Error(String(error || "Thread compaction failed")));
  };
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const onStatus = (status) => {
    if (["failed", "stopped"].includes(status?.state)) {
      fail(new Error("Thread compaction interrupted: app server stopped"));
    }
  };
  const onNotification = (message) => {
    if (timingOut) return;
    if (!message || notificationThreadId(message) !== normalizedThreadId) return;
    const method = String(message.method || "");
    const turnId = notificationTurnId(message);

    if (method === "thread/compacted") {
      finish({ method, message });
      return;
    }

    if (method === "turn/started") {
      if (!sawCompactionItem && turnId) candidateTurnId = turnId;
      return;
    }

    if (method === "item/started" || method === "item/completed" || method === "item/failed") {
      if (!isContextCompactionItem(message.params?.item)) return;
      sawCompactionItem = true;
      if (turnId) compactionTurnId = turnId;
      if (method === "item/failed" || message.params?.item?.error || ["failed", "error", "interrupted", "cancelled", "canceled"].includes(String(message.params?.item?.status || "").toLowerCase())) {
        fail(compactionFailure(message));
      }
      return;
    }

    if (method !== "turn/completed" && method !== "turn/failed") return;
    // A different turn can start on the same thread before the compaction item
    // is observable. Never treat a plain turn completion as compaction success.
    if (!sawCompactionItem) {
      if (candidateTurnId && turnId === candidateTurnId) candidateTurnId = null;
      return;
    }
    const expectedTurnId = compactionTurnId || candidateTurnId;
    if (expectedTurnId && turnId && turnId !== expectedTurnId) return;
    if (method === "turn/failed" || turnFinishedWithFailure(message)) {
      fail(compactionFailure(message));
      return;
    }
    finish({ method, message });
  };
  serverClient.on("notification", onNotification);
  serverClient.on("status", onStatus);
  timer = setTimeout(() => {
    if (settled) return;
    timingOut = true;
    const error = new Error(`Thread compaction timed out after ${timeoutMs}ms`);
    const turnId = compactionTurnId || candidateTurnId;
    if (typeof interruptCompaction !== "function" || !turnId) {
      fail(error);
      return;
    }
    void settleWithin(
      Promise.resolve().then(() => interruptCompaction({
        threadId: normalizedThreadId,
        turnId,
      })),
      THREAD_COMPACTION_INTERRUPT_GRACE_MS,
    ).then(() => fail(error));
  }, timeoutMs);

  try {
    const [result] = await Promise.all([
      Promise.resolve()
        .then(() => startCompaction())
        .catch((error) => {
          if (timingOut) return null;
          fail(error);
          throw error;
        }),
      completion,
    ]);
    return result;
  } finally {
    cleanup();
  }
}

function notificationThreadId(message) {
  const params = message?.params || {};
  return firstString(
    params.threadId,
    params.thread_id,
    params.thread?.id,
    params.turn?.threadId,
    params.turn?.thread_id,
  );
}

function notificationThreadSettings(message) {
  const params = message?.params || {};
  return threadSettingsFromPayload(params);
}

function responseThreadSettings(result) {
  return threadSettingsFromPayload(result);
}

function threadSettingsFromPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return firstThreadSettings(
    source.threadSettings,
    source.thread_settings,
    source.settings,
    source,
    source.thread,
  );
}

function firstThreadSettings(...values) {
  for (const value of values) {
    const settings = normalizeThreadSettings(value);
    if (settings.model) return settings;
  }
  return normalizeThreadSettings({});
}

function normalizeThreadSettings(value, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const model = options.requireModel ? canonicalDeepSeekModel(source.model) : firstString(source.model);
  if (options.requireModel && !model) throw new Error("model is required");
  const settings = { model };
  const effort = optionalString(source.effort, source.reasoningEffort, source.reasoning_effort);
  if (effort !== undefined) settings.effort = effort;
  if (Object.hasOwn(source, "serviceTier") || Object.hasOwn(source, "service_tier")) {
    const rawServiceTier = Object.hasOwn(source, "serviceTier") ? source.serviceTier : source.service_tier;
    const serviceTier = rawServiceTier == null ? "" : String(rawServiceTier).trim();
    settings.serviceTier = !serviceTier || serviceTier.toLowerCase() === "default" ? null : serviceTier;
  }
  return settings;
}

function threadSettingsSatisfy(current, target) {
  if (target.model && current.model !== target.model) return false;
  if (Object.hasOwn(target, "effort") && (current.effort ?? null) !== (target.effort ?? null)) return false;
  if (Object.hasOwn(target, "serviceTier") && (current.serviceTier ?? null) !== (target.serviceTier ?? null)) return false;
  return true;
}

function notificationTurnId(message) {
  const params = message?.params || {};
  return firstString(
    params.turnId,
    params.turn_id,
    params.turn?.id,
  );
}

function isContextCompactionItem(item) {
  return String(item?.type || "").replace(/[^a-z0-9]/gi, "").toLowerCase() === "contextcompaction";
}

function turnFinishedWithFailure(message) {
  const turn = message?.params?.turn || {};
  if (turn.error || message?.params?.error) return true;
  const status = typeof turn.status === "string" ? turn.status : turn.status?.type;
  return ["failed", "error", "interrupted", "cancelled", "canceled"].includes(String(status || "").toLowerCase());
}

function compactionFailure(message) {
  const error = message?.params?.turn?.error || message?.params?.error || message?.params?.item?.error;
  const detail = firstString(error?.message, error, message?.params?.message);
  return new Error(detail ? `Thread compaction failed: ${detail}` : "Thread compaction failed");
}

function threadCompactionRetryReason(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message.includes("stream disconnected before completion")) return null;
  if (
    message.includes("websocket protocol error") ||
    message.includes("connection reset without closing handshake")
  ) {
    return "websocket_reset";
  }
  if (message.includes("stream closed before response.completed")) return "stream_closed";
  return null;
}

function threadCompactionExecutionSettings(targetSettings) {
  const settings = normalizeThreadSettings(targetSettings, { requireModel: true });
  if (settings.model.toLowerCase() === DEEPSEEK_EXECUTION_MODEL) {
    settings.effort = "max";
    return settings;
  }
  const effort = String(settings.effort || "").toLowerCase();
  if (["high", "xhigh", "max", "ultra"].includes(effort)) settings.effort = THREAD_COMPACTION_EFFORT;
  return settings;
}

function settleWithin(value, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, Number(timeoutMs) || 0));
    Promise.resolve(value).then(finish, finish);
  });
}

function estimateHistoryValueTokens(value, stopAtTokens, seen = new Set()) {
  if (value == null) return 0;
  if (typeof value === "string") return estimateHistoryTextTokens(value, stopAtTokens);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return 1;
  if (typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);

  let total = 0;
  const values = Array.isArray(value) ? value : Object.values(value);
  for (const child of values) {
    total += estimateHistoryValueTokens(child, Math.max(1, stopAtTokens - total), seen);
    if (total >= stopAtTokens) return total;
  }
  return total;
}

function estimateHistoryTextTokens(value, stopAtTokens) {
  let cjkCharacters = 0;
  let otherCharacters = 0;
  for (const character of String(value || "")) {
    if (/[^\u0000-\u02ff\u1e00-\u206f]/u.test(character)) cjkCharacters += 1;
    else otherCharacters += character.length;
    if (cjkCharacters + Math.ceil(otherCharacters / 4) >= stopAtTokens) return stopAtTokens;
  }
  return cjkCharacters + Math.ceil(otherCharacters / 4);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function optionalString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}
