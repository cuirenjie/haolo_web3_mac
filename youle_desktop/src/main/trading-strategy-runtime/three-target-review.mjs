// A second, deterministic review for compressed one/two-target plans. Keep
// the structural endpoint and fill only the space that passes net risk limits.
export function reviewThreeTakeProfitTargets(value, {costRate = 0, minimumRatio = .4, tickSize = null, candles = []} = {}) {
  if (!value?.targets?.length) return null;
  const sign = value.side === 'long' ? 1 : -1;
  const entry = value.trigger.price, cost = entry * costRate;
  const risk = Math.abs(entry - value.stop.price) + cost;
  const ratio = price => (sign * (price - entry) - cost) / risk;
  const native = [...value.targets].sort((a, b) => sign * (a.price - b.price))
    .filter((t, i, all) => i === 0 || t.price !== all[i - 1].price);
  if (native.length >= 3) return {...value, targets: native.length === 3 ? native : [native[0], native[Math.floor((native.length - 1) / 2)], native.at(-1)]};
  const final = native.at(-1), finalRatio = ratio(final.price);
  const quantum = tickSize > 0 ? tickSize : Math.max(1e-8, 10 ** -Math.max(0, 7 - Math.trunc(entry).toString().length));
  const floor = minimumRatio + Math.max(1e-8, quantum / risk);
  const span = finalRatio - floor;
  if (!(risk > 0) || !(span > 2 * quantum / risk)) return null;
  const first = Math.min(Math.max(.5, floor), floor + span / 3);
  const second = Math.min(Math.max(.9, first + span / 3), floor + 2 * span / 3);
  // Only explicitly closed candles may contribute swing evidence. A live bar
  // never becomes a confirmed structural level during this review.
  const closed = candles.filter(c => c.closed === true).slice(-240);
  const key = sign === 1 ? 'high' : 'low';
  const pivots = closed.slice(1, -1).filter((c, i) => sign*c[key] >= sign*closed[i][key] && sign*c[key] >= sign*closed[i+2][key]).map(c => c[key]);
  const pool = [...native.slice(0, -1).map(t => t.price), ...pivots];
  const targets = [];
  for (const [desired, lower, upper] of [[first, floor, (first+second)/2], [second, (first+second)/2, (second+finalRatio)/2]]) {
    const options = pool.filter(p => Number.isFinite(p) && ratio(p) >= lower && ratio(p) <= upper && sign*(final.price-p) >= quantum);
    const raw = entry + sign * (cost + risk * desired);
    const price = options.sort((a,b) => Math.abs(ratio(a)-desired) - Math.abs(ratio(b)-desired))[0]
      ?? Number(((sign === 1 ? Math.ceil(raw/quantum) : Math.floor(raw/quantum))*quantum).toFixed(8));
    const source = native.find(t => t.price === price);
    targets.push(source || {...final, price, label: `${value.side === 'long' ? '多头' : '空头'}第 ${targets.length+1} 目标（结构区间分批退出）`});
  }
  targets.push(final);
  if (targets.some(t => !Number.isFinite(t.price) || t.price <= 0 || ratio(t.price) < minimumRatio)
      || targets.some((t,i) => i > 0 && sign*(t.price-targets[i-1].price) <= 0)) return null;
  return {...value, targets};
}
