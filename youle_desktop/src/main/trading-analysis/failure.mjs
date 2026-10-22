// Shared by the host and renderer. Only fixed descriptions cross into reports
// or diagnostics; upstream messages can contain credentials or model output.
import { modelFailureFacts } from "../model-failure-policy.mjs";
import { isMembershipFailure, isQuotaFailure } from "../error-signals.mjs";

const LABELS = {
  chart_context: ["原会话图表暂不可用", "The originating conversation chart is unavailable", "原會話圖表暫不可用"],
  chart_open: ["图表或行情未能加载完成", "The chart or its market data could not finish loading", "圖表或行情未能載入完成"],
  account_context: ["账户信息刷新失败", "Account information could not be refreshed", "帳戶資訊重新整理失敗"],
  cloud_result: ["云端结果未通过一致性校验，未应用该结果", "The cloud result failed consistency checks and was not applied", "雲端結果未通過一致性檢查，未套用該結果"],
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
  membership: ["此功能需要有效会员，请检查会员状态", "This feature requires an active membership. Check your membership status", "此功能需要有效會員，請檢查會員狀態"],
  model_membership: ["当前会员等级不支持所选模型，请更换模型或升级会员", "Your membership tier does not support this model. Select another model or upgrade", "目前會員等級不支援所選模型，請更換模型或升級會員"],
  credits: ["当前可用积分不足，请获取积分后重试", "Your available credits are insufficient. Add credits and try again", "目前可用點數不足，請取得點數後重試"],
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
  analysis: ["分析流程未能完成", "The analysis could not complete"],
};

export function describeTradingAnalysisFailure(error, { stage = "analysis", language = "zh-CN" } = {}) {
  if (language === "en-US") language = "en";
  const facts = modelFailureFacts(error);
  const code = String(error?.code || error?.errorCode || error?.payload?.detail?.code || error?.detail?.code || "").toUpperCase();
  const message = facts.detail;
  const status = facts.httpStatus;
  let category = "analysis";
  if (code === "CHART_CONTEXT_UNAVAILABLE") category = "chart_context";
  else if (code === "ACCOUNT_CONTEXT_UNAVAILABLE") category = "account_context";
  else if (["CHART_OPEN_FAILED", "CHART_DATA_UNAVAILABLE"].includes(code)) category = "chart_open";
  else if (code === "CLOUD_RESULT_CONTEXT_INVALID") category = "cloud_result";
  else if (["PREFERENCE_IMPORT_RESOLUTION_REQUIRED", "PREFERENCE_IMPORT_REVIEW_REQUIRED", "PREFERENCE_IMPORT_CONFLICT"].includes(code)) category = "preferences_review";
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
  else if (code === "TRADING_ENTITLEMENT_UNAVAILABLE" || /无法验证会员权益/u.test(message)) category = "entitlement";
  else if (/MODEL_MEMBERSHIP_REQUIRED/.test(message)) category = "model_membership";
  else if (isMembershipFailure(error)) category = "membership";
  else if (isQuotaFailure(error)) category = "credits";
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

export function tradingAnalysisStoppedMessage(error, {language = 'zh-CN', strategyName = '', completedStrategyNames = []} = {}) {
  const failure = describeTradingAnalysisFailure(error, {language});
  const reason = failure.summary;
  const completed = completedStrategyNames.filter(Boolean).join('、');
  if (failure.category === 'pending') {
    const retained = !completed ? '' : language === 'en' || language === 'en-US'
      ? ` Completed results (${completed}) are retained.`
      : ['zh-Hant', 'zh-TW'].includes(language) ? `已完成的${completed}結果仍保留。` : `已完成的${completed}结果仍保留。`;
    return pendingResultMessage(reason, strategyName, language) + retained;
  }
  if (language === 'en' || language === 'en-US') return `${strategyName ? `${strategyName} analysis did not complete; no conclusion was generated. ` : ''}${reason}. This analysis has stopped and will not retry automatically.${completed ? ` Completed results (${completed}) are retained.` : ''}`;
  if (['zh-Hant', 'zh-TW'].includes(language)) return `${strategyName ? `${strategyName}分析未完成，未產生該策略的結論。` : ''}${reason}。本輪分析已停止，不會自動重試。${completed ? `已完成的${completed}結果仍保留。` : ''}`;
  return `${strategyName ? `${strategyName}分析未完成，未生成该策略的结论。` : ''}${reason}。本轮分析已停止，不会自动重试。${completed ? `已完成的${completed}结果仍保留。` : ''}`;
}

function pendingResultMessage(reason, name, language) {
  if (language === 'en' || language === 'en-US') return `${name ? `${name}: ` : ''}${reason}. The query wait has ended. Avoid submitting another analysis until the original result is confirmed.`;
  if (['zh-Hant', 'zh-TW'].includes(language)) return `${name ? `${name}：` : ''}${reason}。本次查詢等待已結束，確認結果前請勿重複發起分析。`;
  return `${name ? `${name}：` : ''}${reason}。本次查询等待已结束，确认结果前请勿重复发起分析。`;
}

// An explicitly selected strategy owns the report, drawings and execution
// plan for the whole request. Failure is not permission to run another engine.
export function buildTradingStrategyFailureReport(strategy, error, { language = "zh-CN" } = {}) {
  if (language === "en-US") language = "en";
  const english = language === "en";
  const name = String(strategy?.display?.name || strategy?.id || (english ? "Selected strategy" : "所选策略"))
    .replace(/[\r\n]/g, " ").slice(0, 120);
  const failure = describeTradingAnalysisFailure(error, { language });
  if (failure.category === 'pending') return pendingResultMessage(failure.summary, name, language);
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
