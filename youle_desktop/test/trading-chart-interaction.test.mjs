import assert from 'node:assert/strict';
import test from 'node:test';
import { beginTradingChartInteraction, endTradingChartInteraction, deferTradingChartShellRender } from '../src/renderer/trading-chart-interaction.ts';

test('background shell renders wait for all chart gestures, coalesce and resume with the latest state', () => {
  const first = {}, split = {}, calls = [];
  assert.equal(deferTradingChartShellRender(() => calls.push('idle')), false);
  beginTradingChartInteraction(first);
  beginTradingChartInteraction(first);
  assert.equal(deferTradingChartShellRender(() => calls.push('obsolete')), true);
  beginTradingChartInteraction(split);
  assert.equal(deferTradingChartShellRender(() => calls.push('latest')), true);
  endTradingChartInteraction(first);
  assert.deepEqual(calls, []);
  endTradingChartInteraction(split);
  endTradingChartInteraction(split);
  assert.deepEqual(calls, ['latest']);
  assert.equal(deferTradingChartShellRender(() => calls.push('idle')), false);
});

test('a resumed render can begin another gesture without losing the next pending render', () => {
  const owner = {}, calls = [];
  beginTradingChartInteraction(owner);
  deferTradingChartShellRender(() => {
    calls.push(1);
    beginTradingChartInteraction(owner);
    deferTradingChartShellRender(() => calls.push(2));
  });
  endTradingChartInteraction(owner);
  assert.deepEqual(calls, [1]);
  endTradingChartInteraction(owner);
  assert.deepEqual(calls, [1, 2]);
});
