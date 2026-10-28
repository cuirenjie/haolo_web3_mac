import { vietnameseText } from '../shared/vietnamese.mjs';
import { japaneseText } from '../shared/japanese.mjs';
import { priceAlertDeliveryDescription } from '../shared/price-alert-copy.mjs';
import { koreanText } from '../shared/korean.mjs';
import { TradingPriceAlertMarkers, type PriceAlertChart } from './trading-price-alert-markers.ts';
import { publishChartPriceAlerts, refreshChartPriceAlerts, type ChartPriceAlert } from './trading-price-alert-store.ts';
type PriceContext = { marketId: string; interval: string; referencePrice: number };
const supported = (marketId: string) => /^BINANCE:(?:FUTURES|SPOT):/.test(marketId);
const copy = {
  add: ['创建价格预警', 'Create price alert', '建立價格預警'],
  title: ['创建价格预警？', 'Create a price alert?', '建立價格預警？'],
  cancel: ['取消', 'Cancel', '取消'], confirm: ['确定创建', 'Create alert', '確定建立'],
  saving: ['正在创建…', 'Creating…', '正在建立…'], close: ['关闭', 'Close', '關閉'],
  success: ['预警已创建', 'Alert created', '預警已建立'],
  saved: ['已添加到预警页面，云端正在监控目标价格。', 'Added to Alerts. Monitoring the target price in the cloud.', '已新增至預警頁面，雲端正在監控目標價格。'],
  pending: ['已添加到预警页面，行情监控尚未就绪，请在卡片中查看状态。', 'Added to Alerts. Monitoring is not ready; check the card for its status.', '已新增至預警頁面，行情監控尚未就緒，請在卡片中查看狀態。'],
  view: ['查看预警', 'View alerts', '查看預警'],
  binance: ['币安', 'Binance', '幣安'], spot: ['现货', 'Spot', '現貨'], perpetual: ['永续', 'Perpetual', '永續'],
  unavailable: ['当前市场暂不支持价格预警', 'Price alerts are unavailable for this market', '目前市場暫不支援價格預警'],
  missing: ['请重启客户端后再创建价格预警', 'Restart the app to enable price alerts', '請重新啟動用戶端後再建立價格預警'],
  readback: ['尚未从预警列表读回，请重试确认创建结果。', 'Could not verify the saved alert. Retry to check the result.', '尚未從預警清單讀回，請重試確認建立結果。'],
  cloudUnavailable: ['云端价格预警暂未就绪，请稍后重试。', 'Cloud price alerts are not ready. Please retry shortly.', '雲端價格預警暫未就緒，請稍後重試。'],
  emailRequired: ['请先在账号页面绑定邮箱。', 'Add an email address on the Account page first.', '請先在帳號頁面綁定信箱。'],
  moveTitle: ['在此价格重新创建预警？', 'Create a replacement alert at this price?', '在此價格重新建立預警？', '이 가격으로 알림을 다시 만들까요?'],
  moveDetail: ['确认后将在此价格创建预警，并自动删除原预警；取消则保留原预警。', 'Confirm to create an alert at this price and automatically delete the original. Cancel to keep the original.', '確認後將在此價格建立預警，並自動刪除原預警；取消則保留原預警。', '확인하면 이 가격으로 알림을 만들고 기존 알림을 자동 삭제합니다. 취소하면 기존 알림을 유지합니다.'],
  deleteTitle: ['删除这个预警？', 'Delete this alert?', '刪除這個預警？', '이 알림을 삭제할까요?'],
  deleteDetail: ['这样做会永久删除您的“{label}”预警。', 'This will permanently delete your “{label}” alert.', '這樣做會永久刪除您的「{label}」預警。', '“{label}” 알림이 영구 삭제됩니다.'],
  delete: ['删除', 'Delete', '刪除', '삭제'],
  deleting: ['正在删除…', 'Deleting…', '正在刪除…', '삭제 중…'],
  deleteReadback: ['尚未确认预警已删除，请重试。', 'Deletion has not been verified. Please retry.', '尚未確認預警已刪除，請重試。', '알림 삭제를 확인하지 못했습니다. 다시 시도해 주세요.'],
  replacementIncomplete: ['新预警可能已创建，但原预警尚未确认删除。请重试以完成替换。', 'The new alert may have been created, but deletion of the original is unverified. Retry to finish replacing it.', '新預警可能已建立，但原預警尚未確認刪除。請重試以完成替換。', '새 알림이 생성되었을 수 있지만 기존 알림 삭제를 확인하지 못했습니다. 다시 시도하여 교체를 완료해 주세요.'],
  crosses: ['穿过', 'Crossing', '穿過', '돌파'],
};
function t(key: keyof typeof copy | 'detail') {
  const language = document.documentElement.lang;
  if (key === 'detail') return priceAlertDeliveryDescription(language);
  if (language.startsWith('vi')) return vietnameseText(copy[key][0]);
  if (language.startsWith('ja')) return japaneseText(copy[key][0]);
  if (language.startsWith('ko')) return (copy[key] as string[])[3] || koreanText(copy[key][0]);
  return copy[key][language.startsWith('en') ? 1 : /TW|Hant/i.test(language) ? 2 : 0];
}

export function formatPriceAlertLabel(price: number, precision: number) {
  return price.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function priceAlertInterval(resolution: string) {
  if (/^[1-9]\d*$/.test(resolution)) {
    const minutes = Number(resolution);
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  }
  return resolution === '1M' ? resolution : resolution.toLowerCase();
}

export function priceAlertPrecision(price: number) {
  const digits = Math.abs(price) >= 1 ? Math.floor(Math.log10(Math.abs(price))) + 1 : 1;
  return Math.max(2, 6 - digits);
}

function markerLabel(alert: ChartPriceAlert) {
  const operator = ({ gte: '≥', lte: '≤', gt: '>', lt: '<' } as Record<string, string>)[alert.operator] || t('crosses');
  return `${alert.marketId.split(':')[2]} ${operator} ${formatPriceAlertLabel(alert.price, Math.max(priceAlertPrecision(alert.price), Math.min(12, String(alert.price).split('.')[1]?.length || 0)))}`;
}

function marketLabel(marketId: string) {
  const [venue, type, symbol] = marketId.split(':');
  const pair = venue === 'BINANCE' ? symbol.replace(/(USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB|EUR|USD)$/, '/$1') : symbol;
  return `${pair} ${t(type === 'SPOT' ? 'spot' : 'perpetual')} · ${venue === 'BINANCE' ? t('binance') : 'Hyperliquid'}`;
}

// The DOM label stays interactive while the chart canvas loses its crosshair.
// Capture the rounded value shown on the axis, never a hidden higher precision value.
export class TradingPriceAlertControl {
  private element: HTMLElement;
  private context: () => PriceContext | null;
  private button: HTMLButtonElement;
  private value: HTMLElement;
  private sample: (PriceContext & { price: number }) | null = null;
  private dialog: HTMLDialogElement | null = null;
  private markers: TradingPriceAlertMarkers | null = null;
  constructor(element: HTMLElement, context: () => PriceContext | null, chart?: PriceAlertChart) {
    this.element = element;
    this.context = context;
    element.innerHTML = '<button type="button" class="trading-price-alert-add" data-price-alert-add><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 5v10M5 10h10"/></svg></button><span data-price-alert-value></span>';
    this.button = element.querySelector<HTMLButtonElement>('button')!;
    this.value = element.querySelector<HTMLElement>('span')!;
    this.button.title = this.button.ariaLabel = t('add');
    this.button.addEventListener('pointerdown', this.stopPointer);
    this.button.addEventListener('click', this.open);
    if (chart) this.markers = new TradingPriceAlertMarkers({ ...chart,
      marketId: () => context()?.marketId, precision: priceAlertPrecision, label: markerLabel,
      deleteLabel: () => t('delete'), blocked: () => !!this.dialog,
      remove: alert => this.openDelete(alert),
      move: (alert, price) => {
        const current = context();
        if (current?.marketId === alert.marketId && current.referencePrice > 0) {
          this.showCreate({ ...current, price }, formatPriceAlertLabel(price, priceAlertPrecision(price)), alert);
        } else this.markers?.finishMove();
      },
    });
  }
  get interacting() { return !!this.markers?.interacting || this.element.matches(':hover') || this.button.matches(':focus-visible'); }
  updateMarkers() { this.markers?.update(); }
  scheduleMarkers() { this.markers?.schedule(); }
  update(price: number, precision: number) {
    if (this.interacting) return;
    const rounded = Number(price.toFixed(precision));
    const text = formatPriceAlertLabel(rounded, precision);
    if (this.value.textContent !== text) this.value.textContent = text;
    const context = this.context();
    this.sample = context && rounded > 0 && context.referencePrice > 0 && supported(context.marketId)
      ? { ...context, price: rounded } : null;
    this.button.disabled = !this.sample;
    this.button.title = this.button.ariaLabel = t(this.sample ? 'add' : 'unavailable');
  }
  private stopPointer = (event: Event) => event.stopPropagation();
  private open = (event: Event) => {
    event.stopPropagation();
    if (!this.sample || this.dialog) return;
    const current = this.context();
    if (current?.marketId !== this.sample.marketId || current?.interval !== this.sample.interval) return;
    this.showCreate(this.sample, this.value.textContent || '');
  };
  private showCreate(sample: PriceContext & { price: number }, label: string, replaces?: ChartPriceAlert) {
    if (this.dialog) return;
    const language = document.documentElement.lang;
    const frozen = { ...sample, interval: replaces?.interval ?? priceAlertInterval(sample.interval), requestId: crypto.randomUUID(), confirmed: true as const,
      ...(replaces ? { replacesAlertId: replaces.alertId, replacesVersion: replaces.version } : {}),
      locale:language.startsWith('vi') ? 'vi' : language.startsWith('ja') ? 'ja' : language.startsWith('ko') ? 'ko' : language.startsWith('en') ? 'en' : /TW|Hant/i.test(language) ? 'zh-Hant' : 'zh-CN' };
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'trading-price-alert-dialog';
    dialog.setAttribute('aria-label', t(replaces ? 'moveTitle' : 'title'));
    dialog.innerHTML = '<h2></h2><strong class="trading-price-alert-market"></strong><div class="trading-price-alert-target"></div><p data-price-alert-description></p><p role="status" data-price-alert-status></p><footer><button type="button" data-price-alert-cancel></button><button type="button" data-price-alert-confirm></button></footer>';
    const heading = dialog.querySelector('h2')!;
    heading.textContent = t(replaces ? 'moveTitle' : 'title');
    dialog.querySelector('strong')!.textContent = `${marketLabel(frozen.marketId)} · ${frozen.interval}`;
    dialog.querySelector('.trading-price-alert-target')!.textContent = label;
    dialog.querySelector('[data-price-alert-description]')!.textContent = t(replaces ? 'moveDetail' : 'detail');
    const status = dialog.querySelector<HTMLElement>('[data-price-alert-status]')!;
    const cancel = dialog.querySelector<HTMLButtonElement>('[data-price-alert-cancel]')!;
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-price-alert-confirm]')!;
    cancel.textContent = t('cancel'); confirm.textContent = t('confirm');
    let busy = false;
    let createdId = '';
    const close = () => { if (!busy) dialog.close(); };
    cancel.onclick = close;
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => {
      dialog.remove(); this.dialog = null;
      this.markers?.finishMove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }, { once: true });
    confirm.onclick = async () => {
      if (busy) return;
      if (createdId) {
        dialog.close();
        window.dispatchEvent(new CustomEvent('haolo:open-price-alert', { detail: { alertId: createdId } }));
        return;
      }
      busy = true; confirm.disabled = cancel.disabled = true;
      confirm.textContent = t('saving'); status.textContent = '';
      try {
        const api = window.codexDesktop;
        if (!api?.tradingAlertsCreateCloudPriceAlert || !api.tradingAlertsSnapshot) throw new Error(t('missing'));
        const response = await api.tradingAlertsCreateCloudPriceAlert(frozen);
        if (response?.ok === false) {
          const key = ({PRICE_ALERT_CLOUD_UNAVAILABLE:'cloudUnavailable',PRICE_ALERT_EMAIL_REQUIRED:'emailRequired',PRICE_ALERT_READBACK_FAILED:'readback',PRICE_ALERT_REPLACEMENT_INCOMPLETE:'replacementIncomplete'} as const)[response.error?.code as 'PRICE_ALERT_CLOUD_UNAVAILABLE'];
          throw new Error(key ? t(key) : response.error?.message || t('missing'));
        }
        const result = response?.data ?? response;
        const snapshot = await api.tradingAlertsSnapshot();
        publishChartPriceAlerts(snapshot);
        const alerts = (snapshot?.data ?? snapshot)?.alerts;
        if (snapshot?.ok === false || !result?.alert?.alertId || !alerts?.some((alert: any) => alert.alertId === result.alert.alertId)) throw new Error(t('readback'));
        if (replaces && alerts.some((alert: any) => alert.alertId === replaces.alertId)) throw new Error(t('replacementIncomplete'));
        createdId = result.alert.alertId;
        this.markers?.finishMove();
        if (replaces) { dialog.close(); return; }
        heading.textContent = t('success');
        status.textContent = t(result.monitoringReady ? 'saved' : 'pending');
        cancel.textContent = t('close');
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
        void refreshChartPriceAlerts();
      } finally {
        busy = false; confirm.disabled = cancel.disabled = false;
        confirm.textContent = t(createdId ? 'view' : 'confirm');
      }
    };
    document.body.append(dialog);
    dialog.showModal(); cancel.focus();
  }
  private openDelete(alert: ChartPriceAlert) {
    if (this.dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog'); this.dialog = dialog;
    dialog.className = 'trading-price-alert-dialog trading-price-alert-delete-dialog';
    dialog.setAttribute('aria-label', t('deleteTitle'));
    dialog.innerHTML = '<button type="button" class="trading-price-alert-close" data-price-alert-close><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg></button><h2></h2><p data-price-alert-description></p><p role="status" data-price-alert-status></p><footer><button type="button" data-price-alert-cancel></button><button type="button" data-price-alert-confirm></button></footer>';
    dialog.querySelector('h2')!.textContent = t('deleteTitle');
    dialog.querySelector('[data-price-alert-description]')!.textContent = t('deleteDetail').replace('{label}', markerLabel(alert));
    const cancel = dialog.querySelector<HTMLButtonElement>('[data-price-alert-cancel]')!;
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-price-alert-confirm]')!;
    const close = dialog.querySelector<HTMLButtonElement>('[data-price-alert-close]')!;
    const status = dialog.querySelector<HTMLElement>('[data-price-alert-status]')!;
    cancel.textContent = t('cancel'); confirm.textContent = t('delete'); close.ariaLabel = t('close');
    let busy = false;
    cancel.onclick = close.onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      dialog.remove(); this.dialog = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }, { once: true });
    confirm.onclick = async () => {
      if (busy) return;
      busy = true; confirm.disabled = cancel.disabled = close.disabled = true;
      confirm.textContent = t('deleting'); status.textContent = '';
      try {
        const api = window.codexDesktop;
        if (!api?.tradingAlertsDelete || !api.tradingAlertsSnapshot) throw new Error(t('missing'));
        const response = await api.tradingAlertsDelete({ alertId: alert.alertId, version: alert.version });
        if (response?.ok === false) throw new Error(response.error?.message || t('deleteReadback'));
        const snapshot = await api.tradingAlertsSnapshot();
        const value = snapshot?.data ?? snapshot;
        if (snapshot?.ok === false || !value?.cloudLoaded || !Array.isArray(value.alerts)
          || value.alerts.some((entry: any) => entry.alertId === alert.alertId)) throw new Error(t('deleteReadback'));
        publishChartPriceAlerts(snapshot);
        dialog.close();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
        void refreshChartPriceAlerts();
      } finally {
        busy = false; confirm.disabled = cancel.disabled = close.disabled = false; confirm.textContent = t('delete');
      }
    };
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  }
  destroy() {
    this.markers?.destroy();
    this.button.removeEventListener('pointerdown', this.stopPointer);
    this.button.removeEventListener('click', this.open);
    this.dialog?.remove(); this.dialog = null;
  }
}
