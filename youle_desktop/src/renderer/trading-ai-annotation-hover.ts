type Point = { x: number; y: number };
const triggerSelector = '[data-ai-text-size-trigger]';
const deleteSelector = '[data-ai-annotation-delete]';
const contains = (box: DOMRect, point: Point) => box.width > 0 && box.height > 0
  && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;

/** Observe label geometry without intercepting the chart's native pointer/wheel
 * gestures. Only the revealed delete button participates in DOM hit testing. */
export class TradingAiAnnotationHover {
  private pointer: Point | null = null;
  private active: SVGGElement | null = null;
  private frame: number | null = null;
  private destroyed = false;
  private entries: { group: SVGGElement; box: DOMRect }[] | null = null;
  private readonly surface: HTMLElement;
  private readonly content: SVGGElement;
  private readonly enabled: () => boolean;
  private readonly remove: (id: string) => void;

  constructor(surface: HTMLElement, content: SVGGElement, enabled: () => boolean, remove: (id: string) => void) {
    this.surface = surface; this.content = content; this.enabled = enabled; this.remove = remove;
    document.addEventListener('pointermove', this.move, true);
    document.addEventListener('pointerdown', this.press, true);
    document.addEventListener('pointerout', this.leave, true);
    window.addEventListener('blur', this.reset);
    window.addEventListener('resize', this.refresh);
    document.addEventListener('scroll', this.refresh, true);
    content.addEventListener('pointerdown', this.buttonDown);
    content.addEventListener('click', this.click);
    content.addEventListener('keydown', this.keyDown);
  }

  private clear() {
    this.active?.removeAttribute('data-ai-annotation-hover');
    this.active = null;
  }
  private readonly reset = () => { this.pointer = null; this.clear(); };
  private readonly leave = (event: PointerEvent) => { if (!event.relatedTarget) this.reset(); };
  private readonly press = (event: PointerEvent) => { if (!this.button(event.target)) this.reset(); };
  private readonly move = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || event.buttons) { this.reset(); return; }
    this.pointer = { x: event.clientX, y: event.clientY };
    this.queue();
  };
  private queue() {
    if (this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
  }
  readonly refresh = () => { this.entries = null; if (this.pointer) this.queue(); else this.clear(); };

  private update() {
    if (!this.pointer || !this.enabled()) { this.clear(); return; }
    const target = document.elementFromPoint(this.pointer.x, this.pointer.y);
    const button = this.button(target);
    if (button) {
      this.activate(button.closest<SVGGElement>(triggerSelector));
      return;
    }
    // Menus, toolbars, other panes and manual drawings must retain their own hover.
    if (!target || !this.surface.contains(target) || !target.closest('canvas')) { this.clear(); return; }
    const bounds = this.content.ownerSVGElement?.getBoundingClientRect();
    if (!bounds || !contains(bounds, this.pointer)) { this.clear(); return; }
    this.entries ??= [...this.content.querySelectorAll<SVGGElement>(triggerSelector)].flatMap(group => {
      const hit = group.querySelector('.trading-ai-text-size-hit-target');
      return hit ? [{ group, box: hit.getBoundingClientRect() }] : [];
    }).reverse();
    // A geometry redraw may remove the runtime hover attribute while the pointer
    // is over the button above the text. Preserve that button's hover footprint.
    const previous = this.entries.find(entry => entry.group.dataset.aiTextSizeTrigger === this.active?.dataset.aiTextSizeTrigger);
    const action = previous?.group.querySelector(deleteSelector)?.getBoundingClientRect();
    if (previous && action && contains(action, this.pointer)) { this.activate(previous.group); return; }
    this.activate(this.entries.find(entry => contains(entry.box, this.pointer!))?.group ?? null);
  }
  private activate(group: SVGGElement | null) {
    if (this.active !== group) this.clear();
    this.active = group;
    group?.setAttribute('data-ai-annotation-hover', 'true');
  }
  private button(target: EventTarget | null) {
    const button = target instanceof Element ? target.closest<SVGGElement>(deleteSelector) : null;
    return button && this.content.contains(button) ? button : null;
  }
  private readonly buttonDown = (event: PointerEvent) => {
    if (!this.button(event.target)) return;
    event.preventDefault(); event.stopPropagation();
  };
  private readonly click = (event: MouseEvent) => {
    const button = this.button(event.target);
    if (!button || !this.enabled()) return;
    event.preventDefault(); event.stopPropagation();
    this.reset(); this.remove(button.dataset.aiAnnotationDelete!);
  };
  private readonly keyDown = (event: KeyboardEvent) => {
    const button = this.button(event.target);
    if (!button || !this.enabled()) return;
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault(); event.stopPropagation();
    this.reset(); this.remove(button.dataset.aiAnnotationDelete!);
    this.surface.focus({ preventScroll: true });
  };
  destroy() {
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.reset();
    document.removeEventListener('pointermove', this.move, true);
    document.removeEventListener('pointerdown', this.press, true);
    document.removeEventListener('pointerout', this.leave, true);
    window.removeEventListener('blur', this.reset);
    window.removeEventListener('resize', this.refresh);
    document.removeEventListener('scroll', this.refresh, true);
    this.content.removeEventListener('pointerdown', this.buttonDown);
    this.content.removeEventListener('click', this.click);
    this.content.removeEventListener('keydown', this.keyDown);
  }
}
