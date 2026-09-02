import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { deterministicGeneralRequestRouting } from "../src/main/trading-analysis/general-request-router.mjs";

const main = fs.readFileSync(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../src/main/preload.mjs", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

test("Trading Expert exposes no direct question-answer or fast-chat transport", () => {
  for (const source of [main, preload, renderer]) {
    assert.doesNotMatch(source, /tradingAnalysis:(?:route|send)FastChat/);
    assert.doesNotMatch(source, /routeTradingExpertFastChat|sendTradingExpertFastChat/);
    assert.doesNotMatch(source, /trading-expert-fast-chat/);
  }
  assert.doesNotMatch(main, /HAOLO_TRADING_EXPERT_FAST_CHAT|handoff_to_agent/);
});

test("the large-model intent classifier remains routing-only before agent dispatch", () => {
  assert.match(main, /tradingAnalysis:classifyGeneralRequest/);
  assert.match(main, /getTradingAnalysisModelRegistry\(\)\.analyze/);
  assert.match(preload, /classifyTradingGeneralRequest/);
  assert.match(renderer, /classifyTradingGeneralRequestForSend|api\.classifyTradingGeneralRequest/);
  assert.match(
    renderer,
    /tradingGeneralRequestAtSend = await classifyTradingGeneralRequestForSend\([\s\S]*?hasTradingExpertCurrentAnalysis\(\)/,
  );
  assert.match(renderer, /await runTradingGeneralChartRequest\(/);
  assert.match(renderer, /await sendAgentText\(/);
  assert.doesNotMatch(main, /classifyGeneralRequest[\s\S]{0,4000}sendProviderChat/);
});

test("reported SNDK and 币安人生 idea prompts enter the chart-and-drawing agent with canonical symbols", () => {
  const cases = [
    ["给我一些做闪迪的思路", "SNDKUSDT"],
    ["给我做币安人生的思路", "币安人生USDT"],
  ];
  for (const [text, symbol] of cases) {
    const routed = deterministicGeneralRequestRouting(text);
    assert.equal(routed?.request.mode, "chart-analysis", text);
    assert.equal(routed?.request.symbol, symbol, text);
    assert.equal(routed?.request.drawingRequested, true, text);
    assert.equal(routed?.classification.source, "deterministic-market-analysis", text);
  }
});

test("non-chart questions still use the root execution agent instead of provider Q&A", () => {
  const concept = deterministicGeneralRequestRouting("什么是移动止损");
  assert.equal(concept?.request.mode, "conversation");
  assert.equal(concept?.request.drawingRequested, false);
  assert.match(renderer, /newThreadModeForThread\(threadId\)[\s\S]*?return isMediaCreationMode\(mode\) \? mode : "execution"/);
});
