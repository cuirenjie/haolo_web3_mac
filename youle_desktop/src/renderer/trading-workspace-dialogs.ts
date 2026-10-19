type PreservedTradingWorkspaceDialog = {
  dialog: HTMLDialogElement;
  focus: HTMLElement | null;
};

export function captureTradingWorkspaceDialogs(host: HTMLElement): PreservedTradingWorkspaceDialog[] {
  const activeElement = host.ownerDocument.activeElement;
  return Array.from(host.querySelectorAll<HTMLDialogElement>('dialog:modal'), dialog => ({
    dialog,
    focus: activeElement instanceof HTMLElement && dialog.contains(activeElement) ? activeElement : null,
  }));
}

export function restoreTradingWorkspaceDialogs(dialogs: PreservedTradingWorkspaceDialog[]) {
  for (const { dialog, focus } of dialogs) {
    if (!dialog.isConnected || !dialog.open || dialog.matches(':modal')) continue;
    // Detaching the chart removes native dialogs from the top layer but leaves
    // `open` set. Reset it without close(), whose event would dismiss editors
    // and clear the drawing confirmation's original focus target.
    dialog.removeAttribute('open');
    dialog.showModal();
    if (focus?.isConnected && dialog.contains(focus)) focus.focus({ preventScroll: true });
  }
}
