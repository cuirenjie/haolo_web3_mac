import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deduplicateWaveModelEvidence } from "../src/main/trading-analysis/wave-model-evidence.mjs";
import { normalizeTradingMarketSnapshot } from "../src/main/trading-analysis/protocol.mjs";
import { runWaveTheoryEngine } from "../src/main/trading-analysis/wave-engine.mjs";
import { buildWaveModelPrompt, buildWaveAnalysisReport, buildWaveActionPlan, buildWaveDrawingPatch } from "../src/main/trading-analysis/wave-pipeline.mjs";
import { withTradingReportLanguage, localizeTradingAnalysisResult } from "../src/main/trading-analysis/report-language.mjs";
import { buildExecutionPlanV1 } from "../src/main/trading-strategy-runtime/execution-plan-builder.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/complex-wave-timeout.json", import.meta.url)))[0];
function snapshot(count = 100, nested = false) {
  const params = structuredClone(fixture.windowsParams);
  params.candles = params.candles.slice(-count);
  if (nested) params.contextCandles = [{ interval: "15", candles: params.candles.map((c, i) => ({ ...c, time: params.candles[0].time + i * 900 })) }];
  return normalizeTradingMarketSnapshot(params);
}
function decode(encoded) {
  const { encoding, candidateCatalog, ...tree } = encoded;
  function restore(value) {
    if (Array.isArray(value)) return value.map(restore);
    if (!value || typeof value !== "object") return value;
    if (Object.keys(value).length === 1 && value.candidateRef) {
      assert.ok(candidateCatalog[value.candidateRef]);
      return candidateCatalog[value.candidateRef];
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v)]));
  }
  return restore(tree);
}
for (const [count, nested] of [[100, false], [120, true]]) {
  test(`candidate encoding preserves all facts, ordering and degrees: ${count} bars, nested=${nested}`, () => {
    const theory = runWaveTheoryEngine(snapshot(count, nested));
    const before = structuredClone(theory);
    const encoded = deduplicateWaveModelEvidence(theory);
    assert.deepEqual(decode(JSON.parse(JSON.stringify(encoded))), JSON.parse(JSON.stringify(theory)));
    assert.deepEqual(theory, before);
    assert.ok(JSON.stringify(encoded).length < JSON.stringify(theory).length * 0.8);
  });
}
test("same ID with different degree provenance is never merged", () => {
  const one = { id: "same", points: [{ price: 100.123456789 }], sourceRole: "analysis" };
  const two = { ...one, sourceRole: "structure" };
  const structures = { candidates: [one, two], primaryCandidate: one, alternatives: [two] };
  const original = { structures, multiTimeframe: { structure: { structures }, execution: null } };
  const encoded = deduplicateWaveModelEvidence(original);
  assert.equal(Object.keys(encoded.candidateCatalog).length, 2);
  assert.deepEqual(decode(encoded), original);
});
test("full review selects counts without stale preliminary trading levels; direct mode retains its scope", () => {
  const market = snapshot();
  const theory = runWaveTheoryEngine(market);
  const full = buildWaveModelPrompt(market, theory);
  const direct = buildWaveModelPrompt(market, theory, { responseMode: "direct", instruction: "What is the current trigger?" });
  assert.match(full, /"report":""/);
  assert.match(full, /宿主会在选定主候选后重新计算/);
  assert.doesNotMatch(full, /"longTrigger"|"stopBasis"|"shortTrigger"/);
  assert.match(direct, /"longTrigger"/);
  assert.match(direct, /仅属于该候选/);
  const evidence = p => p.split("\n").filter(s => s.startsWith('{"encoding"') || s.startsWith("[["));
  assert.deepEqual(evidence(full), evidence(direct));
  assert.deepEqual(JSON.parse(evidence(full).at(-1)), market.candles.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]));
});
for (const language of ["en", "zh-CN", "zh-TW"]) {
  test(`historical bearish count and conditional bullish rebound remain distinct: ${language}`, async () => {
    const market = snapshot();
    const theory = runWaveTheoryEngine(market);
    const primary = theory.structures.candidates.find(c => c.id === "wave-count-7fff60fe6c691150");
    assert.equal(primary.direction, "bearish");
    const plan = buildWaveActionPlan(market, primary, theory);
    assert.equal(plan.primaryScenario, "bullish");
    assert.equal(plan.longTrigger, 128.52886607142858);
    assert.equal(plan.longInvalidation, 125.94508571428574);
    assert.equal(plan.macroInvalidation, 137.24);
    const execution = buildExecutionPlanV1({ id: "wave", version: "0.4.0" }, { snapshot: market, theoryResult: theory, analysisPlan: { analysisId: "wave-fallback-test", actionPlan: plan } }, { candles: market.candles });
    assert.match(execution.preconditions[0].text, /触发依据来自 1H，止损依据来自 1H/);
    const report = await withTradingReportLanguage(language, () => buildWaveAnalysisReport(market, theory, { primaryCandidateId: primary.id, alternateCandidateIds: ["wave-count-bbe272f54093a4a0", "wave-count-6d58d54db4bc7e9a"] }));
    assert.match(report, language === "en" ? /1h primary count is bearish/ : /主[计計][数數]方向[为為]偏空/);
    assert.ok(report.length > 1000);
    if (language === "en") {
      assert.doesNotMatch(report, /\p{Script=Han}/u);
      assert.doesNotMatch(report, /one validated structural segment/);
      assert.match(report, /internal 5-3-5-3-5: Unconfirmed/);
      assert.doesNotMatch(report, /internal 5-3-5-3-5: failed/);
      assert.match(report, /Historical reference count:.*145\.24\. This count ended before/);
      assert.match(report, /Alternative count:.*119\.76/);
      assert.doesNotMatch(report, /may overlap|If the primary count fails/);
      assert.match(report, /Macro confirmation reference: 128\.4/);
      assert.doesNotMatch(report, /This confirms primary structure/);
      const localized = await withTradingReportLanguage(language, () => localizeTradingAnalysisResult({ analysisPlan: { actionPlan: plan, report, narrative: "" } }, language));
      assert.match(localized.analysisPlan.actionPlan.confirmation, /structure and ATR as fallback/);
      assert.match(localized.analysisPlan.actionPlan.observeTrigger, /derived from 1h/);
      const patch = await withTradingReportLanguage(language, () => buildWaveDrawingPatch(market, theory, { primaryCandidateId: primary.id, alternateCandidateIds: [] }));
      const labels = patch.operations.map(o => o.drawing?.text).filter(Boolean).join("\n");
      assert.match(labels, /1h Long trigger/);
      assert.match(labels, /Structural target T1/);
      assert.doesNotMatch(labels, /5mLong|lower timeframe T1/);
    }
  });
}
