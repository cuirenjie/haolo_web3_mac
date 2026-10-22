import { restoreBusinessToolError } from '../shared/business-tool-error.mjs';

type Chart = { marketId: string; symbol: string; interval: string };
type Target = Chart & { targetId: string; storageSessionId: string; candles: readonly unknown[] };
interface Workspace<T extends Target> {
  analysisWorkspaceOwner(): string;
  drawingStorageSessionMatches(id: string): boolean;
  prepareAlertContext(marketId: string, interval: string, options: { strictMarketId: boolean; assertActive: () => void }): Promise<unknown>;
  captureAnalysisTaskTarget(): T | null;
}

const unavailable = () => restoreBusinessToolError({
  message: 'The originating conversation chart is unavailable. Analysis stopped; start a new request after restoring the conversation.',
  code: 'CHART_CONTEXT_UNAVAILABLE', retryable: false,
});
const cancelled = () => restoreBusinessToolError({ message: 'Chart opening was cancelled.', code: 'CHART_OPEN_CANCELLED', retryable: false });

// A target owns a conversation, not the lifetime of a DOM/chart instance.
// Rebind only within that conversation and account; retry a mid-load rebuild once.
export async function openBoundAnalysisChart<T extends Target, W extends Workspace<T>>({
  target, boundWorkspace, getActiveWorkspace, requested, threadId, signal, remember,
}: {
  target: T | null; boundWorkspace: W | null | undefined; getActiveWorkspace: () => W | null;
  requested: Chart; threadId: string; signal: AbortSignal; remember: (target: T, workspace: W) => void;
}): Promise<T> {
  if (signal.aborted) throw cancelled();
  if (!threadId || (target && (!boundWorkspace || target.storageSessionId !== threadId))) throw unavailable();
  const owner = (boundWorkspace || getActiveWorkspace())?.analysisWorkspaceOwner();
  const current = () => {
    if (signal.aborted) throw cancelled();
    const workspace = getActiveWorkspace();
    if (!workspace || owner === undefined || workspace.analysisWorkspaceOwner() !== owner
      || !workspace.drawingStorageSessionMatches(threadId)) throw unavailable();
    return workspace;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const workspace = current();
    const assertActive = () => { if (current() !== workspace) throw unavailable(); };
    try {
      await workspace.prepareAlertContext(requested.marketId, requested.interval, { strictMarketId: true, assertActive });
      assertActive();
      const next = workspace.captureAnalysisTaskTarget();
      if (!next || next.storageSessionId !== threadId || next.marketId !== requested.marketId
        || next.symbol !== requested.symbol || next.interval !== requested.interval || next.candles.length < 2) {
        throw restoreBusinessToolError({ message: 'The requested chart candles are not ready.', code: 'CHART_DATA_UNAVAILABLE', retryable: false });
      }
      remember(next, workspace);
      return next;
    } catch (error) {
      // A new, owned chart may have replaced the old one while loading. Never
      // retry a data/network error on the same chart or follow another account.
      if (attempt === 0 && current() !== workspace) continue;
      throw error;
    }
  }
  throw unavailable();
}
