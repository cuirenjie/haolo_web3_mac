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
    forecastHorizonMs: null,
  });
  assert.equal(extractExplicitTradingParameters("分析BTCUSDT现在的行情").symbol, "BTCUSDT");
  assert.equal(extractExplicitTradingParameters("分析币安人生USDT现在的行情").symbol, "币安人生USDT");
  assert.deepEqual(extractExplicitTradingParameters("SNDK 15min 怎么看"), {
    symbol: "SNDKUSDT",
    interval: "15",
    lookbackMs: null,
    lookbackLabel: null,
    forecastHorizonMs: null,
  });
  assert.deepEqual(extractExplicitTradingParameters("帮我分析SNDK一小时走势"), {
    symbol: "SNDKUSDT",
    interval: "60",
    lookbackMs: null,
    lookbackLabel: null,
    forecastHorizonMs: null,
  });
  assert.deepEqual(extractExplicitTradingParameters("分析 BTC 四小时走势"), {
    symbol: "BTCUSDT",
    interval: "240",
    lookbackMs: null,
    lookbackLabel: null,
    forecastHorizonMs: null,
  });
  assert.deepEqual(extractExplicitTradingParameters("分析SNDK走势"), {
    symbol: "SNDKUSDT",
    interval: null,
    lookbackMs: null,
    lookbackLabel: null,
    forecastHorizonMs: null,
  });
  assert.deepEqual(extractExplicitTradingParameters("分析SNDK永续一小时走势"), {
    symbol: "SNDKUSDT",
    interval: "60",
    lookbackMs: null,
    lookbackLabel: null,
    forecastHorizonMs: null,
  });
  assert.deepEqual(extractExplicitTradingParameters("分析 SNDK 现货四小时走势"), {
    symbol: "SNDKUSDT",
    interval: "240",
    lookbackMs: null,
    lookbackLabel: null,
    forecastHorizonMs: null,
  });
});

test("named commodity and equity aliases resolve to their canonical USDT markets", () => {
  const aliases = new Map([
    ["布伦特原油", "BZUSDT"],
    ["WTI原油", "CLUSDT"],
    ["美光", "MUUSDT"],
    ["闪迪", "SNDKUSDT"],
    ["海力士", "SKHYNIXUSDT"],
    ["英伟达", "NVDAUSDT"],
    ["特斯拉", "TSLAUSDT"],
  ]);

  for (const [name, symbol] of aliases) {
    assert.equal(extractExplicitTradingParameters(name).symbol, symbol, name);
    assert.equal(extractExplicitTradingParameters(`帮我分析${name}一小时走势`).symbol, symbol, name);
    assert.equal(isExplicitMarketAnalysisRequest(name), true, name);
    assert.equal(deterministicMarketChartRouting(name)?.request.symbol, symbol, name);
  }

  assert.equal(extractExplicitTradingParameters("分析 wti 原油四小时走势").symbol, "CLUSDT");
  assert.equal(extractExplicitTradingParameters("分析英偉達当前行情").symbol, "NVDAUSDT");
  assert.equal(extractExplicitTradingParameters("看看閃迪现在能不能做多").symbol, "SNDKUSDT");
});

test("extended commodity and equity Chinese aliases share the canonical market resolver", () => {
  const aliases = new Map([
    ["黄金", "XAUUSDT"],
    ["白银", "XAGUSDT"],
    ["铂金", "XPTUSDT"],
    ["钯金", "XPDUSDT"],
    ["铜", "COPPERUSDT"],
    ["天然气", "NATGASUSDT"],
    ["英特尔", "INTCUSDT"],
    ["罗宾汉", "HOODUSDT"],
    ["微策略", "MSTRUSDT"],
    ["亚马逊", "AMZNUSDT"],
    ["帕兰泰尔", "PLTRUSDT"],
    ["微软", "MSFTUSDT"],
    ["博通", "AVGOUSDT"],
    ["阿里巴巴", "BABAUSDT"],
    ["摩根大通", "JPMUSDT"],
    ["西部数据", "WDCUSDT"],
    ["太空探索", "SPCXUSDT"],
    ["伯克希尔", "BRKBUSDT"],
    ["苹果", "AAPLUSDT"],
    ["谷歌", "GOOGLUSDT"],
  ]);

  for (const [name, symbol] of aliases) {
    assert.equal(extractExplicitTradingParameters(name).symbol, symbol, name);
    assert.equal(extractExplicitTradingParameters(`分析${name}四小时走势`).symbol, symbol, name);
    assert.equal(isExplicitMarketAnalysisRequest(name), true, name);
    assert.equal(deterministicMarketChartRouting(name)?.request.symbol, symbol, name);
  }

  assert.equal(extractExplicitTradingParameters("看看黃金一小时盘面").symbol, "XAUUSDT");
  assert.equal(extractExplicitTradingParameters("分析天然氣当前走势").symbol, "NATGASUSDT");
  assert.equal(extractExplicitTradingParameters("分析蘋果日线").symbol, "AAPLUSDT");
  assert.equal(extractExplicitTradingParameters("看看伯克希爾现在怎么样").symbol, "BRKBUSDT");
});

test("strategy invocation uses the shared semantic fallback and drawing defaults", () => {
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
    forecastHorizonMs: null,
    questionKinds: ["general"],
    drawingRequested: true,
  });

  const noDrawing = deterministicStrategyChartRouting(
    "@策略:ICT/SMC 分析 BTC 1 小时，不要画线",
    manifest,
  );
  assert.equal(noDrawing.mode, "chart-analysis");
  assert.equal(noDrawing.drawingRequested, false);

  const exactIncident = deterministicStrategyChartRouting(
    "@策略:ICT/SMC 帮我分析SNDK一小时走势",
    manifest,
  );
  assert.equal(exactIncident.symbol, "SNDKUSDT");
  assert.equal(exactIncident.interval, "60");

  const periodOnlyIncident = deterministicStrategyChartRouting(
    "@策略:ICT/SMC 分析4小时",
    manifest,
  );
  assert.equal(periodOnlyIncident.mode, "chart-analysis");
  assert.equal(periodOnlyIncident.symbol, null);
  assert.equal(periodOnlyIncident.interval, "240");
  assert.equal(periodOnlyIncident.drawingRequested, true);

  const forecastOnlyIncident = deterministicStrategyChartRouting(
    "@策略:ICT/SMC 分析未来4小时走势",
    manifest,
  );
  assert.equal(forecastOnlyIncident.mode, "chart-analysis");
  assert.equal(forecastOnlyIncident.interval, null);
  assert.equal(forecastOnlyIncident.forecastHorizonMs, 4 * 60 * 60 * 1_000);

  const concept = deterministicStrategyChartRouting(
    "@策略:ICT/SMC 什么是 FVG",
    manifest,
  );
  assert.equal(concept.mode, "conversation");
  assert.equal(concept.drawingRequested, false);
});

test("natural-language strategy instructions never become synthetic USDT markets", () => {
  const incidents = [
    {
      text: "@策略:裸K分析 看下走势跟给出开单点位",
      instruction: "看下走势跟给出开单点位",
      manifest: { mentions: { canonical: "裸K分析", aliases: ["裸K"] }, display: { name: "裸K分析" } },
    },
    {
      text: "@策略:道氏理论 分析下一个小时是多还是空",
      instruction: "分析下一个小时是多还是空",
      manifest: { mentions: { canonical: "道氏理论", aliases: ["道氏"] }, display: { name: "道氏理论" } },
    },
  ];

  for (const incident of incidents) {
    assert.deepEqual(extractExplicitTradingParameters(incident.instruction), {
      symbol: null,
      interval: null,
      lookbackMs: null,
      lookbackLabel: null,
      forecastHorizonMs: incident.instruction.includes("下一个小时") ? 3_600_000 : null,
    });
    const routed = deterministicStrategyChartRouting(incident.text, incident.manifest);
    assert.equal(routed.mode, "chart-analysis");
    assert.equal(routed.instruction, incident.instruction);
    assert.equal(routed.symbol, null);
    assert.equal(routed.interval, null);
    assert.equal(routed.drawingRequested, true);
  }

  assert.equal(
    extractExplicitTradingParameters("分析下一个小时是多还是空").forecastHorizonMs,
    3_600_000,
  );

  for (const instruction of [
    "帮我看看当前走势",
    "分析盘面并给出入场点位",
    "看下未来一个小时怎么走",
    "分析下多还是空",
    "分析未来一小时走势",
    "分析下一个小时走势",
    "分析接下来一小时涨还是跌",
    "帮我判断现在该做多还是做空",
    "看下这个币未来走势",
    "预测后续一小时多空方向",
    "看看走势USDT",
  ]) {
    assert.equal(extractExplicitTradingParameters(instruction).symbol, null, instruction);
  }

  assert.equal(extractExplicitTradingParameters("分析币安人生USDT现在的行情").symbol, "币安人生USDT");
  assert.equal(extractExplicitTradingParameters("分析龙虾/USDT一小时走势").symbol, "龙虾USDT");
  assert.equal(extractExplicitTradingParameters("分析比特币现在的行情").symbol, "BTCUSDT");
});

test("natural-language market analysis routes to chart while pure education stays conversational", () => {
  for (const text of [
    "分析SNDK 15min这个盘面",
    "那我现在做多可以吗",
    "我目前的仓位健康吗，该怎么操作",
    "分析附件里的当前行情并标注关键位",
    "分析币安人生的 1 小时 K 线",
    "分析4小时",
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
    "4小时K线和1小时K线有什么区别？",
    "查看我的账户余额和交易记录",
  ]) {
    assert.equal(isExplicitMarketAnalysisRequest(text), false, text);
    assert.equal(deterministicMarketChartRouting(text), null, text);
  }
});
