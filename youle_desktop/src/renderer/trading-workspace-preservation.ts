/** Keep the native focused editor (including its IME session) alive while the
 * surrounding shell is replaced. A connected state-preserving move avoids the
 * blur caused by remove()/replaceWith(), even when the same node is reinserted.
 */
export function moveTradingWorkspaceHost(host: HTMLElement, parent: HTMLElement, before: Node | null = null) {
  const target = parent as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };
  if (target.moveBefore && host.isConnected && parent.isConnected && host.ownerDocument === parent.ownerDocument) {
    target.moveBefore(host, before);
  } else {
    parent.insertBefore(host, before);
  }
}

export function captureTradingWorkspaceFocus(host: HTMLElement) {
  const field = host.ownerDocument.activeElement;
  if (!(field instanceof HTMLElement) || !host.contains(field)) return null;
  const input = field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement ? field : null;
  return {
    field,
    start: input?.selectionStart ?? null,
    end: input?.selectionEnd ?? null,
    direction: input?.selectionDirection ?? null,
    scrollTop: field.scrollTop,
    scrollLeft: field.scrollLeft,
  };
}

export function restoreTradingWorkspaceFocus(host: HTMLElement, snapshot: ReturnType<typeof captureTradingWorkspaceFocus>) {
  if (!snapshot || !snapshot.field.isConnected || !host.contains(snapshot.field)) return;
  const doc = host.ownerDocument, active = doc.activeElement;
  // Chromium preserves focus with moveBefore but can reset a textarea's native
  // selection. Restore it too, without taking focus from a new modal/control.
  if (active !== snapshot.field && active && active !== doc.body && active !== doc.documentElement) return;
  if (active !== snapshot.field) snapshot.field.focus({ preventScroll: true });
  if (snapshot.start !== null && snapshot.end !== null
    && (snapshot.field instanceof HTMLInputElement || snapshot.field instanceof HTMLTextAreaElement)) {
    snapshot.field.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction ?? undefined);
  }
  snapshot.field.scrollTop = snapshot.scrollTop;
  snapshot.field.scrollLeft = snapshot.scrollLeft;
}
