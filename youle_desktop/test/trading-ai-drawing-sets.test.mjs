import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingAiDrawingSets } from '../src/renderer/trading-ai-drawing-sets.ts';

const btc = { marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '60' };
const eth = { ...btc, marketId: 'BINANCE:FUTURES:ETHUSDT' };
const line = (id, context = btc) => ({ id, symbol: context.marketId, interval: context.interval, strategyId: id, fontSize: 10 });
const normalize = values => values.filter(v => v && typeof v.symbol === 'string');
function environment() {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const create = (session = 'thread') => new TradingAiDrawingSets(storage, session, normalize);
  return { values, storage, create };
}

test('same-turn drawings cycle in arrival order, wrap, and restore the selected drawing', () => {
  const { create } = environment(), sets = create();
  for (const id of ['wyckoff', 'chan', 'wave']) sets.upsert(btc, 'turn-1', id, [line(id)]);
  assert.deepEqual(sets.info(btc), { count: 3, index: 2 });
  for (const id of ['wyckoff', 'chan', 'wave', 'wyckoff']) {
    assert.equal(sets.next(btc), true);
    assert.equal(sets.selectedDrawings([])[0].id, id);
  }
  assert.deepEqual(create().info(btc), { count: 3, index: 0 });
  assert.equal(create().selectedDrawings([])[0].id, 'wyckoff');
});

test('new turn replaces the complete old group, while a duplicate receipt neither appends nor moves selection', () => {
  const { create } = environment(), sets = create();
  sets.upsert(btc, 'turn-1', 'a', [line('a')]);
  sets.upsert(btc, 'turn-1', 'b', [line('b')]);
  sets.next(btc);
  sets.upsert(btc, 'turn-1', 'b', [line('b')]);
  assert.deepEqual(sets.info(btc), { count: 2, index: 0 });
  sets.upsert(btc, 'turn-2', 'c', [line('c')]);
  assert.deepEqual(sets.info(btc), { count: 1, index: 0 });
  assert.equal(sets.next(btc), false);
  assert.deepEqual(create().selectedDrawings([]), [line('c')]);
});

test('markets, periods, conversations and split panes remain isolated', () => {
  const { create } = environment(), sets = create(), h4 = { ...btc, interval: '240' };
  sets.upsert(btc, 'turn', 'a', [line('a')]);
  sets.upsert(btc, 'turn', 'b', [line('b')]);
  sets.upsert(eth, 'turn', 'c', [line('c', eth)]);
  sets.upsert(h4, 'turn', 'd', [line('d', h4)]);
  sets.next(btc);
  assert.equal(sets.info(eth).index, 0);
  assert.equal(sets.info(h4).index, 0);
  assert.equal(create('other').info(btc).count, 0);
  assert.equal(create('thread::split-pane:1').info(btc).count, 0);
  assert.deepEqual(sets.selectedDrawings([]).map(d => d.id), ['a', 'c', 'd']);
});

test('label changes persist per drawing and session promotion preserves every alternative', () => {
  const { create } = environment(), sets = create('draft');
  sets.upsert(btc, 'turn', 'a', [line('a')]);
  sets.upsert(btc, 'turn', 'b', [line('b')]);
  sets.updateSelected([{ ...line('b'), fontSize: 18 }]);
  sets.next(btc);
  sets.switchSession('saved', true);
  assert.equal(create('draft').info(btc).count, 0);
  const restored = create('saved');
  assert.equal(restored.info(btc).count, 2);
  restored.next(btc);
  assert.equal(restored.selectedDrawings([])[0].fontSize, 18);
  restored.upsert(btc, 'turn', 'b', [line('b')]);
  assert.equal(restored.selectedDrawings([])[0].fontSize, 18, 'duplicate receipt keeps user label sizing');
  restored.upsert(btc, 'turn', 'b', [{ ...line('b'), fontSize: 12 }], 1);
  assert.equal(restored.selectedDrawings([])[0].fontSize, 12, 'a new revision updates the same slot');
  restored.upsert(btc, 'turn', 'b', [line('b')], 0);
  assert.equal(restored.selectedDrawings([])[0].fontSize, 12, 'late older revision cannot overwrite the slot');
  restored.switchSession('other', false);
  assert.equal(restored.info(btc).count, 0);
});

test('clearing a strategy, context or session removes alternatives durably', () => {
  const { create } = environment(), sets = create();
  sets.upsert(btc, 'turn', 'a', [line('a')]);
  sets.upsert(btc, 'turn', 'b', [line('b')]);
  sets.upsert(eth, 'turn', 'c', [line('c', eth)]);
  sets.clear(btc, 'b');
  assert.deepEqual(sets.info(btc), { count: 1, index: 0 });
  sets.clear(btc);
  assert.equal(create().info(btc).count, 0);
  assert.equal(create().info(eth).count, 1);
  sets.clear();
  assert.deepEqual(create().selectedDrawings([]), []);
});

test('deleting a label survives cycling, reload and duplicate receipts without changing other sets', () => {
  const { create } = environment(), sets = create();
  sets.upsert(btc, 'turn', 'a', [line('a'), line('note')]);
  sets.upsert(btc, 'turn', 'b', [line('b')]);
  sets.next(btc);
  sets.updateSelected([line('a')]);
  sets.next(btc);
  assert.deepEqual(sets.selectedDrawings([]), [line('b')]);
  const restored = create();
  restored.next(btc);
  restored.upsert(btc, 'turn', 'a', [line('a'), line('note')]);
  assert.deepEqual(restored.selectedDrawings([]), [line('a')]);
});

test('deleting the last annotation preserves an empty slot and its revision after reload', () => {
  const { create } = environment(), sets = create();
  sets.upsert(btc, 'turn', 'a', [line('only-note')]);
  sets.updateSelected([]);
  const restored = create();
  restored.upsert(btc, 'turn', 'a', [line('only-note')]);
  assert.deepEqual(restored.selectedDrawings([line('legacy')]), []);
  restored.upsert(btc, 'turn', 'b', [line('b')]);
  restored.next(btc);
  assert.deepEqual(restored.selectedDrawings([]), []);
  restored.upsert(btc, 'turn', 'a', [line('new-note')], 1);
  assert.deepEqual(restored.selectedDrawings([]), [line('new-note')]);
});

test('legacy drawings survive until a new successful group; corrupt storage fails closed and quota failure stays usable', () => {
  const { create, storage } = environment(), sets = create();
  assert.deepEqual(sets.selectedDrawings([line('legacy')]), [line('legacy')]);
  storage.setItem('haolo.trading-market.ai-drawing-sets.v1.thread', '{broken');
  assert.equal(create().info(btc).count, 0);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  sets.upsert(btc, 'turn', 'a', [line('a')]);
  sets.upsert(btc, 'turn', 'b', [line('b')]);
  assert.equal(sets.next(btc), true);
  assert.equal(sets.selectedDrawings([])[0].id, 'a');
});
