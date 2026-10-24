import {isDeepStrictEqual as equal} from 'node:util';
import {parsePriceAlertInput, buildPriceAlertRule} from './price-alert.mjs';

const prefix = 'cloud-price-';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail = code => { throw Object.assign(new Error(code), {code}); };
export const isCloudPriceAlert = id => typeof id === 'string' && id.startsWith(prefix);

export function cloudPriceAlertCard(item) {
  const r = item?.rule;
  if (!uuid.test(item?.id) || item.managedByPlan || r?.kind || !['gte','lte','gt','lt','cross_over','cross_under'].includes(r?.operator)
    || !Number.isFinite(r.threshold) || r.threshold <= 0 || !/^binance:(usdm|spot):/.test(r.marketKey)) return null;
  const marketId = r.marketKey.replace('binance:usdm:', 'BINANCE:FUTURES:').replace('binance:spot:', 'BINANCE:SPOT:');
  const upward = ['gt','gte','cross_over'].includes(r.operator);
  const rule = buildPriceAlertRule({requestId: item.id, marketId, interval: r.interval, price: r.threshold,
    referencePrice: upward ? r.threshold : r.threshold * 2, locale: item.locale}, Date.parse(item.createdAt) || Date.now());
  const price = r.threshold.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:12});
  const operator = {gte:'≥',lte:'≤',gt:'>',lt:'<',cross_over:'>',cross_under:'<'}[r.operator];
  const lang = item.locale === 'en' ? 1 : item.locale === 'zh-Hant' ? 2 : 0;
  return {alertId: prefix + item.id, cloud: {id:item.id,version:item.version,operator:r.operator,threshold:r.threshold}, enabled:item.enabled === true,
    status:item.state, rule: {...rule, revision:item.version, title:item.title,
      contexts:rule.contexts.map(context => ({...context,intervals:[r.interval]})),
      normalizedSummary:item.locale === 'ko' ? `가격이 ${operator} ${price} 조건을 충족하면 이메일을 한 번 보냅니다.` : [`价格 ${operator} ${price} 时发送一次邮件通知`, `Email once when price ${operator} ${price}`, `價格 ${operator} ${price} 時傳送一次郵件通知`][lang],
      evaluationPolicy:{...rule.evaluationPolicy,clock:r.confirmation === 'bar_close' ? 'bar_close' : 'bar_update'}},
    createdAt:item.createdAt, lastEvaluatedAt:item.lastCheckedAt, failure:item.error?.code || item.error || null};
}

// This adapter only saves and reads cloud rules. Market monitoring and mail
// delivery belong to the server Worker, never to the desktop alert engine.
export function createCloudPriceAlerts({owner, api}) {
  const pending = new Map();
  async function request(captured, operation, body = {}, key) {
    const assertOwner = async () => {
      const current = await owner();
      if (current.ownerId !== captured.ownerId || current.baseUrl !== captured.baseUrl) fail('TRADING_PREFERENCE_OWNER_CHANGED');
    };
    await assertOwner();
    const value = await api().tradingCloudRequest(operation, body, {
      expectedAccountId:captured.accountId, expectedBaseUrl:captured.baseUrl, ...(key ? {idempotencyKey:key} : {}),
    });
    await assertOwner();
    return value;
  }
  async function list(captured) {
    const response = await request(captured, 'priceAlerts');
    if (!Array.isArray(response?.items)) fail('CLOUD_RESULT_CONTEXT_INVALID');
    return response.items;
  }
  return {
    async snapshot() {
      const captured = await owner();
      return {alerts:(await list(captured)).filter(a => a.confirmedVersion != null && !['draft','deleted'].includes(a.state))
        .map(cloudPriceAlertCard).filter(Boolean)};
    },
    async create(params) {
      const spec = parsePriceAlertInput(params), captured = await owner();
      if (!captured.email) fail('PRICE_ALERT_EMAIL_REQUIRED');
      const lock = `${captured.ownerId}:${spec.requestId}`;
      if (pending.has(lock)) {
        const existing = pending.get(lock);
        if (!equal(existing.spec, spec)) fail('CLOUD_RESULT_CONTEXT_INVALID');
        return existing.promise;
      }
      const promise = (async () => {
        const caps = await request(captured, 'capabilities');
        if (caps.priceAlerts !== 'inclusive-intrabar-v1') fail('PRICE_ALERT_CLOUD_UNAVAILABLE');
        const rule = {marketKey:spec.marketId.replace('BINANCE:FUTURES:','binance:usdm:').replace('BINANCE:SPOT:','binance:spot:'),
          interval:spec.interval, operator:spec.price >= spec.referencePrice ? 'gte' : 'lte', threshold:spec.price, confirmation:'intrabar'};
        const symbol = spec.marketId.split(':')[2].replace(/(USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB|EUR|USD)$/, '/$1');
        const body = {rule, title:`${symbol} · ${spec.price.toLocaleString('en-US', {maximumFractionDigits:12})}`, locale:spec.locale};
        const draft = await request(captured, 'createPriceAlertDraft', body, `price-create:${spec.requestId}`);
        if (!uuid.test(draft?.id) || !equal(draft.rule,rule) || !Number.isSafeInteger(draft.version) || !/^[a-f0-9]{64}$/.test(draft.ruleHash)) fail('CLOUD_RESULT_CONTEXT_INVALID');
        const confirmed = await request(captured, 'confirmPriceAlert', {alertId:draft.id, version:draft.version, ruleHash:draft.ruleHash}, `price-confirm:${spec.requestId}`);
        if (confirmed?.id !== draft.id || confirmed.ruleHash !== draft.ruleHash || confirmed.confirmedVersion == null) fail('CLOUD_RESULT_CONTEXT_INVALID');
        const saved = (await list(captured)).find(a => a.id === draft.id);
        if (!saved || saved.ruleHash !== draft.ruleHash || saved.confirmedVersion == null || ['draft','deleted'].includes(saved.state)) fail('PRICE_ALERT_READBACK_FAILED');
        return {alert:cloudPriceAlertCard(saved), monitoringReady:['arming','monitoring','completed'].includes(saved.state)};
      })();
      pending.set(lock, {spec,promise});
      try { return await promise; } finally { pending.delete(lock); }
    },
    async mutate(action, {alertId,version}) {
      if (!['pause','resume','delete'].includes(action) || !isCloudPriceAlert(alertId) || !uuid.test(alertId.slice(prefix.length))
        || !Number.isSafeInteger(version) || version < 1) fail('CLOUD_RESULT_CONTEXT_INVALID');
      const captured = await owner(), id = alertId.slice(prefix.length);
      const current = (await list(captured)).find(a => a.id === id);
      if (!current && action === 'delete') return {deleted:true};
      if (!current || !cloudPriceAlertCard(current)) fail('RESOURCE_NOT_FOUND');
      const desired = action === 'pause' ? 'paused' : action === 'resume' ? 'arming' : 'deleted';
      if (current.state === desired || action === 'resume' && current.state === 'monitoring') return {alert:cloudPriceAlertCard(current)};
      if (current.version !== version) fail('VERSION_CONFLICT');
      const result = await request(captured, 'priceAlertAction', {alertId:id,action,version}, `price-${action}:${id}:${version}`);
      if (result?.id !== id || result.state !== desired) fail('CLOUD_RESULT_CONTEXT_INVALID');
      return {alert:cloudPriceAlertCard(result)};
    },
  };
}
