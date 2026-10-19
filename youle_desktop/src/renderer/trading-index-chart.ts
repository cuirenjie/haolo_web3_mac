export type IndexCandle = { time: number; open: number; high: number; low: number; close: number };
export type IndexChartResponse = {
  indexId: string; status: string; periods?: string[]; defaultPeriod?: string | null;
  period?: string; candles?: IndexCandle[]; hasMore?: boolean; fetchedAt?: number | null;
};
export const INDEX_RESOLUTIONS: Record<string,string> = { '1m':'1','5m':'5','15m':'15','1h':'60','4h':'240','1d':'1D','1w':'1W' };
export const indexPeriodFor = (resolution:string) => Object.keys(INDEX_RESOLUTIONS).find(key=>INDEX_RESOLUTIONS[key]===resolution);
export async function requestIndexChart(indexId:string, period?:string, before?:number) {
  const value=await window.codexDesktop?.getIndexChart?.({indexId,...(period?{period}:{}),...(before?{before}:{})});
  if(!value || value.indexId!==indexId || (period&&value.period!==period))throw Error('INDEX_CHART_UNAVAILABLE');
  return value;
}
