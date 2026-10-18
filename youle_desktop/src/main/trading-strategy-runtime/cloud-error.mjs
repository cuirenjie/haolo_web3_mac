const messages = {
  ORDER_FLOW_DATA_UNAVAILABLE: ['订单流成交或盘口数据暂不可用，请稍后重试。','Order flow trades or depth data are unavailable. Please try again later.','訂單流成交或訂單簿資料暫不可用，請稍後重試。'],
  ORDER_FLOW_MARKET_UNSUPPORTED: ['订单流分析仅支持币安永续市场，请切换市场后重试。','Order flow analysis requires a Binance perpetual market. Switch markets and try again.','訂單流分析僅支援幣安永續市場，請切換市場後重試。'],
  CLOUD_HISTORY_REQUIREMENTS_INVALID: ['云端行情要求与当前客户端不兼容，请更新客户端或稍后重试。','Cloud history requirements are incompatible with this client. Update the client or try again later.','雲端行情要求與目前客戶端不相容，請更新客戶端或稍後重試。'],
  MARKET_HISTORY_INSUFFICIENT: ['云端可用 K 线不足以完成此策略分析，请扩大分析时段或稍后重试。','There are not enough cloud candles for this strategy. Expand the analysis range or try again later.','雲端可用 K 線不足以完成此策略分析，請擴大分析時段或稍後重試。'],
  ANALYSIS_QUEUE_FULL: ['云端分析队列已满，请稍后重试。','The cloud analysis queue is full. Please try again later.','雲端分析佇列已滿，請稍後重試。'],
  MODEL_OUTCOME_UNKNOWN: ['模型请求结果尚未确认，系统已停止自动重试以避免重复费用。原任务记录已保留。','The model request outcome is unknown. Automatic retries stopped to avoid duplicate charges. The original task record is retained.','模型請求結果尚未確認，系統已停止自動重試以避免重複費用。原任務記錄已保留。'],
  MODEL_SELECTION_INVALID: ['云端策略暂不支持所选模型，请选择其他模型。','Cloud strategies do not support the selected model. Select another model.','雲端策略暫不支援所選模型，請選擇其他模型。'],
  PLAN_VERSION_CONFLICT: ['计划已发生变化，请刷新后重试。','The plan has changed. Refresh it before retrying.','計畫已發生變化，請重新整理後重試。'],
  PLAN_EXPIRED: ['此计划已过期，请重新分析。','This plan has expired. Run a new analysis.','此計畫已過期，請重新分析。'],
  ENTRY_WORKER_UNAVAILABLE: ['云端入场条件服务尚未就绪，请稍后重试。','The cloud entry-condition service is not ready. Please try again later.','雲端入場條件服務尚未就緒，請稍後重試。'],
  ENTRY_POLICY_UNAVAILABLE: ['此策略的入场方式尚未通过云端验收，暂不能发起新分析。','Entry modes for this strategy have not passed cloud acceptance; new analysis is unavailable.','此策略的入場方式尚未通過雲端驗收，暫不能發起新分析。'],
  ANALYSIS_WINDOW_INSUFFICIENT: ['请求的分析时段超出云端可用行情，请缩短时段或调整周期。','The requested range exceeds available cloud history. Shorten the range or change the timeframe.','請求的分析時段超出雲端可用行情，請縮短時段或調整週期。'],
  CLOUD_CANCEL_PENDING: ['已停止接收结果，但尚未确认云端取消。恢复连接后可继续核对。','Result delivery stopped, but cloud cancellation is not yet confirmed. Reconnect to check its status.','已停止接收結果，但尚未確認雲端取消。恢復連線後可繼續核對。'],
  CLOUD_RUN_PENDING: ['云端任务尚未在本机确认，可在执行计划的“云端任务”中继续查看。','The cloud task has not been confirmed on this device. Open Cloud tasks in Plans to check its result.','雲端任務尚未在本機確認，可在執行計畫的「雲端任務」中繼續查看。'],
  WINDOWS_WORKER_UNAVAILABLE: ['云端策略服务暂不可用，请稍后重试。','The cloud strategy service is unavailable. Please try again later.','雲端策略服務暫不可用，請稍後重試。'],
  WINDOWS_STRATEGY_UNSUPPORTED: ['此策略的云端版本尚未启用。','The cloud version of this strategy is not enabled yet.','此策略的雲端版本尚未啟用。'],
  CLOUD_MARKET_UNSUPPORTED: ['云端策略暂不支持此市场或周期。','Cloud strategies do not yet support this market or timeframe.','雲端策略暫不支援此市場或週期。'],
  PREFERENCE_VERSION_CONFLICT: ['交易偏好已在另一处更新，请重新发起分析。','Trading preferences changed elsewhere. Start a new analysis.','交易偏好已在另一處更新，請重新發起分析。'],
  TRADING_PREFERENCE_OWNER_CHANGED: ['登录账号已变化，请在当前账号重新查看任务。','The signed-in account changed. Reopen the task under the current account.','登入帳號已變化，請在目前帳號重新查看任務。'],
  TRADING_ANALYSIS_CANCELLED: ['策略分析已取消。','Strategy analysis was cancelled.','策略分析已取消。'],
  CLOUD_RESULT_CONTEXT_INVALID: ['云端结果与当前任务不一致，未应用结果。','The cloud result does not match this task and was not applied.','雲端結果與目前任務不一致，未套用結果。'],
  MODEL_MEMBERSHIP_REQUIRED: ['当前套餐不支持所选模型，请更换模型。','The current plan does not support this model. Select another model.','目前方案不支援所選模型，請更換模型。'],
  ANALYSIS_CREDITS_REQUIRED: ['当前套餐或积分不可用，请检查账户。','The current plan or credits are unavailable. Check your account.','目前方案或點數不可用，請檢查帳戶。'],
  RUN_LIMIT: ['当前已有分析任务在运行，请等待完成后重试。','Analysis tasks are already running. Wait for them to complete before retrying.','目前已有分析任務在執行，請等待完成後重試。'],
  CLOUD_ANALYSIS_FAILED: ['云端分析未完成，原任务记录已保留。','Cloud analysis did not complete. The original task record has been retained.','雲端分析未完成，原任務記錄已保留。'],
};

export function cloudStrategyFailure(error, {language='zh-CN',aborted=false}={}) {
  const detail=error?.payload?.detail || error?.detail || {};
  let code=String(detail.code || error?.code || 'CLOUD_ANALYSIS_FAILED');
  if (aborted && !['CLOUD_CANCEL_PENDING','CLOUD_RUN_PENDING'].includes(code)) code='TRADING_ANALYSIS_CANCELLED';
  const index=language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0;
  return {code,message:(messages[code] || messages.CLOUD_ANALYSIS_FAILED)[index],
    retryable:error?.retryable===true,status:error?.status,runId:error?.runId,
    category:code==='CLOUD_CANCEL_PENDING'?'cancellation_pending':code==='CLOUD_RUN_PENDING'?'pending':undefined};
}
