// Capture synchronously, before classification/network awaits or a layout change.
// Only identity and viewport bounds leave the renderer; the server reads OHLC.
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function captureCloudAnalysisPanes<T>(
  panes: readonly {cloudAnalysisSnapshot: (visibleOnly: boolean) => T}[],
  heading: (paneIndex: number) => string,
  visibleOnly = true,
  unavailableMessage = 'Chart snapshot unavailable',
) {
  const snapshots: T[] = [];
  const snapshotFailures: {paneIndex: number; heading: string; message: string}[] = [];
  for (const [index, pane] of panes.entries()) {
    try {
      snapshots.push(freeze(structuredClone(pane.cloudAnalysisSnapshot(visibleOnly))));
    } catch {
      snapshotFailures.push({paneIndex: index + 1, heading: heading(index + 1),
        message: unavailableMessage});
    }
  }
  return freeze({snapshots, snapshotFailures});
}
