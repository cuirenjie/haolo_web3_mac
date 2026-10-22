// Public receipt validation and localized display; no strategy calculation.
const words={
  SMT_PAIR_QUALIFIED:['对照市场通过校验','Comparison market qualified','對照市場通過校驗'],
  SMT_NO_DIVERGENCE:['SMT 扫描完成，当前没有确认背离','SMT scan completed; no confirmed divergence','SMT 掃描完成，目前沒有確認背離'],
  SMT_SIGNAL_CONFIRMED:['已确认 SMT 背离，等待主市场结构确认','SMT divergence confirmed; awaiting primary-market structure confirmation','已確認 SMT 背離，等待主市場結構確認'],
  SMT_PAIR_NOT_CONFIGURED:['当前品种尚无经过验证的对照市场配置','No verified comparison-market configuration for this instrument','目前品種尚無經過驗證的對照市場設定'],
  SMT_ASSET_UNSUPPORTED:['该品种的资产或杠杆类型尚未适配 SMT 配对','SMT pairing is not supported for this asset or leverage type','該品種的資產或槓桿類型尚未適配 SMT 配對'],
  SMT_MARKET_NOT_LISTED:['当前数据源未提供该对照合约','Comparison contract is not listed by this data source','目前資料來源未提供該對照合約'],
  SMT_ASSET_MISMATCH:['对照市场资产类型不匹配','Comparison asset type does not match','對照市場資產類型不符'],
  SMT_SESSION_MISMATCH:['主市场与对照市场交易时段不兼容','Primary and comparison trading sessions are incompatible','主市場與對照市場交易時段不相容'],
  SMT_INTERVAL_UNSUPPORTED:['对照行情不支持当前周期','Comparison source does not support this interval','對照行情不支援目前週期'],
  SMT_SOURCE_TIMEOUT:['对照行情获取超时，请稍后重试','Comparison request timed out; retry later','對照行情取得逾時，請稍後重試'],
  SMT_SOURCE_RATE_LIMITED:['对照行情正在等待限流恢复','Waiting for the comparison source rate limit to clear','對照行情正在等待限流恢復'],
  SMT_SOURCE_UNAVAILABLE:['对照行情源暂不可用','Comparison data source is temporarily unavailable','對照行情來源暫不可用'],
  SMT_SOURCE_INVALID:['对照行情包含无效数据','Comparison data contains invalid values','對照行情包含無效資料'],
  SMT_COMPARISON_MISSING:['缺少对照市场行情','Comparison-market candles are missing','缺少對照市場行情'],
  SMT_PRIMARY_HISTORY_SHORT:['主市场已收盘 K 线不足60根','Fewer than 60 closed primary candles','主市場已收盤 K 線不足60根'],
  SMT_COMPARISON_HISTORY_SHORT:['对照市场已收盘 K 线不足60根','Fewer than 60 closed comparison candles','對照市場已收盤 K 線不足60根'],
  SMT_BASELINE_HISTORY_SHORT:['信号窗口之前的历史不足，无法验证配对稳定性','Insufficient pre-signal history to validate pairing stability','訊號視窗之前的歷史不足，無法驗證配對穩定性'],
  SMT_PRIMARY_STALE:['主市场行情已过期','Primary-market candles are stale','主市場行情已過期'],
  SMT_COMPARISON_STALE:['对照市场行情已过期','Comparison-market candles are stale','對照市場行情已過期'],
  SMT_ALIGNMENT_LOW:['同周期 K 线对齐不足','Insufficient same-interval candle alignment','同週期 K 線對齊不足'],
  SMT_CORRELATION_UNDEFINED:['有效价格变化不足，无法计算收益相关性','Insufficient price variation to calculate return correlation','有效價格變化不足，無法計算收益相關性'],
  SMT_LOW_ACTIVITY:['行情长期缺少有效价格变化','Too many candles have no price change','行情長期缺少有效價格變化'],
  SMT_CORRELATION_LOW:['当前对照市场收益相关性不足','Current comparison return correlation is too low','目前對照市場收益相關性不足'],
  SMT_CORRELATION_UNSTABLE:['历史窗口的收益相关性未稳定达到门槛','Historical return correlation does not consistently meet the threshold','歷史視窗的收益相關性未穩定達到門檻'],
};
export function smtDiagnosticPresentation(d,language='zh-CN') {
  const i=language==='en'?1:['zh-TW','zh-Hant'].includes(language)?2:0;
  const t=code=>(words[code]??words.SMT_SOURCE_UNAVAILABLE)[i];
  const n=v=>Number.isFinite(v)?v.toFixed(3):'—';
  const selected=d.checks.find(c=>c.marketId===d.selectedMarketId)??d.checks[0];
  const details=[
    [ `主市场：${d.primaryMarketId} · ${d.interval}`,`Primary: ${d.primaryMarketId} · ${d.interval}`,`主市場：${d.primaryMarketId} · ${d.interval}` ][i],
    ...d.checks.map(c=>{
      const facts=[`已收盘：主市场 ${c.primaryCount} / 对照 ${c.comparisonCount}；对齐 ${c.alignedCandleCount} 根 / ${(c.alignmentRatio*100).toFixed(1)}%；收益相关系数 ${n(c.correlation)}（≥0.450）`,
        `Closed: primary ${c.primaryCount} / comparison ${c.comparisonCount}; aligned ${c.alignedCandleCount} / ${(c.alignmentRatio*100).toFixed(1)}%; return correlation ${n(c.correlation)} (≥0.450)`,
        `已收盤：主市場 ${c.primaryCount} / 對照 ${c.comparisonCount}；對齊 ${c.alignedCandleCount} 根 / ${(c.alignmentRatio*100).toFixed(1)}%；收益相關係數 ${n(c.correlation)}（≥0.450）`][i];
      const baseline=d.policyVersion==='smt-pairing-v1'?[
        `；历史短／长窗口 ${n(c.shortCorrelation)} / ${n(c.longCorrelation)}`,
        `; historical short/long windows ${n(c.shortCorrelation)} / ${n(c.longCorrelation)}`,
        `；歷史短／長視窗 ${n(c.shortCorrelation)} / ${n(c.longCorrelation)}`][i]:'';
      return `${c.marketId}${c.marketId===d.selectedMarketId?['（已选定）',' (selected)','（已選定）'][i]:''}${i===1?': ':'：'}${t(c.code)}${i===1?'. ':'。'}${facts}${baseline}`;
    }),
  ];
  if(d.policyVersion==='smt-pairing-v1')details[0]+=[
    '。配对依据：同类候选在最近18根信号窗口之前，以80／160根历史收益相关性择优；数据至少60根，对齐率≥85%。',
    '. Selection: rank compatible candidates by 80/160-bar historical return correlation before the latest 18-bar signal window; at least 60 candles and ≥85% alignment.',
    '。配對依據：同類候選在最近18根訊號視窗之前，以80／160根歷史收益相關性擇優；資料至少60根，對齊率≥85%。'][i];
  if(d.venueWarning)details.push([
    `辅助跨场所校验：${t(d.venueWarning)}；不影响已合格的跨资产配对。`,
    `Auxiliary venue check: ${t(d.venueWarning)}; qualified cross-asset pairs remain usable.`,
    `輔助跨場所校驗：${t(d.venueWarning)}；不影響已合格的跨資產配對。`][i]);
  const insufficient=d.code.startsWith('SMT_CORRELATION_')&&selected;
  const metric=d.code==='SMT_CORRELATION_UNSTABLE'&&selected
    ?`${n(selected.shortCorrelation)}, ${n(selected.longCorrelation)}`:n(selected?.correlation);
  const compact=`SMT: ${t(d.code)}${insufficient?` (${metric}; ≥0.450)`:''}`;
  return {summary:t(d.code),compact,details};
}

export function validSmtDiagnostics(d) {
  const boundedText=v=>typeof v==='string'&&v.length<=3000;
  const corr=v=>v===null||Number.isFinite(v)&&v>=-1&&v<=1;
  return d?.version==='smt-diagnostics-v1'&&Object.hasOwn(words,d.code)
    &&boundedText(d.primaryMarketId)&&['smt-pairing-v1','legacy-single-pair'].includes(d.policyVersion)
    &&Number.isFinite(d.snapshotTime)&&Array.isArray(d.checks)&&d.checks.length<=5
    &&d.checks.every(c=>boundedText(c.marketId)&&Object.hasOwn(words,c.code)
      &&['primaryCount','comparisonCount','alignedCandleCount','baselineReturnCount'].every(k=>Number.isSafeInteger(c[k])&&c[k]>=0&&c[k]<=600)
      &&Number.isFinite(c.alignmentRatio)&&c.alignmentRatio>=0&&c.alignmentRatio<=1
      &&[c.correlation,c.shortCorrelation,c.longCorrelation].every(corr))
    &&(d.selectedMarketId===null||d.checks.some(c=>c.marketId===d.selectedMarketId))
    &&boundedText(d.summary)&&boundedText(d.compact)&&Array.isArray(d.details)
    &&d.details.length<=7&&d.details.every(boundedText);
}
