// Shared by the host and renderer. Only fixed descriptions cross into reports
// or diagnostics; upstream messages can contain credentials or model output.
import { modelFailureFacts } from "../model-failure-policy.mjs";
import { isQuotaFailure } from "../error-signals.mjs";

const LABELS = {
  model_unknown: ["模型响应未能确认完成，本次分析已停止，原任务记录已保留", "The model response could not be confirmed as complete. Analysis stopped and the original task record was retained", "模型回應未能確認完成，本次分析已停止，原任務記錄已保留"],
  preferences_review: ["交易偏好尚未完成迁移，请到“设置 → 交易偏好”核对原设置", "Trading preferences need migration review. Open Settings → Trading preferences to review your saved settings", "交易偏好尚未完成遷移，請到「設定 → 交易偏好」核對原設定"],
  preferences_changed: ["交易偏好已在其他设备更新，请重新加载后再分析", "Trading preferences changed on another device. Reload them before running the analysis", "交易偏好已在其他裝置更新，請重新載入後再分析"],
  preferences_pending: ["交易偏好正在保存，请等待保存完成后再分析", "Trading preferences are being saved. Wait for the save to finish before running the analysis", "交易偏好正在儲存，請等待儲存完成後再分析"],
  cancellation_pending: ["云端取消尚未确认，任务记录已保留", "Cloud cancellation is not yet confirmed; the task record was retained"],
  pending: ["分析结果尚未确认，原任务记录已保留", "The analysis result has not been confirmed; the original task record has been retained", "分析結果尚未確認，原任務記錄已保留"],
  cloud_unavailable: ["云端策略服务暂不可用", "The cloud strategy service is unavailable"],
  cloud_unsupported: ["此策略或市场的云端版本尚未启用", "The cloud version of this strategy or market is not enabled yet"],
  cloud_history_contract: ["云端行情要求与当前客户端不兼容，请更新客户端或稍后重试", "Cloud history requirements are incompatible with this client. Update the client or try again later", "雲端行情要求與目前客戶端不相容，請更新客戶端或稍後重試"],
  cancelled: ["本次分析已停止", "This analysis was stopped"],
  entitlement: ["暂时无法验证会员权益", "Membership verification is unavailable"],
  authentication: ["分析服务身份验证失败", "Analysis service authentication failed"],
  membership: ["当前套餐或积分不可用", "The current plan or credits are unavailable"],
  policy: ["分析结果未通过权限校验", "The analysis failed permission checks"],
  model_unavailable: ["当前服务通道不支持所选模型，请联系管理员配置可用通道", "The selected model is unavailable on this service. Contact an administrator to configure a supported route."],
  model_empty: ["分析模型返回了空结果", "The analysis model returned an empty result"],
  model_validation: ["模型结果未通过格式或规则校验", "The model result failed format or rule validation"],
  timeout: ["分析服务响应超时", "The analysis service timed out", "分析服務回應逾時"],
  rate_limit: ["分析服务繁忙或触发限流", "The analysis service is busy or rate limited"],
  transport: ["分析服务连接中断", "The analysis service connection was interrupted"],
  data: ["当前行情数据不足或未通过校验", "Market data is insufficient or failed validation"],
  history: ["云端可用 K 线不足以完成此策略分析，请扩大分析时段或稍后重试", "There are not enough cloud candles for this strategy. Expand the analysis range or try again later", "雲端可用 K 線不足以完成此策略分析，請擴大分析時段或稍後重試"],
  order_flow_data: ["订单流成交或盘口数据暂不可用，请稍后重试", "Order flow trades or depth data are unavailable. Please try again later", "訂單流成交或訂單簿資料暫不可用，請稍後重試"],
  order_flow_market: ["订单流分析仅支持币安永续市场，请切换市场后重试", "Order flow analysis requires a Binance perpetual market. Switch markets and try again", "訂單流分析僅支援幣安永續市場，請切換市場後重試"],
  analysis_window: ["请求的分析时段超出云端可用行情，请缩短时段或调整周期", "The requested range exceeds available cloud history. Shorten the range or change the timeframe", "請求的分析時段超出雲端可用行情，請縮短時段或調整週期"],
  drawing: ["分析已完成，图表绘制未完成", "Analysis completed, but chart drawing did not complete"],
  secure_storage: ["系统安全存储暂不可用，请恢复访问后重试", "System secure storage is unavailable. Restore access and try again"],
  personal_memory: ["已保存的交易偏好暂时无法读取，原有数据未被修改", "Saved trading preferences could not be read. The original data has not been changed"],
  market_refresh: ["最新行情尚未刷新完成，请稍后重试；本次未使用旧 K 线分析", "The latest market snapshot is not ready. Try again shortly; stale candles were not used"],
  analysis: ["分析流程未能完成", "The analysis could not complete"],
};

export function describeTradingAnalysisFailure(error, { stage = "analysis", language = "zh-CN" } = {}) {
  const facts = modelFailureFacts(error);
  const code = String(error?.code || error?.errorCode || error?.payload?.detail?.code || error?.detail?.code || "").toUpperCase();
  const message = facts.detail;
  const status = facts.httpStatus;
  let category = "analysis";
  if (["PREFERENCE_IMPORT_RESOLUTION_REQUIRED", "PREFERENCE_IMPORT_REVIEW_REQUIRED", "PREFERENCE_IMPORT_CONFLICT"].includes(code)) category = "preferences_review";
  else if (code === "PREFERENCE_VERSION_CONFLICT") category = "preferences_changed";
  else if (["PREFERENCE_SAVE_PENDING", "TRADING_PREFERENCE_SAVE_PENDING"].includes(code)) category = "preferences_pending";
  else if (code === "CLOUD_CANCEL_PENDING") category = "cancellation_pending";
  else if (code === "CLOUD_RUN_PENDING") category = "pending";
  else if (code === "MODEL_OUTCOME_UNKNOWN") category = "model_unknown";
  else if (code === "MARKET_HISTORY_INSUFFICIENT") category = "history";
  else if (code === "ORDER_FLOW_DATA_UNAVAILABLE") category = "order_flow_data";
  else if (code === "ORDER_FLOW_MARKET_UNSUPPORTED") category = "order_flow_market";
  else if (code === "CLOUD_HISTORY_REQUIREMENTS_INVALID") category = "cloud_history_contract";
  else if (code === "ANALYSIS_WINDOW_INSUFFICIENT") category = "analysis_window";
  else if (code === "WINDOWS_WORKER_UNAVAILABLE") category = "cloud_unavailable";
  else if (["WINDOWS_STRATEGY_UNSUPPORTED", "CLOUD_MARKET_UNSUPPORTED"].includes(code)) category = "cloud_unsupported";
  else if (/CANCEL|ABORT/.test(code) || error?.name === "AbortError" || /用户停止|已取消|cancelled|canceled|replaced/iu.test(message)) category = "cancelled";
  else if (code === "TRADING_ANALYSIS_SNAPSHOT_STALE" || /当前行情快照刷新未完成/u.test(message)) category = "market_refresh";
  else if (code === "SECURE_STORAGE_UNAVAILABLE") category = "secure_storage";
  else if (["MEMORY_DECRYPT_FAILED", "MEMORY_STORE_INVALID"].includes(code)) category = "personal_memory";
  else if (code === "TRADING_ENTITLEMENT_UNAVAILABLE" || /无法验证会员权益/u.test(message)) category = "entitlement";
  else if (isQuotaFailure(error)) category = "membership";
  else if (/AUTH|ACCOUNT_ID_REQUIRED|INVALID_API_KEY/.test(code) || [401, 403].includes(status) || /unauthori[sz]ed|invalid api key|authentication failed|请先登录|未登录/iu.test(message)) category = "authentication";
  else if (facts.modelUnavailable) category = "model_unavailable";
  else if (/SIDE_EFFECT|PERMISSION|POLICY/.test(code)
    || /PERMISSION_DENIED|MODEL_ROUTE_GROUP_MISMATCH|THREAD_PROVIDER_MISMATCH|PROVIDER_SWITCH_RUNTIME_BUSY|provider switch was not applied|provider recovery is waiting|API key is not bound to its route group/i.test(message)) category = "policy";
  else if (stage === "drawing") category = "drawing";
  else if (/EMPTY_RESPONSE/.test(code)) category = "model_empty";
  else if (/MODEL_REVIEW_INVALID/.test(code) || /model response.*(?:JSON|schema|verdict|summary|invalid|required)/iu.test(message)) category = "model_validation";
  else if (/TIMEOUT|TIMEDOUT/.test(code) || /timed?\s*out|timeout|超时/iu.test(message)) category = "timeout";
  else if (status === 429 || /OVERLOADED|SLOW_DOWN/.test(code) || /rate limit|too many requests|concurrency limit|at capacity|overloaded|slow_down|上游过载/iu.test(message)) category = "rate_limit";
  else if (status >= 500 || /NETWORK|FETCH_FAILED|ECONN|EPIPE|STREAM_DISCONNECT|UND_ERR/.test(code) || /fetch failed|stream.*disconnect|connection.*(?:reset|closed)|service unavailable/iu.test(message)) category = "transport";
  else if (/INSUFFICIENT_DATA|SNAPSHOT|CANDLE/.test(code) || /candles?.*(?:invalid|required)|K 线.*(?:不足|至少需要|仅有)|行情加载失败/iu.test(message)) category = "data";
  return Object.freeze({
    category,
    summary: LABELS[category][language === "en" ? 1 : ["zh-Hant", "zh-TW"].includes(language) && LABELS[category][2] ? 2 : 0],
    cancelled: category === "cancelled",
    allowLocalRecovery: false,
  });
}

export function tradingAnalysisSnapshotUnavailable(reason) {
  const error = new Error("当前行情快照刷新未完成，已阻止使用旧 K 线分析");
  error.code = "TRADING_ANALYSIS_SNAPSHOT_STALE";
  error.retryable = true;
  // Fixed branch identifiers make the next diagnostic actionable without
  // recording network responses, user data or request URLs.
  const code = ["CANDLE_REFRESH_FAILED", "CANDLE_QUOTE_GAP", "CANDLE_SNAPSHOT_EXPIRED"].includes(reason)
    ? reason : "CANDLE_REFRESH_FAILED";
  error.cause = Object.assign(new Error(code), { code });
  return error;
}


// An explicitly selected strategy owns the report, drawings and execution
// plan for the whole request. Failure is not permission to run another engine.
export function buildTradingStrategyFailureReport(strategy, error, { language = "zh-CN" } = {}) {
  const english = language === "en";
  const name = String(strategy?.display?.name || strategy?.id || (english ? "Selected strategy" : "所选策略"))
    .replace(/[\r\n]/g, " ").slice(0, 120);
  const failure = describeTradingAnalysisFailure(error, { language });
  if (failure.category.startsWith("preferences_")) {
    return language === "en"
      ? `${name}: ${failure.summary}. Analysis has not started. Your original local settings are retained; no new execution plan was generated.`
      : ["zh-Hant", "zh-TW"].includes(language)
        ? `${name}：${failure.summary}。本次分析尚未開始，原本的本地設定仍保留，未產生新的執行計畫。`
        : `${name}：${failure.summary}。本次分析尚未开始，原来的本地设置仍保留，未生成新的执行计划。`;
  }
  const candleCount = Number(error?.candleCount);
  const count = Number.isInteger(candleCount) && candleCount > 0 && candleCount <= 100_000 ? candleCount : null;
  if (strategy?.id === "wyckoff" && error?.code === "TRADING_WYCKOFF_INSUFFICIENT_DATA") {
    return english
      ? `${name}: ${count ? `After checking ${count} candles, no` : "No"} trading range met the Wyckoff rules. There is insufficient evidence to confirm accumulation/distribution or the associated events. No entry, stop-loss or take-profit plan was generated. Wait for further range tests, or select another timeframe and run Wyckoff again.`
      : `${name}：${count ? `已检查 ${count} 根 K 线，仍未识别到` : "当前未识别到"}符合威科夫规则的交易区间。上下沿测试与量价事件证据不足，暂不能确认吸筹、派发及其阶段。本次不生成入场、止损、止盈计划；可等待区间测试形成，或切换周期后重新进行威科夫分析。`;
  }
  return english
    ? `${name}: ${failure.summary}. This strategy analysis did not complete, so no new execution plan was generated. Retry the selected strategy when available.`
    : ["zh-Hant", "zh-TW"].includes(language)
      ? `${name}：${failure.summary}。本次策略分析未完成，未產生新的執行計畫；恢復後可重新執行該策略。`
      : `${name}：${failure.summary}。本次策略分析未完成，未生成新的执行计划；恢复后可重新运行该策略。`;
}

export async function settleTradingAnalysisDrawing({ commit, isActive, onFailure }) {
  try {
    await commit();
    return { drawingDeferred: false };
  } catch (error) {
    // A cancelled job must never be turned back into a successful result.
    if (!isActive() || describeTradingAnalysisFailure(error).cancelled) throw error;
    try { await onFailure?.(error); } catch { /* Diagnostics are best effort. */ }
    // Keep the validated model result. Replacing it with a local price report
    // here would misreport a renderer/storage failure as a model failure.
    return { drawingDeferred: true };
  }
}
