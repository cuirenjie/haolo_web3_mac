// Shared by the host and renderer. Only fixed descriptions cross into reports
// or diagnostics; upstream messages can contain credentials or model output.
import { modelFailureFacts } from "../model-failure-policy.mjs";
import { isQuotaFailure } from "../error-signals.mjs";

const LABELS = {
  cancelled: ["本次分析已停止", "This analysis was stopped"],
  entitlement: ["暂时无法验证会员权益", "Membership verification is unavailable"],
  authentication: ["分析服务身份验证失败", "Analysis service authentication failed"],
  membership: ["当前套餐或积分不可用", "The current plan or credits are unavailable"],
  policy: ["分析结果未通过权限校验", "The analysis failed permission checks"],
  model_unavailable: ["当前服务通道不支持所选模型，请联系管理员配置可用通道", "The selected model is unavailable on this service. Contact an administrator to configure a supported route."],
  model_empty: ["分析模型返回了空结果", "The analysis model returned an empty result"],
  model_validation: ["模型结果未通过格式或规则校验", "The model result failed format or rule validation"],
  timeout: ["分析服务响应超时", "The analysis service timed out"],
  rate_limit: ["分析服务繁忙或触发限流", "The analysis service is busy or rate limited"],
  transport: ["分析服务连接中断", "The analysis service connection was interrupted"],
  data: ["当前行情数据不足或未通过校验", "Market data is insufficient or failed validation"],
  drawing: ["分析已完成，图表绘制未完成", "Analysis completed, but chart drawing did not complete"],
  analysis: ["分析流程未能完成", "The analysis could not complete"],
};

export function describeTradingAnalysisFailure(error, { stage = "analysis", language = "zh-CN" } = {}) {
  const facts = modelFailureFacts(error);
  const code = String(error?.code || error?.errorCode || "").toUpperCase();
  const message = facts.detail;
  const status = facts.httpStatus;
  let category = "analysis";
  if (/CANCEL|ABORT/.test(code) || error?.name === "AbortError" || /用户停止|已取消|cancelled|canceled|replaced/iu.test(message)) category = "cancelled";
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
    summary: LABELS[category][language === "en" ? 1 : 0],
    cancelled: category === "cancelled",
    allowLocalRecovery: !["cancelled", "authentication", "membership", "entitlement", "policy", "model_unavailable"].includes(category),
  });
}

// An explicitly selected strategy owns the report, drawings and execution
// plan for the whole request. Failure is not permission to run another engine.
export function buildTradingStrategyFailureReport(strategy, error, { language = "zh-CN" } = {}) {
  const english = language === "en";
  const name = String(strategy?.display?.name || strategy?.id || (english ? "Selected strategy" : "所选策略"))
    .replace(/[\r\n]/g, " ").slice(0, 120);
  const failure = describeTradingAnalysisFailure(error, { language });
  const candleCount = Number(error?.candleCount);
  const count = Number.isInteger(candleCount) && candleCount > 0 && candleCount <= 100_000 ? candleCount : null;
  if (strategy?.id === "wyckoff" && error?.code === "TRADING_WYCKOFF_INSUFFICIENT_DATA") {
    return english
      ? `${name}: ${count ? `After checking ${count} candles, no` : "No"} trading range met the Wyckoff rules. There is insufficient evidence to confirm accumulation/distribution or the associated events. No entry, stop-loss or take-profit plan was generated. Wait for further range tests, or select another timeframe and run Wyckoff again.`
      : `${name}：${count ? `已检查 ${count} 根 K 线，仍未识别到` : "当前未识别到"}符合威科夫规则的交易区间。上下沿测试与量价事件证据不足，暂不能确认吸筹、派发及其阶段。本次不生成入场、止损、止盈计划；可等待区间测试形成，或切换周期后重新进行威科夫分析。`;
  }
  return english
    ? `${name}: ${failure.summary}. This strategy analysis did not complete, so no new execution plan was generated. Retry the selected strategy when available.`
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
