// Ordinary strategy horizons belong to the server. Only VPVR uses chart scope;
// zoom, loaded history and local candle availability cannot change other inputs.
export function cloudAnalysisWindow(strategyId: string|undefined, candles: readonly {time: number}[]) {
  if(strategyId!=='vpvr-analysis')return {};
  if(candles.length<20||candles.length>600)throw Object.assign(new Error('VPVR_VISIBLE_RANGE_REQUIRED'),{code:'VPVR_VISIBLE_RANGE_REQUIRED'});
  const visibleFrom=Math.round(candles[0].time*1000),visibleTo=Math.round(candles.at(-1)!.time*1000);
  if(!Number.isSafeInteger(visibleFrom)||!Number.isSafeInteger(visibleTo)||visibleFrom<=0||visibleTo<=visibleFrom)
    throw Object.assign(new Error('VPVR_VISIBLE_RANGE_REQUIRED'),{code:'VPVR_VISIBLE_RANGE_REQUIRED'});
  return {analysisWindowCount:candles.length,visibleRange:{visibleFrom,visibleTo}};
}
