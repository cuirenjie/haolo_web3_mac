export function createWorkflowInternalStartCapture() {
  return {
    bufferedNotifications: [],
    candidateThreadIds: new Set(),
  };
}

export function captureWorkflowInternalStartNotification(capture, message, threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!capture || !normalizedThreadId) return false;
  if (message?.method === "thread/started") {
    capture.candidateThreadIds.add(normalizedThreadId);
  }
  if (!capture.candidateThreadIds.has(normalizedThreadId)) return false;
  capture.bufferedNotifications.push({ message, threadId: normalizedThreadId });
  return true;
}

export function drainWorkflowInternalStartCapture(capture, responseThreadId) {
  const targetThreadId = String(responseThreadId || "").trim();
  const forwardedNotifications = [];
  let suppressedCount = 0;
  for (const entry of capture?.bufferedNotifications || []) {
    if (targetThreadId && entry.threadId === targetThreadId) {
      suppressedCount += 1;
    } else {
      forwardedNotifications.push(entry.message);
    }
  }
  capture?.bufferedNotifications?.splice?.(0);
  capture?.candidateThreadIds?.clear?.();
  return { forwardedNotifications, suppressedCount };
}

export async function cleanupWorkflowInternalCodexThread({
  threadId,
  turnId,
  interrupt = false,
  interruptTurn,
  deleteThread,
} = {}) {
  const errors = [];
  let interrupted = false;
  if (interrupt && turnId) {
    try {
      if (typeof interruptTurn !== "function") throw new Error("interruptTurn is required");
      await interruptTurn({ threadId, turnId });
      interrupted = true;
    } catch (error) {
      errors.push({ phase: "interrupt", error });
    }
  }

  let deleted = false;
  try {
    if (typeof deleteThread !== "function") throw new Error("deleteThread is required");
    await deleteThread({ threadId });
    deleted = true;
  } catch (error) {
    errors.push({ phase: "delete", error });
  }
  return { interrupted, deleted, errors };
}

export async function interruptWorkflowCodexTurn({
  threadId,
  turnId,
  interruptTurn,
} = {}) {
  const normalizedThreadId = String(threadId || "").trim();
  const normalizedTurnId = String(turnId || "").trim();
  if (!normalizedThreadId || !normalizedTurnId) {
    return { interrupted: false, error: null };
  }
  try {
    if (typeof interruptTurn !== "function") throw new Error("interruptTurn is required");
    await interruptTurn({
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
    });
    return { interrupted: true, error: null };
  } catch (error) {
    return { interrupted: false, error };
  }
}
