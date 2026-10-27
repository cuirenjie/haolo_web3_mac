import {normalizeCloudReports} from '../main/cloud-plan-contract.mjs';
import {cloudPlanDrawingPatch, isExecutionPlanLevel, projectWyckoffPlanDrawings} from '../shared/execution-plan-drawings.mjs';
import type {CloudTradingReport} from '../main/cloud-plan-contract.mjs';
import type {TradingDrawingModel} from './trading-expert-drawing.ts';

export const PLAN_DRAWING_HISTORY_CHANGED = 'trading-plan-drawing-history-changed';
type Projection = {source: Map<string, string>; replacements: TradingDrawingModel[]};
const sessions = new Map<string, Map<string, Projection>>();
const wyckoffPatches = new Map<string, Map<string, any>>();
const reportKey = (r: CloudTradingReport) => `${r.runId}:${r.resultHash}`;
const reportSession = (threadId: string, r: CloudTradingReport) => {
  const pane = Number(/:pane:(\d+)$/.exec(r.origin?.analysisJobId || '')?.[1] || 0);
  return pane > 7 ? null : pane ? `${threadId}::split-pane:${pane}` : threadId;
};
const signature = (d: any) => JSON.stringify([d.colorToken, d.points]);

/** Both cards navigate to the same selected plan lines for their frozen run. */
export function visibleTradingPlanDrawingPatch(report: CloudTradingReport, threadId: string) {
  const session = reportSession(threadId, report);
  return (session && wyckoffPatches.get(session)?.get(reportKey(report))) || cloudPlanDrawingPatch(report);
}

function rememberWyckoff(threadId: string, reports: CloudTradingReport[]) {
  const groups = new Map<string, CloudTradingReport[]>();
  for (const report of reports) {
    if (report.strategyId !== 'wyckoff' || !report.executionPlan.wyckoffScenario || !report.drawingPatch) continue;
    const session = reportSession(threadId, report);
    if (!session) continue;
    const key = JSON.stringify([session, reportKey(report), report.marketId, report.interval,
      report.executionPlan.wyckoffScenario.rangeId]);
    groups.set(key, [...(groups.get(key) || []), report]);
  }
  for (const group of groups.values()) {
    if (group.length !== 2) continue;
    const first = group[0], session = reportSession(threadId, first)!;
    const raw: Record<string, any> = {...first.drawingPatch, operations: [...new Map(group.flatMap(r => r.drawingPatch!.operations)
      .map((op: any) => [op.drawing?.id || op.drawingId, op])).values()]};
    const probability = group.find(r => r.profitProbability)?.profitProbability;
    const patch = projectWyckoffPlanDrawings(raw, group.map(r => r.executionPlan),
      group.flatMap(r => r.planRecords), probability && {...probability,
        assessments: group.flatMap(r => r.profitProbability?.assessments || [])});
    const patches = wyckoffPatches.get(session) || new Map<string, any>();
    patches.set(reportKey(first), patch);
    while (patches.size > 64) patches.delete(patches.keys().next().value!);
    wyckoffPatches.set(session, patches);
    while (wyckoffPatches.size > 128) wyckoffPatches.delete(wyckoffPatches.keys().next().value!);
    const entries = sessions.get(session) || new Map<string, Projection>();
    entries.set(reportKey(first), {
      source: new Map(raw.operations.filter((op: any) => isExecutionPlanLevel(op.drawing))
        .map((op: any) => [op.drawing.id, signature(op.drawing)])),
      replacements: patch.operations.filter((op: any) => isExecutionPlanLevel(op.drawing))
        .map((op: any) => ({...op.drawing, source: 'ai', symbol: patch.marketId, interval: patch.interval})),
    });
    while (entries.size > 64) entries.delete(entries.keys().next().value!);
    sessions.set(session, entries);
    while (sessions.size > 128) sessions.delete(sessions.keys().next().value!);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLAN_DRAWING_HISTORY_CHANGED, {detail: session}));
  }
}

/** Register immutable receipt projections when live or historical items arrive. */
export function rememberTradingPlanDrawingHistory(threadId: string, value: unknown) {
  if (!threadId || !Array.isArray(value)) return;
  try {
    const reports = normalizeCloudReports(value);
    rememberWyckoff(threadId, reports);
    for (const report of reports) {
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
