import assert from 'node:assert/strict';
import test from 'node:test';
import { TradingDrawingController } from '../src/renderer/trading-expert-drawing.ts';

test('drawing bounds follow their own pane through resize, maximization and indicator rebuild', () => {
  let heights = [540, 180, 120];
  let width = 960;
  const chart = {
    options: () => ({ height: 870 }), // Includes other panes, separators and time axis.
    panes: () => heights.map(height => ({ getHeight: () => height })),
    timeScale: () => ({ width: () => width }),
  };
  const surface = new Proxy({}, { get() { throw new Error('must not force DOM layout during pan'); } });
  const controllers = ['main', 'indicator:volume', 'indicator:macd'].map((drawingScope, paneIndex) => ({
    getChart: () => chart, chartElement: surface, drawingScope, paneIndex,
  }));
  for (const layout of [[540, 180, 120], [240, 400, 200], [840, 0, 0], [280, 280, 280], [840]]) {
    heights = layout;
    width -= 20;
    for (const [index, controller] of controllers.entries()) {
      assert.deepEqual(TradingDrawingController.prototype.plotBounds.call(controller), {
        width, height: Math.max(layout[index] || 0, 1),
      });
    }
  }
});

test('every SVG drawing layer uses pane bounds, including hidden drawings and order lines', () => {
  for (const drawingScope of ['main', 'indicator:volume']) {
    const attributes = new Map();
    const layer = () => ({ innerHTML: '' });
    const controller = Object.assign(Object.create(TradingDrawingController.prototype), {
      destroyed: false, drawingScope, paneIndex: drawingScope === 'main' ? 0 : 1,
      getChart: () => ({ panes: () => [{ getHeight: () => 480 }, { getHeight: () => 160 }],
        options: () => ({ height: 670 }), timeScale: () => ({ width: () => 900 }) }),
      getCandleSeries: () => null, orderLines: [], drawingsHidden: true,
      overlay: { setAttribute: (key, value) => attributes.set(key, value) },
      content: layer(), aiContent: layer(), aiTextHitContent: layer(), aiCursorContent: layer(),
      orderLineContent: Object.assign(layer(), { querySelectorAll: () => [] }),
      orderPositionCardLayer: Object.assign(layer(), { querySelectorAll: () => [] }),
      setOpenOrderPositionCard() {}, hideAiTextSizeToolbar() {},
      updateSelectionToolbar() {}, updateAxisMarkers() {},
    });
    controller.redraw();
    const height = drawingScope === 'main' ? '480' : '160';
    assert.equal(attributes.get('height'), height);
    assert.equal(attributes.get('width'), '900');
    assert.equal(attributes.get('viewBox'), `0 0 900 ${height}`);
  }
});
