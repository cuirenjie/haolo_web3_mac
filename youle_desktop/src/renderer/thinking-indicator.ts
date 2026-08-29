export type ActiveThinkingResponseState = {
  providerBusy: boolean;
  providerInteractionId?: string | null;
  codexBusy: boolean;
  codexTurnId?: string | null;
  workflowRunId?: string | null;
};

export type ThinkingFinalAnswerCandidate = {
  responseId?: string | null;
  isFinalAnswer: boolean;
  hasRenderableContent: boolean;
};

/**
 * Resolves the identity of the response that owns the currently visible busy
 * state. A busy provider request must never fall through to an older Codex
 * turn: the two transports can reuse one conversation while keeping separate
 * response lifecycles.
 */
export function activeThinkingResponseId(state: ActiveThinkingResponseState) {
  if (state.providerBusy) return normalizedResponseId(state.providerInteractionId);
  if (state.codexBusy) return normalizedResponseId(state.codexTurnId);
  return normalizedResponseId(state.workflowRunId);
}

export function isFinalAnswerForThinkingResponse(
  activeResponseId: string | null,
  candidate: ThinkingFinalAnswerCandidate,
) {
  if (!activeResponseId) return false;
  return (
    normalizedResponseId(candidate.responseId) === activeResponseId
    && candidate.isFinalAnswer
    && candidate.hasRenderableContent
  );
}

function normalizedResponseId(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized || null;
}
