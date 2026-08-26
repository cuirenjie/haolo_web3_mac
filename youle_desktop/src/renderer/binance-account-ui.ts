export type BinanceAccountStatus = {
  bound: boolean;
  apiKeyMasked: string | null;
  boundAt: string | null;
  updatedAt: string | null;
  secureStorageAvailable: boolean;
  emailMasked?: string | null;
};

export type BinanceAccountPosition = {
  symbol: string;
  direction: "LONG" | "SHORT";
  positionSide: string;
  marginType: "isolated" | "cross";
  leverage: number;
  amount: number;
  notionalValue: number;
  margin: number;
  unrealizedPnl: number;
  roi: number;
  marginRatio: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  breakEvenPrice: number;
  marginAsset: string;
  updatedAt: number;
};

export type BinanceAccountPositionHistory = {
  id: string;
  symbol: string;
  contractType: "PERPETUAL";
  direction: "LONG" | "SHORT";
  positionSide: string;
  marginType: "isolated" | "cross" | null;
  leverage: number | null;
  closeType: "FULL" | "PARTIAL";
  realizedPnl: number;
  unrealizedPnl: number | null;
  roi: number | null;
  closedAmount: number;
  baseAsset: string;
  openTime: number | null;
  closeTime: number | null;
  entryPrice: number;
  averageClosePrice: number;
  updatedAt: number;
};

export type BinanceAccountOpenOrder = {
  id: string;
  source: "ORDER" | "ALGO";
  symbol: string;
  contractType: "PERPETUAL";
  orderType: string;
  side: "BUY" | "SELL";
  positionSide: string;
  status: string;
  timeInForce: string | null;
  quantityUsdt: number | null;
  executedQuantityUsdt: number | null;
  progressPercent: number | null;
  price: number | null;
  averagePrice: number | null;
  triggerPrice: number | null;
  activationPrice: number | null;
  callbackRate: number | null;
  workingType: string | null;
  reduceOnly: boolean;
  closePosition: boolean;
  priceProtect: boolean;
  priceMatch: string | null;
  createdAt: number;
  updatedAt: number;
};

export type BinanceAccountSnapshot = {
  schemaVersion: 1;
  currency: string;
  estimatedTotalAssets: number;
  todayPnl: number | null;
  todayPnlPercent: number | null;
  marginBalance: number;
  walletBalance: number;
  unrealizedPnl: number;
  realizedPnlToday: number | null;
  initialMargin: number;
  availableBalance: number;
  positions: BinanceAccountPosition[];
  positionHistory: BinanceAccountPositionHistory[];
  openOrders: BinanceAccountOpenOrder[];
  walletBreakdown: Array<{ walletName: string; balance: number }>;
  sources: {
    totalAssets: string;
    futures: string;
    realizedPnl: string;
    positionHistory: string;
    openOrders: string;
  };
  warnings: string[];
  fetchedAt: string;
};

export type BinanceAccountProfitCalendar = {
  schemaVersion: 1;
  month: string;
  currency: string;
  days: Array<{ date: string; pnl: number }>;
  source: string;
  warnings: string[];
  fetchedAt: string;
};

type BinanceAccountDialogState = {
  open: boolean;
  mode: "bind" | "remove";
  busy: "send" | "bind" | "remove" | null;
  error: string | null;
  apiKey: string;
  apiSecret: string;
  code: string;
  challengeId: string;
  emailMasked: string;
  resendReadyAt: number | null;
  secretVisible: boolean;
};

export type BinanceAccountSection = "assets" | "positions" | "open-orders" | "history" | "profit-calendar";

export type BinanceAccountUiState = {
  loading: boolean;
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
  status: BinanceAccountStatus | null;
  snapshot: BinanceAccountSnapshot | null;
  profitCalendar: BinanceAccountProfitCalendar | null;
  profitCalendarMonth: string;
  profitCalendarLoading: boolean;
  profitCalendarError: string | null;
  autoRefreshAfter: number;
  balancesVisible: boolean;
  activeSection: BinanceAccountSection;
  dialog: BinanceAccountDialogState;
};

export function createBinanceAccountUiState(): BinanceAccountUiState {
  return {
    loading: false,
    loaded: false,
    refreshing: false,
    error: null,
    status: null,
    snapshot: null,
    profitCalendar: null,
    profitCalendarMonth: localMonthKey(new Date()),
    profitCalendarLoading: false,
    profitCalendarError: null,
    autoRefreshAfter: 0,
    balancesVisible: true,
    activeSection: "assets",
    dialog: {
      open: false,
      mode: "bind",
      busy: null,
      error: null,
      apiKey: "",
      apiSecret: "",
      code: "",
      challengeId: "",
      emailMasked: "",
      resendReadyAt: null,
      secretVisible: false,
    },
  };
}

export function resetBinanceAccountDialog(
  state: BinanceAccountUiState,
  mode: BinanceAccountDialogState["mode"] = "bind",
) {
  state.dialog = {
    open: false,
    mode,
    busy: null,
    error: null,
    apiKey: "",
    apiSecret: "",
    code: "",
    challengeId: "",
    emailMasked: "",
    resendReadyAt: null,
    secretVisible: false,
  };
}

export function renderBinanceAccountPage(state: BinanceAccountUiState) {
  const status = state.status;
  const initialLoading = state.loading && !state.loaded;
  return `
    <section class="binance-account-page" aria-label="Binance 账户" aria-busy="${initialLoading}">
      ${initialLoading
        ? renderBinanceAccountLoading()
        : state.error && !state.loaded
          ? renderBinanceAccountLoadError(state.error)
          : status?.bound
            ? renderBoundBinanceAccount(state)
            : renderUnboundBinanceAccount(state)}
    </section>
  `;
}

export function renderBinanceAccountDialog(state: BinanceAccountUiState) {
  const dialog = state.dialog;
  if (!dialog.open) return "";
  const countdown = binanceAccountResendCountdown(dialog.resendReadyAt);
  const sending = dialog.busy === "send";
  const binding = dialog.busy === "bind";
  const removing = dialog.mode === "remove";
  const removingBusy = dialog.busy === "remove";
  const busy = Boolean(dialog.busy);
  const canSubmit = Boolean(
    dialog.challengeId
    && (removing || (dialog.apiKey.trim() && dialog.apiSecret.trim()))
    && /^\d{6}$/.test(dialog.code.trim())
    && !busy,
  );
  return `
    <div class="binance-account-dialog-backdrop" aria-hidden="true"></div>
    <dialog class="binance-account-dialog" open aria-modal="true" aria-labelledby="binanceAccountDialogTitle">
      <header>
        <div>
          <h2 id="binanceAccountDialogTitle">${removing ? "验证邮箱并解除绑定" : "绑定 Binance API"}</h2>
          <p>${removing ? "为保护账户安全，请先验证当前 Haolo 账号的邮箱。" : "仅申请账户读取权限，Haolo 不会通过此连接下单。"}</p>
        </div>
        <button type="button" class="binance-account-dialog-close" data-binance-account-action="close-dialog" aria-label="关闭" ${busy ? "disabled" : ""}>×</button>
      </header>
      <form data-binance-account-dialog-form data-binance-account-form-mode="${dialog.mode}" autocomplete="off">
        ${removing ? "" : `
          <label>
            <span>API 密钥</span>
            <input name="apiKey" value="${escapeAttr(dialog.apiKey)}" placeholder="请输入 Binance API Key" spellcheck="false" autocomplete="off" ${busy ? "disabled" : ""} />
          </label>
          <label>
            <span>密钥</span>
            <div class="binance-account-secret-field">
              <input name="apiSecret" type="${dialog.secretVisible ? "text" : "password"}" value="${escapeAttr(dialog.apiSecret)}" placeholder="请输入 Binance Secret Key" spellcheck="false" autocomplete="new-password" ${busy ? "disabled" : ""} />
              <button type="button" data-binance-account-action="toggle-secret" aria-label="${dialog.secretVisible ? "隐藏密钥" : "显示密钥"}" aria-pressed="${dialog.secretVisible ? "true" : "false"}" ${busy ? "disabled" : ""}>
                ${renderEyeIcon(dialog.secretVisible)}
              </button>
            </div>
          </label>
        `}
        <div class="binance-account-otp-copy" aria-live="polite">
          ${sending
            ? "正在通过 Haolo 向当前账号邮箱发送验证码…"
            : dialog.challengeId
              ? `我们已向 <strong>${escapeHtml(dialog.emailMasked || "当前账号邮箱")}</strong> 发送 6 位验证码，请在 30 分钟内输入。`
              : "验证码尚未发送，请点击下方按钮重新发送。"}
        </div>
        <label>
          <span>邮箱验证码</span>
          <div class="binance-account-otp-field">
            <input name="code" value="${escapeAttr(dialog.code)}" placeholder="请输入 6 位验证码" inputmode="numeric" maxlength="6" autocomplete="one-time-code" ${busy ? "disabled" : ""} />
            <button type="button" data-binance-account-action="send-otp" data-binance-account-resend ${busy || countdown > 0 ? "disabled" : ""}>
              ${sending ? "发送中…" : countdown > 0 ? `<span data-binance-account-countdown>${countdown}s 后重试</span>` : "重新发送"}
            </button>
          </div>
        </label>
        <p class="binance-account-security-note">${removing
          ? "验证码通过后才会从本机安全存储中删除 API Key 和 Secret Key，此操作无法撤销。"
          : "API Secret 只在主进程使用系统安全存储加密保存，不会进入聊天、日志或数据导出。"}</p>
        ${dialog.error ? `<p class="binance-account-dialog-error" role="alert">${escapeHtml(dialog.error)}</p>` : ""}
        <footer>
          <button type="submit" class="binance-account-submit${removing ? " danger" : ""}" ${canSubmit ? "" : "disabled"}>
            ${removing
              ? removingBusy
                ? '<span class="binance-account-button-spinner" aria-hidden="true"></span>验证并解除…'
                : "验证并解除绑定"
              : binding
                ? '<span class="binance-account-button-spinner" aria-hidden="true"></span>校验并绑定…'
                : "提交"}
          </button>
        </footer>
      </form>
    </dialog>
  `;
}

export function binanceAccountResendCountdown(resendReadyAt: number | null, now = Date.now()) {
  if (!resendReadyAt) return 0;
  return Math.max(0, Math.ceil((resendReadyAt - now) / 1_000));
}

function renderUnboundBinanceAccount(state: BinanceAccountUiState) {
  const secureStorageAvailable = state.status?.secureStorageAvailable !== false;
  return `
    <div class="binance-account-unbound-wrap">
      <article class="binance-account-unbound-card">
        <div class="binance-account-unbound-copy">
          <h2>还未绑定 API</h2>
          <p>${secureStorageAvailable ? "绑定只读 API 即可查看真实资产、保证金和持仓" : "系统安全存储当前不可用，暂时无法安全保存 API 凭据"}</p>
          <div>
            <button type="button" class="binance-account-bind-button" data-binance-account-action="open-dialog" ${secureStorageAvailable ? "" : "disabled"}>去绑定</button>
            <button type="button" class="binance-account-tutorial-button" data-binance-account-action="open-tutorial">查看教程</button>
          </div>
        </div>
        <div class="binance-account-unbound-icon" aria-hidden="true">
          <svg viewBox="0 0 120 120">
            <rect x="18" y="26" width="84" height="68" rx="16"></rect>
            <circle cx="45" cy="60" r="10"></circle>
            <path d="M55 60h29M75 60v9M66 60v6"></path>
          </svg>
        </div>
      </article>
    </div>
  `;
}

function renderBinanceAccountLoading() {
  const metrics = Array.from({ length: 4 }, () => `
    <div class="binance-account-skeleton-metric">
      <span class="binance-account-skeleton binance-account-skeleton-metric-label"></span>
      <span class="binance-account-skeleton binance-account-skeleton-metric-value"></span>
    </div>
  `).join("");
  return `
    <div class="binance-account-bound-view binance-account-skeleton-view" role="status" aria-live="polite" aria-label="正在加载 Binance 账户数据">
      <div class="binance-account-toolbar binance-account-skeleton-toolbar" aria-hidden="true">
        <div class="binance-account-skeleton-tabs">
          <span class="binance-account-skeleton binance-account-skeleton-tab"></span>
          <span class="binance-account-skeleton binance-account-skeleton-tab"></span>
          <span class="binance-account-skeleton binance-account-skeleton-tab wide"></span>
          <span class="binance-account-skeleton binance-account-skeleton-tab wide"></span>
          <span class="binance-account-skeleton binance-account-skeleton-tab wide"></span>
        </div>
        <div class="binance-account-skeleton-actions">
          <span class="binance-account-skeleton binance-account-skeleton-action"></span>
          <span class="binance-account-skeleton binance-account-skeleton-action"></span>
        </div>
      </div>
      <div class="binance-account-scroll" aria-hidden="true">
        <div class="binance-account-content assets">
          <article class="binance-account-summary-card total-assets">
            <div class="binance-account-skeleton-heading">
              <span class="binance-account-skeleton binance-account-skeleton-title"></span>
              <span class="binance-account-skeleton binance-account-skeleton-eye"></span>
            </div>
            <div class="binance-account-skeleton-amount">
              <span class="binance-account-skeleton binance-account-skeleton-total"></span>
              <span class="binance-account-skeleton binance-account-skeleton-currency"></span>
            </div>
            <span class="binance-account-skeleton binance-account-skeleton-pnl"></span>
          </article>
          <article class="binance-account-summary-card futures-assets">
            <div class="binance-account-skeleton-heading">
              <span class="binance-account-skeleton binance-account-skeleton-title short"></span>
            </div>
            <div class="binance-account-skeleton-amount">
              <span class="binance-account-skeleton binance-account-skeleton-total compact"></span>
              <span class="binance-account-skeleton binance-account-skeleton-currency"></span>
            </div>
            <span class="binance-account-skeleton binance-account-skeleton-pnl compact"></span>
            <div class="binance-account-skeleton-metric-grid">${metrics}</div>
          </article>
        </div>
      </div>
    </div>
  `;
}

function renderBinanceAccountLoadError(message: string) {
  return `
    <div class="binance-account-loading error" role="alert">
      <strong>账户数据加载失败</strong>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="binance-account-quiet-button" data-binance-account-action="retry-load">重试</button>
    </div>
  `;
}

function renderBoundBinanceAccount(state: BinanceAccountUiState) {
  const snapshot = state.snapshot;
  if (!snapshot) return renderBinanceAccountLoading();
  const visible = state.balancesVisible;
  const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
  const positionHistory = Array.isArray(snapshot.positionHistory) ? snapshot.positionHistory : [];
  const openOrders = Array.isArray(snapshot.openOrders) ? snapshot.openOrders : [];
  const activeSection = state.activeSection;
  return `
    <div class="binance-account-bound-view">
      ${renderBinanceAccountToolbar(activeSection, state.refreshing)}
      <div class="binance-account-scroll ${activeSection}" tabindex="0">
        <div class="binance-account-content ${activeSection}" role="region" aria-label="${sectionLabel(activeSection)}">
        ${activeSection === "assets" ? `
          <article class="binance-account-summary-card total-assets">
            <header>
              <div class="binance-account-summary-heading">
                <h2>预估总资产</h2>
                <button type="button" class="binance-account-visibility-button" data-binance-account-action="toggle-balances" aria-label="${visible ? "隐藏资产" : "显示资产"}" aria-pressed="${visible ? "false" : "true"}">${renderEyeIcon(visible)}</button>
              </div>
            </header>
            <div class="binance-account-primary-amount">
              <strong>${assetValue(snapshot.estimatedTotalAssets, visible, 8)}</strong>
              <span>${escapeHtml(snapshot.currency || "USDT")}</span>
            </div>
            <p class="binance-account-pnl-row">今日盈亏 ${signedMetric(snapshot.todayPnl, snapshot.todayPnlPercent, visible)}</p>
          </article>

          <article class="binance-account-summary-card futures-assets">
            <header>
              <div class="binance-account-summary-heading">
                <h2>保证金余额</h2>
              </div>
            </header>
            <div class="binance-account-primary-amount compact">
              <strong>${assetValue(snapshot.marginBalance, visible, 4)}</strong>
              <span>${escapeHtml(snapshot.currency || "USDT")}</span>
            </div>
            <p class="binance-account-realized-row">今日已实现盈亏 <strong class="binance-account-realized-value ${visible ? metricTone(snapshot.realizedPnlToday) : "neutral"}">${signedValue(snapshot.realizedPnlToday, visible)}</strong></p>
            <div class="binance-account-metric-grid">
              ${renderAccountMetric("钱包余额 (USD)", snapshot.walletBalance, visible)}
              ${renderAccountMetric("未实现盈亏 (USD)", snapshot.unrealizedPnl, visible, true)}
              ${renderAccountMetric("可用余额 (USD)", snapshot.availableBalance, visible)}
              ${renderAccountMetric("占用保证金 (USD)", snapshot.initialMargin, visible)}
            </div>
          </article>

        ` : activeSection === "positions" ? `
          <section class="binance-account-positions" aria-label="持仓">
            ${positions.length
              ? `<div class="binance-account-position-list">${positions.map((position) => renderPositionCard(position, visible)).join("")}</div>`
              : `<div class="binance-account-empty-positions"><strong>暂无持仓</strong></div>`}
          </section>
        ` : activeSection === "open-orders" ? `
          <section class="binance-account-open-orders" aria-label="当前委托">
            ${openOrders.length
              ? `<div class="binance-account-open-order-list">${openOrders.map((order) => renderOpenOrderCard(order, visible)).join("")}</div>`
              : `<div class="binance-account-empty-open-orders"><strong>暂无当前委托</strong><span>当前没有未完成的普通委托或条件委托</span></div>`}
          </section>
        ` : activeSection === "history" ? `
          <section class="binance-account-position-history" aria-label="仓位历史">
            ${positionHistory.length
              ? `<div class="binance-account-history-list">${positionHistory.map((record) => renderPositionHistoryCard(record, visible, snapshot.fetchedAt)).join("")}</div>`
              : `<div class="binance-account-empty-history"><strong>暂无仓位历史</strong><span>最近 7 天没有可展示的已平仓或部分平仓记录</span></div>`}
          </section>
        ` : `
          ${renderProfitCalendar(state, visible)}
        `}
        </div>
      </div>
    </div>
  `;
}

function renderProfitCalendar(state: BinanceAccountUiState, visible: boolean) {
  const month = validCalendarMonth(state.profitCalendarMonth)
    ? state.profitCalendarMonth
    : localMonthKey(new Date());
  const calendar = state.profitCalendar?.month === month ? state.profitCalendar : null;
  const [year, monthNumber] = month.split("-").map(Number);
  const leadingDays = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const calendarDays = (Array.isArray(calendar?.days) ? calendar.days : [])
    .filter((day) => typeof day?.date === "string" && day.date.startsWith(`${month}-`) && Number.isFinite(day?.pnl));
  const pnlByDate = new Map(
    calendarDays.map((day) => [day.date, day.pnl] as const),
  );
  const monthlyPnl = calendar
    ? roundedCalendarPnl(calendarDays.reduce((total, day) => total + day.pnl, 0))
    : null;
  const monthlyTone = visible ? metricTone(monthlyPnl) : "neutral";
  const monthlyValue = !visible
    ? "••••"
    : monthlyPnl == null
      ? "--"
      : formatMonthlyPnl(monthlyPnl);
  const dayCells = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const hasTrading = pnlByDate.has(date);
    const pnl = hasTrading ? pnlByDate.get(date)! : null;
    const roundedPnl = pnl == null ? null : roundedCalendarPnl(pnl);
    const tone = !visible
      ? "concealed"
      : roundedPnl == null
        ? "empty"
        : roundedPnl > 0
          ? "profit"
          : roundedPnl < 0
            ? "loss"
            : "zero";
    const value = !visible
      ? "••••"
      : roundedPnl == null
        ? "--"
        : formatCalendarPnl(roundedPnl);
    const accessibleValue = !visible
      ? "盈亏已隐藏"
      : roundedPnl == null
        ? "无交易"
        : roundedPnl === 0
          ? "盈亏 0.00"
          : `${roundedPnl > 0 ? "盈利" : "亏损"} ${formatNumber(Math.abs(roundedPnl), 2)}`;
    return `
      <div class="binance-account-profit-day ${tone}" role="gridcell" aria-label="${monthNumber}月${day}日，${accessibleValue}">
        <strong>${String(day).padStart(2, "0")}</strong>
        <span>${value}</span>
      </div>
    `;
  }).join("");
  const loadingCells = Array.from({ length: 35 }, () => `
    <span class="binance-account-profit-calendar-skeleton binance-account-skeleton" aria-hidden="true"></span>
  `).join("");
  const leadingCell = leadingDays
    ? `<span class="binance-account-profit-leading" style="--leading-days:${leadingDays}" aria-hidden="true"></span>`
    : "";
  const body = state.profitCalendarLoading && !calendar
    ? `<div class="binance-account-profit-calendar-loading" role="status" aria-label="正在加载收益日历">${loadingCells}</div>`
    : state.profitCalendarError && !calendar
      ? `<div class="binance-account-profit-calendar-error" role="alert"><span>${escapeHtml(state.profitCalendarError)}</span><button type="button" class="binance-account-quiet-button" data-binance-account-action="retry-profit-calendar">重试</button></div>`
      : `<div class="binance-account-profit-grid" role="grid" aria-label="${year}年${monthNumber}月每日盈亏">${leadingCell}${dayCells}</div>`;
  const nextDisabled = month >= localMonthKey(new Date()) || state.profitCalendarLoading;
  return `
    <section class="binance-account-profit-calendar" aria-labelledby="binanceAccountProfitCalendarTitle">
      <header>
        <h2 id="binanceAccountProfitCalendarTitle">收益日历</h2>
        <div class="binance-account-profit-month-total ${monthlyTone}" aria-live="polite">
          <span>本月</span>
          <strong>${monthlyValue}</strong>
          <small>${escapeHtml(calendar?.currency || "USDT")}</small>
        </div>
      </header>
      <div class="binance-account-profit-month-nav">
        <button type="button" data-binance-account-action="previous-profit-month" aria-label="查看上个月" ${state.profitCalendarLoading ? "disabled" : ""}>${renderChevronIcon("previous")}</button>
        <strong>${year}年 ${monthNumber}月</strong>
        <button type="button" data-binance-account-action="next-profit-month" aria-label="查看下个月" ${nextDisabled ? "disabled" : ""}>${renderChevronIcon("next")}</button>
      </div>
      <div class="binance-account-profit-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>${day}</span>`).join("")}</div>
      ${body}
    </section>
  `;
}

function renderBinanceAccountToolbar(activeSection: BinanceAccountSection, refreshing: boolean) {
  const tabs: Array<[BinanceAccountSection, string]> = [
    ["assets", "资产"],
    ["positions", "持仓"],
    ["open-orders", "当前委托"],
    ["history", "仓位历史"],
    ["profit-calendar", "收益日历"],
  ];
  return `
    <div class="binance-account-toolbar">
      <nav class="trading-alert-filters binance-account-tabs" aria-label="账户分类">
        ${tabs.map(([id, label]) => `<button type="button" class="${activeSection === id ? "active" : ""}" data-binance-account-action="select-section" data-binance-account-section="${id}" aria-pressed="${activeSection === id}">${label}</button>`).join("")}
      </nav>
      <div class="binance-account-toolbar-actions" aria-label="账户操作">
        <button type="button" class="binance-account-action-icon-button refresh${refreshing ? " refreshing" : ""}" data-binance-account-action="refresh" aria-label="${refreshing ? "正在刷新账户数据" : "刷新账户数据"}" aria-busy="${refreshing ? "true" : "false"}" title="${refreshing ? "正在刷新" : "刷新"}" ${refreshing ? "disabled" : ""}>
          ${renderRefreshIcon()}
        </button>
        <button type="button" class="binance-account-action-icon-button unlink" data-binance-account-action="remove" aria-label="解除绑定" title="解除绑定" ${refreshing ? "disabled" : ""}>
          ${renderUnlinkIcon()}
        </button>
      </div>
    </div>
  `;
}

function sectionLabel(section: BinanceAccountSection) {
  if (section === "positions") return "持仓";
  if (section === "open-orders") return "当前委托";
  if (section === "history") return "仓位历史";
  if (section === "profit-calendar") return "收益日历";
  return "资产";
}

function renderAccountMetric(label: string, value: number | null, visible: boolean, signed = false) {
  const tone = signed ? metricTone(value) : "";
  return `
    <div class="binance-account-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${signed ? signedValue(value, visible, false) : assetValue(value, visible, 4)}</strong>
      <small>≈ ${currencyValue(value, visible)}</small>
    </div>
  `;
}

function renderPositionCard(position: BinanceAccountPosition, visible: boolean) {
  const short = position.direction === "SHORT";
  const tone = metricTone(position.unrealizedPnl);
  return `
    <article class="binance-account-position-card ${short ? "short" : "long"}">
      <header>
        <div class="binance-account-position-symbol">
          <span class="binance-account-position-side">${short ? "空" : "多"}</span>
          <strong>${escapeHtml(position.symbol)}</strong>
          <span>永续</span>
          <span>${position.marginType === "cross" ? "全仓" : "逐仓"} ${formatNumber(position.leverage, 0)}X</span>
        </div>
      </header>
      <div class="binance-account-position-featured">
        <div class="${tone}">
          <span>未实现盈亏 (USDT)</span>
          <strong>${signedValue(position.unrealizedPnl, visible, false)}</strong>
        </div>
        <div class="${metricTone(position.roi)}">
          <span>投资回报率</span>
          <strong>${visible ? signedPercent(position.roi) : "••••"}</strong>
        </div>
      </div>
      <div class="binance-account-position-metrics">
        ${positionMetric("持仓数量 (USDT)", position.notionalValue, visible)}
        ${positionMetric("保证金 (USDT)", position.margin, visible)}
        ${positionMetric("保证金比率", position.marginRatio, visible, "%")}
        ${positionMetric("开仓价格 (USDT)", position.entryPrice, visible)}
        ${positionMetric("标记价格 (USDT)", position.markPrice, visible)}
        ${positionMetric("强平价格 (USDT)", position.liquidationPrice, visible)}
      </div>
    </article>
  `;
}

function renderOpenOrderCard(order: BinanceAccountOpenOrder, visible: boolean) {
  const buy = order.side === "BUY";
  const regular = order.source === "ORDER";
  const intent = openOrderIntent(order);
  const intro = openOrderIntro(order, intent);
  const progress = Math.min(100, Math.max(0, order.progressPercent ?? 0));
  return `
    <article class="binance-account-open-order-card ${buy ? "buy" : "sell"} ${regular ? "regular" : "conditional"}">
      <header>
        <div class="binance-account-open-order-symbol">
          <strong>${escapeHtml(order.symbol)}</strong>
          <span>${order.contractType === "PERPETUAL" ? "永续" : escapeHtml(order.contractType)}</span>
        </div>
        ${regular ? `
          <div class="binance-account-open-order-progress" role="progressbar" aria-label="成交比例" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress * 100) / 100}">
            <strong>${formatOrderProgress(progress)}</strong>
            <span><i style="width:${progress}%"></i></span>
          </div>
        ` : ""}
      </header>
      <div class="binance-account-open-order-intro">
        <strong>${escapeHtml(intro.type)} / ${escapeHtml(intro.action)}</strong>
        <time datetime="${openOrderDateTime(order.createdAt)}">${formatHistoryTimestamp(order.createdAt)}</time>
      </div>
      ${regular ? `
        <div class="binance-account-open-order-details regular">
          ${renderOpenOrderMetric(
            "成交数量 / 数量 (USDT)",
            visible
              ? `${formatOrderUsdt(order.executedQuantityUsdt)} / ${formatOrderUsdt(order.quantityUsdt)}`
              : "•••• / ••••",
          )}
          ${renderOpenOrderMetric("价格", visible ? openOrderPrice(order) : "••••")}
        </div>
      ` : `
        <div class="binance-account-open-order-details conditional">
          ${renderOpenOrderMetric("数量 (USDT)", visible ? formatOrderUsdt(order.quantityUsdt) : "••••")}
          ${renderOpenOrderMetric("价格", visible ? openOrderPrice(order) : "••••")}
          ${renderOpenOrderMetric("触发类型", visible ? openOrderTriggerLabel(order) : "••••")}
          ${order.closePosition ? renderOpenOrderMetric("全部平仓", "是") : ""}
          ${order.orderType === "TRAILING_STOP_MARKET" && order.callbackRate != null
            ? renderOpenOrderMetric("回调率", `${formatNumber(order.callbackRate, 2)}%`)
            : ""}
        </div>
      `}
    </article>
  `;
}

function renderOpenOrderMetric(label: string, value: string) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

type BinanceAccountOpenOrderIntent = "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_LONG" | "CLOSE_SHORT";

function openOrderIntent(order: BinanceAccountOpenOrder): BinanceAccountOpenOrderIntent {
  if (order.positionSide === "LONG") {
    return order.side === "SELL" ? "CLOSE_LONG" : "OPEN_LONG";
  }
  if (order.positionSide === "SHORT") {
    return order.side === "BUY" ? "CLOSE_SHORT" : "OPEN_SHORT";
  }
  if (order.reduceOnly || order.closePosition) {
    return order.side === "BUY" ? "CLOSE_SHORT" : "CLOSE_LONG";
  }
  return order.side === "BUY" ? "OPEN_LONG" : "OPEN_SHORT";
}

function openOrderIntro(
  order: BinanceAccountOpenOrder,
  intent: BinanceAccountOpenOrderIntent,
) {
  const opening = intent === "OPEN_LONG" || intent === "OPEN_SHORT";
  const actionLabels: Record<BinanceAccountOpenOrderIntent, string> = {
    OPEN_LONG: "做多",
    OPEN_SHORT: "做空",
    CLOSE_LONG: "平多",
    CLOSE_SHORT: "平空",
  };
  if (order.source === "ALGO" && opening) {
    return {
      type: "条件委托",
      action: `${isOpenOrderMarket(order.orderType) ? "市价" : "限价"}${actionLabels[intent]}`,
    };
  }
  return {
    type: openOrderTypeLabel(order.orderType),
    action: actionLabels[intent],
  };
}

function openOrderTypeLabel(type: string) {
  const labels: Record<string, string> = {
    LIMIT: "限价",
    MARKET: "市价",
    STOP: "限价止损",
    STOP_MARKET: "市价止损",
    TAKE_PROFIT: "限价止盈",
    TAKE_PROFIT_MARKET: "市价止盈",
    TRAILING_STOP_MARKET: "跟踪止损",
  };
  return labels[type] || type.replaceAll("_", " ");
}

function openOrderPriceMatchLabel(value: string) {
  const labels: Record<string, string> = {
    OPPONENT: "对手价",
    OPPONENT_5: "对手五档",
    OPPONENT_10: "对手十档",
    OPPONENT_20: "对手二十档",
    QUEUE: "同向排队价",
    QUEUE_5: "同向五档",
    QUEUE_10: "同向十档",
    QUEUE_20: "同向二十档",
  };
  return labels[value] || value;
}

function openOrderPrice(order: BinanceAccountOpenOrder) {
  if (isOpenOrderMarket(order.orderType)) return "市价";
  if (order.price != null) return formatOrderNumber(order.price, priceDecimals(order.price));
  if (order.priceMatch) return openOrderPriceMatchLabel(order.priceMatch);
  return "—";
}

function openOrderTriggerLabel(order: BinanceAccountOpenOrder) {
  if (order.orderType === "TRAILING_STOP_MARKET") {
    return order.activationPrice == null
      ? "跟踪价格"
      : `${openOrderWorkingTypeLabel(order.workingType)}激活于 ${formatOrderNumber(order.activationPrice, priceDecimals(order.activationPrice))}`;
  }
  if (order.triggerPrice == null) return "—";
  const stopLoss = order.orderType === "STOP" || order.orderType === "STOP_MARKET";
  const takeProfit = order.orderType === "TAKE_PROFIT" || order.orderType === "TAKE_PROFIT_MARKET";
  const operator = stopLoss
    ? order.side === "BUY" ? "≥" : "≤"
    : takeProfit
      ? order.side === "BUY" ? "≤" : "≥"
      : "=";
  return `${openOrderWorkingTypeLabel(order.workingType)}${operator}${formatOrderNumber(order.triggerPrice, priceDecimals(order.triggerPrice))}`;
}

function openOrderWorkingTypeLabel(value: string | null) {
  if (value === "MARK_PRICE") return "标记价格";
  if (value === "CONTRACT_PRICE" || !value) return "最新价格";
  return value.replaceAll("_", " ");
}

function isOpenOrderMarket(type: string) {
  return type === "MARKET" || type.endsWith("_MARKET");
}

function formatOrderProgress(value: number) {
  const decimals = Math.abs(value - Math.round(value)) < 1e-9 ? 0 : 2;
  return `${formatNumber(value, decimals)}%`;
}

function formatOrderUsdt(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatOrderNumber(value, 5);
}

function formatOrderNumber(value: number, decimals: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: Math.abs(value) >= 1_000,
  });
}

function openOrderDateTime(value: number) {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : "";
}

function renderPositionHistoryCard(record: BinanceAccountPositionHistory, visible: boolean, fetchedAt: string) {
  const short = record.direction === "SHORT";
  const realizedTone = visible ? metricTone(record.realizedPnl) : "neutral";
  const roiTone = visible ? metricTone(record.roi) : "neutral";
  const marginLabel = record.marginType === "cross" ? "全仓" : record.marginType === "isolated" ? "逐仓" : "";
  const leverageLabel = record.leverage == null ? "" : `${formatNumber(record.leverage, 0)}X`;
  const directionLabel = short ? "做空" : "做多";
  const closingLabel = record.closeType === "FULL" ? "全部平仓" : "部分平仓";
  return `
    <article class="binance-account-history-card ${short ? "short" : "long"}">
      <header>
        <div class="binance-account-history-symbol">
          <strong>${escapeHtml(record.symbol)}</strong>
          <span>永续</span>
          ${leverageLabel ? `<span>${leverageLabel}</span>` : ""}
          <span class="binance-account-history-direction">${escapeHtml([marginLabel, directionLabel].filter(Boolean).join(" "))}</span>
          <span class="binance-account-history-close-type">${closingLabel}</span>
        </div>
        <div class="binance-account-history-time">
          <span>${formatPositionHistoryTimestamp(record.openTime)} → ${formatPositionHistoryTimestamp(record.closeTime)}&nbsp;&nbsp;${formatHistoryDuration(record.openTime, record.closeTime, fetchedAt)}</span>
        </div>
      </header>
      <div class="binance-account-history-body">
        <div class="binance-account-history-featured ${realizedTone}">
          <span>已实现盈亏 (USDT)</span>
          <strong>${visible ? `${signedValue(record.realizedPnl, true, false)} USDT` : "••••"}</strong>
          ${record.unrealizedPnl == null ? "" : `<small>未实现盈亏 ${visible ? `${signedValue(record.unrealizedPnl, true, false)} USDT` : "••••"}</small>`}
        </div>
        <div class="binance-account-history-featured ${roiTone}">
          <span>收益率</span>
          <strong>${visible ? record.roi == null ? "—" : signedPercent(record.roi) : "••••"}</strong>
        </div>
        ${positionHistoryMetric(`已平仓量 (${record.baseAsset || "—"})`, record.closedAmount, visible, "amount")}
        ${positionHistoryMetric("开仓价格", record.entryPrice, visible, "price")}
        ${positionHistoryMetric("平仓均价", record.averageClosePrice, visible, "price")}
      </div>
    </article>
  `;
}

function positionHistoryMetric(label: string, value: number, visible: boolean, mode: "amount" | "price") {
  const decimals = mode === "price" ? priceDecimals(value) : amountDecimals(value);
  return `
    <div class="binance-account-history-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${visible ? formatNumber(value, decimals) : "••••"}</strong>
    </div>
  `;
}

function positionMetric(label: string, value: number, visible: boolean, suffix = "") {
  return `<div><span>${escapeHtml(label)}</span><strong>${visible ? `${formatNumber(value, suffix ? 2 : priceDecimals(value))}${suffix}` : "••••"}</strong></div>`;
}

function renderEyeIcon(open: boolean) {
  return open
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.7 12s3.2-5.2 9.3-5.2 9.3 5.2 9.3 5.2-3.2 5.2-9.3 5.2S2.7 12 2.7 12Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.9c.5-.1.9-.1 1.4-.1 6.1 0 9.3 5.2 9.3 5.2a16 16 0 0 1-2.8 3.2M6.1 8.2A15.3 15.3 0 0 0 2.7 12s3.2 5.2 9.3 5.2c1.2 0 2.3-.2 3.2-.5"></path></svg>`;
}

function renderRefreshIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-4M4 4v5h5"></path><path d="M4 13a8 8 0 0 0 14.9 4M20 20v-5h-5"></path></svg>`;
}

function renderUnlinkIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7h3"></path><path d="M15 7h2a5 5 0 1 1 0 10h-3"></path><path d="M8 12h8"></path><path d="M5 3l14 18"></path></svg>`;
}

function renderChevronIcon(direction: "previous" | "next") {
  return direction === "previous"
    ? `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"></path></svg>`
    : `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"></path></svg>`;
}

export function shiftBinanceAccountProfitCalendarMonth(month: string, offset: number) {
  const normalized = validCalendarMonth(month) ? month : localMonthKey(new Date());
  const [year, monthNumber] = normalized.split("-").map(Number);
  return localMonthKey(new Date(year, monthNumber - 1 + Math.trunc(offset), 1));
}

function localMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function validCalendarMonth(value: string) {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
}

function roundedCalendarPnl(value: number) {
  const rounded = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatCalendarPnl(value: number) {
  if (Math.abs(value) < 1e-12) return "0.00";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: Math.abs(value) >= 1_000,
  })}`;
}

function formatMonthlyPnl(value: number) {
  if (Math.abs(value) < 1e-12) return "0.00";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: Math.abs(value) >= 1_000,
  })}`;
}

function signedMetric(value: number | null, percent: number | null, visible: boolean) {
  if (!visible) return `<strong>••••</strong>`;
  if (value == null) return `<strong class="muted">暂不可用</strong>`;
  const tone = metricTone(value);
  const percentage = percent == null ? "" : ` (${signedPercent(percent)})`;
  return `<strong class="${tone}">${signedPrefix(value)}${currencyValue(Math.abs(value), true)}${percentage}</strong>`;
}

function signedValue(value: number | null, visible: boolean, withCurrency = true) {
  if (!visible) return "••••";
  if (value == null) return "—";
  const formatted = withCurrency ? currencyValue(Math.abs(value), true) : assetValue(Math.abs(value), true, 4);
  return `${signedPrefix(value)}${formatted}`;
}

function signedPrefix(value: number) {
  return value > 0 ? "+" : value < 0 ? "-" : "";
}

function signedPercent(value: number) {
  return `${signedPrefix(value)}${formatNumber(Math.abs(value), 2)}%`;
}

function metricTone(value: number | null | undefined) {
  if (value == null || Math.abs(value) < 1e-12) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function assetValue(value: number | null, visible: boolean, decimals: number) {
  if (!visible) return "••••••••";
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumber(value, decimals);
}

function currencyValue(value: number | null, visible: boolean) {
  if (!visible) return "$••••";
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${formatNumber(value, 2)}`;
}

function formatNumber(value: number, decimals: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals === 0 ? 0 : Math.min(2, decimals),
    maximumFractionDigits: decimals,
    useGrouping: Math.abs(safe) >= 1_000,
  });
}

function priceDecimals(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000) return 2;
  if (absolute >= 1) return 4;
  return 6;
}

function amountDecimals(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100) return 2;
  if (absolute >= 1) return 4;
  return 6;
}

function formatHistoryTimestamp(value: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "--";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("month")}/${part("day")}/${part("year")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function formatPositionHistoryTimestamp(value: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "--";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function formatHistoryDuration(openTime: number | null, closeTime: number | null, fetchedAt: string) {
  if (openTime == null || !Number.isFinite(openTime)) return "";
  const fallback = Date.parse(fetchedAt);
  const endTime = closeTime ?? (Number.isFinite(fallback) ? fallback : Date.now());
  const durationMs = Math.max(0, endTime - openTime);
  const totalMinutes = Math.floor(durationMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor(totalMinutes % (24 * 60) / 60);
  const minutes = totalMinutes % 60;
  const parts = [days ? `${days}天` : "", hours ? `${hours}小时` : "", `${minutes}分`].filter(Boolean);
  return `(${parts.join("")})`;
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
