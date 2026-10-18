import {LineSeries,LineStyle,createSeriesMarkers,type UTCTimestamp} from 'lightweight-charts';
import type {TradingAiDrawingColorToken,TradingIndicatorAiDrawingPatch} from './trading-expert-ai-playback.ts';
const TRADING_INDICATOR_AI_TOOLS = new Set(["path", "note", "text"]);
const TRADING_INDICATOR_AI_COLOR_TOKENS = new Set([
  "strategy-primary", "strategy-support", "strategy-resistance", "strategy-entry",
  "strategy-stop", "strategy-target", "strategy-note",
]);
const TRADING_INDICATOR_AI_COLOR_VARIABLES: Record<TradingAiDrawingColorToken, string> = {
  "chan-pen": "--trading-ai-chan-pen",
  "chan-center": "--trading-ai-chan-center",
  "chan-top": "--trading-ai-chan-top",
  "chan-bottom": "--trading-ai-chan-bottom",
  "chan-note": "--trading-ai-chan-note",
  "order-flow-buy": "--trading-ai-order-flow-buy",
  "order-flow-sell": "--trading-ai-order-flow-sell",
  "order-flow-poc": "--trading-ai-order-flow-poc",
  "order-flow-note": "--trading-ai-order-flow-note",
  "order-flow-structure-bull": "--trading-ai-order-flow-structure-bull",
  "order-flow-structure-bear": "--trading-ai-order-flow-structure-bear",
  "order-flow-ob-bull": "--trading-ai-order-flow-ob-bull",
  "order-flow-ob-bear": "--trading-ai-order-flow-ob-bear",
  "order-flow-fvg-bull": "--trading-ai-order-flow-fvg-bull",
  "order-flow-fvg-bear": "--trading-ai-order-flow-fvg-bear",
  "order-flow-liquidity": "--trading-ai-order-flow-liquidity",
  "order-flow-equilibrium": "--trading-ai-order-flow-equilibrium",
  "order-flow-ote": "--trading-ai-order-flow-ote",
  "wave-primary": "--trading-ai-wave-primary",
  "wave-correction": "--trading-ai-wave-correction",
  "wave-alternative": "--trading-ai-wave-alternative",
  "wave-fibonacci": "--trading-ai-wave-fibonacci",
  "wave-note": "--trading-ai-wave-note",
  "wyckoff-range": "--trading-ai-wyckoff-range",
  "wyckoff-demand": "--trading-ai-wyckoff-demand",
  "wyckoff-supply": "--trading-ai-wyckoff-supply",
  "wyckoff-phase": "--trading-ai-wyckoff-phase",
  "wyckoff-event-bull": "--trading-ai-wyckoff-event-bull",
  "wyckoff-event-bear": "--trading-ai-wyckoff-event-bear",
  "wyckoff-projection": "--trading-ai-wyckoff-projection",
  "wyckoff-note": "--trading-ai-wyckoff-note",
  "price-action-trend": "--trading-ai-price-action-trend",
  "price-action-support": "--trading-ai-price-action-support",
  "price-action-resistance": "--trading-ai-price-action-resistance",
  "price-action-note": "--trading-ai-price-action-note",
  "strategy-primary": "--trading-ai-strategy-primary",
  "strategy-support": "--trading-ai-strategy-support",
  "strategy-resistance": "--trading-ai-strategy-resistance",
  "strategy-entry": "--trading-ai-strategy-entry",
  "strategy-stop": "--trading-ai-strategy-stop",
  "strategy-target": "--trading-ai-strategy-target",
  "strategy-note": "--trading-ai-strategy-note",
};

function tradingIndicatorAiLineStyle(style?: string) {
  if (style === "dotted") return LineStyle.Dotted;
  if (style === "dashed") return LineStyle.Dashed;
  return LineStyle.Solid;
}

export function normalizeTradingIndicatorAiDrawingPatch(value: unknown): TradingIndicatorAiDrawingPatch {
  const patch = value as Partial<TradingIndicatorAiDrawingPatch> | null;
  const ref=patch?.entryConditionRef;
  if(ref&&(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ref.conditionId)
    ||!Number.isSafeInteger(ref.revision)||ref.revision<1||!/^[a-f0-9]{64}$/.test(ref.conditionHash)))throw new TypeError('Indicator condition reference is invalid');
  const indicatorId = String(patch?.indicatorId || "").trim().toLowerCase();
  if (
    Number(patch?.schemaVersion) !== 1
    || !String(patch?.analysisId || "").trim()
    || !String(patch?.marketId || "").trim()
    || !String(patch?.interval || "").trim()
    || !/^[a-z][a-z0-9-]{1,63}$/.test(indicatorId)
    || !Array.isArray(patch?.operations)
    || !patch.operations.length
    || patch.operations.length > 64
  ) throw new TypeError("Indicator drawing patch is invalid");
  const operations = patch.operations.map((operation, index) => {
    const drawing = operation?.drawing;
    const strategyId = String(drawing?.strategyId || "");
    const points = Array.isArray(drawing?.points) ? drawing.points : [];
    if (
      operation?.op !== "upsert"
      || !drawing
      || drawing.theory !== "strategy"
      || !/^[a-z][a-z0-9-]{1,63}$/.test(strategyId)
      || drawing.layer !== `ai/strategy/${strategyId}`
      || !TRADING_INDICATOR_AI_TOOLS.has(drawing.tool)
      || !TRADING_INDICATOR_AI_COLOR_TOKENS.has(drawing.colorToken)
      || !points.length
      || points.length > 64
      || !points.every((point) => Number.isFinite(point?.time) && point.time > 0 && Number.isFinite(point?.value))
      || (drawing.tool === "path" && points.length < 2)
      || ((drawing.tool === "note" || drawing.tool === "text") && points.length !== 1)
    ) throw new TypeError(`Indicator drawing operation ${index} is invalid`);
    return {
      op: "upsert" as const,
      drawing: {
        id: String(drawing.id || `indicator-ai-${index}`).slice(0, 160),
        strategyId,
        theory: "strategy" as const,
        layer: `ai/strategy/${strategyId}` as const,
        tool: drawing.tool,
        points: points.map((point) => ({ time: Number(point.time), value: Number(point.value) })),
        text: typeof drawing.text === "string" ? drawing.text.slice(0, 120) : undefined,
        colorToken: drawing.colorToken,
        lineStyle: drawing.lineStyle === "solid" || drawing.lineStyle === "dashed" || drawing.lineStyle === "dotted" ? drawing.lineStyle : undefined,
        lineWidth: Number.isFinite(drawing.lineWidth) && Number(drawing.lineWidth) >= 0.5 && Number(drawing.lineWidth) <= 4 ? Number(drawing.lineWidth) : undefined,
        fontSize: Number.isFinite(drawing.fontSize) ? Number(drawing.fontSize) : undefined,
        bold: drawing.bold === true,
        markerSize: Number.isFinite(drawing.markerSize)
          && Number(drawing.markerSize) >= (drawing.tool === "text" ? 0 : 0.1)
          && Number(drawing.markerSize) <= 2
          ? Number(drawing.markerSize)
          : undefined,
        locked: true as const,
        status: drawing.status === "tentative" ? "tentative" as const : "confirmed" as const,
        evidenceIds: Array.isArray(drawing.evidenceIds) ? drawing.evidenceIds.map(String).slice(0, 32) : [],
      },
    };
  });
  return {
    schemaVersion: 1,
    analysisId: String(patch.analysisId).slice(0, 160),
    baseRevision: Math.max(0, Number(patch.baseRevision) || 0),
    marketId: String(patch.marketId),
    interval: String(patch.interval),
    indicatorId,
    ...(ref?{entryConditionRef:{conditionId:ref.conditionId,revision:ref.revision,conditionHash:ref.conditionHash}}:{}),
    operations,
  };
}

export function strictlyAscendingTradingIndicatorPathPoints(
  points: Array<{ time: number; value: number }>,
) {
  let previousTime = Number.NEGATIVE_INFINITY;
  return points
    .slice()
    .sort((first, second) => first.time - second.time)
    .map((point) => {
      const time = point.time <= previousTime ? previousTime + 1 : point.time;
      previousTime = time;
      return { time, value: point.value };
    });
}

function cloudIndicatorStorageKey(sessionId:string) {return `haolo.trading.indicator-results.v1:${encodeURIComponent(sessionId)}`;}
export function storeCloudIndicatorPatch(sessionId:string,value:unknown) {
  const patch=normalizeTradingIndicatorAiDrawingPatch(value);
  let existing:any[]=[];
  try {const parsed=JSON.parse(window.localStorage.getItem(cloudIndicatorStorageKey(sessionId))||'[]');if(Array.isArray(parsed))existing=parsed;} catch { /* Replace only the corrupt indicator cache. */ }
  const valid=existing.flatMap(value=>{try{return [normalizeTradingIndicatorAiDrawingPatch(value)];}catch{return [];}});
  const next=[...valid.filter(p=>p.marketId!==patch.marketId||p.interval!==patch.interval||p.indicatorId!==patch.indicatorId),patch].slice(-16);
  window.localStorage.setItem(cloudIndicatorStorageKey(sessionId),JSON.stringify(next));
  return patch;
}
export function loadCloudIndicatorPatch(sessionId:string,marketId:string,interval:string,indicatorId:string) {
  try {
    const rows=JSON.parse(window.localStorage.getItem(cloudIndicatorStorageKey(sessionId))||'[]');
    const value=Array.isArray(rows)?rows.find(p=>p?.marketId===marketId&&p.interval===interval&&p.indicatorId===indicatorId):null;
    return value?normalizeTradingIndicatorAiDrawingPatch(value):null;
  } catch {return null;}
}


export interface IndicatorAnalysisRuntime {pane:any;series:Array<{api:any}>;analysisSeries:any[];analysisMarkers:any;analysisSignature:string;}
export function indicatorAnalysisColor(host:HTMLElement,dark:boolean,token:TradingAiDrawingColorToken) {
  const variable=TRADING_INDICATOR_AI_COLOR_VARIABLES[token];
  return (variable&&getComputedStyle(host).getPropertyValue(variable).trim())||
    (variable&&getComputedStyle(document.documentElement).getPropertyValue(variable).trim())||(dark?'#c3a7ff':'#6d4acb');
}
export function clearIndicatorAnalysisRuntime(chart:any,runtime:IndicatorAnalysisRuntime) {
  runtime.analysisMarkers?.setMarkers?.([]);runtime.analysisMarkers?.detach?.();runtime.analysisMarkers=null;
  runtime.analysisSeries.forEach(series=>chart?.removeSeries(series));runtime.analysisSeries=[];runtime.analysisSignature='';
}
export function renderIndicatorAnalysisPatch(options:{chart:any;runtime:IndicatorAnalysisRuntime;patch:TradingIndicatorAiDrawingPatch|null;host:HTMLElement;dark:boolean;force?:boolean;timeOffsetSeconds:number}) {
  const {chart,runtime,patch,host,dark,force=false,timeOffsetSeconds}=options;
  if(!chart||!runtime.series[0])return;
  const signature=patch?JSON.stringify([patch,dark]):'';
  if(!force&&runtime.analysisSignature===signature)return;
  clearIndicatorAnalysisRuntime(chart,runtime);if(!patch)return;
  const id=patch.indicatorId;
    const markers: any[] = [];
    patch.operations.forEach(({ drawing }, operationIndex) => {
      const color = indicatorAnalysisColor(host, dark, drawing.colorToken);
      if (drawing.tool === "path") {
        const lineWidth = Math.max(1, Math.min(4, Math.round(Number(drawing.lineWidth) || 1))) as 1 | 2 | 3 | 4;
        const series = runtime.pane.addSeries(LineSeries, {
          color,
          lineWidth,
          lineStyle: tradingIndicatorAiLineStyle(drawing.lineStyle),
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: "",
          priceFormat: { type: "price" as const, precision: 4, minMove: 0.0001 },
        });
        series.setData(
          strictlyAscendingTradingIndicatorPathPoints(drawing.points)
            .map((point) => ({
              time: (point.time + timeOffsetSeconds) as UTCTimestamp,
              value: point.value,
            })),
        );
        runtime.analysisSeries.push(series);
        return;
      }
      const point = drawing.points[0];
      if (!point || (!drawing.text && drawing.markerSize === undefined)) return;
      const usesExactIndicatorAnchor = drawing.markerSize !== undefined;
      markers.push({
        time: (point.time + timeOffsetSeconds) as UTCTimestamp,
        position: usesExactIndicatorAnchor
          ? drawing.markerSize === 0
            ? "atPriceMiddle"
            : drawing.text
            ? operationIndex % 2 === 0 ? "atPriceTop" : "atPriceBottom"
            : "atPriceMiddle"
          : operationIndex % 2 === 0 ? "aboveBar" : "belowBar",
        ...(usesExactIndicatorAnchor ? { price: point.value } : {}),
        color,
        shape: "circle",
        ...(drawing.text ? { text: drawing.text } : {}),
        ...(drawing.markerSize !== undefined ? { size: drawing.markerSize } : {}),
      });
    });
    if (markers.length) {
      markers.sort((first, second) => Number(first.time) - Number(second.time));
      runtime.analysisMarkers = createSeriesMarkers(runtime.series[0].api, markers.slice(id === "rsi" || id === "kdj" ? -16 : -8), {
        autoScale: false,
        zOrder: "aboveSeries",
      });
    }
    runtime.analysisSignature = signature;
    runtime.series[0]?.api?.priceScale()?.setAutoScale(true);
  }

export function migrateCloudIndicatorPatches(from:string,to:string) {
  if(!from||from===to)return;
  let rows:unknown;try {rows=JSON.parse(window.localStorage.getItem(cloudIndicatorStorageKey(from))||'[]');}catch{return;}
  if(!Array.isArray(rows))return;
  for(const value of rows) {let patch:TradingIndicatorAiDrawingPatch;try{patch=normalizeTradingIndicatorAiDrawingPatch(value);}catch{continue;}
    if(!loadCloudIndicatorPatch(to,patch.marketId,patch.interval,patch.indicatorId))storeCloudIndicatorPatch(to,patch);
  }
}
