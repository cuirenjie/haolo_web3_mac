import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeStrategyUnderstanding } from "./understanding.mjs";

const STORE_VERSION = 1;
const STRATEGY_SCHEMA_VERSION = 1;
const MAX_TEXT = 12_000;
const MAX_STRATEGIES = 128;
const MAX_VERSIONS = 32;
const PERSONAL_ID_PATTERN = /^personal-[a-z][a-z0-9-]{1,63}$/;

export class PersonalStrategyError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "PersonalStrategyError";
    this.code = code;
    this.details = details;
  }
}

function record(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function cleanText(value, max = MAX_TEXT) { return String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max); }
function nowIso(now) { const value = typeof now === "function" ? now() : now; const date = value instanceof Date ? value : new Date(value || Date.now()); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); }
function ownerHash(ownerId) { const value = cleanText(ownerId, 2_048); if (!value) throw new PersonalStrategyError("STRATEGY_OWNER_REQUIRED", "个人策略需要有效的账号身份。"); return crypto.createHash("sha256").update(value).digest("hex"); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function slug(value) { const normalized = cleanText(value, 80).normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase(); return normalized.slice(0, 40) || "strategy"; }
function explicitName(source) {
  const match = source.match(/(?:策略(?:名称|名|叫|叫做|名为)|(?:我)?(?:把它)?叫)\s*(?:[:：]\s*)?[“"「『]?([^”"」』，。:：；;！!?\n]{2,40})/u);
  return cleanText(match?.[1] || "", 40)
    .replace(/\s+(?:只做多|仅做多|只做空|仅做空|看多|看空|做多|做空|多头|空头).*$/iu, "")
    .replace(/[。！？!?,，；;]+$/u, "")
    .trim();
}
function generatedName(source) { const first = cleanText(source.split(/[\n。！？!?；;]/u)[0], 40).replace(/^@创建策略[：:\s]*/u, "").replace(/^(请|帮我|我想|我要|建立|创建)\s*/u, ""); return first || "我的交易策略"; }
function storedUnderstanding(value) {
  if (!record(value)) return null;
  const normalized = normalizeStrategyUnderstanding(value);
  if (!normalized.summary && !normalized.compilerText && !normalized.entryRules.length && !normalized.exitRules.length) return null;
  return {
    schemaVersion: normalized.schemaVersion,
    name: normalized.name,
    summary: normalized.summary,
    direction: normalized.direction,
    timeframes: normalized.timeframes,
    marketScope: normalized.marketScope,
    entryRules: normalized.entryRules,
    exitRules: normalized.exitRules,
    risk: normalized.risk,
    exceptions: normalized.exceptions,
    evidence: normalized.evidence,
    uncertainties: normalized.uncertainties,
    questions: normalized.questions,
    confidence: normalized.confidence,
    compilerText: normalized.compilerText,
  };
}
function numberAfter(pattern, source) { const value = Number(source.match(pattern)?.[1]); return Number.isFinite(value) ? value : null; }
function indicatorPeriod(source, aliases) { const value = numberAfter(new RegExp(`(?:${aliases.join("|")})\\s*(?:周期|长度|均线)?\\s*(\\d{1,4})`, "iu"), source); return value && value >= 2 && value <= 500 ? Math.trunc(value) : null; }

function compileConditions(source) {
  const rules = [], questions = [], warnings = [], normalized = source.replace(/[，、；]/gu, ",");
  const correctionMarker = Math.max(normalized.lastIndexOf("用户修订"), normalized.lastIndexOf("用户更正"), normalized.lastIndexOf("用户反馈"));
  const correction = correctionMarker >= 0 ? normalized.slice(correctionMarker + 4).trim() : "";
  const smaPeriod = indicatorPeriod(normalized, ["SMA", "MA", "简单移动平均", "均线"]);
  const emaPeriod = indicatorPeriod(normalized, ["EMA", "指数移动平均"]);
  const period = smaPeriod || emaPeriod, indicator = emaPeriod ? "ema" : "sma";
  const negatedUp = /(?:不是|不要|不再|改为|改成|而不是)[^。！？!?,，；;]*上穿/iu.test(normalized);
  const negatedDown = /(?:不是|不要|不再|改为|改成|而不是)[^。！？!?,，；;]*下穿/iu.test(normalized);
  const correctionSaysUp = correction && /(?:上穿|突破|向上穿越|金叉|站上)/iu.test(correction) && /(?:应该|改为|改成|调整为|而是|不是|只在|改回)/iu.test(correction);
  const correctionSaysDown = correction && /(?:下穿|跌破|向下穿越|死叉|跌至)/iu.test(correction) && /(?:应该|改为|改成|调整为|而是|不是|只在|改回)/iu.test(correction);
  const exitClauseUp = /(?:上穿|突破|向上穿越|金叉)[^。！？!?,，；;]*(?:止损|停损|退出|离场)|(?:止损|停损|退出|离场)[^。！？!?,，；;]*(?:上穿|突破|向上穿越|金叉)/iu.test(normalized);
  const stopClauseDown = /(?:止损|停损|退出|离场)[^。！？!?,，；;]*(?:下穿|跌破)|(?:下穿|跌破)[^。！？!?,，；;]*(?:止损|停损|退出|离场)/iu.test(normalized);
  const hasCrossUp = !negatedUp && !exitClauseUp && !correctionSaysDown && /(上穿|突破|向上穿越|收盘价.*高于|站上|金叉)/iu.test(normalized);
  const hasCrossDown = !negatedDown && !stopClauseDown && !correctionSaysUp && /(下穿|跌破|向下穿越|收盘价.*低于|死叉)/iu.test(normalized);
  const hasBreakHigh = /(突破|创出新高|高于最近|站上).*(前高|最高|阻力|高点)/iu.test(normalized);
  const hasBreakLow = /(跌破|创出新低|低于最近).*(前低|最低|支撑|低点)/iu.test(normalized);
  if (period && hasCrossUp) rules.push({ type: "cross_above", indicator, period, label: `${indicator.toUpperCase()}${period}上穿确认` });
  if (period && hasCrossDown) rules.push({ type: "cross_below", indicator, period, label: `${indicator.toUpperCase()}${period}下穿确认` });
  if (period && !hasCrossUp && !hasCrossDown && /(均线|SMA|EMA|移动平均)/iu.test(normalized)) rules.push({ type: /(低于|下方|之下|跌破)/iu.test(normalized) ? "price_below" : "price_above", indicator, period, label: `${indicator.toUpperCase()}${period}位置过滤` });
  if (hasBreakHigh && !rules.some((rule) => rule.type === "cross_above")) rules.push({ type: "breakout_high", lookback: 20, label: "突破前高" });
  if (hasBreakLow && !rules.some((rule) => rule.type === "cross_below")) rules.push({ type: "breakdown_low", lookback: 20, label: "跌破前低" });
  if (/(放量|成交量.*增加|量能确认)/iu.test(normalized)) rules.push({ type: "volume_expansion", lookback: 20, multiplier: 1.2, label: "成交量放大确认" });
  const rsiPeriod = indicatorPeriod(normalized, ["RSI", "相对强弱指标"]);
  const rsiOversold = numberAfter(/RSI\s*(?:低于|小于|<)\s*(\d{1,3})/iu, normalized) || numberAfter(/超卖\s*(\d{1,3})/iu, normalized);
  const rsiOverbought = numberAfter(/RSI\s*(?:高于|大于|>)\s*(\d{1,3})/iu, normalized) || numberAfter(/超买\s*(\d{1,3})/iu, normalized);
  if (rsiPeriod && rsiOversold) rules.push({ type: "rsi_below", period: rsiPeriod, value: Math.min(50, rsiOversold), label: `RSI${rsiPeriod}低于${rsiOversold}` });
  if (rsiPeriod && rsiOverbought) rules.push({ type: "rsi_above", period: rsiPeriod, value: Math.max(50, rsiOverbought), label: `RSI${rsiPeriod}高于${rsiOverbought}` });
  if (!rules.length) { questions.push("请补充可验证的触发条件（例如：收盘价上穿 EMA20、突破前高并放量）。"); warnings.push("目前只识别到描述性目标，尚未形成可计算触发条件。"); }
  const directionSource = correction && /(?:只做多|仅做多|只做空|仅做空|做多|做空|买入|卖出|多头|空头|看多|看空|long|short)/iu.test(correction) ? correction : normalized;
  const longNegated = /(?:不做多|不要做多|不是做多|禁止做多)/iu.test(directionSource);
  const shortNegated = /(?:不做空|不要做空|不是做空|禁止做空)/iu.test(directionSource);
  const direction = !longNegated && /(只做多|仅做多|只做多头|看多|做多|买入|多头|long)/iu.test(directionSource) ? "long" : !shortNegated && /(只做空|仅做空|只做空头|看空|做空|卖出|空头|short)/iu.test(directionSource) ? "short" : "both";
  const explicitBoth = /(?:多空均可|多空都可以|多空都做|双向交易|双向都可以|both|long\s*\/\s*short)/iu.test(directionSource);
  if (direction === "both" && !explicitBoth) questions.push("请确认方向：只做多、只做空，还是多空都可以？");
  const hasException = /(除非|否则|不要|不做|禁止|避免|仅当|只有|必须|例外)/iu.test(normalized);
  if (hasException) warnings.push("已保留否定/例外语义；首次使用前请在预演中核对它的解释。");
  const stopLoss = numberAfter(/(?:止损|停损|风险位)(?:设在|放在|为|固定在)?\s*(?:价格)?\s*([0-9]+(?:\.[0-9]+)?)/iu, normalized);
  const takeProfit = numberAfter(/(?:止盈|目标位|目标价)(?:设在|放在|为|固定在)?\s*(?:价格)?\s*([0-9]+(?:\.[0-9]+)?)/iu, normalized);
  const riskReward = numberAfter(/(?:盈亏比|风险回报比|R\s*R)(?:为|是|:|：)?\s*(\d+(?:\.\d+)?)/iu, normalized);
  const risk = { stopLoss, takeProfit, riskReward: riskReward && riskReward > 0 ? riskReward : null };
  if (!stopLoss && !takeProfit && !risk.riskReward) warnings.push("没有识别到固定止损/止盈；执行前仍需按账户硬风控计算仓位。");
  return { rules, direction, risk, questions, warnings, hasException };
}

export function compilePersonalStrategy(input, { name = "" } = {}) {
  const source = cleanText(input);
  if (source.length < 8) throw new PersonalStrategyError("STRATEGY_TEXT_TOO_SHORT", "请至少描述入场条件、方向或风险规则。");
  const displayName = cleanText(name, 40) || explicitName(source) || generatedName(source);
  const compiled = compileConditions(source);
  const confidence = Math.max(0.2, Math.min(0.98, 0.4 + compiled.rules.length * 0.12 - (compiled.questions.length ? 0.16 : 0)));
  const spec = { schemaVersion: STRATEGY_SCHEMA_VERSION, name: displayName, sourceText: source, direction: compiled.direction, rules: compiled.rules, risk: compiled.risk, exceptions: compiled.hasException ? ["原始描述中的否定/例外语句需要在预演卡中复核"] : [], confidence, questions: compiled.questions, warnings: compiled.warnings, compiledAt: new Date().toISOString() };
  return Object.freeze({ name: displayName, spec: Object.freeze(spec), readyForSimulation: compiled.rules.length > 0, readyForConfirmation: compiled.rules.length > 0 && compiled.questions.length === 0, questions: Object.freeze([...compiled.questions]), warnings: Object.freeze([...compiled.warnings]) });
}

function candle(value, index) { if (!record(value)) return null; const close = Number(value.close), open = Number(value.open ?? close), high = Number(value.high ?? Math.max(open, close)), low = Number(value.low ?? Math.min(open, close)); if (![close, open, high, low].every(Number.isFinite) || close <= 0 || high < low) return null; return { time: Number(value.time) || index, open, high, low, close, volume: Number.isFinite(Number(value.volume)) ? Number(value.volume) : 0 }; }
function normalizeCandles(values) { return (Array.isArray(values) ? values : []).map(candle).filter(Boolean).slice(-600); }
function intervalDurationMs(value) { const match = /^(\d+)(s|m|h|d|w)$/iu.exec(cleanText(value, 20)); if (!match) return 86_400_000; const amount = Math.max(1, Number(match[1]) || 1); return amount * ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase()] || 86_400_000); }
function candleTimeMs(value) { const time = Number(value); return Number.isFinite(time) && time > 0 ? (time < 100_000_000_000 ? time * 1_000 : time) : Date.now(); }
function simulatedStrategyPath(candles, spec, interval) {
  const last = candles.at(-1), duration = intervalDurationMs(interval), lastTime = candleTimeMs(last?.time), close = Number(last?.close || 100), recentRanges = candles.slice(-20).map((item) => Math.max(Number(item.high) - Number(item.low), 0)).filter(Number.isFinite), averageRange = recentRanges.length ? recentRanges.reduce((sum, value) => sum + value, 0) / recentRanges.length : close * 0.006, range = Math.max(averageRange, close * 0.002), volumes = candles.slice(-20).map((item) => Number(item.volume || 0)).filter((value) => value > 0), averageVolume = volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 100, wantsVolume = (spec.rules || []).some((rule) => rule.type === "volume_expansion");
  let price = close;
  return Array.from({ length: 14 }, (_, index) => {
    const progress = (index + 1) / 14, direction = spec.direction === "short" ? -1 : 1, setup = index < 6 ? -direction * range * 0.08 : direction * range * (0.18 + progress * 0.08), open = price, nextClose = Math.max(0.000001, open + setup), high = Math.max(open, nextClose) + range * 0.22, low = Math.max(0.000001, Math.min(open, nextClose) - range * 0.22), volume = averageVolume * (wantsVolume && index >= 11 ? 1.45 + progress * 0.35 : 0.9 + progress * 0.2), time = lastTime + duration * (index + 1); price = nextClose; return { time, closeTime: time + duration, open, high, low, close: nextClose, volume };
  });
}
function sma(values, period) { if (values.length < period) return null; return values.slice(-period).reduce((sum, value) => sum + value, 0) / period; }
function ema(values, period) { if (values.length < period) return null; let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period; const multiplier = 2 / (period + 1); for (const value of values.slice(period)) result = value * multiplier + result * (1 - multiplier); return result; }
function rsi(values, period) { if (values.length <= period) return null; let gains = 0, losses = 0; for (let index = values.length - period; index < values.length; index += 1) { const change = values[index] - values[index - 1]; if (change >= 0) gains += change; else losses -= change; } if (losses === 0) return 100; return 100 - 100 / (1 + gains / losses); }
function evaluateRule(rule, candles) {
  const closes = candles.map((item) => item.close), last = candles.at(-1), previous = candles.at(-2);
  if (!last) return { ok: false, label: rule.label, reason: "缺少 K 线" };
  if (["price_above", "price_below", "cross_above", "cross_below"].includes(rule.type)) {
    const values = rule.indicator === "ema" ? [ema(closes, rule.period), ema(closes.slice(0, -1), rule.period)] : [sma(closes, rule.period), sma(closes.slice(0, -1), rule.period)];
    if (values.some((value) => value === null)) return { ok: false, label: rule.label, reason: `需要至少 ${rule.period + 1} 根 K 线` };
    const [line, previousLine] = values;
    if (rule.type === "price_above") return { ok: last.close > line, label: rule.label, value: last.close, reference: line };
    if (rule.type === "price_below") return { ok: last.close < line, label: rule.label, value: last.close, reference: line };
    if (!previous) return { ok: false, label: rule.label, reason: "缺少上一根 K 线" };
    return { ok: rule.type === "cross_above" ? previous.close <= previousLine && last.close > line : previous.close >= previousLine && last.close < line, label: rule.label, value: last.close, reference: line };
  }
  if (rule.type === "breakout_high" || rule.type === "breakdown_low") { const history = candles.slice(-(rule.lookback + 1), -1); if (history.length < rule.lookback) return { ok: false, label: rule.label, reason: `需要至少 ${rule.lookback + 1} 根 K 线` }; const level = rule.type === "breakout_high" ? Math.max(...history.map((item) => item.high)) : Math.min(...history.map((item) => item.low)); return { ok: rule.type === "breakout_high" ? last.close > level : last.close < level, label: rule.label, value: last.close, reference: level }; }
  if (rule.type === "volume_expansion") { const history = candles.slice(-(rule.lookback + 1), -1).map((item) => item.volume).filter((value) => value > 0); const average = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : null; return { ok: average !== null && last.volume >= average * rule.multiplier, label: rule.label, value: last.volume, reference: average }; }
  if (rule.type === "rsi_below" || rule.type === "rsi_above") { const value = rsi(closes, rule.period); if (value === null) return { ok: false, label: rule.label, reason: `需要至少 ${rule.period + 1} 根 K 线` }; return { ok: rule.type === "rsi_below" ? value < rule.value : value > rule.value, label: rule.label, value, reference: rule.value }; }
  return { ok: false, label: rule.label || rule.type, reason: "当前运行时不支持该条件" };
}

export function evaluatePersonalStrategy(specValue, candlesValue, { marketId = "UNKNOWN:UNKNOWN", interval = "1D", analysisId = `personal-${crypto.randomUUID()}` } = {}) {
  const spec = record(specValue) ? specValue : {}, candles = normalizeCandles(candlesValue), evaluations = (Array.isArray(spec.rules) ? spec.rules : []).map((rule) => evaluateRule(rule, candles));
  const actionable = evaluations.length > 0 && evaluations.every((item) => item.ok === true), direction = spec.direction === "long" || spec.direction === "short" ? spec.direction : "neutral", status = candles.length < 2 ? "insufficient_data" : "completed", last = candles.at(-1) || { time: Date.now(), close: 0, high: 0, low: 0 }, range = Math.max(last.high - last.low, last.close * 0.005, Number.EPSILON), side = actionable && direction !== "neutral" ? direction : "neutral", entry = last.close, stop = spec.risk?.stopLoss || (side === "short" ? entry + range * 1.5 : entry - range * 1.5), target = spec.risk?.takeProfit || (side === "short" ? entry - range * (spec.risk?.riskReward || 2) : entry + range * (spec.risk?.riskReward || 2));
  const signals = evaluations.map((item, index) => ({ id: `condition-${index + 1}`, label: item.label, side, ok: item.ok, value: item.value, reference: item.reference, reason: item.reason }));
  const evidence = signals.map((item) => ({ id: item.id, summary: `${item.label}: ${item.ok ? "满足" : item.reason || "未满足"}` }));
  const conditionText = signals.length ? signals.map((item) => `${item.label}（${item.ok ? "满足" : item.reason || "未满足"}）`).join("；") : "没有可执行条件";
  const bias = side === "long" ? "偏多" : side === "short" ? "偏空" : "等待";
  const report = [`## ${spec.name || "个人策略"}分析`, "", `- 当前结论：${actionable ? `${bias}条件成立` : `保持等待（${bias}）`}`, `- 条件核对：${conditionText}`, `- 当前价格：${Number(entry).toFixed(6)}`, `- 计划价位：入场参考 ${Number(entry).toFixed(6)} / 失效 ${Number(stop).toFixed(6)} / 目标 ${Number(target).toFixed(6)}`, "- 这是策略规则的只读分析，不会自动下单；仓位必须继续经过账户硬风控与用户确认。", spec.warnings?.length ? `- 预警：${spec.warnings.join("；")}` : ""].filter(Boolean).join("\n");
  const operation = (id, role, price, text = "") => ({ op: "upsert", drawing: { id: `${String(spec.name || "personal").slice(0, 40)}-${id}`, strategyId: spec.strategyId || "personal", symbol: marketId, interval, theory: "strategy", layer: `ai/strategy/${spec.strategyId || "personal"}`, tool: role === "note" ? "note" : "path", points: [{ time: last.time, price }, { time: Number(last.time) + 1, price }], ...(text ? { text } : {}), colorToken: `strategy-${role}`, locked: true, status: "confirmed", evidenceIds: signals.map((item) => item.id) } });
  const drawingPatch = { schemaVersion: 1, analysisId, baseRevision: 0, marketId, interval, operations: [operation("primary", "primary", last.close), operation("entry", "entry", entry), operation("stop", "stop", stop), operation("target", "target", target), operation("note", "note", last.close, `${spec.name || "个人策略"}：${actionable ? "条件成立" : "等待条件"}`)] };
  return Object.freeze({ ok: true, snapshot: { snapshotId: `${analysisId}-${stableHash(candles).slice(0, 20)}`, inputHash: stableHash({ marketId, interval, candles }), marketId, interval, snapshotTime: Date.now() }, theoryResult: { status, signals, evidence, coverage: { candles: candles.length >= 30 ? "available" : "partial" }, direction: side }, analysisPlan: { analysisId, narrative: report, report, drawingPatch, actionPlan: { primaryBias: side, longTrigger: direction === "long" ? entry : null, longInvalidation: direction === "long" ? stop : null, longTarget: direction === "long" ? target : null, shortTrigger: direction === "short" ? entry : null, shortInvalidation: direction === "short" ? stop : null, shortTarget: direction === "short" ? target : null, confirmation: "等待当前周期收盘确认；不会自动下单" } }, model: { providerId: "personal-strategy", modelId: "deterministic-personal-v1", latencyMs: 0 }, report, narrative: report, marketId, symbol: marketId, interval, candleCount: candles.length, modelName: "个人策略规则引擎" });
}

function emptyState() { return { version: STORE_VERSION, owners: {} }; }
function emptyProfile() { return { revision: 0, records: [] }; }
function publicRecord(item) { return { id: item.id, status: item.status, name: item.name, version: item.version, sourceText: item.spec?.sourceText || "", spec: item.spec, simulation: item.simulation || null, feedback: item.feedback || [], createdAt: item.createdAt, updatedAt: item.updatedAt, manifest: item.manifest }; }
function manifestFor(item) { return { schemaVersion: 1, id: item.id, version: item.version, display: { name: item.name, group: "strategy", sortOrder: 10_000 }, mentions: { canonical: item.name, aliases: [] }, implementation: { kind: "declarative-v1" }, capabilities: ["conversation", "chart-analysis", "drawing", "execution-plan"], dataRequirements: { candles: { required: true, minCount: 2, preferredCount: 120, minimumCoverage: "partial" } }, chartIndicator: null, personalContext: item.status === "active" ? { direction: item.spec?.direction, rules: (item.spec?.rules || []).map((rule) => rule.label || rule.type), risk: item.spec?.risk || null, exceptions: item.spec?.exceptions || [], understanding: item.spec?.understanding ? { summary: item.spec.understanding.summary || "", confidence: item.spec.understanding.confidence ?? 0, evidence: item.spec.understanding.evidence || [], uncertainties: item.spec.understanding.uncertainties || [] } : null } : null, enabled: item.status === "active", diagnostic: item.status === "active" ? null : "尚未确认", disabledReason: item.status === "active" ? null : "请先完成策略预演并确认", publisher: { id: "haolo-personal", type: "community" } }; }

export class PersonalStrategyService {
  constructor({ storagePath, vaultPath, safeStorage, now = () => new Date() } = {}) { if (!storagePath) throw new TypeError("storagePath is required"); this.storagePath = path.resolve(storagePath); this.vaultPath = path.resolve(vaultPath || path.join(path.dirname(this.storagePath), "haolo-obsidian-vault")); this.safeStorage = safeStorage; this.now = now; this.mutationQueue = Promise.resolve(); }
  async ensureVault() { await fs.promises.mkdir(path.join(this.vaultPath, "Strategies"), { recursive: true }); return this.vaultPath; }
  encryptionAvailable() { return Boolean(this.safeStorage?.isEncryptionAvailable?.()); }
  async list(ownerId, { includeDrafts = true } = {}) { const profile = await this.resolveProfile(ownerId); return profile.records.filter((item) => includeDrafts || item.status === "active").map(publicRecord); }
  async manifests(ownerId) { return (await this.list(ownerId, { includeDrafts: false })).map((item) => manifestFor(item)); }
  async get(ownerId, strategyId) { const profile = await this.resolveProfile(ownerId); const item = profile.records.find((entry) => entry.id === String(strategyId || "")); return item ? publicRecord(item) : null; }
  async createDraft(ownerId, { text, name, understanding } = {}) { const compiled = compilePersonalStrategy(text, { name }); const learnedUnderstanding = storedUnderstanding(understanding); return this.enqueueMutation(async () => { const profile = await this.resolveProfile(ownerId), base = slug(compiled.name), id = `personal-${base}-${stableHash({ ownerId, name: compiled.name, source: compiled.spec.sourceText }).slice(0, 10)}`.slice(0, 64), existing = profile.records.find((item) => item.id === id || item.name.toLowerCase() === compiled.name.toLowerCase()); if (existing) throw new PersonalStrategyError("STRATEGY_NAME_CONFLICT", `已有同名策略“${compiled.name}”，请换一个名称或进入“优化”。`); const timestamp = nowIso(this.now), spec = { ...compiled.spec, strategyId: id, ...(learnedUnderstanding ? { understanding: learnedUnderstanding } : {}) }, item = { id, status: "draft", name: compiled.name, version: "0.1.0", spec, simulation: null, feedback: [], versions: [{ version: "0.1.0", sourceText: compiled.spec.sourceText, spec, createdAt: timestamp, reason: "created" }], createdAt: timestamp, updatedAt: timestamp }; profile.records.push(item); await this.writeProfile(ownerId, profile); return { draft: publicRecord(item), compile: compiled }; }); }
  async simulate(ownerId, { draftId, candles = [], marketId = "SIMULATION", interval = "1d" } = {}) { return this.enqueueMutation(async () => { const profile = await this.resolveProfile(ownerId), item = profile.records.find((entry) => entry.id === String(draftId || "")); if (!item) throw new PersonalStrategyError("STRATEGY_DRAFT_NOT_FOUND", "找不到这份策略草稿，请重新创建。"); const learnedUnderstanding = storedUnderstanding(item.spec?.understanding), compiled = compilePersonalStrategy(item.spec.sourceText, { name: item.name }), usable = normalizeCandles(candles), fallback = usable.length >= 2 ? usable : syntheticCandles(), generated = simulatedStrategyPath(fallback, compiled.spec, interval), combined = [...fallback, ...generated.map((entry) => ({ ...entry, time: entry.time / 1_000 }))], evaluation = evaluatePersonalStrategy({ ...compiled.spec, strategyId: item.id }, combined, { marketId: cleanText(marketId, 120) || "SIMULATION", interval: cleanText(interval, 20) || "1d", analysisId: `simulation-${crypto.randomUUID()}` }), triggerCandle = generated.at(-1), history = fallback.slice(-160).map((entry, index) => { const time = candleTimeMs(entry.time); return { time, closeTime: time + intervalDurationMs(interval), open: entry.open, high: entry.high, low: entry.low, close: entry.close, volume: entry.volume, sourceIndex: index }; }), simulation = { simulationId: `simulation-${crypto.randomUUID()}`, createdAt: nowIso(this.now), inputHash: stableHash({ sourceText: item.spec.sourceText, candles: fallback, marketId, interval }), status: compiled.readyForSimulation ? "completed" : "needs_clarification", bars: fallback.length, trigger: evaluation.analysisPlan.actionPlan.primaryBias, report: evaluation.report, assumptions: usable.length ? ["使用当前图表历史生成演示路径；这是规则理解预演，不是收益回测或未来预测"] : ["创建时未提供图表，使用内置合成 K 线演示规则路径；确认前仍建议在真实图表复核"], questions: compiled.questions, warnings: compiled.warnings, generated: { primary: generated }, visualization: { marketId: cleanText(marketId, 120) || "SIMULATION", interval: cleanText(interval, 20) || "1d", candles: history }, triggerBarIndex: Math.max(0, generated.length - 1), triggerPoint: triggerCandle ? { time: triggerCandle.time, price: triggerCandle.close } : null, activeConditionIds: (compiled.spec.rules || []).map((_, index) => `condition-${index + 1}`) }; item.spec = { ...compiled.spec, strategyId: item.id, ...(learnedUnderstanding ? { understanding: learnedUnderstanding } : {}) }; item.simulation = simulation; item.updatedAt = nowIso(this.now); await this.writeProfile(ownerId, profile); return { draft: publicRecord(item), simulation }; }); }
  async confirm(ownerId, { draftId, simulationId } = {}) { return this.enqueueMutation(async () => { const profile = await this.resolveProfile(ownerId), item = profile.records.find((entry) => entry.id === String(draftId || "")); if (!item) throw new PersonalStrategyError("STRATEGY_DRAFT_NOT_FOUND", "找不到策略草稿。"); if (!item.simulation || item.simulation.simulationId !== String(simulationId || "")) throw new PersonalStrategyError("STRATEGY_CONFIRMATION_STALE", "策略或预演已变化，请重新模拟后确认。"); if (item.spec?.questions?.length) throw new PersonalStrategyError("STRATEGY_NEEDS_CLARIFICATION", `还有未确认条件：${item.spec.questions.join("；")}`); item.status = "active"; item.version = String(item.version || "0.1.0").startsWith("0.") ? "1.0.0" : item.version; item.updatedAt = nowIso(this.now); item.versions = [...(item.versions || []), { version: item.version, sourceText: item.spec.sourceText, spec: item.spec, createdAt: item.updatedAt, reason: "confirmed" }].slice(-MAX_VERSIONS); await this.writeProfile(ownerId, profile); await this.writeMarkdown(item); return publicRecord(item); }); }
  async feedback(ownerId, { strategyId, text, understanding } = {}) { const feedbackText = cleanText(text, 4_000); if (feedbackText.length < 2) throw new PersonalStrategyError("STRATEGY_FEEDBACK_REQUIRED", "请说明哪里不符合预期，或给出希望新增/删除的条件。"); return this.enqueueMutation(async () => { const profile = await this.resolveProfile(ownerId), item = profile.records.find((entry) => entry.id === String(strategyId || "")); if (!item) throw new PersonalStrategyError("STRATEGY_NOT_FOUND", "找不到个人策略。"); const mergedText = `${item.spec.sourceText}\n\n用户修订：${feedbackText}`.slice(0, MAX_TEXT), compiled = compilePersonalStrategy(mergedText, { name: item.name }), learnedUnderstanding = storedUnderstanding(understanding) || storedUnderstanding(item.spec?.understanding), [major, minor, patch] = String(item.version || "1.0.0").split(".").map((value) => Number(value) || 0); item.version = `${major}.${minor + 1}.${patch}`; item.spec = { ...compiled.spec, strategyId: item.id, sourceText: mergedText, ...(learnedUnderstanding ? { understanding: learnedUnderstanding } : {}) }; item.status = "draft"; item.simulation = null; item.feedback = [...(item.feedback || []), { text: feedbackText, createdAt: nowIso(this.now) }].slice(-32); item.versions = [...(item.versions || []), { version: item.version, sourceText: mergedText, spec: item.spec, createdAt: nowIso(this.now), reason: "feedback" }].slice(-MAX_VERSIONS); item.updatedAt = nowIso(this.now); await this.writeProfile(ownerId, profile); return { strategy: publicRecord(item), compile: compiled }; }); }
  async resolveProfile(ownerId) { const state = await this.readState(); return this.decryptProfile(state.owners[ownerHash(ownerId)] || null); }
  async writeProfile(ownerId, profile) { if (profile.records.length > MAX_STRATEGIES) throw new PersonalStrategyError("STRATEGY_LIMIT_EXCEEDED", `个人策略最多保存 ${MAX_STRATEGIES} 份。`); const state = await this.readState(); state.owners[ownerHash(ownerId)] = this.encryptProfile({ revision: profile.revision + 1, records: profile.records }); await this.writeState(state); }
  async readState() { try { const parsed = JSON.parse(await fs.promises.readFile(this.storagePath, "utf8")); if (!record(parsed) || parsed.version !== STORE_VERSION || !record(parsed.owners)) throw new Error("invalid state"); return parsed; } catch (error) { if (error?.code === "ENOENT") return emptyState(); if (error instanceof PersonalStrategyError) throw error; throw new PersonalStrategyError("STRATEGY_STORE_INVALID", "个人策略库无法读取，为避免覆盖数据已停止写入。"); } }
  async writeState(state) { await fs.promises.mkdir(path.dirname(this.storagePath), { recursive: true }); const temporaryPath = `${this.storagePath}.${process.pid}.${crypto.randomUUID()}.tmp`; try { await fs.promises.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await fs.promises.rename(temporaryPath, this.storagePath); } finally { await fs.promises.rm(temporaryPath, { force: true }).catch(() => {}); } }
  decryptProfile(saved) { if (!saved?.encryptedProfile) return emptyProfile(); if (!this.encryptionAvailable()) throw new PersonalStrategyError("SECURE_STORAGE_UNAVAILABLE", "系统安全存储不可用，无法读取个人策略。"); try { const parsed = JSON.parse(this.safeStorage.decryptString(Buffer.from(saved.encryptedProfile, "base64"))); if (!record(parsed) || !Array.isArray(parsed.records)) throw new Error("invalid profile"); return { revision: Number(parsed.revision) || 0, records: parsed.records.filter((item) => PERSONAL_ID_PATTERN.test(String(item?.id || ""))) }; } catch (error) { if (error instanceof PersonalStrategyError) throw error; throw new PersonalStrategyError("STRATEGY_DECRYPT_FAILED", "个人策略无法解密，Haolo 已停止覆盖该数据。"); } }
  encryptProfile(profile) { if (!this.encryptionAvailable()) throw new PersonalStrategyError("SECURE_STORAGE_UNAVAILABLE", "系统安全存储不可用，拒绝用明文保存个人策略。"); return { encryptedProfile: this.safeStorage.encryptString(JSON.stringify(profile)).toString("base64"), entryCount: profile.records.length, updatedAt: nowIso(this.now) }; }
  enqueueMutation(task) { const result = this.mutationQueue.then(task, task); this.mutationQueue = result.catch(() => {}); return result; }
  async writeMarkdown(item) { const fileName = `${slug(item.name).slice(0, 50)}-${item.id.slice(-10)}.md`, target = path.join(this.vaultPath, "Strategies", fileName), understanding = storedUnderstanding(item.spec?.understanding), markdown = ["---", "type: haolo-trading-strategy", `strategy_id: ${item.id}`, `version: ${item.version}`, `status: ${item.status}`, `updated_at: ${item.updatedAt}`, "---", "", `# ${item.name}`, "", "## 用户原始描述", item.spec.sourceText, "", "## 智能体理解摘要", understanding?.summary || "未提供", `- 理解置信度：${Math.round(Number(understanding?.confidence || 0) * 100)}%`, ...(understanding?.evidence || []).map((entry) => `- 依据：${[entry.source, entry.locator].filter(Boolean).join(" · ")}：${entry.meaning || entry.quote || ""}`), ...(understanding?.uncertainties || []).map((entry) => `- 不确定：${entry}`), "", "## Haolo 可解释规则", ...(item.spec.rules || []).map((rule) => `- ${rule.label || rule.type}`), "", "## 风险与例外", `- 方向：${item.spec.direction}`, `- 止损：${item.spec.risk?.stopLoss ?? "按账户硬风控计算"}`, `- 止盈：${item.spec.risk?.takeProfit ?? "按盈亏比或盘面确认"}`, ...(item.spec.warnings || []).map((warning) => `- ${warning}`), "", "## 版本记录", ...(item.versions || []).map((version) => `- ${version.version} · ${version.reason} · ${version.createdAt}`), ""].join("\n"); await fs.promises.mkdir(path.dirname(target), { recursive: true }); const temporaryPath = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`; try { await fs.promises.writeFile(temporaryPath, markdown, { encoding: "utf8", mode: 0o600 }); await fs.promises.rename(temporaryPath, target); } finally { await fs.promises.rm(temporaryPath, { force: true }).catch(() => {}); } return target; }
}

function syntheticCandles() { const result = []; let price = 100; for (let index = 0; index < 80; index += 1) { const drift = index < 40 ? 0.18 : index % 2 ? 0.35 : -0.08, open = price, close = Math.max(1, price + drift); result.push({ time: index + 1, open, high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close, volume: 100 + index }); price = close; } return result; }
export function personalStrategyManifest(recordValue) { return manifestFor(recordValue); }
