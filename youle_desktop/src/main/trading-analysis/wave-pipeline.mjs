import crypto from "node:crypto";
import { runWaveTheoryEngine } from "./wave-engine.mjs";
import { runValidatedTradingModelReview } from "./model-review.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateTradingDrawingPatch,
} from "./protocol.mjs";

function extractJsonObject(text) {
  const source = String(text || "").trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new TypeError("Model response did not contain a JSON object");
  return JSON.parse(source.slice(first, last + 1));
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
    "波浪计数具有级别和起点歧义。优先从 kind=cycle 且 components.structureVerified=true 的完整周期中选择主计数；只有没有完整周期时才选择已通过硬规则的单段候选。你只能选择给定候选 ID，不得创造、删减或重排候选之外的浪点、价格、时间和历史事实，也不得把候选外的重叠结构解释成倾斜例外；末端未确认时必须说明暂定。",
    directAnswer
      ? "本次只刷新分析并回答用户的具体问题，不更新画布。report 必须第一句直接作答，后续只写必要依据，不得套用完整盘面报告或固定章节。"
      : "本次需要生成完整盘面分析与受控绘图计划。",
    "面向用户必须先说人话和条件：上破 actionLevels.longTrigger 后偏多、跌破 actionLevels.shortTrigger 后偏空、区间内等待，并说明第一目标和方案取消价。专业浪型和斐波那契比例放在后面的可选依据里，不得让新手先读一串术语；不得把暂定计数写成确定预测。",
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
    JSON.stringify(theoryResult),
    "确定性 actionLevels（只能引用，不能自行改价）：",
    JSON.stringify(buildWaveActionPlan(snapshot, theoryResult.structures.primaryCandidate)),
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

export function buildWaveActionPlan(snapshot, candidate) {
  if (!candidate) return null;
  const currentPrice = Number(snapshot.candles.at(-1)?.close || candidate.points.at(-1)?.price || 0);
  const rawConfirmation = Number(candidate.confirmationPrice);
  const rawInvalidation = Number(candidate.invalidationPrice);
  const pointPrices = candidate.points.map((point) => point.price);
  const recentClosed = snapshot.candles.slice(Math.max(0, snapshot.candles.length - 31), -1);
  const recentHigh = recentClosed.length ? Math.max(...recentClosed.map((candle) => candle.high)) : null;
  const recentLow = recentClosed.length ? Math.min(...recentClosed.map((candle) => candle.low)) : null;
  const recentAverageRange = recentClosed.length
    ? recentClosed.reduce((total, candle) => total + candle.high - candle.low, 0) / recentClosed.length
    : 0;
  let longTrigger = Math.max(rawConfirmation, rawInvalidation);
  let shortTrigger = Math.min(rawConfirmation, rawInvalidation);
  const baseSpan = Math.max(
    Math.abs(longTrigger - shortTrigger),
    Math.abs(candidate.projection.high - candidate.projection.low),
    currentPrice * 0.002,
    Number.EPSILON,
  );
  if (!Number.isFinite(longTrigger) || longTrigger <= currentPrice * 1.00005) {
    longTrigger = nearestPriceAbove([recentHigh, ...pointPrices], currentPrice) ?? currentPrice + baseSpan * 0.35;
  }
  if (!Number.isFinite(shortTrigger) || shortTrigger >= currentPrice * 0.99995) {
    shortTrigger = nearestPriceBelow([recentLow, ...pointPrices], currentPrice) ?? currentPrice - baseSpan * 0.35;
  }
  const minimumTargetDistance = Math.max(recentAverageRange * 0.5, currentPrice * 0.001, Number.EPSILON);
  const longTarget = nearestPriceAbove([
    recentHigh,
    candidate.projection.high,
    ...pointPrices,
  ], longTrigger + minimumTargetDistance) ?? longTrigger + Math.max(baseSpan * 0.75, minimumTargetDistance);
  const shortTarget = nearestPriceBelow([
    recentLow,
    candidate.projection.low,
    ...pointPrices,
  ], shortTrigger - minimumTargetDistance) ?? shortTrigger - Math.max(baseSpan * 0.75, minimumTargetDistance);
  return {
    currentPrice,
    primaryScenario: candidate.projection.direction,
    longTrigger,
    longTarget,
    longInvalidation: shortTrigger,
    shortTrigger,
    shortTarget,
    shortInvalidation: longTrigger,
    waitZone: { lower: shortTrigger, upper: longTrigger },
    currentWaveEnd: candidate.points.at(-1)?.price ?? null,
    confirmation: "等待当前 K 线周期收盘确认，未收盘突破不算成立",
  };
}

function candidateKindLabel(candidate) {
  if (candidate.kind === "cycle") {
    const motive = candidate.components?.motiveKind === "diagonal" ? "倾斜三角形" : "标准五浪推动";
    return candidate.pattern.endsWith("_plus_wxy")
      ? `${motive} + W-X-Y 双重三浪周期`
      : `${motive} + A-B-C 调整周期`;
  }
  if (candidate.kind === "impulse") return "标准五浪推动结构";
  if (candidate.kind === "diagonal") return "位置与楔形已验证的倾斜三角形";
  if (candidate.pattern === "double_three") return "W-X-Y 双重三浪调整";
  if (candidate.pattern === "expanded_flat") return "扩散平台型 A-B-C 调整";
  if (candidate.pattern === "running_flat") return "顺势平台型 A-B-C 调整";
  if (candidate.pattern === "flat") return "平台型 A-B-C 调整";
  return "锯齿型 A-B-C 调整";
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

export function buildWaveAnalysisReport(snapshot, theoryResult, review, context = {}) {
  const candidatesById = new Map(theoryResult.structures.candidates.map((candidate) => [candidate.id, candidate]));
  const primary = candidatesById.get(review.primaryCandidateId) || theoryResult.structures.primaryCandidate;
  const alternatives = review.alternateCandidateIds
    .map((id) => candidatesById.get(id))
    .filter(Boolean);
  const instruction = String(context.instruction || "").trim();
  const firstCandle = snapshot.candles[0];
  const lastCandle = snapshot.candles.at(-1);
  const action = buildWaveActionPlan(snapshot, primary);
  const mainScenario = action.primaryScenario === "bullish" ? "优先观察向上反转" : "优先观察向下延续";
  return [
    `## ${snapshot.marketId} · 波浪理论交易计划`,
    instruction ? `分析要求：${instruction}` : "",
    "",
    "### 先看结论",
    `当前价格约 ${formatPrice(action.currentPrice)}。当前主计数${mainScenario}，但必须等关键价位确认；没有确认前按震荡处理。`,
    `- **上破 ${formatPrice(action.longTrigger)} 后偏多**：等待当前 ${plainIntervalLabel(snapshot.interval)} K 线收盘站稳，第一关注目标 ${formatPrice(action.longTarget)}；若随后跌破 ${formatPrice(action.shortTrigger)}，多头方案取消。`,
    `- **跌破 ${formatPrice(action.shortTrigger)} 后偏空**：等待当前 ${plainIntervalLabel(snapshot.interval)} K 线收盘确认，第一关注目标 ${formatPrice(action.shortTarget)}；若随后重新站上 ${formatPrice(action.longTrigger)}，空头方案取消。`,
    `- **${formatPrice(action.shortTrigger)}–${formatPrice(action.longTrigger)} 之间先等待**：这里仍可能只是浪内震荡，不抢跑、不根据一根未收盘 K 线追单。`,
    "",
    "### 新手执行清单",
    "1. 只在关键价位被本周期收盘确认后行动；盘中刺破又收回，按假突破处理。",
    "2. 不在两个触发价之间猜第几浪，也不要因为看到“第 3 浪”就追涨。",
    "3. 单笔预设亏损建议控制在账户的 0.5%–1%，止损触发后不补仓摊平。",
    "4. 永续合约优先低杠杆或不用杠杆；到达第一目标后可分批止盈。",
    "",
    "### 当前数浪（可跳过）",
    `${candidateKindLabel(primary)}，${primary.degree || "当前画布相对级别"}，${statusLabel(primary.status)}。通俗理解：系统只展示已通过价格硬规则和低一级结构证据的计数；${primary.kind === "cycle" ? "当前候选包含动机段与后续调整" : "当前候选只覆盖一个已验证结构段"}，末端仍会随新 K 线变化。`,
    `浪点：${primary.points.map((point) => `${point.label} ${formatPrice(point.price)}`).join(" → ")}。`,
    `规则检查：${candidateRuleText(primary)}`,
    `比例参考：${candidateRatioText(primary)}。这些比例用于比较候选是否合理，不代表价格一定按比例到达。`,
    "",
    "### 如果主计数不成立",
    alternatives.length
      ? alternatives.map((candidate, index) => `${index + 1}. 备选 ${index + 1}：${candidateKindLabel(candidate)}，末端约 ${formatPrice(candidate.points.at(-1).price)}；只有主计数触发价失效后才转看该方案。`).join("\n")
      : "没有额外绘制备选路径。主计数一旦越过取消价，就停止沿用本次结论并等待重新数浪。",
    "",
    "### 数据与不确定性",
    `本次使用 ${snapshot.candles.length} 根 ${snapshot.interval} K 线，覆盖 ${formatTime(firstCandle.time)} 至 ${formatTime(lastCandle.time)}，识别 ${theoryResult.statistics.swingCount} 个交替高低点和 ${theoryResult.statistics.candidateCount} 个受规则约束的候选。`,
    "波浪理论对起点和级别存在天然歧义；“暂定”只表示最后一个已通过结构规则的浪点还可能随新 K 线移动，不表示允许违反硬规则。波4重叠不会被自动解释为倾斜，内部结构或倾斜位置证据不足时不会落图。",
    "",
    "### 风险说明",
    "关键价位会随新摆动点重新计算。以上是条件式观察方案，不是唯一事实、自动交易指令、收益承诺或经过历史校准的涨跌概率。",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function candidateById(theoryResult, id) {
  return theoryResult.structures.candidates.find((candidate) => candidate.id === id) || null;
}

function wavePathOperation(analysisId, candidate, colorToken, status, suffix, points) {
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
    },
  };
}

function wavePathOperations(analysisId, candidate, colorToken, status = candidate.status) {
  if (candidate.kind !== "cycle") {
    return [wavePathOperation(analysisId, candidate, colorToken, status, "", candidate.points)];
  }
  const impulsePointCount = candidate.components?.impulsePointCount || 6;
  const impulsePoints = candidate.points.slice(0, impulsePointCount);
  const correctionPoints = candidate.points.slice(Math.max(0, impulsePointCount - 1));
  return [
    wavePathOperation(analysisId, candidate, colorToken === "wave-alternative" ? colorToken : "wave-primary", status, "motive", impulsePoints),
    wavePathOperation(analysisId, candidate, colorToken === "wave-alternative" ? colorToken : "wave-correction", status, "correction", correctionPoints),
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
  if (candidate.kind === "cycle") {
    const motive = candidate.components?.motiveKind === "diagonal" ? "倾斜5浪" : "标准5浪";
    return candidate.pattern.endsWith("_plus_wxy") ? `${motive} + WXY` : `${motive} + ABC`;
  }
  if (candidate.kind === "impulse") return "标准5浪推动";
  if (candidate.kind === "diagonal") return "已验证倾斜5浪";
  if (candidate.pattern === "double_three") return "WXY调整";
  return "ABC调整";
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
      text: `主计数：${waveDrawingLabel(primary)}`,
      colorToken: "wave-note",
      status: primary.status === "confirmed" ? "confirmed" : "tentative",
      evidenceIds: primary.points.map((point) => point.id),
    },
  });
  const impulsePointCount = primary.kind === "cycle" ? primary.components?.impulsePointCount || 6 : primary.points.length;
  const impulsePoints = primary.points.slice(0, impulsePointCount);
  const impulseStart = impulsePoints[0];
  const impulseEnd = impulsePoints.at(-1);
  if (impulseStart && impulseEnd) {
    for (const ratio of [0.382, 0.5, 0.618]) {
      const price = impulseEnd.price + (impulseStart.price - impulseEnd.price) * ratio;
      const ratioLabel = ratio.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
      operations.push({
        op: "upsert",
        drawing: {
          id: `${analysisId}-${primary.id}-fib-${ratioLabel}`,
          theory: "wave",
          tool: "path",
          points: [
            { time: impulseEnd.time, price },
            { time: projectionEnd, price },
          ],
          colorToken: "wave-fibonacci",
          status: "tentative",
          evidenceIds: [impulseStart.id, impulseEnd.id],
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
          evidenceIds: [impulseStart.id, impulseEnd.id],
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
      text: `主计数失效 ${formatPrice(primary.invalidationPrice)}`,
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
        text: `主计数确认 ${formatPrice(primary.confirmationPrice)}`,
        colorToken: "wave-fibonacci",
        status: "tentative",
        evidenceIds: [primary.points.at(-1).id],
      },
    });
  }
  const alternateCandidates = [];
  const alternateIds = new Set();
  for (const id of review.alternateCandidateIds || []) {
    const candidate = candidateById(theoryResult, id);
    if (candidate && candidate.id !== primary.id && !alternateIds.has(candidate.id)) {
      alternateIds.add(candidate.id);
      alternateCandidates.push(candidate);
    }
  }
  const alternativePool = theoryResult.structures.candidates
    .filter((candidate) => candidate.id !== primary.id)
    .sort((first, second) => {
      const firstDiversity = Number(first.pattern !== primary.pattern) * 4
        + Number(first.projection?.direction !== primary.projection?.direction) * 2
        + Number(first.kind !== primary.kind);
      const secondDiversity = Number(second.pattern !== primary.pattern) * 4
        + Number(second.projection?.direction !== primary.projection?.direction) * 2
        + Number(second.kind !== primary.kind);
      return secondDiversity - firstDiversity;
    });
  for (const candidate of alternativePool) {
    if (alternateCandidates.length >= 2) break;
    if (candidate.id === primary.id || alternateIds.has(candidate.id)) continue;
    alternateIds.add(candidate.id);
    alternateCandidates.push(candidate);
  }
  alternateCandidates.slice(0, 2).forEach((candidate, index) => {
    operations.push(
      wavePathOperation(analysisId, candidate, "wave-alternative", "tentative", `alternate-${index + 1}`, candidate.points),
      {
        op: "upsert",
        drawing: {
          id: `${analysisId}-${candidate.id}-alternate-${index + 1}-label`,
          theory: "wave",
          tool: "note",
          points: [{ time: candidate.points.at(-1).time, price: candidate.points.at(-1).price }],
          text: `备选${index + 1}：${waveDrawingLabel(candidate)}`,
          colorToken: "wave-alternative",
          status: "tentative",
          evidenceIds: candidate.points.map((point) => point.id),
        },
      },
    );
  });
  const action = buildWaveActionPlan(snapshot, primary);
  operations.push({
    op: "upsert",
    drawing: {
      id: `${analysisId}-${primary.id}-summary`,
      theory: "wave",
      tool: "note",
      points: [{ time: latestCandle.time, price: latestCandle.close }],
      text: `关键价位：上破 ${formatPrice(action.longTrigger)} 偏多｜跌破 ${formatPrice(action.shortTrigger)} 偏空｜区间内等待`,
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
  const actionPlan = buildWaveActionPlan(snapshot, primaryCandidate);
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
