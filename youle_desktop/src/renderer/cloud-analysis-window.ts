// Only viewport identity/count cross IPC. Prices and strategy evidence are fetched
// and frozen by the server; a broken local market socket cannot block analysis.
export function cloudAnalysisWindow(strategyId: string|undefined, candles: readonly {time: number}[], preferredCount=100) {
  const count=Math.min(600,Math.max(20,Math.floor(preferredCount)||100,candles.length));
  if(strategyId!=='vpvr-analysis')return {analysisWindowCount:count};
  if(candles.length<20||candles.length>600)throw Object.assign(new Error('VPVR_VISIBLE_RANGE_REQUIRED'),{code:'VPVR_VISIBLE_RANGE_REQUIRED'});
  const visibleFrom=Math.round(candles[0].time*1000),visibleTo=Math.round(candles.at(-1)!.time*1000);
  if(!Number.isSafeInteger(visibleFrom)||!Number.isSafeInteger(visibleTo)||visibleFrom<=0||visibleTo<=visibleFrom)
    throw Object.assign(new Error('VPVR_VISIBLE_RANGE_REQUIRED'),{code:'VPVR_VISIBLE_RANGE_REQUIRED'});
  return {analysisWindowCount:candles.length,visibleRange:{visibleFrom,visibleTo}};
}
