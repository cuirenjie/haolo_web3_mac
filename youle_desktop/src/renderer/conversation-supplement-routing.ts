export const CONVERSATION_SUPPLEMENT_STALE_TURN_MS = 30 * 60 * 1000;

export type ConversationSupplementRoutingState = {
  isLocalCodexThread: boolean;
  hasCodexWork: boolean;
  hasActiveTurn: boolean;
  canSteerTurn: boolean;
  isWindowClosed: boolean;
  activeTurnStartedAtMs?: number | null;
  hasCodexSendInFlight?: boolean;
  isThreadBusy?: boolean;
  nowMs?: number;
  staleTurnMs?: number;
};

export function isConversationSupplementActiveTurnFresh(state: Pick<ConversationSupplementRoutingState, "activeTurnStartedAtMs" | "nowMs" | "staleTurnMs">) {
  const startedAtMs = Number(state.activeTurnStartedAtMs);
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return false;
  const nowMs = Number.isFinite(state.nowMs) ? Number(state.nowMs) : Date.now();
  const staleTurnMs = Number.isFinite(state.staleTurnMs) ? Number(state.staleTurnMs) : CONVERSATION_SUPPLEMENT_STALE_TURN_MS;
  return nowMs - startedAtMs <= Math.max(0, staleTurnMs);
}

export function shouldOpenConversationSupplementWindow(state: ConversationSupplementRoutingState) {
  return Boolean(
    state.isLocalCodexThread &&
      state.hasCodexWork &&
      state.hasActiveTurn &&
      state.canSteerTurn &&
      !state.isWindowClosed &&
      isConversationSupplementActiveTurnFresh(state),
  );
}

export function shouldRecoverStaleCodexComposerWork(state: ConversationSupplementRoutingState) {
  if (!state.isLocalCodexThread || !state.hasCodexWork || !state.isThreadBusy || state.hasCodexSendInFlight) return false;
  if (!state.hasActiveTurn) return true;
  return !isConversationSupplementActiveTurnFresh(state);
}

export type ConversationSupplementComposerSubmitAction = "send" | "supplement" | "interrupt";

export function conversationSupplementComposerSubmitAction(state: ConversationSupplementRoutingState): ConversationSupplementComposerSubmitAction {
  if (!state.isThreadBusy) return "send";
  if (shouldOpenConversationSupplementWindow(state)) return "supplement";
  return "interrupt";
}

export function isConversationSupplementTargetTurnMessage(targetTurnId: unknown, messageTurnId: unknown) {
  const target = typeof targetTurnId === "string" ? targetTurnId.trim() : "";
  if (!target) return true;
  const candidate = typeof messageTurnId === "string" ? messageTurnId.trim() : "";
  return Boolean(candidate && candidate === target);
}
