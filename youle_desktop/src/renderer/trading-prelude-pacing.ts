import type { Message } from './domain';

export const TRADING_PRELUDE_INTERVAL_MS = 1000;

type Run = {
  threadId: string;
  shown: number;
  lastShownAt: number;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
type Options = {
  refresh: (threadId: string) => void;
  scope: () => unknown;
  isVisible: (threadId: string) => boolean;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  afterRender?: (callback: () => void) => void;
};

/** Pace only live local preludes. The canonical transcript and analysis keep running. */
export class TradingPreludePacer {
  private readonly runs = new Map<string, Run>();
  private currentScope: unknown;
  private readonly now: () => number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly afterRender: (callback: () => void) => void;

  constructor(private readonly options: Options) {
    this.now = options.now || (() => performance.now());
    this.setTimer = options.setTimer || globalThis.setTimeout.bind(globalThis);
    this.clearTimer = options.clearTimer || globalThis.clearTimeout.bind(globalThis);
    this.afterRender = options.afterRender || (callback => globalThis.queueMicrotask(callback));
  }

  private syncScope() {
    const scope = this.options.scope();
    if (this.currentScope === scope) return;
    for (const run of this.runs.values()) this.finish(run);
    this.runs.clear();
    this.currentScope = scope;
  }

  private finish(run: Run) {
    run.settled = true;
    if (run.timer !== undefined) this.clearTimer(run.timer);
    run.timer = undefined;
  }

  private wake(run: Run, delay: number) {
    if (run.timer !== undefined || !Number.isFinite(run.lastShownAt)) return;
    const scope = this.currentScope;
    run.timer = this.setTimer(() => {
      run.timer = undefined;
      if (scope !== this.options.scope() || !this.options.isVisible(run.threadId)) {
        this.finish(run);
        return;
      }
      this.options.refresh(run.threadId);
    }, Math.max(0, delay));
  }

  private markShown(run: Run) {
    if (run.timer !== undefined) this.clearTimer(run.timer);
    run.timer = undefined;
    run.lastShownAt = Infinity;
    const scope = this.currentScope;
    // Start the interval after the current DOM update, not before a costly
    // initial full render; all three bubbles then get the same reading time.
    this.afterRender(() => {
      if (run.settled || scope !== this.options.scope()) return;
      run.lastShownAt = this.now();
      this.wake(run, TRADING_PRELUDE_INTERVAL_MS);
    });
  }

  moveThread(previousId: string, nextId: string) {
    for (const run of this.runs.values()) if (run.threadId === previousId) run.threadId = nextId;
  }

  cancelThread(threadId: string) {
    for (const run of this.runs.values()) if (run.threadId === threadId) this.finish(run);
  }

  isWaiting(threadId: string) {
    this.syncScope();
    return [...this.runs.values()].some(run => run.threadId === threadId && !run.settled);
  }

  project(
    threadId: string,
    messages: Message[],
    pendingItemId: string | undefined,
    phaseFor: (id: string) => unknown,
  ): Message[] {
    this.syncScope();
    if (!this.options.isVisible(threadId)) {
      this.cancelThread(threadId);
      return messages;
    }
    let userIndex = messages.length - 1;
    while (userIndex >= 0 && messages[userIndex].kind !== 'user_text') userIndex--;
    const receipt = messages[userIndex + 1];
    if (userIndex < 0 || !receipt?.id.startsWith('trading-send-receipt-')) {
      this.cancelThread(threadId);
      return messages;
    }
    // A persisted receipt alone must never restart the animation on history reads.
    let run = this.runs.get(receipt.id);
    if (!run && messages[userIndex].id === pendingItemId) {
      this.cancelThread(threadId);
      run = {threadId, shown: 0, lastShownAt: this.now(), settled: false};
      this.runs.set(receipt.id, run);
      this.markShown(run);
    }
    if (!run || run.settled) return messages;
    run.threadId = threadId;
    const afterReceipt = messages.slice(userIndex + 2);
    if (afterReceipt.some(message => phaseFor(message.id) === 'error')) {
      this.finish(run);
      return messages;
    }
    const first = afterReceipt[0];
    const match = first && /^(trading-.+-progress-\d+-[a-f0-9]+)-1$/.exec(first.id);
    if (!match || phaseFor(first.id) !== 'preparing') {
      if (first) this.finish(run); // Ordinary replies and historical messages stay immediate.
      return messages;
    }
    const second = afterReceipt.find(message => message.id === `${match[1]}-2` && phaseFor(message.id) === 'loading');
    if (!second && afterReceipt.length > 1) {
      this.finish(run); // A failed/short-circuited preflight has no second prelude.
      return messages;
    }
    const now = this.now();
    const elapsed = now - run.lastShownAt;
    const next = run.shown === 0 ? first : run.shown === 1 ? second : null;
    if (next && elapsed >= TRADING_PRELUDE_INTERVAL_MS) {
      // Release only one bubble even after a delayed timer or a burst of progress.
      run.shown++;
      this.markShown(run);
    }
    if (run.shown === 2 && now - run.lastShownAt >= TRADING_PRELUDE_INTERVAL_MS) {
      this.finish(run);
      return messages;
    }
    if (run.shown === 0 || second || run.shown === 2) {
      this.wake(run, TRADING_PRELUDE_INTERVAL_MS - (now - run.lastShownAt));
    }
    // Keep a fast report behind the prelude for one reading interval. It is
    // already generated/persisted; this only controls the visible message list.
    const lastVisible = run.shown === 0 ? receipt : run.shown === 1 ? first : second!;
    return messages.slice(0, messages.indexOf(lastVisible) + 1);
  }
}
