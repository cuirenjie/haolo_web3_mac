import { normalizeAlertRule } from './protocol.mjs';
import { TradingAlertError } from './errors.mjs';

const invalid = message => { throw new TradingAlertError(message, { code: 'TRADING_PRICE_ALERT_INVALID', category: 'validation' }); };

export function parsePriceAlertInput(value = {}) {
  if (value.confirmed !== true) invalid('请先确认创建价格预警');
  const requestId = String(value.requestId || '');
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) invalid('价格预警请求标识无效');
  const marketId = String(value.marketId || '').toUpperCase();
  if (!/^BINANCE:(?:FUTURES|SPOT):[A-Z0-9_\p{Script=Han}]{2,40}$/u.test(marketId)) invalid('当前市场暂不支持云端价格预警');
  const interval = String(value.interval || '');
  if (!['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M', '1y'].includes(interval)) invalid('价格预警周期无效');
  const { price, referencePrice } = value;
  if (![price, referencePrice].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)) invalid('价格必须是大于零的有效数值');
  const locale = ['en', 'zh-Hant', 'ko'].includes(value.locale) ? value.locale : 'zh-CN';
  return { requestId, marketId, interval, price, referencePrice, locale };
}

export function buildPriceAlertRule(spec, now = Date.now()) {
  const upward = spec.price >= spec.referencePrice;
  const price = spec.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 12 });
  const [venue, type, symbol] = spec.marketId.split(':');
  const pair = venue === 'BINANCE' ? symbol.replace(/(USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB|EUR|USD)$/, '/$1') : symbol;
  const summary = spec.locale === 'ko' ? `가격이 ${price} ${upward ? '이상으로 상승' : '이하로 하락'}하면 이메일을 한 번 보냅니다.`
    : spec.locale === 'en' ? `Email once when price is ${upward ? 'at or above' : 'at or below'} ${price}`
    : spec.locale === 'zh-Hant' ? `價格${upward ? '上漲至或高於' : '下跌至或低於'} ${price} 時傳送一次郵件通知`
    : `价格${upward ? '上涨至或高于' : '下跌至或低于'} ${price} 时发送一次邮件通知`;
  const marketType = spec.locale === 'ko' ? (type === 'SPOT' ? '현물' : '무기한 선물')
    : spec.locale === 'en' ? (type === 'SPOT' ? 'Spot' : 'Perpetual')
    : spec.locale === 'zh-Hant' ? (type === 'SPOT' ? '現貨' : '永續') : (type === 'SPOT' ? '现货' : '永续');
  return normalizeAlertRule({
    schemaVersion: 1, ruleId: `price-alert-${spec.requestId}`, revision: 1,
    title: `${pair} ${marketType} · ${price}`,
    root: { type: 'condition', condition: {
      conditionId: 'target-price', contextId: 'price-market', operator: upward ? 'gte' : 'lte',
      left: { type: 'field', field: 'close' }, right: { type: 'constant', value: spec.price }, confirmation: 'intrabar',
    } },
    contexts: [{ contextId: 'price-market', marketSelector: { kind: 'fixed', marketIds: [spec.marketId] }, intervals: [spec.interval] }],
    evaluationPolicy: { clock: 'bar_update', anchorContextId: 'price-market', joinMode: 'latest_closed', maxDataAgeMs: 30_000, unknownPolicy: 'do_not_trigger' },
    triggerPolicy: { mode: 'once', edge: 'false_to_true', rearm: 'must_become_false', maxTriggersTotal: 1, resumePolicy: 'baseline_only_no_catch_up' },
    dataRequirements: [], sourceText: `${spec.marketId} ${spec.interval} ${summary}`, normalizedSummary: summary, createdAt: now,
  });
}
