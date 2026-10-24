// A-share business is retired. Keep identifiers and persisted history readable.
export const IFIND_BUSINESS_ENABLED = false;

export function tradingMarketUnavailableMessage(language = 'zh-CN') {
  if (/^ko(?:-|_|$)/i.test(language)) return '중국 A주 관련 서비스가 종료되었습니다.';
  if (/^en(?:-|_|$)/i.test(language)) return 'A-share services have been discontinued.';
  if (/^(zh[-_](TW|HK|Hant)|zhHant)/i.test(language)) return 'A 股相關服務已停用。';
  return 'A 股相关服务已停用。';
}

export function tradingMarketAvailable(market) {
  if (!market) return false;
  return IFIND_BUSINESS_ENABLED || !(
    String(market.provider || '').toLowerCase() === 'ifind'
    || String(market.assetClass || '').toLowerCase() === 'a-share'
    || /^ifind:/i.test(String(market.id || ''))
  );
}
