import type { TradingDrawingModel } from './trading-expert-drawing.ts';
import type { TradingOrderLine } from './trading-expert-order-lines.ts';
import { executionPlanPriceText } from '../main/execution-plan-card-view.mjs';

type PlanPriceRole = 'entry' | 'stop' | 'target';

function planPriceRole(drawing: TradingDrawingModel): PlanPriceRole | null {
  if (drawing.source !== 'ai' || !['path', 'horizontal-line', 'horizontal-ray'].includes(drawing.tool)) return null;
  const price = drawing.points[0]?.price;
  if (!Number.isFinite(price) || price <= 0 || !drawing.points.every(point => point.price === price)) return null;
  if (drawing.colorToken === 'strategy-entry') return 'entry';
  if (drawing.colorToken === 'strategy-stop') return 'stop';
  if (drawing.colorToken === 'strategy-target') return 'target';
  return null;
}

function planPriceGroup(drawing: TradingDrawingModel) {
  const ref = drawing.entryConditionRef;
  return JSON.stringify([drawing.symbol, drawing.interval, drawing.strategyId,
    drawing.planLevel ? [drawing.planLevel.planId, drawing.planLevel.scenarioId]
      : ref ? [ref.conditionId, ref.revision, ref.conditionHash] : 'legacy']);
}

function planPriceLabel(drawing: TradingDrawingModel, role: PlanPriceRole, targetIndex: number, stop?: number) {
  // History keeps the language of the original analysis, like other AI labels.
  const text = drawing.text || '';
  const english = /[A-Za-z]/.test(text) && !/\p{Script=Han}/u.test(text);
  const traditional = /[場條損參側區]/.test(text);
  if (role === 'entry') {
    // Current projections carry the card scenario's side in the entry text.
    // Older immutable drawings have only the matching entry/stop prices.
    const side = /做多|\b(?:entry\s+long|long\s+entry)\b/i.test(text) ? 'long'
      : /做空|\b(?:entry\s+short|short\s+entry)\b/i.test(text) ? 'short'
      : stop != null && stop !== drawing.points[0].price ? (stop < drawing.points[0].price ? 'long' : 'short') : null;
    return english ? `Entry${side ? ` ${side}` : ''}`
      : `${traditional ? '入場' : '入场'}${side ? (side === 'long' ? '做多' : '做空') : ''}`;
  }
  if (role === 'stop') return english ? 'Stop loss' : traditional ? '止損' : '止损';
  return english ? `TP${targetIndex}` : `第${targetIndex}止盈`;
}

/** Adapt validated AI price levels without mutating history or account orders. */
export function buildTradingPlanPriceLines(drawings: readonly TradingDrawingModel[]) {
  const candidates = drawings.flatMap(drawing => {
    const role = planPriceRole(drawing);
    return role ? [{ drawing, role, group: planPriceGroup(drawing) }] : [];
  });
  const drawingIds = new Set(candidates.map(({ drawing }) => drawing.id));
  const entryDrawings = new Map<string, TradingDrawingModel>();
  const stops = new Map(candidates.filter(candidate => candidate.role === 'stop')
    .map(({ group, drawing }) => [group, drawing.points[0].price]));
  for (const { drawing, role, group } of candidates) {
    if (role !== 'entry') continue;
    const selected = entryDrawings.get(group);
    const stop = stops.get(group);
    // Match the card's left-side trigger: lower edge for long, upper for short.
    // Valid plan stops lie outside the entry zone, so select its nearer edge.
    if (!selected || stop != null && Math.abs(drawing.points[0].price - stop) < Math.abs(selected.points[0].price - stop)) {
      entryDrawings.set(group, drawing);
    }
  }
  const targets = new Map<string, number>();
  const entries = new Set<string>();
  const lines: TradingOrderLine[] = [];
  for (const candidate of candidates) {
    const { role, group } = candidate;
    let { drawing } = candidate;
    if (role === 'entry') {
      if (entries.has(group)) continue;
      entries.add(group);
      drawing = entryDrawings.get(group)!;
    }
    const price = drawing.points[0].price;
    const targetIndex = role === 'target' ? drawing.planLevel?.targetIndex ?? (targets.get(group) || 0) + 1 : 0;
    if (targetIndex) targets.set(group, targetIndex);
    const cardPrice = executionPlanPriceText(price);
    const label = Number(cardPrice.replaceAll(',', '')) > 0 ? cardPrice
      : price.toLocaleString('en-US', { maximumSignificantDigits: 12, useGrouping: false });
    const shortLabel = planPriceLabel(drawing, role, targetIndex, stops.get(group));
    lines.push({
      id: `plan:${drawing.id}`,
      marketId: drawing.symbol,
      price,
      kind: role === 'target' ? 'take-profit' : role === 'stop' ? 'stop-loss'
        : 'plan-entry',
      shortLabel,
      label,
      labelMode: 'price',
      ariaLabel: `${shortLabel} ${label}`,
    });
  }
  return { lines, drawingIds };
}
