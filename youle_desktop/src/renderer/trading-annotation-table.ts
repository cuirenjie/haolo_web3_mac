import type { TradingDrawingModel } from './trading-expert-drawing.ts';

export type TableCell = { row: number; column: number };
export function annotationTableCells(text = ''): string[][] {
  const rows = text.split('\n').slice(0, 12).map(row => row.split(/[|\t]/).slice(0, 6));
  const columns = Math.max(3, ...rows.map(row => row.length));
  return Array.from({ length: Math.max(3, rows.length) }, (_, r) =>
    Array.from({ length: columns }, (_, c) => rows[r]?.[c] ?? ''));
}
export function updateAnnotationTableCell(text: string, cell: TableCell, value: string) {
  const rows = annotationTableCells(text);
  // The persisted format already uses pipes and newlines as cell separators.
  rows[cell.row][cell.column] = value.replace(/[|\t\r\n]/g, ' ');
  return rows.map(row => row.join('|')).join('\n');
}
export function annotationTableGeometry(drawing: TradingDrawingModel, points: { x: number; y: number }[]) {
  const first = points[0], second = points[1] ?? { x: first.x + 540, y: first.y + 144 };
  const rows = annotationTableCells(drawing.text);
  return { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y),
    width: Math.max(36, Math.abs(second.x - first.x)), height: Math.max(24, Math.abs(second.y - first.y)),
    rows, columns: rows[0].length };
}
export function annotationTableCellAt(drawing: TradingDrawingModel, points: { x: number; y: number }[], point: { x: number; y: number }): TableCell {
  const box = annotationTableGeometry(drawing, points);
  return { row: Math.max(0, Math.min(box.rows.length - 1, Math.floor((point.y - box.y) / (box.height / box.rows.length)))),
    column: Math.max(0, Math.min(box.columns - 1, Math.floor((point.x - box.x) / (box.width / box.columns)))) };
}
