// Only deterministic engine context enters this catalog. Never scan the user
// instruction, preferences, model response, or evidence from another snapshot.
const PRICE_ACTION_ID = /^(?:pa-|price-action-market-)/;

export function indicatorReviewEvidence(priceActionContext, indicatorContext, indicatorId) {
  function catalog(context, qualify) {
    const entries = new Map();
    function register(id, fact) {
      const qualified = typeof id === 'string' ? qualify(id) : null;
      if (!qualified) return id;
      const summary = [fact.summary, fact.explanation, fact.detail, fact.context].find(value => typeof value === 'string' && value) || '';
      if (!entries.has(qualified) || (!entries.get(qualified).summary && summary)) {
        entries.set(qualified, {id: qualified, summary});
      }
      return qualified;
    }
    function visit(value) {
      if (Array.isArray(value)) return value.map(visit);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
        key === 'id' ? register(child, value)
          // Native dependency references are also frozen evidence, including
          // pattern candles and swings referenced by a supplied zone/setup.
          : key === 'evidenceIds' && Array.isArray(child) ? child.map(id => register(id, value))
            : visit(child),
      ]));
    }
    const projected = visit(context);
    return {context: projected, evidence: [...entries.values()], ids: new Set(entries.keys())};
  }
  const priceAction = catalog(priceActionContext, id => PRICE_ACTION_ID.test(id) ? `price-action:${id}` : null);
  // The indicator projection contains native facts only; strategyId, engine
  // metadata and user settings are not traversed as evidence identifiers.
  const indicator = catalog(indicatorContext, id => id || null);
  indicator.ids.add(indicatorId);
  return {priceAction, indicator};
}
