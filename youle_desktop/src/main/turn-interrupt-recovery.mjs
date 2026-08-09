const TURN_ID_PATTERN = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const ACTIVE_TURN_MISMATCH_PATTERN = new RegExp(
  `expected active turn id\\s+[\`'"]?${TURN_ID_PATTERN}[\`'"]?\\s+but found\\s+[\`'"]?${TURN_ID_PATTERN}[\`'"]?`,
  "i",
);

export function activeTurnMismatchFromError(error, requestedTurnId) {
  const requested = String(requestedTurnId || "").trim();
  if (!requested) return null;
  const message = error instanceof Error ? error.message : String(error?.message || error || "");
  const match = message.match(ACTIVE_TURN_MISMATCH_PATTERN);
  if (!match) return null;
  const expectedTurnId = match[1];
  const activeTurnId = match[2];
  if (expectedTurnId.toLowerCase() !== requested.toLowerCase()) return null;
  if (activeTurnId.toLowerCase() === expectedTurnId.toLowerCase()) return null;
  return { expectedTurnId, activeTurnId };
}

export async function interruptTurnWithActiveMismatchRetry({ turnId, requestInterrupt, onMismatch }) {
  try {
    return {
      result: await requestInterrupt(turnId),
      interruptedTurnId: turnId,
      recoveredMismatch: false,
    };
  } catch (error) {
    const mismatch = activeTurnMismatchFromError(error, turnId);
    if (!mismatch) throw error;
    await onMismatch?.(mismatch);
    return {
      result: await requestInterrupt(mismatch.activeTurnId),
      interruptedTurnId: mismatch.activeTurnId,
      recoveredMismatch: true,
    };
  }
}
