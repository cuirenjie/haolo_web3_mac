import type {SavedExecutionPlan} from './execution-plans.ts';

export type PlanSource = {threadId: string; messageId?: string; title?: string};
const real = (id: unknown) => typeof id === 'string' && id.trim() && !id.startsWith('cloud-run:') ? id.trim() : '';

export function resolveSavedPlanSource(plan: SavedExecutionPlan, aliases: (id: string) => string,
  hidden: (id: string) => boolean): string {
  if (isGeneratedPlanRecord(plan.sourceMessageId)) return '';
  for (const value of [plan.sourceThreadId, plan.cloudReport?.origin?.sourceThreadId]) {
    const id = real(value), resolved = id && aliases(id);
    if (resolved && !hidden(resolved)) return resolved;
  }
  return '';
}

export function linkSavedPlanSource(plan: SavedExecutionPlan, source: PlanSource): SavedExecutionPlan {
  return {...plan, ...(source.title ? {sourceTitle:source.title} : {}), sourceThreadId:source.threadId, sourceMessageId:source.messageId || plan.sourceMessageId,
    ...(plan.cloudReport ? {cloudReport:{...plan.cloudReport,origin:{...plan.cloudReport.origin,
      sourceThreadId:source.threadId,storageSessionId:source.threadId,analysisJobId:plan.cloudReport.origin?.analysisJobId || ''}}} : {})};
}

export const isGeneratedPlanRecord = (id: unknown) => typeof id === 'string' && id.startsWith('saved-plan-report-');
export const isObsoletePlanRecoveryNotice = (id: unknown) => typeof id === 'string'
  && /^saved-plan-report-[0-9a-f-]{36}-notice$/i.test(id);

// Never turn transient history/network failures into duplicate conversations.
export function missingPlanSource(error: unknown) {
  return /thread not found|thread not loaded|no rollout found|not_found|is archived|does not exist/i.test(String((error as Error)?.message || error));
}

export function createSavedPlanSourceResolver(deps: {
  scope(): string | null; lookup(plan: SavedExecutionPlan): string;
  unavailable?(): string;
  read(threadId: string): Promise<unknown>;
  findOriginal(plan: SavedExecutionPlan, valid: () => boolean): Promise<PlanSource | null>;
  save(plan: SavedExecutionPlan, source: PlanSource, valid: () => boolean): Promise<void>;
}) {
  const pending = new Map<string, Promise<string>>();
  return (plan: SavedExecutionPlan, isCurrent: () => boolean): Promise<string> => {
    const scope = deps.scope();
    if (!scope || !isCurrent()) return Promise.resolve('');
    const key = `${scope}:${plan.id}`;
    if (pending.has(key)) return pending.get(key)!;
    const valid = () => deps.scope() === scope && isCurrent();
    const task = (async () => {
      let threadId = deps.lookup(plan);
      if (threadId) {
        try { await deps.read(threadId); }
        catch (error) { if (!missingPlanSource(error)) throw error; threadId = ''; }
      }
      if (!valid()) return '';
      const source = threadId ? {threadId} : plan.cloudReport ? await deps.findOriginal(plan, valid) : null;
      if (!valid()) return '';
      if (!source) throw new Error(deps.unavailable?.() || 'The source conversation is unavailable');
      await deps.save(plan, source, valid);
      return valid() ? source.threadId : '';
    })();
    pending.set(key, task);
    void task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => {});
    return task;
  };
}
