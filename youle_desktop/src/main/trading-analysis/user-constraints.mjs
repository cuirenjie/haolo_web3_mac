// User constraints applied after Codex selects an analysis tool; no intent routing.
// 裸“别”必须是独立祈使词，不能命中“分别画线”“特别标注”等肯定请求。
const EXPLICIT_NO_DRAWING = /(?:不要|不用|无需|不需要|(?<!\p{Script=Han})别|(?:请|先|你|就|也|还是|暂时|千万)别)(?:重新)?(?:绘图|画图|画线|重画|标注)|(?:只要|仅要|只需).{0,12}(?:文字|结论|回答).{0,12}(?:不要|不用|无需).{0,8}(?:绘图|画图|画线)|(?:do\s+not|don't|without)\s+(?:draw|redraw|drawing|mark)/iu;

export function normalizeTradingRoutingText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/([\p{Script=Han}])[\r\n]+\s*([\p{Script=Han}])/gu, "$1$2")
    .replace(/\r\n?/g, "\n")
    .replace(/@(?:策略|指标)\s*：\s*/gu, (match) => match.includes("指标") ? "@指标:" : "@策略:")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
}

export function explicitNoDrawingRequested(text) {
  return EXPLICIT_NO_DRAWING.test(normalizeTradingRoutingText(text));
}

