// Pair qualification is deterministic and uses only the frozen input window.
export const SMT_PAIRING_VERSION = 'smt-pairing-v1';
export const SMT_DIAGNOSTICS_VERSION = 'smt-diagnostics-v1';
export const SMT_LIMITS = Object.freeze({minimumCandles:60, alignmentRatio:0.85, correlation:0.45,
  signalWindow:18, shortWindow:80, longWindow:160, staleBars:2, maximumInactiveRatio:0.8});

export function smtIntervalSeconds(interval) {
  const value=String(interval||'').toUpperCase();
  if(value==='1D')return 86400;
  if(value==='1W')return 604800;
  return Math.max(60,Number(value)*60||3600);
}

export function smtClosedCandles(candles,interval,snapshotTime) {
  const step=smtIntervalSeconds(interval);
  return [...new Map((Array.isArray(candles)?candles:[]).filter(c=>
    ['time','open','high','low','close','volume'].every(k=>Number.isFinite(c[k])) && c.time>0 && c.low>0
    && c.high>=Math.max(c.open,c.close,c.low) && c.low<=Math.min(c.open,c.close)
    && c.volume>=0 && c.time*1000+step*1000<=snapshotTime).map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
}

export function smtCorrelation(a,b) {
  if(a.length<30||a.length!==b.length)return null;
  const ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length;
  let sum=0,va=0,vb=0;
  for(let i=0;i<a.length;i++){const da=a[i]-ma,db=b[i]-mb;sum+=da*db;va+=da*da;vb+=db*db;}
  return va*vb>Number.EPSILON**2?Math.max(-1,Math.min(1,sum/Math.sqrt(va*vb))):null;
}

function windowStats(pairs,step) {
  const a=[],b=[];
  for(let i=1;i<pairs.length;i++) {
    if(pairs[i][0].time-pairs[i-1][0].time!==step)continue;
    a.push(Math.log(pairs[i][0].close/pairs[i-1][0].close));
    b.push(Math.log(pairs[i][1].close/pairs[i-1][1].close));
  }
  return {correlation:smtCorrelation(a,b),returnCount:a.length,
    inactiveRatio:a.length?Math.max(a.filter(v=>v===0).length,b.filter(v=>v===0).length)/a.length:1};
}

export function qualifySmtPair(snapshot,market,{stable=false}={}) {
  const p=smtClosedCandles(snapshot.candles,snapshot.interval,snapshot.snapshotTime);
  const c=smtClosedCandles(market.candles,snapshot.interval,snapshot.snapshotTime);
  const byTime=new Map(c.map(v=>[v.time,v]));
  const pairs=p.filter(v=>byTime.has(v.time)).map(v=>[v,byTime.get(v.time)]);
  const step=smtIntervalSeconds(snapshot.interval);
  const latest=windowStats(pairs.slice(-160),step);
  // Exclude the whole signal search window when selecting the comparison.
  const cutoff=p.at(-1-SMT_LIMITS.signalWindow)?.time;
  const background=pairs.filter(v=>v[0].time<=cutoff);
  const short=windowStats(background.slice(-80),step),long=windowStats(background.slice(-160),step);
  const check={marketId:market.marketId,symbol:market.symbol,source:market.source,
    primaryCount:p.length,comparisonCount:c.length,alignedCandleCount:pairs.length,
    alignmentRatio:p.length?pairs.length/p.length:0,correlation:latest.correlation,
    shortCorrelation:short.correlation,longCorrelation:long.correlation,
    baselineReturnCount:long.returnCount,selectionCutoff:cutoff??null,
    lastComparisonTime:c.at(-1)?.time??null,code:'SMT_PAIR_QUALIFIED'};
  if(market.failureCode)check.code=market.failureCode;
  else if(p.length<60)check.code='SMT_PRIMARY_HISTORY_SHORT';
  else if(c.length<60)check.code='SMT_COMPARISON_HISTORY_SHORT';
  else if(snapshot.snapshotTime/1000-p.at(-1).time-step>2*step)check.code='SMT_PRIMARY_STALE';
  else if(snapshot.snapshotTime/1000-c.at(-1).time-step>2*step)check.code='SMT_COMPARISON_STALE';
  else if(pairs.length<60||check.alignmentRatio<0.85)check.code='SMT_ALIGNMENT_LOW';
  else if(latest.correlation===null)check.code='SMT_CORRELATION_UNDEFINED';
  else if(stable&&latest.inactiveRatio>0.8)check.code='SMT_LOW_ACTIVITY';
  else if(stable&&(background.length<SMT_LIMITS.longWindow||short.returnCount<59||long.returnCount<59))check.code='SMT_BASELINE_HISTORY_SHORT';
  else if(stable&&(short.correlation===null||long.correlation===null))check.code='SMT_CORRELATION_UNDEFINED';
  else if(stable&&(short.correlation<0.45||long.correlation<0.45))check.code='SMT_CORRELATION_UNSTABLE';
  else if(latest.correlation<0.45)check.code='SMT_CORRELATION_LOW';
  return {check,primary:pairs.map(v=>v[0]),comparison:pairs.map(v=>v[1])};
}

export function selectSmtPair(snapshot,markets,context=null) {
  const stable=context?.policyVersion===SMT_PAIRING_VERSION;
  const candidates=markets.filter(m=>m.kind==='correlated-market').slice(0,5);
  const evaluated=candidates.map(m=>({market:m,...qualifySmtPair(snapshot,m,{stable})}));
  const qualified=evaluated.filter(v=>v.check.code==='SMT_PAIR_QUALIFIED'
    ||stable&&v.check.code==='SMT_CORRELATION_LOW'&&v.check.shortCorrelation>=0.45&&v.check.longCorrelation>=0.45);
  if(stable)qualified.sort((a,b)=>
    Math.min(b.check.shortCorrelation,b.check.longCorrelation)-Math.min(a.check.shortCorrelation,a.check.longCorrelation)
    ||a.market.marketId.localeCompare(b.market.marketId));
  const chosen=qualified[0]??null;
  const selected=chosen?.check.code==='SMT_PAIR_QUALIFIED'?chosen:null;
  const diagnostic={version:SMT_DIAGNOSTICS_VERSION,policyVersion:stable?SMT_PAIRING_VERSION:'legacy-single-pair',
    primaryMarketId:snapshot.marketId,interval:snapshot.interval,snapshotTime:snapshot.snapshotTime,
    selectedMarketId:chosen?.market.marketId??null,
    code:selected?'SMT_PAIR_QUALIFIED':chosen?.check.code??evaluated[0]?.check.code??context?.failureCode??'SMT_COMPARISON_MISSING',
    ...(context?.venueWarning?{venueWarning:context.venueWarning}:{}),
    limits:SMT_LIMITS,checks:evaluated.map(v=>v.check)};
  return {selected,representative:chosen??evaluated[0]??null,diagnostic};
}
