import type { TradingDrawingModel } from './trading-expert-drawing.ts';

/** Adapt the accepted strategy path to the existing candle drawing tools.
 * Keep this presentation-only: persisted patches, anchors and entry bindings
 * must remain unchanged. The preset `polyline` tool invents intermediate points,
 * so measured structures and sampled cup curves use the true multi-point tool.
 */
export function chartPatternNativeDrawingModel(drawing: TradingDrawingModel): TradingDrawingModel {
  if (drawing.source !== 'ai' || drawing.strategyId !== 'chart-patterns' || drawing.tool !== 'path') return drawing;
  if (drawing.points.length < 2) return drawing;
  return { ...drawing, tool: drawing.points.length === 2 ? 'trend-line' : 'multi-point-polyline' };
}
