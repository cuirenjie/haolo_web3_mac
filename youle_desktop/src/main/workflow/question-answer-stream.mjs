const QUESTION_ANSWER_STREAM_PROTOCOL_VERSION = 1;
const MAX_STREAM_DELTA_CHARS = 16_384;
const MAX_STREAM_TEXT_CHARS = 200_000;

export const QUESTION_ANSWER_STREAM_CHANNEL = "questionAnswer:stream";

export function createQuestionAnswerStreamEmitter({
  emit,
  params = {},
  now = () => new Date().toISOString(),
  signal = null,
} = {}) {
  if (
    typeof emit !== "function"
    || !isQuestionAnswerStreamRequest(params)
  ) {
    return null;
  }
  const interactionId = firstString(
    params.interactionId,
    params.interaction_id,
  );
  const threadId = firstString(
    params.threadId,
    params.thread_id,
    params.conversationId,
    params.conversation_id,
  );
  if (!interactionId || !threadId) return null;

  const provider = firstString(
    params.sourceType,
    params.source_type,
    params.provider,
  );
  const model = firstString(params.model);
  let sequence = 0;
  let activeRound = 0;

  const dispatch = (phase, payload = {}) => {
    if (signal?.aborted) return null;
    const event = {
      protocolVersion: QUESTION_ANSWER_STREAM_PROTOCOL_VERSION,
      kind: "question_answer_stream",
      mode: "question_answer",
      interactionId,
      threadId,
      provider,
      model,
      sequence: ++sequence,
      timestamp: now(),
      phase,
      ...payload,
    };
    emit(event);
    return event;
  };

  const beginRound = (roundValue) => {
    const round = positiveInteger(roundValue, activeRound || 1);
    if (round === activeRound) return round;
    activeRound = round;
    dispatch("started", { round });
    return round;
  };

  return {
    onEvent(event = {}) {
      const phase = String(event?.phase || "").trim().toLowerCase();
      const round = positiveInteger(event?.round, activeRound || 1);
      if (phase === "started") {
        beginRound(round);
        return;
      }
      if (phase === "plan_process_delta") {
        const delta = safeStreamText(event?.delta, MAX_STREAM_TEXT_CHARS);
        if (!delta) return;
        beginRound(round);
        for (
          let offset = 0;
          offset < delta.length;
          offset += MAX_STREAM_DELTA_CHARS
        ) {
          dispatch("plan_process_delta", {
            round: activeRound,
            segmentIndex: positiveInteger(event?.segmentIndex, 1),
            delta: delta.slice(offset, offset + MAX_STREAM_DELTA_CHARS),
            receivedChars: nonNegativeInteger(event?.receivedChars),
          });
        }
        return;
      }
      if (phase !== "delta") return;
      const delta = safeStreamText(event?.delta, MAX_STREAM_TEXT_CHARS);
      if (!delta) return;
      beginRound(round);
      for (
        let offset = 0;
        offset < delta.length;
        offset += MAX_STREAM_DELTA_CHARS
      ) {
        dispatch("delta", {
          round: activeRound,
          delta: delta.slice(offset, offset + MAX_STREAM_DELTA_CHARS),
          receivedChars: nonNegativeInteger(event?.receivedChars),
        });
      }
    },
    complete(text) {
      if (signal?.aborted) return null;
      const finalText = safeStreamText(text, MAX_STREAM_TEXT_CHARS);
      return dispatch("completed", {
        round: activeRound || 1,
        text: finalText,
        receivedChars: finalText.length,
      });
    },
    fail() {
      if (signal?.aborted) return null;
      return dispatch("failed", {
        round: activeRound || 1,
      });
    },
  };
}

export function isQuestionAnswerStreamRequest(params = {}) {
  const modelPool = firstString(params.modelPool, params.model_pool);
  const modelCapability = firstString(
    params.modelCapability,
    params.model_capability,
  );
  if (
    modelPool !== "question_answer"
    && modelCapability !== "question_answer"
  ) {
    return false;
  }
  return !firstString(
    params.groupChatContextPreparationId,
    params.group_chat_context_preparation_id,
    params.groupChatThreadId,
    params.group_chat_thread_id,
    params.groupChatMemberId,
    params.group_chat_member_id,
  );
}

function safeStreamText(value, maxChars) {
  return String(value || "")
    .replace(/\0/g, "")
    .slice(0, maxChars);
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : 0;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}
