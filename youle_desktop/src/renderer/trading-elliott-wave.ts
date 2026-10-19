import type { ScreenPoint, TradingDrawingModel } from './trading-expert-drawing.ts';
import { manualDrawingDefaults } from './trading-drawing-defaults.ts';

// These are manual annotations: never infer pivots, enforce price rules, or
// manufacture a complete wave from its first and last points.
const labels = {
  'elliott-impulse': ['0', '1', '2', '3', '4', '5'],
  'elliott-correction': ['0', 'A', 'B', 'C'],
  'elliott-triangle': ['0', 'A', 'B', 'C', 'D', 'E'],
  'elliott-double-combo': ['0', 'W', 'X', 'Y'],
  'elliott-triple-combo': ['0', 'W', 'X', 'Y', 'X', 'Z'],
} as const;
export type ElliottWaveTool = keyof typeof labels;
export const ELLIOTT_FONT_SIZE = 20;
export const ELLIOTT_HANDLE_COLOR = '#2962ff';
export function isElliottWave(tool: string): tool is ElliottWaveTool {
  return Object.hasOwn(labels, tool);
}
export function elliottWaveLabels(tool: ElliottWaveTool): readonly string[] { return labels[tool]; }

export function renderElliottWave(
  drawing: TradingDrawingModel,
  projected: readonly ScreenPoint[],
  state: { draft: boolean; selected: boolean; confirmedPointCount: number },
) {
  if (!isElliottWave(drawing.tool)) return { body: '', hit: '' };
  const names = labels[drawing.tool];
  const confirmed = Math.max(0, Math.min(state.confirmedPointCount, names.length));
  const points = projected.slice(0, state.draft ? Math.min(confirmed + 1, names.length) : names.length);
  if (!points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { body: '', hit: '' };
  const defaults = manualDrawingDefaults(drawing.tool);
  const color = drawing.color ?? defaults.color;
  const fontSize = drawing.fontSize ?? ELLIOTT_FONT_SIZE;
  const width = drawing.lineWidth ?? defaults.lineWidth;
  const dash = drawing.lineStyle === 'dashed' ? '8 5' : drawing.lineStyle === 'dotted' ? '2 4' : '';
  const attrs = points.map(p => `${p.x},${p.y}`).join(' ');
  let body = points.length > 1
    ? `<polyline data-elliott-legs points="${attrs}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : '';
  let hit = points.slice(1).map((p, i) => `<line class="trading-drawing-hit-target" x1="${points[i].x}" y1="${points[i].y}" x2="${p.x}" y2="${p.y}"/>`).join('');
  body += points.map((point, index) => {
    // The cursor draws a rubber-band segment, not a confirmed label/handle.
    // (0) is an editing aid and disappears when the finished wave is deselected.
    if (state.draft && index >= confirmed || index === 0 && !state.draft && !state.selected) return '';
    const previous = points[index - 1];
    const next = points[index + 1];
    const neighbors = [previous, next].filter((p): p is ScreenPoint => Boolean(p && Math.abs(p.y - point.y) > .5));
    const averageY = neighbors.length ? neighbors.reduce((sum, p) => sum + p.y, 0) / neighbors.length : point.y;
    const below = point.y === averageY ? index % 2 === 0 : point.y > averageY;
    const y = point.y + (below ? 1 : -1) * (fontSize / 2 + 12);
    const text = `(${names[index]})`;
    const boxWidth = text.length * fontSize * .65 + 8, boxHeight = fontSize + 6;
    hit += `<rect class="trading-drawing-hit-target area" data-elliott-label-hit="${index}" x="${point.x - boxWidth / 2}" y="${y - boxHeight / 2}" width="${boxWidth}" height="${boxHeight}"/>`;
    return `<text data-elliott-label="${index}" data-i18n-skip x="${point.x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="${drawing.textColor ?? color}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${drawing.bold ? 700 : 400}"${drawing.italic ? ' font-style="italic"' : ''}>${text}</text>`;
  }).join('');
  return { body, hit };
}
