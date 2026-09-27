import crypto from "node:crypto";
import { HARMONIC_ENGINE_ID, runHarmonicPatternEngine } from "./harmonic-engine.mjs";
import { runValidatedTradingModelReview } from "./model-review.mjs";
import {
  TRADING_ANALYSIS_SCHEMA_VERSION,
  normalizeTradingMarketSnapshot,
  validateStrategyDrawingPatch,
} from "./protocol.mjs";

const STRATEGY_ID = "harmonic";

function extractJsonObject(text) {
  const source = String(text || "").trim();
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new TypeError("Model response did not contain a JSON object");
  return JSON.parse(source.slice(first, last + 1));
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const digits = Math.abs(number) >= 1_000 ? 2 : Math.abs(number) >= 1 ? 4 : 6;
  return number.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function formatRatio(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : "—";
}

function formatTime(seconds) {
  return new Date(Number(seconds) * 1_000).toLocaleString("zh-CN", { hour12: false });
}

function modelNarrative(value, field, max) {
  const result = String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
  if (/[0-9０-９]/u.test(result)) {
    throw new TypeError(`Model response ${field} must not contain numeric claims`);
  }
  return result;
}

function candidateById(theoryResult, candidateId) {
  return theoryResult.structures.candidates.find((candidate) => candidate.id === candidateId) || null;
}

function directionLabel(direction) {
  return direction === "bullish" ? "看涨反转" : "看跌反转";
}

function statusLabel(candidate) {
  const terminalLabel = candidate.terminalLabel || candidate.points.at(-1)?.label || "终点";
  if (candidate.tradeState === "completed") return "第二目标已到达，原方案结束";
  if (candidate.tradeState === "partial-target-reached") return "第一目标已到达，不追价";
  if (candidate.status === "confirmed") return `${terminalLabel} 点后的已收盘 K 线已确认反转`;
  return `${terminalLabel} 点已进入 PRZ，仍等待 Terminal Bar 后确认`;
}

function measurementText(candidate) {
  const measurements = Array.isArray(candidate.measurements)
    ? candidate.measurements
    : Object.entries(candidate.ratios || {}).map(([label, value]) => ({ label, value }));
  return measurements.map((measurement) => (
    `${measurement.label} ${formatRatio(measurement.value)}`
  )).join("；");
}

function targetBasisText(candidate) {
  if (candidate.patternId === "shark") return "C→B 的 50% / 61.8% 主动管理回撤目标";
  if (candidate.patternId === "cypher") return "D→C 的 38.2% / 61.8% 回撤目标";
  return "D→A 的 38.2% / 61.8% 回撤目标";
}

function harmonicAnalysisId(snapshot, purpose, ...parts) {
  return `harmonic-analysis-${crypto.createHash("sha1")
    .update(JSON.stringify([snapshot.snapshotId, purpose, ...parts]))
    .digest("hex")
    .slice(0, 18)}`;
}

function snapshotSummary(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    snapshotTime: snapshot.snapshotTime,
    inputHash: snapshot.inputHash,
  };
}

export function buildHarmonicActionPlan(snapshot, candidate) {
  if (!candidate || ["completed", "partial-target-reached", "invalidated"].includes(candidate.tradeState)) {
    return Object.freeze({
      primaryBias: candidate?.direction || "neutral",
      confirmation: candidate
        ? `该形态目标已部分或全部实现，不按历史 ${candidate.terminalLabel || "D"} 点追价；等待新形态并重新分析`
        : "当前没有通过比例与 PRZ 收敛规则的可执行谐波候选",
    });
  }
  const bullish = candidate.direction === "bullish";
  const [target1, target2] = candidate.actionLevels.targets;
  return Object.freeze({
    primaryBias: bullish ? "bullish" : "bearish",
    currentPrice: snapshot.candles.at(-1).close,
    waitZone: Object.freeze({ lower: candidate.prz.low, upper: candidate.prz.high }),
    ...(bullish ? {
      longTrigger: candidate.actionLevels.trigger,
      longInvalidation: candidate.actionLevels.stop,
      longTarget: target1,
      longTargets: Object.freeze([target1, target2]),
    } : {
      shortTrigger: candidate.actionLevels.trigger,
      shortInvalidation: candidate.actionLevels.stop,
      shortTarget: target1,
      shortTargets: Object.freeze([target1, target2]),
    }),
    confirmation: candidate.status === "confirmed"
      ? `Terminal Bar 后已有已收盘 K 线向${bullish ? "上" : "下"}突破 ${formatPrice(candidate.actionLevels.trigger)}；只在回踩/反抽仍守住触发位时执行，不能在远离 PRZ 后追价`
      : `尚未确认；必须等待 ${candidate.terminalLabel || "D"} 点 Terminal Bar 之后的已收盘 K 线向${bullish ? "上" : "下"}突破 ${formatPrice(candidate.actionLevels.trigger)}`,
  });
}

export function buildHarmonicDevelopingActionPlan(snapshot, candidate) {
  return Object.freeze({
    primaryBias: candidate.direction,
    currentPrice: snapshot.candles.at(-1).close,
    waitZone: Object.freeze({ lower: candidate.prz.low, upper: candidate.prz.high }),
    confirmation: `${candidate.patternName} 仍在形成，预测 ${candidate.terminalLabel} 区域尚不是入场信号；必须先形成终点摆动，再等待 Terminal Bar 后的已收盘反转确认`,
    disposition: "wait",
    developmentStage: "projected-prz-only",
  });
}

export function buildHarmonicModelPrompt(snapshot, theoryResult, context = {}) {
  const compactCandidates = theoryResult.structures.candidates.map((candidate) => ({
    id: candidate.id,
    patternId: candidate.patternId,
    patternName: candidate.patternName,
    topologyId: candidate.topologyId,
    terminalLabel: candidate.terminalLabel,
    direction: candidate.direction,
    status: candidate.status,
    tradeState: candidate.tradeState,
    score: candidate.score,
    points: candidate.points,
    ratios: candidate.ratios,
    measurements: candidate.measurements,
    prz: candidate.prz,
    actionLevels: candidate.actionLevels,
    ruleIds: candidate.ruleIds,
  }));
  return [
    "你是 Haolo 谐波形态候选复核器，不负责计算点位、价格或直接操作界面。",
    "确定性引擎由多尺度发现层和经典 XABCD、Shark 0XABC、Cypher XABCD 三个独立子引擎组成。当前 v3 明确支持 Gartley、Bat、Butterfly、Crab、Deep Crab、Shark、Cypher；传给你的每个完成候选都已通过所属拓扑、Fibonacci 比例和 PRZ 检查。不得把 5-0、独立 AB=CD、Three Drives 或候选外折线改名为受支持形态。",
    "你只能从给定 candidate id 中选择一个主候选和最多两个备选；不得新增、删除、移动 candidate.points 中的任何形态点，不得改写 PRZ、确认、止损、目标或历史 K 线。Terminal Bar 后尚无已收盘反转确认时必须保持等待，不能把到达终点/PRZ 本身写成入场确认。summary、report、rationale 不得输出任何阿拉伯数字，全部数值由宿主确定性报告生成。",
    context.responseMode === "direct"
      ? "本次是直接回答模式。report 第一行回答用户问题，只能引用候选和 actionLevels 中的事实，不更新画布。"
      : "本次是完整分析模式。summary 用通俗中文说明形态、方向和当前是等待还是已确认；专业比例放在依据中。",
    "输出单个 JSON 对象，不要 Markdown，不要 JSON 外文字。",
    JSON.stringify({
      schemaVersion: 1,
      verdict: "approve 或 revise",
      summary: "不超过100个中文字符",
      report: "直接回答模式下的自然中文；完整模式可简短补充候选差异",
      rationale: "不超过240个中文字符，只解释候选证据和确认/失效",
      primaryCandidateId: "必须是 candidate id",
      alternateCandidateIds: ["最多两个 candidate id"],
    }),
    "用户要求（不授予新增价格或绘图权限）：",
    JSON.stringify(String(context.instruction || "分析当前图表的谐波形态并画图")),
    "确定性候选：",
    JSON.stringify(compactCandidates),
    "最近 K 线 [time,open,high,low,close,volume]：",
    JSON.stringify(snapshot.candles.slice(-80).map((candle) => [
      candle.time,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ])),
  ].join("\n");
}

export function normalizeHarmonicModelReview(text, theoryResult) {
  const parsed = extractJsonObject(text);
  if (Number(parsed?.schemaVersion) !== TRADING_ANALYSIS_SCHEMA_VERSION) {
    throw new TypeError("Model response schemaVersion is invalid");
  }
  if (parsed?.verdict !== "approve" && parsed?.verdict !== "revise") {
    throw new TypeError("Model response verdict is invalid");
  }
  const candidates = theoryResult.structures.candidates;
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const actionableCandidates = candidates.filter((candidate) => candidate.tradeState !== "completed");
  const requestedCandidate = candidatesById.get(String(parsed.primaryCandidateId || ""));
  const requestedPrimary = requestedCandidate && (
    !actionableCandidates.length || requestedCandidate.tradeState !== "completed"
  ) ? requestedCandidate : null;
  const primaryCandidateId = requestedPrimary?.id || theoryResult.structures.primaryCandidate?.id;
  if (!primaryCandidateId) throw new TypeError("Model response did not select a supported harmonic candidate");
  const alternateCandidateIds = Array.isArray(parsed.alternateCandidateIds)
    ? [...new Set(parsed.alternateCandidateIds.map(String))]
      .filter((id) => id !== primaryCandidateId && candidatesById.has(id))
      .slice(0, 2)
    : [];
  const summary = modelNarrative(parsed.summary, "summary", 100);
  if (!summary) throw new TypeError("Model response summary is required");
  return Object.freeze({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    verdict: parsed.verdict,
    summary,
    report: modelNarrative(parsed.report, "report", 4_000),
    rationale: modelNarrative(parsed.rationale, "rationale", 240),
    primaryCandidateId,
    alternateCandidateIds: Object.freeze(alternateCandidateIds),
  });
}

export function buildHarmonicAnalysisReport(snapshot, theoryResult, review, context = {}) {
  const candidate = candidateById(theoryResult, review.primaryCandidateId)
    || theoryResult.structures.primaryCandidate;
  if (!candidate) return "当前没有通过规则验证的谐波形态。";
  if (context.responseMode === "direct" && review.report) {
    return [review.report, "", `确定性状态：${candidate.patternName} ${directionLabel(candidate.direction)}，${statusLabel(candidate)}。`].join("\n");
  }
  const pointText = candidate.points
    .map((point) => `${point.label}=${formatPrice(point.price)}（${formatTime(point.time)}）`)
    .join("，");
  const [target1, target2] = candidate.actionLevels.targets;
  const bullish = candidate.direction === "bullish";
  const topologyLabels = candidate.points.map((point) => point.label).join("-");
  const przComponents = candidate.prz.components?.join("、") || "所属形态的确定性投影";
  return [
    "## 谐波形态结论",
    "",
    `识别到 **${candidate.patternName} ${directionLabel(candidate.direction)}**；${statusLabel(candidate)}。${review.summary}`,
    "",
    "### 形态与 PRZ",
    `- ${topologyLabels}：${pointText}`,
    `- 比例：${measurementText(candidate)}。`,
    `- 潜在反转区 PRZ：${formatPrice(candidate.prz.low)}–${formatPrice(candidate.prz.high)}；${przComponents}在此收敛。`,
    "",
    "### 条件式执行",
    `- 当前条件：${candidate.status === "confirmed" ? "Terminal Bar 后确认已出现，但仍需避免远离 PRZ 后追价。" : "只到达 PRZ 还不能入场，继续等待 Terminal Bar 后的已收盘反转确认。"}`,
    `- 方向与触发：${bullish ? "偏多" : "偏空"}；已收盘 K 线${bullish ? "向上" : "向下"}突破 ${formatPrice(candidate.actionLevels.trigger)}，回踩/反抽不重新失守后才执行。`,
    `- 止损/失效参考：${formatPrice(candidate.actionLevels.stop)}；这是 PRZ 外侧的确定性风险缓冲，不是收益保证。`,
    `- 分批目标：T1 ${formatPrice(target1)}；T2 ${formatPrice(target2)}；依据为${targetBasisText(candidate)}。`,
    `- 模型复核：${review.rationale || "主候选保持确定性排序；模型未增加任何点位或价格。"}`,
    "",
    "### 数据与限制",
    `本次使用 ${snapshot.candles.length} 根 ${snapshot.interval} 已收盘 K 线。摆动点、比例、PRZ 和价格均可由相同输入复算；模型只负责候选排序和文字解释。`,
    "形态识别不等于胜率，PRZ 也不是必然反转点。方案过期、止损位被收盘穿越、数据变化或目标已到达后必须重新分析。",
  ].join("\n");
}

export function buildHarmonicNoCandidateReport(snapshot, theoryResult) {
  const swings = theoryResult.pivots.swings.slice(-5);
  const swingText = swings.length
    ? swings.map((point) => `${point.type === "high" ? "高" : "低"}点 ${formatPrice(point.price)}（${formatTime(point.time)}）`).join("，")
    : "当前窗口没有形成可确认的交替摆动点";
  return [
    "## 谐波扫描结论",
    "",
    "本次扫描已经正常完成；结果是**当前没有合格谐波候选**，不是系统分析失败。",
    "",
    "### 扫描结果",
    `- 数据范围：${snapshot.candles.length} 根 ${snapshot.interval} 已收盘 K 线。`,
    `- 摆动点：${theoryResult.pivots.scanProfiles?.length || 1} 个尺度累计原始 ${theoryResult.pivots.rawCount} 个，压缩后 ${theoryResult.pivots.compactCount} 个。`,
    "- 已逐一检查：Gartley、Bat、Butterfly、Crab、Deep Crab、Shark、Cypher 的多空结构。",
    "- 淘汰结论：当前没有五点序列能够同时通过所属拓扑、全部硬比例、PRZ 收敛与未失效检查，因此不会强行命名形态或编造 PRZ。",
    `- 最近观察摆动：${swingText}。`,
    "",
    "### 当前执行方案",
    "- 当前动作：不交易，等待新的已确认摆动点或新的已收盘 K 线后重扫。",
    "- 入场、止损和目标：当前均不生成；缺少合格候选时给出具体价位会制造虚假精度。",
    "- 重新分析条件：出现新的局部高低点、价格完成新的回撤/延伸腿，或切换到用户明确指定的更长观察范围。",
    "- 取消条件：在没有完整候选与 Terminal Bar 后确认前，任何主观猜测都不进入执行阶段。",
    "",
    "### 图上标记说明",
    "紫色观察线仅连接最近的确定性摆动点，并明确标记为“未通过七形态全部硬规则”；它不是谐波形态、PRZ 或入场信号。",
  ].join("\n");
}

export function buildHarmonicDevelopingReport(snapshot, theoryResult) {
  const candidate = theoryResult.structures.primaryDevelopingCandidate;
  if (!candidate) return buildHarmonicNoCandidateReport(snapshot, theoryResult);
  const alternateNames = [...new Set(theoryResult.structures.developingCandidates
    .filter((item) => item.id !== candidate.id)
    .map((item) => item.patternName))].slice(0, 4);
  const pointText = candidate.points
    .map((point) => `${point.label}=${formatPrice(point.price)}（${formatTime(point.time)}）`)
    .join("，");
  const topologyLabels = candidate.points.map((point) => point.label).join("-");
  const progressPercent = Math.max(0, Math.min(120, Math.round(candidate.progress.ratio * 100)));
  return [
    "## 谐波形态结论",
    "",
    `识别到 **${candidate.patternName} ${directionLabel(candidate.direction)}的发展中结构**；前置拓扑和比例已通过，但 ${candidate.terminalLabel} 点尚未完成，因此这不是已完成形态或入场信号。`,
    "",
    "### 已确认结构与预测 PRZ",
    `- 已确认 ${topologyLabels}：${pointText}。`,
    `- 已通过的前置比例：${measurementText(candidate)}。`,
    `- 预测 ${candidate.terminalLabel} 点潜在反转区：${formatPrice(candidate.prz.low)}–${formatPrice(candidate.prz.high)}；投影组件为 ${candidate.prz.components.join("、")}。`,
    `- 当前完成进度：价格从 ${candidate.points.at(-1).label} 腿向预测区推进约 ${progressPercent}%；该数值只描述路径进度，不代表成功概率。`,
    ...(alternateNames.length ? [`- 分支歧义：同一前置结构也满足 ${alternateNames.join("、")} 的早期条件；必须由终点位置和最终比例决定名称，当前不提前定型。`] : []),
    `- 扫描来源：${candidate.scan.profileId} 尺度，${candidate.scan.selectionMode === "consecutive" ? "连续结构摆动" : "已过滤次级噪声摆动"}。`,
    "",
    "### 当前执行方案",
    "- 当前动作：等待，不交易。发展中结构不生成入场、止损、目标或仓位。",
    `- 第一层条件：价格在预测 PRZ 附近形成可确认的 ${candidate.terminalLabel} 终点摆动，且结构没有明显越过预测区失效。`,
    `- 第二层条件：${candidate.terminalLabel} 点 Terminal Bar 之后，出现方向相符的已收盘反转确认；届时必须用最新 K 线重算完整比例、PRZ、失效位与目标。`,
    "- 取消条件：价格在终点形成前大幅越过预测 PRZ、前置摆动被新高/新低改写，或方案超过三个当前周期仍未完成。",
    "",
    "### 数据与限制",
    `本次使用 ${snapshot.candles.length} 根 ${snapshot.interval} 已收盘 K 线，并行扫描 ${theoryResult.pivots.scanProfiles?.length || 1} 个摆动尺度。预测 PRZ 是确定性投影，不是保证反转的价格。`,
  ].join("\n");
}

function operation(
  candidate,
  analysisId,
  suffix,
  role,
  tool,
  points,
  text = undefined,
  evidenceIds = candidate.evidenceIds,
  appearance = {},
) {
  return {
    op: "upsert",
    drawing: {
      id: `${analysisId}-${suffix}`,
      strategyId: STRATEGY_ID,
      theory: "strategy",
      layer: `ai/strategy/${STRATEGY_ID}`,
      tool,
      points: points.map((point) => ({ time: point.time, price: point.price })),
      ...(text ? { text } : {}),
      colorToken: `strategy-${role}`,
      ...(appearance.lineStyle ? { lineStyle: appearance.lineStyle } : {}),
      ...(Number.isFinite(appearance.lineWidth) ? { lineWidth: appearance.lineWidth } : {}),
      ...(Number.isFinite(appearance.fontSize) ? { fontSize: appearance.fontSize } : {}),
      ...(typeof appearance.bold === "boolean" ? { bold: appearance.bold } : {}),
      status: appearance.status || (candidate.status === "confirmed" ? "confirmed" : "tentative"),
      evidenceIds,
    },
  };
}

function harmonicPoint(candidate, label) {
  return candidate.points.find((point) => point.label === label) || null;
}

function harmonicMeasurement(candidate, label) {
  return candidate.measurements?.find((measurement) => measurement.label === label) || null;
}

function harmonicMeasurementGuideSpecs(candidate) {
  if (candidate.topologyId === "shark-0xabc") {
    return [
      { id: "ab-xa", from: "X", to: "B", labels: ["AB/XA"] },
      { id: "bc-ab", from: "A", to: "C", labels: ["BC/AB"] },
      { id: "c-ox", from: "0", to: "C", labels: ["C/OX"] },
    ];
  }
  if (candidate.topologyId === "cypher-xabcd") {
    return [
      { id: "b-xa", from: "X", to: "B", labels: ["B/XA"] },
      { id: "c-xa", from: "X", to: "C", labels: ["C/XA"] },
      { id: "d-xc", from: "X", to: "D", labels: ["D/XC"] },
    ];
  }
  return [
    { id: "b-xa", from: "X", to: "B", labels: ["B/XA"] },
    { id: "c-ab", from: "A", to: "C", labels: ["C/AB"] },
    { id: "d-xa", from: "X", to: "D", labels: ["D/XA"] },
    { id: "cd-projections", from: "B", to: "D", labels: ["CD/BC", "CD/AB"] },
  ];
}

function harmonicPriceSpan(candidate, additionalPrices = []) {
  const prices = [
    ...candidate.points.map((point) => point.price),
    ...additionalPrices,
  ].filter(Number.isFinite);
  return Math.max(...prices) - Math.min(...prices);
}

function harmonicPointLabelAnchor(candidate, point, additionalPrices = []) {
  const offset = Math.max(harmonicPriceSpan(candidate, additionalPrices) * 0.025, point.price * 0.0005);
  const direction = point.type === "high" ? 1 : -1;
  return { time: point.time, price: Math.max(Number.EPSILON, point.price + offset * direction) };
}

function harmonicGuideLabelAnchor(candidate, first, second, index, additionalPrices = []) {
  const offset = Math.max(harmonicPriceSpan(candidate, additionalPrices) * 0.018, first.price * 0.00035);
  const direction = index % 2 === 0 ? 1 : -1;
  return {
    time: Math.round((first.time + second.time) / 2),
    price: Math.max(Number.EPSILON, (first.price + second.price) / 2 + offset * direction),
  };
}

function appendHarmonicPointLabels(operations, candidate, analysisId, additionalPrices = []) {
  for (const point of candidate.points) {
    operations.push(operation(
      candidate,
      analysisId,
      `point-${point.label.toLowerCase()}`,
      candidate.direction === "bullish" ? "support" : "resistance",
      "text",
      [harmonicPointLabelAnchor(candidate, point, additionalPrices)],
      point.label,
      [point.id],
      { status: "confirmed", fontSize: 12, bold: true },
    ));
  }
}

function appendHarmonicMeasurementGuides(operations, candidate, analysisId, additionalPrices = []) {
  harmonicMeasurementGuideSpecs(candidate).forEach((guide, index) => {
    const first = harmonicPoint(candidate, guide.from);
    const second = harmonicPoint(candidate, guide.to);
    const measurements = guide.labels.map((label) => harmonicMeasurement(candidate, label)).filter(Boolean);
    if (!first || !second || !measurements.length) return;
    operations.push(operation(
      candidate,
      analysisId,
      `ratio-line-${guide.id}`,
      "note",
      "path",
      [first, second],
      undefined,
      candidate.evidenceIds,
      { status: "confirmed", lineStyle: "dotted", lineWidth: 1.5 },
    ));
    operations.push(operation(
      candidate,
      analysisId,
      `ratio-label-${guide.id}`,
      "note",
      "text",
      [harmonicGuideLabelAnchor(candidate, first, second, index, additionalPrices)],
      measurements.map((measurement) => `${measurement.label} ${formatRatio(measurement.value)}`).join(" · "),
      candidate.evidenceIds,
      { status: "confirmed", fontSize: 10, bold: true },
    ));
  });
}

export function buildHarmonicDrawingPatch(snapshot, theoryResult, review) {
  const candidate = candidateById(theoryResult, review.primaryCandidateId)
    || theoryResult.structures.primaryCandidate;
  if (!candidate) throw new TypeError("The approved harmonic drawing plan has no supported candidate");
  const analysisId = harmonicAnalysisId(snapshot, candidate.id, review.primaryCandidateId);
  const evidenceIds = candidate.evidenceIds;
  const primaryRole = candidate.direction === "bullish" ? "support" : "resistance";
  const operations = [operation(
    candidate,
    analysisId,
    candidate.topologyId === "shark-0xabc" ? "0xabc" : "xabcd",
    primaryRole,
    "path",
    candidate.points,
    undefined,
    evidenceIds,
    { status: "confirmed", lineStyle: "solid", lineWidth: 3 },
  )];
  appendHarmonicPointLabels(operations, candidate, analysisId);
  appendHarmonicMeasurementGuides(operations, candidate, analysisId);
  const terminal = candidate.points[4];
  const latest = snapshot.candles.at(-1);
  const previous = snapshot.candles.at(-2);
  const interval = Math.max(1, latest.time - previous.time);
  const zoneStart = terminal.time < latest.time ? terminal.time : Math.max(candidate.points[3].time, terminal.time - interval * 2);
  const zoneEnd = Math.max(latest.time, terminal.time);
  operations.push(operation(
    candidate,
    analysisId,
    "prz",
    candidate.direction === "bullish" ? "support" : "resistance",
    "rectangle",
    [{ time: zoneStart, price: candidate.prz.high }, { time: zoneEnd, price: candidate.prz.low }],
    `PRZ ${formatPrice(candidate.prz.low)}–${formatPrice(candidate.prz.high)}`,
    evidenceIds,
    { lineStyle: "dashed", lineWidth: 1.5 },
  ));
  const lineStart = terminal.time < latest.time ? terminal.time : candidate.points[3].time;
  const lineEnd = Math.max(latest.time, terminal.time);
  const levels = [
    ["entry", candidate.actionLevels.trigger, `确认 ${formatPrice(candidate.actionLevels.trigger)}`],
    ["stop", candidate.actionLevels.stop, `失效 ${formatPrice(candidate.actionLevels.stop)}`],
    ["target", candidate.actionLevels.targets[0], `T1 ${formatPrice(candidate.actionLevels.targets[0])}`],
    ["target", candidate.actionLevels.targets[1], `T2 ${formatPrice(candidate.actionLevels.targets[1])}`],
  ];
  levels.forEach(([role, price, text], index) => operations.push(operation(
    candidate,
    analysisId,
    `level-${index}`,
    role,
    "path",
    [{ time: lineStart, price }, { time: lineEnd, price }],
    text,
    evidenceIds,
    { lineStyle: "dashed", lineWidth: 1.5 },
  )));
  operations.push(operation(
    candidate,
    analysisId,
    "terminal",
    candidate.direction === "bullish" ? "support" : "resistance",
    candidate.direction === "bullish" ? "arrow-up" : "arrow-down",
    [terminal],
    `${candidate.patternName} ${candidate.terminalLabel || terminal.label} / Terminal Bar`,
  ));
  operations.push(operation(
    candidate,
    analysisId,
    "summary",
    "note",
    "note",
    [candidate.points[0]],
    `${candidate.patternName} ${directionLabel(candidate.direction)} · ${candidate.status === "confirmed" ? "已确认" : "待确认"}`,
  ));
  return validateStrategyDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot, STRATEGY_ID);
}

export function buildHarmonicNoCandidateDrawingPatch(snapshot, theoryResult) {
  const analysisId = harmonicAnalysisId(snapshot, "no-qualified-candidate");
  const swings = theoryResult.pivots.swings.slice(-5);
  const evidenceIds = swings.map((point) => point.id);
  const latest = snapshot.candles.at(-1);
  const anchor = swings.at(-1) || Object.freeze({ time: latest.time, price: latest.close });
  const operations = [];
  if (swings.length >= 2) {
    operations.push({
      op: "upsert",
      drawing: {
        id: `${analysisId}-observation-path`,
        strategyId: STRATEGY_ID,
        theory: "strategy",
        layer: `ai/strategy/${STRATEGY_ID}`,
        tool: "path",
        points: swings.map((point) => ({ time: point.time, price: point.price })),
        colorToken: "strategy-note",
        status: "tentative",
        evidenceIds,
      },
    });
  }
  operations.push({
    op: "upsert",
    drawing: {
      id: `${analysisId}-observation-note`,
      strategyId: STRATEGY_ID,
      theory: "strategy",
      layer: `ai/strategy/${STRATEGY_ID}`,
      tool: "note",
      points: [{ time: anchor.time, price: anchor.price }],
      text: "观察摆动：未通过七形态全部硬规则",
      colorToken: "strategy-note",
      status: "tentative",
      evidenceIds,
    },
  });
  return validateStrategyDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot, STRATEGY_ID);
}

export function buildHarmonicDevelopingDrawingPatch(snapshot, theoryResult) {
  const candidate = theoryResult.structures.primaryDevelopingCandidate;
  if (!candidate) throw new TypeError("The developing harmonic drawing plan has no projected candidate");
  const analysisId = harmonicAnalysisId(snapshot, "developing", candidate.id);
  const latest = snapshot.candles.at(-1);
  const lastPoint = candidate.points.at(-1);
  const projectedPrice = candidate.projectedTerminal.price;
  const projectedTerminal = { time: latest.time, price: projectedPrice };
  const primaryRole = candidate.direction === "bullish" ? "support" : "resistance";
  const operations = [operation(
    candidate,
    analysisId,
    candidate.topologyId === "shark-0xabc" ? "0xab-developing" : "xabc-developing",
    primaryRole,
    "path",
    candidate.points,
    undefined,
    candidate.evidenceIds,
    { status: "confirmed", lineStyle: "solid", lineWidth: 3 },
  )];
  appendHarmonicPointLabels(operations, candidate, analysisId, [projectedPrice]);
  appendHarmonicMeasurementGuides(operations, candidate, analysisId, [projectedPrice]);
  operations.push(operation(
    candidate,
    analysisId,
    "projected-terminal-leg",
    "note",
    "path",
    [lastPoint, projectedTerminal],
    undefined,
    candidate.evidenceIds,
    { status: "tentative", lineStyle: "dashed", lineWidth: 2 },
  ));
  operations.push(operation(
    candidate,
    analysisId,
    "projected-prz",
    candidate.direction === "bullish" ? "support" : "resistance",
    "rectangle",
    [{ time: lastPoint.time, price: candidate.prz.high }, { time: latest.time, price: candidate.prz.low }],
    `预测 ${candidate.terminalLabel} PRZ ${formatPrice(candidate.prz.low)}–${formatPrice(candidate.prz.high)}（未完成）`,
    candidate.evidenceIds,
    { status: "tentative", lineStyle: "dashed", lineWidth: 1.5 },
  ));
  operations.push(operation(
    candidate,
    analysisId,
    "projected-terminal-label",
    "note",
    "text",
    [projectedTerminal],
    `${candidate.terminalLabel}? 预测`,
    candidate.evidenceIds,
    { status: "tentative", fontSize: 11, bold: true },
  ));
  operations.push(operation(
    candidate,
    analysisId,
    "summary",
    "note",
    "note",
    [candidate.points[0]],
    `${candidate.patternName} ${directionLabel(candidate.direction)} · 发展中`,
  ));
  return validateStrategyDrawingPatch({
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    analysisId,
    baseRevision: 0,
    marketId: snapshot.marketId,
    interval: snapshot.interval,
    operations,
  }, snapshot, STRATEGY_ID);
}

export async function runTradingHarmonicAnalysisPipeline(params, options = {}) {
  const snapshot = normalizeTradingMarketSnapshot(params);
  const theoryResult = runHarmonicPatternEngine(snapshot);
  options.onTheoryReady?.({ stage: "deterministic_theory", strategyId: "harmonic", snapshotId: snapshot.snapshotId, candleCount: snapshot.candles.length, evidenceCount: Array.isArray(theoryResult.evidence) ? theoryResult.evidence.length : 0 });
  if (theoryResult.status === "developing") {
    const candidate = theoryResult.structures.primaryDevelopingCandidate;
    const drawingPatch = buildHarmonicDevelopingDrawingPatch(snapshot, theoryResult);
    const report = buildHarmonicDevelopingReport(snapshot, theoryResult);
    const narrative = `${candidate.patternName} ${directionLabel(candidate.direction)}仍在形成；已画出确认摆动与预测 ${candidate.terminalLabel} PRZ，当前只等待形态完成和收盘确认。`;
    return {
      ok: true,
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      snapshot: snapshotSummary(snapshot),
      theoryResult,
      analysisPlan: {
        schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
        analysisId: drawingPatch.analysisId,
        revision: 0,
        snapshotId: snapshot.snapshotId,
        marketId: snapshot.marketId,
        interval: snapshot.interval,
        narrative,
        report,
        actionPlan: buildHarmonicDevelopingActionPlan(snapshot, candidate),
        drawingPatch,
      },
      model: {
        providerId: "deterministic",
        modelId: "harmonic-rule-engine-v3",
        requestId: null,
        latencyMs: 0,
        usage: null,
        finishReason: "deterministic-developing-candidate",
      },
    };
  }
  if (theoryResult.status !== "succeeded") {
    const drawingPatch = buildHarmonicNoCandidateDrawingPatch(snapshot, theoryResult);
    const report = buildHarmonicNoCandidateReport(snapshot, theoryResult);
    const narrative = "谐波扫描已完成：当前没有同时通过拓扑、硬比例和 PRZ 验证的候选，保持不交易并等待新摆动后重扫。";
    return {
      ok: true,
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      snapshot: snapshotSummary(snapshot),
      theoryResult,
      analysisPlan: {
        schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
        analysisId: drawingPatch.analysisId,
        revision: 0,
        snapshotId: snapshot.snapshotId,
        marketId: snapshot.marketId,
        interval: snapshot.interval,
        narrative,
        report,
        actionPlan: buildHarmonicActionPlan(snapshot, null),
        drawingPatch,
      },
      model: {
        providerId: "deterministic",
        modelId: "harmonic-rule-engine-v3",
        requestId: null,
        latencyMs: 0,
        usage: null,
        finishReason: "deterministic-no-candidate",
      },
    };
  }
  if (!options.modelRegistry || typeof options.modelRegistry.analyze !== "function") {
    throw new TypeError("modelRegistry is required");
  }
  const providerId = String(options.providerId || "").trim();
  const requestId = `harmonic-request-${crypto.randomUUID()}`;
  const modelRequest = {
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    requestId,
    task: "harmonic-pattern-review-and-drawing-plan",
    theoryId: HARMONIC_ENGINE_ID,
    snapshotId: snapshot.snapshotId,
    prompt: buildHarmonicModelPrompt(snapshot, theoryResult, {
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
    validateResponse: (text) => normalizeHarmonicModelReview(text, theoryResult),
  });
  const { modelResponse, review } = reviewed;
  const primaryCandidate = candidateById(theoryResult, review.primaryCandidateId)
    || theoryResult.structures.primaryCandidate;
  const actionPlan = buildHarmonicActionPlan(snapshot, primaryCandidate);
  const drawingPatch = buildHarmonicDrawingPatch(snapshot, theoryResult, review);
  const report = buildHarmonicAnalysisReport(snapshot, theoryResult, review, {
    responseMode: params?.responseMode,
  });
  return {
    ok: true,
    schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
    snapshot: snapshotSummary(snapshot),
    theoryResult,
    analysisPlan: {
      schemaVersion: TRADING_ANALYSIS_SCHEMA_VERSION,
      analysisId: drawingPatch.analysisId,
      revision: 0,
      snapshotId: snapshot.snapshotId,
      marketId: snapshot.marketId,
      interval: snapshot.interval,
      narrative: params?.responseMode === "direct" ? (review.report || review.summary) : review.summary,
      report,
      actionPlan,
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
