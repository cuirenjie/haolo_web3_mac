const NATURAL_STRATEGY_PREFIX = /(?:请|帮我|给我|麻烦)?(?:改用|换成|切换到|使用|采用|按照|依照|基于|运用|调用|按|用|以)$/u;
const NATURAL_STRATEGY_SUFFIX = /^(?:来|去)?(?:分析|研判|复盘|看盘|看下|看看|看一下|画线|绘图|画图|标注)/u;
const NEGATED_STRATEGY_PREFIX = /(?:不要(?:再)?用|不用|别用|无需使用|不使用|不采用|不按照|不按|排除|剔除|而不是|非)$/u;

function compactSemanticText(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-./:：，,。！？!?()[\]{}'"“”‘’]/gu, "");
}

function asciiWordCharacter(value) {
  return Boolean(value && /[a-z0-9]/iu.test(value));
}

function semanticTermOccurrences(source, term) {
  const occurrences = [];
  let cursor = 0;
  while (cursor <= source.length - term.length) {
    const index = source.indexOf(term, cursor);
    if (index < 0) break;
    const before = source[index - 1] || "";
    const after = source[index + term.length] || "";
    // Do not resolve short Latin aliases from inside an unrelated symbol or
    // word (for example, SMC inside a longer ticker). Han strategy names can
    // be matched directly because they do not have word-boundary semantics.
    const latinBoundaryIsValid = !/^[a-z0-9]+$/iu.test(term)
      || (!asciiWordCharacter(before) && !asciiWordCharacter(after));
    if (latinBoundaryIsValid) occurrences.push(index);
    cursor = index + Math.max(1, term.length);
  }
  return occurrences;
}

function strategyTerms(strategy) {
  return [...new Set([
    strategy?.display?.name,
    strategy?.mentions?.canonical,
    ...(Array.isArray(strategy?.mentions?.aliases) ? strategy.mentions.aliases : []),
  ].map(compactSemanticText).filter((term) => term.length >= 2))];
}

function occurrenceScore(source, term, index) {
  const prefix = source.slice(Math.max(0, index - 18), index);
  const suffix = source.slice(index + term.length, index + term.length + 12);
  if (NEGATED_STRATEGY_PREFIX.test(prefix)) return null;
  const explicitMention = ["@策略", "@指标"].some((marker) => prefix.endsWith(marker));
  if (explicitMention) return 1_000;
  let score = source === term ? 320 : 100;
  if (NATURAL_STRATEGY_PREFIX.test(prefix)) score += 400;
  if (NATURAL_STRATEGY_SUFFIX.test(suffix)) score += 300;
  return score;
}

/**
 * Resolve an explicitly named installed strategy/indicator from a free-form
 * user message. The catalog remains the authority: this function never
 * invents a strategy from general market words. A tie between different
 * strategies is deliberately left unresolved rather than silently executing
 * the first catalog entry.
 */
export function resolveExplicitTradingStrategyId(text, strategies = []) {
  const source = compactSemanticText(text);
  if (!source) return null;
  const candidates = [];
  for (const strategy of strategies) {
    const strategyId = String(strategy?.id || "").trim();
    if (!strategyId || strategy?.enabled === false) continue;
    let bestScore = null;
    for (const term of strategyTerms(strategy)) {
      for (const index of semanticTermOccurrences(source, term)) {
        const score = occurrenceScore(source, term, index);
        if (score != null && (bestScore == null || score > bestScore)) bestScore = score;
      }
    }
    if (bestScore != null) candidates.push({ strategyId, score: bestScore });
  }
  candidates.sort((left, right) => right.score - left.score);
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
  return candidates[0].strategyId;
}
