const QUESTION_ANSWER_PROGRESS_PROTOCOL_VERSION = 1;
const VALID_STEP_STATUSES = new Set(["running", "completed", "failed"]);
const VALID_RUN_STATUSES = new Set(["running", "completed", "failed"]);
const MAX_LABEL_CHARS = 120;
const MAX_DETAIL_CHARS = 320;

export const QUESTION_ANSWER_PROGRESS_CHANNEL = "questionAnswer:progress";

export function createQuestionAnswerProgressEmitter({
  emit,
  params = {},
  now = () => new Date().toISOString(),
  signal = null,
} = {}) {
  const interactionId = firstString(params.interactionId, params.interaction_id);
  const threadId = firstString(
    params.threadId,
    params.thread_id,
    params.conversationId,
    params.conversation_id,
  );
  const provider = firstString(params.sourceType, params.source_type, params.provider);
  const model = firstString(params.model);
  let sequence = 0;

  return (event = {}) => {
    if (
      signal?.aborted
      || typeof emit !== "function"
      || !interactionId
      || !threadId
    ) return null;
    const normalized = normalizeQuestionAnswerProgressEvent(event);
    if (!normalized) return null;
    const payload = {
      protocolVersion: QUESTION_ANSWER_PROGRESS_PROTOCOL_VERSION,
      kind: "question_answer_progress",
      mode: "question_answer",
      interactionId,
      threadId,
      provider,
      model,
      sequence: ++sequence,
      timestamp: now(),
      ...normalized,
    };
    emit(payload);
    return payload;
  };
}

export function normalizeQuestionAnswerProgressEvent(event = {}) {
  const stepId = boundedText(event.stepId ?? event.step_id, MAX_LABEL_CHARS);
  const title = boundedText(event.title, MAX_LABEL_CHARS);
  if (!stepId || !title) return null;
  const status = VALID_STEP_STATUSES.has(event.status) ? event.status : "running";
  const runStatus = VALID_RUN_STATUSES.has(event.runStatus ?? event.run_status)
    ? event.runStatus ?? event.run_status
    : status === "failed"
      ? "failed"
      : "running";
  const detail = boundedText(event.detail, MAX_DETAIL_CHARS);
  return {
    stepId,
    stage: boundedText(event.stage, MAX_LABEL_CHARS) || stepId,
    status,
    runStatus,
    title,
    detail: detail || null,
  };
}

function boundedText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}
