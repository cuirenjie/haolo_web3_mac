import { ANALYSIS_RECOVERY_MODEL, ANALYSIS_RECOVERY_EFFORT, ANALYSIS_RECOVERY_PROVIDER, isRecoverableAnalysisModelFailure } from "./analysis-model-recovery.mjs";

export const AUTOMATIC_TURN_RECOVERY_MARKER = "<haolo_automatic_turn_recovery>";

const DEFAULT_NO_PROGRESS_FAILURE_LIMIT = 3;
const DEFAULT_RECOVERY_DELAYS_MS = [1_500, 4_000, 8_000, 15_000];

export function isRecoverableAutomaticTurnFailure({
  errorClass,
  httpStatus,
  status,
  willRetry,
  retryable,
  detail,
} = {}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (["cancelled", "canceled", "interrupted", "aborted"].includes(normalizedStatus)) return false;
  // A willRetry notification belongs to Codex's in-place transport retry. A
  // second logical turn here could overlap it and duplicate tool effects.
  if (willRetry === true) return false;
  return isRecoverableAnalysisModelFailure({ errorClass, httpStatus, status, willRetry, retryable, detail }, {
    allowUnknownTerminal: ["failed", "error"].includes(normalizedStatus),
  });
}

export function buildAutomaticTurnRecoveryPrompt({
  failedTurnId,
  attempt,
  childSummary,
} = {}) {
  const summary = normalizedChildSummary(childSummary);
  return [
    AUTOMATIC_TURN_RECOVERY_MARKER,
    "The previous root turn ended because model execution failed. Continue the same latest unfinished user task and prioritize actually completing it, using the original question, attachments, analysis snapshot and existing tool results in this thread.",
    "This is a logical continuation, not a replay of the user's request. Do not ask the user to type continue merely because the prior stream disconnected.",
    "Before doing more work, reconcile durable state: inspect all existing collaboration/sub-agent tasks and collect their results; wait for agents that are still making progress; do not spawn replacements for work that already completed; inspect files and tool results to determine which effects already happened.",
    "Never repeat an irreversible or externally visible action whose outcome is unknown. Reconcile it first, use idempotency evidence when available, and retry only unfinished safe work.",
    "If an earlier approach failed, adapt it. Finish the task, validate the result in proportion to risk, and return the final answer to the user.",
    `Recovery attempt: ${Math.max(1, Number(attempt) || 1)}. Failed turn: ${String(failedTurnId || "unknown")}.`,
    `Known child-agent snapshot: ${summary.total} total, ${summary.running} running, ${summary.completed} completed, ${summary.failed} failed, ${summary.unknown} unknown. Treat this as a hint and reconcile live state before acting.`,
    "</haolo_automatic_turn_recovery>",
  ].join("\n");
}

export class TurnAutoRecoveryCoordinator {
  constructor({
    startRecovery,
    onEvent,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    recoveryDelaysMs = DEFAULT_RECOVERY_DELAYS_MS,
    noProgressFailureLimit = DEFAULT_NO_PROGRESS_FAILURE_LIMIT,
    maxRecoveryAttempts = 3,
  } = {}) {
    if (typeof startRecovery !== "function") {
      throw new Error("TurnAutoRecoveryCoordinator requires startRecovery");
    }
    this.startRecovery = startRecovery;
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.recoveryDelaysMs = normalizedRecoveryDelays(recoveryDelaysMs);
    this.noProgressFailureLimit = Math.max(2, Number(noProgressFailureLimit) || DEFAULT_NO_PROGRESS_FAILURE_LIMIT);
    this.states = new Map();
    this.maxRecoveryAttempts = Math.max(1, Math.floor(Number(maxRecoveryAttempts) || 3));
    this.parentThreadIdsByChild = new Map();
    this.childThreadIdsByParent = new Map();
    this.childStatuses = new Map();
    this.chainSequence = 0;
  }

  registerChild(parentThreadId, childThreadId) {
    const parent = normalizedId(parentThreadId);
    const child = normalizedId(childThreadId);
    if (!parent || !child || parent === child) return;
    this.parentThreadIdsByChild.set(child, parent);
    const children = this.childThreadIdsByParent.get(parent) || new Set();
    children.add(child);
    this.childThreadIdsByParent.set(parent, children);
    if (!this.childStatuses.has(child)) this.childStatuses.set(child, "unknown");
  }

  noteChildStatus(childThreadId, status) {
    const child = normalizedId(childThreadId);
    if (!child) return;
    const normalizedStatus = normalizedChildStatus(status);
    if (this.childStatuses.get(child) === normalizedStatus) return;
    this.childStatuses.set(child, normalizedStatus);
    this.noteProgress(child);
  }

  noteProgress(threadId) {
    const root = this.rootThreadId(threadId);
    if (!root) return;
    const state = this.ensureState(root);
    state.progressVersion += 1;
  }

  noteUserTurn(threadId) {
    const root = this.rootThreadId(threadId);
    this.cancel(root, "user_turn", { reset: true });
    this.forgetChildren(root);
    if (root) this.ensureState(root).awaitingUserTurnStart = true;
  }

  noteTurnStarted(threadId, turnId) {
    const root = this.rootThreadId(threadId);
    if (root && root === normalizedId(threadId) && turnId) {
      const state = this.ensureState(root);
      state.latestTurnId = normalizedId(turnId);
      state.awaitingUserTurnStart = false;
    }
  }

  setRecoverySelection(threadId, selection) {
    const root = this.rootThreadId(threadId);
    if (!root) return;
    // Host-owned capabilities for this user turn, including replacement threads.
    // Changing selection must not reset cancellation, generation or retry limits.
    this.ensureState(root).recoverySelection = selection ? { ...selection } : null;
  }

  noteSuccessfulTurn(threadId, turnId) {
    const root = this.rootThreadId(threadId);
    if (root !== normalizedId(threadId)) return;
    if (this.states.get(root)?.awaitingUserTurnStart) return;
    const latestTurnId = this.states.get(root)?.latestTurnId;
    if (latestTurnId && turnId && latestTurnId !== normalizedId(turnId)) return;
    this.cancel(root, "completed");
    this.forgetChildren(root);
  }

  handleTerminalFailure({
    threadId,
    failedTurnId,
    errorClass,
    httpStatus,
    detail,
    status = "failed",
    willRetry = false,
    retryable,
  } = {}) {
    const root = this.rootThreadId(threadId);
    if (!root || !isRecoverableAutomaticTurnFailure({ errorClass, httpStatus, status, willRetry, retryable, detail })) {
      return { status: "ignored" };
    }
    const state = this.ensureState(root);
    if (state.cancelled || state.awaitingUserTurnStart) return { status: "ignored" };
    const normalizedTurnId = normalizedId(failedTurnId);
    if (normalizedTurnId && state.decisionsByTurnId.has(normalizedTurnId)) {
      return { ...state.decisionsByTurnId.get(normalizedTurnId), duplicate: true };
    }
    if (state.latestTurnId && normalizedTurnId && state.latestTurnId !== normalizedTurnId && !normalizedTurnId.startsWith("start-")) return { status: "ignored" };
    if (state.recoveryAttempt >= this.maxRecoveryAttempts) {
      const decision = this.publicDecision(state, { status: "exhausted", failedTurnId: normalizedTurnId, errorClass });
      if (normalizedTurnId) state.decisionsByTurnId.set(normalizedTurnId, decision);
      this.emit("exhausted", root, decision);
      return decision;
    }

    const failureKey = normalizedFailureKey(errorClass, httpStatus, detail);
    const madeProgress = state.lastFailureProgressVersion == null
      || state.progressVersion !== state.lastFailureProgressVersion
      || state.lastFailureKey !== failureKey;
    state.noProgressFailures = madeProgress ? 1 : state.noProgressFailures + 1;
    state.lastFailureProgressVersion = state.progressVersion;
    state.lastFailureKey = failureKey;
    state.recoveryAttempt += 1;

    this.clearScheduledTimer(state);
    state.generation += 1;
    const generation = state.generation;
    const delayMs = this.recoveryDelayMs(state.noProgressFailures, errorClass);
    const coolingDown = state.noProgressFailures >= this.noProgressFailureLimit;
    const decision = this.publicDecision(state, {
      status: coolingDown ? "cooling_down" : "scheduled",
      failedTurnId: normalizedTurnId,
      errorClass,
      delayMs,
    });
    if (normalizedTurnId) state.decisionsByTurnId.set(normalizedTurnId, decision);
    state.timer = this.setTimer(() => {
      void this.startScheduledRecovery(root, generation, decision);
    }, delayMs);
    state.timer?.unref?.();
    this.emit(coolingDown ? "cooling_down" : "scheduled", root, decision);
    return decision;
  }

  cancel(threadId, reason = "cancelled", { reset = false } = {}) {
    const root = this.rootThreadId(threadId);
    if (!root) return false;
    const state = this.states.get(root);
    if (!state) return false;
    this.clearScheduledTimer(state);
    state.generation += 1;
    state.cancelled = true;
    this.emit("cancelled", root, { chainId: state.chainId, reason });
    if (reset) this.states.delete(root);
    return true;
  }

  shutdown() {
    for (const state of this.states.values()) this.clearScheduledTimer(state);
    this.states.clear();
    this.parentThreadIdsByChild.clear();
    this.childThreadIdsByParent.clear();
    this.childStatuses.clear();
  }

  childSummary(parentThreadId) {
    const summary = { total: 0, running: 0, completed: 0, failed: 0, unknown: 0 };
    for (const child of this.childThreadIdsByParent.get(normalizedId(parentThreadId)) || []) {
      summary.total += 1;
      summary[normalizedChildStatus(this.childStatuses.get(child))] += 1;
    }
    return summary;
  }

  forgetChildren(parentThreadId) {
    const parent = normalizedId(parentThreadId);
    if (!parent) return;
    for (const child of this.childThreadIdsByParent.get(parent) || []) {
      this.parentThreadIdsByChild.delete(child);
      this.childStatuses.delete(child);
    }
    this.childThreadIdsByParent.delete(parent);
  }

  rootThreadId(threadId) {
    let current = normalizedId(threadId);
    const visited = new Set();
    while (current && this.parentThreadIdsByChild.has(current) && !visited.has(current)) {
      visited.add(current);
      current = this.parentThreadIdsByChild.get(current);
    }
    return current;
  }

  ensureState(rootThreadId) {
    const root = normalizedId(rootThreadId);
    let state = this.states.get(root);
    if (!state) {
      this.chainSequence += 1;
      state = {
        chainId: `recovery-${this.chainSequence}`,
        progressVersion: 0,
        lastFailureProgressVersion: null,
        lastFailureKey: "",
        noProgressFailures: 0,
        recoveryAttempt: 0,
        generation: 0,
        timer: null,
        activeRecoveryTurnId: null,
        decisionsByTurnId: new Map(),
      };
      this.states.set(root, state);
    }
    return state;
  }

  clearScheduledTimer(state) {
    if (!state?.timer) return;
    this.clearTimer(state.timer);
    state.timer = null;
  }

  recoveryDelayMs(noProgressFailures, errorClass) {
    if (noProgressFailures >= this.noProgressFailureLimit) return 60_000;
    const index = Math.min(Math.max(0, noProgressFailures - 1), this.recoveryDelaysMs.length - 1);
    const base = this.recoveryDelaysMs[index];
    return ["rate_limit", "concurrency_limit"].includes(String(errorClass || "").toLowerCase())
      ? Math.max(8_000, base)
      : base;
  }

  publicDecision(state, values) {
    return {
      ...values,
      chainId: state.chainId,
      attempt: state.recoveryAttempt,
      noProgressFailures: state.noProgressFailures,
      noProgressFailureLimit: this.noProgressFailureLimit,
      ...(state.recoverySelection || {
        modelId: ANALYSIS_RECOVERY_MODEL,
        modelProvider: ANALYSIS_RECOVERY_PROVIDER,
        reasoningEffort: ANALYSIS_RECOVERY_EFFORT,
      }),
    };
  }

  async startScheduledRecovery(rootThreadId, generation, decision) {
    const state = this.states.get(rootThreadId);
    if (!state || state.generation !== generation) return;
    state.timer = null;
    this.emit("starting", rootThreadId, decision);
    try {
      const childSummary = this.childSummary(rootThreadId);
      const prompt = buildAutomaticTurnRecoveryPrompt({
        failedTurnId: decision.failedTurnId,
        attempt: decision.attempt,
        childSummary,
      });
      const result = await this.startRecovery({
        threadId: rootThreadId,
        modelId: decision.modelId,
        modelProvider: decision.modelProvider,
        reasoningEffort: decision.reasoningEffort,
        failedTurnId: decision.failedTurnId,
        attempt: decision.attempt,
        chainId: decision.chainId,
        childSummary,
        prompt,
        isCurrent: () => this.states.get(rootThreadId) === state && state.generation === generation,
      });
      if (this.states.get(rootThreadId) !== state || state.generation !== generation) return;
      const activeTurnId = normalizedId(result?.turn?.id || result?.turnId || result?.turn_id || result?.id);
      state.activeRecoveryTurnId = activeTurnId || null;
      this.emit("started", rootThreadId, { ...decision, turnId: activeTurnId || null, childSummary });
    } catch (error) {
      if (this.states.get(rootThreadId) !== state || state.generation !== generation) return;
      this.emit("start_failed", rootThreadId, {
        ...decision,
        detail: String(error?.message || error || "automatic recovery start failed"),
      });
      if (state.generation !== generation) return;
      const next = this.handleTerminalFailure({
        threadId: rootThreadId,
        failedTurnId: `start-${generation}`,
        errorClass: classifyStartFailure(error),
        httpStatus: error?.status || error?.httpStatus,
        retryable: error?.retryable,
        detail: [error?.code, error?.category, error?.message || error].filter(Boolean).join(" "),
        status: "failed",
      });
      if (next.status === "ignored" || next.status === "exhausted") {
        this.emit("exhausted", rootThreadId, { ...decision, status: "exhausted", failedToStart: true });
      }
    }
  }

  emit(event, threadId, payload) {
    try {
      this.onEvent({ event, threadId, ...payload });
    } catch {
      // Recovery must remain independent from diagnostics/UI observers.
    }
  }
}

function normalizedId(value) {
  return String(value || "").trim();
}

function normalizedRecoveryDelays(values) {
  const delays = Array.isArray(values)
    ? values.map((value) => Math.max(0, Number(value) || 0)).filter((value) => Number.isFinite(value))
    : [];
  return delays.length ? delays : [...DEFAULT_RECOVERY_DELAYS_MS];
}

function normalizedFailureKey(errorClass, httpStatus, detail) {
  const normalizedDetail = String(detail || "")
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .slice(0, 600);
  return `${String(errorClass || "unknown").toLowerCase()}:${Number(httpStatus) || 0}:${normalizedDetail}`;
}

function classifyStartFailure(error) {
  const text = String(error?.message || error || "");
  if (/rate limit|too many requests|\b429\b/i.test(text)) return "rate_limit";
  if (/concurren|too many concurrent/i.test(text)) return "concurrency_limit";
  if (/timed?\s*out|timeout|deadline/i.test(text)) return "timeout";
  if (/connection refused|ECONNREFUSED|proxy/i.test(text)) return "connection_refused";
  return "stream_disconnected";
}

function normalizedChildStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["running", "in_progress", "started", "working"].includes(status)) return "running";
  if (["completed", "complete", "success", "succeeded"].includes(status)) return "completed";
  if (["failed", "error", "errored", "cancelled", "canceled", "interrupted"].includes(status)) return "failed";
  return "unknown";
}

function normalizedChildSummary(value) {
  const summary = value && typeof value === "object" ? value : {};
  return {
    total: Math.max(0, Number(summary.total) || 0),
    running: Math.max(0, Number(summary.running) || 0),
    completed: Math.max(0, Number(summary.completed) || 0),
    failed: Math.max(0, Number(summary.failed) || 0),
    unknown: Math.max(0, Number(summary.unknown) || 0),
  };
}
