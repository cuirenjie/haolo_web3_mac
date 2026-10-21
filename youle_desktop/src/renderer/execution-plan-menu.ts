import { executionPlanBinanceMarketDetails, executionPlanHasConcreteTradingPlan, type ExecutionPlanCandidate, type SavedExecutionPlan } from './execution-plans.ts';

export type PlanMenuAction = 'add' | 'view' | 'chart' | 'sticky' | 'share';
export type PlanMenuContext = {
  key: string; scope: string; candidate: ExecutionPlanCandidate; saved?: SavedExecutionPlan;
  complete: boolean; busy: boolean; chartBusy: boolean;
};
const labels = {
  add: ['加入计划', 'Add to plan', '加入計畫'], view: ['查看计划', 'View plan', '查看計畫'],
  chart: ['跳转K线画线', 'Open chart drawings', '跳轉K線畫線'],
  sticky: ['便利贴', 'Sticky note', '便利貼'], share: ['分享计划', 'Share plan', '分享計畫'],
  menu: ['计划操作', 'Plan actions', '計畫操作'], close: ['关闭', 'Close', '關閉'],
} as const;
export function planMenuText(key: keyof typeof labels, language: string) {
  return labels[key][language === 'en' ? 1 : /zh-(TW|Hant)/.test(language) ? 2 : 0];
}
export function planMenuFacts(candidate: ExecutionPlanCandidate, now = Date.now()) {
  const remote = candidate.cloudReport?.planRecords[0];
  const scenario = remote?.scenario;
  const legacy = executionPlanBinanceMarketDetails(candidate);
  const typed = Number.isFinite(scenario?.entry) && scenario.entry > 0;
  const hasEntry = typed || executionPlanHasConcreteTradingPlan(candidate);
  const deadline = Number(remote?.expiresAt ?? candidate.cloudReport?.executionPlan.entryCondition?.expiresAt);
  return {
    hasEntry, expired: Number.isFinite(deadline) && deadline > 0 && deadline <= now,
    eligible: scenario?.eligible === false ? false : hasEntry,
    canShare: hasEntry && (typed ? ['long', 'short'].includes(scenario.side) : Boolean(legacy?.direction)),
  };
}
export function planChartContext(candidate: ExecutionPlanCandidate) {
  const report = candidate.cloudReport;
  if (report) return {marketId: report.marketId, interval: report.interval};
  const {symbol} = executionPlanBinanceMarketDetails(candidate);
  const interval = /(?:永续|永續|perpetual)\s+(\d+[mhdw])/i.exec(candidate.title)?.[1]?.toLowerCase();
  if (!symbol || !interval) throw new Error('计划缺少原始市场或周期');
  return {marketId: `BINANCE:FUTURES:${symbol}`, interval};
}
export function planMenuOptions(context: PlanMenuContext, now = Date.now()) {
  const facts = planMenuFacts(context.candidate, now);
  const view = Boolean(context.saved || context.candidate.cloudReport?.planRecords[0]?.saved || facts.expired);
  return [
    { action: view ? 'view' : 'add', enabled: !context.busy && (view || context.complete && facts.hasEntry && facts.eligible) },
    { action: 'chart', enabled: !context.busy && !context.chartBusy },
    { action: 'sticky', enabled: !context.busy && facts.hasEntry },
    { action: 'share', enabled: !context.busy && context.complete && facts.canShare },
  ] as Array<{action: PlanMenuAction; enabled: boolean}>;
}
function revision(context: PlanMenuContext) {
  const remote = (context.saved || context.candidate).cloudReport?.planRecords[0];
  return JSON.stringify([context.scope, context.key, remote?.id, remote?.version, remote?.saved,
    context.saved?.id, context.saved?.status, context.saved?.statusUpdatedAt, context.candidate.content]);
}

// Native modal dialogs survive background chat rendering and own focus/Escape.
export function createPlanDialog(label: string, className = '') {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.className = `execution-plan-dialog ${className}`;
  dialog.setAttribute('aria-label', label);
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => { dialog.remove(); if (previous?.isConnected) previous.focus(); }, {once: true});
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export function createExecutionPlanMenu(deps: {
  language(): string; resolve(card: HTMLElement): PlanMenuContext | null;
  run(action: PlanMenuAction, card: HTMLElement, context: PlanMenuContext): Promise<unknown>;
  error(error: unknown): void;
}) {
  const bound = new WeakSet<HTMLElement>(), boundCards = new WeakSet<HTMLElement>(), pending = new Set<string>();
  let opened: HTMLDialogElement | null = null;
  async function open(card: HTMLElement) {
    const context = deps.resolve(card);
    if (!context || context.busy || pending.has(context.key) || opened?.isConnected) return;
    const language = deps.language(), stamp = revision(context);
    const dialog = createPlanDialog(planMenuText('menu', language), 'execution-plan-option-menu');
    opened = dialog;
    const buttons = planMenuOptions(context).map(option => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.planMenuAction = option.action;
      button.textContent = planMenuText(option.action, language); button.disabled = !option.enabled;
      button.addEventListener('click', async () => {
        const current = deps.resolve(card);
        dialog.close();
        if (!current || revision(current) !== stamp || pending.has(current.key)) return;
        // A still-open menu can cross the entry deadline; view the expired plan.
        const action = option.action === 'add' && planMenuFacts(current.candidate).expired ? 'view' : option.action;
        if (!planMenuOptions(current).some(item => item.action === action && item.enabled)) return;
        pending.add(current.key);
        try { await deps.run(action, card, current); } catch (error) { deps.error(error); }
        finally { pending.delete(current.key); }
      });
      dialog.append(button); return button;
    });
    dialog.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const available = buttons.filter(button => !button.disabled);
      const index = available.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length;
      available[next]?.focus();
    });
    buttons.find(button => !button.disabled)?.focus();
  }
  return {
    bind(container: ParentNode) {
      container.querySelectorAll<HTMLElement>('.message-execution-plan[data-execution-plan-thread-id]').forEach(card => {
        const content = card.querySelector<HTMLElement>('.execution-plan-card-content');
        if (!content || bound.has(content) || !deps.resolve(card)) return;
        bound.add(content); content.dataset.planMenuTrigger = 'true';
        content.tabIndex = 0; content.setAttribute('role', 'button'); content.setAttribute('aria-haspopup', 'dialog');
        content.setAttribute('aria-label', `${card.getAttribute('aria-label') || ''} · ${planMenuText('menu', deps.language())}`);
        if (!boundCards.has(card)) {
          boundCards.add(card);
          card.addEventListener('click', event => {
            if ((event.target as Element)?.closest('button,a,input,.message-execution-plan-footer') || window.getSelection()?.toString()) return;
            event.preventDefault(); event.stopPropagation(); void open(card);
          });
        }
        content.addEventListener('keydown', event => {
          if (event.target !== content || !['Enter', ' '].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation(); void open(card);
        });
      });
    },
  };
}
