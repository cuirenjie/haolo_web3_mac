// Retain the live SVG tree. Replacing a complete drawing layer on pointermove
// invalidates hit targets, accessibility/localization observers and SVG layout.
type Attributes = { literals: string[]; names: string[]; values: string[] };
export type TradingDrawingSegment = { key: string; x1: number; y1: number; x2: number; y2: number };
type DrawingEntry = { id: string; markup?: string; segment?: TradingDrawingSegment; render?: () => string };
function attributes(markup: string): Attributes {
  const names: string[] = [], values: string[] = [], literals: string[] = [];
  let cursor = 0;
  // Only double-quoted SVG attributes emitted by our renderer participate.
  // Text, element names, attribute order and all other syntax stay in shape.
  for (const match of markup.matchAll(/\s([^\s"'<>/=]+)="([^"]*)"/g)) {
    const start = match.index + match[0].length - match[2].length - 1;
    literals.push(markup.slice(cursor, start));
    names.push(match[1]); values.push(match[2]); cursor = start + match[2].length;
  }
  literals.push(markup.slice(cursor));
  return { literals, names, values };
}

function templateValues(markup: string, template: Attributes) {
  const values: string[] = [];
  let cursor = 0;
  for (let index = 0; index < template.names.length; index++) {
    const literal = template.literals[index];
    if (!markup.startsWith(literal, cursor)) return null;
    cursor += literal.length;
    const end = markup.indexOf('"', cursor);
    if (end < 0) return null;
    values.push(markup.slice(cursor, end)); cursor = end;
  }
  return markup.slice(cursor) === template.literals.at(-1) ? values : null;
}

function bindAttributes(node: Element, template: Attributes) {
  const bindings = [node, ...node.querySelectorAll('*')].flatMap(element =>
    Array.from(element.attributes, attribute => ({ element, name: attribute.name })));
  return bindings.length === template.names.length && bindings.every((binding, i) => binding.name === template.names[i])
    ? bindings : null;
}

function translationAxes(node: Element, bindings: ReturnType<typeof bindAttributes>) {
  if (!bindings) return null;
  const elements = [node, ...node.querySelectorAll('*')];
  // Only explicit straight segments can be translated without changing text,
  // handles, arrowheads or viewport-anchored geometry. Clipped endpoints are
  // checked numerically below and fall back when they move by different deltas.
  if (!elements.some(element => element.localName === 'line') || elements.some(element =>
    !['g', 'line'].includes(element.localName) || element.hasAttribute('transform')
    || (element.localName === 'line' && ['x1','x2','y1','y2'].some(name => !element.hasAttribute(name))))) return null;
  return bindings.map(({element,name}) => element.localName === 'line'
    ? name === 'x1' || name === 'x2' ? 'x' : name === 'y1' || name === 'y2' ? 'y' : null : null);
}

function translationDelta(axes: ReturnType<typeof translationAxes>, previous: string[], values: string[]) {
  if (!axes) return null;
  const delta: { x?: number; y?: number } = {};
  for (let i = 0; i < values.length; i++) {
    const axis = axes[i];
    if (!axis) { if (values[i] !== previous[i]) return null; continue; }
    const offset = Number(values[i]) - Number(previous[i]);
    if (!Number.isFinite(offset)) return null;
    if (delta[axis] === undefined) delta[axis] = offset;
    else if (Math.abs(delta[axis]! - offset) > 1e-7) return null;
  }
  return delta.x === undefined || delta.y === undefined ? null : { x: delta.x, y: delta.y };
}

function patchNode(current: Node, next: Node): Node {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.parentNode!.replaceChild(next, current);
    return next;
  }
  if (current.nodeType === 1) {
    const element = current as Element, source = next as Element;
    for (const attribute of Array.from(element.attributes)) {
      if (!source.hasAttribute(attribute.name)) element.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(source.attributes)) {
      if (element.getAttribute(attribute.name) !== attribute.value) element.setAttribute(attribute.name, attribute.value);
    }
    let child = current.firstChild;
    for (const incoming of Array.from(next.childNodes)) {
      if (!child) current.appendChild(incoming);
      else {
        const following = child.nextSibling;
        patchNode(child, incoming);
        child = following;
      }
    }
    while (child) { const following = child.nextSibling; current.removeChild(child); child = following; }
  } else if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
  return current;
}

export class TradingDrawingLayer {
  private readonly groups = new Map<string, {
    markup: string | null; node: Element; template: Attributes; bindings: ReturnType<typeof bindAttributes>;
    axes: ReturnType<typeof translationAxes>; translation: { x: number; y: number } | null;
    segment?: TradingDrawingSegment;
  }>();
  private readonly parser: SVGGElement;
  private readonly root: SVGGElement;
  private viewportTransform: { sx: number; sy: number; x: number; y: number } | null = null;
  private order: string[] = [];

  constructor(root: SVGGElement) {
    this.root = root;
    this.parser = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
  }

  update(id: string, markup: string) {
    this.rebaseViewport();
    const previous = this.groups.get(id);
    if (previous?.markup === markup) return;
    if (previous) previous.segment = undefined;
    if (!markup) {
      previous?.node.remove(); this.groups.delete(id); return;
    }
    const values = previous?.bindings ? templateValues(markup, previous.template) : null;
    if (previous?.bindings && values
      && values.every((value, i) => value === previous.template.values[i] || !value.includes('&'))) {
      const delta = translationDelta(previous.axes, previous.template.values, values);
      if (delta) {
        const x = (previous.translation?.x ?? 0) + delta.x, y = (previous.translation?.y ?? 0) + delta.y;
        previous.node.setAttribute('transform', `translate(${x} ${y})`);
        previous.translation = { x, y };
        previous.markup = markup; previous.template.values = values;
        return;
      }
      const rebase = previous.translation !== null;
      if (rebase) { previous.node.removeAttribute('transform'); previous.translation = null; }
      // Panning/zooming changes coordinates, not SVG structure. Update those
      // attributes directly without parsing another tree or retiring targets.
      values.forEach((value, i) => {
        if (rebase || value !== previous.template.values[i]) {
          const { element, name } = previous.bindings![i];
          element.setAttribute(name, value);
        }
      });
      previous.markup = markup; previous.template.values = values;
      return;
    }
    this.parser.innerHTML = markup;
    const incoming = this.parser.firstElementChild;
    if (!incoming) return;
    const node = previous ? patchNode(previous.node, incoming) as Element : incoming;
    if (!previous) this.root.appendChild(node);
    const template = attributes(markup);
    const bindings = bindAttributes(node, template);
    this.groups.set(id, { markup, node, template, bindings, axes: translationAxes(node, bindings), translation: null });
  }

  private rebaseViewport() {
    if (!this.viewportTransform) return;
    this.root.removeAttribute('transform');
    this.viewportTransform = null;
    for (const group of this.groups.values()) {
      if (!group.segment || !group.bindings) continue;
      group.node.removeAttribute('transform');
      group.translation = null;
      for (let i = 0; i < group.bindings.length; i++) {
        const {element,name} = group.bindings[i];
        if (name === 'x1' || name === 'x2' || name === 'y1' || name === 'y2') {
          const value = String(group.segment[name]);
          element.setAttribute(name, value); group.template.values[i] = value;
        }
      }
      group.markup = null;
    }
  }

  private transformViewport(entries: readonly DrawingEntry[]) {
    if (!entries.length || entries.length !== this.order.length
      || (!this.viewportTransform && this.root.hasAttribute('transform'))) return false;
    const first = entries[0].segment, before = this.groups.get(entries[0].id)?.segment;
    if (!first || !before || Math.abs(before.x2 - before.x1) < 1e-8 || Math.abs(before.y2 - before.y1) < 1e-8) return false;
    const sx = (first.x2 - first.x1) / (before.x2 - before.x1), sy = (first.y2 - first.y1) / (before.y2 - before.y1);
    const x = first.x1 - sx * before.x1, y = first.y1 - sy * before.y1;
    if (![sx,sy,x,y].every(Number.isFinite) || sx <= 0 || sy <= 0) return false;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], segment = entry.segment, previous = this.groups.get(entry.id)?.segment;
      if (entry.id !== this.order[i] || !segment || !previous || segment.key !== previous.key
        || Math.abs(segment.x1 - (previous.x1 * sx + x)) > 1e-7
        || Math.abs(segment.x2 - (previous.x2 * sx + x)) > 1e-7
        || Math.abs(segment.y1 - (previous.y1 * sy + y)) > 1e-7
        || Math.abs(segment.y2 - (previous.y2 * sy + y)) > 1e-7) return false;
    }
    if (Math.abs(sx - 1) > 1e-12 || Math.abs(sy - 1) > 1e-12 || Math.abs(x) > 1e-9 || Math.abs(y) > 1e-9) {
      const old = this.viewportTransform ?? { sx: 1, sy: 1, x: 0, y: 0 };
      const next = { sx: sx * old.sx, sy: sy * old.sy, x: sx * old.x + x, y: sy * old.y + y };
      this.root.setAttribute('transform', `matrix(${next.sx} 0 0 ${next.sy} ${next.x} ${next.y})`);
      this.viewportTransform = next;
    }
    for (const entry of entries) this.groups.get(entry.id)!.segment = entry.segment;
    return true;
  }

  private updateSegment(id: string, segment: TradingDrawingSegment) {
    const previous = this.groups.get(id);
    const last = previous?.segment;
    if (!previous?.bindings || !last || last.key !== segment.key) return false;
    const dx = segment.x1 - last.x1, dy = segment.y1 - last.y1;
    if (Math.abs(segment.x2 - last.x2 - dx) < 1e-7 && Math.abs(segment.y2 - last.y2 - dy) < 1e-7) {
      if (dx || dy) {
        const x = (previous.translation?.x ?? 0) + dx, y = (previous.translation?.y ?? 0) + dy;
        previous.node.setAttribute('transform', `translate(${x} ${y})`);
        previous.translation = { x, y };
      }
    } else {
      if (previous.translation) previous.node.removeAttribute('transform');
      for (const { element, name } of previous.bindings) {
        if (name === 'x1' || name === 'x2' || name === 'y1' || name === 'y2') element.setAttribute(name, String(segment[name]));
      }
      previous.translation = null;
    }
    for (let i = 0; i < previous.bindings.length; i++) {
      const name = previous.bindings[i].name;
      if (name === 'x1' || name === 'x2' || name === 'y1' || name === 'y2') previous.template.values[i] = String(segment[name]);
    }
    // The canonical markup is deliberately lazy; subsequent selected/style
    // renders reconcile against the updated attribute values, not stale text.
    previous.markup = null;
    previous.segment = segment;
    return true;
  }

  render(entries: readonly DrawingEntry[]) {
    // Explicit straight segments have non-scaling visual AND hit strokes. If
    // every endpoint follows the same affine viewport change, one parent
    // transform replaces hundreds of SVG mutations. Clipping, selection,
    // styles, ordering and mixed geometry fail this check and rebase exactly.
    if (this.transformViewport(entries)) return;
    this.rebaseViewport();
    const retained = new Set(entries.map(entry => entry.id));
    for (const [id, group] of this.groups) {
      if (!retained.has(id)) { group.node.remove(); this.groups.delete(id); }
    }
    for (const { id, markup, segment, render } of entries) {
      if (segment && this.updateSegment(id, segment)) continue;
      this.update(id, markup ?? render?.() ?? '');
      const group = this.groups.get(id);
      if (group) {
        // Compile only explicit, identical straight segments. Circles, text,
        // arrows, selected handles and clipped/missing hit targets use markup.
        group.segment = segment && group.axes && group.bindings?.every(({element,name}) =>
          !['x1','x2','y1','y2'].includes(name) || (Number(element.getAttribute(name)) === segment[name as 'x1']
            && (element.getAttribute('vector-effect') === 'non-scaling-stroke' || element.classList.contains('trading-drawing-hit-target'))))
          ? segment : undefined;
      }
    }
    let cursor = this.root.firstElementChild;
    for (const { id } of entries) {
      const node = this.groups.get(id)?.node;
      if (!node) continue;
      if (node !== cursor) this.root.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
    }
    this.order = entries.map(entry => entry.id);
  }
}
