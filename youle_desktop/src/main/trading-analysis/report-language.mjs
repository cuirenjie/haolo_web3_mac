import { ANALYSIS_ENGLISH } from "./report-language-en.mjs";
import { boundedTradingAnnotation } from "./model-output-language.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { koreanText } from "../../shared/korean.mjs";

const requestLanguage = new AsyncLocalStorage();
export function withTradingReportLanguage(language, operation) {
  return requestLanguage.run(language, operation);
}

// Formatting at the source template keeps interpolation boundaries exact,
// including nested semicolons, repeated numbers and Markdown emphasis.
export function tradingReportText(source, ...values) {
  if (requestLanguage.getStore() === "ko") {
    return koreanText(source).replace(/\{(\d+)\}/g, (_, index) => koreanText(values[Number(index)] ?? ""));
  }
  const english = requestLanguage.getStore() === "en";
  const prefix = markdownMarker.exec(source)?.[0] || "";
  const template = english ? ANALYSIS_ENGLISH[source] ||
    (catalog[source.slice(prefix.length)] ? prefix + catalog[source.slice(prefix.length)] : englishAnalysisText(source)) : source;
  const quotedInput = /^(分析要求|你的问题|你的要求)：/.test(source);
  const intervalSlot = source.match(/(?:根 |画布 )\{(\d+)\} (?:已收盘 )?(?:OHLCV )?K 线/)?.[1];
  const text = template.replace(/\{(\d+)\}/g, (_, index) => {
    const value = String(values[Number(index)] ?? "");
    if (english && index === intervalSlot) return englishTradingInterval(value);
    return english && !quotedInput ? englishAnalysisText(value) : value;
  });
  return english && !quotedInput ? englishPunctuation(text) : text;
}

export function englishTradingInterval(value) {
  const interval = String(value);
  if (/^\d+$/.test(interval)) return `${interval}-minute`;
  // Exchange interval codes distinguish minutes (m) from calendar months (M).
  const named = /^(\d+)([sSmhHdDwWM])$/.exec(interval);
  const units = { s: "second", S: "second", m: "minute", h: "hour", H: "hour", d: "day", D: "day", w: "week", W: "week", M: "month" };
  return named ? `${named[1]}-${units[named[2]]}` : interval;
}

export function tradingReportTime(milliseconds) {
  const date = new Date(milliseconds);
  if (requestLanguage.getStore() === "ko") return date.toLocaleString("ko-KR", { hour12: false });
  return requestLanguage.getStore() === "en"
    ? date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")
    : date.toLocaleString("zh-CN", { hour12: false });
}

function englishPunctuation(text) {
  return text.replace(/；/g, "; ").replace(/，/g, ", ").replace(/。/g, ".").replace(/：/g, ": ")
    .replace(/（/g, " (").replace(/）/g, ")").replace(/、/g, ", ")
    .replace(/ +([,;.])/g, "$1").replace(/([;.])\1+(?=\s|$)/g, "$1")
    .replace(/\b1 candles\b/g, "1 candle").replace(/\b1 central-zone candidates\b/g, "1 central-zone candidate")
    .replace(/\b1 central zones\b/g, "1 central zone")
    .replace(/\b1 (confirmed )?touches\b/g, "1 $1touch")
    .replace(/\b(bearish|bullish)-engulfing\b/g, "$1 engulfing pattern")
    .replace(/are aligned; aligned with the longer-term context;/g, "are aligned with the longer-term context;");
}

const han = /\p{Script=Han}/u;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const markdownMarker = /^(#{1,6} |[-*] )/;
const catalog = Object.fromEntries(Object.entries(ANALYSIS_ENGLISH).map(([source, target]) =>
  [source.replace(markdownMarker, ""), target.replace(markdownMarker, "")]));
// Translate complete authored templates before their interpolated terms. Values
// (prices, percentages, dates, symbols and model prose) are retained verbatim.
const templates = Object.entries(catalog).filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.indexOf("{") - a.indexOf("{") || b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
  .map(([source, target]) => ({
    source, pattern: new RegExp(`^${source.split(/\{\d+\}/).map(escape).join("([^\\n]*)")}$`, "u"), target,
  }));
const terms = Object.entries(catalog).filter(([key]) => key.length > 1 && !/\{\d+\}/.test(key))
  .sort(([a], [b]) => b.length - a.length);

export function englishAnalysisText(value, depth = 0) {
  const text = String(value ?? "");
  if (!han.test(text)) return englishPunctuation(text);
  if (depth > 16) return text;
  if (text.includes("\n")) return text.split("\n").map((line) => englishAnalysisText(line, depth + 1)).join("\n");
  const marker = markdownMarker.exec(text);
  if (marker) return marker[0] + englishAnalysisText(text.slice(marker[0].length), depth + 1);
  if (Object.hasOwn(catalog, text)) return catalog[text];
  // Prefer an exact authored label followed only by values over a broad
  // template (e.g. Profile High must not be parsed as a generic "pivot").
  for (const [source, target] of terms) {
    if (text.startsWith(source) && !han.test(text.slice(source.length))) return target + text.slice(source.length);
  }
  for (const { source, pattern, target } of templates) {
    const match = pattern.exec(text);
    // A list of several zones/events must be translated item by item; do not
    // let a single-item template swallow separators into a numeric value.
    if (match && !(/^\{0\}(区 |点 )/.test(source) && /[；，]/u.test(text))) {
      return target.replace(/\{(\d+)\}/g, (_, index) => englishAnalysisText(match[Number(index) + 1], depth + 1));
    }
  }
  // Report paragraphs and Markdown markers are structural, not translation keys.
  if (/[；。，]/u.test(text)) return text.split(/([；。，])/u).map((part) =>
    part === "；" ? "; " : part === "。" ? "." : part === "，" ? ", " : englishAnalysisText(part, depth + 1)).join("");
  let translated = text;
  for (const [source, target] of terms) translated = translated.split(source).join(target);
  return translated;
}

export function localizeTradingAnalysisResult(result, language) {
  if (language === "ko" && result?.analysisPlan) {
    const proseKeys = new Set(["report", "narrative", "summary", "rationale", "confirmation", "observeTrigger", "text", "label", "title", "description", "reason", "riskWarning"]);
    const visit = (value, key = "") => typeof value === "string" ? (proseKeys.has(key) ? koreanText(value) : value)
      : Array.isArray(value) ? value.map(item => visit(item, key))
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, visit(item, name)])) : value;
    return { ...result, analysisPlan: visit(result.analysisPlan) };
  }
  if (language !== "en" || !result?.analysisPlan) return result;
  const plan = result.analysisPlan;
  const actionPlan = plan.actionPlan && { ...plan.actionPlan };
  for (const key of ["confirmation", "observeTrigger"]) {
    if (typeof actionPlan?.[key] === "string") actionPlan[key] = englishAnalysisText(actionPlan[key]);
  }
  const drawing = (patch) => patch && ({ ...patch, operations: patch.operations.map((operation) =>
    operation.drawing?.text ? { ...operation, drawing: { ...operation.drawing, text: boundedTradingAnnotation(englishAnalysisText(operation.drawing.text)) } } : operation) });
  return { ...result, analysisPlan: {
    ...plan,
    report: plan.report.split("\n").map((line) => /^\s*(Analysis request|Request|Your question|Your request):/.test(line) ? line : englishPunctuation(line)).join("\n"),
    narrative: englishAnalysisText(plan.narrative),
    ...(actionPlan ? { actionPlan } : {}),
    ...(plan.drawingPatch ? { drawingPatch: drawing(plan.drawingPatch) } : {}),
    ...(plan.indicatorDrawingPatch ? { indicatorDrawingPatch: drawing(plan.indicatorDrawingPatch) } : {}),
  } };
}
