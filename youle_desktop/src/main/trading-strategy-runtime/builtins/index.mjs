import { bollingerBandsAnalysisStrategyAdapter } from "./bollinger-bands-analysis-adapter.mjs";
import { chanStrategyAdapter } from "./chan-adapter.mjs";
import { chartPatternsStrategyAdapter } from "./chart-patterns-adapter.mjs";
import { dowTheoryStrategyAdapter } from "./dow-theory-adapter.mjs";
import { gannTheoryStrategyAdapter } from "./gann-theory-adapter.mjs";
import { harmonicStrategyAdapter } from "./harmonic-adapter.mjs";
import { ictSmcStrategyAdapter } from "./ict-smc-adapter.mjs";
import { kdjAnalysisStrategyAdapter } from "./kdj-analysis-adapter.mjs";
import { macdAnalysisStrategyAdapter } from "./macd-analysis-adapter.mjs";
import { movingAverageAnalysisStrategyAdapter } from "./moving-average-analysis-adapter.mjs";
import { orderFlowStrategyAdapter } from "./order-flow-adapter.mjs";
import { priceActionStrategyAdapter } from "./price-action-adapter.mjs";
import { rsiAnalysisStrategyAdapter } from "./rsi-analysis-adapter.mjs";
import { smtDivergenceStrategyAdapter } from "./smt-divergence-adapter.mjs";
import { vpvrAnalysisStrategyAdapter } from "./vpvr-analysis-adapter.mjs";
import { waveStrategyAdapter } from "./wave-adapter.mjs";
import { wyckoffStrategyAdapter } from "./wyckoff-adapter.mjs";

export const BUILTIN_TRADING_STRATEGY_ADAPTERS = Object.freeze([
  chanStrategyAdapter,
  orderFlowStrategyAdapter,
  ictSmcStrategyAdapter,
  smtDivergenceStrategyAdapter,
  waveStrategyAdapter,
  wyckoffStrategyAdapter,
  harmonicStrategyAdapter,
  chartPatternsStrategyAdapter,
  priceActionStrategyAdapter,
  dowTheoryStrategyAdapter,
  gannTheoryStrategyAdapter,
  movingAverageAnalysisStrategyAdapter,
  macdAnalysisStrategyAdapter,
  bollingerBandsAnalysisStrategyAdapter,
  rsiAnalysisStrategyAdapter,
  kdjAnalysisStrategyAdapter,
  vpvrAnalysisStrategyAdapter,
]);
