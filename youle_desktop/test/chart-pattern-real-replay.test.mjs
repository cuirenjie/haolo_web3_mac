import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runTradingChartPatternAnalysisPipeline } from '../src/main/trading-analysis/chart-pattern-pipeline.mjs';

test('frozen public BTC incident preserves structural identity across 100/240/600-bar windows', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/wyckoff-btc-retest-20261022.json', import.meta.url)));
  const candles = [...fixture.historyPrefix, ...fixture.snapshot.candles].map(c => ({ ...c, time: c.time / 1000 }));
  const results = await Promise.all([100, 240, 600].map(count => runTradingChartPatternAnalysisPipeline({
    marketId: 'BINANCE:FUTURES:BTCUSDT', interval: '60', snapshotTime: fixture.snapshot.fetchedAt,
    tickSize: fixture.snapshot.tickSize, candles: candles.slice(-count),
  })));
  const reference = results[0].theoryResult.structures.primaryActiveCandidate;
  assert.ok(reference);
  for (const result of results) {
    const { primaryActiveCandidate: primary, displayCandidates } = result.theoryResult.structures;
    assert.equal(primary.id, reference.id);
    assert.deepEqual(primary.points.map(({ time, price }) => [time, price]), reference.points.map(({ time, price }) => [time, price]));
    assert.ok(primary.points.some(p => p.price === 84875.2));
    assert.ok(displayCandidates.some(c => c.lifecycle === 'completed'));
    assert.ok(displayCandidates.some(c => c.lifecycle === 'invalidated'));
    assert.ok(primary.points.every(p => p.time * 1000 + 3600000 <= fixture.snapshot.fetchedAt));
    for (const historical of displayCandidates.filter(c => c !== primary)) {
      const operations = result.analysisPlan.drawingPatch.operations.filter(o => o.drawing.evidenceIds?.includes(historical.id));
      assert.ok(operations.length > 0);
      assert.ok(!operations.some(o => /-level-/.test(o.drawing.id)));
    }
  }
});
