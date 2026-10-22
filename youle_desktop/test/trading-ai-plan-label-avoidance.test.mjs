import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutTradingAiNoteBoxes } from '../src/renderer/trading-expert-drawing.ts';
import { tradingPlanPriceLineObstacles, renderTradingOrderLineSvg } from '../src/renderer/trading-expert-order-lines.ts';

const market = 'BINANCE:FUTURES:BTCUSDT';
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const rect = ({ geometry: g }) => ({ x: g.boxLeft, y: g.boxTop, width: g.boxWidth, height: g.boxHeight });
const lines = [200, 294, 300, 370, 480].map((price, i) => ({id: `p${i}`, marketId: market, price,
  kind: i ? 'take-profit' : 'plan-entry', shortLabel: i ? `第${i}止盈` : '入场做多', label: String(price), labelMode: 'price'}));

test('notes and candlestick labels avoid fixed badges and strokes, even when candles fill the plot', () => {
  for (const width of [420, 1000]) for (const fontSize of [10, 16, 22]) {
    const bounds = { width, height: 600, priceScaleWidth: 72 };
    const obstacles = tradingPlanPriceLineObstacles(lines, market, bounds, p => p);
    const notes = ['看涨十字孕线 · 待收盘', '底分型', 'Bullish harami cross · awaiting close'].map((text, i) => ({
      id: String(i), anchor: { x: width - 85, y: 294 + i * 4 }, text, fontSize, avoidBoxInteriors: i === 0,
    }));
    const before = structuredClone(notes);
    const result = layoutTradingAiNoteBoxes(notes, bounds, [{ x: 0, y: 0, width, height: 600 }], [], obstacles);
    assert.equal(result.length, notes.length);
    for (const placement of result) assert.ok(obstacles.every(o => !overlap(rect(placement), o)));
    assert.deepEqual(notes, before);
    assert.deepEqual(layoutTradingAiNoteBoxes(notes, bounds, [], [], obstacles), layoutTradingAiNoteBoxes(notes, bounds, [], [], obstacles));
    const svg = renderTradingOrderLineSvg(lines, market, bounds, p => p);
    const badges = [...svg.matchAll(/class="trading-order-line-label-bg" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];
    assert.deepEqual(obstacles.filter((_, i) => i % 2 === 0), badges.map(m=>({x:+m[1],y:+m[2],width:+m[3],height:+m[4]})));
  }
});

test('reserved plan geometry respects context, hidden/invalid prices, scaling and axis width', () => {
  const bounds = {width: 800, height: 600, priceScaleWidth: 0};
  assert.deepEqual(tradingPlanPriceLineObstacles(lines, 'other', bounds, p => p), []);
  assert.deepEqual(tradingPlanPriceLineObstacles([], market, bounds, p => p), []);
  for (const invalid of [null, NaN, -1, 601]) assert.deepEqual(tradingPlanPriceLineObstacles(lines, market, bounds, () => invalid), []);
  const obstacles = tradingPlanPriceLineObstacles(lines, market, bounds, p => p / 2);
  assert.equal(obstacles[0].x + obstacles[0].width, bounds.width);
  assert.equal(obstacles[0].y + obstacles[0].height / 2, 100);
});
