// Only Host recovery notifications and the renderer's own replay receipts may
// link turns. Timestamps and "latest turn" are not proof of request ownership.
export class ExternalChannelRecoveryTurns {
  constructor({ limit = 1024 } = {}) {
    this.limit = limit;
    this.edges = new Map();
    this.chains = new Map();
  }

  key(threadId, value) { return JSON.stringify([threadId, value]); }

  link(threadId, originalTurnId, recoveredTurnId) {
    if (!threadId || !originalTurnId || !recoveredTurnId || originalTurnId === recoveredTurnId) return;
    const key = this.key(threadId, originalTurnId);
    const targets = this.edges.get(key) || new Set();
    targets.add(recoveredTurnId);
    this.edges.delete(key);
    this.edges.set(key, targets);
    while (targets.size > 16) targets.delete(targets.values().next().value);
    while (this.edges.size > this.limit) this.edges.delete(this.edges.keys().next().value);
  }

  note(threadId, turnId, meta) {
    if (!threadId || !turnId || !meta?.chainId) return;
    const key = this.key(threadId, meta.chainId);
    if (["scheduled", "cooling_down", "starting"].includes(meta.status)) {
      if (!this.chains.has(key)) this.chains.set(key, meta.failedTurnId || turnId);
      while (this.chains.size > this.limit) this.chains.delete(this.chains.keys().next().value);
    }
    if (meta.status === "started") {
      const original = this.chains.get(key) || meta.failedTurnId;
      this.link(threadId, original, turnId);
    }
  }

  matches(threadId, originalTurnId, candidateTurnId) {
    if (!threadId || !originalTurnId || !candidateTurnId) return false;
    const pending = [originalTurnId], seen = new Set();
    while (pending.length && seen.size < this.limit) {
      const current = pending.shift();
      if (current === candidateTurnId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(this.edges.get(this.key(threadId, current)) || []));
    }
    return false;
  }
}
