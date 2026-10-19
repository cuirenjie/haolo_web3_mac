type Point = { x: number; y: number };
type StrokeAnchor = { point: Point; angle: number; distance: number; color: string };
const promptSelector = '[data-horizontal-line-add-text]';
const geometrySelector = '.trading-drawing-geometry :is(line,polyline,polygon,rect,circle,ellipse,path)[stroke]';

function segmentDistance(pointer: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(pointer.x - a.x - t * dx, pointer.y - a.y - t * dy);
}

function visibleSegment(a: Point, b: Point, bounds: DOMRect): [Point, Point] | null {
  let start = 0, end = 1;
  for (const [origin, delta, low, high] of [[a.x, b.x-a.x, bounds.left, bounds.right], [a.y, b.y-a.y, bounds.top, bounds.bottom]]) {
    if (Math.abs(delta) < 1e-8) { if (origin < low || origin > high) return null; continue; }
    const t1 = (low-origin)/delta, t2 = (high-origin)/delta;
    start = Math.max(start, Math.min(t1, t2)); end = Math.min(end, Math.max(t1, t2));
  }
  return start > end ? null : [
    { x: a.x + (b.x-a.x)*start, y: a.y + (b.y-a.y)*start },
    { x: a.x + (b.x-a.x)*end, y: a.y + (b.y-a.y)*end },
  ];
}

// Inspect the rendered strokes, so every derived channel/Fib/Gann line and
// every polygon edge uses the same geometry and color as the visible drawing.
export function drawingHoverStroke(group: Element, pointer: Point, bounds: DOMRect): StrokeAnchor | null {
  let nearest: StrokeAnchor | null = null;
  let nearestPriority = -1;
  const geometries = group.querySelectorAll<SVGGeometryElement>(geometrySelector);
  for (const element of geometries) {
    const style = getComputedStyle(element);
    if (style.stroke === 'none' || style.stroke === 'transparent' || +style.opacity === 0 || style.visibility === 'hidden') continue;
    const matrix = element.getScreenCTM();
    if (!matrix) continue;
    const project = (p: Point) => new DOMPoint(p.x, p.y).matrixTransform(matrix);
    const tolerance = Math.max(7, (Number.parseFloat(style.strokeWidth) || 0) / 2 + 2);
    const consider = (a: Point, b: Point, at?: Point) => {
      const span = visibleSegment(a, b, bounds);
      if (!span) return;
      const distance = segmentDistance(pointer, ...span);
      // At Fib connector intersections, keep the horizontal level's action.
      const priority = element.classList.contains('trading-fibonacci-level-line') && distance <= 3 ? 1 : 0;
      if (distance > tolerance || priority < nearestPriority || nearest && priority === nearestPriority && distance >= nearest.distance) return;
      let angle = Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      nearest = { distance, angle, color: style.stroke, point: at ?? { x: (span[0].x+span[1].x)/2, y: (span[0].y+span[1].y)/2 } };
      nearestPriority = priority;
    };
    if (element instanceof SVGLineElement) {
      consider(project({ x: element.x1.baseVal.value, y: element.y1.baseVal.value }), project({ x: element.x2.baseVal.value, y: element.y2.baseVal.value }));
    } else if (element instanceof SVGPolylineElement || element instanceof SVGPolygonElement || element instanceof SVGRectElement) {
      const vertices: Point[] = element instanceof SVGRectElement
        ? (() => { const x=element.x.baseVal.value, y=element.y.baseVal.value, w=element.width.baseVal.value, h=element.height.baseVal.value;
          return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]; })()
        : Array.from({ length: element.points.numberOfItems }, (_, i) => element.points.getItem(i));
      if (!(element instanceof SVGPolylineElement) && vertices.length) vertices.push(vertices[0]);
      for (let i=1; i<vertices.length; i++) consider(project(vertices[i-1]), project(vertices[i]));
    } else {
      const length = element.getTotalLength();
      if (!(length > 0 && Number.isFinite(length))) continue;
      // Bounded sampling followed by local refinement keeps curved/freehand
      // targets accurate without unbounded work on high-frequency pointer input.
      const samples = Math.min(128, Math.max(16, Math.ceil(length/12)));
      let bestLength = 0, bestDistance = Infinity;
      for (let i=0; i<=samples; i++) {
        const p = project(element.getPointAtLength(length*i/samples));
        const distance = Math.hypot(p.x-pointer.x, p.y-pointer.y);
        if (distance < bestDistance) { bestDistance=distance; bestLength=length*i/samples; }
      }
      let step = length/samples;
      for (let i=0; i<8; i++) {
        for (const t of [Math.max(0,bestLength-step), Math.min(length,bestLength+step)]) {
          const p=project(element.getPointAtLength(t)), distance=Math.hypot(p.x-pointer.x,p.y-pointer.y);
          if (distance < bestDistance) { bestDistance=distance; bestLength=t; }
        }
        step /= 2;
      }
      const at=project(element.getPointAtLength(bestLength));
      consider(project(element.getPointAtLength(Math.max(0,bestLength-2))), project(element.getPointAtLength(Math.min(length,bestLength+2))), at);
    }
  }
  // Point annotations (arrows, flags, signposts) have a glyph instead of a
  // stroked path. Keep their existing text entry on the visible glyph itself.
  if (!geometries.length) {
    const glyph = group.querySelector<SVGGraphicsElement>('.trading-drawing-geometry :is(text,path,polygon)[fill]');
    if (glyph) {
      const box = glyph.getBoundingClientRect();
      if (pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom)
        return { point: { x: (box.left+box.right)/2, y: (box.top+box.bottom)/2 }, angle: 0, distance: 0, color: getComputedStyle(glyph).fill };
    }
  }
  return nearest;
}

export class TradingDrawingHoverText {
  private pointer: Point | null = null;
  private active: SVGGElement | null = null;
  private frame: number | null = null;
  private invalidated = false;
  private destroyed = false;
  private readonly overlay: SVGSVGElement;
  private readonly content: SVGGElement;
  private readonly enabled: () => boolean;
  constructor(overlay: SVGSVGElement, content: SVGGElement, enabled: () => boolean) {
    this.overlay = overlay; this.content = content; this.enabled = enabled;
    document.addEventListener('pointermove', this.move);
    document.addEventListener('pointerout', this.leave);
    window.addEventListener('blur', this.reset);
  }
  private clear() {
    this.active?.removeAttribute('data-line-hover');
    this.active = null;
  }
  private readonly reset = () => { this.pointer = null; this.clear(); };
  private readonly leave = (event: PointerEvent) => { if (!event.relatedTarget) this.reset(); };
  private readonly move = (event: PointerEvent) => {
    if (event.pointerType === 'touch') { this.reset(); return; }
    this.pointer = { x: event.clientX, y: event.clientY };
    this.queue();
  };
  private queue() {
    if (this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
  }
  refresh() { this.invalidated = true; if (this.pointer) this.queue(); }
  private update() {
    const invalidated = this.invalidated; this.invalidated = false;
    if (!this.pointer || !this.enabled()) { this.clear(); return; }
    const target = document.elementFromPoint(this.pointer.x, this.pointer.y);
    if (!target || !this.content.contains(target)) { this.clear(); return; }
    const group = target.closest<SVGGElement>('[data-drawing-id]');
    const prompt = group?.querySelector<SVGGElement>(promptSelector);
    if (!group || !prompt) { this.clear(); return; }
    // Moving from a stroke into its action must not move the action away.
    if (prompt === this.active && prompt.contains(target) && !invalidated) return;
    const stroke = drawingHoverStroke(group, this.pointer, this.overlay.getBoundingClientRect());
    const matrix = prompt.parentNode instanceof SVGGraphicsElement ? prompt.parentNode.getScreenCTM() : null;
    if (!stroke || !matrix) { this.clear(); return; }
    const local = new DOMPoint(stroke.point.x, stroke.point.y).matrixTransform(matrix.inverse());
    if (prompt !== this.active) this.clear();
    this.active = prompt;
    prompt.setAttribute('transform', `translate(${local.x} ${local.y}) rotate(${stroke.angle})`);
    prompt.style.color = stroke.color;
    prompt.setAttribute('data-line-hover', 'true');
  }
  destroy() {
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.reset();
    document.removeEventListener('pointermove', this.move);
    document.removeEventListener('pointerout', this.leave);
    window.removeEventListener('blur', this.reset);
  }
}
