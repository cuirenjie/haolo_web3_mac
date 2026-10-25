// Version 1 private transport deltas. No data is interpreted as object code.
export function applyJsonDelta(base, patch, depth = 0) {
  if (depth > 32 || !Array.isArray(patch)) throw Error('Invalid JSON delta');
  const [kind, a, b, c] = patch;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const put = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  if (kind === 'v' && patch.length === 2) return structuredClone(a);
  if (kind === 'o' && patch.length === 3 && object(base) && Array.isArray(a) && object(b)) {
    const result = structuredClone(base);
    if (a.some(key => typeof key !== 'string' || !Object.hasOwn(result, key)) || new Set(a).size !== a.length) throw Error('Invalid removals');
    for (const key of a) delete result[key];
    for (const [key, change] of Object.entries(b)) put(result, key, applyJsonDelta(Object.hasOwn(base, key) ? base[key] : undefined, change, depth + 1));
    return result;
  }
  if (kind === 'r' && patch.length === 3 && Array.isArray(base) && Array.isArray(a) && object(b)) {
    const rows = new Map();
    for (const row of base) {
      if (!object(row) || typeof row.id !== 'string' || rows.has(row.id)) throw Error('Invalid baseline rows');
      rows.set(row.id, row);
    }
    if (a.some(id => typeof id !== 'string') || new Set(a).size !== a.length || Object.keys(b).some(id => !a.includes(id))) throw Error('Invalid row order');
    return a.map(id => {
      if (!rows.has(id) && !Object.hasOwn(b, id)) throw Error('Missing baseline row');
      const row = Object.hasOwn(b, id) ? applyJsonDelta(rows.get(id), b[id], depth + 1) : structuredClone(rows.get(id));
      if (!object(row) || row.id !== id) throw Error('Invalid row identity');
      return row;
    });
  }
  if (kind === 's' && patch.length === 4 && Array.isArray(base) && Number.isSafeInteger(a) && Number.isSafeInteger(b)
      && a >= 0 && b >= 0 && a + b <= base.length && Array.isArray(c)) {
    return structuredClone([...base.slice(0, a), ...c, ...base.slice(a + b)]);
  }
  throw Error('Invalid JSON delta');
}
