import type { ScreenPoint, TradingDrawingModel, TradingDrawingToolId } from './trading-expert-drawing.ts';
import { manualDrawingDefaults } from './trading-drawing-defaults.ts';
import { harmonicFillColor, harmonicPatternPolygons, renderPatternLegs } from './trading-patterns.ts';

type AiStyleIdentity = { source?: string; strategyId?: string; colorToken?: string };

export function usesNativeAiDrawingStyle(drawing: AiStyleIdentity) {
  return drawing.source === 'ai'
    && !['price-action', 'wyckoff'].includes(drawing.strategyId ?? '')
    && !/^(price-action|wyckoff)-/.test(drawing.colorToken ?? '');
}

export function nativeAiDrawingDefaults(drawing: AiStyleIdentity & { tool: TradingDrawingToolId }) {
  let tool = drawing.tool;
  if (drawing.strategyId === 'harmonic' && ['path', 'text', 'rectangle'].includes(tool)) tool = 'xabcd';
  else if (['path', 'text'].includes(tool) && (drawing.strategyId === 'wave' || drawing.colorToken?.startsWith('wave-'))) tool = 'elliott-impulse';
  return manualDrawingDefaults(tool);
}

// Presentation-only copy: retain IDs, tool, points, text, semantic tokens and
// dashed/dotted status. Never persist this over the accepted DrawingPatch.
export function nativeAiDrawingDisplayModel(drawing: TradingDrawingModel): TradingDrawingModel {
  // Text annotations keep their original semantic colors and leader appearance.
  if (!usesNativeAiDrawingStyle(drawing) || drawing.tool === 'text' || drawing.tool === 'note') return drawing;
  const defaults = nativeAiDrawingDefaults(drawing);
  return { ...drawing, color: defaults.color, lineWidth: defaults.lineWidth };
}

export function isHiddenOrderFlowAnnotation(drawing: Pick<TradingDrawingModel, 'source' | 'tool' | 'colorToken'>) {
  // Suppress only the microstructure text and its leader, in every language.
  // Keep the underlying buy/sell arrows, imbalance regions and accepted patch.
  return drawing.source === 'ai' && (drawing.tool === 'note' || drawing.tool === 'text')
    && (drawing.colorToken === 'order-flow-buy' || drawing.colorToken === 'order-flow-sell');
}

export function renderNativeAiHarmonicPath(drawing: TradingDrawingModel, points: readonly ScreenPoint[]) {
  if (!usesNativeAiDrawingStyle(drawing) || drawing.strategyId !== 'harmonic' || drawing.tool !== 'path') return null;
  // Only existing structure legs get a fill; a projection remains a separate
  // dashed segment. Shark keeps 0-X-A-B-C, and Cypher keeps its own ratios.
  const structure = /-(?:xabcd|0xabc|xabc-developing|0xab-developing)$/.test(drawing.id);
  const fill = structure ? harmonicPatternPolygons(points).map((polygon, index) =>
    `<polygon data-harmonic-fill="${index === 0 ? 'XAB' : 'BCD'}" points="${polygon.map(p => `${p.x},${p.y}`).join(' ')}" fill="${harmonicFillColor(drawing)}" stroke="none"/>`).join('') : '';
  if (/-ratio-line-[a-z-]+$/.test(drawing.id)) {
    // Native harmonic measurement guides use fine dotted lines.
    return renderPatternLegs({ ...drawing, lineWidth: 1, lineStyle: 'dotted' }, points).replace('stroke-dasharray="2 4"', 'stroke-dasharray="1 3"');
  }
  return fill + renderPatternLegs(drawing, points);
}
