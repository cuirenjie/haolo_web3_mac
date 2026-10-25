export type ChartPriceAlert = {
  alertId: string;
  marketId: string;
  interval: string;
  price: number;
  version: number;
  operator: string;
};

export function chartPriceAlerts(payload: any): ChartPriceAlert[] {
  const value = payload?.data ?? payload;
  if (payload?.ok === false || !value?.cloudLoaded || !Array.isArray(value.alerts)) return [];
  return value.alerts.flatMap((alert: any) => {
    const context = alert.rule?.contexts?.[0];
    if (!String(alert.alertId).startsWith('cloud-price-') || !alert.enabled
      || !['arming', 'monitoring'].includes(alert.status)
      || !Number.isFinite(alert.cloud?.threshold) || alert.cloud.threshold <= 0
      || !Number.isSafeInteger(alert.cloud.version) || !context?.marketSelector?.marketIds?.[0]) return [];
    return [{ alertId: alert.alertId, marketId: context.marketSelector.marketIds[0],
      interval: context.intervals[0], price: alert.cloud.threshold, version: alert.cloud.version,
      operator: alert.cloud.operator }];
  });
}

// One cloud read for all chart panes, and no polling after the last chart is destroyed.
let alerts: ChartPriceAlert[] = [];
const listeners = new Set<(alerts: ChartPriceAlert[]) => void>();
let pending: Promise<void> | null = null;
let revision = 0;
let timer: number | undefined;
let cleanups: Array<() => void> = [];
const emit = () => listeners.forEach(listener => listener(alerts));

export function publishChartPriceAlerts(payload: any) {
  if (payload?.ok === false || !(payload?.data ?? payload)?.cloudLoaded) return;
  revision++;
  alerts = chartPriceAlerts(payload);
  emit();
}

export function refreshChartPriceAlerts(): Promise<void> {
  if (pending) return pending;
  const api = window.codexDesktop;
  if (!api?.tradingAlertsSnapshot) return Promise.resolve();
  const started = revision;
  const task = (async () => {
    try {
      const payload = await api.tradingAlertsSnapshot!();
      if (started === revision) publishChartPriceAlerts(payload);
    } catch { /* Preserve the last verified snapshot during transient network errors. */ }
  })();
  pending = task;
  void task.finally(() => { if (pending === task) pending = null; });
  return task;
}

export function subscribeChartPriceAlerts(listener: (alerts: ChartPriceAlert[]) => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const api = window.codexDesktop;
    const reset = () => { revision++; pending = null; alerts = []; emit(); void refreshChartPriceAlerts(); };
    cleanups = [api?.onTradingAlertsChanged?.(publishChartPriceAlerts), api?.onProfileUpdated?.(reset),
      api?.onAuthExpired?.(reset)].filter((cleanup): cleanup is () => void => !!cleanup);
    timer = window.setInterval(() => { if (!document.hidden) void refreshChartPriceAlerts(); }, 15_000);
    window.addEventListener('focus', refreshChartPriceAlerts);
    void refreshChartPriceAlerts();
  }
  listener(alerts);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      cleanups.forEach(cleanup => cleanup()); cleanups = [];
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshChartPriceAlerts);
      revision++; pending = null; alerts = [];
    }
  };
}
