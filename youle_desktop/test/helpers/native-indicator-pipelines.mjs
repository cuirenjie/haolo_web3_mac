// Exercise deterministic indicator facts independently of the combined model review.
import { runMovingAverageAnalysisPipeline } from "../../src/main/trading-analysis/moving-average-analysis-pipeline.mjs";
import { runMacdAnalysisPipeline } from "../../src/main/trading-analysis/macd-analysis-pipeline.mjs";
import { runBollingerBandsAnalysisPipeline } from "../../src/main/trading-analysis/bollinger-bands-analysis-pipeline.mjs";
import { runRsiAnalysisPipeline } from "../../src/main/trading-analysis/rsi-analysis-pipeline.mjs";
import { runKdjAnalysisPipeline } from "../../src/main/trading-analysis/kdj-analysis-pipeline.mjs";
import { runVpvrAnalysisPipeline } from "../../src/main/trading-analysis/vpvr-analysis-pipeline.mjs";

export const nativeIndicatorPipelines = {
  "moving-average-analysis": runMovingAverageAnalysisPipeline,
  "macd-analysis": runMacdAnalysisPipeline,
  "bollinger-bands-analysis": runBollingerBandsAnalysisPipeline,
  "rsi-analysis": runRsiAnalysisPipeline,
  "kdj-analysis": runKdjAnalysisPipeline,
  "vpvr-analysis": runVpvrAnalysisPipeline,
};
