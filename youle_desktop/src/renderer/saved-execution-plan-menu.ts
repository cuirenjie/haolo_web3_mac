import type { SavedExecutionPlan, ExecutionPlanEndReason, ExecutionPlanStatus } from './execution-plans.ts';
import { createPlanDialog, planChartContext, planMenuText } from './execution-plan-menu.ts';
import type { CloudTradingReport } from '../main/cloud-plan-contract.mjs';

export type SavedPlanMenuAction = 'end' | 'reopen' | 'delete' | 'chart' | 'conversation';
export type SavedPlanMenuContext = {
  scope: string; plan: SavedExecutionPlan; busy: boolean; chartBusy: boolean; sourceAvailable: boolean;
};
const labels = {
  end: ['结束', 'End plan', '結束'], reopen: ['重新打开', 'Reopen plan', '重新打開'],
  delete: ['删除', 'Delete', '刪除'], conversation: ['跳转相关会话', 'Open related conversation', '跳轉相關對話'],
  reasons: ['选择计划结束原因', 'Choose why the plan ended', '選擇計畫結束原因'],
  take_profit: ['已止盈', 'Take profit', '已止盈'], stop_loss: ['已止损', 'Stop loss', '已止損'],
  cancelled: ['手动取消', 'Manually cancelled', '手動取消'], expired: ['已过期', 'Expired', '已過期'],
  back: ['返回', 'Back', '返回'], cancel: ['取消', 'Cancel', '取消'],
  unavailable: ['此计划的来源会话不可用', 'The source conversation is unavailable', '此計畫的來源對話無法使用'],
} as const;
export function savedPlanMenuText(key: keyof typeof labels, language: string) {
  return labels[key][language === 'en' ? 1 : /zh-(TW|Hant)/.test(language) ? 2 : 0];
}
export function savedPlanSourceThreadId(plan: SavedExecutionPlan) {
  return [plan.sourceThreadId, plan.cloudReport?.origin?.sourceThreadId]
    .map(value => String(value || '').trim()).find(value => value && !value.startsWith('cloud-run:')) || '';
}
export function savedPlanMenuOptions(context: SavedPlanMenuContext) {
  return [
    { action: context.plan.status === 'ended' ? 'reopen' : 'end', enabled: !context.busy },
    { action: 'chart', enabled: !context.busy && !context.chartBusy && context.sourceAvailable },
    { action: 'conversation', enabled: !context.busy && context.sourceAvailable },
    { action: 'delete', enabled: !context.busy },
  ] as Array<{ action: SavedPlanMenuAction; enabled: boolean }>;
}
export function savedPlanMenuRevision(context: SavedPlanMenuContext) {
  const {plan} = context, remote = plan.cloudReport?.planRecords[0];
  return JSON.stringify([context.scope, plan.id, plan.status, plan.statusUpdatedAt, plan.endReason,
    remote?.version, plan.cloudReport?.resultHash, savedPlanSourceThreadId(plan), plan.sourceMessageId, plan.content]);
}

export async function navigateSavedPlan(
  plan: SavedExecutionPlan,
  destination: 'chart' | 'conversation',
  deps: {
    language(): string; valid(): boolean; sourceAvailable(threadId: string): boolean;
    ensureSource?(plan: SavedExecutionPlan): Promise<string>;
    initializeChart(threadId: string): void;
    selectThread(threadId: string): Promise<unknown>;
    isCurrentThread(threadId: string): boolean;
    showChart(report: CloudTradingReport | null, context: {marketId: string; interval: string}, threadId: string, valid: () => boolean): Promise<unknown>;
  },
) {
  if (!deps.valid()) return;
  const threadId = deps.ensureSource ? await deps.ensureSource(plan) : savedPlanSourceThreadId(plan);
  if (!deps.valid()) return;
  if (deps.ensureSource && !threadId) return;
  if (!threadId || !deps.sourceAvailable(threadId)) throw new Error(savedPlanMenuText('unavailable', deps.language()));
  // Resolve the original analysis timeframe before changing any workspace state.
  const chart = destination === 'chart' ? planChartContext(plan) : null;
  if (chart) deps.initializeChart(threadId);
  await deps.selectThread(threadId);
  const current = () => deps.valid() && deps.isCurrentThread(threadId);
  if (chart && current()) await deps.showChart(plan.cloudReport || null, chart, threadId, current);
}

export function createSavedExecutionPlanMenu(deps: {
  language(): string; scope(): string | null; resolve(planId: string): SavedPlanMenuContext | null;
  lifecycle(planId: string, status: ExecutionPlanStatus, reason?: ExecutionPlanEndReason): Promise<unknown>;
  remove(planId: string, valid: () => boolean): Promise<unknown>;
  navigate(plan: SavedExecutionPlan, destination: 'chart' | 'conversation', valid: () => boolean): Promise<unknown>;
  error(error: unknown): void;
}) {
  const bound = new WeakSet<HTMLElement>(), pending = new Set<string>();
  let opened: {dialog: HTMLDialogElement; id: string; stamp: string} | null = null;
  function open(card: HTMLElement) {
    const id = card.dataset.executionPlanId || '', context = deps.resolve(id);
    if (!context || context.busy || pending.has(context.scope + ':' + id) || opened?.dialog.isConnected) return;
    const language = deps.language(), stamp = savedPlanMenuRevision(context);
    const dialog = createPlanDialog(planMenuText('menu', language), 'execution-plan-option-menu saved-execution-plan-menu');
    opened = {dialog, id, stamp};
    const valid = () => deps.scope() === context.scope;
    const fresh = () => {
      const next = deps.resolve(id);
      return valid() && next && !next.busy && savedPlanMenuRevision(next) === stamp ? next : null;
    };
    async function run(action: SavedPlanMenuAction, reason?: ExecutionPlanEndReason) {
      const next = fresh(), key = context!.scope + ':' + id;
      if (!next || pending.has(key) || !savedPlanMenuOptions(next).some(option => option.action === action && option.enabled)) {
        dialog.close(); return;
      }
      if (action === 'end' && !reason) { render(true); return; }
      pending.add(key);
      dialog.close();
      try {
        if (action === 'end') await deps.lifecycle(id, 'ended', reason);
        else if (action === 'reopen') await deps.lifecycle(id, 'pending');
        else if (action === 'delete') await deps.remove(id, valid);
        else await deps.navigate(next.plan, action, valid);
      } catch (error) { if (valid()) deps.error(error); }
      finally { pending.delete(key); }
    }
    function button(label: string, action: string, enabled: boolean, click: () => void) {
      const node = document.createElement('button');
      node.type = 'button'; node.dataset.savedPlanMenuAction = action;
      node.textContent = label; node.disabled = !enabled;
      node.addEventListener('click', click); dialog.append(node);
      return node;
    }
    function render(reasons = false) {
      dialog.replaceChildren();
      dialog.setAttribute('aria-label', reasons ? savedPlanMenuText('reasons', language) : planMenuText('menu', language));
      if (reasons) {
        const title = document.createElement('h2'); title.textContent = savedPlanMenuText('reasons', language); dialog.append(title);
        for (const reason of ['take_profit', 'stop_loss', 'cancelled', 'expired'] as const) {
          button(savedPlanMenuText(reason, language), reason, true, () => { void run('end', reason); });
        }
        button(savedPlanMenuText('back', language), 'back', true, () => { render(); });
      } else {
        for (const option of savedPlanMenuOptions(context!)) {
          const node = button(option.action === 'chart' ? planMenuText('chart', language) : savedPlanMenuText(option.action, language),
            option.action, option.enabled, () => { void run(option.action); });
          if (!context!.sourceAvailable && ['chart', 'conversation'].includes(option.action)) node.title = savedPlanMenuText('unavailable', language);
        }
      }
      dialog.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    dialog.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
    dialog.addEventListener('close', () => { if (opened?.dialog === dialog) opened = null; });
    render();
  }
  return {
    bind(container: ParentNode) {
      if (opened) {
        const current = deps.resolve(opened.id);
        if (!current || current.busy || savedPlanMenuRevision(current) !== opened.stamp) opened.dialog.close();
      }
      container.querySelectorAll<HTMLElement>('.execution-plan-card[data-execution-plan-id]').forEach(card => {
        const context = deps.resolve(card.dataset.executionPlanId || '');
        if (!context || bound.has(card)) return;
        bound.add(card); card.dataset.savedPlanMenuTrigger = 'true'; card.tabIndex = 0;
        card.setAttribute('role', 'button'); card.setAttribute('aria-haspopup', 'dialog');
        card.setAttribute('aria-label', `${context.plan.title} · ${planMenuText('menu', deps.language())}`);
        card.addEventListener('click', event => {
          if ((event.target as Element)?.closest('button,a,input,select,textarea') || window.getSelection()?.toString()) return;
          event.preventDefault(); event.stopPropagation(); open(card);
        });
        card.addEventListener('keydown', event => {
          if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation(); open(card);
        });
      });
    },
  };
}
