const messages = {
  SECURE_STORAGE_UNAVAILABLE: ['系统安全存储暂不可用，请恢复钥匙串访问后重试；本机记录未被修改。','System secure storage is unavailable. Restore keychain access and retry; local records have not been changed.','系統安全儲存暫不可用，請恢復鑰匙圈存取後重試；本機記錄未被修改。'],
  CLOUD_RUN_JOURNAL_INVALID: ['本机云端任务记录暂时无法读取，原文件已保留。请检查安全存储访问后重启应用。','Local cloud-task records could not be read. The original file is retained. Check secure-storage access and restart the app.','本機雲端任務記錄暫時無法讀取，原檔案已保留。請檢查安全儲存存取後重新啟動應用程式。'],
  PREFERENCE_IMPORT_RESOLUTION_REQUIRED: ['请先到“设置 → 交易偏好”核对迁移内容，再重新分析；原有记录仍保留。','Review the migration in Settings → Trading preferences before analyzing again. Original records are retained.','請先到「設定 → 交易偏好」核對遷移內容，再重新分析；原有記錄仍保留。'],
  LEFT_DUAL_NOT_ENABLED: ['两套裸K左侧方案尚未启用，当前不能激活新计划。','The two Price Action left-side setups are not enabled; new plans cannot be activated.','兩套裸K左側方案尚未啟用，目前不能啟用新計畫。'],
  LEFT_DUPLICATE_MARKET_PLAN: ['该交易对已有待执行或执行中的左侧计划，请先处理现有计划。','This market already has a pending or active left-side plan. Resolve it first.','該交易對已有待執行或執行中的左側計畫，請先處理現有計畫。'],
  LEFT_ZONE_ATTEMPT_LIMIT: ['该区域已达到左侧尝试次数限制，请等待新的有效结构。','This zone has reached its left-side attempt limit. Wait for a new valid structure.','該區域已達到左側嘗試次數限制，請等待新的有效結構。'],
  LEFT_OPEN_RISK_BUDGET: ['现有左侧计划已达到同时承担风险的上限。','Existing left-side plans have reached the concurrent risk limit.','現有左側計畫已達到同時承擔風險的上限。'],
  LEFT_DAILY_RISK_BUDGET: ['今天的左侧计划风险预算已用完，取消计划不会恢复预算。','Today’s left-side risk budget is exhausted. Cancelling a plan does not restore it.','今天的左側計畫風險預算已用完，取消計畫不會恢復預算。'],
  LEFT_PLAN_ALREADY_USED: ['此左侧计划已使用，请重新分析，不要重复激活。','This left-side plan has already been used. Reanalyse instead of reactivating it.','此左側計畫已使用，請重新分析，不要重複啟用。'],
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
  CLOUD_RUN_PENDING: ['分析结果尚未确认，原任务记录已保留。','The analysis result has not been confirmed. The original task record has been retained.','分析結果尚未確認，原任務記錄已保留。'],
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
