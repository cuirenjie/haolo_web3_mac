import type { TradingDrawingToolId, TradingDrawingLineStyle } from './trading-expert-drawing.ts';

// TradingView's documented drawing defaults, checked 2026-10-17. The supplied
// desktop screenshot also confirms Trendline #2962FF / solid / 2 CSS px.
// https://www.tradingview.com/charting-library-docs/latest/customization/overrides/Drawings-Overrides/
// Tool-specific interfaces are linked in docs/drawing-toolbar-reference-20261017.zh-CN.md.
export const DRAWING_SELECTION_COLOR = '#2962ff';
export interface ManualDrawingDefaults {
  color: string;
  lineWidth: number;
  lineStyle: TradingDrawingLineStyle;
  opacity: number;
  fillOpacity: number;
}
const line: Readonly<ManualDrawingDefaults> = Object.freeze({
  color: '#2962ff', lineWidth: 2, lineStyle: 'solid', opacity: 1, fillOpacity: 0,
});
const profiles: Partial<Record<TradingDrawingToolId, Partial<ManualDrawingDefaults>>> = {
  'regression-trend': { color: '#2962ff', lineWidth: 1, opacity: .3 },
  'parallel-channel': { fillOpacity: .2 },
  'flat-top-bottom': { color: '#ff9800', fillOpacity: .2 },
  'disjoint-channel': { color: '#089981', fillOpacity: .2 },
  'pitchfork': { color: '#f23645', fillOpacity: .2 },
  'schiff-pitchfork': { color: '#f23645', fillOpacity: .2 },
  'modified-schiff-pitchfork': { color: '#f23645', fillOpacity: .2 },
  'inside-pitchfork': { color: '#f23645', fillOpacity: .2 },
  'pitchfan': { color: '#f23645', fillOpacity: .2 },
  'gann-box': { color: '#153899', opacity: .8 },
  'gann-square': { color: '#808080' },
  'gann-square-fixed': { color: '#808080' },
  'gann-fan': { color: '#00bcd4', fillOpacity: .2 },
  'fib-retracement': { color: '#808080', fillOpacity: .2 },
  'fib-trend-extension': { color: '#808080', fillOpacity: .2 },
  'fib-channel': { color: '#808080', fillOpacity: .2 },
  'fib-time-zone': { color: '#808080' },
  'fib-trend-time': { color: '#808080', fillOpacity: .2 },
  'fib-speed-fan': { color: '#808080', fillOpacity: .2 },
  'fib-circles': { color: '#808080', fillOpacity: .2 },
  'fib-speed-arcs': { color: '#808080', fillOpacity: .2 },
  'fib-wedge': { color: '#808080', fillOpacity: .2 },
  'brush': { color: '#00bcd4' },
  'highlighter': { color: '#f23645', lineWidth: 20, opacity: .2 },
  'rectangle': { color: '#9c27b0', fillOpacity: .2 },
  'rotated-rectangle': { color: '#4caf50', fillOpacity: .2 },
  'circle': { color: '#ff9800', fillOpacity: .2 },
  'ellipse': { color: '#f23645', fillOpacity: .2 },
  'triangle': { color: '#089981', fillOpacity: .2 },
  'arc': { color: '#e91e63', fillOpacity: .2 },
  'double-curve': { color: '#673ab7' },
  'multi-point-polyline': { color: '#00bcd4', fillOpacity: .2 },
  // Haolo-only freehand path and preset polyline retain their behavior; use
  // the corresponding brush/polyline appearance, without remapping tool IDs.
  'path': { color: '#00bcd4' },
  'polyline': { color: '#00bcd4' },
  'xabcd': { fillOpacity: .15 },
  'cypher': { fillOpacity: .15 },
  'abcd': { color: '#089981' },
  'head-shoulders': { color: '#089981', fillOpacity: .15 },
  'triangle-pattern': { color: '#673ab7', fillOpacity: .15 },
  'three-drives': { color: '#673ab7', fillOpacity: .5 },
  'elliott-impulse': { color: '#3d85c6' },
  'elliott-correction': { color: '#3d85c6' },
  'elliott-triangle': { color: '#ff9800' },
  'elliott-double-combo': { color: '#6aa84f' },
  'elliott-triple-combo': { color: '#6aa84f' },
  'time-cycles': { color: '#159980', fillOpacity: .5 },
  'sine-line': { color: '#159980' },
  'long-position': { color: '#808080', lineWidth: 1, fillOpacity: .2 },
  'short-position': { color: '#808080', lineWidth: 1, fillOpacity: .2 },
  'date-range': { fillOpacity: .4 },
  'price-range': { fillOpacity: .4 },
  'date-price-range': { fillOpacity: .4 },
  'anchored-vwap': { color: '#1e88e5', lineWidth: 1 },
  'arrow-marker': { color: '#1e53e5' },
  'arrow-up': { color: '#089981' },
  'arrow-down': { color: '#cc2f3c' },
};
export function manualDrawingDefaults(tool: TradingDrawingToolId): Readonly<ManualDrawingDefaults> {
  return { ...line, ...profiles[tool] };
}

// Default retracement palette, shared with the existing rendered levels.
// Explicit user colors always override these colors.
export function manualFibLevelColor(ratio: number): string {
  return ({ 0: '#808080', .236: '#f23645', .382: '#ff9800', .5: '#4caf50',
    .618: '#089981', .786: '#00bcd4', 1: '#808080', 1.618: '#2962ff',
    2.618: '#f23645', 3.618: '#9c27b0', 4.236: '#e91e63' } as Record<number, string>)[ratio] ?? '#2962ff';
}
