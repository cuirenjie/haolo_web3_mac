import {isDeepStrictEqual as equal} from 'node:util';
import {createHash} from 'node:crypto';
import {parsePriceAlertInput, buildPriceAlertRule} from './price-alert.mjs';
import {priceAlertSummary} from '../../shared/price-alert-copy.mjs';

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
  return {alertId: prefix + item.id, cloud: {id:item.id,version:item.version,operator:r.operator,threshold:r.threshold}, enabled:item.enabled === true,
    status:item.state, rule: {...rule, revision:item.version, title:item.title,
      contexts:rule.contexts.map(context => ({...context,intervals:[r.interval]})),
      normalizedSummary:priceAlertSummary(r.operator,r.threshold,item.locale),
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
  async function mutate(captured, action, {alertId,version}, knownItems) {
    if (!['pause','resume','delete'].includes(action) || !isCloudPriceAlert(alertId) || !uuid.test(alertId.slice(prefix.length))
      || !Number.isSafeInteger(version) || version < 1) fail('CLOUD_RESULT_CONTEXT_INVALID');
    const id = alertId.slice(prefix.length);
    // Replacement already read the original. The server still enforces its version
    // atomically, so reading the whole list again cannot add a stronger guarantee.
    const current = (knownItems ?? await list(captured)).find(a => a.id === id);
    if (!current && action === 'delete') return {deleted:true};
    if (!current || !cloudPriceAlertCard(current)) fail('RESOURCE_NOT_FOUND');
    const desired = action === 'pause' ? 'paused' : action === 'resume' ? 'arming' : 'deleted';
    if (current.state === desired || action === 'resume' && current.state === 'monitoring') return {alert:cloudPriceAlertCard(current)};
    if (current.version !== version) fail('VERSION_CONFLICT');
    const result = await request(captured, 'priceAlertAction', {alertId:id,action,version}, `price-${action}:${id}:${version}`);
    if (result?.id !== id || result.state !== desired) fail('CLOUD_RESULT_CONTEXT_INVALID');
    return {alert:cloudPriceAlertCard(result)};
  }
  return {
    async snapshot() {
      const captured = await owner();
      return {alerts:(await list(captured)).filter(a => a.confirmedVersion != null && !['draft','deleted'].includes(a.state))
        .map(cloudPriceAlertCard).filter(Boolean)};
    },
    async create(params) {
      const spec = parsePriceAlertInput(params), captured = await owner();
      if (params.replacesAlertId != null) {
        if (!isCloudPriceAlert(params.replacesAlertId) || !uuid.test(params.replacesAlertId.slice(prefix.length))
          || !Number.isSafeInteger(params.replacesVersion) || params.replacesVersion < 1) fail('CLOUD_RESULT_CONTEXT_INVALID');
        spec.replacesAlertId = params.replacesAlertId;
        spec.replacesVersion = params.replacesVersion;
      }
      if (!captured.email) fail('PRICE_ALERT_EMAIL_REQUIRED');
      const lock = `${captured.ownerId}:${spec.requestId}`;
      if (pending.has(lock)) {
        const existing = pending.get(lock);
        if (!equal(existing.spec, spec)) fail('CLOUD_RESULT_CONTEXT_INVALID');
        return existing.promise;
      }
      const promise = (async () => {
        const [caps, originals] = await Promise.all([
          request(captured, 'capabilities'),
          spec.replacesAlertId ? list(captured) : null,
        ]);
        if (caps.priceAlerts !== 'inclusive-intrabar-v1') fail('PRICE_ALERT_CLOUD_UNAVAILABLE');
        const rule = {marketKey:spec.marketId.replace('BINANCE:FUTURES:','binance:usdm:').replace('BINANCE:SPOT:','binance:spot:'),
          interval:spec.interval, operator:spec.price >= spec.referencePrice ? 'gte' : 'lte', threshold:spec.price, confirmation:'intrabar'};
        if (spec.replacesAlertId) {
          const original = originals.find(a => prefix + a.id === spec.replacesAlertId);
          if (original && (!cloudPriceAlertCard(original) || original.rule.marketKey !== rule.marketKey)) fail('CLOUD_RESULT_CONTEXT_INVALID');
          if (original && original.version !== spec.replacesVersion) fail('VERSION_CONFLICT');
        }
        const symbol = spec.marketId.split(':')[2].replace(/(USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB|EUR|USD)$/, '/$1');
        // Bind replacement retries to the same original without changing the server API.
        const receiptId = spec.replacesAlertId
          ? createHash('sha256').update(JSON.stringify([spec.requestId,spec.replacesAlertId,spec.replacesVersion])).digest('hex') : spec.requestId;
        const body = {rule, title:`${symbol} · ${spec.price.toLocaleString('en-US', {maximumFractionDigits:12})}`, locale:spec.locale};
        const draft = await request(captured, 'createPriceAlertDraft', body, `price-create:${receiptId}`);
        if (!uuid.test(draft?.id) || !equal(draft.rule,rule) || !Number.isSafeInteger(draft.version) || !/^[a-f0-9]{64}$/.test(draft.ruleHash)) fail('CLOUD_RESULT_CONTEXT_INVALID');
        const confirmed = await request(captured, 'confirmPriceAlert', {alertId:draft.id, version:draft.version, ruleHash:draft.ruleHash}, `price-confirm:${receiptId}`);
        if (confirmed?.id !== draft.id || confirmed.ruleHash !== draft.ruleHash || confirmed.confirmedVersion == null) fail('CLOUD_RESULT_CONTEXT_INVALID');
        const saved = caps.priceAlertReadback === 'single-v1'
          ? await request(captured, 'priceAlert', {alertId:draft.id})
          : (await list(captured)).find(a => a.id === draft.id);
        if (!saved || saved.id !== draft.id || saved.ruleHash !== draft.ruleHash || !equal(saved.rule,rule)
          || saved.confirmedVersion == null || ['draft','deleted'].includes(saved.state)) fail('PRICE_ALERT_READBACK_FAILED');
        if (spec.replacesAlertId) {
          try {
            await mutate(captured, 'delete', {alertId:spec.replacesAlertId,version:spec.replacesVersion}, originals);
            if ((await list(captured)).some(a => prefix + a.id === spec.replacesAlertId && a.state !== 'deleted')) fail('PRICE_ALERT_READBACK_FAILED');
          } catch (error) {
            if (error.code === 'TRADING_PREFERENCE_OWNER_CHANGED') throw error;
            fail('PRICE_ALERT_REPLACEMENT_INCOMPLETE');
          }
        }
        return {alert:cloudPriceAlertCard(saved), monitoringReady:['arming','monitoring','completed'].includes(saved.state),
          readbackVerified:true, requestId:spec.requestId, replacedAlertId:spec.replacesAlertId ?? null};
      })();
      pending.set(lock, {spec,promise});
      try { return await promise; } finally { pending.delete(lock); }
    },
    async mutate(action, {alertId,version}) {
      return mutate(await owner(), action, {alertId,version});
    },
  };
}
