import { classifyTradingQuestionKinds } from "../main/trading-analysis/request-routing-policy.mjs";
import type {
  TradingAiDrawingColorToken,
  TradingAiDrawingPatch,
} from "./trading-expert-ai-playback";

type RecoveryCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function finiteCandles(values: ReadonlyArray<RecoveryCandle>) {
  return values.filter((candle) => (
    Number.isFinite(candle.time)
    && Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
    && candle.time > 0
    && candle.high >= candle.low
  ));
}

function formatPrice(value: number) {
  const digits = Math.abs(value) >= 1_000 ? 2 : Math.abs(value) >= 1 ? 4 : 6;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function intervalLabel(interval: string) {
  if (interval === "1D") return "日线";
  if (interval === "1W") return "周线";
  const minutes = Number(interval);
  if (!Number.isFinite(minutes)) return interval || "当前周期";
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`;
}

function recoveryEvidence(candles: ReadonlyArray<RecoveryCandle>) {
  const sample = candles.slice(-Math.min(80, candles.length));
  const latest = sample.at(-1)!;
  const previous = sample.slice(0, -1);
  const rangeSource = previous.length >= 4 ? previous : sample;
  const averageRange = Math.max(
    latest.close * 0.001,
    sample.reduce((total, candle) => total + Math.max(0, candle.high - candle.low), 0) / sample.length,
  );
  let resistance = Math.max(...rangeSource.map((candle) => candle.high));
  let support = Math.min(...rangeSource.map((candle) => candle.low));
  if (!(resistance > latest.close)) resistance = latest.close + averageRange;
  if (!(support < latest.close)) support = latest.close - averageRange;
  const comparison = sample[Math.max(0, sample.length - Math.min(20, sample.length))];
  const recentReturn = comparison?.close ? (latest.close - comparison.close) / comparison.close : 0;
  const midpoint = (support + resistance) / 2;
  const position = resistance > support ? (latest.close - support) / (resistance - support) : 0.5;
  const bias = recentReturn > 0.003 && position >= 0.55
    ? "bullish"
    : recentReturn < -0.003 && position <= 0.45
      ? "bearish"
      : "neutral";
  const longRisk = Math.max(resistance - support, averageRange);
  const shortRisk = longRisk;
  return {
    latest,
    support,
    resistance,
    recentReturn,
    bias,
    longTrigger: resistance,
    longInvalidation: support,
    longTarget: resistance + longRisk,
    shortTrigger: support,
    shortInvalidation: resistance,
    shortTarget: support - shortRisk,
  } as const;
}

function alignedLead(
  instruction: string,
  interval: string,
  evidence: ReturnType<typeof recoveryEvidence>,
) {
  const kinds = classifyTradingQuestionKinds(instruction);
  const biasLabel = evidence.bias === "bullish" ? "偏多" : evidence.bias === "bearish" ? "偏空" : "震荡等待";
  const direction = `基于当前 ${intervalLabel(interval)} 已收盘 K 线，盘面暂时${biasLabel}`;
  if (kinds.includes("position_risk")) {
    const shortPosition = /做空|空单|空头/iu.test(instruction);
    const longPosition = /做多|多单|多头/iu.test(instruction);
    if (shortPosition) {
      return `${direction}；你问的是空单平仓：反弹并收盘站上压力 ${formatPrice(evidence.resistance)} 附近先减仓或平仓，跌破支撑 ${formatPrice(evidence.support)} 后再观察是否继续持有。`;
    }
    if (longPosition) {
      return `${direction}；你问的是多单处理：收盘跌破支撑 ${formatPrice(evidence.support)} 附近先减仓或平仓，站上压力 ${formatPrice(evidence.resistance)} 后再观察是否继续持有。`;
    }
    return `${direction}；这是仓位管理问题，先以支撑 ${formatPrice(evidence.support)} 和压力 ${formatPrice(evidence.resistance)} 作为减仓或继续持有边界，不能只按仓位文字判断。`;
  }
  if (kinds.includes("entry")) {
    if (evidence.bias === "bullish") {
      return `${direction}；做多需等待收盘站上 ${formatPrice(evidence.longTrigger)}，止损失效参考 ${formatPrice(evidence.longInvalidation)}，第一目标参考 ${formatPrice(evidence.longTarget)}。`;
    }
    if (evidence.bias === "bearish") {
      return `${direction}；做空需等待收盘跌破 ${formatPrice(evidence.shortTrigger)}，止损失效参考 ${formatPrice(evidence.shortInvalidation)}，第一目标参考 ${formatPrice(evidence.shortTarget)}。`;
    }
    return `${direction}；站上 ${formatPrice(evidence.longTrigger)} 后再考虑多，跌破 ${formatPrice(evidence.shortTrigger)} 后再考虑空，区间中间不追单。`;
  }
  if (kinds.includes("support_resistance")) {
    return `当前关键支撑约为 ${formatPrice(evidence.support)}，关键压力约为 ${formatPrice(evidence.resistance)}；价格没有有效离开这个区间前按震荡处理。`;
  }
  if (kinds.includes("explanation")) {
    return `${direction}，依据是最近价格变化 ${(evidence.recentReturn * 100).toFixed(2)}%，且现价位于 ${formatPrice(evidence.support)}–${formatPrice(evidence.resistance)} 结构区间内。`;
  }
  return `${direction}；上破 ${formatPrice(evidence.longTrigger)} 才确认转强，跌破 ${formatPrice(evidence.shortTrigger)} 才确认转弱。`;
}

export function buildQuestionAlignedTradingLead(params: {
  instruction: string;
  interval: string;
  candles: ReadonlyArray<RecoveryCandle>;
  actionPlan?: Record<string, unknown> | null;
}) {
  const candles = finiteCandles(params.candles);
  if (candles.length < 2) return "";
  const base = recoveryEvidence(candles);
  const plan = params.actionPlan && typeof params.actionPlan === "object" ? params.actionPlan : {};
  const finite = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const rawBias = String(plan.primaryBias || plan.bias || "").toLowerCase();
  const bias = /bull|long|buy/u.test(rawBias)
    ? "bullish"
    : /bear|short|sell/u.test(rawBias)
      ? "bearish"
      : base.bias;
  const evidence = {
    ...base,
    bias,
    longTrigger: finite(plan.longTrigger, base.longTrigger),
    longInvalidation: finite(plan.longInvalidation, base.longInvalidation),
    longTarget: finite(plan.longTarget, base.longTarget),
    shortTrigger: finite(plan.shortTrigger, base.shortTrigger),
    shortInvalidation: finite(plan.shortInvalidation, base.shortInvalidation),
    shortTarget: finite(plan.shortTarget, base.shortTarget),
  } as ReturnType<typeof recoveryEvidence>;
  return alignedLead(params.instruction, params.interval, evidence);
}

export function buildRecoverableTradingAnalysis(params: {
  analysisId: string;
  marketId: string;
  symbol: string;
  interval: string;
  instruction: string;
  candles: ReadonlyArray<RecoveryCandle>;
  positionManagementRequested?: boolean;
  reason?: unknown;
}) {
  const candles = finiteCandles(params.candles);
  if (candles.length < 2) return null;
  const evidence = recoveryEvidence(candles);
  const firstTime = candles[Math.max(0, candles.length - 48)].time;
  const lastTime = evidence.latest.time;
  const positionManagementRequested = params.positionManagementRequested === true
    || classifyTradingQuestionKinds(params.instruction).includes("position_risk");
  const lead = alignedLead(params.instruction, params.interval, evidence);
  const reason = String((params.reason as Error)?.message || params.reason || "").trim();
  const recoveryNote = reason
    ? "指定分析增强暂时不可用，本次已自动采用本地确定性价格结构引擎；结论和画线只引用当前真实 K 线。"
    : "本次由本地确定性价格结构引擎完成。";
  const report = positionManagementRequested
    ? [
        `## ${params.marketId} · ${intervalLabel(params.interval)}仓位管理`,
        "",
        "### 直接回答",
        lead,
        "",
        "### 盘面依据",
        `当前盘面更接近${evidence.bias === "bullish" ? "偏多" : evidence.bias === "bearish" ? "偏空" : "震荡等待"}，现价约 ${formatPrice(evidence.latest.close)}。`,
        `关键位置：支撑 ${formatPrice(evidence.support)}，压力 ${formatPrice(evidence.resistance)}。`,
        `数据范围：${candles.length} 根 ${intervalLabel(params.interval)} K 线，最新数据 ${new Date(lastTime * 1_000).toLocaleString("zh-CN")}`,
        "",
        recoveryNote,
        "以上是条件式盘面判断，不是收益承诺；未收盘突破不作为确认。",
      ].join("\n")
    : [
        lead,
        "",
        `- 当前价：${formatPrice(evidence.latest.close)}`,
        `- 支撑 / 压力：${formatPrice(evidence.support)} / ${formatPrice(evidence.resistance)}`,
        `- 多头触发 / 失效 / 目标：${formatPrice(evidence.longTrigger)} / ${formatPrice(evidence.longInvalidation)} / ${formatPrice(evidence.longTarget)}`,
        `- 空头触发 / 失效 / 目标：${formatPrice(evidence.shortTrigger)} / ${formatPrice(evidence.shortInvalidation)} / ${formatPrice(evidence.shortTarget)}`,
        `- 数据范围：${candles.length} 根 ${intervalLabel(params.interval)} K 线，最新数据 ${new Date(lastTime * 1_000).toLocaleString("zh-CN")}`,
        "",
        recoveryNote,
        "以上是条件式盘面判断，不是收益承诺；未收盘突破不作为确认。",
      ].join("\n");
  const analysisId = `recovery-${String(params.analysisId || Date.now()).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120)}`;
  const line = (
    id: string,
    price: number,
    colorToken: TradingAiDrawingColorToken,
  ): TradingAiDrawingPatch["operations"][number] => ({
    op: "upsert" as const,
    drawing: {
      id: `${analysisId}-${id}`,
      symbol: params.marketId,
      theory: "price-action",
      layer: "ai/price-action",
      tool: "path",
      points: [{ time: firstTime, price }, { time: lastTime, price }],
      colorToken,
      locked: true as const,
      status: "confirmed",
      evidenceIds: [`recovery-${id}`],
    },
  });
  const drawingPatch: TradingAiDrawingPatch = {
    schemaVersion: 1,
    analysisId,
    baseRevision: 0,
    marketId: params.marketId,
    interval: params.interval,
    operations: [
      line("support", evidence.support, "price-action-support"),
      line("resistance", evidence.resistance, "price-action-resistance"),
      {
        op: "upsert" as const,
        drawing: {
          id: `${analysisId}-summary`,
          symbol: params.marketId,
          theory: "price-action",
          layer: "ai/price-action",
          tool: "note",
          points: [{ time: lastTime, price: evidence.latest.close }],
          text: lead.slice(0, 120),
          colorToken: "price-action-note",
          locked: true,
          status: "confirmed",
          evidenceIds: ["recovery-direction"],
        },
      },
    ],
  };
  return {
    report,
    narrative: lead,
    marketId: params.marketId,
    symbol: params.symbol,
    interval: params.interval,
    candleCount: candles.length,
    modelName: "本地确定性价格结构引擎",
    degraded: true,
    degradationReason: reason.slice(0, 300) || null,
    drawingPatch,
  };
}
