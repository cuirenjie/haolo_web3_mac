const analysisFiles = Object.freeze([
  'app-server-provider.mjs', 'diagnostics.mjs',
  'failure.mjs',  'model-budget.mjs', 'model-provider.mjs',
  'user-constraints.mjs', 'strategy-selection.mjs',
]);
const cloudFiles = Object.freeze([
  'cloud-alert-feed.mjs', 'cloud-catalog.mjs', 'cloud-entry-result.mjs', 'cloud-error.mjs',
  'cloud-plans.mjs', 'cloud-run-journal.mjs', 'cloud-runtime.mjs', 'cloud-right-result.mjs',
  'run-event-stream.mjs', 'market-recovery.mjs', 'admission-recovery.mjs', 'cloud-task-chat.mjs', 'cloud-task-history.mjs',
]);
function forbiddenPath(value) {
  const name=String(value).replaceAll('\\','/').replace(/^\/+/, '');
  if (/(^|\/)trading-strategies\//i.test(name)) return true;
  if (/(^|\/)trading-preference-compiler\.mjs$/i.test(name)) return true;
  for (const [dir,allowed] of [['trading-analysis',analysisFiles],['trading-strategy-runtime',cloudFiles]]) {
    const marker=`src/main/${dir}/`,index=name.indexOf(marker);
    if(index>=0 && !allowed.includes(name.slice(index+marker.length))) return true;
  }
  return false;
}
// Stable identifiers and prompt sentences unique to private implementations.
// Public chart indicators, UI routing and user-authored strategy execution remain permitted.
const privateMarkers=Object.freeze([
  'runTradingChanAnalysisPipeline', 'runTradingWaveAnalysisPipeline', 'runTradingWyckoffAnalysisPipeline',
  'runTradingOrderFlowAnalysisPipeline', 'runTradingHarmonicAnalysisPipeline', 'runTradingPriceActionStrategyPipeline',
  'runTradingGannTheoryPipeline', 'runTradingDowTheoryPipeline', 'runTradingIctSmcPipeline', 'runTradingSmtDivergencePipeline',
  'runMovingAverageAnalysisPipeline', 'runMacdAnalysisPipeline', 'runKdjAnalysisPipeline', 'runRsiAnalysisPipeline',
  'runBollingerBandsAnalysisPipeline', 'runVpvrAnalysisPipeline', 'buildExecutionPlanV1', 'BUILTIN_TRADING_STRATEGY_ADAPTERS',
  '标准推动浪只有在完整 0-1-2-3-4-5', '你是 Haolo 交易偏好的只读语义编译器',
]);
function sensitiveAsset(name, source) {
  const base=String(name).replaceAll('\\','/').split('/').at(-1).toLowerCase();
  if(['haolo-session.json','haolo-evsign-license.json'].includes(base)||/^\.env(?:\.|$)/.test(base))return true;
  if(base==='auth.json') {
    // The bundled blank template is allowed, never a developer's login.
    try {const value=JSON.parse(source);if(!value||Array.isArray(value)||typeof value!=='object'
      ||Object.values(value).some(v=>v!==null&&v!==''))return true;}catch{return true;}
  }
  return /["']sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}["']/.test(source)
    ||/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{48,}-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(source);
}
module.exports={analysisFiles,cloudFiles,forbiddenPath,privateMarkers,sensitiveAsset};
