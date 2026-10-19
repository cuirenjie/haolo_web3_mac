import type { TradingDrawingModel } from './trading-expert-drawing.ts';

export const PLAIN_TEXT_FONT_SIZE = 20;
export const PLAIN_TEXT_COLOR = '#2962ff';
export const PLAIN_TEXT_FONT_FAMILY = 'Arial, "Microsoft YaHei", sans-serif';

export function annotationPrice(value: number) {
  const absolute = Math.abs(value);
  const precision = absolute >= 1_000 ? 2 : absolute >= 1 ? 3 : absolute >= .01 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function priceLabelGeometry(drawing: TradingDrawingModel, point: { x: number; y: number }) {
  const text = annotationPrice(drawing.points[0]?.price ?? 0);
  const layout = plainTextGeometry({ ...drawing, bold: drawing.bold ?? true }, point, text);
  return { ...layout, text, x: point.x + 12, y: point.y - layout.height - 24,
    width: layout.width + 16, height: layout.height + 8, baseline: layout.baseline + 4, padding: 12 };
}

export function isPlainTextDrawing(drawing: TradingDrawingModel) {
  return drawing.tool === 'text' && drawing.source !== 'ai';
}

export function isManualNote(drawing: TradingDrawingModel) {
  return drawing.tool === 'note' && drawing.source !== 'ai';
}

export function isManualPriceNote(drawing: TradingDrawingModel) {
  return drawing.tool === 'price-note' && drawing.source !== 'ai';
}

export function isPinNote(drawing: TradingDrawingModel) {
  return drawing.tool === 'pin-note' && drawing.source !== 'ai';
}

export function isCallout(drawing: TradingDrawingModel) {
  return drawing.tool === 'callout' && drawing.source !== 'ai';
}

export function isComment(drawing: TradingDrawingModel) {
  return drawing.tool === 'comment' && drawing.source !== 'ai';
}

export function isSignpost(drawing: TradingDrawingModel) {
  return drawing.tool === 'signpost' && drawing.source !== 'ai';
}

export function isAnnotationTable(drawing: TradingDrawingModel) {
  return drawing.tool === 'table' && drawing.source !== 'ai';
}

export function isInlineAnnotation(drawing: TradingDrawingModel) {
  return isPlainTextDrawing(drawing) || isManualNote(drawing) || isPinNote(drawing) || isCallout(drawing) || isComment(drawing) || isSignpost(drawing) || isAnnotationTable(drawing);
}

let measure: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

// Use the same font metrics for the SVG, click area and native editor. The
// chart anchor remains the text baseline, including for previously saved text.
export function plainTextGeometry(drawing: TradingDrawingModel, point: { x: number; y: number }, text: string) {
  const fontSize = drawing.fontSize ?? PLAIN_TEXT_FONT_SIZE;
  const lineHeight = fontSize * 1.3;
  const font = `${drawing.italic ? 'italic' : 'normal'} ${drawing.bold ? 700 : 400} ${fontSize}px ${PLAIN_TEXT_FONT_FAMILY}`;
  const lines = text.split('\n');
  if (measure === undefined && typeof document !== 'undefined') measure = document.createElement('canvas').getContext('2d');
  if (measure) measure.font = font;
  const metrics = measure?.measureText('Mg中文');
  const ascent = metrics?.fontBoundingBoxAscent ?? fontSize * .8;
  const descent = metrics?.fontBoundingBoxDescent ?? fontSize * .2;
  const lineWidths = lines.map(line => {
    const key = `${font}\n${line}`;
    let width = widths.get(key);
    if (width === undefined) {
      width = measure?.measureText(line).width ?? Array.from(line).reduce((sum, char) => sum + fontSize * (char.charCodeAt(0) > 255 ? 1 : .6), 0);
      if (widths.size >= 512) widths.clear();
      widths.set(key, width);
    }
    return width;
  });
  return {
    x: point.x - 4, y: point.y - fontSize - 3,
    width: Math.ceil(Math.max(12, ...lineWidths)) + 8,
    height: lines.length * lineHeight + 4,
    font, fontSize, lineHeight, lines,
    baseline: 2 + (lineHeight - ascent - descent) / 2 + ascent,
    padding: 4,
  };
}

export function annotationTextGeometry(drawing: TradingDrawingModel, points: { x: number; y: number }[], text: string) {
  const point = points.at(-1)!;
  const price = isManualPriceNote(drawing);
  const geometry = plainTextGeometry(price ? { ...drawing, fontSize: drawing.fontSize ?? 16, bold: drawing.bold ?? true } : drawing, point, text);
  if (isPinNote(drawing)) {
    return { ...geometry, x: point.x - 140, y: point.y - 64 - geometry.height,
      width: Math.max(280, geometry.width + 24), height: geometry.height + 20,
      baseline: geometry.baseline + 10, padding: 16 };
  }
  if (isCallout(drawing) || isComment(drawing)) {
    const width = Math.max(64, geometry.width + 24), height = geometry.height + 16;
    return { ...geometry, x: isComment(drawing) ? point.x : point.x - width / 2,
      y: isComment(drawing) ? point.y - height : point.y - height / 2,
      width, height, baseline: geometry.baseline + 8, padding: 16 };
  }
  if (isSignpost(drawing)) {
    const width = geometry.width + 16, height = geometry.height + 8;
    return { ...geometry, x: point.x - width / 2, y: point.y - height,
      width, height, baseline: geometry.baseline + 4, padding: 12 };
  }
  if (!isManualNote(drawing) && !price) return geometry;
  const height = geometry.height + 8;
  return { ...geometry, x: point.x, y: point.y - height / 2,
    width: geometry.width + 12, height, baseline: geometry.baseline + 4, padding: 10 };
}

export function calloutPath(box: { x: number; y: number; width: number; height: number }, anchor: { x: number; y: number }) {
  const { x, y, width: w, height: h } = box, r = 10;
  const left = anchor.x < x + w / 2, top = anchor.y < y + h / 2;
  const tail = `L ${anchor.x} ${anchor.y}`;
  const outside = anchor.x < x || anchor.x > x + w || anchor.y < y || anchor.y > y + h;
  return `M ${x+r} ${y} H ${x+w-r} ${outside && !left && top ? tail : `Q ${x+w} ${y}`} ${x+w} ${y+r}`
    + ` V ${y+h-r} ${outside && !left && !top ? tail : `Q ${x+w} ${y+h}`} ${x+w-r} ${y+h}`
    + ` H ${x+r} ${outside && left && !top ? tail : `Q ${x} ${y+h}`} ${x} ${y+h-r}`
    + ` V ${y+r} ${outside && left && top ? tail : `Q ${x} ${y}`} ${x+r} ${y} Z`;
}
