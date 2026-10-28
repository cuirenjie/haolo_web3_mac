type RefreshEntry = {
  scope: string;
  orderNo: string;
  attempts: number;
  timer: number | null;
  promise: Promise<boolean> | null;
};

// Payment polling ends once the server confirms fulfillment. Account reads
// must recover independently, including after the customer returns to chat.
export function createRechargeProfileRefresh(options: {
  refresh: () => Promise<boolean>;
  isCurrentScope: (scope: string) => boolean;
  onRefreshed: () => void;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timer: number) => void;
}) {
  const completed = new Set<string>();
  const pending = new Map<string, RefreshEntry>();
  const keyOf = (scope: string, orderNo: string) => JSON.stringify([scope, orderNo]);

  async function attempt(entry: RefreshEntry): Promise<boolean> {
    const key = keyOf(entry.scope, entry.orderNo);
    if (!options.isCurrentScope(entry.scope) || pending.get(key) !== entry) {
      if (pending.get(key) === entry) pending.delete(key);
      return false;
    }
    let refreshed = false;
    try {
      refreshed = await options.refresh();
    } catch {
      // A failed read is retryable here; this never replays a payment.
    }
    if (pending.get(key) !== entry) return false;
    if (!options.isCurrentScope(entry.scope)) {
      pending.delete(key);
      return false;
    }
    if (refreshed) {
      completed.add(key);
      pending.delete(key);
      options.onRefreshed();
      return true;
    }
    const delay = Math.min(30_000, 2_000 * 2 ** Math.min(entry.attempts++, 4));
    entry.timer = options.schedule(() => {
      entry.timer = null;
      void run(entry);
    }, delay);
    return false;
  }

  function run(entry: RefreshEntry) {
    if (entry.promise) return entry.promise;
    const promise = attempt(entry).finally(() => { entry.promise = null; });
    entry.promise = promise;
    return promise;
  }

  return {
    refresh(orderNo: string, scope: string): Promise<boolean> {
      if (!orderNo || !options.isCurrentScope(scope)) return Promise.resolve(false);
      const key = keyOf(scope, orderNo);
      if (completed.has(key)) return Promise.resolve(true);
      let entry = pending.get(key);
      if (!entry) {
        entry = { scope, orderNo, attempts: 0, timer: null, promise: null };
        pending.set(key, entry);
      }
      if (entry.timer != null) return Promise.resolve(false);
      return run(entry);
    },
    reset() {
      for (const entry of pending.values()) {
        if (entry.timer != null) options.cancel(entry.timer);
      }
      pending.clear();
      completed.clear();
    },
  };
}
