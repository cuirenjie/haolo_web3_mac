// Presentation only: copy the final plan's prices, never recalculate trading
// decisions. Also used by the cloud desktop projection before receipt signing.
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const roles = new Set(['strategy-entry', 'strategy-stop', 'strategy-target']);
export const isExecutionPlanLevel = drawing => roles.has(drawing?.colorToken)
  && ['path', 'horizontal-line', 'horizontal-ray'].includes(drawing.tool)
  && drawing.points?.length > 0 && positive(drawing.points[0].price)
  && drawing.points.every(point => point.price === drawing.points[0].price);

export function normalizePlanLevel(value) {
  if (value == null) return undefined;
  if (typeof value.planId !== 'string' || !value.planId || value.planId.length > 160
    || typeof value.scenarioId !== 'string' || !value.scenarioId || value.scenarioId.length > 160
    || !['entry', 'stop', 'target'].includes(value.role)
    || (value.role === 'target' && (!Number.isSafeInteger(value.targetIndex) || value.targetIndex < 1 || value.targetIndex > 8))) {
    throw new TypeError('Invalid execution plan level');
  }
  return {planId: value.planId, scenarioId: value.scenarioId, role: value.role,
    ...(value.role === 'target' ? {targetIndex: value.targetIndex} : {})};
}

export function projectExecutionPlanDrawings(patch, plan, language = 'zh-CN') {
  if (plan?.schemaVersion !== 1 || !Array.isArray(plan.scenarios) || !patch) return patch;
  if (patch.marketId !== plan.market?.marketId || patch.interval !== plan.market?.interval
    || !Array.isArray(patch.operations) || typeof plan.planId !== 'string'
    || typeof plan.strategy?.id !== 'string') throw new TypeError('Execution plan drawing context mismatch');
  // Indicator pipelines may have their own patch analysisId. The plan identity
  // is carried explicitly on each price level instead of inferred from that ID.
  const selected = ['long', 'short'].includes(plan.preferredSide)
    ? plan.scenarios.filter(s => s.side === plan.preferredSide).slice(0, 1)
    : plan.scenarios.filter(s => ['long', 'short'].includes(s.side));
  const scenarios = plan.preferredSide === 'neutral' && selected.length < 2 ? [] : selected;
  for (const s of scenarios) {
    if (!positive(s.trigger?.price) || !positive(s.stop?.price) || !Array.isArray(s.targets)
      || !s.targets.length || s.targets.length > 8 || !s.targets.every(t => positive(t.price))) {
      throw new TypeError('Invalid execution plan drawing prices');
    }
  }
  const original = patch.operations.filter(op => isExecutionPlanLevel(op.drawing));
  const times = (original.length ? original : patch.operations).flatMap(op => op.drawing?.points || [])
    .map(p => p.time).filter(t => Number.isFinite(t) && t > 0);
  if (scenarios.length && !times.length) return patch;
  const start = Math.min(...times), end = Math.max(...times);
  const english = language === 'en', traditional = ['zh-TW', 'zh-Hant'].includes(language);
  const operations = patch.operations.filter(op => !isExecutionPlanLevel(op.drawing));
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const levels = [['entry', scenario.trigger], ['stop', scenario.stop],
      ...scenario.targets.map(target => ['target', target])];
    for (const [index, [role, level]] of levels.entries()) {
      const targetIndex = role === 'target' ? index - 1 : undefined;
      const label = language === 'ja' ? (role === 'entry' ? `${scenario.side === 'long' ? 'ロング' : 'ショート'}エントリー` : role === 'stop' ? '損切り' : `利確 ${targetIndex}`) : language === 'ko' ? (role === 'entry' ? `진입 ${scenario.side === 'long' ? '롱' : '숏'}` : role === 'stop' ? '손절' : `${targetIndex}차 익절`) : role === 'entry' ? (english ? `Entry ${scenario.side}` : `${traditional ? '入場' : '入场'}做${scenario.side === 'long' ? '多' : '空'}`)
        : role === 'stop' ? (english ? 'Stop loss' : traditional ? '止損' : '止损')
        : english ? `TP${targetIndex}` : `第${targetIndex}止盈`;
      operations.push({op: 'upsert', drawing: {
        id: `${plan.planId}-price-${scenarioIndex}-${index}`,
        planLevel: normalizePlanLevel({planId: plan.planId, scenarioId: scenario.id || `${scenario.side}-${scenarioIndex}`, role, targetIndex}),
        strategyId: plan.strategy.id, theory: 'strategy', layer: `ai/strategy/${plan.strategy.id}`,
        symbol: patch.marketId, tool: 'path', locked: true, status: 'confirmed',
        points: [{time: start, price: level.price}, {time: end, price: level.price}],
        text: `${label} ${level.price}`, colorToken: `strategy-${role}`, lineWidth: 1.5, lineStyle: 'dashed',
        evidenceIds: Array.isArray(level.evidenceIds) ? level.evidenceIds.slice(0, 32) : [],
      }});
    }
  }
  return {...patch, operations};
}

// Verified receipts remain immutable. Compatibility is a display projection,
// including older receipts issued before the server's price-line correction.
export function cloudPlanDrawingPatch(report) {
  if (report?.executionPolicy !== 'right-legacy-v1' || !report.planRecords?.length) return report?.drawingPatch;
  return projectExecutionPlanDrawings(report.drawingPatch, report.executionPlan, report.locale);
}

export function cloudAnalysisDrawingPlan(response) {
  const analysis = response.analysisPlan;
  if (response.cloud?.executionPolicy !== 'right-legacy-v1' || !response.cloud.planRecords?.length) return analysis;
  return {...analysis, drawingPatch: projectExecutionPlanDrawings(analysis.drawingPatch, response.executionPlan, response.cloud.locale)};
}
