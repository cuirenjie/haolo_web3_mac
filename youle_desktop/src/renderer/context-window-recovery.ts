export const CONTEXT_WINDOW_RECOVERY_MAX_REPLAYS = 1;
export const CONTEXT_WINDOW_RECOVERY_REPLAY_START = "<haolo_context_window_recovery_replay>";
export const CONTEXT_WINDOW_RECOVERY_REPLAY_END = "</haolo_context_window_recovery_replay>";

export type ContextUsageSampleDecision = {
  acceptUsedTokens: boolean;
  clearAwaitingPostRecoveryUsage: boolean;
};

/**
 * Wraps an automatic replay so the model receives the original request again,
 * while the renderer can reliably hide the internal retry item after reload.
 */
export function buildContextWindowRecoveryReplayText(agentText: string) {
  const request = String(agentText || "").trim();
  return [
    CONTEXT_WINDOW_RECOVERY_REPLAY_START,
    "The preceding turn was rejected only because the model context window was full.",
    "The client has compacted the conversation and is replaying the same user request automatically.",
    "Treat the request below as the user's current request, execute it directly, and do not mention this recovery wrapper.",
    "",
    request,
    CONTEXT_WINDOW_RECOVERY_REPLAY_END,
  ].join("\n");
}

export function isContextWindowRecoveryReplayText(value: unknown) {
  return String(value || "").includes(CONTEXT_WINDOW_RECOVERY_REPLAY_START);
}

export function canReplayContextWindowFailure(replayCount: number | null | undefined) {
  const count = Number.isFinite(replayCount) ? Math.max(0, Math.floor(replayCount as number)) : 0;
  return count < CONTEXT_WINDOW_RECOVERY_MAX_REPLAYS;
}

/**
 * A full-window failure is authoritative until compaction succeeds. Afterward,
 * unattributed snapshots and late samples from the failed/compaction turn stay
 * quarantined until a normal replay turn publishes fresh usage.
 */
export function decideContextUsageSample(params: {
  contextWindowExhausted: boolean;
  exhaustedTurnId?: string | null;
  awaitingPostRecoveryUsage: boolean;
  postRecoveryTurnId?: string | null;
  sampleTurnId?: string | null;
  belongsToCompactionTurn?: boolean;
}): ContextUsageSampleDecision {
  const exhaustedTurnId = String(params.exhaustedTurnId || "").trim();
  const postRecoveryTurnId = String(params.postRecoveryTurnId || "").trim();
  const sampleTurnId = String(params.sampleTurnId || "").trim();
  const ignore =
    params.contextWindowExhausted ||
    Boolean(exhaustedTurnId && sampleTurnId && exhaustedTurnId === sampleTurnId) ||
    params.belongsToCompactionTurn === true ||
    (
      params.awaitingPostRecoveryUsage &&
      (!postRecoveryTurnId || sampleTurnId !== postRecoveryTurnId)
    );
  if (ignore) {
    return {
      acceptUsedTokens: false,
      clearAwaitingPostRecoveryUsage: false,
    };
  }
  return {
    acceptUsedTokens: true,
    clearAwaitingPostRecoveryUsage: params.awaitingPostRecoveryUsage && Boolean(sampleTurnId),
  };
}
