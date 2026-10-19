import { type SavedExecutionPlan } from './execution-plans.ts';

export function executionPlanCanAutoActivate(plan: SavedExecutionPlan, now = Date.now()) {
  if (plan.status !== 'pending' || plan.linkedAlertId) return false;
  const remote = plan.cloudReport?.planRecords[0];
  if (plan.cloudReport && (!remote?.saved || remote.deleted || remote.linkedAlertId)) return false;
  const expiry = remote?.expiresAt ?? plan.cloudReport?.executionPlan?.entryCondition?.expiresAt;
  return !(typeof expiry === 'number' && expiry <= now);
}

// Adding a plan authorizes reminders, including plans saved by older clients.
// Reconcile serially from refreshed account state; never invent a linked alert.
export function createExecutionPlanAutoActivator(options: {
  scope: () => string | null;
  read: () => readonly SavedExecutionPlan[];
  busy: (id: string) => boolean;
  activate: (id: string) => Promise<unknown>;
  failure: (error: unknown, plan: SavedExecutionPlan) => void;
  now?: () => number;
  schedule?: (run: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  const attempts = new Map<string, { count: number; after: number; error?: string }>();
  let running: Promise<void> | null = null, rerun = false, timer: ReturnType<typeof setTimeout> | null = null;
  const key = (scope: string, plan: SavedExecutionPlan) => JSON.stringify([scope, plan.id,
    plan.cloudReport?.planRecords[0]?.version ?? plan.statusUpdatedAt,
    plan.cloudReport?.planRecords[0]?.confirmationHash, new Date(now()).toISOString().slice(0, 10)]);
  function retryable(error: any) {
    if (error?.retryable === true || Number(error?.status) >= 500) return true;
    return !error?.code || ['CLOUD_PLAN_BUSY', 'ENTRY_WORKER_UNAVAILABLE', 'WINDOWS_WORKER_UNAVAILABLE',
      'PLAN_VERSION_CONFLICT', 'NETWORK_ERROR', 'REQUEST_TIMEOUT'].includes(error.code);
  }
  function arm() {
    if (timer !== null) cancel(timer);
    timer = null;
    const scope = options.scope();
    if (!scope) return;
    const identities = new Set(options.read().map(plan => key(scope, plan)));
    for (const identity of attempts.keys()) if (!identities.has(identity)) attempts.delete(identity);
    let next = Infinity;
    for (const plan of options.read()) {
      if (!executionPlanCanAutoActivate(plan, now())) continue;
      next = Math.min(next, options.busy(plan.id) ? now() + 1000 : attempts.get(key(scope, plan))?.after ?? now());
    }
    if (Number.isFinite(next)) timer = schedule(() => { timer = null; void reconcile(); }, Math.max(1000, next - now()));
  }
  function reconcile(): Promise<void> {
    if (running) { rerun = true; return running; }
    if (timer !== null) { cancel(timer); timer = null; }
    running = Promise.resolve().then(async () => {
      do {
        rerun = false;
        const scope = options.scope();
        if (!scope) return;
        for (const id of options.read().map(plan => plan.id)) {
          if (options.scope() !== scope) return;
          const plan = options.read().find(item => item.id === id);
          if (!plan || !executionPlanCanAutoActivate(plan, now()) || options.busy(id)) continue;
          const identity = key(scope, plan), previous = attempts.get(identity);
          if (previous && previous.after > now()) continue;
          const attempt = { count: (previous?.count ?? 0) + 1, after: Infinity, error: previous?.error };
          attempts.set(identity, attempt);
          try {
            await options.activate(id);
            const current = options.read().find(item => item.id === id);
            if (current && executionPlanCanAutoActivate(current, now())) attempt.after = now() + 1000;
          } catch (error: any) {
            attempt.after = retryable(error) ? now() + Math.min(300_000, 30_000 * 2 ** Math.min(attempt.count - 1, 4)) : Infinity;
            const message = String(error?.code || error?.message || error);
            if (options.scope() === scope && attempt.error !== message) options.failure(error, plan);
            attempt.error = message;
          }
        }
      } while (rerun);
    }).finally(() => { running = null; arm(); });
    return running;
  }
  return { reconcile };
}
