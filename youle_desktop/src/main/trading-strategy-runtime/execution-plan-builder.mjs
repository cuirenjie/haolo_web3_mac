import crypto from "node:crypto";
import { EXECUTION_PLAN_SCHEMA_VERSION, validateExecutionPlan } from "./contracts.mjs";

function finite(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function roundedPrice(value, tickSize = null) {
  const price = finite(value);
  if (price === null) return null;
  const tick = finite(tickSize);
  if (tick) return Number((Math.round(price / tick) * tick).toFixed(12));
  return Number(price.toFixed(8));
}

function intervalMilliseconds(interval) {
  const source = String(interval || "").trim().toUpperCase();
  if (source === "1D") return 86_400_000;
  if (source === "1W") return 604_800_000;
  const minutes = Number(source);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 3_600_000;
}

function marketSymbol(marketId) {
  const segments = String(marketId || "").split(":");
  return segments.at(-1) || String(marketId || "UNKNOWN");
}

function evidenceFromResult(result) {
  const evidence = Array.isArray(result?.theoryResult?.evidence) ? result.theoryResult.evidence : [];
  const seen = new Set();
  return evidence.slice(0, 64).flatMap((item) => {
    const id = String(item?.id ?? item ?? "").trim().slice(0, 160);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, summary: String(item?.summary || item?.label || item?.description || "").trim().slice(0, 300) }];
  });
}

function condition(id, text, evidenceIds = []) {
  return { id, text, evidenceIds };
}

function level(price, label, evidenceIds = [], tickSize = null) {
  const normalized = roundedPrice(price, tickSize);
  return normalized === null ? null : { price: normalized, label, evidenceIds };
}

function inferredPreferredSide(actionPlan, theoryResult) {
  const values = [
    actionPlan?.primaryBias,
    actionPlan?.primaryScenario,
    actionPlan?.bias,
    theoryResult?.bias,
    theoryResult?.direction,
  ].map((item) => String(item || "").trim().toLowerCase());
  if (values.some((item) => /bull|long|accum|向上|偏多|看多/.test(item))) return "long";
  if (values.some((item) => /bear|short|distrib|向下|偏空|看空/.test(item))) return "short";
  const signals = Array.isArray(theoryResult?.signals) ? theoryResult.signals : [];
  let score = 0;
  for (const signal of signals) {
    const direction = String(signal?.direction || signal?.side || signal?.bias || "").toLowerCase();
    const weight = Math.max(0.1, Math.min(1, Number(signal?.strength) || 0.5));
    if (/bull|buy|long|up/.test(direction)) score += weight;
    if (/bear|sell|short|down/.test(direction)) score -= weight;
  }
  return score > 0.2 ? "long" : score < -0.2 ? "short" : "neutral";
}

function scenario(side, actionPlan, status, evidenceIds, tickSize = null) {
  const long = side === "long";
  const trigger = level(long ? actionPlan?.longTrigger : actionPlan?.shortTrigger, long ? "多头触发价" : "空头触发价", evidenceIds, tickSize);
  const stop = level(long ? actionPlan?.longInvalidation : actionPlan?.shortInvalidation, long ? "多头失效/止损参考" : "空头失效/止损参考", evidenceIds, tickSize);
  const configuredTargets = long ? actionPlan?.longTargets : actionPlan?.shortTargets;
  const fallbackTarget = long ? actionPlan?.longTarget : actionPlan?.shortTarget;
  const targetValues = (Array.isArray(configuredTargets) && configuredTargets.length
    ? configuredTargets
    : [fallbackTarget])
    .map(finite)
    .filter((value) => value !== null);
  const seenTargets = new Set();
  const targets = targetValues.flatMap((value, index) => {
    const target = level(value, `${long ? "多头" : "空头"}第 ${index + 1} 目标`, evidenceIds, tickSize);
    if (!target || seenTargets.has(target.price)) return [];
    seenTargets.add(target.price);
    return [target];
  }).slice(0, 8);
  if (!trigger || !stop || !targets.length) return null;
  return {
    id: `${side}-scenario`,
    side,
    status,
    trigger,
    stop,
    targets,
    conditions: [condition(
      `${side}-close-confirmation`,
      long
        ? `等待当前周期已收盘 K 线有效站上 ${trigger.price}，并确认回踩不重新跌破`
        : `等待当前周期已收盘 K 线有效跌破 ${trigger.price}，并确认反抽无法重新站回`,
      evidenceIds,
    )],
  };
}

function riskReward(entry, stop, target) {
  if (!entry || !stop || !target) return null;
  const risk = Math.abs(entry.price - stop.price);
  const reward = Math.abs(target.price - entry.price);
  return risk > Number.EPSILON ? Number((reward / risk).toFixed(2)) : null;
}

function planHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export function buildExecutionPlanV1(manifest, legacyResult, params = {}) {
  const snapshot = legacyResult?.snapshot || {};
  const analysisPlan = legacyResult?.analysisPlan || {};
  const theoryResult = legacyResult?.theoryResult || {};
  const actionPlan = analysisPlan.actionPlan || {};
  const actionLevelEvidence = [
    ["long-trigger", actionPlan.longTrigger, "确定性结果给出的多头触发价"],
    ["long-invalidation", actionPlan.longInvalidation, "确定性结果给出的多头失效价"],
    ["long-target", actionPlan.longTarget, "确定性结果给出的多头目标价"],
    ["short-trigger", actionPlan.shortTrigger, "确定性结果给出的空头触发价"],
    ["short-invalidation", actionPlan.shortInvalidation, "确定性结果给出的空头失效价"],
    ["short-target", actionPlan.shortTarget, "确定性结果给出的空头目标价"],
  ].flatMap(([id, value, summary]) => finite(value) ? [{ id: `${manifest.id}-${id}`, summary }] : []);
  const evidence = [...actionLevelEvidence, ...evidenceFromResult(legacyResult)];
  const evidenceIds = evidence.slice(0, 16).map((item) => item.id);
  const tickSize = finite(params.tickSize);
  const preferredSide = inferredPreferredSide(actionPlan, theoryResult);
  const longScenario = scenario("long", actionPlan, preferredSide === "long" ? "preferred" : "conditional", evidenceIds, tickSize);
  const shortScenario = scenario("short", actionPlan, preferredSide === "short" ? "preferred" : "conditional", evidenceIds, tickSize);
  const scenarios = [longScenario, shortScenario].filter(Boolean);
  const preferredScenario = preferredSide === "long"
    ? longScenario
    : preferredSide === "short"
      ? shortScenario
      : null;
  const waitZone = actionPlan?.waitZone;
  const entryZone = waitZone && finite(waitZone.lower) && finite(waitZone.upper)
    ? { lower: roundedPrice(Math.min(waitZone.lower, waitZone.upper), tickSize), upper: roundedPrice(Math.max(waitZone.lower, waitZone.upper), tickSize) }
    : null;
  const now = Date.now();
  const intervalMs = intervalMilliseconds(snapshot.interval);
  const requestedValidityBars = Number(actionPlan.validityBars);
  const validityBars = Number.isInteger(requestedValidityBars) && requestedValidityBars >= 1 && requestedValidityBars <= 64
    ? requestedValidityBars
    : 3;
  const observeTrigger = String(actionPlan.observeTrigger || "").trim().slice(0, 500)
    || "观察多空触发价附近的收盘确认、回踩/反抽和成交量变化";
  const hasScenarios = scenarios.length > 0;
  const observationWait = !hasScenarios && actionPlan?.disposition === "wait";
  const coverage = theoryResult?.coverage || snapshot?.orderFlowCoverage || {};
  const source = {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    planId: "pending",
    analysisId: String(analysisPlan.analysisId || `analysis-${crypto.randomUUID()}`),
    strategy: { id: manifest.id, version: manifest.version },
    market: {
      marketId: String(snapshot.marketId || params.marketId || "UNKNOWN:UNKNOWN"),
      symbol: marketSymbol(snapshot.marketId || params.marketId),
      interval: String(snapshot.interval || params.interval || "1D"),
    },
    snapshot: {
      id: String(snapshot.snapshotId || `snapshot-${crypto.randomUUID()}`),
      inputHash: String(snapshot.inputHash || "unknown-input-hash"),
      lastClosedBarTime: Math.max(1, Number(params.lastClosedBarTime || snapshot.snapshotTime || now)),
    },
    createdAt: now,
    expiresAt: now + intervalMs * validityBars,
    action: hasScenarios || observationWait ? "wait" : "insufficient_data",
    preferredSide,
    marketAssessment: hasScenarios
      ? preferredSide === "long"
        ? "当前结构偏多，但尚需等待多头触发条件由已收盘 K 线确认。"
        : preferredSide === "short"
          ? "当前结构偏空，但尚需等待空头触发条件由已收盘 K 线确认。"
          : "当前方向未形成单边优势，按上下触发条件执行，区间内保持等待。"
      : observationWait
        ? "当前存在需要继续观察的结构，但尚未形成完整入场、失效和目标价位；保持等待，不交易。"
        : "当前结果缺少完整入场、失效或目标价位，暂不形成交易执行方案。",
    preconditions: [
      condition("closed-candle", "只使用当前周期已收盘 K 线确认，不把盘中瞬时刺破视为有效触发", evidenceIds),
      condition("data-coverage", "策略所需行情和数据覆盖必须保持可用，数据降级时取消执行", evidenceIds),
    ],
    entry: {
      mode: hasScenarios ? "conditional" : "none",
      zone: entryZone,
      trigger: scenarios.map((item) => item.conditions[0]),
      confirmation: [condition(
        "confirmation",
        String(actionPlan.confirmation || "等待当前周期收盘确认，并观察突破后的回踩或反抽是否守住"),
        evidenceIds,
      )],
    },
    invalidation: {
      stop: preferredScenario?.stop || null,
      reasons: preferredScenario
        ? ["价格触及策略确定性失效位，主场景不再成立"]
        : ["方向触发前不持仓；任一假突破重新回到等待区都取消当次信号"],
    },
    takeProfits: preferredScenario
      ? preferredScenario.targets.map((target, index, targets) => ({
        price: target,
        allocationPercent: index === targets.length - 1
          ? 100 - Math.floor(100 / targets.length) * (targets.length - 1)
          : Math.floor(100 / targets.length),
        condition: index === 0
          ? "到达第一目标后按计划分批退出，并把剩余仓位风险降至可承受范围"
          : "仅在结构仍有效时持有至后续目标；不得把目标当作必达价格",
      }))
      : [],
    positionSizing: {
      maxAccountRiskPercent: 1,
      formula: "建议数量 = 可承受亏损金额 ÷ |计划入场价 - 止损价|；永续合约还需按合约乘数和最小数量归一化",
      suggestedQuantity: null,
      unavailableReason: "本分析链路未获得经授权的新鲜账户权益、合约乘数和最小下单数量，因此不生成具体数量",
    },
    riskReward: preferredScenario
      ? preferredScenario.targets.map((target, targetIndex) => ({
        targetIndex,
        ratio: riskReward(preferredScenario.trigger, preferredScenario.stop, target) || 0,
      }))
      : [],
    observe: [
      condition(
        "observe-trigger",
        observeTrigger,
        evidenceIds,
      ),
      condition("observe-structure", "观察主结构是否保持确认状态，暂定结构失效时重新分析", evidenceIds),
    ],
    cancelConditions: [
      condition("false-breakout", "触发后很快重新收回等待区，按假突破取消执行", evidenceIds),
      condition("expired", "超过方案有效期仍未触发，必须使用最新行情重新分析", evidenceIds),
      condition("coverage-loss", "策略所需数据变为 partial/unavailable 且不满足最低覆盖要求", evidenceIds),
    ],
    scenarios,
    evidence,
    coverage,
    warnings: [
      "本方案是条件式分析计划，不是自动订单或收益承诺。",
      tickSize
        ? `所有执行价已按宿主提供的 tick size ${tickSize} 归一化；执行前仍须核对交易所最新合约规格。`
        : "未提供交易所 tick size 时价格只做有限小数归一化，下单前必须按真实合约规格复核。",
      "永续合约存在杠杆、滑点、资金费率和强平风险。",
    ],
  };
  source.planId = `plan-${planHash({ ...source, planId: undefined, createdAt: undefined })}`;
  return validateExecutionPlan(source);
}

function displayPrice(level) {
  return level ? String(level.price) : "未形成";
}

function displayTime(value) {
  if (!Number.isFinite(Number(value))) return "需重新分析后确定";
  return new Date(Number(value)).toLocaleString("zh-CN", { hour12: false });
}

function displayTargets(scenario) {
  if (!scenario?.targets?.length) return "未形成";
  return scenario.targets.map((target, index) => `T${index + 1} ${displayPrice(target)}`).join("；");
}

export function formatExecutionPlanMarkdown(plan) {
  const validated = validateExecutionPlan(plan);
  const longScenario = validated.scenarios.find((item) => item.side === "long");
  const shortScenario = validated.scenarios.find((item) => item.side === "short");
  const riskRewardText = validated.riskReward.length
    ? validated.riskReward.map((item) => `目标 ${item.targetIndex + 1} 为 1:${item.ratio}`).join("；")
    : "方向触发前不计算；触发后按入场、止损和目标重新核对";
  return [
    "## 标准执行方案",
    "",
    `- **前置条件**：${validated.preconditions.map((item) => item.text).join("；")}`,
    `- **当前动作**：${validated.action === "wait" ? "等待条件触发" : validated.action === "insufficient_data" ? "数据/价位不足，不交易" : validated.action}`,
    `- **方向判断**：${validated.preferredSide === "long" ? "偏多" : validated.preferredSide === "short" ? "偏空" : "中性，等待上下边界选择方向"}`,
    `- **多头触发**：${longScenario ? `${displayPrice(longScenario.trigger)}，${longScenario.conditions[0]?.text || "等待确认"}` : "未形成"}`,
    `- **空头触发**：${shortScenario ? `${displayPrice(shortScenario.trigger)}，${shortScenario.conditions[0]?.text || "等待确认"}` : "未形成"}`,
    `- **确认方式**：${validated.entry.confirmation.map((item) => item.text).join("；")}`,
    `- **止损与失效**：${validated.preferredSide === "long" ? displayPrice(longScenario?.stop) : validated.preferredSide === "short" ? displayPrice(shortScenario?.stop) : "方向触发后使用对应场景失效位"}；${validated.invalidation.reasons.join("；")}`,
    `- **分批止盈**：${validated.preferredSide === "long" ? displayTargets(longScenario) : validated.preferredSide === "short" ? displayTargets(shortScenario) : "方向触发后使用对应场景目标；到达后按计划分批退出"}`,
    `- **仓位与最大风险**：单笔预设亏损不超过账户权益约 ${validated.positionSizing.maxAccountRiskPercent ?? "未设定"}%；${validated.positionSizing.formula}`,
    `- **风险收益比**：${riskRewardText}`,
    `- **继续观察**：${validated.observe.map((item) => item.text).join("；")}`,
    `- **方案有效期**：${displayTime(validated.expiresAt)}`,
    `- **取消执行**：${validated.cancelConditions.map((item) => item.text).join("；")}`,
    "",
    `> ${validated.warnings.join(" ")}`,
  ].join("\n");
}
