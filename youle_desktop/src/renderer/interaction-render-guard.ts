/** Keep the native activation target mounted from press through click dispatch.
 * Only rendering is postponed; requests, state updates and unrelated regions continue.
 * Never replay a click against a replacement button (its action may have changed).
 */
export function createInteractionRenderGuard(doc: Document) {
  const view = doc.defaultView!;
  const pointers = new Map<number, Node>();
  const keys = new Map<string, Node>();
  const pending = new Map<unknown, { scope: Node; update: () => unknown }>();
  const timers = new Map<string, number>();
  let flushTimer: number | null = null;
  const cleanups: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, listener: (event: any) => void) => {
    target.addEventListener(type, listener, true);
    cleanups.push(() => target.removeEventListener(type, listener, true));
  };
  const node = (event: Event): Node | null => {
    const target = event.composedPath()[0] as Node | undefined;
    return target && typeof target.contains === "function" ? target : null;
  };
  const blocked = (scope: Node) => [...pointers.values(), ...keys.values()]
    .some(target => scope.contains(target));
  const flush = () => {
    flushTimer = null;
    for (const [key, entry] of [...pending]) {
      if (pending.get(key) !== entry || blocked(entry.scope)) continue;
      pending.delete(key);
      if (entry.scope.isConnected) {
        try { entry.update(); }
        catch (error) { view.reportError(error); }
      }
    }
  };
  const scheduleFlush = () => {
    if (flushTimer === null && pending.size) flushTimer = view.setTimeout(flush, 0);
  };
  const clearTimer = (key: string) => {
    const timer = timers.get(key);
    if (timer !== undefined) view.clearTimeout(timer);
    timers.delete(key);
  };
  const releasePointer = (id: number) => {
    clearTimer(`pointer:${id}`);
    pointers.delete(id);
    scheduleFlush();
  };
  const releaseKey = (key: string) => {
    clearTimer(`key:${key}`);
    keys.delete(key);
    scheduleFlush();
  };
  const reset = () => {
    for (const timer of timers.values()) view.clearTimeout(timer);
    timers.clear();
    pointers.clear();
    keys.clear();
    scheduleFlush();
  };
  listen(view, "pointerdown", (event: PointerEvent) => {
    const target = node(event);
    if (!target) return;
    clearTimer(`pointer:${event.pointerId}`);
    pointers.set(event.pointerId, target);
  });
  listen(view, "pointerup", (event: PointerEvent) => {
    // Native click follows pointerup. A task, not a microtask, also covers
    // listeners that stop propagation and drags which produce no click.
    clearTimer(`pointer:${event.pointerId}`);
    timers.set(`pointer:${event.pointerId}`, view.setTimeout(() => releasePointer(event.pointerId), 0));
  });
  listen(view, "pointercancel", (event: PointerEvent) => releasePointer(event.pointerId));
  listen(view, "pointermove", (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.buttons === 0) releasePointer(event.pointerId);
  });
  listen(view, "keydown", (event: KeyboardEvent) => {
    if (event.key !== " " && event.key !== "Enter") return;
    const target = node(event) as Element | null;
    if (!target?.closest?.('button, a[href], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], summary, [role="button"], [role="menuitem"], [role="tab"]')) return;
    clearTimer(`key:${event.key}`);
    keys.set(event.key, target);
  });
  listen(view, "keyup", (event: KeyboardEvent) => {
    if (!keys.has(event.key)) return;
    clearTimer(`key:${event.key}`);
    timers.set(`key:${event.key}`, view.setTimeout(() => releaseKey(event.key), 0));
  });
  const activate = (event: MouseEvent) => {
    const target = node(event);
    const id = (event as PointerEvent).pointerId;
    for (const [pointerId, pressed] of pointers) {
      if (pointerId === id || (target && (target.contains(pressed) || pressed.contains(target)))) releasePointer(pointerId);
    }
    for (const [key, pressed] of keys) {
      if (target && (target.contains(pressed) || pressed.contains(target))) releaseKey(key);
    }
    // The click target/path is now fixed. Let its own handler render
    // synchronously, preserving existing focus and dialog behavior.
  };
  listen(view, "click", activate);
  listen(view, "auxclick", activate);
  listen(view, "contextmenu", activate);
  // Element blur is captured here too (e.g. the composer loses focus during
  // pointerdown). Only leaving the window cancels the active gesture.
  listen(view, "blur", (event: FocusEvent) => { if (event.target === view) reset(); });
  listen(doc, "visibilitychange", () => { if (doc.hidden) reset(); });
  return {
    defer(scope: Node | null | undefined, update: () => unknown, key: unknown = scope) {
      if (!scope || !blocked(scope)) {
        pending.delete(key);
        return false;
      }
      pending.set(key, { scope, update });
      return true;
    },
    dispose() {
      cleanups.forEach(cleanup => cleanup());
      reset();
      if (flushTimer !== null) view.clearTimeout(flushTimer);
      pending.clear();
    },
  };
}

let installed: ReturnType<typeof createInteractionRenderGuard> | undefined;
export function installInteractionRenderGuard() {
  installed ??= createInteractionRenderGuard(document);
}
export function deferInteractionRender(scope: Node | null | undefined, update: () => unknown, key?: unknown) {
  return installed?.defer(scope, update, key === undefined ? scope : key) ?? false;
}
