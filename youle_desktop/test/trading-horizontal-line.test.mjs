import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingHorizontalLineTextGeometry, renderTradingHorizontalLineText } from '../src/renderer/trading-expert-drawing.ts';
import { normalizeHorizontalLineTextStyle } from '../src/renderer/trading-horizontal-line-settings.ts';
import { drawingToWire, drawingFromWire } from '../src/renderer/manual-drawing-sync.ts';

const line = { id: 'line', tool: 'horizontal-line', symbol: 'BINANCE:FUTURES:BTCUSDT', points: [{ time: 1700000000, price: 123.45 }], text: '支撑位\nSupport', fontSize: 20 };

test('horizontal line text stays within the plot at every horizontal and vertical alignment', () => {
  for (const textAlign of ['left', 'center', 'right']) {
    for (const textVerticalAlign of ['top', 'middle', 'bottom']) {
      const g = tradingHorizontalLineTextGeometry({ ...line, textAlign, textVerticalAlign }, 200, 800);
      assert.ok(g.left >= 0 && g.left + g.layout.width <= 800);
      assert.equal(g.x, { left: 8, center: 400, right: 792 }[textAlign]);
      if (textVerticalAlign === 'top') assert.ok(g.top + g.layout.height < 200);
      if (textVerticalAlign === 'middle') assert.equal(g.top + g.layout.height / 2, 200);
      if (textVerticalAlign === 'bottom') assert.ok(g.top > 200);
      assert.deepEqual(g.layout.lines, ['支撑位', 'Support']);
    }
  }
  const narrow = tradingHorizontalLineTextGeometry({ ...line, text: '很长的水平线备注'.repeat(20), textAlign: 'right' }, 100, 100);
  assert.ok(narrow.left >= 0 && narrow.layout.width <= 76);
  assert.equal(tradingHorizontalLineTextGeometry({ ...line, text: '' }, 100, 800), null);
});

test('line labels use independent text appearance, escape user text and expose a label hit target', () => {
  const markup = renderTradingHorizontalLineText({ ...line, text: '<script>&"', textColor: '#ef5350', bold: true, italic: true, textVerticalAlign: 'middle' }, 200, 800, '#2962ff', true);
  assert.match(markup, /fill="#ef5350"/);
  assert.match(markup, /font-size="20" font-weight="700" font-style="italic"/);
  assert.match(markup, /&lt;script&gt;&amp;&quot;/);
  assert.match(markup, /trading-drawing-hit-target area/);
  assert.doesNotMatch(markup, /fill="var\(--trading-market-panel\)"/, 'labels do not paint over chart candles');
  assert.doesNotMatch(renderTradingHorizontalLineText({ ...line, text: '' }, 200, 800, '#2962ff'), /<text/);
});

test('line text styling roundtrips through sync and rejects malformed persisted values', () => {
  const styled = { ...line, textColor: '#ef5350', italic: true, textAlign: 'right', textVerticalAlign: 'middle', showPriceLabel: false, bold: true };
  const restored = drawingFromWire(drawingToWire(styled), styled.symbol);
  for (const key of ['text', 'fontSize', 'bold', 'textColor', 'italic', 'textAlign', 'textVerticalAlign', 'showPriceLabel']) assert.equal(restored[key], styled[key]);
  assert.deepEqual(normalizeHorizontalLineTextStyle(styled), { textColor: '#ef5350', italic: true, textAlign: 'right', textVerticalAlign: 'middle', showPriceLabel: false });
  assert.deepEqual(normalizeHorizontalLineTextStyle({ textColor: 'red" onclick="bad', textAlign: 'invalid', textVerticalAlign: 'invalid', italic: 'true', showPriceLabel: 'false' }), {});
});
