import { createAlertRuleRevision, normalizeAlertRule } from "./protocol.mjs";
import { TradingAlertError } from "./errors.mjs";

const PLAN_TITLE_PATTERN = /^([A-Z0-9]{2,20})\/(USDT|USDC|BUSD)\s+币安永续\s+(\d+)(M|H|D|W)$/i;
const PLAN_STATUSES = new Set(["pending", "executing", "ended"]);
const PLAN_ALERT_RULE_PREFIX = "execution-plan-alert-";

function invalid(message) {
  throw new TradingAlertError(message, {
    code: "TRADING_ALERT_EXECUTION_PLAN_INVALID",
    category: "validation",
  });
}

function boundedIdentifier(value, field) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(normalized)) invalid(`${field} 无效`);
  return normalized;
}

function cleanPlanText(value) {
  let text = String(value || "");
  for (let depth = 0; depth < 6; depth += 1) {
    const next = text.replace(/（[^（）]*）|\([^()]*\)/g, "");
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/[（）()]/g, "")
    .replace(/候选/g, "")
    .replace(/测算/g, "推荐")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function planFields(content) {
  const fields = new Map();
  for (const rawLine of String(content || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = cleanPlanText(rawLine
      .replace(/^\s*(?:>\s*)?(?:#{1,6}\s*)?/, "")
      .replace(/^\s*(?:[-*+•▪◦]\s+|(?:\d+|[A-C一二三四五六])[.)、]\s*)/i, "")
      .replace(/[*_`~]/g, ""));
    const match = line.match(/^(.{1,32}?)[：:]\s*(.*)$/u);
    if (match) fields.set(match[1].trim(), match[2].trim());
  }
  return fields;
}

function positivePrice(value, kind) {
  const source = String(value || "").replace(/,/g, "");
  const targetMatch = kind === "takeProfit"
    ? source.match(/第\s*\d+\s*目标\s*([0-9]+(?:\.[0-9]+)?)/u)
    : null;
  const match = targetMatch || source.match(/(?:^|[^0-9.])([0-9]+(?:\.[0-9]+)?)/u);
  const price = Number(match?.[1]);
  if (!Number.isFinite(price) || price <= 0) invalid(`无法识别${kind === "entry" ? "触发" : kind === "stopLoss" ? "止损" : "止盈"}价格`);
  return price;
}

function displayPrice(value) {
  return Number(value).toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 12 });
}

function condition(conditionId, operator, price) {
  return {
    type: "condition",
    condition: {
      conditionId,
      contextId: "plan-market",
      operator,
      left: { type: "field", field: "close" },
      right: { type: "constant", value: price },
      confirmation: "intrabar",
    },
  };
}

export function parseExecutionPlanAlertInput(value = {}) {
  const planId = boundedIdentifier(value.planId, "计划标识");
  const status = String(value.status || "").trim();
  if (!PLAN_STATUSES.has(status)) invalid("计划状态无效");
  const title = cleanPlanText(value.title).slice(0, 200);
  const titleMatch = title.match(PLAN_TITLE_PATTERN);
  if (!titleMatch) invalid("计划标题缺少可监控的交易对、永续合约或周期");
  const [, baseAssetValue, quoteAssetValue, intervalValue, intervalUnitValue] = titleMatch;
  const baseAsset = baseAssetValue.toUpperCase();
  const quoteAsset = quoteAssetValue.toUpperCase();
  const interval = `${Number(intervalValue)}${intervalUnitValue.toLowerCase()}`;
  const fields = planFields(value.content);
  const directionText = fields.get("方向判断") || "";
  const triggerEntry = [...fields.entries()].find(([label]) => /(?:多头|空头|方向)?触发/.test(label));
  const direction = directionText.includes("空") || triggerEntry?.[0].includes("空")
    ? "short"
    : directionText.includes("多") || triggerEntry?.[0].includes("多")
      ? "long"
      : "";
  if (!direction) invalid("计划缺少明确的多空方向");
  const entry = positivePrice(triggerEntry?.[1], "entry");
  const stopLoss = positivePrice(fields.get("止损与失效") || fields.get("止损"), "stopLoss");
  const takeProfit = positivePrice(fields.get("分批止盈") || fields.get("止盈"), "takeProfit");
  if (direction === "short" && !(stopLoss > entry && entry > takeProfit)) {
    invalid("空头计划必须满足止损价高于触发价、触发价高于止盈价");
  }
  if (direction === "long" && !(stopLoss < entry && entry < takeProfit)) {
    invalid("多头计划必须满足止损价低于触发价、触发价低于止盈价");
  }
  const originThreadId = value.originThreadId
    ? boundedIdentifier(value.originThreadId, "来源任务标识")
    : undefined;
  const alertId = value.alertId ? boundedIdentifier(value.alertId, "预警标识") : undefined;
  return Object.freeze({
    planId,
    status,
    title,
    baseAsset,
    quoteAsset,
    marketId: `BINANCE:FUTURES:${baseAsset}${quoteAsset}`,
    interval,
    direction,
    entry,
    stopLoss,
    takeProfit,
    ...(originThreadId ? { originThreadId } : {}),
    ...(alertId ? { alertId } : {}),
  });
}

export function executionPlanAlertIds(planId) {
  const id = boundedIdentifier(planId, "计划标识");
  return Object.freeze({
    alertId: `alert-${id}`.slice(0, 160),
    draftId: `draft-${id}`.slice(0, 160),
    simulationId: `simulation-${id}`.slice(0, 160),
    confirmationId: `confirmation-${id}`.slice(0, 160),
    ruleId: `${PLAN_ALERT_RULE_PREFIX}${id}`.slice(0, 160),
  });
}

export function executionPlanAlertSummaryLines(spec) {
  const directionLabel = spec.direction === "short" ? "开空" : "开多";
  return Object.freeze([
    `待执行｜${spec.baseAsset} 价格达到 ${displayPrice(spec.entry)} 时触发${directionLabel}预警`,
    `执行中｜${spec.baseAsset} 价格达到 ${displayPrice(spec.stopLoss)} 时触发止损预警`,
    `执行中｜${spec.baseAsset} 价格达到 ${displayPrice(spec.takeProfit)} 时触发止盈预警`,
  ]);
}

export function buildExecutionPlanAlertRule(specValue, { previousRule = null, now = Date.now() } = {}) {
  const spec = specValue?.marketId ? specValue : parseExecutionPlanAlertInput(specValue);
  const ids = executionPlanAlertIds(spec.planId);
  const entryOperator = spec.direction === "short" ? "lte" : "gte";
  const stopOperator = spec.direction === "short" ? "gte" : "lte";
  const takeProfitOperator = spec.direction === "short" ? "lte" : "gte";
  const entryCondition = condition("execution-plan-entry", entryOperator, spec.entry);
  const stopCondition = condition("execution-plan-stop-loss", stopOperator, spec.stopLoss);
  const takeProfitCondition = condition("execution-plan-take-profit", takeProfitOperator, spec.takeProfit);
  const root = spec.status === "pending"
    ? entryCondition
    : { type: "any", children: [stopCondition, takeProfitCondition] };
  const summary = executionPlanAlertSummaryLines(spec).join("\n");
  const payload = {
    schemaVersion: 1,
    ruleId: ids.ruleId,
    revision: 1,
    title: `${spec.title} 预警`,
    root,
    contexts: [{
      contextId: "plan-market",
      marketSelector: { kind: "fixed", marketIds: [spec.marketId] },
      intervals: [spec.interval],
    }],
    evaluationPolicy: {
      clock: "bar_update",
      anchorContextId: "plan-market",
      joinMode: "latest_closed",
      maxDataAgeMs: 30_000,
      unknownPolicy: "do_not_trigger",
    },
    triggerPolicy: {
      mode: "once",
      edge: "false_to_true",
      rearm: "must_become_false",
      maxTriggersTotal: 1,
      resumePolicy: "baseline_only_no_catch_up",
    },
    dataRequirements: [],
    sourceText: `执行计划 ${spec.planId}\n${summary}`,
    normalizedSummary: summary,
    createdAt: Number(now),
  };
  return previousRule
    ? createAlertRuleRevision(previousRule, { ...payload, ruleHash: undefined })
    : normalizeAlertRule(payload);
}

export function isExecutionPlanAlertRule(rule) {
  return String(rule?.ruleId || "").startsWith(PLAN_ALERT_RULE_PREFIX);
}

export function executionPlanAlertTriggeredSummary(rule, evidence) {
  if (!isExecutionPlanAlertRule(rule)) return String(rule?.normalizedSummary || "监控条件已满足");
  const conditionId = (evidence?.conditionResults || []).find((entry) => entry?.result === true)?.conditionId;
  const index = conditionId === "execution-plan-entry"
    ? 0
    : conditionId === "execution-plan-stop-loss"
      ? 1
      : conditionId === "execution-plan-take-profit"
        ? 2
        : -1;
  const lines = String(rule?.normalizedSummary || "").split("\n").filter(Boolean);
  return index >= 0 ? lines[index]?.replace(/^[^｜]+｜/, "") || lines.join("；") : lines.join("；");
}
