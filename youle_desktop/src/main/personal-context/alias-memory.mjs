const MAX_ALIAS_LABEL_LENGTH = 48;
const MAX_SYMBOL_LENGTH = 16;

// This parser is intentionally narrow. A normal sentence that happens to
// mention a company or ticker must never create durable user state. We only
// accept an explicit mapping plus a memory verb (or the unambiguous
// "特指/指的是" wording used by the user).
const EXPLICIT_MEMORY_INTENT = /(?:长期记住|记住|记忆|保存|记作|记为|以后(?:提到|说到|说)|之后(?:提到|说到|说))/iu;
const HYPOTHETICAL_OR_QUOTED = /(?:如果|假如|比如|例如|想知道|只是问|测试一下|不要记|别记|不必记|不用记)/iu;
const ALIAS_PATTERN = /(?:^|[，,。；;\n])\s*(?:(?:请)?(?:长期)?(?:记住|记忆|保存|记作|记为)\s*[:：]?\s*)?(?:(?:以后|之后)\s*(?:提到|说到|说)\s*)?(?:把\s*)?["“‘]?([^\s"“”‘’=＝:：,，。；;()（）]{1,48})["”’]?\s*(?:特指|指的是|指代|对应|记作|记为|就是|等同于|=|＝)\s*["“‘]?([A-Z][A-Z0-9._-]{1,15})["”’]?/iu;

const GENERIC_LABELS = new Set([
  "我",
  "用户",
  "这个",
  "那个",
  "它",
  "问题",
  "意思",
  "名称",
  "股票",
  "币",
  "代码",
  "公司",
  "标的",
]);

/**
 * Parse an explicit user request such as “闪迪特指 SNDK，能长期记住吗”.
 * Returns null for ordinary mentions, hypotheticals, or ambiguous mappings.
 */
export function parseExplicitMarketAliasMemory(value) {
  const text = String(value || "").replace(/\u0000/g, "").trim().slice(0, 12_000);
  if (!text || !EXPLICIT_MEMORY_INTENT.test(text) || HYPOTHETICAL_OR_QUOTED.test(text)) return null;
  const match = text.match(ALIAS_PATTERN);
  if (!match) return null;
  const label = String(match[1] || "").replace(/[\s\u200b]+/g, "").trim();
  const symbol = String(match[2] || "").trim().toUpperCase();
  if (!isLikelyAliasLabel(label) || !isLikelySymbol(symbol)) return null;
  return {
    label,
    symbol,
    scope: "trading.aliases",
    kind: "fact",
    key: `market_alias_${symbol.toLowerCase()}`,
    value: `用户明确指定：${label} 特指 ${symbol}。后续用户提到“${label}”时，将其解析为 ${symbol}；这只是名称映射，不代表用户要求 K 线、行情或交易分析。`,
    strength: "normal",
  };
}

function isLikelyAliasLabel(value) {
  const label = String(value || "").trim();
  if (!label || label.length > MAX_ALIAS_LABEL_LENGTH || GENERIC_LABELS.has(label)) return false;
  if (!/[\p{L}\p{N}]/u.test(label)) return false;
  return !/^(?:请|请问|能否|是否|以后|之后|长期|记住|保存|特指|指的是)/iu.test(label);
}

function isLikelySymbol(value) {
  const symbol = String(value || "").trim();
  return /^[A-Z][A-Z0-9._-]{1,15}$/u.test(symbol) && symbol.length <= MAX_SYMBOL_LENGTH;
}
