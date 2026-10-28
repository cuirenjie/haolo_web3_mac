import { vietnameseText } from './vietnamese.mjs';
import { japaneseText } from './japanese.mjs';
import { koreanText } from './korean.mjs';
const messages = {
  service_waiting: ['分析服务暂时繁忙，正在等待继续，可随时停止。', 'The analysis service is busy. Waiting to continue; you can stop at any time.', '分析服務暫時繁忙，正在等待繼續，可隨時停止。', '분석 서비스가 혼잡하여 계속 진행하기를 기다리고 있습니다. 언제든지 중지할 수 있습니다.', '分析サービスが混雑しているため、続行を待っています。いつでも停止できます。'],
  service_ready: ['分析服务已就绪，正在继续准备。', 'The analysis service is ready. Continuing preparation.', '分析服務已就緒，正在繼續準備。', '분석 서비스가 준비되어 분석 준비를 계속합니다.', '分析サービスが利用可能になりました。準備を続行しています。'],
  market_waiting: ['正在等待行情额度恢复，原分析任务已保留，将自动继续。', 'Waiting for market data capacity. Your analysis task is saved and will continue automatically.', '正在等待行情額度恢復，原分析任務已保留，將自動繼續。'],
  market_resuming: ['正在重新获取行情，准备继续分析。', 'Refreshing market data to continue the analysis.', '正在重新取得行情，準備繼續分析。'],
  market_quota_wait: ['正在等待行情额度恢复，恢复后将自动开始分析。', 'Waiting for market data capacity. Analysis will start automatically when it is available.', '正在等待行情額度恢復，恢復後將自動開始分析。'],
  market_connection_wait: ['正在等待行情连接恢复，恢复后将自动开始分析。', 'Waiting for the market data connection to recover. Analysis will start automatically.', '正在等待行情連線恢復，恢復後將自動開始分析。'],
  market_ready: ['行情已就绪，正在开始分析。', 'Market data is ready. Starting analysis.', '行情已就緒，正在開始分析。'],
};

export function marketRecoveryProgressMessage(stage,language='zh-CN') {
  return language === 'vi' ? vietnameseText(messages[stage]?.[0] || '') : language === 'ja' ? messages[stage]?.[4] || japaneseText(messages[stage]?.[0] || '') : language === 'ko' ? messages[stage]?.[3] || koreanText(messages[stage]?.[0] || '') : messages[stage]?.[language === 'en' || language === 'en-US' ? 1 : ['zh-Hant','zh-TW','zh-HK'].includes(language) ? 2 : 0] || '';
}
