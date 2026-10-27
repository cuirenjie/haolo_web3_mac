import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingReplica, drawingCacheKey, drainDrawingOutbox, drawingSyncText } from '../src/renderer/manual-drawing-sync.ts';
import { manualDrawingRequest } from '../src/main/manual-drawing-sync.mjs';

const market = 'binance:usdm:BTCUSDT', owner = 'alice';
const shape = () => ({ id: crypto.randomUUID(), tool: 'trend-line', symbol: market, drawingScope: 'main', points: [{ time: 1700000000000, price: 100 }, { time: 1700003600000, price: 110 }] });
const receipt = () => ({ schemaVersion: 4, version: 1, serverTime: Date.now(), entries: [] });

test('atomic 422 isolates only rejected edits durably; compatible and later edits can upload', () => {
  const replica = new DrawingReplica(), bad = shape(), good = shape();
  replica.merge(receipt()); replica.edit([], [bad, good]);
  const first = replica.begin(market, '1h');
  replica.rejectUpload([0]);
  const restored = new DrawingReplica(replica.serialize());
  assert.equal(restored.blocked, true);
  const next = restored.begin(market, '1h');
  assert.deepEqual(next.operations.map(op => op.id), [good.id]);
  assert.notEqual(next.mutationId, first.mutationId);
  restored.acknowledge(); assert.equal(restored.dirty, false);
  assert.ok(restored.drawings().some(d => d.id === bad.id));
  restored.edit([bad], [{ ...bad, color: '#112233' }]);
  assert.equal(restored.blocked, false); assert.equal(restored.dirty, true);
});

test('HTTP rejection is sanitized through IPC and cannot acknowledge a switched account', async () => {
  const replica = new DrawingReplica(); replica.edit([], [shape()]);
  const body = replica.begin(market, '1h');
  const api = { token: 'fixture', profile: { id: owner }, baseUrl: 'https://fixture', load: async () => {}, requireAuth() {}, authHeaders: () => ({}),
    requestJson: async () => { throw Object.assign(new Error('private text'), { status: 422, payload: { detail: [{ loc: ['body', 'operations', 0, 'drawing', 'points'], input: 'private text' }] } }); } };
  const result = await manualDrawingRequest(api, { action: 'write', owner, body });
  assert.deepEqual(result, { rejected: 'DRAWING_VALIDATION_REJECTED', indexes: [0] });
  const prior = api.requestJson; api.requestJson = async () => { api.profile.id = 'bob'; return prior(); };
  await assert.rejects(manualDrawingRequest(api, { action: 'write', owner, body }), /ACCOUNT_CHANGED/);
});

test('restarted inactive outbox does not repeat permanent 422 on every timer tick', async () => {
  const replica = new DrawingReplica(); replica.edit([], [shape()]); replica.begin(market, '1h');
  const key = drawingCacheKey(owner, market, 'old-session', 'main'), data = new Map([[key, replica.serialize()]]);
  const storage = { length: 1, key: () => key, getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  let writes = 0, reads = 0;
  const api = async p => p.action === 'read' ? (reads++, receipt()) : (writes++, { rejected: 'DRAWING_VALIDATION_REJECTED', indexes: null });
  for (let i = 0; i < 50; i++) await drainDrawingOutbox(api, owner, storage);
  assert.equal(writes, 1); assert.equal(reads, 1);
  assert.equal(new DrawingReplica(data.get(key)).drawings().length, 1);
});

test('lost write receipt keeps the exact mutation/body; newer edits survive a late rejection', () => {
  const replica = new DrawingReplica(), first = shape(); replica.edit([], [first]);
  const frozen = structuredClone(replica.begin(market, '1h'));
  const restored = new DrawingReplica(replica.serialize());
  restored.edit([first], [{ ...first, color: '#abcdef' }]);
  assert.deepEqual(restored.begin(market, '1h'), frozen);
  restored.rejectUpload(null);
  assert.equal(restored.blocked, false);
  assert.equal(restored.begin(market, '1h').operations[0].drawing.color, '#abcdef');
});

test('large UTF-8 batches fit admission; oversized individual edits remain local', () => {
  const replica = new DrawingReplica();
  const shapes = Array.from({ length: 100 }, () => ({ ...shape(), text: '汉'.repeat(1500) }));
  replica.edit([], shapes);
  const first = replica.begin(market, '1h');
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 240000);
  assert.ok(first.operations.length < shapes.length);
  replica.acknowledge(); assert.equal(replica.dirty, true);
  const oversized = { ...shape(), text: '汉'.repeat(100000) }, isolated = new DrawingReplica();
  isolated.edit([], [oversized]); assert.equal(isolated.begin(market, '1h'), null);
  assert.equal(isolated.blocked, true); assert.equal(isolated.drawings()[0].text, oversized.text);
});

test('rejection message is available in all five application languages', () => {
  const prior = globalThis.document;
  try {
    const values = ['zh-CN', 'zh-Hant', 'en', 'ko', 'ja'].map(language => {
      globalThis.document = { documentElement: { dataset: { language } } };
      return drawingSyncText('rejected');
    });
    assert.equal(new Set(values).size, 5);
    assert.match(values[3], /드로잉/); assert.match(values[4], /描画/);
  } finally { globalThis.document = prior; }
});
