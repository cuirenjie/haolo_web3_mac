import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { evaluateDeclarativeStrategyRules, validateDeclarativeStrategyRules } from "./declarative-rules.mjs";

function safeRulesPath(packageRoot, rulesAsset) {
  const root = path.resolve(packageRoot || "");
  const target = path.resolve(root, rulesAsset);
  if (!root || target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new TypeError("Declarative strategy rules asset escapes its package");
  }
  return target;
}

function loadRules(packageRoot, rulesAsset) {
  const target = safeRulesPath(packageRoot, rulesAsset);
  const text = fs.readFileSync(target, "utf8");
  if (Buffer.byteLength(text, "utf8") > 128 * 1024) throw new TypeError("Declarative strategy rules are too large");
  return validateDeclarativeStrategyRules(JSON.parse(text));
}

function stripMention(text, manifest) {
  let source = String(text || "");
  for (const name of [manifest.mentions.canonical, ...manifest.mentions.aliases]) {
    source = source.split(`@策略:${name}`).join("").split(`@策略：${name}`).join("");
  }
  return source.trim();
}

function deterministicRequest(text, context, manifest) {
  const instruction = stripMention(text, manifest);
  const conversation = context?.hasImageAttachment === true
    || /(?:什么是|解释|介绍|原理|怎么理解|为什么|教程|含义)/.test(instruction);
  const chartIntent = /(?:分析|看盘|画|绘|标注|走势|行情|执行方案|交易计划)/.test(instruction);
  return Object.freeze({
    mode: !conversation && chartIntent ? "chart-analysis" : "conversation",
    instruction,
    symbol: null,
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: !conversation && /(?:分析|看盘|画|绘|标注|走势|行情)/.test(instruction),
  });
}

function rounded(value) {
  return Number(Number(value).toPrecision(12));
}

function drawingOperation({ strategyId, marketId, interval, id, role, tool, points, text, evidenceIds }) {
  return Object.freeze({
    op: "upsert",
    drawing: Object.freeze({
      id: `${strategyId}-${id}`.slice(0, 160),
      strategyId,
      symbol: marketId,
      interval,
      theory: "strategy",
      layer: `ai/strategy/${strategyId}`,
      tool,
      points: Object.freeze(points.map((point) => Object.freeze({ time: point.time, price: rounded(point.price) }))),
      ...(text ? { text: String(text).slice(0, 120) } : {}),
      colorToken: `strategy-${role}`,
      locked: true,
      status: "confirmed",
      evidenceIds: Object.freeze(evidenceIds),
    }),
  });
}

function drawingPatch(manifest, rules, evaluation, marketId, interval, analysisId) {
  if (!rules.drawing.enabled || evaluation.status !== "completed") return null;
  const roles = new Set(rules.drawing.roles.length ? rules.drawing.roles : ["primary", "entry", "stop", "target", "note"]);
  const last = evaluation.lastCandle;
  const nextTime = Number(last.time) + 1;
  const side = evaluation.signals.find((signal) => signal.side === "long")?.side
    || evaluation.signals.find((signal) => signal.side === "short")?.side
    || "neutral";
  const evidenceIds = evaluation.signals.map((signal) => signal.id);
  const levels = evaluation.levels;
  const operations = [];
  if (roles.has("primary")) {
    operations.push(drawingOperation({
      strategyId: manifest.id,
      marketId,
      interval,
      id: "primary",
      role: "primary",
      tool: "path",
      points: [{ time: last.time, price: last.close }, { time: nextTime, price: last.close }],
      evidenceIds,
    }));
  }
  const levelRoles = side === "short"
    ? [["entry", levels.shortTrigger], ["stop", levels.shortInvalidation], ["target", levels.shortTarget]]
    : [["entry", levels.longTrigger], ["stop", levels.longInvalidation], ["target", levels.longTarget]];
  for (const [role, price] of levelRoles) {
    if (!roles.has(role)) continue;
    operations.push(drawingOperation({
      strategyId: manifest.id,
      marketId,
      interval,
      id: role,
      role,
      tool: "path",
      points: [{ time: last.time, price }, { time: nextTime, price }],
      evidenceIds,
    }));
  }
  if (roles.has("note")) {
    operations.push(drawingOperation({
      strategyId: manifest.id,
      marketId,
      interval,
      id: "note",
      role: "note",
      tool: "note",
      points: [{ time: last.time, price: last.close }],
      text: `${manifest.display.name}：${side === "long" ? "偏多条件成立" : side === "short" ? "偏空条件成立" : "等待条件"}`,
      evidenceIds,
    }));
  }
  return operations.length ? Object.freeze({
    schemaVersion: 1,
    analysisId,
    baseRevision: 0,
    marketId,
    interval,
    operations: Object.freeze(operations.slice(0, 64)),
  }) : null;
}

function inputHash(params) {
  return crypto.createHash("sha256").update(JSON.stringify({
    marketId: params.marketId,
    interval: params.interval,
    candles: params.candles,
  })).digest("hex");
}

function declarativeReport(manifest, evaluation) {
  if (evaluation.status !== "completed") {
    return `## ${manifest.display.name}分析\n\n当前只有 ${evaluation.candleCount} 根已收盘 K 线，策略至少需要 ${evaluation.requiredCandles} 根；数据不足，本次不生成交易方向和价位。`;
  }
  const activeSignals = evaluation.signals.length
    ? evaluation.signals.map((signal) => `${signal.label}（${signal.side === "long" ? "偏多" : "偏空"}）`).join("；")
    : "没有条件同时成立，保持等待";
  return [
    `## ${manifest.display.name}分析`,
    "",
    `- 条件结果：${activeSignals}`,
    `- 多头触发/失效/目标：${rounded(evaluation.levels.longTrigger)} / ${rounded(evaluation.levels.longInvalidation)} / ${rounded(evaluation.levels.longTarget)}`,
    `- 空头触发/失效/目标：${rounded(evaluation.levels.shortTrigger)} / ${rounded(evaluation.levels.shortInvalidation)} / ${rounded(evaluation.levels.shortTarget)}`,
    "- 所有条件只使用当前及历史已收盘 K 线；未读取未来数据、账户资金或下单权限。",
  ].join("\n");
}

export function createDeclarativeStrategyAdapter({ manifest, packageRoot, rules: rulesValue = null }) {
  if (manifest?.implementation?.kind !== "declarative-v1") {
    throw new TypeError("Declarative adapter requires a declarative-v1 manifest");
  }
  const rules = rulesValue
    ? validateDeclarativeStrategyRules(rulesValue)
    : loadRules(packageRoot, manifest.implementation.rulesAsset);
  return Object.freeze({
    id: manifest.id,
    kind: "declarative-v1",
    rules,
    routing: Object.freeze({
      task: "declarative-strategy-request-routing",
      theoryId: manifest.id,
      deterministic: (text, context) => deterministicRequest(text, context, manifest),
      buildPrompt: () => "",
      normalizeResponse: () => ({ request: null, classification: null }),
    }),
    errors: Object.freeze({
      routingCode: "TRADING_DECLARATIVE_STRATEGY_ROUTING_FAILED",
      routingFailureMessage: `${manifest.display.name}请求识别失败`,
      routingCancelledMessage: `${manifest.display.name}请求识别已取消`,
      analysisCode: "TRADING_DECLARATIVE_STRATEGY_ANALYSIS_FAILED",
      analysisFailureMessage: `${manifest.display.name}分析失败`,
      analysisCancelledMessage: `${manifest.display.name}分析已取消`,
      replacementMessage: "A newer strategy analysis replaced this request",
      routingReplacementMessage: "A newer strategy request classification replaced this request",
    }),
    async run(params = {}) {
      const analysisId = String(params.analysisJobId || `${manifest.id}-${crypto.randomUUID()}`).slice(0, 160);
      const marketId = String(params.marketId || "UNKNOWN:UNKNOWN").slice(0, 120);
      const interval = String(params.interval || "1D").slice(0, 24);
      const candles = Array.isArray(params.candles) ? params.candles : [];
      const evaluation = evaluateDeclarativeStrategyRules(rules, candles);
      const hash = inputHash({ marketId, interval, candles });
      const snapshotTime = Math.max(1, Number(params.snapshotTime || Date.now()));
      const report = declarativeReport(manifest, evaluation);
      const patch = drawingPatch(manifest, rules, evaluation, marketId, interval, analysisId);
      const levels = evaluation.status === "completed" ? evaluation.levels : {};
      const primarySignal = evaluation.signals?.[0] || null;
      return Object.freeze({
        ok: true,
        snapshot: Object.freeze({
          snapshotId: `${manifest.id}-${hash.slice(0, 24)}`,
          inputHash: hash,
          marketId,
          interval,
          snapshotTime,
        }),
        theoryResult: Object.freeze({
          status: evaluation.status,
          signals: evaluation.signals || Object.freeze([]),
          evidence: Object.freeze((evaluation.signals || []).map((signal) => Object.freeze({ id: signal.id, summary: signal.label }))),
          coverage: Object.freeze({ candles: evaluation.status === "completed" ? "available" : "partial" }),
          direction: primarySignal?.side || "neutral",
        }),
        analysisPlan: Object.freeze({
          analysisId,
          narrative: report,
          report,
          drawingPatch: patch,
          actionPlan: Object.freeze({
            primaryBias: primarySignal?.side || "neutral",
            longTrigger: levels.longTrigger,
            longInvalidation: levels.longInvalidation,
            longTarget: levels.longTarget,
            shortTrigger: levels.shortTrigger,
            shortInvalidation: levels.shortInvalidation,
            shortTarget: levels.shortTarget,
            confirmation: "等待当前周期已收盘 K 线确认策略条件，突破后再观察回踩或反抽",
          }),
        }),
        model: Object.freeze({ providerId: "deterministic-dsl", modelId: "declarative-v1", latencyMs: 0 }),
      });
    },
  });
}
