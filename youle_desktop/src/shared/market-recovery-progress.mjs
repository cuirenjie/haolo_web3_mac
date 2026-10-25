import { japaneseText } from './japanese.mjs';
import { koreanText } from './korean.mjs';
const messages = {
  market_waiting: ['正在等待行情额度恢复，原分析任务已保留，将自动继续。', 'Waiting for market data capacity. Your analysis task is saved and will continue automatically.', '正在等待行情額度恢復，原分析任務已保留，將自動繼續。'],
  market_resuming: ['正在重新获取行情，准备继续分析。', 'Refreshing market data to continue the analysis.', '正在重新取得行情，準備繼續分析。'],
  market_quota_wait: ['正在等待行情额度恢复，恢复后将自动开始分析。', 'Waiting for market data capacity. Analysis will start automatically when it is available.', '正在等待行情額度恢復，恢復後將自動開始分析。'],
  market_connection_wait: ['正在等待行情连接恢复，恢复后将自动开始分析。', 'Waiting for the market data connection to recover. Analysis will start automatically.', '正在等待行情連線恢復，恢復後將自動開始分析。'],
  market_ready: ['行情已就绪，正在开始分析。', 'Market data is ready. Starting analysis.', '行情已就緒，正在開始分析。'],
};

export function marketRecoveryProgressMessage(stage,language='zh-CN') {
  return language === 'ja' ? japaneseText(messages[stage]?.[0] || '') : language === 'ko' ? koreanText(messages[stage]?.[0] || '') : messages[stage]?.[language === 'en' || language === 'en-US' ? 1 : ['zh-Hant','zh-TW','zh-HK'].includes(language) ? 2 : 0] || '';
}
