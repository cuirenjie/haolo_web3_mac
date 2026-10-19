import {
  renderTradingMarketAssetLogo,
  type TradingMarketIdentityProvider,
} from "./trading-expert-market-identity.ts";

export type TradingAlertFilter = "monitoring" | "triggered" | "paused";
export type PlanningSection = "plans" | "alerts";

export type TradingAlertEditorMarketOption = {
  id: string;
  provider: TradingMarketIdentityProvider;
  baseAsset: string;
  assetClass?: string;
  displaySymbol: string;
  venue: string;
  tag: string;
  markPrice: number;
  changePercent: number;
  quoteAvailable: boolean;
};

export type TradingAlertEditorPeriodOption = {
  value: string;
  label: string;
};

export type TradingAlertEditorSelection = {
  alertId: string;
  marketId: string;
  interval: string;
  selectorKind: "fixed" | "universe";
  clock: string;
  mode: string;
};

export type TradingAlertsUiState = {
  loading: boolean;
  loaded: boolean;
  busyAlertId: string | null;
  error: string | null;
  enabled: boolean;
  engine: { running?: boolean; alerts?: number; subscriptions?: number };
  alerts: any[];
  gaps: any[];
  evidence: any[];
  providers: any[];
  filter: TradingAlertFilter;
  editorAlertId: string | null;
  editorSelection: TradingAlertEditorSelection | null;
  editorMarkets: TradingAlertEditorMarketOption[];
  editorMarketsLoading: boolean;
  editorMarketsError: string | null;
  editorPeriodOptions: TradingAlertEditorPeriodOption[];
};

export type TradingAlertConversationSource = {
  sourceText?: string | null;
  conversation?: Array<{ role?: string | null; text?: string | null }> | null;
};

// A clarification reply is an answer to the existing instruction, not a new
// standalone instruction. Prefer the first user turn so a transient follow-up
// cannot replace the complete rule with a short answer such as
// “触碰任意一条就预警”.
export function resolveTradingAlertSourceText(
  previous: TradingAlertConversationSource | null | undefined,
  currentText: string,
) {
  const userTurns = previous?.conversation?.filter((turn) => (
    turn?.role === "user" && String(turn?.text || "").trim()
  )) || [];
  const persistedSource = String(previous?.sourceText || "").trim();
  const comparable = (value: unknown) => String(value || "")
    .trim()
    .replace(/[\s，。；：、“”'"！？?.]/g, "")
    .toLowerCase();
  const persistedTurnIndex = userTurns.findIndex((turn) => (
    comparable(turn?.text) === comparable(persistedSource)
  ));
  return String(
    persistedTurnIndex > 0 ? userTurns[0]?.text : persistedSource || userTurns[0]?.text || currentText || "",
  ).trim();
}

export function createTradingAlertsUiState(): TradingAlertsUiState {
  return {
    loading: false,
    loaded: false,
    busyAlertId: null,
    error: null,
    enabled: false,
    engine: {},
    alerts: [], gaps: [], evidence: [], providers: [],
    filter: "monitoring",
    editorAlertId: null,
    editorSelection: null,
    editorMarkets: [],
    editorMarketsLoading: false,
    editorMarketsError: null,
    editorPeriodOptions: [
      { value: "1w", label: "1周" },
      { value: "1d", label: "1日" },
      { value: "5m", label: "5分" },
      { value: "15m", label: "15分" },
      { value: "1h", label: "1时" },
      { value: "4h", label: "4时" },
    ],
  };
}

export function applyTradingAlertsSnapshot(state: TradingAlertsUiState, payload: any) {
  const value = payload?.ok === true ? payload.data : payload;
  if (payload?.ok === false) {
    state.error = String(payload.error?.message || "预警数据加载失败");
    state.loading = false;
    return;
  }
  state.enabled = value?.enabled === true;
  state.engine = value?.engine && typeof value.engine === "object" ? value.engine : {};
  state.alerts = Array.isArray(value?.alerts) ? value.alerts : [];
  state.gaps = Array.isArray(value?.gaps) ? value.gaps : [];
  state.evidence = Array.isArray(value?.evidence) ? value.evidence : [];
  state.providers = Array.isArray(value?.providers) ? value.providers : [];
  state.error = null;
  state.loading = false;
  state.loaded = true;
}

export function tradingAlertHasDrawingContext(alert: any) {
  return Array.isArray(alert?.rule?.contexts)
    && alert.rule.contexts.some((context: any) => Boolean(context?.drawingBinding));
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));

const TRADING_ALERT_VENUE_LABELS: Record<string, string> = {
  BINANCE: "币安",
  HYPERLIQUID: "Hyperliquid",
};
const TRADING_ALERT_QUOTE_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD", "USD"];
const TRADING_ALERT_MARKET_INTERVAL_PATTERN = /\b([A-Z][A-Z0-9_-]*):([A-Z][A-Z0-9_-]*):([A-Z0-9][A-Z0-9._/-]*)(?:\s*[·-]\s*|\s+)(\d+(?:\.\d+)?[smhdw])\b/gi;

function tradingAlertBaseAsset(symbol: string) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const quote = TRADING_ALERT_QUOTE_ASSETS.find((candidate) => (
    normalized.length > candidate.length && normalized.endsWith(candidate)
  ));
  return quote ? normalized.slice(0, -quote.length) : normalized;
}

export function formatTradingAlertMarketLabel(marketId: unknown, interval: unknown) {
  const market = String(marketId ?? "").trim();
  const period = String(interval ?? "").trim();
  const [venue, , symbol, ...extra] = market.split(":");
  if (!venue || !symbol || extra.length) return [market, period].filter(Boolean).join("-");
  const venueLabel = TRADING_ALERT_VENUE_LABELS[venue.toUpperCase()] || venue;
  const baseAsset = tradingAlertBaseAsset(symbol);
  return [venueLabel, baseAsset, period].filter(Boolean).join("-");
}

export function formatTradingAlertDisplayText(value: unknown) {
  return String(value ?? "").replace(
    TRADING_ALERT_MARKET_INTERVAL_PATTERN,
    (_match, venue, marketType, symbol, interval) => formatTradingAlertMarketLabel(
      `${venue}:${marketType}:${symbol}`,
      interval,
    ),
  );
}

export function formatTradingAlertCardSummary(value: unknown, marketLabel: unknown) {
  const summary = formatTradingAlertDisplayText(value).trim();
  const market = String(marketLabel ?? "").trim();
  if (!market || !summary.startsWith(market)) return summary;
  const suffix = summary.slice(market.length);
  if (suffix && !/^[\s,，。:：·-]/.test(suffix)) return summary;
  return suffix.replace(/^[\s,，。:：·-]+/, "");
}

function statusMeta(alert: any) {
  if (alert.status === "completed") return { label: "已完成", tone: "completed" };
  if (alert.status === "triggered") return { label: "已触发", tone: "triggered" };
  if (alert.status === "paused") return { label: "已暂停", tone: "paused" };
  if (alert.status === "cooling_down") return { label: "冷却中", tone: "loading" };
  if (["failed", "gap_detected", "reconnecting"].includes(alert.status)) return { label: alert.status === "gap_detected" ? "存在空档" : alert.status === "reconnecting" ? "重连中" : "需要处理", tone: "attention" };
  if (alert.status === "arming") return { label: "正在预热", tone: "loading" };
  if (tradingAlertIsExecutionPlanLinked(alert)) {
    return executionPlanAlertActiveConditionIds(alert.rule).has("execution-plan-entry")
      ? { label: "监控入场", tone: "monitoring" }
      : { label: "监控风控", tone: "monitoring" };
  }
  return { label: "监控中", tone: "monitoring" };
}

export function tradingAlertIsExecutionPlanLinked(alert: any) {
  return String(alert?.rule?.ruleId || "").startsWith("execution-plan-alert-");
}

function executionPlanAlertActiveConditionIds(rule: any) {
  const ids = new Set<string>();
  const visit = (node: any) => {
    if (node?.type === "condition" && node.condition?.conditionId) {
      ids.add(String(node.condition.conditionId));
      return;
    }
    if (Array.isArray(node?.children)) node.children.forEach(visit);
  };
  visit(rule?.root);
  return ids;
}

function renderExecutionPlanAlertConditions(alert: any) {
  const conditionIds = [
    "execution-plan-entry",
    "execution-plan-stop-loss",
    "execution-plan-take-profit",
  ];
  const activeIds = alert.enabled ? executionPlanAlertActiveConditionIds(alert.rule) : new Set<string>();
  const lines = String(alert.rule?.normalizedSummary || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return `<div class="trading-alert-plan-conditions" aria-label="计划联动预警条件">
    ${lines.map((line, index) => {
      const separator = line.indexOf("｜");
      const phase = separator >= 0 ? line.slice(0, separator).trim() : "计划";
      const description = separator >= 0 ? line.slice(separator + 1).trim() : line;
      const active = activeIds.has(conditionIds[index] || "");
      return `<p class="trading-alert-plan-condition${active ? " active" : ""}"><span>${esc(phase)}</span><b>${esc(description)}</b></p>`;
    }).join("")}
  </div>`;
}

function marketLabels(rule: any) {
  return (rule?.contexts || []).flatMap((context: any) => {
    const selector = context.marketSelector || {};
    const markets = selector.kind === "fixed" ? selector.marketIds : selector.kind === "current" ? ["当前交易对"] : selector.frozenMarketIds?.length ? selector.frozenMarketIds : ["市场集合"];
    return markets.flatMap((market: string) => (context.intervals || []).map((interval: string) => formatTradingAlertMarketLabel(market, interval)));
  });
}

function alertMatchesFilter(alert: any, filter: TradingAlertFilter) {
  if (filter === "monitoring") return ["arming", "monitoring", "cooling_down"].includes(alert.status);
  if (filter === "triggered") return ["triggered", "completed"].includes(alert.status);
  if (filter === "paused") return ["paused", "failed", "gap_detected", "reconnecting"].includes(alert.status);
  return false;
}

function sortAlertsForDisplay(alerts: any[]) {
  const rank = (alert: any) => {
    if (alertMatchesFilter(alert, "monitoring")) return 0;
    if (alertMatchesFilter(alert, "triggered")) return 1;
    if (alertMatchesFilter(alert, "paused")) return 2;
    return 0;
  };
  return alerts
    .map((alert, index) => ({ alert, index }))
    .sort((left, right) => rank(left.alert) - rank(right.alert) || left.index - right.index)
    .map(({ alert }) => alert);
}

function renderAlertCard(state: TradingAlertsUiState, alert: any) {
  const status = statusMeta(alert);
  const gaps = state.gaps.filter((gap) => gap.alertId === alert.alertId);
  const evidence = state.evidence.filter((entry) => entry.alertId === alert.alertId);
  const busy = state.busyAlertId === alert.alertId;
  const drawingLocked = tradingAlertHasDrawingContext(alert);
  const planLinked = tradingAlertIsExecutionPlanLinked(alert);
  const editLocked = drawingLocked || planLinked;
  const clock = alert.rule?.evaluationPolicy?.clock === "bar_close" ? "收盘确认" : alert.rule?.evaluationPolicy?.clock === "mixed" ? "多个条件" : "盘中实时";
  const mode = alert.rule?.triggerPolicy?.mode === "repeat" ? "重复监控" : "一次性";
  const market = marketLabels(alert.rule)[0] || "未指定市场";
  const title = formatTradingAlertDisplayText(alert.rule?.title || "交易预警");
  const summary = formatTradingAlertCardSummary(alert.rule?.normalizedSummary || "等待规则摘要", market);
  const details = planLinked
    ? renderExecutionPlanAlertConditions(alert)
    : `<p title="${esc(summary)}">${esc(summary)}</p>`;
  const metadata = planLinked ? `${market} · ${clock} · 随计划自动管理` : `${market} · ${clock} · ${mode}`;
  return `
    <article class="trading-alert-card ${esc(status.tone)}${planLinked ? " execution-plan-linked" : ""}" data-trading-alert-card="${esc(alert.alertId)}">
      <div class="trading-alert-card-copy">
        <div class="trading-alert-card-head">
          <h2 title="${esc(title)}">${esc(title)}</h2>
          <span class="trading-alert-status ${esc(status.tone)}">${esc(status.label)}</span>
        </div>
        ${details}
        <small title="${esc(metadata)}">${esc(metadata)}</small>
      </div>
      <footer>
        <span title="${esc(gaps.length ? "存在监控空档" : alert.failure || "")}">${gaps.length ? "监控空档" : evidence.length ? `触发 ${evidence.length} 次` : `Revision ${esc(alert.rule?.revision || 1)}`}</span>
        <div class="trading-alert-actions">
          <button type="button" data-trading-alert-action="view" data-alert-id="${esc(alert.alertId)}">查看</button>
          ${busy || editLocked ? "" : `<button type="button" data-trading-alert-action="edit" data-alert-id="${esc(alert.alertId)}">编辑</button>`}
          <button type="button" data-trading-alert-action="${alert.enabled ? "pause" : "resume"}" data-alert-id="${esc(alert.alertId)}" ${busy || alert.status === "completed" ? "disabled" : ""}>${busy ? "处理中…" : alert.enabled ? "暂停" : "恢复"}</button>
          <button type="button" class="danger" data-trading-alert-action="delete" data-alert-id="${esc(alert.alertId)}" ${busy ? "disabled" : ""}>删除</button>
        </div>
      </footer>
    </article>`;
}

function renderEditorSelect(
  name: string,
  label: string,
  value: string,
  options: Array<{ value: string; label: string }>,
  { disabled = false, opensAbove = false, fallbackLabel = "" } = {},
) {
  const selected = options.find((option) => option.value === value)
    || (value ? { value, label: fallbackLabel || value } : options[0]);
  if (!selected) return "";
  const labelId = `trading-alert-editor-${name}-label`;
  const valueId = `trading-alert-editor-${name}-value`;
  const periodLabelAttribute = name === "intervals" ? " data-i18n-trading-period-label" : "";
  return `<div class="trading-alert-editor-field">
    <span id="${esc(labelId)}">${esc(label)}</span>
    <div class="video-expert-select trading-alert-select${opensAbove ? " opens-above" : ""}" data-trading-alert-select="${esc(name)}">
      <input type="hidden" name="${esc(name)}" value="${esc(selected.value)}" ${disabled ? "disabled" : ""} />
      <button type="button" class="video-expert-select-button" data-trading-alert-select-trigger aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${esc(labelId)} ${esc(valueId)}" ${disabled ? "disabled" : ""}>
        <span id="${esc(valueId)}" data-trading-alert-select-label${periodLabelAttribute}>${esc(selected.label)}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" draggable="false"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div class="video-expert-select-menu trading-alert-select-menu" data-trading-alert-select-menu role="listbox" aria-labelledby="${esc(labelId)}" hidden>
        ${options.map((option) => `<button type="button" class="${option.value === selected.value ? "selected" : ""}" data-trading-alert-select-value="${esc(option.value)}" data-trading-alert-select-option-label="${esc(option.label)}"${periodLabelAttribute} role="option" aria-selected="${option.value === selected.value ? "true" : "false"}" tabindex="-1">${esc(option.label)}</button>`).join("")}
      </div>
    </div>
  </div>`;
}

function tradingAlertEditorMarketFallback(marketId: string): TradingAlertEditorMarketOption {
  const [venueId, marketType, symbol = marketId] = marketId.split(":");
  const normalizedSymbol = symbol.trim().toUpperCase();
  const baseAsset = tradingAlertBaseAsset(normalizedSymbol) || normalizedSymbol;
  const quoteAsset = normalizedSymbol.slice(baseAsset.length) || "USDT";
  const provider = venueId?.toLowerCase() === "ifind"
    ? "ifind"
    : venueId?.toLowerCase() === "finnhub"
      ? "finnhub"
      : "binance";
  return {
    id: marketId,
    provider,
    baseAsset,
    assetClass: provider === "binance" && marketType?.toUpperCase() !== "SPOT" ? "stock" : "crypto",
    displaySymbol: [baseAsset, quoteAsset].filter(Boolean).join("/"),
    venue: TRADING_ALERT_VENUE_LABELS[venueId?.toUpperCase()] || venueId || "币安",
    tag: marketType?.toUpperCase() === "SPOT" ? "现货" : "永续",
    markPrice: 0,
    changePercent: 0,
    quoteAvailable: false,
  };
}

function tradingAlertEditorMarketPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value >= 1_000) return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

export function renderTradingAlertEditorMarketOptions(
  markets: ReadonlyArray<TradingAlertEditorMarketOption>,
  selectedMarketId: string,
) {
  return markets.map((market) => {
    const selected = market.id === selectedMarketId;
    const changeText = market.quoteAvailable
      ? `${market.changePercent >= 0 ? "+" : ""}${market.changePercent.toFixed(2)}%`
      : "--";
    return `<button type="button" class="trading-alert-market-option${selected ? " selected" : ""}" data-trading-alert-select-value="${esc(market.id)}" data-trading-alert-select-option-label="${esc(`${market.displaySymbol} · ${market.venue} · ${market.tag}`)}" data-trading-alert-market-search-text="${esc(`${market.id} ${market.displaySymbol} ${market.baseAsset} ${market.venue} ${market.tag}`)}" role="option" aria-selected="${selected ? "true" : "false"}" tabindex="-1">
      <span class="trading-alert-market-pair">${renderTradingMarketAssetLogo(market.baseAsset, market.provider, false, market.assetClass, market.displaySymbol)}<span><strong>${esc(market.displaySymbol)}</strong><small>${esc(market.tag)}</small></span></span>
      <span>${esc(market.venue)}</span>
      <b>${esc(tradingAlertEditorMarketPrice(market.markPrice))}</b>
      <em class="${market.quoteAvailable ? market.changePercent >= 0 ? "positive" : "negative" : ""}">${esc(changeText)}</em>
    </button>`;
  }).join("");
}

function renderEditorMarketSelect(
  state: TradingAlertsUiState,
  marketId: string,
  disabled: boolean,
) {
  const selected = state.editorMarkets.find((market) => market.id === marketId)
    || tradingAlertEditorMarketFallback(marketId);
  const markets = state.editorMarkets.some((market) => market.id === selected.id)
    ? state.editorMarkets
    : [selected, ...state.editorMarkets];
  const status = state.editorMarketsError
    || (state.editorMarketsLoading ? "正在加载交易对…" : markets.length ? "" : "暂无可选交易对");
  return `<div class="trading-alert-editor-field">
    <span id="trading-alert-editor-market-label">交易对</span>
    <div class="video-expert-select trading-alert-select trading-alert-market-select" data-trading-alert-select="marketIds">
      <input type="hidden" name="marketIds" value="${esc(selected.id)}" ${disabled ? "disabled" : ""} />
      <button type="button" class="video-expert-select-button" data-trading-alert-select-trigger aria-haspopup="dialog" aria-expanded="false" aria-labelledby="trading-alert-editor-market-label trading-alert-editor-market-value" ${disabled ? "disabled" : ""}>
        <span id="trading-alert-editor-market-value" data-trading-alert-select-label>${esc(`${selected.displaySymbol} · ${selected.venue} · ${selected.tag}`)}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" draggable="false"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div class="trading-alert-market-menu" data-trading-alert-select-menu role="dialog" aria-label="选择交易对" hidden>
        <label class="trading-alert-market-search">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
          <input type="search" data-trading-alert-market-search placeholder="搜索交易对" autocomplete="off" />
        </label>
        <div class="trading-alert-market-head" aria-hidden="true"><span>名称</span><span>平台</span><span>最新价</span><span>24H涨幅</span></div>
        <div class="trading-alert-market-options" data-trading-alert-market-options role="listbox" aria-labelledby="trading-alert-editor-market-label">
          ${renderTradingAlertEditorMarketOptions(markets.slice(0, 120), selected.id)}
        </div>
        <p class="trading-alert-market-status" data-trading-alert-market-status ${status ? "" : "hidden"}>${esc(status)}</p>
      </div>
    </div>
  </div>`;
}

function renderEditor(state: TradingAlertsUiState, alert: any) {
  const anchor = alert.rule?.contexts?.find((context: any) => context.contextId === alert.rule?.evaluationPolicy?.anchorContextId) || alert.rule?.contexts?.[0];
  const drawingLocked = tradingAlertHasDrawingContext(alert);
  const editorSelection = state.editorSelection?.alertId === alert.alertId ? state.editorSelection : null;
  const selectorKind = editorSelection?.selectorKind
    || (anchor?.marketSelector?.kind === "universe" ? "universe" : "fixed");
  const marketId = editorSelection?.marketId
    || (anchor?.marketSelector?.marketIds || anchor?.marketSelector?.frozenMarketIds || [])[0]
    || "BINANCE:FUTURES:BTCUSDT";
  const interval = editorSelection?.interval || (anchor?.intervals || ["1h"])[0] || "1h";
  const revisionBusy = state.busyAlertId === alert.alertId;
  return `<div class="trading-alert-dialog-backdrop" data-trading-alert-action="close-editor"></div>
    <dialog class="trading-alert-editor" open aria-modal="true" aria-labelledby="tradingAlertEditorTitle">
      <header><h2 id="tradingAlertEditorTitle">编辑预警配置</h2><button type="button" data-trading-alert-action="close-editor" aria-label="关闭">×</button></header>
      ${drawingLocked ? `<div class="trading-alert-editor-note">该规则绑定画线，交易对和周期跟随画线，不能泛化。</div>` : ""}
      <form data-trading-alert-editor-form data-alert-id="${esc(alert.alertId)}" data-context-id="${esc(anchor?.contextId || "primary")}"${revisionBusy ? ' aria-busy="true"' : ""}>
        <input type="hidden" name="selectorKind" value="${esc(selectorKind)}" ${drawingLocked ? "disabled" : ""} />
        ${renderEditorMarketSelect(state, marketId, drawingLocked)}
        ${renderEditorSelect("intervals", "周期", interval, state.editorPeriodOptions, {
          disabled: drawingLocked,
          fallbackLabel: interval,
        })}
        ${renderEditorSelect("clock", "确认方式", editorSelection?.clock || alert.rule?.evaluationPolicy?.clock || "bar_close", [
          { value: "bar_close", label: "K线收盘确认" },
          { value: "mixed", label: "多个条件" },
          { value: "bar_update", label: "盘中实时" },
        ])}
        ${renderEditorSelect("mode", "重复方式", editorSelection?.mode || alert.rule?.triggerPolicy?.mode || "once", [
          { value: "once", label: "一次性" },
          { value: "repeat", label: "重复监控" },
        ], { opensAbove: true })}
        <footer><button type="button" class="secondary-button" data-trading-alert-action="close-editor">取消</button><button type="submit" class="primary-button"${revisionBusy ? " disabled" : ""}>${revisionBusy ? "正在生成…" : "生成新预警"}</button></footer>
      </form>
    </dialog>`;
}

export function renderPlanningNavigation(activeSection: PlanningSection) {
  const tabs: Array<[PlanningSection, string]> = [["plans", "计划"], ["alerts", "预警"]];
  return `<nav class="planning-primary-tabs" aria-label="计划分类">${tabs.map(([id, label]) => `<button type="button" class="${activeSection === id ? "active" : ""}" data-planning-section="${id}" aria-pressed="${activeSection === id}">${label}</button>`).join("")}</nav>`;
}

export function renderTradingAlertsPage(state: TradingAlertsUiState) {
  const editor = state.alerts.find((alert) => (
    alert.alertId === state.editorAlertId
    && !tradingAlertHasDrawingContext(alert)
    && !tradingAlertIsExecutionPlanLinked(alert)
  ));
  const alerts = sortAlertsForDisplay(state.alerts.filter((alert) => alertMatchesFilter(alert, state.filter)));
  const counts = {
    monitoring: state.alerts.filter((item) => alertMatchesFilter(item, "monitoring")).length,
    triggered: state.alerts.filter((item) => alertMatchesFilter(item, "triggered")).length,
    paused: state.alerts.filter((item) => alertMatchesFilter(item, "paused")).length,
  };
  const tabs: Array<[TradingAlertFilter, string]> = [["monitoring", "监控中"], ["triggered", "已触发"], ["paused", "已暂停"]];
  const alertSubfilters = state.alerts.length
    ? `<nav class="trading-alert-subfilters" aria-label="筛选预警">${tabs.map(([id, label]) => `<button type="button" class="${state.filter === id ? "active" : ""}" data-trading-alert-filter="${id}" aria-pressed="${state.filter === id}">${label}<span>${counts[id]}</span></button>`).join("")}</nav>`
    : "";
  return `<main class="trading-alerts-page">
    ${renderPlanningNavigation("alerts")}
    ${alertSubfilters}
    <div class="trading-alert-list-scroll" role="region" aria-label="预警列表" tabindex="0">
      ${state.loading ? `<div class="trading-alert-loading" role="status"><span></span>正在读取预警…</div>` : alerts.length ? `<section class="trading-alert-card-grid">${alerts.map((alert) => renderAlertCard(state, alert)).join("")}</section>` : `<section class="trading-alert-empty"><p>当前筛选下没有预警</p></section>`}
    </div>
    ${editor ? renderEditor(state, editor) : ""}
  </main>`;
}
