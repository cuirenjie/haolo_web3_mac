import type { ScreenPoint } from './trading-expert-drawing.ts';

export function rotatedRectangleGeometry(first: ScreenPoint, second: ScreenPoint, widthPoint?: ScreenPoint) {
  const dx = second.x - first.x, dy = second.y - first.y;
  const length = Math.hypot(dx, dy);
  const axis = length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const normal = { x: -axis.y, y: axis.x };
  // Two-anchor drawings retain their previous appearance until edited.
  const halfWidth = widthPoint
    ? Math.abs((widthPoint.x - second.x) * normal.x + (widthPoint.y - second.y) * normal.y)
    : Math.max(16, Math.min(length * .18, 50));
  const offset = (point: ScreenPoint, side: number) => ({
    x: point.x + normal.x * halfWidth * side,
    y: point.y + normal.y * halfWidth * side,
  });
  const corners = [offset(first, -1), offset(second, -1), offset(second, 1), offset(first, 1)];
  return { axis, normal, length, halfWidth, corners, handles: [first, second, ...corners] };
}

export function rotatedRectangleWidthPoint(first: ScreenPoint, second: ScreenPoint, pointer: ScreenPoint): ScreenPoint {
  const { normal, halfWidth } = rotatedRectangleGeometry(first, second, pointer);
  return { x: second.x + normal.x * halfWidth, y: second.y + normal.y * halfWidth };
}

// End midpoints rotate/extend the axis while preserving width. Corners resize
// along that axis and symmetrically across it, with the opposite end fixed.
export function moveRotatedRectangleHandle(points: ScreenPoint[], index: number, pointer: ScreenPoint): ScreenPoint[] {
  if (points.length < 2 || index < 0 || index > 5) return points;
  const geometry = rotatedRectangleGeometry(points[0], points[1], points[2]);
  const next = [{ ...points[0] }, { ...points[1] }];
  let halfWidth = geometry.halfWidth;
  if (index < 2) next[index] = { ...pointer };
  else {
    const end = index === 2 || index === 5 ? 0 : 1;
    const anchor = points[end];
    const distance = (pointer.x - anchor.x) * geometry.axis.x + (pointer.y - anchor.y) * geometry.axis.y;
    next[end] = { x: anchor.x + geometry.axis.x * distance, y: anchor.y + geometry.axis.y * distance };
    halfWidth = Math.abs((pointer.x - anchor.x) * geometry.normal.x + (pointer.y - anchor.y) * geometry.normal.y);
  }
  if (Math.hypot(next[1].x - next[0].x, next[1].y - next[0].y) < 3 || halfWidth < 1) return points;
  const { normal } = rotatedRectangleGeometry(next[0], next[1]);
  return [...next, { x: next[1].x + normal.x * halfWidth, y: next[1].y + normal.y * halfWidth }];
}
