// Read-only validation for historical receipts. Observation cards are retired.
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0;

export function validConditionalWatch(watch, plan, strategyId) {
  return watch?.version === 'conditional-watch-v1' && watch.actionable === false && watch.canCreateAlert === false
    && watch.mode === (plan.requestedMode === 'left' ? 'left' : 'right') && watch.strategyId === strategyId
    && ['completed','data_unavailable','model_failed','not_evaluated'].includes(watch.evaluationStatus)
    && watch.evaluationStatus === plan.outcome?.evaluationStatus
    && watch.reason === plan.outcome?.reason && /^[A-Z0-9_]{1,120}$/.test(watch.reason)
    && Number.isSafeInteger(watch.createdAt) && Number.isSafeInteger(watch.expiresAt)
    && watch.createdAt === plan.createdAt && watch.expiresAt > watch.createdAt && watch.expiresAt <= 8640000000000000
    && Array.isArray(watch.reasonText) && watch.reasonText.length === 3 && watch.reasonText.every(s => typeof s === 'string' && s.length <= 2000)
    && Array.isArray(watch.conditions) && watch.conditions.length <= 2
    && watch.conditions.every(c => c && typeof c === 'object')
    && (watch.evaluationStatus === 'completed' || watch.conditions.length === 0)
    && new Set(watch.conditions.map(c => c.side)).size === watch.conditions.length
    && watch.conditions.every(c => ['long','short'].includes(c.side) && positive(c.price)
      && ['closed_range','native_structure'].includes(c.source)
      && c.confirmation === (watch.mode === 'left' ? 'reclaim_follow' : 'closed_breakout_retest')
      && c.operator === (watch.mode === 'left' ? (c.side === 'long' ? 'at_or_below' : 'at_or_above') : (c.side === 'long' ? 'cross_up' : 'cross_down')));
}
