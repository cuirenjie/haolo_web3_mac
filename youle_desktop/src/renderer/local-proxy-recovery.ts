export const LOCAL_PROXY_RECOVERY_MAX_REPLAYS = 1;
export const LOCAL_PROXY_RECOVERY_REPLAY_START = "<haolo_local_proxy_recovery_replay>";
export const LOCAL_PROXY_RECOVERY_REPLAY_END = "</haolo_local_proxy_recovery_replay>";

export function isLocalProxyConnectionRefusedError(value: unknown) {
  const detail = String(value || "").trim();
  return /(?:\b10061\b|\bECONNREFUSED\b|connection refused|actively refused|failed to connect to (?:websocket|server))/i.test(
    detail,
  );
}

/**
 * Keeps the automatic retry out of the visible chat history while making the
 * original request authoritative for the retried model turn.
 */
export function buildLocalProxyRecoveryReplayText(agentText: string) {
  const request = String(agentText || "").trim();
  return [
    LOCAL_PROXY_RECOVERY_REPLAY_START,
    "The preceding turn did not reach the model because the client's local proxy became unavailable.",
    "The client has switched away from that unavailable proxy and is replaying the same user request once.",
    "Treat the request below as the user's current request, execute it directly, and do not mention this recovery wrapper.",
    "",
    request,
    LOCAL_PROXY_RECOVERY_REPLAY_END,
  ].join("\n");
}

export function isLocalProxyRecoveryReplayText(value: unknown) {
  return String(value || "").includes(LOCAL_PROXY_RECOVERY_REPLAY_START);
}

export function canReplayLocalProxyFailure(replayCount: number | null | undefined) {
  const count = Number.isFinite(replayCount) ? Math.max(0, Math.floor(replayCount as number)) : 0;
  return count < LOCAL_PROXY_RECOVERY_MAX_REPLAYS;
}
