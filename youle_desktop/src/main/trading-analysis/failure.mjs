// Shared by the host and renderer. Only fixed descriptions cross into reports
// or diagnostics; upstream messages can contain credentials or model output.
import { modelFailureFacts } from "../model-failure-policy.mjs";

const LABELS = {
  cancelled: ["本次分析已停止", "This analysis was stopped"],
  entitlement: ["暂时无法验证会员权益", "Membership verification is unavailable"],
  authentication: ["分析服务身份验证失败", "Analysis service authentication failed"],
  membership: ["当前套餐或积分不可用", "The current plan or credits are unavailable"],
  policy: ["分析结果未通过权限校验", "The analysis failed permission checks"],
  model_empty: ["分析模型返回了空结果", "The analysis model returned an empty result"],
  model_validation: ["模型结果未通过格式或规则校验", "The model result failed format or rule validation"],
  timeout: ["分析服务响应超时", "The analysis service timed out"],
  rate_limit: ["分析服务繁忙或触发限流", "The analysis service is busy or rate limited"],
  transport: ["分析服务连接中断", "The analysis service connection was interrupted"],
  data: ["当前行情数据不足或未通过校验", "Market data is insufficient or failed validation"],
  drawing: ["分析已完成，图表绘制未完成", "Analysis completed, but chart drawing did not complete"],
  secure_storage: ["系统安全存储暂不可用，请恢复访问后重试", "System secure storage is unavailable. Restore access and try again"],
  personal_memory: ["已保存的交易偏好暂时无法读取，原有数据未被修改", "Saved trading preferences could not be read. The original data has not been changed"],
  market_refresh: ["最新行情尚未刷新完成，请稍后重试；本次未使用旧 K 线分析", "The latest market snapshot is not ready. Try again shortly; stale candles were not used"],
  analysis: ["分析流程未能完成", "The analysis could not complete"],
};

export function describeTradingAnalysisFailure(error, { stage = "analysis", language = "zh-CN" } = {}) {
  const facts = modelFailureFacts(error);
  const code = String(error?.code || error?.errorCode || "").toUpperCase();
  const message = facts.detail;
  const status = facts.httpStatus;
  let category = "analysis";
  if (/CANCEL|ABORT/.test(code) || error?.name === "AbortError" || /用户停止|已取消|cancelled|canceled|replaced/iu.test(message)) category = "cancelled";
  else if (code === "TRADING_ANALYSIS_SNAPSHOT_STALE" || /当前行情快照刷新未完成/u.test(message)) category = "market_refresh";
  else if (code === "SECURE_STORAGE_UNAVAILABLE") category = "secure_storage";
  else if (["MEMORY_DECRYPT_FAILED", "MEMORY_STORE_INVALID"].includes(code)) category = "personal_memory";
  else if (code === "TRADING_ENTITLEMENT_UNAVAILABLE" || /无法验证会员权益/u.test(message)) category = "entitlement";
  else if (/TRIAL_REQUIRED|INSUFFICIENT_BALANCE/.test(code) || /未开通有效|没有可用积分|积分不足|余额不足/iu.test(message)) category = "membership";
  else if (/AUTH|ACCOUNT_ID_REQUIRED|INVALID_API_KEY/.test(code) || [401, 403].includes(status) || /unauthori[sz]ed|invalid api key|authentication failed|请先登录|未登录/iu.test(message)) category = "authentication";
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
    allowLocalRecovery: !["cancelled", "authentication", "membership", "entitlement", "policy", "secure_storage", "personal_memory", "market_refresh"].includes(category),
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
