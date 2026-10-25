import { koreanText } from '../shared/korean.mjs';
type PriceContext = { marketId: string; interval: string; referencePrice: number };
const supported = (marketId: string) => /^BINANCE:(?:FUTURES|SPOT):/.test(marketId);
const copy = {
  add: ['创建价格预警', 'Create price alert', '建立價格預警'],
  title: ['创建价格预警？', 'Create a price alert?', '建立價格預警？'],
  detail: ['达到或越过此价格时，发送一次邮件至账号绑定邮箱。', 'Email your account address once when the price reaches or passes this level.', '達到或越過此價格時，傳送一次郵件至帳號綁定信箱。'],
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
};
function t(key: keyof typeof copy) {
  const language = document.documentElement.lang;
  if (language.startsWith('ko')) return koreanText(copy[key][0]);
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
  constructor(element: HTMLElement, context: () => PriceContext | null) {
    this.element = element;
    this.context = context;
    element.innerHTML = '<button type="button" class="trading-price-alert-add" data-price-alert-add><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 5v10M5 10h10"/></svg></button><span data-price-alert-value></span>';
    this.button = element.querySelector<HTMLButtonElement>('button')!;
    this.value = element.querySelector<HTMLElement>('span')!;
    this.button.title = this.button.ariaLabel = t('add');
    this.button.addEventListener('pointerdown', this.stopPointer);
    this.button.addEventListener('click', this.open);
  }
  get interacting() { return this.element.matches(':hover') || this.button.matches(':focus-visible'); }
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
    const language = document.documentElement.lang;
    const frozen = { ...this.sample, interval: priceAlertInterval(this.sample.interval), requestId: crypto.randomUUID(), confirmed: true as const,
      locale:language.startsWith('ko') ? 'ko' : language.startsWith('en') ? 'en' : /TW|Hant/i.test(language) ? 'zh-Hant' : 'zh-CN' };
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    this.dialog = dialog;
    dialog.className = 'trading-price-alert-dialog';
    dialog.setAttribute('aria-label', t('title'));
    dialog.innerHTML = '<h2></h2><strong class="trading-price-alert-market"></strong><div class="trading-price-alert-target"></div><p data-price-alert-description></p><p role="status" data-price-alert-status></p><footer><button type="button" data-price-alert-cancel></button><button type="button" data-price-alert-confirm></button></footer>';
    const heading = dialog.querySelector('h2')!;
    heading.textContent = t('title');
    dialog.querySelector('strong')!.textContent = `${marketLabel(frozen.marketId)} · ${frozen.interval}`;
    dialog.querySelector('.trading-price-alert-target')!.textContent = this.value.textContent;
    dialog.querySelector('[data-price-alert-description]')!.textContent = t('detail');
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
          const key = ({PRICE_ALERT_CLOUD_UNAVAILABLE:'cloudUnavailable',PRICE_ALERT_EMAIL_REQUIRED:'emailRequired',PRICE_ALERT_READBACK_FAILED:'readback'} as const)[response.error?.code as 'PRICE_ALERT_CLOUD_UNAVAILABLE'];
          throw new Error(key ? t(key) : response.error?.message || t('missing'));
        }
        const result = response?.data ?? response;
        const snapshot = await api.tradingAlertsSnapshot();
        const alerts = (snapshot?.data ?? snapshot)?.alerts;
        if (snapshot?.ok === false || !result?.alert?.alertId || !alerts?.some((alert: any) => alert.alertId === result.alert.alertId)) throw new Error(t('readback'));
        createdId = result.alert.alertId;
        heading.textContent = t('success');
        status.textContent = t(result.monitoringReady ? 'saved' : 'pending');
        cancel.textContent = t('close');
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        busy = false; confirm.disabled = cancel.disabled = false;
        confirm.textContent = t(createdId ? 'view' : 'confirm');
      }
    };
    document.body.append(dialog);
    dialog.showModal(); cancel.focus();
  };
  destroy() {
    this.button.removeEventListener('pointerdown', this.stopPointer);
    this.button.removeEventListener('click', this.open);
    this.dialog?.remove(); this.dialog = null;
  }
}
