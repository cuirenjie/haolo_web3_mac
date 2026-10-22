import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingAiPlanFitRange, TradingAiPlanAutoscale } from '../src/renderer/trading-ai-plan-autoscale.ts';
import { TradingDrawingController } from '../src/renderer/trading-expert-drawing.ts';

test('the fit contains every plan price and AI anchor with padding, without changing prices', () => {
  const prices = [81766.24, 82584, 81146.4, 80622, 80361.44];
  const geometry = [{ points: [{ price: 84311.3 }, { price: 81146.4 }] }];
  const input = structuredClone({ prices, geometry });
  const range = tradingAiPlanFitRange(prices, geometry);
  assert.ok(range.minValue < Math.min(...prices) && range.maxValue > 84311.3);
  assert.deepEqual({ prices, geometry }, input);
  assert.equal(tradingAiPlanFitRange([], geometry), null, 'geometry alone does not trigger a plan fit');
  assert.equal(tradingAiPlanFitRange([NaN, -1, Infinity], geometry), null);
  for (const price of [1e-9, 1, 1e9]) {
    const single = tradingAiPlanFitRange([price], [{ points: [{ price: NaN }] }]);
    assert.ok(single.minValue > 0 && single.minValue < price && single.maxValue > price);
  }
});

test('native autoscale contribution updates only on changed bounds and releases old series', () => {
  const events = [], fit = new TradingAiPlanAutoscale();
  const series = name => ({
    attachPrimitive(p) { events.push(`${name}:attach`); p.attached({ requestUpdate: () => events.push(`${name}:update`) }); },
    detachPrimitive(p) { events.push(`${name}:detach`); p.detached(); },
  });
  const a = series('a'), b = series('b'), range = { minValue: 100, maxValue: 200 };
  fit.update(a, range); fit.update(a, { ...range });
  assert.deepEqual(events, ['a:attach']);
  assert.deepEqual(fit.autoscaleInfo(), { priceRange: range, margins: { above: 12, below: 12 } });
  fit.update(a, null);
  assert.equal(fit.autoscaleInfo(), null, 'hidden/cleared plans stop contributing bounds');
  fit.update(b, range); fit.destroy();
  assert.deepEqual(events, ['a:attach', 'a:update', 'a:detach', 'b:attach', 'b:detach']);
  assert.equal(fit.autoscaleInfo(), null);
});

test('only the completed current playback fits, after the final selected drawings are installed', async () => {
  for (const interruption of ['none', 'cancel', 'clear', 'session', 'market', 'interval', 'new-playback', 'destroy']) {
    const events = [];
    let active = true, market = 'BTC', interval = '60';
    const subject = Object.assign(Object.create(TradingDrawingController.prototype), {
      storageSessionId: 'thread', aiDrawingClearVersion: 0, aiDrawingPlaybackVersion: 0, aiDrawings: [],
      aiPlaybackDeletedTextIds: new Set(),
      normalizeAiDrawingPatch: () => [], cancelAiPlayback: () => {},
      getSymbol: () => market, getInterval: () => interval,
      aiPlayback: { play: async () => {
        assert.equal(events.length, 0, 'never fit while animating');
        if (interruption === 'cancel') active = false;
        if (interruption === 'clear') subject.aiDrawingClearVersion++;
        if (interruption === 'session') subject.storageSessionId = 'other';
        if (interruption === 'market') market = 'ETH';
        if (interruption === 'interval') interval = '240';
        if (interruption === 'new-playback') subject.aiDrawingPlaybackVersion++;
        if (interruption === 'destroy') subject.destroyed = true;
      } },
      storeAiDrawingPatch: () => events.push('stored'),
      aiDrawingSets: { selectedDrawings: () => { events.push('selected'); return []; } },
      redraw: () => {},
      fitCompletedAiPlan: () => { assert.equal(subject.aiDrawingSetPlaying, false); events.push('fit'); },
    });
    await subject.playAiDrawingPatch({ marketId: 'BTC', interval: '60' }, { shouldContinue: () => active });
    assert.equal(events.includes('fit'), interruption === 'none', interruption);
    if (interruption === 'none') assert.deepEqual(events, ['stored', 'selected', 'fit']);
  }
});
