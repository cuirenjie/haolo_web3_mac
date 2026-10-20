import {normalizeCloudReports} from '../main/cloud-plan-contract.mjs';
import {cloudPlanDrawingPatch, isExecutionPlanLevel} from '../shared/execution-plan-drawings.mjs';
import type {TradingDrawingModel} from './trading-expert-drawing.ts';

export const PLAN_DRAWING_HISTORY_CHANGED = 'trading-plan-drawing-history-changed';
type Projection = {source: Map<string, string>; replacements: TradingDrawingModel[]};
const sessions = new Map<string, Map<string, Projection>>();
const signature = (d: any) => JSON.stringify([d.colorToken, d.points]);

/** Register immutable receipt projections when live or historical items arrive. */
export function rememberTradingPlanDrawingHistory(threadId: string, value: unknown) {
  if (!threadId || !Array.isArray(value) || !value.some(r => r?.executionPolicy === 'right-legacy-v1')) return;
  try {
    for (const report of normalizeCloudReports(value)) {
      if (report.executionPolicy !== 'right-legacy-v1' || !report.drawingPatch || !report.planRecords.length) continue;
      const pane = Number(/:pane:(\d+)$/.exec(report.origin?.analysisJobId || '')?.[1] || 0);
      if (pane > 7) continue;
      // History belongs to the thread being hydrated, not a stale draft ID or
      // an arbitrary origin copied from another conversation.
      const session = pane ? `${threadId}::split-pane:${pane}` : threadId;
      const entries = sessions.get(session) || new Map<string, Projection>();
      if (entries.has(report.resultHash)) continue;
      const patch = cloudPlanDrawingPatch(report);
      if (!patch) continue;
      const raw = report.drawingPatch.operations.filter((op: any) => isExecutionPlanLevel(op.drawing));
      if (!raw.length || raw.every((op: any) => op.drawing.planLevel)) continue;
      const replacements = patch.operations.filter((op: any) => op.drawing.planLevel).map((op: any) => ({
        ...op.drawing, source: 'ai', symbol: patch.marketId, interval: patch.interval,
      }));
      entries.set(report.resultHash, {
        source: new Map(raw.map((op: any) => [op.drawing.id, signature(op.drawing)])), replacements,
      });
      while (entries.size > 64) entries.delete(entries.keys().next().value!);
      sessions.set(session, entries);
      while (sessions.size > 128) sessions.delete(sessions.keys().next().value!);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLAN_DRAWING_HISTORY_CHANGED, {detail: session}));
    }
  } catch {
    // Malformed/unrelated history cannot rewrite a chart or block chat loading.
  }
}

export function projectStoredTradingPlanDrawings(drawings: readonly TradingDrawingModel[], session: string) {
  const projections = sessions.get(session);
  if (!projections) return drawings;
  let result = drawings;
  for (const {source, replacements} of projections.values()) {
    const matching = result.filter(d => d.source === 'ai' && source.has(d.id));
    // A deleted or partially removed plan stays deleted. Never restore a whole
    // old drawing patch over newer analysis, user drawings, or another market.
    if (matching.length !== source.size || matching.some(d => signature(d) !== source.get(d.id))
      || replacements.some(d => d.symbol !== matching[0].symbol || d.interval !== matching[0].interval)) continue;
    result = [...result.filter(d => !matching.includes(d)), ...replacements];
  }
  return result;
}
