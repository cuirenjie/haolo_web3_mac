export const RESTORED_QUESTION_ANSWER_INTERRUPTED_TEXT =
  "任务已中断，未完成本次回答。";

const RESTORED_INTERRUPTED_STEP_ID = "request-interrupted";

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function streamState(item) {
  const value = item?.__youleQuestionAnswerStream;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const interactionId = stringValue(value.interactionId);
  const status = stringValue(value.status);
  if (
    !interactionId
    || !["running", "completed", "failed"].includes(status || "")
  ) {
    return null;
  }
  return {
    interactionId,
    status,
    round: Math.max(1, Math.floor(Number(value.round) || 1)),
    sequence: Math.max(0, Math.floor(Number(value.sequence) || 0)),
  };
}

function progressState(item) {
  const value = item?.__youleQuestionAnswerProgress;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const interactionId = stringValue(value.interactionId);
  const threadId = stringValue(value.threadId);
  const provider = stringValue(value.provider);
  const status = stringValue(value.status);
  if (
    !interactionId
    || !threadId
    || !provider
    || !["running", "completed", "failed"].includes(status || "")
  ) {
    return null;
  }
  return {
    ...value,
    interactionId,
    threadId,
    provider,
    status,
    sequence: Math.max(0, Math.floor(Number(value.sequence) || 0)),
    steps: Array.isArray(value.steps) ? value.steps : [],
  };
}

function completedFinalInteractionIds(items) {
  const completed = new Set();
  for (const item of items) {
    const stream = streamState(item);
    if (
      stream?.status === "completed"
      && item?.__youleGptPlanProcess !== true
    ) {
      completed.add(stream.interactionId);
    }
  }
  return completed;
}

function settleProgressItem(item, progress, status, timestamp, failureText) {
  const sequence = progress.sequence + 1;
  const finalStep = status === "completed"
    ? {
        id: "finalize-answer",
        stage: "answer_finalize",
        status: "completed",
        title: "回答已完成",
        detail: "最终回答已准备完成",
        sequence,
        timestamp,
      }
    : {
        id: RESTORED_INTERRUPTED_STEP_ID,
        stage: "request_interrupted",
        status: "failed",
        title: "任务已中断",
        detail: failureText,
        sequence,
        timestamp,
      };
  const steps = progress.steps.map((step) => (
    step && typeof step === "object" && step.status === "running"
      ? { ...step, status, timestamp }
      : step
  ));
  const existingIndex = steps.findIndex((step) => step?.id === finalStep.id);
  if (existingIndex >= 0) steps[existingIndex] = { ...steps[existingIndex], ...finalStep };
  else steps.push(finalStep);
  return {
    ...item,
    __youleQuestionAnswerProgress: {
      ...progress,
      status,
      sequence,
      updatedAt: timestamp,
      steps,
    },
  };
}

function settleStreamItem(item, stream, timestamp, failureText) {
  const text = stringValue(item?.text) || "";
  return {
    ...item,
    text: item?.__youleGptPlanProcess === true
      ? text
      : text
        ? `${text}\n\n回答中断：${failureText}`
        : `发送失败：${failureText}`,
    createdAt: stringValue(item?.createdAt, item?.created_at) || timestamp,
    __youleQuestionAnswerStream: {
      ...(item.__youleQuestionAnswerStream || {}),
      protocolVersion: 1,
      interactionId: stream.interactionId,
      round: stream.round,
      sequence: stream.sequence + 1,
      status: "failed",
    },
  };
}

function interruptedAgentMessage(progress, timestamp, failureText) {
  return {
    id: `provider-agent-interrupted-${progress.interactionId}`,
    type: "agentMessage",
    role: stringValue(progress.role) || "ceo_assistant",
    provider: progress.provider,
    sender_label: stringValue(progress.senderLabel, progress.sender_label),
    createdAt: timestamp,
    text: failureText,
    turn_id: progress.interactionId,
    __youleQuestionAnswerStream: {
      protocolVersion: 1,
      interactionId: progress.interactionId,
      round: 1,
      sequence: progress.sequence + 1,
      status: "failed",
    },
  };
}

/**
 * Restored history has no live renderer/main-process owner. Any surviving
 * running state is therefore terminal unless a completed final stream proves
 * that only the final progress event was lost.
 */
export function settleRestoredQuestionAnswerItems(
  items,
  {
    timestamp = new Date().toISOString(),
    failureText = RESTORED_QUESTION_ANSWER_INTERRUPTED_TEXT,
  } = {},
) {
  const source = Array.isArray(items) ? items : [];
  const completedInteractions = completedFinalInteractionIds(source);
  const interruptedProgress = new Map();
  const settled = source.map((item) => {
    const progress = progressState(item);
    if (progress?.status === "running") {
      if (completedInteractions.has(progress.interactionId)) {
        return settleProgressItem(
          item,
          progress,
          "completed",
          timestamp,
          failureText,
        );
      }
      interruptedProgress.set(progress.interactionId, progress);
      return settleProgressItem(
        item,
        progress,
        "failed",
        timestamp,
        failureText,
      );
    }
    const stream = streamState(item);
    if (stream?.status === "running") {
      if (item?.__youleGptPlanProcess !== true) {
        interruptedProgress.set(stream.interactionId, {
          interactionId: stream.interactionId,
          provider: stringValue(item?.provider) || "codex",
          sequence: stream.sequence,
          senderLabel: stringValue(item?.sender_label),
        });
      }
      return settleStreamItem(item, stream, timestamp, failureText);
    }
    return item;
  });

  for (const [interactionId, progress] of interruptedProgress) {
    const hasTerminalAgentMessage = settled.some((item) => {
      const stream = streamState(item);
      return (
        stream?.interactionId === interactionId
        && stream.status !== "running"
        && item?.__youleGptPlanProcess !== true
      );
    });
    if (!hasTerminalAgentMessage) {
      settled.push(interruptedAgentMessage(progress, timestamp, failureText));
    }
  }

  return {
    items: settled,
    changed: settled.length !== source.length
      || settled.some((item, index) => item !== source[index]),
  };
}
