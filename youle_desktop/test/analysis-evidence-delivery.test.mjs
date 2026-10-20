import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers/cloud-renderer-harness.mjs";
import { OFFICIAL_TRADING_CATALOG } from "../src/shared/official-trading-catalog.mjs";
import { analysisEvidence } from "../src/main/codex-analysis-evidence.mjs";

for (const strategy of OFFICIAL_TRADING_CATALOG.filter(s => s.enabled)) {
  test(`${strategy.id}: position/direct questions receive full report, never the scan notification`, async () => {
    const s = setup();
    s.workspace.splitPanes = [];
    if (strategy.id === "vpvr-analysis") {
      s.workspace.candles = Array.from({ length: 80 }, (_, i) => ({ time: 1700000000 + i * 3600 }));
    }
    const captured = s.workspace.captureAnalysisTaskTarget();
    const result = await s.workspace.runGeneralConversation({
      sourceThreadId: "origin", analysisTarget: captured,
      instruction: "Review the actual position and explain whether to add or reduce",
      positionManagementRequested: true, drawingRequested: false, deferPresentation: true,
    }, strategy.id);
    assert.equal(result.report, "Canonical server report");
    assert.notEqual(result.report, result.narrative);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].positionManagementRequested, true);
    assert.equal(s.drawings.length, 0);
  });
}

test("ordinary general direct requests also receive the full evidence and do not implicitly draw", async () => {
  const s = setup();
  const result = await s.workspace.runGeneralConversation({
    instruction: "Why did the market rise?", drawingRequested: false, deferPresentation: true,
    analysisTarget: s.workspace.captureAnalysisTaskTarget(),
  });
  assert.equal(result.report, "Canonical server report");
  assert.deepEqual(s.drawings, []);
});

test("empty cloud text cannot displace an available complete report", () => {
  assert.equal(analysisEvidence({ report: "Complete body", cloudReports: [{ report: " " }] }).report, "Complete body");
  assert.equal(analysisEvidence({ report: "Scan done", cloudReports: [{ report: "Complete body" }] }).report, "Complete body");
});
