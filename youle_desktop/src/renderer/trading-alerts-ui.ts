export type TradingAlertFilter = "all" | "monitoring" | "triggered" | "paused" | "attention" | "draft";

export type TradingAlertsUiState = {
  loading: boolean;
  loaded: boolean;
  busyAlertId: string | null;
  error: string | null;
  enabled: boolean;
  engine: { running?: boolean; alerts?: number; subscriptions?: number };
  alerts: any[];
  drafts: any[];
  gaps: any[];
  evidence: any[];
  providers: any[];
  pendingConfirmations: any[];
  filter: TradingAlertFilter;
  selectedAlertId: string | null;
  selectedEvidenceId: string | null;
  editorAlertId: string | null;
};

export type TradingAlertConversationSource = {
  sourceText?: string | null;
  conversation?: Array<{ role?: string | null; text?: string | null }> | null;
};

// A clarification reply is an answer to the existing instruction, not a new
// standalone instruction. Prefer the first user turn so a resumed/persisted
// draft cannot replace the complete rule with a short answer such as
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
    alerts: [], drafts: [], gaps: [], evidence: [], providers: [], pendingConfirmations: [],
    filter: "all",
    selectedAlertId: null,
    selectedEvidenceId: null,
    editorAlertId: null,
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
  state.drafts = Array.isArray(value?.drafts) ? value.drafts : [];
  state.gaps = Array.isArray(value?.gaps) ? value.gaps : [];
  state.evidence = Array.isArray(value?.evidence) ? value.evidence : [];
  state.providers = Array.isArray(value?.providers) ? value.providers : [];
  state.pendingConfirmations = Array.isArray(value?.pendingConfirmations) ? value.pendingConfirmations : [];
  state.error = null;
  state.loading = false;
  state.loaded = true;
  if (state.selectedAlertId && !state.alerts.some((alert) => alert.alertId === state.selectedAlertId)) { state.selectedAlertId = null; state.selectedEvidenceId = null; }
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));

function statusMeta(alert: any) {
  if (alert.status === "completed") return { label: "已完成", tone: "completed" };
  if (alert.status === "triggered") return { label: "已触发", tone: "triggered" };
  if (alert.status === "paused") return { label: "已暂停", tone: "paused" };
  if (alert.status === "cooling_down") return { label: "冷却中", tone: "loading" };
  if (["failed", "gap_detected", "reconnecting"].includes(alert.status)) return { label: alert.status === "gap_detected" ? "存在空档" : alert.status === "reconnecting" ? "重连中" : "需要处理", tone: "attention" };
  if (alert.status === "arming") return { label: "正在预热", tone: "loading" };
  return { label: "监控中", tone: "monitoring" };
}

function marketLabels(rule: any) {
  return (rule?.contexts || []).flatMap((context: any) => {
    const selector = context.marketSelector || {};
    const markets = selector.kind === "fixed" ? selector.marketIds : selector.kind === "current" ? ["当前交易对"] : selector.frozenMarketIds?.length ? selector.frozenMarketIds : ["市场集合"];
    return markets.flatMap((market: string) => (context.intervals || []).map((interval: string) => `${market} · ${interval}`));
  });
}

function providerLabels(rule: any) {
  const selected = (rule?.dataRequirements || []).map((entry: any) => entry.selectedProvider).filter(Boolean);
  return [...new Set(selected.length ? selected : ["binance-public"])];
}

function readableTime(value: unknown) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
}

function alertMatchesFilter(alert: any, filter: TradingAlertFilter) {
  if (filter === "all") return true;
  if (filter === "monitoring") return ["arming", "monitoring", "cooling_down"].includes(alert.status);
  if (filter === "triggered") return ["triggered", "completed"].includes(alert.status);
  if (filter === "paused") return alert.status === "paused";
  if (filter === "attention") return ["failed", "gap_detected", "reconnecting"].includes(alert.status);
  return false;
}

function sortAlertsForDisplay(alerts: any[]) {
  const rank = (alert: any) => {
    if (alertMatchesFilter(alert, "monitoring")) return 0;
    if (alertMatchesFilter(alert, "triggered")) return 1;
    if (alertMatchesFilter(alert, "paused")) return 2;
    if (alertMatchesFilter(alert, "attention")) return 3;
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
  const clock = alert.rule?.evaluationPolicy?.clock === "bar_close" ? "收盘确认" : alert.rule?.evaluationPolicy?.clock === "mixed" ? "混合确认" : "盘中实时";
  const mode = alert.rule?.triggerPolicy?.mode === "repeat" ? "重复监控" : "一次性";
  const market = marketLabels(alert.rule)[0] || "未指定市场";
  return `
    <article class="trading-alert-card ${esc(status.tone)}" data-trading-alert-card="${esc(alert.alertId)}">
      <span class="trading-alert-status ${esc(status.tone)}">${esc(status.label)}</span>
      <div class="trading-alert-card-copy">
        <h2 title="${esc(alert.rule?.title || "交易预警")}">${esc(alert.rule?.title || "交易预警")}</h2>
        <p title="${esc(alert.rule?.normalizedSummary || "等待规则摘要")}">${esc(alert.rule?.normalizedSummary || "等待规则摘要")}</p>
        <small title="${esc(`${market} · ${clock} · ${mode}`)}">${esc(market)} · ${esc(clock)} · ${esc(mode)}</small>
      </div>
      <footer>
        <span title="${esc(gaps.length ? "存在监控空档" : alert.failure || "")}">${gaps.length ? "监控空档" : evidence.length ? `触发 ${evidence.length} 次` : `Revision ${esc(alert.rule?.revision || 1)}`}</span>
        <div class="trading-alert-actions">
          <button type="button" data-trading-alert-action="view" data-alert-id="${esc(alert.alertId)}">查看</button>
          <button type="button" data-trading-alert-action="edit" data-alert-id="${esc(alert.alertId)}" ${busy ? "disabled" : ""}>编辑</button>
          <button type="button" data-trading-alert-action="${alert.enabled ? "pause" : "resume"}" data-alert-id="${esc(alert.alertId)}" ${busy || alert.status === "completed" ? "disabled" : ""}>${busy ? "处理中…" : alert.enabled ? "暂停" : "恢复"}</button>
          <button type="button" class="danger" data-trading-alert-action="delete" data-alert-id="${esc(alert.alertId)}" ${busy ? "disabled" : ""}>删除</button>
        </div>
      </footer>
    </article>`;
}

function renderDraftCard(draft: any) {
  const label = draft.status === "awaiting_clarification" ? "等待补充" : draft.status === "awaiting_authorization" ? "等待接入" : draft.status === "awaiting_confirmation" ? "等待确认" : "创建中";
  const detail = draft.questions?.length ? `${draft.questions.length} 项待补充` : "等待继续";
  return `<article class="trading-alert-card trading-alert-draft-card" data-trading-alert-draft-card="${esc(draft.draftId)}">
    <span class="trading-alert-status draft">${esc(label)}</span>
    <div class="trading-alert-card-copy">
      <h2 title="${esc(draft.rule?.title || "预警草稿")}">${esc(draft.rule?.title || "预警草稿")}</h2>
      <p title="${esc(draft.rule?.normalizedSummary || draft.sourceText)}">${esc(draft.rule?.normalizedSummary || draft.sourceText)}</p>
      <small>草稿 · ${esc(detail)}</small>
    </div>
    <footer><span>未完成</span><div class="trading-alert-actions"><button type="button" data-trading-alert-draft="${esc(draft.draftId)}">继续</button></div></footer>
  </article>`;
}

function renderDetail(state: TradingAlertsUiState, alert: any) {
  const evidence = state.evidence.filter((entry) => entry.alertId === alert.alertId).sort((a, b) => b.triggeredAt - a.triggeredAt);
  const gaps = state.gaps.filter((gap) => gap.alertId === alert.alertId).sort((a, b) => b.startedAt - a.startedAt);
  return `<section class="trading-alert-detail" aria-labelledby="tradingAlertDetailTitle">
    <header><button type="button" data-trading-alert-action="back" aria-label="返回预警列表">←</button><div><h1 id="tradingAlertDetailTitle">${esc(alert.rule?.title)}</h1><p>${esc(alert.rule?.normalizedSummary)}</p></div></header>
    <div class="trading-alert-detail-grid">
      <section><h2>执行配置</h2><dl>
        <div><dt>市场 / 周期</dt><dd>${marketLabels(alert.rule).map(esc).join("；")}</dd></div>
        <div><dt>判断时钟</dt><dd>${esc(alert.rule?.evaluationPolicy?.clock)}</dd></div>
        <div><dt>触发策略</dt><dd>${esc(alert.rule?.triggerPolicy?.mode)} · false → true · 不补触发</dd></div>
        <div><dt>数据提供方</dt><dd>${providerLabels(alert.rule).map(esc).join("；")}</dd></div>
        <div><dt>规则哈希</dt><dd><code>${esc(alert.ruleHash)}</code></dd></div>
      </dl></section>
      <section><h2>监控空档</h2>${gaps.length ? gaps.map((gap) => `<div class="trading-alert-timeline-row"><strong>${esc(readableTime(gap.startedAt))} → ${esc(readableTime(gap.resumedAt))}</strong><span>${esc(gap.reason)} · 未补算</span></div>`).join("") : `<p class="trading-alert-muted">暂无监控空档</p>`}</section>
    </div>
    <section class="trading-alert-evidence"><h2>触发证据</h2>${evidence.length ? evidence.map((entry) => `<article class="${state.selectedEvidenceId === entry.evidenceId ? "selected" : ""}" ${state.selectedEvidenceId === entry.evidenceId ? "aria-current=\"true\"" : ""}><header><strong>${esc(readableTime(entry.triggeredAt))}</strong><code>${esc(entry.triggerEventId)}</code></header><div>${entry.contexts.map((context: any) => `<span>${esc(context.marketId)} · ${esc(context.interval)} · 收 ${esc(context.candle?.close)}</span>`).join("")}</div><ul>${entry.conditionResults.map((condition: any) => `<li>${esc(condition.conditionId)}：${esc(condition.result)}</li>`).join("")}</ul>${entry.contexts?.[0] ? `<button type="button" data-trading-alert-action="view-evidence-chart" data-market-id="${esc(entry.contexts[0].marketId)}" data-interval="${esc(entry.contexts[0].interval)}" data-triggered-at="${esc(entry.triggeredAt)}">查看触发 K 线</button>` : ""}</article>`).join("") : `<p class="trading-alert-muted">尚未真实触发</p>`}</section>
  </section>`;
}

function renderEditor(alert: any) {
  const anchor = alert.rule?.contexts?.find((context: any) => context.contextId === alert.rule?.evaluationPolicy?.anchorContextId) || alert.rule?.contexts?.[0];
  const drawingLocked = Boolean(anchor?.drawingBinding);
  const selectorKind = anchor?.marketSelector?.kind === "universe" ? "universe" : "fixed";
  const markets = (anchor?.marketSelector?.marketIds || anchor?.marketSelector?.frozenMarketIds || []).join(", ");
  const intervals = (anchor?.intervals || ["1h"]).join(", ");
  const estimatedBindings = Math.max(1, (anchor?.marketSelector?.marketIds || anchor?.marketSelector?.frozenMarketIds || []).length) * Math.max(1, anchor?.intervals?.length || 1);
  return `<div class="trading-alert-dialog-backdrop" data-trading-alert-action="close-editor"></div>
    <dialog class="trading-alert-editor" open aria-modal="true" aria-labelledby="tradingAlertEditorTitle">
      <header><div><h2 id="tradingAlertEditorTitle">编辑预警配置</h2><p>修改会生成新 Revision；重新模拟和确认前，旧规则继续监控。</p></div><button type="button" data-trading-alert-action="close-editor" aria-label="关闭">×</button></header>
      ${drawingLocked ? `<div class="trading-alert-editor-note">该规则绑定画线，交易对和周期跟随画线，不能泛化。</div>` : ""}
      <form data-trading-alert-editor-form data-alert-id="${esc(alert.alertId)}" data-context-id="${esc(anchor?.contextId || "primary")}">
        <label><span>市场范围</span><select name="selectorKind" ${drawingLocked ? "disabled" : ""}><option value="fixed" ${selectorKind === "fixed" ? "selected" : ""}>指定交易对（可多选）</option><option value="universe" ${selectorKind === "universe" ? "selected" : ""}>市场集合（确认时冻结）</option></select></label>
        <label><span>交易对（逗号分隔）</span><input name="marketIds" value="${esc(markets)}" placeholder="BINANCE:FUTURES:BTCUSDT, BINANCE:FUTURES:ETHUSDT" ${drawingLocked ? "disabled" : ""} /></label>
        <label><span>周期（逗号分隔）</span><input name="intervals" value="${esc(intervals)}" placeholder="15m, 1h, 4h" ${drawingLocked ? "disabled" : ""} /></label>
        <div class="trading-alert-resource-estimate" role="status">当前约 ${esc(estimatedBindings)} 个逻辑监控组合；相同交易对/周期会共享行情连接。</div>
        <label><span>确认方式</span><select name="clock"><option value="bar_close" ${alert.rule?.evaluationPolicy?.clock === "bar_close" ? "selected" : ""}>K线收盘确认</option><option value="mixed" ${alert.rule?.evaluationPolicy?.clock === "mixed" ? "selected" : ""}>按条件混合</option><option value="bar_update" ${alert.rule?.evaluationPolicy?.clock === "bar_update" ? "selected" : ""}>盘中实时</option></select></label>
        <label><span>重复方式</span><select name="mode"><option value="once" ${alert.rule?.triggerPolicy?.mode === "once" ? "selected" : ""}>一次性</option><option value="repeat" ${alert.rule?.triggerPolicy?.mode === "repeat" ? "selected" : ""}>重复监控</option></select></label>
        <footer><button type="button" data-trading-alert-action="close-editor">取消</button><button type="submit" class="primary">生成新 Revision</button></footer>
      </form>
    </dialog>`;
}

export function renderTradingAlertsPage(state: TradingAlertsUiState) {
  const selected = state.alerts.find((alert) => alert.alertId === state.selectedAlertId);
  const editor = state.alerts.find((alert) => alert.alertId === state.editorAlertId);
  if (selected) return `<main class="trading-alerts-page">${renderDetail(state, selected)}${editor ? renderEditor(editor) : ""}</main>`;
  const activeDrafts = state.drafts.filter((draft) => !["confirmed", "cancelled"].includes(draft.status));
  const alerts = state.filter === "draft" ? [] : sortAlertsForDisplay(state.alerts.filter((alert) => alertMatchesFilter(alert, state.filter)));
  const drafts = ["all", "draft"].includes(state.filter) ? activeDrafts : [];
  const counts = {
    all: state.alerts.length + activeDrafts.length,
    monitoring: state.alerts.filter((item) => alertMatchesFilter(item, "monitoring")).length,
    triggered: state.alerts.filter((item) => alertMatchesFilter(item, "triggered")).length,
    paused: state.alerts.filter((item) => alertMatchesFilter(item, "paused")).length,
    attention: state.alerts.filter((item) => alertMatchesFilter(item, "attention")).length,
    draft: activeDrafts.length,
  };
  const tabs: Array<[TradingAlertFilter, string]> = [["all", "全部"], ["monitoring", "监控中"], ["triggered", "已触发"], ["paused", "已暂停"], ["attention", "需处理"], ["draft", "草稿"]];
  return `<main class="trading-alerts-page">
    ${state.error ? `<div class="trading-alert-page-error" role="alert">${esc(state.error)}<button type="button" data-trading-alert-action="refresh">重试</button></div>` : ""}
    <nav class="trading-alert-filters" aria-label="筛选预警和草稿">${tabs.map(([id, label]) => `<button type="button" class="${state.filter === id ? "active" : ""}" data-trading-alert-filter="${id}" aria-pressed="${state.filter === id}">${label}<span>${counts[id]}</span></button>`).join("")}</nav>
    ${state.loading ? `<div class="trading-alert-loading" role="status"><span></span>正在读取预警…</div>` : alerts.length || drafts.length ? `<section class="trading-alert-card-grid">${alerts.map((alert) => renderAlertCard(state, alert)).join("")}${drafts.map(renderDraftCard).join("")}</section>` : `<section class="trading-alert-empty"><p>${state.filter === "draft" ? "还没有草稿" : state.filter === "all" ? "还没有智能预警" : "当前筛选下没有预警"}</p></section>`}
    ${editor ? renderEditor(editor) : ""}
  </main>`;
}
