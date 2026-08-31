import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicMarketChartRouting,
  deterministicStrategyChartRouting,
  extractExplicitTradingParameters,
  isExplicitMarketAnalysisRequest,
  normalizeTradingRoutingText,
} from "../src/main/trading-analysis/request-routing-policy.mjs";

test("routing text repair keeps a broken Chinese market request and its parameters intact", () => {
  const text = "@策略：ICT / SMC 分析SNDK 15min这个盘\r面并绘图，生成交易策略";
  assert.equal(
    normalizeTradingRoutingText(text),
    "@策略:ICT/SMC 分析SNDK 15min这个盘面并绘图，生成交易策略",
  );
  assert.deepEqual(extractExplicitTradingParameters(text), {
    symbol: "SNDKUSDT",
    interval: "15",
    lookbackMs: null,
    lookbackLabel: null,
  });
  assert.equal(extractExplicitTradingParameters("分析BTCUSDT现在的行情").symbol, "BTCUSDT");
  assert.equal(extractExplicitTradingParameters("分析币安人生USDT现在的行情").symbol, "币安人生USDT");
  assert.deepEqual(extractExplicitTradingParameters("SNDK 15min 怎么看"), {
    symbol: "SNDKUSDT",
    interval: "15",
    lookbackMs: null,
    lookbackLabel: null,
  });
});

test("strategy invocation is an unconditional chart command with drawing enabled by default", () => {
  const manifest = {
    mentions: { canonical: "ICT/SMC", aliases: ["ICT"] },
    display: { name: "ICT / SMC" },
  };
  const routed = deterministicStrategyChartRouting(
    "@策略:ICT / SMC 分析SNDK 15min这个盘\r面并绘图，生成交易策略",
    manifest,
  );
  assert.deepEqual(routed, {
    mode: "chart-analysis",
    instruction: "分析SNDK 15min这个盘面并绘图，生成交易策略",
    symbol: "SNDKUSDT",
    interval: "15",
    lookbackMs: null,
    lookbackLabel: null,
    drawingRequested: true,
  });

  const noDrawing = deterministicStrategyChartRouting(
    "@策略:ICT/SMC 分析 BTC 1 小时，不要画线",
    manifest,
  );
  assert.equal(noDrawing.mode, "chart-analysis");
  assert.equal(noDrawing.drawingRequested, false);
});

test("natural-language market analysis routes to chart while pure education stays conversational", () => {
  for (const text of [
    "分析SNDK 15min这个盘面",
    "那我现在做多可以吗",
    "我目前的仓位健康吗，该怎么操作",
    "分析附件里的当前行情并标注关键位",
    "分析币安人生的 1 小时 K 线",
    "SNDK走势怎么看",
    "SNDK 支撑位在哪",
    "看一下 SNDK 当前行情",
    "SNDK怎么样",
    "比特币现在怎么样",
    "SNDK",
  ]) {
    assert.equal(isExplicitMarketAnalysisRequest(text), true, text);
    const routed = deterministicMarketChartRouting(text);
    assert.equal(routed?.request.mode, "chart-analysis", text);
    assert.equal(routed?.request.drawingRequested, true, text);
  }

  assert.equal(extractExplicitTradingParameters("SNDK走势怎么看").symbol, "SNDKUSDT");
  assert.equal(extractExplicitTradingParameters("SNDK 支撑位在哪").symbol, "SNDKUSDT");
  assert.equal(extractExplicitTradingParameters("看一下 SNDK 当前行情").symbol, "SNDKUSDT");
  assert.equal(extractExplicitTradingParameters("SNDK怎么样").symbol, "SNDKUSDT");
  assert.equal(extractExplicitTradingParameters("比特币现在怎么样").symbol, "BTCUSDT");
  assert.equal(extractExplicitTradingParameters("SNDK").symbol, "SNDKUSDT");

  for (const text of [
    "什么是移动止损",
    "支撑位和压力位有什么区别？",
    "推荐一个适合新手学习的交易策略",
    "查看我的账户余额和交易记录",
  ]) {
    assert.equal(isExplicitMarketAnalysisRequest(text), false, text);
    assert.equal(deterministicMarketChartRouting(text), null, text);
  }
});
