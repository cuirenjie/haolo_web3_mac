const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const priceOperators = new Set(['gte', 'lte', 'gt', 'lt', 'cross_over', 'cross_under']);

export function isCloudPriceRule(rule) {
  return !!rule && !rule.kind && !rule.monitoringPolicy && priceOperators.has(rule.operator)
    && positive(rule.threshold) && token(rule.marketKey) && token(rule.interval)
    && ['intrabar', 'bar_close'].includes(rule.confirmation);
}

// These are server trigger receipts, not instructions to evaluate a rule locally.
// entry_v2 retains its stricter condition-evidence validation in cloud-alert-feed.
export function validLegacyCloudNotification(event, alert) {
  const data = event?.data, rule = alert?.rule;
  if (!data || !rule || rule.monitoringPolicy === 'entry_v2'
    || !hash(alert.ruleHash) || data.ruleHash !== alert.ruleHash
    || !Number.isSafeInteger(alert.confirmedVersion) || alert.confirmedVersion < 1
    || data.ruleVersion !== alert.confirmedVersion
    || !token(rule.marketKey) || !token(rule.interval)
    || data.marketKey !== rule.marketKey || data.interval !== rule.interval
    || !data.evidence || typeof data.evidence !== 'object' || Array.isArray(data.evidence)) return false;
  if (isCloudPriceRule(rule)) return data.condition == null || data.condition === 'price';
  if (rule.kind === 'compound_v1') return data.condition === 'compound' && data.evidence.value === true;
  if (rule.kind !== 'execution_plan' || !['long', 'short'].includes(rule.side)
    || !positive(rule.entry) || !positive(rule.stop) || !Array.isArray(rule.targets)
    || !rule.targets.length || !rule.targets.every(positive)) return false;
  return ['entry', 'stop'].includes(data.condition)
    || /^target:\d+$/.test(data.condition) && Number(data.condition.split(':')[1]) < rule.targets.length;
}
