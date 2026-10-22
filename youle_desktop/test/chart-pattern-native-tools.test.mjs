import assert from 'node:assert/strict';
import test from 'node:test';
import { chartPatternNativeDrawingModel } from '../src/renderer/chart-pattern-native-tools.ts';

const points = Object.freeze([100, 80, 95, 83, 93].map((price, i) => Object.freeze({ time: 1700000000 + i * 3600, price })));
const model = (overrides = {}) => Object.freeze({ id: 'pattern-structure', source: 'ai', strategyId: 'chart-patterns',
  symbol: 'BTCUSDT', tool: 'path', points, locked: true, lineStyle: 'dotted', colorToken: 'strategy-resistance',
  entryConditionRef: Object.freeze({ conditionId: 'breakout', revision: 1, conditionHash: 'hash' }), ...overrides });

test('measured boundaries and structures use existing native tools without changing accepted evidence', () => {
  for (const [anchors, tool] of [[points.slice(0, 2), 'trend-line'], [points, 'multi-point-polyline']]) {
    const accepted = model({ points: Object.freeze(anchors) }), before = JSON.stringify(accepted);
    const display = chartPatternNativeDrawingModel(accepted);
    assert.equal(display.tool, tool);
    assert.equal(display.points, accepted.points);
    assert.deepEqual({ ...display, tool: 'path' }, accepted);
    assert.equal(JSON.stringify(accepted), before);
    assert.equal(chartPatternNativeDrawingModel(display), display);
  }
});

test('manual drawings, other strategies, annotations and directional arrows retain their own tools', () => {
  for (const overrides of [{ source: 'manual' }, { strategyId: 'wave' }, { strategyId: 'wyckoff' },
    { strategyId: undefined }, { tool: 'note' }, { tool: 'text' }, { tool: 'arrow-down' }, { points: [] }]) {
    const accepted = model(overrides);
    assert.equal(chartPatternNativeDrawingModel(accepted), accepted);
  }
});
