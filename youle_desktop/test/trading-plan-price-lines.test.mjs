import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTradingPlanPriceLines } from '../src/renderer/trading-plan-price-lines.ts';
import { renderTradingOrderLineSvg, renderTradingOrderPositionCards } from '../src/renderer/trading-expert-order-lines.ts';
import { TradingDrawingController } from '../src/renderer/trading-expert-drawing.ts';
import { executionPlanStructuredCardBody } from '../src/main/execution-plan-card-view.mjs';

const market = 'BINANCE:FUTURES:SNDKUSDT';
function drawing(role, price, index = 0, overrides = {}) {
  return { id: `condition-${role}-${index}`, source: 'ai', strategyId: 'chan', symbol: market, interval: '1h',
    tool: 'path', points: [{ time: 1, price }, { time: 10, price }], colorToken: `strategy-${role}`,
    text: `${role === 'entry' ? '入场条件' : role === 'stop' ? '止损 / 结构失效' : '止盈参考'} ${price}`, ...overrides };
}
const sample = () => [drawing('entry', 1409.49), drawing('stop', 1453.71),
  ...[1358.78, 1325.55, 1285.246].map((price, index) => drawing('target', price, index))];

test('five plan levels reuse account-line labels with exact prices and no account actions', () => {
  const drawings = sample(), original = structuredClone(drawings);
  const { lines, drawingIds } = buildTradingPlanPriceLines(drawings);
  assert.deepEqual(drawings, original);
  assert.equal(drawingIds.size, 5);
  assert.deepEqual(lines.map(line => line.shortLabel), ['入场', '止损', '第1止盈', '第2止盈', '第3止盈']);
  assert.deepEqual(lines.map(line => line.kind), ['plan-entry', 'stop-loss', 'take-profit', 'take-profit', 'take-profit']);
  assert.equal(lines.at(-1).label, '1285.246', 'same decimal formatting as the plan card');
  const bounds = { width: 1000, height: 600 }, project = price => (1500 - price) * 2;
  const svg = renderTradingOrderLineSvg(lines, market, bounds, project);
  assert.equal((svg.match(/data-trading-plan-price-line/g) || []).length, 5);
  assert.equal((svg.match(/x1="0"[^>]+x2="1000"/g) || []).length, 5);
  assert.doesNotMatch(svg, /-- USDT|data-trading-order-card-trigger|data-trading-order-position-trigger|tabindex/);
  assert.match(svg, /第3止盈/);
  assert.equal(renderTradingOrderPositionCards(lines, market, bounds, project), '');
  assert.equal(renderTradingOrderLineSvg(lines, 'BINANCE:FUTURES:BTCUSDT', bounds, project), '');
  assert.equal(renderTradingOrderLineSvg(lines, market, bounds, () => null), '');
});

test('only horizontal AI plan levels are adapted; manual drawings and theory geometry remain intact', () => {
  const ignored = [drawing('entry', 10, 0, { source: 'manual' }), drawing('entry', 10, 1, { tool: 'note' }),
    drawing('entry', 10, 2, { colorToken: 'strategy-support' }), drawing('entry', NaN, 3),
    drawing('entry', 10, 4, { points: [{ time: 1, price: 10 }, { time: 2, price: 11 }] })];
  assert.equal(buildTradingPlanPriceLines(ignored).lines.length, 0);
  assert.equal(buildTradingPlanPriceLines([drawing('target', 0.00000009)]).lines[0].label, '0.00000009');
});

test('legacy repeated entry boundaries collapse while target order and separate conditions remain stable', () => {
  const lines = sample();
  lines.splice(2, 0, { ...lines[0], id: 'repeated-entry' });
  lines.push(drawing('target', 1285.246, 3));
  const separate = { conditionId: 'second', revision: 1, conditionHash: 'hash' };
  lines.push(drawing('target', 1350, 4, { entryConditionRef: separate }));
  const result = buildTradingPlanPriceLines(lines);
  assert.equal(result.drawingIds.size, 8);
  assert.equal(result.lines.length, 7);
  assert.deepEqual(result.lines.slice(2).map(line => line.shortLabel), ['第1止盈', '第2止盈', '第3止盈', '第4止盈', '第1止盈']);
});

test('historical Chinese, Traditional Chinese and English plan labels retain their source language', () => {
  for (const [texts, labels] of [
    [['入场条件', '止损', '止盈参考'], ['入场', '止损', '第1止盈']],
    [['入場條件', '止損', '止盈參考'], ['入場', '止損', '第1止盈']],
    [['Entry condition', 'Stop loss / invalidation', 'Take profit'], ['Entry', 'Stop loss', 'TP1']],
  ]) {
    const lines = buildTradingPlanPriceLines(['entry', 'stop', 'target'].map((role, i) => drawing(role, 10 + i, i, { text: texts[i] }))).lines;
    assert.deepEqual(lines.map(line => line.shortLabel), labels);
  }
});

test('entry zones display one card-matching trigger in either drawing order and remain isolated by condition', () => {
  for (const reverse of [false, true]) {
    const drawings = ['long', 'short'].flatMap(direction => {
      const ref = { conditionId: direction, revision: 1, conditionHash: direction };
      return [drawing('entry', 1405.85, `${direction}-lower`, { entryConditionRef: ref }),
        drawing('entry', 1409.49, `${direction}-upper`, { entryConditionRef: ref }),
        drawing('stop', direction === 'long' ? 1350 : 1453.71, direction, { entryConditionRef: ref })];
    });
    if (reverse) drawings.reverse();
    const { lines, drawingIds } = buildTradingPlanPriceLines(drawings);
    assert.equal(drawingIds.size, 6, 'both zone edges leave the generic drawing layer');
    const entries = lines.filter(line => line.kind === 'plan-entry');
    assert.equal(entries.length, 2, 'one entry per condition');
    assert.equal(entries.find(line => line.id.includes('long')).price, 1405.85);
    assert.equal(entries.find(line => line.id.includes('short')).price, 1409.49);
  }
});

test('saved real cloud patches gain labels without rewriting original prices', () => {
  const receipts = JSON.parse(readFileSync(new URL('./fixtures/left-conditional-receipts.json', import.meta.url)));
  for (const result of Object.values(receipts)) {
    const drawings = result.analysisPlan.drawingPatch.operations.map(op => ({ ...op.drawing, source: 'ai' }));
    const original = structuredClone(drawings), adapted = buildTradingPlanPriceLines(drawings);
    assert.ok(adapted.lines.length >= 3);
    assert.deepEqual(drawings, original);
    for (const line of adapted.lines) assert.ok(drawings.some(d => `plan:${d.id}` === line.id && d.points[0].price === line.price));
    const plan = result.executionPlan, condition = plan.entryCondition, scenario = plan.scenarios[0];
    const card = executionPlanStructuredCardBody({ entry: condition.trigger, entryMode: plan.selectedMode,
      direction: condition.direction, stop: scenario.stop, targets: scenario.targets });
    const cardPrice = card.match(/class="execution-plan-price [^"]+">([^<]+)/)[1];
    const entries = adapted.lines.filter(line => line.kind === 'plan-entry');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].price, condition.direction === 'long' ? condition.trigger.lower : condition.trigger.upper,
      'the line coordinate keeps the exact frozen trigger price');
    assert.equal(entries[0].label, cardPrice, 'historical zones use the current card trigger and decimal precision');
  }
});

test('controller keeps plan visibility, playback, pane and market scoping independent of account orders', () => {
  const layer = () => ({ innerHTML: '', querySelectorAll: () => [] });
  const attributes = new Map();
  let symbol = market, interval = '1h', scale = 2;
  const controller = Object.assign(Object.create(TradingDrawingController.prototype), {
    destroyed: false, drawingScope: 'main', volumeCalculations: new Map(), drawings: [], aiDrawings: sample(), aiDraft: null,
    drawingVisibility: { aiHidden: false, manualHidden: true },
    orderLines: [{ id: 'account-order', marketId: market, price: 1460, kind: 'stop-loss', shortLabel: '止损', label: '10 USDT', quantityUsdt: 10 }],
    getSymbol: () => symbol, getInterval: () => interval,
    getCandleSeries: () => ({ priceToCoordinate: price => (1500 - price) * scale }),
    plotBounds: () => ({ width: 1000, height: 600 }), selectedDrawing: () => null,
    overlay: { classList: { remove() {} }, getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) },
    content: layer(), orderLineContent: layer(), orderPositionCardLayer: layer(), aiContent: layer(), aiTextHitContent: layer(), aiCursorContent: layer(),
    manualLayer: { render() {} }, visibleCandleObstacles: () => [],
    renderDrawing: drawing => `<path data-original="${drawing.id}"/>`,
  });
  for (const name of ['clearDrawingHandlesHideTimer', 'cancelDragRedraw', 'flushPointerMoves', 'positionHorizontalLineTextEdit',
    'setOpenOrderPositionCard', 'renderAiCursor', 'updateAiTextSizeToolbar', 'updateToolbarState', 'updateSelectionToolbar', 'updateAxisMarkers']) controller[name] = () => {};
  const count = () => (controller.orderLineContent.innerHTML.match(/data-trading-plan-price-line/g) || []).length;
  controller.redraw();
  assert.equal(count(), 5);
  assert.equal(controller.aiContent.innerHTML, '');
  assert.match(controller.orderLineContent.innerHTML, /data-trading-order-line="account-order"/);
  const before = controller.orderLineContent.innerHTML;
  scale = 1; controller.redraw();
  assert.notEqual(controller.orderLineContent.innerHTML, before);
  for (const manualHidden of [true, false]) {
    Object.assign(controller.drawingVisibility, { aiHidden: true, manualHidden });
    controller.redraw(); assert.equal(count(), 5, 'hiding AI geometry preserves plan levels');
    assert.match(controller.orderLineContent.innerHTML, /data-trading-order-line="account-order"/);
    controller.drawingVisibility.aiHidden = false;
  }
  for (const aiHidden of [true, false]) for (const manualHidden of [true, false])
    for (const plansHidden of [true, false]) for (const ordersHidden of [true, false]) {
      Object.assign(controller.drawingVisibility, { aiHidden, manualHidden, plansHidden, ordersHidden });
      controller.redraw();
      assert.equal(count(), plansHidden ? 0 : 5);
      assert.equal(controller.orderLineContent.innerHTML.includes('data-trading-order-line="account-order"'), !ordersHidden);
    }
  Object.assign(controller.drawingVisibility, { aiHidden: false, manualHidden: true, plansHidden: false, ordersHidden: false });
  interval = '4h'; controller.redraw(); assert.equal(count(), 0);
  interval = '1h'; symbol = 'BINANCE:FUTURES:BTCUSDT'; controller.redraw(); assert.equal(count(), 0);
  symbol = market; controller.drawingScope = 'indicator:volume'; controller.redraw(); assert.equal(count(), 0);
  controller.drawingScope = 'main'; controller.aiDraft = controller.aiDrawings.pop();
  controller.redraw(); assert.equal(count(), 5);
  controller.aiDraft = null; controller.aiDrawings = []; controller.redraw(); assert.equal(count(), 0);
});
