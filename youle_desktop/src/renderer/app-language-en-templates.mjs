// Translate complete authored templates before the legacy phrase fallback.
// Captured numeric text is copied verbatim; these rules never infer trade values.
export function reviewedEnglishTemplates(source) {
  return source
    .replace(/(^|\n)- 单笔最大风险：当前账户净值的\s*(\d+(?:\.\d+)?)%；/g,
      '$1- Maximum risk per trade: $2% of current account equity;')
    .replace(/浮盈达到\s*(\d+(?:\.\d+)?)R 后移动至覆盖交易成本的保本位置/g,
      'Move the stop to breakeven, including trading costs, after an unrealized profit of $1R');
}
