import type { TradingOrderLineCandleObstacle } from './trading-expert-order-lines.ts';

/** Measure only visible annotation ink/cards, never the enclosing drawing geometry.
 * Screen rectangles include SVG rotations; convert back to the overlay's coordinates.
 */
export function tradingDrawingLabelObstacles(
  overlay: SVGSVGElement,
  layers: readonly SVGGElement[],
): TradingOrderLineCandleObstacle[] {
  const texts = layers.flatMap(layer => [...layer.querySelectorAll<SVGGraphicsElement>(
    'text, .trading-drawing-region-label > rect, .trading-price-note > rect, '
      + '.trading-manual-note-card, .trading-manual-price-card, .trading-pin-note-bubble',
  )]).filter(element => !element.closest('defs, [data-horizontal-line-add-text]'));
  if (!texts.length) return [];
  const screenToOverlay = overlay.getScreenCTM()?.inverse();
  if (!screenToOverlay) return [];
  return texts.flatMap(element => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    const corners = [
      new DOMPoint(rect.left, rect.top), new DOMPoint(rect.right, rect.top),
      new DOMPoint(rect.left, rect.bottom), new DOMPoint(rect.right, rect.bottom),
    ].map(point => point.matrixTransform(screenToOverlay));
    const x = Math.min(...corners.map(point => point.x));
    const y = Math.min(...corners.map(point => point.y));
    return [{ x, y, width: Math.max(...corners.map(point => point.x)) - x,
      height: Math.max(...corners.map(point => point.y)) - y }];
  });
}
