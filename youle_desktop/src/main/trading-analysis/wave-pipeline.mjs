import crypto from "node:crypto";
import { buildWaveHierarchy, runWaveTheoryEngine } from "./wave-engine.mjs";
import { runValidatedTradingModelReview } from "./model-review.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "./protocol.mjs";

// Tactical levels must stay executable in normal market conditions, while the
// structural stop itself remains the source of truth. These are broad safety
// envelopes, not reasons to discard an otherwise valid conditional plan.
const TACTICAL_TRIGGER_MAX_DISTANCE_ATR = 3;
const TACTICAL_STOP_MIN_DISTANCE_ATR = 0.6;
const TACTICAL_STOP_PREFERRED_MIN_ATR = 0.8;
const TACTICAL_STOP_PREFERRED_MAX_ATR = 2;
const TACTICAL_STOP_MAX_DISTANCE_ATR = 3.5;
const TACTICAL_STOP_MAX_DISTANCE_PERCENT = 3;
const TACTICAL_HIGHER_TF_STOP_MAX_DISTANCE_PERCENT = 6;
const TACTICAL_HIGHER_TF_STOP_NEAR_CURRENT_PERCENT = 5;
const TACTICAL_MIN_NET_RISK_REWARD = 1.2;

function extractJsonObject(text) {
  const source = String(text || "").trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new TypeError("Model response did not contain a JSON object");
  return JSON.parse(source.slice(first, last + 1));
}

function compactWaveCandidate(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id,
    kind: candidate.kind,
    pattern: candidate.pattern,
    degree: candidate.degree,
    direction: candidate.direction,
    correctionDirection: candidate.correctionDirection,
    sourceRole: candidate.sourceRole,
    sourceInterval: candidate.sourceInterval,
    status: candidate.status,
    score: candidate.score,
    labels: candidate.labels,
    points: candidate.points,
    ratios: candidate.ratios,
    subdivisions: candidate.subdivisions,
    rules: candidate.rules,
    validation: candidate.validation,
    invalidationPrice: candidate.invalidationPrice,
    confirmationPrice: candidate.confirmationPrice,
    projection: candidate.projection,
    components: candidate.components,
  };
}

function compactWaveDegreeForModel(degree) {
  if (!degree) return null;
  return {
    role: degree.role,
    interval: degree.interval,
    status: degree.status,
    snapshotId: degree.snapshotId,
    lastClosedBarTime: degree.lastClosedBarTime,
    confidence: degree.confidence,
    statistics: degree.statistics,
    structures: {
      // Fine radius-1 swings are retained in the local engine for alignment,
      // but sending hundreds of them to the model only bloats the request and
      // can cross the provider's 120k prompt contract.
      candidates: degree.structures.candidates.slice(0, 6).map(compactWaveCandidate),
      primaryCandidate: compactWaveCandidate(degree.structures.primaryCandidate),
      alternatives: degree.structures.alternatives.slice(0, 2).map(compactWaveCandidate),
    },
    signals: degree.signals.slice(0, 6),
    evidence: degree.evidence.slice(0, 24),
  };
}

function compactWaveTheoryResultForModel(theoryResult) {
  return {
    schemaVersion: theoryResult.schemaVersion,
    resultId: theoryResult.resultId,
    engineId: theoryResult.engineId,
    engineVersion: theoryResult.engineVersion,
    snapshotId: theoryResult.snapshotId,
    lastClosedBarTime: theoryResult.lastClosedBarTime,
    status: theoryResult.status,
    direction: theoryResult.direction,
    fallback: theoryResult.fallback,
    coverage: theoryResult.coverage,
    confidence: theoryResult.confidence,
    statistics: theoryResult.statistics,
    structures: {
      candidates: theoryResult.structures.candidates.slice(0, 12).map(compactWaveCandidate),
      primaryCandidate: compactWaveCandidate(theoryResult.structures.primaryCandidate),
      alternatives: theoryResult.structures.alternatives.slice(0, 3).map(compactWaveCandidate),
    },
    multiTimeframe: {
      analysisInterval: theoryResult.multiTimeframe?.analysisInterval,
      structureInterval: theoryResult.multiTimeframe?.structureInterval,
      executionInterval: theoryResult.multiTimeframe?.executionInterval,
      structure: compactWaveDegreeForModel(theoryResult.multiTimeframe?.structure),
      execution: compactWaveDegreeForModel(theoryResult.multiTimeframe?.execution),
    },
    hierarchy: theoryResult.hierarchy
      ? {
        direction: theoryResult.hierarchy.direction,
        parentRole: theoryResult.hierarchy.parentRole,
        activeParentStartTime: theoryResult.hierarchy.activeParentStartTime,
        analysis: {
          role: theoryResult.hierarchy.analysis.role,
          interval: theoryResult.hierarchy.analysis.interval,
          candidateInterval: theoryResult.hierarchy.analysis.candidateInterval,
          macroConfirmation: theoryResult.hierarchy.analysis.macroConfirmation,
          macroInvalidation: theoryResult.hierarchy.analysis.macroInvalidation,
        },
        structure: {
          role: theoryResult.hierarchy.structure.role,
          interval: theoryResult.hierarchy.structure.interval,
          status: theoryResult.hierarchy.structure.status,
          aligned: theoryResult.hierarchy.structure.aligned,
          candidateId: theoryResult.hierarchy.structure.candidate?.id || null,
        },
        execution: {
          role: theoryResult.hierarchy.execution.role,
          interval: theoryResult.hierarchy.execution.interval,
          status: theoryResult.hierarchy.execution.status,
          aligned: theoryResult.hierarchy.execution.aligned,
          candidateId: theoryResult.hierarchy.execution.candidate?.id || null,
        },
      }
      : null,
    evidence: theoryResult.evidence.slice(0, 48),
  };
}

export function buildWaveModelPrompt(snapshot, theoryResult, context = {}) {
  const directAnswer = context.responseMode === "direct";
  const compactCandles = snapshot.candles.slice(-120).map((candle) => [
    candle.time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]);
  return [
    "你是交易分析系统中的艾略特波浪候选复核器，不负责直接操作界面。",
    "确定性引擎已从真实 OHLCV 识别不同级别摆动点。只有同时通过价格硬规则与低一级内部结构证据的标准推动浪、A-B-C、W-X-Y 及其首尾相接周期才会进入候选；波4重叠绝不会自动改名为倾斜，位置、楔形和内部结构未验证的倾斜不会进入候选；五浪未创新高/新低只有在短缺幅度很小且内部五浪已验证时才按截短候选处理。",
    "波浪计数具有级别和起点歧义。优先从当前分析周期的 kind=cycle 且 components.structureVerified=true 的完整周期中选择主计数；若当前分析周期没有候选，确定性引擎会按 structureInterval → executionInterval 提供低周期兜底候选，此时必须在 report 中明确说明使用了哪个低周期，不能把它冒充成主周期计数。只有没有完整周期时才选择已通过硬规则的单段候选。你只能选择给定候选 ID，不得创造、删减或重排候选之外的浪点、价格、时间和历史事实，也不得把候选外的重叠结构解释成倾斜例外；末端未确认时必须说明暂定。",
    directAnswer
      ? "本次只刷新分析并回答用户的具体问题，不更新画布。report 必须第一句直接作答，后续只写必要依据，不得套用完整盘面报告或固定章节。"
      : "本次需要生成完整盘面分析与受控绘图计划。",
    "面向用户必须先区分主周期结构边界和低周期战术执行价。确定性 actionLevels 在有波浪候选、现价和 ATR 时必须尽量提供单边条件执行单；低周期子浪缺失或暂定时，使用最近可用的已确认结构、波浪失效位或 ATR 波动率锚点兜底，并在 report 明确标注兜底来源，不能把它冒充成已确认微浪。对于 4H/1H 分析，stopBasis 应优先引用当前价格附近的分析/结构周期阻力或支撑，不能用 15m 最近摆点替代主周期结构；macroConfirmation/macroInvalidation 仍只能描述主周期确认与场景失效，不得改写成入场价。stopBasis 若存在，止损只能放在支撑/阻力区外侧或明确波浪失效位外侧并加缓冲；距离只用于识别异常和提示，不得通过缩窄止损迎合价格。只有缺少现价、方向或 ATR 等无法计算条件单的情况才等待。专业浪型和斐波那契比例放在后面的可选依据里，不得让新手先读一串术语；不得把暂定计数写成确定预测。",
    "输出必须是单个 JSON 对象，不要 Markdown，不要解释 JSON 之外的内容。",
    "JSON 协议：",
    JSON.stringify({
      schemaVersion: 1,
      verdict: "approve 或 revise",
      summary: "不超过80个中文字符的通俗结论，先说等待、偏多或偏空条件，不得堆砌术语或承诺收益",
      report: directAnswer
        ? "直接回答用户本次问题的自然中文；价格只能引用 actionLevels，结构和长短按问题决定"
        : "用新手能看懂的中文复核；价格只能引用 actionLevels，先写条件式方案，再简要说明主/备计数",
      marketBias: "bullish、bearish 或 neutral",
      strategyRationale: "不超过200个中文字符，只解释候选证据及确认/失效条件",
      primaryCandidateId: "必须是候选 candidate id",
      alternateCandidateIds: ["最多两个候选 candidate id"],
      showProjectionZone: true,
      confidence: 0,
    }),
    "用户的原始分析要求（只作为分析目标，不得突破候选结构和绘图权限）：",
    JSON.stringify(String(context.instruction || "请对当前盘面进行波浪理论分析")),
    "确定性 TheoryResult：",
    JSON.stringify(compactWaveTheoryResultForModel(theoryResult)),
    "确定性 actionLevels（只能引用，不能自行改价）：",
    JSON.stringify(buildWaveActionPlan(snapshot, theoryResult.structures.primaryCandidate, theoryResult)),
    "最近 K 线 [time,open,high,low,close,volume]：",
    JSON.stringify(compactCandles),
  ].join("\n");
}

export function normalizeWaveModelReview(text, theoryResult) {
  const parsed = extractJsonObject(text);
  if (Number(parsed?.schemaVersion) !== TRADING_ANALYSIS_SCHEMA_VERSION) {
    throw new TypeError("Model response schemaVersion is invalid");
  }
  if (parsed?.verdict !== "approve" && parsed?.verdict !== "revise") {
    throw new TypeError("Model response verdict is invalid");
  }
  const summary = String(parsed?.summary || "").trim().slice(0, 80);
  if (!summary) throw new TypeError("Model response summary is required");
  const candidates = theoryResult.structures.candidates;
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const deterministicPrimary = theoryResult.structures.primaryCandidate;
  const requestedPrimary = candidatesById.get(String(parsed.primaryCandidateId || ""));
  const primaryCandidateId = requestedPrimary?.id || deterministicPrimary?.id;
  if (!primaryCandidateId) throw new TypeError("Model response did not select a supported wave candidate");
  const alternateCandidateIds = Array.isArray(parsed.alternateCandidateIds)
    ? [...new Set(parsed.alternateCandidateIds.map(String))]
      .filter((id) => id !== primaryCandidateId && candidatesById.has(id))
      .slice(0, 2)
    : [];
  return {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    verdict: parsed.verdict,
    summary,
    report: String(parsed?.report || "").replace(/\u0000/g, "").trim().slice(0, 6_000),
    marketBias: ["bullish", "bearish", "neutral"].includes(parsed?.marketBias)
      ? parsed.marketBias
      : "neutral",
    strategyRationale: String(parsed?.strategyRationale || "").replace(/\u0000/g, "").trim().slice(0, 200),
    primaryCandidateId,
    alternateCandidateIds,
    showProjectionZone: parsed.showProjectionZone !== false,
    confidence: clamp(Number(parsed.confidence) || 0, 0, 1),
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatRatio(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "—";
}

function formatTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Date(value * 1_000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function plainIntervalLabel(interval) {
  if (interval === "1D") return "日线";
  if (interval === "1W") return "周线";
  const minutes = Number(interval);
  if (!Number.isFinite(minutes)) return String(interval || "当前周期");
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}小时`;
  return `${minutes}分钟`;
}

function nearestPriceAbove(values, reference) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > reference * 1.00005)
    .sort((first, second) => first - second)[0] ?? null;
}

function nearestPriceBelow(values, reference) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value < reference * 0.99995)
    .sort((first, second) => second - first)[0] ?? null;
}

function intervalSeconds(interval) {
  const normalized = String(interval || "").trim().toUpperCase();
  if (normalized === "1D") return 86_400;
  if (normalized === "1W") return 604_800;
  const minutes = Number(normalized);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : 0;
}

function netRiskReward(entry, stop, target, direction, costRate = 0.002) {
  if (![entry, stop, target].every(Number.isFinite) || entry <= 0) return 0;
  const directionalRisk = direction === "bullish" ? entry - stop : stop - entry;
  const directionalReward = direction === "bullish" ? target - entry : entry - target;
  if (directionalRisk <= 0 || directionalReward <= 0) return 0;
  const riskRate = directionalRisk / entry + costRate;
  const rewardRate = directionalReward / entry - costRate;
  return riskRate > Number.EPSILON ? Math.max(0, rewardRate) / riskRate : 0;
}

function waveProjectionMeasurement(candidate) {
  const points = Array.isArray(candidate?.points) ? candidate.points : [];
  const terminal = points.at(-1);
  if (!terminal || !Number.isFinite(Number(terminal.price))) return null;
  if (candidate.kind === "cycle") {
    const impulsePointCount = Math.max(2, Math.min(points.length, Number(candidate.components?.impulsePointCount) || 6));
    const impulseStart = points[0];
    const impulseEnd = points[impulsePointCount - 1];
    const span = Math.abs(Number(impulseEnd?.price) - Number(impulseStart?.price));
    return span > 0
      ? {
        anchor: Number(terminal.price),
        span,
        ratios: [0.382, 0.618, 1],
        basis: "prior_impulse_projection",
        anchorPointId: terminal.id,
        sourcePointIds: [impulseStart.id, impulseEnd.id],
      }
      : null;
  }
  if (candidate.kind === "correction") {
    const correctionStart = points[0];
    const span = Math.abs(Number(terminal.price) - Number(correctionStart?.price));
    return span > 0
      ? {
        anchor: Number(terminal.price),
        span,
        ratios: [0.382, 0.618, 1],
        basis: "completed_correction_retracement",
        anchorPointId: terminal.id,
        sourcePointIds: [correctionStart.id, terminal.id],
      }
      : null;
  }
  const start = points[0];
  const span = Math.abs(Number(terminal.price) - Number(start?.price));
  return span > 0
    ? {
      anchor: Number(terminal.price),
      span,
      ratios: [0.382, 0.5, 0.618],
      basis: "motive_move_retracement",
      anchorPointId: terminal.id,
      sourcePointIds: [start?.id, terminal.id].filter(Boolean),
    }
    : null;
}

function waveMeasurementLabel(measurement, ratio) {
  const basis = new Map([
    ["prior_impulse_projection", "前一推动段投影"],
    ["completed_correction_retracement", "已完成调整段回撤"],
    ["motive_move_retracement", "已完成推动段回撤"],
  ]).get(measurement?.basis) || "候选浪段测量";
  return `${basis} Fib ${ratio}`;
}

function waveTargetLevels(candidate, direction, trigger) {
  const sign = direction === "bullish" ? 1 : -1;
  const measurement = waveProjectionMeasurement(candidate);
  const levels = [];
  if (measurement) {
    for (const ratio of measurement.ratios) {
      levels.push({
        price: measurement.anchor + sign * measurement.span * ratio,
        ratio,
        basis: measurement.basis,
        label: waveMeasurementLabel(measurement, ratio),
        sourcePointIds: measurement.sourcePointIds,
      });
    }
  }
  const projection = candidate?.projection || {};
  for (const value of [projection.low, projection.high]) {
    if (Number.isFinite(Number(value))) {
      levels.push({
        price: Number(value),
        ratio: null,
        basis: "candidate_projection",
        label: "候选结构投影",
        sourcePointIds: candidate.points.map((point) => point.id),
      });
    }
  }
  const seen = new Set();
  return levels
    .filter((level) => Number.isFinite(level.price)
      && level.price > 0
      && (direction === "bullish" ? level.price > trigger : level.price < trigger))
    .sort((first, second) => direction === "bullish" ? first.price - second.price : second.price - first.price)
    .filter((level) => {
      const key = level.price.toFixed(8);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function averageTrueRange(candles, period = 14) {
  if (!Array.isArray(candles) || !candles.length) return 0;
  const ranges = candles.map((candle, index) => {
    const previousClose = index > 0 ? Number(candles[index - 1].close) : Number(candle.close);
    return Math.max(
      Number(candle.high) - Number(candle.low),
      Math.abs(Number(candle.high) - previousClose),
      Math.abs(Number(candle.low) - previousClose),
    );
  }).filter((value) => Number.isFinite(value) && value >= 0);
  if (!ranges.length) return 0;
  const count = Math.min(period, ranges.length);
  return ranges.slice(-count).reduce((total, value) => total + value, 0) / count;
}

function contextCandlesFor(snapshot, interval) {
  const normalized = String(interval || "");
  if (!normalized || normalized === String(snapshot.interval || "")) return snapshot.candles;
  return snapshot.contextCandles?.find((context) => String(context.interval) === normalized)?.candles || [];
}

function structuralPivotLevels(candles, kind, sourceRole, sourceInterval) {
  if (!Array.isArray(candles) || candles.length < 7) return [];
  const radius = candles.length >= 160 ? 3 : 2;
  const levels = [];
  for (let index = radius; index < candles.length - radius; index += 1) {
    const candle = candles[index];
    const neighbours = candles.slice(index - radius, index + radius + 1)
      .filter((_, offset) => offset !== radius);
    const price = kind === "resistance" ? Number(candle.high) : Number(candle.low);
    const neighbourExtreme = kind === "resistance"
      ? Math.max(...neighbours.map((item) => Number(item.high)))
      : Math.min(...neighbours.map((item) => Number(item.low)));
    const isPivot = kind === "resistance" ? price > neighbourExtreme : price < neighbourExtreme;
    if (!isPivot || !Number.isFinite(price) || price <= 0) continue;
    levels.push({
      id: `wave-${kind}-${sourceRole}-${sourceInterval}-${candle.time}`,
      price,
      time: Number(candle.time),
      sourceRole,
      sourceInterval,
    });
  }
  return levels;
}

function structuralCandidateLevels(hierarchy, kind) {
  const candidateSources = [
    {
      candidate: hierarchy?.analysis?.candidate,
      includeTerminal: true,
      sourceRole: hierarchy?.analysis?.role || "analysis",
      sourceInterval: hierarchy?.analysis?.candidateInterval || hierarchy?.analysis?.interval,
    },
    {
      candidate: hierarchy?.structure?.candidate,
      includeTerminal: true,
      sourceRole: "structure",
      sourceInterval: hierarchy?.structure?.interval,
    },
    // An earlier confirmed execution pivot may reinforce a higher-degree zone;
    // the still-forming terminal point is deliberately excluded from the stop.
    {
      candidate: hierarchy?.execution?.candidate,
      includeTerminal: false,
      sourceRole: "execution",
      sourceInterval: hierarchy?.execution?.interval,
    },
  ].filter(({ candidate }) => candidate);
  const candidateLevels = candidateSources.flatMap(({ candidate, includeTerminal, sourceRole, sourceInterval }) => {
    const points = includeTerminal ? candidate.points : candidate.points.slice(0, -1);
    return points
      .filter((point) => (
        point.status === "confirmed"
        && (kind === "resistance" ? point.type === "high" : point.type === "low")
        && Number.isFinite(Number(point.price))
        && Number(point.price) > 0
      ))
      .map((point) => ({
        id: point.id,
        price: Number(point.price),
        time: Number(point.time),
        sourceRole: candidate.sourceRole || sourceRole,
        sourceInterval: candidate.sourceInterval || sourceInterval || "",
      }));
  });
  const executionSwingLevels = (hierarchy?.execution?.swings || [])
    .filter((swing) => (
      swing.status === "confirmed"
      && (kind === "resistance" ? swing.type === "high" : swing.type === "low")
      && Number.isFinite(Number(swing.price))
      && Number(swing.price) > 0
    ))
    .map((swing) => ({
      id: swing.id,
      price: Number(swing.price),
      time: Number(swing.time),
      sourceRole: "execution",
      sourceInterval: hierarchy?.execution?.interval || "",
    }));
  return [...candidateLevels, ...executionSwingLevels];
}

function structuralZoneBroken(zone, levels, candlesByInterval, kind) {
  const latestLevelTime = Math.max(...levels.map((level) => Number(level.time) || 0));
  return levels.some((level) => {
    const candles = candlesByInterval.get(String(level.sourceInterval || "")) || [];
    return candles.some((candle) => (
      Number(candle.time) > latestLevelTime
      && (kind === "resistance"
        ? Number(candle.close) > zone.upper
        : Number(candle.close) < zone.lower)
    ));
  });
}

function buildStructuralStopZone(snapshot, hierarchy, direction, referencePrice) {
  const kind = direction === "bullish" ? "support" : "resistance";
  const executionInterval = hierarchy?.execution?.interval || snapshot.interval;
  const executionCandles = contextCandlesFor(snapshot, executionInterval);
  const executionAtr = Number(hierarchy?.execution?.atr) || averageTrueRange(executionCandles);
  const currentPrice = Number(snapshot.candles.at(-1)?.close) || Number(referencePrice) || 0;
  if (!executionCandles.length || !executionAtr || !currentPrice) return null;

  const degreeSpecs = [
    { role: "analysis", interval: snapshot.interval, candles: snapshot.candles, weight: 5 },
    {
      role: "structure",
      interval: hierarchy?.structure?.interval,
      candles: contextCandlesFor(snapshot, hierarchy?.structure?.interval),
      weight: 4,
    },
    { role: "execution", interval: executionInterval, candles: executionCandles, weight: 1.5 },
  ].filter((spec) => spec.interval && spec.candles.length >= 7);
  const candlesByInterval = new Map(degreeSpecs.map((spec) => [String(spec.interval), spec.candles]));
  const levels = degreeSpecs.flatMap((spec) => structuralPivotLevels(
    spec.candles,
    kind,
    spec.role,
    spec.interval,
  ).map((level) => ({ ...level, weight: spec.weight })));
  levels.push(...structuralCandidateLevels(hierarchy, kind).map((level) => ({
    ...level,
    weight: level.sourceRole === "analysis" ? 4.5 : level.sourceRole === "execution" ? 2 : 3.5,
  })));
  if (!levels.length) return null;

  const stopDistanceCap = (sideReference, higherDegree = false) => (
    sideReference * ((higherDegree
      ? TACTICAL_HIGHER_TF_STOP_MAX_DISTANCE_PERCENT
      : TACTICAL_STOP_MAX_DISTANCE_PERCENT) / 100)
  );
  const levelTolerance = Math.max(executionAtr * 0.35, currentPrice * 0.0015);
  const zonePadding = Math.max(executionAtr * 0.12, currentPrice * 0.0005);
  const sorted = levels
    .filter((level) => Number.isFinite(level.price) && level.price > 0)
    .sort((first, second) => first.price - second.price || second.time - first.time);
  const clusters = [];
  for (const level of sorted) {
    const previous = clusters.at(-1);
    // Keep a zone compact around its first touch; transitive chaining of
    // many nearby pivots must not turn a narrow level into a whole price band.
    if (previous && level.price - previous[0].price <= levelTolerance) previous.push(level);
    else clusters.push([level]);
  }
  const zones = clusters.map((cluster) => {
    const rawLower = Math.min(...cluster.map((level) => level.price));
    const rawUpper = Math.max(...cluster.map((level) => level.price));
    const zone = {
      lower: rawLower - zonePadding,
      upper: rawUpper + zonePadding,
    };
    const sourceRoles = [...new Set(cluster.map((level) => level.sourceRole))];
    const sourceIntervals = [...new Set(cluster.map((level) => level.sourceInterval).filter(Boolean))];
    const highestWeight = Math.max(...cluster.map((level) => Number(level.weight) || 0));
    const evidenceIds = [...new Set(cluster.map((level) => level.id))];
    const touchCount = evidenceIds.length;
    const higherDegreeEvidence = cluster.some((level) => ["analysis", "structure"].includes(level.sourceRole));
    const broken = structuralZoneBroken(zone, cluster, candlesByInterval, kind);
    const score = highestWeight
      + Math.min(touchCount, 4) * 0.55
      + Math.max(0, sourceIntervals.length - 1) * 0.35
      + (higherDegreeEvidence ? 0.75 : 0)
      - (broken ? 3 : 0);
    return {
      ...zone,
      rawLower,
      rawUpper,
      width: zone.upper - zone.lower,
      sourceRoles,
      sourceIntervals,
      highestWeight,
      touchCount,
      higherDegreeEvidence,
      broken,
      score,
      evidenceIds,
      latestTime: Math.max(...cluster.map((level) => Number(level.time) || 0)),
    };
  }).filter((zone) => !zone.broken && (zone.higherDegreeEvidence || zone.touchCount >= 2));

  const sideReference = Number(referencePrice) || currentPrice;
  const higherDegreeCurrentDistanceCap = currentPrice
    * (TACTICAL_HIGHER_TF_STOP_NEAR_CURRENT_PERCENT / 100);
  const tickSize = Number(snapshot.tickSize) > 0 ? Number(snapshot.tickSize) : 0;
  const minimumBuffer = Math.max(executionAtr * 0.15, tickSize * 2, currentPrice * 0.00005);
  const candidates = zones.map((zone) => ({
    ...zone,
    bufferFloor: minimumBuffer,
    tickSize: tickSize || null,
  })).filter((zone) => {
    const higherDegree = zone.sourceRoles.some((role) => ["analysis", "structure"].includes(role));
    const maximumStopDistancePercent = higherDegree
      ? TACTICAL_HIGHER_TF_STOP_MAX_DISTANCE_PERCENT
      : TACTICAL_STOP_MAX_DISTANCE_PERCENT;
    const currentDistance = kind === "resistance"
      ? zone.upper - currentPrice
      : currentPrice - zone.lower;
    const referenceDistance = kind === "resistance"
      ? zone.upper - sideReference + minimumBuffer
      : sideReference - zone.lower + minimumBuffer;
    return kind === "resistance"
      ? zone.rawUpper > sideReference
        && zone.upper > currentPrice
        && referenceDistance <= stopDistanceCap(sideReference, higherDegree)
        && (!higherDegree || currentDistance <= higherDegreeCurrentDistanceCap)
      : zone.rawLower < sideReference
        && zone.lower < currentPrice
        && referenceDistance <= stopDistanceCap(sideReference, higherDegree)
        && (!higherDegree || currentDistance <= higherDegreeCurrentDistanceCap);
  });
  if (!candidates.length) return null;
  const selected = candidates.sort((first, second) => (
    Number(second.sourceRoles.includes("analysis"))
      - Number(first.sourceRoles.includes("analysis"))
      || Number(second.sourceRoles.includes("structure"))
        - Number(first.sourceRoles.includes("structure"))
      || Number(kind === "resistance" ? second.rawLower >= sideReference : second.rawUpper <= sideReference)
        - Number(kind === "resistance" ? first.rawLower >= sideReference : first.rawUpper <= sideReference)
      || second.score - first.score
      || Math.abs((kind === "resistance" ? first.upper : first.lower) - sideReference)
        - Math.abs((kind === "resistance" ? second.upper : second.lower) - sideReference)
      || second.latestTime - first.latestTime
  ))[0];
  const selectedMaximumStopDistancePercent = selected.higherDegreeEvidence
    ? TACTICAL_HIGHER_TF_STOP_MAX_DISTANCE_PERCENT
    : TACTICAL_STOP_MAX_DISTANCE_PERCENT;
  return {
    ...selected,
    maximumStopDistancePercent: selectedMaximumStopDistancePercent,
    maximumStopDistanceAtr: Math.max(
      TACTICAL_STOP_MAX_DISTANCE_ATR,
      stopDistanceCap(sideReference, selected.higherDegreeEvidence)
        / Math.max(executionAtr, Number.EPSILON),
    ),
  };
}

function directionalPriceIsValid(price, direction, referencePrice) {
  const value = Number(price);
  const reference = Number(referencePrice);
  if (!Number.isFinite(value) || !Number.isFinite(reference) || value <= 0) return false;
  return direction === "bullish"
    ? value > reference * 1.00005
    : value < reference * 0.99995;
}

function triggerAnchorForHierarchy(snapshot, hierarchy, direction, currentPrice, atr) {
  const triggerType = direction === "bullish" ? "high" : "low";
  const sources = [
    {
      candidate: hierarchy?.execution?.candidate,
      role: "execution",
      interval: hierarchy?.execution?.interval,
      priority: 0,
    },
    {
      candidate: hierarchy?.structure?.candidate,
      role: "structure",
      interval: hierarchy?.structure?.interval,
      priority: 1,
    },
    {
      candidate: hierarchy?.analysis?.candidate,
      role: hierarchy?.analysis?.role || "analysis",
      interval: hierarchy?.analysis?.candidateInterval || hierarchy?.analysis?.interval,
      priority: 2,
    },
  ];
  const anchors = [];
  for (const source of sources) {
    const candidate = source.candidate;
    if (!candidate) continue;
    const confirmationPrice = Number(candidate.confirmationPrice);
    if (directionalPriceIsValid(confirmationPrice, direction, currentPrice)) {
      anchors.push({
        price: confirmationPrice,
        role: source.role,
        interval: source.interval,
        priority: source.priority,
        basis: "confirmed_wave_boundary",
        evidenceIds: candidate.points?.at(-1)?.id ? [candidate.points.at(-1).id] : [],
      });
    }
    for (const point of Array.isArray(candidate.points) ? candidate.points : []) {
      if (point.status !== "confirmed" || point.type !== triggerType) continue;
      if (!directionalPriceIsValid(point.price, direction, currentPrice)) continue;
      anchors.push({
        price: Number(point.price),
        role: source.role,
        interval: source.interval,
        priority: source.priority + 0.5,
        basis: "confirmed_wave_pivot",
        evidenceIds: point.id ? [point.id] : [],
      });
    }
  }
  const macroConfirmation = Number(hierarchy?.analysis?.macroConfirmation);
  if (directionalPriceIsValid(macroConfirmation, direction, currentPrice)) {
    anchors.push({
      price: macroConfirmation,
      role: "analysis",
      interval: hierarchy?.analysis?.interval || snapshot.interval,
      priority: 3,
      basis: "macro_confirmation_fallback",
      evidenceIds: hierarchy?.analysis?.candidate?.points?.at(-1)?.id
        ? [hierarchy.analysis.candidate.points.at(-1).id]
        : [],
    });
  }
  const selected = anchors.sort((first, second) => (
    Math.abs(first.price - currentPrice) - Math.abs(second.price - currentPrice)
      || first.priority - second.priority
  ))[0];
  if (selected) return selected;

  const fallbackDistance = Math.max(atr * 0.6, currentPrice * 0.001);
  return {
    price: direction === "bullish" ? currentPrice + fallbackDistance : currentPrice - fallbackDistance,
    role: "volatility",
    interval: hierarchy?.execution?.interval || hierarchy?.structure?.interval || snapshot.interval,
    priority: 4,
    basis: "atr_volatility_fallback",
    evidenceIds: [],
  };
}

function fallbackStructuralStopZone(snapshot, hierarchy, direction, referencePrice, atr) {
  const kind = direction === "bullish" ? "support" : "resistance";
  const currentPrice = Number(snapshot.candles.at(-1)?.close) || Number(referencePrice) || 0;
  const executionInterval = hierarchy?.execution?.interval || snapshot.interval;
  const tickSize = Number(snapshot.tickSize) > 0 ? Number(snapshot.tickSize) : 0;
  const zonePadding = Math.max(atr * 0.12, currentPrice * 0.0005, tickSize * 2);
  const structureInterval = hierarchy?.structure?.interval;
  const structureCandles = contextCandlesFor(snapshot, structureInterval);
  const higherTimeframeLevels = [
    ...structuralPivotLevels(snapshot.candles, kind, "analysis", snapshot.interval),
    ...structuralPivotLevels(structureCandles, kind, "structure", structureInterval),
  ];
  const levels = [
    ...higherTimeframeLevels,
    ...structuralCandidateLevels(hierarchy, kind),
  ].filter((level) => Number.isFinite(Number(level.price)) && Number(level.price) > 0);
  const hasHigherDegree = String(snapshot.interval || "") !== String(executionInterval || "");
  const higherStopDistanceCap = Number(referencePrice)
    * (TACTICAL_HIGHER_TF_STOP_MAX_DISTANCE_PERCENT / 100);
  const executionStopDistanceCap = Number(referencePrice)
    * (TACTICAL_STOP_MAX_DISTANCE_PERCENT / 100);
  const macroStopDistanceCap = hasHigherDegree ? higherStopDistanceCap : executionStopDistanceCap;
  const higherDegreeCurrentDistanceCap = currentPrice
    * (TACTICAL_HIGHER_TF_STOP_NEAR_CURRENT_PERCENT / 100);
  const sideOfReference = (level) => kind === "support"
    ? Number(level.price) < Number(referencePrice)
    : Number(level.price) > Number(referencePrice);
  const sideOfCurrent = (level) => kind === "support"
    ? Number(level.price) < currentPrice
    : Number(level.price) > currentPrice;
  const rolePriority = (level) => level.sourceRole === "analysis"
    ? 0
    : level.sourceRole === "structure" ? 1 : 2;
  const higherCandidates = levels
    .filter(() => hasHigherDegree)
    .filter((level) => ["analysis", "structure"].includes(level.sourceRole))
    .filter((level) => sideOfCurrent(level)
      && Math.abs(Number(level.price) - currentPrice) <= higherDegreeCurrentDistanceCap
      && Math.abs(Number(level.price) - Number(referencePrice)) <= higherStopDistanceCap)
    .sort((first, second) => (
      rolePriority(first) - rolePriority(second)
      || Math.abs(Number(first.price) - currentPrice) - Math.abs(Number(second.price) - currentPrice)
      || Number(second.time) - Number(first.time)
    ));
  const nearestCandidates = levels
    .filter((level) => !["analysis", "structure"].includes(level.sourceRole))
    .filter((level) => sideOfReference(level))
    .filter((level) => Math.abs(Number(level.price) - Number(referencePrice)) <= executionStopDistanceCap)
    .sort((first, second) => (
      Math.abs(Number(first.price) - Number(referencePrice))
        - Math.abs(Number(second.price) - Number(referencePrice))
        || rolePriority(first) - rolePriority(second)
        || Number(second.time) - Number(first.time)
    ));
  const macroInvalidation = Number(hierarchy?.analysis?.macroInvalidation);
  const macroValid = kind === "support"
    ? macroInvalidation > 0 && macroInvalidation < Number(referencePrice)
    : macroInvalidation > Number(referencePrice);
  const selected = higherCandidates[0] || nearestCandidates[0] || (macroValid
    && Math.abs(Number(referencePrice) - macroInvalidation) <= macroStopDistanceCap
    ? {
        price: macroInvalidation,
        role: "analysis",
        interval: hierarchy?.analysis?.interval || snapshot.interval,
        evidenceIds: hierarchy?.analysis?.candidate?.points?.at(-1)?.id
          ? [hierarchy.analysis.candidate.points.at(-1).id]
          : [],
        basis: "wave_invalidation_fallback",
      }
    : null);
  const selectedHigherDegree = Boolean(
    hasHigherDegree && selected && ["analysis", "structure"].includes(selected.role),
  );
  const maximumStopDistancePercent = selectedHigherDegree
    ? TACTICAL_HIGHER_TF_STOP_MAX_DISTANCE_PERCENT
    : TACTICAL_STOP_MAX_DISTANCE_PERCENT;
  const selectedStopDistanceCap = Number(referencePrice) * (maximumStopDistancePercent / 100);
  const fallbackDistance = Math.min(
    selectedStopDistanceCap * 0.8,
    Math.max(atr * 1.2, Number(referencePrice) * 0.01),
  );
  const anchor = selected?.price || (direction === "bullish"
    ? Number(referencePrice) - fallbackDistance
    : Number(referencePrice) + fallbackDistance);
  const safeAnchor = direction === "bullish"
    ? Math.min(anchor, Number(referencePrice) - Math.max(zonePadding, atr * 0.25))
    : Math.max(anchor, Number(referencePrice) + Math.max(zonePadding, atr * 0.25));
  return {
    lower: safeAnchor - zonePadding,
    upper: safeAnchor + zonePadding,
    rawLower: safeAnchor,
    rawUpper: safeAnchor,
    width: zonePadding * 2,
    sourceRoles: [selected?.role || "volatility"],
    sourceIntervals: [selected?.interval || executionInterval].filter(Boolean),
    highestWeight: selected?.role === "analysis" ? 5 : 2,
    touchCount: selected ? 1 : 0,
    higherDegreeEvidence: selectedHigherDegree,
    broken: false,
    score: selected ? 1 : 0,
    evidenceIds: selected?.evidenceIds || [],
    latestTime: 0,
    bufferFloor: Math.max(atr * 0.2, tickSize * 2, currentPrice * 0.00005),
    tickSize: tickSize || null,
    fallback: true,
    fallbackReason: selected?.basis || "atr_volatility_fallback",
    maximumStopDistancePercent,
    maximumStopDistanceAtr: Math.max(
      TACTICAL_STOP_MAX_DISTANCE_ATR,
      selectedStopDistanceCap / Math.max(atr, Number.EPSILON),
    ),
  };
}

function riskFallbackTargetLevels(trigger, stop, direction, atr) {
  const risk = Math.max(Math.abs(Number(trigger) - Number(stop)), atr * TACTICAL_STOP_MIN_DISTANCE_ATR);
  const sign = direction === "bullish" ? 1 : -1;
  return [1, 1.5, 2.2].map((multiple) => ({
    price: Number(trigger) + sign * risk * multiple,
    ratio: multiple,
    basis: "risk_multiple_fallback",
    label: `结构风险倍数兜底目标 R${multiple}`,
    sourcePointIds: [],
  })).filter((level) => level.price > 0);
}

function ensureWaveTargetLevels(levels, trigger, stop, direction, atr) {
  const validLevels = (Array.isArray(levels) ? levels : [])
    .filter((level) => Number.isFinite(Number(level?.price))
      && directionalPriceIsValid(level.price, direction, trigger));
  const existingFinal = validLevels.at(-1)?.price;
  const risk = Math.abs(Number(trigger) - Number(stop));
  const minimumReward = risk * 1.35 + Number(trigger) * 0.004;
  if (existingFinal !== undefined
      && Math.abs(Number(existingFinal) - Number(trigger)) >= minimumReward) {
    return validLevels;
  }
  const fallback = riskFallbackTargetLevels(trigger, stop, direction, atr);
  const combined = [...validLevels, ...fallback];
  const seen = new Set();
  return combined
    .filter((level) => {
      const key = Number(level.price).toFixed(8);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((first, second) => direction === "bullish"
      ? Number(first.price) - Number(second.price)
      : Number(second.price) - Number(first.price))
    .slice(0, 4);
}

function tacticalWaveLevels(snapshot, hierarchy) {
  const direction = hierarchy?.direction;
  const structureCandidate = hierarchy?.structure?.candidate;
  const executionCandidate = hierarchy?.execution?.candidate;
  const currentPrice = Number(snapshot.candles.at(-1)?.close
    || hierarchy?.analysis?.candidate?.points?.at(-1)?.price
    || 0);
  const executionCandles = contextCandlesFor(snapshot, hierarchy?.execution?.interval);
  const atr = Number(hierarchy?.execution?.atr)
    || averageTrueRange(executionCandles)
    || averageTrueRange(snapshot.candles)
    || currentPrice * 0.005;
  const reasons = [];
  if (!hierarchy?.structure?.interval || hierarchy.structure.status === "unavailable") reasons.push("structure_timeframe_unavailable");
  if (!hierarchy?.execution?.interval || hierarchy.execution.status === "unavailable") reasons.push("execution_timeframe_unavailable");
  if (!structureCandidate) reasons.push("aligned_structure_wave_missing");
  else if (structureCandidate.status !== "confirmed") reasons.push("structure_wave_tentative");
  if (!executionCandidate) reasons.push("aligned_execution_wave_missing");
  else if (executionCandidate.status !== "confirmed") reasons.push("execution_wave_tentative");
  if (!currentPrice || !atr || !["bullish", "bearish"].includes(direction)) {
    reasons.push("execution_metrics_unavailable");
    return { passed: false, reasons, state: "observing" };
  }

  const triggerAnchor = triggerAnchorForHierarchy(snapshot, hierarchy, direction, currentPrice, atr);
  const buffer = Math.max(atr * 0.15, currentPrice * 0.00005);
  const trigger = Number(triggerAnchor.price) + (direction === "bullish" ? buffer : -buffer);
  if (triggerAnchor.basis === "atr_volatility_fallback") reasons.push("trigger_fallback");
  else if (triggerAnchor.basis === "macro_confirmation_fallback") reasons.push("macro_confirmation_fallback");

  const stopZone = buildStructuralStopZone(snapshot, hierarchy, direction, trigger)
    || fallbackStructuralStopZone(snapshot, hierarchy, direction, trigger, atr);
  if (!stopZone) {
    reasons.push("structural_stop_missing");
    return { passed: false, reasons, state: "armed" };
  }
  if (stopZone.fallback) reasons.push("structural_stop_fallback");
  const stopBuffer = Math.max(
    atr * 0.15,
    stopZone.bufferFloor || 0,
    currentPrice * 0.00005,
    stopZone.width * 0.1,
  );
  let structuralStop = direction === "bullish"
    ? stopZone.lower - stopBuffer
    : stopZone.upper + stopBuffer;
  const minimumStopDistance = Math.max(atr * TACTICAL_STOP_MIN_DISTANCE_ATR, currentPrice * 0.001);
  const initialStopDistance = Math.abs(trigger - structuralStop);
  const stopFloorApplied = initialStopDistance < minimumStopDistance;
  if (stopFloorApplied) {
    structuralStop = direction === "bullish"
      ? trigger - minimumStopDistance
      : trigger + minimumStopDistance;
    reasons.push("stop_distance_floor_applied");
  }

  let targetLevels = waveTargetLevels(hierarchy.analysis.candidate, direction, trigger);
  const targetCountBeforeFallback = targetLevels.length;
  targetLevels = ensureWaveTargetLevels(targetLevels, trigger, structuralStop, direction, atr);
  if (!targetCountBeforeFallback) reasons.push("wave_target_fallback");
  else if (targetLevels.some((level) => level.basis === "risk_multiple_fallback")) reasons.push("risk_reward_target_fallback");

  const distanceAtr = Math.abs(trigger - currentPrice) / atr;
  const distancePercent = Math.abs(trigger - currentPrice) / currentPrice * 100;
  const risk = Math.abs(trigger - structuralStop);
  const stopDistanceAtr = risk / atr;
  const stopDistancePercent = risk / trigger * 100;
  const maximumStopDistancePercent = Number(stopZone.maximumStopDistancePercent)
    || (stopZone.sourceRoles?.some((role) => ["analysis", "structure"].includes(role))
      ? TACTICAL_HIGHER_TF_STOP_MAX_DISTANCE_PERCENT
      : TACTICAL_STOP_MAX_DISTANCE_PERCENT);
  const maximumStopDistanceAtr = Number(stopZone.maximumStopDistanceAtr)
    || Math.max(
      TACTICAL_STOP_MAX_DISTANCE_ATR,
      trigger * (maximumStopDistancePercent / 100) / Math.max(atr, Number.EPSILON),
    );
  const executionBarSeconds = intervalSeconds(hierarchy.execution.interval);
  const ageBars = executionCandidate && executionBarSeconds > 0
    ? Math.max(0, (Number(hierarchy.execution.lastClosedBarTime) - executionCandidate.points.at(-1).time) / executionBarSeconds)
    : null;
  if (distanceAtr > TACTICAL_TRIGGER_MAX_DISTANCE_ATR + Number.EPSILON) reasons.push("trigger_distance_exceeded");
  if (ageBars !== null && ageBars > 12 + Number.EPSILON) reasons.push("execution_wave_expired");

  const targets = targetLevels.map((level) => level.price);
  const finalTarget = targets.at(-1);
  const finalNetRiskReward = netRiskReward(trigger, structuralStop, finalTarget, direction);
  if (finalNetRiskReward < TACTICAL_MIN_NET_RISK_REWARD) reasons.push("net_risk_reward_below_floor");
  if (stopDistanceAtr < TACTICAL_STOP_MIN_DISTANCE_ATR - Number.EPSILON) reasons.push("stop_distance_too_tight");
  if (stopDistanceAtr > maximumStopDistanceAtr + Number.EPSILON
      || stopDistancePercent > maximumStopDistancePercent + Number.EPSILON) {
    reasons.push("structural_stop_distance_exceeded");
  }
  const confirmedMicro = Boolean(
    structureCandidate?.status === "confirmed"
      && executionCandidate?.status === "confirmed"
      && ["confirmed_wave_boundary", "confirmed_wave_pivot"].includes(triggerAnchor.basis)
      && !stopZone.fallback
      && !targetLevels.some((level) => level.basis === "risk_multiple_fallback"),
  );
  const stopSourceIntervalsByRole = new Map([
    ["analysis", hierarchy?.analysis?.interval || snapshot.interval],
    ["structure", hierarchy?.structure?.interval],
    ["execution", hierarchy?.execution?.interval],
  ]);
  const stopSourceInterval = stopZone.sourceRoles
    .map((role) => stopSourceIntervalsByRole.get(role))
    .find(Boolean)
    || stopZone.sourceIntervals[0]
    || hierarchy.execution.interval;
  const stopBasis = {
    kind: direction === "bullish" ? "support_zone" : "resistance_zone",
    label: stopZone.fallback
      ? direction === "bullish"
        ? `结构支撑/波浪失效兜底止损（${stopZone.fallbackReason}）`
        : `结构阻力/波浪失效兜底止损（${stopZone.fallbackReason}）`
      : direction === "bullish" ? "结构支撑区下沿 + 缓冲" : "结构阻力区上沿 + 缓冲",
    sourceInterval: stopSourceInterval,
    sourceRoles: stopZone.sourceRoles,
    zoneLower: stopZone.lower,
    zoneUpper: stopZone.upper,
    zoneWidth: stopZone.width,
    touchCount: stopZone.touchCount,
    evidenceIds: stopZone.evidenceIds,
    anchorPrice: direction === "bullish" ? stopZone.lower : stopZone.upper,
    bufferAtr: 0.15,
    tickSize: stopZone.tickSize,
    buffer: stopBuffer,
    price: structuralStop,
    fallback: Boolean(stopZone.fallback),
    floorApplied: stopFloorApplied,
    maximumStopDistanceAtr,
    maximumStopDistancePercent,
  };
  return {
    // Missing/tentative lower-degree evidence is retained as a warning, but
    // must not erase the conditional order when a deterministic fallback level
    // can be formed from confirmed structure and volatility.
    passed: true,
    reasons,
    state: "ready",
    executionBasis: confirmedMicro ? "confirmed_micro" : "structural_fallback",
    triggerBasis: triggerAnchor.basis,
    triggerSourceRole: triggerAnchor.role,
    triggerSourceInterval: triggerAnchor.interval,
    triggerEvidenceIds: triggerAnchor.evidenceIds,
    candidateId: executionCandidate?.id || structureCandidate?.id || hierarchy.analysis.candidate?.id,
    structureCandidateId: structureCandidate?.id || null,
    trigger,
    stop: structuralStop,
    targets,
    distanceAtr,
    distancePercent,
    stopDistanceAtr,
    stopDistancePercent,
    maximumStopDistanceAtr,
    maximumStopDistancePercent,
    ageBars,
    preferredDistance: distanceAtr <= 1.5 + Number.EPSILON,
    bufferAtr: 0.15,
    finalNetRiskReward,
    targetBasis: targetLevels,
    stopBasis,
  };
}

export function buildWaveActionPlan(snapshot, candidate, theoryResult = null) {
  if (!candidate) return null;
  const currentPrice = Number(snapshot.candles.at(-1)?.close || candidate.points.at(-1)?.price || 0);
  const hierarchy = theoryResult
    ? buildWaveHierarchy(snapshot, theoryResult, candidate)
    : null;
  const direction = hierarchy?.direction || candidate.projection?.direction || "neutral";
  const tactical = hierarchy
    ? tacticalWaveLevels(snapshot, hierarchy)
    : { passed: false, reasons: ["lower_timeframes_not_provided"], state: "observing" };
  const base = {
    currentPrice,
    primaryScenario: direction,
    primaryBias: direction,
    disposition: "wait",
    state: tactical.state,
    analysisInterval: snapshot.interval,
    structureInterval: hierarchy?.structure?.interval || null,
    executionInterval: hierarchy?.execution?.interval || null,
    validityInterval: hierarchy?.execution?.interval || snapshot.interval,
    validityBars: 12,
    macroConfirmation: hierarchy?.analysis?.macroConfirmation ?? Number(candidate.confirmationPrice),
    macroInvalidation: hierarchy?.analysis?.macroInvalidation ?? Number(candidate.invalidationPrice),
    currentWaveEnd: candidate.points.at(-1)?.price ?? null,
    confirmation: "低周期浪点只使用已收盘 K 线确认；进入 ready 后，价格触达带 ATR 缓冲的微浪突破价才执行",
    triggerConfirmation: "低周期浪点已由收盘 K 线确认；价格触达带 ATR 缓冲的首选方向微浪突破价即执行",
    observeTrigger: tactical.state === "observing"
      ? "等待结构周期形成与主周期方向一致、通过硬规则的子浪"
      : tactical.state === "armed"
        ? "结构子浪已经激活，等待执行周期形成距离与净风险收益均合格的微浪突破"
        : `观察价格是否触达 ${plainIntervalLabel(hierarchy.execution.interval)} 微浪突破价；超过 12 根执行 K 线未触发即重算`,
    gate: {
      passed: tactical.passed,
      reasons: tactical.reasons,
      maximumDistanceAtr: TACTICAL_TRIGGER_MAX_DISTANCE_ATR,
      preferredDistanceAtr: 1.5,
      minimumStopDistanceAtr: TACTICAL_STOP_MIN_DISTANCE_ATR,
      preferredStopDistanceAtr: {
        min: TACTICAL_STOP_PREFERRED_MIN_ATR,
        max: TACTICAL_STOP_PREFERRED_MAX_ATR,
      },
      maximumStopDistanceAtr: Number(tactical.maximumStopDistanceAtr)
        || TACTICAL_STOP_MAX_DISTANCE_ATR,
      maximumStopDistancePercent: Number(tactical.maximumStopDistancePercent)
        || TACTICAL_STOP_MAX_DISTANCE_PERCENT,
      minimumNetRiskReward: TACTICAL_MIN_NET_RISK_REWARD,
      triggerBufferAtr: 0.15,
      executionWaveMaxAgeBars: 12,
      ...(tactical.executionBasis ? { executionBasis: tactical.executionBasis } : {}),
      ...(tactical.triggerBasis ? { triggerBasis: tactical.triggerBasis } : {}),
      ...(tactical.triggerSourceInterval ? { triggerSourceInterval: tactical.triggerSourceInterval } : {}),
      ...(Number.isFinite(tactical.distanceAtr) ? { distanceAtr: tactical.distanceAtr } : {}),
      ...(Number.isFinite(tactical.distancePercent) ? { distancePercent: tactical.distancePercent } : {}),
      ...(Number.isFinite(tactical.stopDistanceAtr) ? { stopDistanceAtr: tactical.stopDistanceAtr } : {}),
      ...(Number.isFinite(tactical.stopDistancePercent) ? { stopDistancePercent: tactical.stopDistancePercent } : {}),
      ...(Number.isFinite(tactical.finalNetRiskReward) ? { finalNetRiskReward: tactical.finalNetRiskReward } : {}),
    },
    ...(tactical.triggerEvidenceIds?.length ? { triggerEvidenceIds: tactical.triggerEvidenceIds } : {}),
    ...(tactical.executionBasis ? { executionBasis: tactical.executionBasis } : {}),
    ...(tactical.triggerBasis ? { triggerBasis: tactical.triggerBasis } : {}),
    ...(tactical.triggerSourceRole ? { triggerSourceRole: tactical.triggerSourceRole } : {}),
    ...(tactical.triggerSourceInterval ? { triggerSourceInterval: tactical.triggerSourceInterval } : {}),
    targetBasis: Array.isArray(tactical.targetBasis) ? tactical.targetBasis : [],
    stopBasis: tactical.stopBasis || null,
    hierarchy: hierarchy ? {
      parentCandidateId: candidate.id,
      structureCandidateId: hierarchy.structure.candidate?.id || null,
      executionCandidateId: hierarchy.execution.candidate?.id || null,
    } : null,
  };
  if (!tactical.passed) {
    return {
      ...base,
      longTrigger: null,
      longTarget: null,
      longTargets: [],
      longInvalidation: null,
      shortTrigger: null,
      shortTarget: null,
      shortTargets: [],
      shortInvalidation: null,
      waitZone: null,
    };
  }
  const bullish = direction === "bullish";
  return {
    ...base,
    longTrigger: bullish ? tactical.trigger : null,
    longTarget: bullish ? tactical.targets[0] : null,
    longTargets: bullish ? tactical.targets : [],
    longInvalidation: bullish ? tactical.stop : null,
    shortTrigger: bullish ? null : tactical.trigger,
    shortTarget: bullish ? null : tactical.targets[0],
    shortTargets: bullish ? [] : tactical.targets,
    shortInvalidation: bullish ? null : tactical.stop,
    waitZone: {
      lower: Math.min(currentPrice, tactical.trigger),
      upper: Math.max(currentPrice, tactical.trigger),
    },
  };
}

function candidateSubdivisionRecords(candidate) {
  const source = candidate?.kind === "cycle"
    ? [
      ...(Array.isArray(candidate.subdivisions?.motive) ? candidate.subdivisions.motive : []),
      ...(Array.isArray(candidate.subdivisions?.correction) ? candidate.subdivisions.correction : []),
    ]
    : Array.isArray(candidate?.subdivisions) ? candidate.subdivisions : [];
  return source;
}

function candidateSubdivisionDescriptor(candidate) {
  const profiles = new Set(candidateSubdivisionRecords(candidate).map((item) => item.profile));
  const descriptors = [];
  if (profiles.has("extended_motive")) descriptors.push("扩展推动细分");
  if (profiles.has("complex_correction")) descriptors.push("复杂修正细分");
  return descriptors.length ? `（含${descriptors.join("、")}，已单独验证）` : "";
}

function candidateKindLabel(candidate) {
  const descriptor = candidateSubdivisionDescriptor(candidate);
  if (candidate.kind === "cycle") {
    const motive = candidate.components?.motiveKind === "diagonal" ? "倾斜三角形" : "标准五浪推动";
    const label = candidate.pattern.endsWith("_plus_wxy")
      ? `${motive} + W-X-Y 双重三浪周期`
      : `${motive} + A-B-C 调整周期`;
    return `${label}${descriptor}`;
  }
  if (candidate.kind === "impulse") return `标准五浪推动结构${descriptor}`;
  if (candidate.kind === "diagonal") return `位置与楔形已验证的倾斜三角形${descriptor}`;
  if (candidate.pattern === "double_three") return `W-X-Y 双重三浪调整${descriptor}`;
  if (candidate.pattern === "expanded_flat") return `扩散平台型 A-B-C 调整${descriptor}`;
  if (candidate.pattern === "running_flat") return `顺势平台型 A-B-C 调整${descriptor}`;
  if (candidate.pattern === "flat") return `平台型 A-B-C 调整${descriptor}`;
  return `锯齿型 A-B-C 调整${descriptor}`;
}

function directionLabel(direction) {
  if (direction === "bullish") return "向上";
  if (direction === "bearish") return "向下";
  return "横向";
}

function statusLabel(status) {
  return status === "confirmed" ? "已确认候选" : "暂定候选";
}

function candidateRatioText(candidate) {
  if (candidate.kind === "cycle") {
    const impulse = candidate.ratios.impulse || {};
    const correction = candidate.ratios.correction || {};
    const correctionText = candidate.pattern.endsWith("_plus_wxy")
      ? `X/W ${formatRatio(correction.waveXRetracement)}，Y/W ${formatRatio(correction.waveYToWaveW)}`
      : `B/A ${formatRatio(correction.waveBRetracement)}，C/A ${formatRatio(correction.waveCToWaveA)}`;
    return `2/1 ${formatRatio(impulse.wave2Retracement)}，3/1 ${formatRatio(impulse.wave3Extension)}，4/3 ${formatRatio(impulse.wave4Retracement)}，5/1 ${formatRatio(impulse.wave5ToWave1)}；${correctionText}；调整/推动净幅 ${formatRatio(candidate.ratios.correctionToImpulse)}`;
  }
  if (candidate.pattern === "double_three") {
    return `X/W 回撤 ${formatRatio(candidate.ratios.waveXRetracement)}，Y/W 长度比 ${formatRatio(candidate.ratios.waveYToWaveW)}，W 内部 b/a ${formatRatio(candidate.ratios.waveWInternalB)}，Y 内部 b/a ${formatRatio(candidate.ratios.waveYInternalB)}`;
  }
  if (candidate.kind === "correction") {
    return `B/A 回撤 ${formatRatio(candidate.ratios.waveBRetracement)}，C/A 长度比 ${formatRatio(candidate.ratios.waveCToWaveA)}`;
  }
  return [
    `2/1 回撤 ${formatRatio(candidate.ratios.wave2Retracement)}`,
    `3/1 延伸 ${formatRatio(candidate.ratios.wave3Extension)}`,
    `4/3 回撤 ${formatRatio(candidate.ratios.wave4Retracement)}`,
    `5/1 长度比 ${formatRatio(candidate.ratios.wave5ToWave1)}`,
  ].join("，");
}

function candidateRuleText(candidate) {
  if (candidate.kind === "cycle") {
    const impulse = candidate.rules.impulse || {};
    const correction = candidate.rules.correction || {};
    const correctionRule = candidate.pattern.endsWith("_plus_wxy")
      ? `W/X/Y 内部结构已验证：${correction.structureVerified ? "通过" : "未通过"}；X 浪未完全回撤 W：${correction.xHoldsOrigin ? "通过" : "未通过"}`
      : `A-B-C 内部结构已验证：${correction.internalStructureVerified ? "通过" : "未通过"}；浪型：${candidate.components?.correctionPattern || "未分类"}`;
    return `推动段：波2未越起点 ${impulse.wave2HoldsOrigin ? "通过" : "未通过"}、波3越过波1终点 ${impulse.wave3MakesProgress ? "通过" : "未通过"}、波4未完全回撤波3 ${impulse.wave4HoldsWave3Origin ? "通过" : "未通过"}、波3不为最短浪 ${impulse.wave3NotShortest ? "通过" : "未通过"}、波4不进入波1价格区 ${impulse.wave4AvoidsWave1 ? "通过" : "未通过"}、波5推进或严格截短验证 ${impulse.wave5MakesProgress || impulse.truncatedFifthVerified ? "通过" : "未通过"}、内部 5-3-5-3-5 ${impulse.impulseInternalStructureVerified ? "通过" : "未通过"}；调整段：${correctionRule}。`;
  }
  if (candidate.pattern === "double_three") {
    return `W、X、Y 的内部调整结构均已验证：${candidate.rules.structureVerified ? "通过" : "未通过"}；X 浪未完全回撤 W：${candidate.rules.xHoldsOrigin ? "通过" : "未通过"}；Y 是否超过 W 终点只作排序参考，不作为硬规则。`;
  }
  if (candidate.kind === "correction") {
    return `A-B-C 内部结构：${candidate.rules.internalStructureVerified ? "通过" : "未通过"}；B/A 与 C/A 的价格关系已按 ${candidate.pattern} 规则分类。`;
  }
  return `波2未越波1起点：${candidate.rules.wave2HoldsOrigin ? "通过" : "未通过"}；波3越过波1终点：${candidate.rules.wave3MakesProgress ? "通过" : "未通过"}；波4未完全回撤波3：${candidate.rules.wave4HoldsWave3Origin ? "通过" : "未通过"}；波3不为最短浪：${candidate.rules.wave3NotShortest ? "通过" : "未通过"}；波4不与波1价格区重叠：${candidate.rules.wave4AvoidsWave1 ? "通过" : "未通过"}；波5推进或严格截短验证：${candidate.rules.wave5MakesProgress || candidate.rules.truncatedFifthVerified ? "通过" : "未通过"}；内部 5-3-5-3-5：${candidate.rules.impulseInternalStructureVerified ? "通过" : "未通过"}。`;
}

function waveGateReasonLabel(reason) {
  return new Map([
    ["lower_timeframes_not_provided", "尚未取得真实低周期 K 线"],
    ["structure_timeframe_unavailable", "结构周期数据不可用"],
    ["execution_timeframe_unavailable", "执行周期数据不可用"],
    ["aligned_structure_wave_missing", "结构周期没有与主方向一致的有效子浪"],
    ["structure_wave_tentative", "结构子浪末端仍未确认"],
    ["aligned_execution_wave_missing", "执行周期没有与主方向一致的有效微浪"],
    ["execution_wave_tentative", "执行微浪末端仍未确认"],
    ["execution_metrics_unavailable", "执行周期 ATR 或方向证据不足"],
    ["trigger_fallback", "低周期触发证据不足，已采用最近可用结构/波动率锚点"],
    ["macro_confirmation_fallback", "低周期触发证据不足，已采用主周期确认边界作为条件价来源"],
    ["future_micro_break_missing", "现价附近没有尚未触发的微浪突破位"],
    ["wave_target_missing", "没有得到符合波浪测量方向的斐波那契或结构目标"],
    ["wave_target_fallback", "波浪目标不足，已用结构风险倍数补足条件目标"],
    ["risk_reward_target_fallback", "原目标净风报不足，已补充风险倍数条件目标"],
    ["trigger_distance_exceeded", "触发价距离超过执行周期 3 ATR 提示范围，条件单仍保留"],
    ["structural_stop_missing", "没有找到有效的支撑/阻力结构区"],
    ["structural_stop_fallback", "有效结构区不足，已采用最近确认摆点/波浪失效位/ATR 兜底止损"],
    ["stop_distance_floor_applied", "结构区过近，止损向外扩展至 0.6 ATR 噪声缓冲"],
    ["stop_distance_too_tight", "结构止损距离小于执行周期 0.6 ATR 噪声下限"],
    ["structural_stop_distance_exceeded", "结构止损距离超过当前级别允许包络（低周期 3.5 ATR/3%，高周期 6%）"],
    ["execution_wave_expired", "执行微浪已超过 12 根执行 K 线有效期"],
    ["net_risk_reward_below_floor", "扣除预估成本后的最终目标风险收益低于 1:1.2"],
  ]).get(reason) || String(reason || "未知门禁");
}

export function buildWaveAnalysisReport(snapshot, theoryResult, review, context = {}) {
  const candidatesById = new Map(theoryResult.structures.candidates.map((candidate) => [candidate.id, candidate]));
  const primary = candidatesById.get(review.primaryCandidateId) || theoryResult.structures.primaryCandidate;
  const alternatives = review.alternateCandidateIds
    .map((id) => candidatesById.get(id))
    .filter(Boolean);
  const instruction = String(context.instruction || "").trim();
  const firstCandle = snapshot.candles[0];
  const lastCandle = snapshot.candles.at(-1);
  const action = buildWaveActionPlan(snapshot, primary, theoryResult);
  const bullish = action.primaryScenario === "bullish";
  const directionText = bullish ? "偏多" : "偏空";
  const structureLabel = action.structureInterval ? plainIntervalLabel(action.structureInterval) : "结构周期";
  const executionLabel = action.executionInterval ? plainIntervalLabel(action.executionInterval) : "执行周期";
  const fallback = theoryResult.fallback;
  const fallbackLabel = fallback?.interval ? plainIntervalLabel(fallback.interval) : "低周期";
  const activeTrigger = bullish ? action.longTrigger : action.shortTrigger;
  const activeStop = bullish ? action.longInvalidation : action.shortInvalidation;
  const activeTargets = bullish ? action.longTargets : action.shortTargets;
  const ready = action.state === "ready" && action.gate.passed && Number.isFinite(activeTrigger);
  const gateReasons = action.gate.reasons.map(waveGateReasonLabel);
  const fallbackExecution = action.executionBasis !== "confirmed_micro";
  const triggerLabel = action.triggerSourceInterval
    ? plainIntervalLabel(action.triggerSourceInterval)
    : executionLabel;
  const targetBasisText = action.targetBasis?.length
    ? action.targetBasis.map((item) => `${item.label} ${formatPrice(item.price)}`).join("、")
    : "未形成";
  const stopBasisText = action.stopBasis?.label
    ? `${action.stopBasis.label}（${action.stopBasis.sourceInterval ? `${plainIntervalLabel(action.stopBasis.sourceInterval)} ` : ""}${formatPrice(action.stopBasis.zoneLower)}–${formatPrice(action.stopBasis.zoneUpper)}，${action.stopBasis.touchCount || 0} 个确认触点，锚点 ${formatPrice(action.stopBasis.anchorPrice)}，缓冲 ${formatPrice(action.stopBasis.buffer)}）`
    : "未形成";
  const tacticalLines = ready
    ? [
        `- **当前状态：可执行条件已就绪；可执行条件单已生成**。${fallbackExecution ? `低周期证据尚未全部对齐，采用 ${triggerLabel} 的最近可用结构/波动率锚点，并在新收盘 K 线后重算。` : `${structureLabel} 子浪与 ${executionLabel} 微浪均和 ${plainIntervalLabel(snapshot.interval)} 主方向一致。`}`,
        `- **${triggerLabel}${directionText}条件触发：${formatPrice(activeTrigger)}**。该价位加入 ${action.gate.triggerBufferAtr} ATR 缓冲；价格触达才执行，${fallbackExecution ? "当前不把未确认的低周期摆点包装成确定微浪。" : `不使用 ${formatPrice(action.macroConfirmation)} 的主周期边界作为入场。`}`,
        `- **结构止损：${formatPrice(activeStop)}**；目标：${activeTargets.map((target, index) => `T${index + 1} ${formatPrice(target)}`).join("、")}。触发距现价约 ${action.gate.distancePercent.toFixed(2)}% / ${action.gate.distanceAtr.toFixed(2)} ATR，止损距触发约 ${action.gate.stopDistancePercent.toFixed(2)}% / ${action.gate.stopDistanceAtr.toFixed(2)} ATR，最终目标净风报约 1:${action.gate.finalNetRiskReward.toFixed(2)}。`,
        `- **止损与目标依据：**止损采用${stopBasisText}；止盈按候选浪段的${targetBasisText}计算。触发前若目标方向或净风报提示仍未消除，保留条件单但不立即建仓，并在下一根收盘 K 线后重算；不得通过缩窄结构止损来迎合门槛。`,
        ...(gateReasons.length ? [`- **执行依据提示：**${gateReasons.join("；")}。以上为条件单，不代表当前价立即追单。`] : []),
        `- 本计划只保持 ${action.validityBars} 根 ${executionLabel} K 线有效；过期、父浪失效或触发后重新收回等待区都要取消并重算。`,
      ]
    : [
        `- **当前状态：${action.state === "armed" ? "已激活，等待微浪" : "观察中"}，不交易**。${plainIntervalLabel(snapshot.interval)} 主周期方向清楚不等于已经有近端入场条件。`,
        `- 当前未通过：${gateReasons.join("；") || "低周期执行条件尚未完成"}。系统不会为了靠近现价而移动真实摆点。`,
        `- 下一步：${action.observeTrigger}。`,
      ];
  return [
    `## ${snapshot.marketId} · 波浪理论交易计划`,
    instruction ? `分析要求：${instruction}` : "",
    "",
    "### 先看结论",
    fallback
      ? `当前价格约 ${formatPrice(action.currentPrice)}。${plainIntervalLabel(snapshot.interval)} 暂未形成可复核主周期计数，已切换到 ${fallbackLabel} 的合格${primary.kind === "cycle" ? "周期" : "结构"}作为临时主计数，方向为${directionText}；它不能冒充 ${plainIntervalLabel(snapshot.interval)} 主周期结论，执行单采用可用结构与波动率锚点并持续重算。`
      : `当前价格约 ${formatPrice(action.currentPrice)}。${plainIntervalLabel(snapshot.interval)} 主计数方向为${directionText}；主周期负责方向和场景边界，执行单优先使用 ${structureLabel} → ${executionLabel} 的确认微浪，证据不足时使用最近可用结构/ATR 兜底。`,
    ...tacticalLines,
    "",
    fallback ? "### 当前计数边界（低周期兜底，不是主周期结论）" : "### 主周期边界（不是当前入场价）",
    fallback
      ? `- ${fallbackLabel} 确认：${formatPrice(action.macroConfirmation)}；${fallbackLabel} 失效：${formatPrice(action.macroInvalidation)}。主周期恢复合格计数后，以上边界必须重新复核。`
      : `- 宏观确认：${formatPrice(action.macroConfirmation)}。它确认主周期结构发展，不因距离很远就自动改成近端触发。`,
    fallback
      ? `- 任何低周期兜底计数都不能替代主周期失效边界；实际持仓仍优先使用结构止损 ${ready ? formatPrice(activeStop) : "尚未形成"}。`
      : `- 宏观失效：${formatPrice(action.macroInvalidation)}。越过后取消全部子浪计划并重新数浪；实际持仓仍优先使用结构止损 ${ready ? formatPrice(activeStop) : "尚未形成"}。`,
    "",
    "### 三级数浪",
    `${candidateKindLabel(primary)}，${primary.degree || "当前画布相对级别"}，${statusLabel(primary.status)}。通俗理解：系统只展示已通过价格硬规则和低一级结构证据的计数；${primary.kind === "cycle" ? "当前候选包含动机段与后续调整" : "当前候选只覆盖一个已验证结构段"}，末端仍会随新 K 线变化。`,
    `浪点：${primary.points.map((point) => `${point.label} ${formatPrice(point.price)}`).join(" → ")}。`,
    `低周期：${structureLabel} ${action.hierarchy?.structureCandidateId ? "已找到一致子浪" : "无一致子浪"}；${executionLabel} ${action.hierarchy?.executionCandidateId ? "已找到一致微浪" : "无一致微浪"}。${fallback ? `本次兜底来源为 ${fallbackLabel}，` : ""}证据充分时使用确认微浪，证据不足时仍保留结构/ATR 条件执行价并标注其来源。`,
    `规则检查：${candidateRuleText(primary)}`,
    `比例参考：${candidateRatioText(primary)}。这些比例用于比较候选是否合理，不代表价格一定按比例到达。`,
    "",
    "### 止盈止损与斐波那契依据",
    `止损：${stopBasisText}；结构止损位用于保护持仓，不等同于主周期宏观失效位。`,
    `目标：${targetBasisText}；Fib 只作为候选测量依据，价格未到触发位、候选失效或净风报低于门槛时不执行。`,
    "",
    "### 如果主计数不成立",
    alternatives.length
      ? alternatives.map((candidate, index) => `${index + 1}. 备选 ${index + 1}：${candidateKindLabel(candidate)}，末端约 ${formatPrice(candidate.points.at(-1).price)}；只有主计数宏观失效后才转看该方案。`).join("\n")
      : "没有额外绘制备选路径。主计数一旦越过取消价，就停止沿用本次结论并等待重新数浪。",
    "",
    "### 数据与不确定性",
    `本次主周期使用 ${snapshot.candles.length} 根 ${snapshot.interval} K 线，覆盖 ${formatTime(firstCandle.time)} 至 ${formatTime(lastCandle.time)}，识别 ${theoryResult.statistics.swingCount} 个交替高低点和 ${theoryResult.statistics.candidateCount} 个受规则约束的候选。结构周期读取 ${theoryResult.multiTimeframe.structure.statistics.candleCount} 根，执行周期读取 ${theoryResult.multiTimeframe.execution.statistics.candleCount} 根已收盘 K 线。`,
    "波浪理论对起点和级别存在天然歧义；“暂定”只表示最后一个已通过结构规则的浪点还可能随新 K 线移动，不表示允许违反硬规则。波4重叠不会被自动解释为倾斜，内部结构或倾斜位置证据不足时不会落图。",
    "",
    "### 风险说明",
    "低周期会提高触发可达性，但不会自动提高胜率。关键价位会随新摆动点重新计算；以上是条件式观察方案，不是唯一事实、自动交易指令、收益承诺或经过历史校准的涨跌概率。",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function candidateById(theoryResult, id) {
  return theoryResult.structures.candidates.find((candidate) => candidate.id === id) || null;
}

function wavePathOperation(analysisId, candidate, colorToken, status, suffix, points, appearance = {}) {
  return {
    op: "upsert",
    drawing: {
      id: `${analysisId}-${candidate.id}${suffix ? `-${suffix}` : ""}`,
      theory: "wave",
      tool: "path",
      points: points.map((point) => ({ time: point.time, price: point.price })),
      colorToken,
      status,
      evidenceIds: points.map((point) => point.id),
      ...appearance,
    },
  };
}

function wavePathOperations(analysisId, candidate, colorToken, status = candidate.status) {
  if (candidate.kind !== "cycle") {
    return [wavePathOperation(analysisId, candidate, colorToken, status, "", candidate.points, { lineWidth: 2.5 })];
  }
  const impulsePointCount = candidate.components?.impulsePointCount || 6;
  const impulsePoints = candidate.points.slice(0, impulsePointCount);
  const correctionPoints = candidate.points.slice(Math.max(0, impulsePointCount - 1));
  return [
    wavePathOperation(analysisId, candidate, colorToken === "wave-alternative" ? colorToken : "wave-primary", status, "motive", impulsePoints, { lineWidth: 2.5 }),
    wavePathOperation(analysisId, candidate, colorToken === "wave-alternative" ? colorToken : "wave-correction", status, "correction", correctionPoints, { lineWidth: 2.5 }),
  ];
}

function wavePointAnnotation(candidate, point, index) {
  if (candidate.kind === "cycle") {
    if (index <= 5) return point.label;
    if (candidate.pattern.endsWith("_plus_wxy")) {
      if (point.label === "W" || point.label === "X" || point.label === "Y") return point.label;
      return `${point.component}:${point.label}`;
    }
    return point.label;
  }
  if (candidate.pattern === "double_three") {
    if (index === 0) return "起";
    if (point.label === "W" || point.label === "X" || point.label === "Y") return point.label;
    return `${point.component}:${point.label}`;
  }
  if (candidate.kind === "correction") {
    return index === 0 ? "起" : point.label;
  }
  return point.label;
}

function wavePointColorToken(candidate, index) {
  if (candidate.kind === "cycle") return index <= 5 ? "wave-primary" : "wave-correction";
  return candidate.kind === "correction" ? "wave-correction" : "wave-primary";
}

function waveDrawingLabel(candidate) {
  const descriptor = candidateSubdivisionDescriptor(candidate);
  if (candidate.kind === "cycle") {
    const motive = candidate.components?.motiveKind === "diagonal" ? "倾斜5浪" : "标准5浪";
    const label = candidate.pattern.endsWith("_plus_wxy") ? `${motive} + WXY` : `${motive} + ABC`;
    return `${label}${descriptor}`;
  }
  if (candidate.kind === "impulse") return `标准5浪推动${descriptor}`;
  if (candidate.kind === "diagonal") return `已验证倾斜5浪${descriptor}`;
  if (candidate.pattern === "double_three") return `WXY调整${descriptor}`;
  return `ABC调整${descriptor}`;
}

export function buildWaveDrawingPatch(snapshot, theoryResult, review) {
  const primary = candidateById(theoryResult, review.primaryCandidateId)
    || theoryResult.structures.primaryCandidate;
  if (!primary) throw new TypeError("The approved wave drawing plan has no supported primary candidate");
  const analysisId = `wave-analysis-${crypto.createHash("sha1")
    .update(JSON.stringify([snapshot.snapshotId, review]))
    .digest("hex")
    .slice(0, 18)}`;
  const primaryToken = primary.kind === "correction" ? "wave-correction" : "wave-primary";
  const operations = [...wavePathOperations(analysisId, primary, primaryToken)];
  for (const [index, point] of primary.points.entries()) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-${primary.id}-label-${index}-${point.label}`,
        theory: "wave",
        tool: "note",
        points: [{ time: point.time, price: point.price }],
        text: wavePointAnnotation(primary, point, index),
        colorToken: wavePointColorToken(primary, index),
        status: point.status === "confirmed" ? "confirmed" : "tentative",
        evidenceIds: [point.id],
      },
    });
  }
  const latestCandle = snapshot.candles.at(-1);
  const previousCandle = snapshot.candles.at(-2);
  const intervalSeconds = Math.max(1, latestCandle.time - previousCandle.time);
  const projectionStart = primary.points.at(-1).time;
  const projectionEnd = Math.max(latestCandle.time, projectionStart + intervalSeconds * 3);
  operations.push({
    op: "upsert",
    drawing: {
      id: `${analysisId}-${primary.id}-title`,
      theory: "wave",
      tool: "note",
      points: [{ time: primary.points[0].time, price: primary.points[0].price }],
      text: primary.sourceRole && primary.sourceRole !== "analysis"
        ? `${plainIntervalLabel(primary.sourceInterval)}兜底计数：${waveDrawingLabel(primary)}`
        : `主计数：${waveDrawingLabel(primary)}`,
      colorToken: "wave-note",
      status: primary.status === "confirmed" ? "confirmed" : "tentative",
      evidenceIds: primary.points.map((point) => point.id),
    },
  });
  const measurement = waveProjectionMeasurement(primary);
  const measurementDirection = primary.projection?.direction;
  if (measurement && ["bullish", "bearish"].includes(measurementDirection)) {
    const sign = measurementDirection === "bullish" ? 1 : -1;
    for (const ratio of measurement.ratios) {
      const price = measurement.anchor + sign * measurement.span * ratio;
      const ratioLabel = ratio.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
      operations.push({
        op: "upsert",
        drawing: {
          id: `${analysisId}-${primary.id}-fib-${ratioLabel}`,
          theory: "wave",
          tool: "path",
          points: [
            { time: primary.points.at(-1).time, price },
            { time: projectionEnd, price },
          ],
          colorToken: "wave-fibonacci",
          status: "tentative",
          evidenceIds: measurement.sourcePointIds,
        },
      }, {
        op: "upsert",
        drawing: {
          id: `${analysisId}-${primary.id}-fib-${ratioLabel}-label`,
          theory: "wave",
          tool: "note",
          points: [{ time: projectionEnd, price }],
          text: `Fib ${ratioLabel}`,
          colorToken: "wave-fibonacci",
          status: "tentative",
          evidenceIds: measurement.sourcePointIds,
        },
      });
    }
  }
  if (review.showProjectionZone) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-${primary.id}-projection`,
        theory: "wave",
        tool: "rectangle",
        points: [
          { time: projectionStart, price: primary.projection.high },
          { time: projectionEnd, price: primary.projection.low },
        ],
        colorToken: "wave-fibonacci",
        status: "tentative",
        evidenceIds: primary.points.map((point) => point.id),
      },
    });
  }
  operations.push({
    op: "upsert",
    drawing: {
      id: `${analysisId}-${primary.id}-invalidation`,
      theory: "wave",
      tool: "path",
      points: [
        { time: primary.points[0].time, price: primary.invalidationPrice },
        { time: projectionEnd, price: primary.invalidationPrice },
      ],
      colorToken: "wave-alternative",
      status: "tentative",
      evidenceIds: [primary.points[0].id],
    },
  });
  operations.push({
    op: "upsert",
    drawing: {
      id: `${analysisId}-${primary.id}-invalidation-label`,
      theory: "wave",
      tool: "note",
      points: [{ time: projectionEnd, price: primary.invalidationPrice }],
      text: `主周期失效 ${formatPrice(primary.invalidationPrice)}`,
      colorToken: "wave-alternative",
      status: "tentative",
      evidenceIds: [primary.points[0].id],
    },
  });
  if (Number.isFinite(Number(primary.confirmationPrice))) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-${primary.id}-confirmation`,
        theory: "wave",
        tool: "path",
        points: [
          { time: primary.points.at(-1).time, price: primary.confirmationPrice },
          { time: projectionEnd, price: primary.confirmationPrice },
        ],
        colorToken: "wave-fibonacci",
        status: "tentative",
        evidenceIds: [primary.points.at(-1).id],
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${primary.id}-confirmation-label`,
        theory: "wave",
        tool: "note",
        points: [{ time: projectionEnd, price: primary.confirmationPrice }],
        text: `主周期结构确认（非入场）${formatPrice(primary.confirmationPrice)}`,
        colorToken: "wave-fibonacci",
        status: "tentative",
        evidenceIds: [primary.points.at(-1).id],
      },
    });
  }
  const action = buildWaveActionPlan(snapshot, primary, theoryResult);
  const hierarchy = buildWaveHierarchy(snapshot, theoryResult, primary);
  const nestedDegrees = [
    {
      node: hierarchy?.structure,
      suffix: "structure-child",
      label: hierarchy?.structure?.interval ? `${plainIntervalLabel(hierarchy.structure.interval)} 子浪` : "结构子浪",
      colorToken: "wave-correction",
      lineWidth: 1.5,
      lineStyle: "solid",
    },
    {
      node: hierarchy?.execution,
      suffix: "execution-micro",
      label: hierarchy?.execution?.interval ? `${plainIntervalLabel(hierarchy.execution.interval)} 微浪` : "执行微浪",
      colorToken: "wave-primary",
      lineWidth: 1,
      lineStyle: "dotted",
    },
  ];
  nestedDegrees.forEach((degree) => {
    const child = degree.node?.candidate;
    if (!child) return;
    operations.push(
      wavePathOperation(
        analysisId,
        child,
        degree.colorToken,
        child.status,
        degree.suffix,
        child.points,
        { lineWidth: degree.lineWidth, lineStyle: degree.lineStyle },
      ),
      {
        op: "upsert",
        drawing: {
          id: `${analysisId}-${child.id}-${degree.suffix}-label`,
          theory: "wave",
          tool: "note",
          points: [{ time: child.points.at(-1).time, price: child.points.at(-1).price }],
          text: `${degree.label}：${waveDrawingLabel(child)}`,
          colorToken: degree.colorToken,
          status: child.status,
          evidenceIds: child.points.map((point) => point.id),
          fontSize: 10,
        },
      },
    );
  });
  const bullish = action.primaryScenario === "bullish";
  const trigger = bullish ? action.longTrigger : action.shortTrigger;
  const stop = bullish ? action.longInvalidation : action.shortInvalidation;
  const targets = bullish ? action.longTargets : action.shortTargets;
  if (action.state === "ready" && Number.isFinite(trigger) && Number.isFinite(stop)) {
    const tacticalStart = hierarchy?.execution?.candidate?.points.at(-1)?.time || latestCandle.time;
    const tacticalEvidence = [
      ...(hierarchy?.execution?.candidate?.points.map((point) => point.id) || []),
      ...(action.stopBasis?.evidenceIds || []),
    ];
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-${primary.id}-execution-trigger`,
        theory: "wave",
        tool: "path",
        points: [{ time: tacticalStart, price: trigger }, { time: projectionEnd, price: trigger }],
        text: `${plainIntervalLabel(action.executionInterval)}${bullish ? "多" : "空"}触发 ${formatPrice(trigger)}`,
        colorToken: bullish ? "wave-primary" : "wave-correction",
        status: "confirmed",
        evidenceIds: tacticalEvidence,
        lineWidth: 1.5,
        lineStyle: "dashed",
      },
    }, {
      op: "upsert",
      drawing: {
        id: `${analysisId}-${primary.id}-execution-stop`,
        theory: "wave",
        tool: "path",
        points: [{ time: tacticalStart, price: stop }, { time: projectionEnd, price: stop }],
        text: `结构止损 ${formatPrice(stop)}`,
        colorToken: "wave-alternative",
        status: "confirmed",
        evidenceIds: tacticalEvidence,
        lineWidth: 1,
        lineStyle: "dotted",
      },
    });
    if (Number.isFinite(targets[0])) {
      const firstTargetBasis = action.targetBasis?.find((level) => Math.abs(level.price - targets[0]) <= Number.EPSILON);
      operations.push({
        op: "upsert",
        drawing: {
          id: `${analysisId}-${primary.id}-execution-target-1`,
          theory: "wave",
          tool: "path",
          points: [{ time: tacticalStart, price: targets[0] }, { time: projectionEnd, price: targets[0] }],
          text: `低周期 T1${firstTargetBasis?.label ? ` ${firstTargetBasis.label}` : ""} ${formatPrice(targets[0])}`,
          colorToken: "wave-fibonacci",
          status: "tentative",
          evidenceIds: tacticalEvidence,
          lineWidth: 1,
          lineStyle: "dotted",
        },
      });
    }
  }
  operations.push({
    op: "upsert",
    drawing: {
      id: `${analysisId}-${primary.id}-summary`,
      theory: "wave",
      tool: "note",
      points: [{ time: latestCandle.time, price: latestCandle.close }],
      text: action.state === "ready"
        ? `${plainIntervalLabel(action.executionInterval)}${bullish ? "多" : "空"}触发 ${formatPrice(trigger)}｜结构止损 ${formatPrice(stop)}｜主周期失效 ${formatPrice(action.macroInvalidation)}`
        : `${plainIntervalLabel(snapshot.interval)}${bullish ? "偏多" : "偏空"}｜低周期${action.state === "armed" ? "已激活待确认" : "未形成"}｜主周期确认 ${formatPrice(action.macroConfirmation)}`,
      colorToken: "wave-note",
      status: review.verdict === "approve" && primary.status === "confirmed" ? "confirmed" : "tentative",
      evidenceIds: primary.points.map((point) => point.id),
    },
  });
  return validateTradingDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot);
}

export async function runTradingWaveAnalysisPipeline(params, options = {}) {
  const snapshot = normalizeTradingMarketSnapshot(params, { maximumCandles: 2_500 });
  const theoryResult = runWaveTheoryEngine(snapshot);
  if (theoryResult.status !== "succeeded") {
    const error = new Error("当前 K 线没有形成同时通过价格硬规则与低一级内部结构验证的波浪候选");
    error.code = "TRADING_WAVE_INSUFFICIENT_DATA";
    throw error;
  }
  if (!options.modelRegistry || typeof options.modelRegistry.analyze !== "function") {
    throw new TypeError("modelRegistry is required");
  }
  const providerId = String(options.providerId || "").trim();
  const requestId = `wave-request-${crypto.randomUUID()}`;
  const modelRequest = {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    requestId,
    task: "wave-theory-review-and-drawing-plan",
    theoryId: "elliott_wave",
    snapshotId: snapshot.snapshotId,
    prompt: buildWaveModelPrompt(snapshot, theoryResult, {
      instruction: params?.instruction,
      responseMode: params?.responseMode,
    }),
    responseFormat: "json",
  };
  const reviewed = await runValidatedTradingModelReview({
    modelRegistry: options.modelRegistry,
    providerId,
    request: modelRequest,
    signal: options.signal,
    theoryResult,
    validateResponse: (text) => normalizeWaveModelReview(text, theoryResult),
  });
  const { modelResponse, review: modelReview } = reviewed;
  const primaryCandidate = candidateById(theoryResult, modelReview.primaryCandidateId)
    || theoryResult.structures.primaryCandidate;
  const actionPlan = buildWaveActionPlan(snapshot, primaryCandidate, theoryResult);
  const drawingPatch = buildWaveDrawingPatch(snapshot, theoryResult, modelReview);
  const report = buildWaveAnalysisReport(snapshot, theoryResult, modelReview, {
    instruction: params?.instruction,
  });
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: {
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      snapshotTime: snapshot.snapshotTime,
      inputHash: snapshot.inputHash,
    },
    theoryResult,
    analysisPlan: {
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      analysisId: drawingPatch.analysisId,
      revision: 0,
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      narrative: params?.responseMode === "direct"
        ? (modelReview.report || modelReview.summary)
        : modelReview.summary,
      report,
      actionPlan,
      confidence: modelReview.confidence,
      drawingPatch,
    },
    model: {
      providerId: modelResponse.providerId,
      modelId: modelResponse.modelId,
      requestId: modelResponse.requestId,
      latencyMs: modelResponse.latencyMs,
      usage: modelResponse.usage,
      finishReason: modelResponse.finishReason,
      reasoningEffort: reviewed.reasoningEffort,
      reviewAttempts: reviewed.attempts.length,
      escalationReason: reviewed.escalationReason,
    },
  };
}
