import crypto from 'node:crypto';
import {runPriceActionStrategyEngine} from './price-action-strategy-engine.mjs';
import {buildPriceActionStrategyDrawingPatch, buildPriceActionStrategyReport} from './price-action-strategy-pipeline.mjs';
import {normalizePriceActionModelReview} from './price-action-pipeline.mjs';
import {runValidatedTradingModelReview} from './model-review.mjs';
import {normalizeTradingMarketSnapshot, validateStrategyDrawingPatch} from './protocol.mjs';
import {localizeTradingAnalysisResult, withTradingReportLanguage} from './report-language.mjs';
import {indicatorReviewEvidence} from './indicator-review-evidence.mjs';

export const PRICE_ACTION_INDICATOR_IDS = new Set(['moving-average-analysis', 'macd-analysis',
  'bollinger-bands-analysis', 'rsi-analysis', 'kdj-analysis', 'vpvr-analysis', 'trend-band']);

export function indicatorStructuralReport(report) {
  let skipping = false;
  return String(report || '').split(/\r?\n/).filter(line => {
    if (/^#{1,6}\s+(?:标准执行方案|標準執行方案|Standard execution plan|当前执行方案|當前執行方案|Current execution plan|条件式执行|條件式執行|Conditional execution)\s*$/u.test(line)) {
      skipping = true;
      return false;
    }
    if (/^#{1,6}\s+/u.test(line)) skipping = false;
    return !skipping;
  }).join('\n').trim();
}

export async function combineIndicatorPriceActionAnalysis(strategyId, params, native, options = {}) {
  if (!PRICE_ACTION_INDICATOR_IDS.has(strategyId)) return native;
  return withTradingReportLanguage(params.language, async () => {
    options.signal?.throwIfAborted();
    const snapshot = normalizeTradingMarketSnapshot(params, {minimumCandles: 20});
    if (native.snapshot.marketId !== snapshot.marketId || native.snapshot.interval !== snapshot.interval
      || native.snapshot.inputHash !== snapshot.inputHash) throw new TypeError('Indicator/price-action snapshot mismatch');
    // Use the actual OHLC-only strategy: swings, zones, patterns and setup lifecycle.
    // Short VPVR windows keep their exact viewport; the engine's profile gates still apply.
    const priceAction = runPriceActionStrategyEngine(snapshot);
    const candidate = priceAction.setups.primaryActiveCandidate;
    const current = candidate && ['active', 'awaiting-breakout', 'awaiting-confirmation'].includes(candidate.tradeState);
    const levels = {};
    if (current) {
      if (candidate.direction === 'neutral') {
        levels.long = candidate.longLevels;
        levels.short = candidate.shortLevels;
      } else levels[candidate.direction === 'bullish' ? 'long' : 'short'] = candidate.actionLevels;
    }
    const allowedSides = Object.keys(levels);
    const indicator = native.theoryResult;
    const indicatorEvidence = indicator.evidence || [];
    const indicatorId = `${strategyId}-price-action-context`;
    const evidence = indicatorReviewEvidence({engine: priceAction.engine, marketStructure: priceAction.marketStructure,
      pivots: priceAction.pivots, zones: priceAction.zones, candlePressure: priceAction.candlePressure,
      patterns: priceAction.candlestickPatterns.recentPatterns, candidate, allowedSides, levels, evidence: priceAction.evidence},
    {strategyId, currentState: indicator.currentState, levels: indicator.levels,
      marketInsights: indicator.marketInsights, actionPlan: native.analysisPlan.actionPlan, evidence: indicatorEvidence}, indicatorId);
    const priceActionIds = [...evidence.priceAction.ids];
    const indicatorIds = [indicatorId, ...evidence.indicator.ids].filter((id, index, ids) => ids.indexOf(id) === index);
    const prompt = [
      'Review the frozen Price Action strategy and the selected indicator from the SAME snapshot.',
      'Price Action is the OHLC-only strategy: confirmed HH/HL or LH/LL swings, repeated-reaction zones, candle pressure, named candle patterns, and current setup lifecycle.',
      'Keep its OHLC evidence separate from indicator calculations. Do not invent patterns, zones, prices or setups.',
      'Explain agreement, disagreement and missing confirmations. An indicator extreme/crossover alone is not an entry.',
      'Return JSON only: {schemaVersion:1, verdict:"approve"|"revise", summary:string, rationale:string, planSide:"long"|"short"|"wait", evidenceIds:string[]}.',
      `Write summary and rationale in ${params.language || 'zh-CN'}.`,
      'Choose a direction only from allowedSides. Choose wait when there is no active Price Action setup, evidence conflicts, or confirmation is insufficient.',
      'A directional plan must cite at least one ID from EACH source. The host uses the current Price Action setup trigger, structural stop and targets, followed by existing entry/risk checks.',
      'Use at most 32 exact IDs from priceActionEvidenceIds and indicatorEvidenceIds. Price Action IDs already include the price-action: prefix; do not add or remove it. Metadata such as engine/profile IDs is not evidence.',
      JSON.stringify({instruction: params.instruction || '', userRiskProfile: params.userRiskProfile || {},
        snapshot: {snapshotId: snapshot.snapshotId, marketId: snapshot.marketId, interval: snapshot.interval},
        priceAction: evidence.priceAction.context, indicator: evidence.indicator.context}),
      JSON.stringify({priceActionEvidenceIds: priceActionIds, indicatorEvidenceIds: indicatorIds, allowedSides}),
    ].join('\n');
    const reviewed = await runValidatedTradingModelReview({
      modelRegistry: options.modelRegistry, providerId: options.providerId,
      signal: options.signal, theoryResult: priceAction,
      request: {schemaVersion: 1, requestId: `indicator-price-action-${crypto.randomUUID()}`,
        task: 'indicator-price-action-review', theoryId: strategyId, snapshotId: snapshot.snapshotId,
        language: params.language, allowedLanguageLiterals: [snapshot.marketId, strategyId],
        prompt, responseFormat: 'json'},
      validateResponse(text) {
        const review = normalizePriceActionModelReview(text);
        const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (!['wait', ...allowedSides].includes(parsed.planSide)) {
          throw new TypeError('Invalid combined Price Action decision; select wait or an available setup direction');
        }
        if (!Array.isArray(parsed.evidenceIds) || parsed.evidenceIds.length > 32) {
          throw new TypeError('Combined review evidenceIds must be an array of at most 32 exact evidence IDs');
        }
        if (parsed.evidenceIds.some(id => typeof id !== 'string'
          || (!evidence.priceAction.ids.has(id) && !evidence.indicator.ids.has(id)))) {
          throw new TypeError('Unknown combined review evidence ID; use only the supplied priceActionEvidenceIds and indicatorEvidenceIds');
        }
        if (parsed.planSide !== 'wait' && (!parsed.evidenceIds.some(id => evidence.priceAction.ids.has(id))
          || !parsed.evidenceIds.some(id => evidence.indicator.ids.has(id)))) throw new TypeError('Both analysis sources are required');
        return {...review, planSide: parsed.planSide, evidenceIds: [...new Set(parsed.evidenceIds)]};
      },
    });
    options.signal?.throwIfAborted();
    const {review, modelResponse} = reviewed;
    const catalog = new Map([
      {id: indicatorId, summary: `${strategyId}: ${review.summary}`},
      ...evidence.priceAction.evidence, ...evidence.indicator.evidence,
    ].map(item => [item.id, item]));
    // Downstream plans bound their evidence arrays. Keep the chosen references
    // before the full catalog so a late zone/swing cannot fall out a second time.
    const resultEvidenceIds = [...new Set([indicatorId, ...review.evidenceIds, ...catalog.keys()])];
    const analysisId = `${strategyId}-price-action-${crypto.createHash('sha256')
      .update(JSON.stringify([snapshot.inputHash, priceAction.engine.version, review])).digest('hex').slice(0, 18)}`;
    const isStructural = ({drawing}) => !['strategy-entry', 'strategy-stop', 'strategy-target'].includes(drawing.colorToken);
    const priceActionPatch = buildPriceActionStrategyDrawingPatch(snapshot, priceAction);
    const operations = priceActionPatch.operations.filter(isStructural).map(({drawing}, index) => ({op: 'upsert', drawing: {
      ...drawing, id: `${analysisId}-price-action-${index}`, strategyId, layer: `ai/strategy/${strategyId}`,
      evidenceIds: drawing.evidenceIds.map(id => `price-action:${id}`),
    }}));
    operations.push(...(native.analysisPlan.drawingPatch?.operations || []).filter(isStructural));
    const drawingPatch = validateStrategyDrawingPatch({schemaVersion: 1, analysisId, baseRevision: 0,
      marketId: snapshot.marketId, interval: snapshot.interval, operations}, snapshot, strategyId);
    const side = review.planSide, selectedLevels = levels[side];
    const actionPlan = {primaryBias: side === 'long' ? 'bullish' : side === 'short' ? 'bearish' : 'neutral',
      disposition: side === 'wait' ? 'wait' : 'conditional',
      currentPrice: snapshot.candles[priceAction.statistics.closedCandleCount - 1].close,
      confirmation: review.rationale || review.summary, observeTrigger: review.summary, validityBars: 4,
      ...(selectedLevels ? {[`${side}Trigger`]: selectedLevels.trigger,
        [`${side}Invalidation`]: selectedLevels.stop, [`${side}Target`]: selectedLevels.targets[0],
        [`${side}Targets`]: selectedLevels.targets} : {})};
    const heading = params.language === 'ja' ? 'プライスアクション戦略と指標の総合評価' : params.language === 'ko' ? '프라이스 액션 전략 및 지표 종합 평가' : params.language === 'en' ? 'Price Action strategy and indicator assessment'
      : ['zh-TW', 'zh-Hant'].includes(params.language) ? '裸 K 策略與指標綜合判斷' : '裸 K 策略与指标综合判断';
    const report = [`### ${heading}`, review.summary, review.rationale,
      indicatorStructuralReport(buildPriceActionStrategyReport(snapshot, priceAction)),
      indicatorStructuralReport(native.analysisPlan.report)].filter(Boolean).join('\n\n');
    const priceActionAnalysis = {schemaVersion: 1, strategyId: 'price-action', engine: priceAction.engine,
      snapshotId: snapshot.snapshotId, inputHash: snapshot.inputHash, marketStructure: priceAction.marketStructure,
      candidateId: candidate?.id || null, allowedSides, levels, selectedSide: side,
      evidenceIds: review.evidenceIds, summary: review.summary, rationale: review.rationale};
    return localizeTradingAnalysisResult({...native,
      theoryResult: {...indicator, priceActionAnalysis, evidence: resultEvidenceIds.map(id => catalog.get(id))},
      analysisPlan: {...native.analysisPlan, analysisId, report, narrative: review.summary,
        actionPlan, drawingPatch, ...(native.analysisPlan.indicatorDrawingPatch ? {
          indicatorDrawingPatch: {...native.analysisPlan.indicatorDrawingPatch, analysisId},
        } : {})},
      model: {...modelResponse, reviewAttempts: reviewed.attempts.length},
    }, params.language);
  });
}
