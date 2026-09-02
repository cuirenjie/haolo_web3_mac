import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const marketSource = readFile(new URL("../src/renderer/trading-expert-market.ts", import.meta.url), "utf8");
const stylesSource = readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("trading chart sends capture an immutable target before any model classification await", async () => {
  const source = await mainSource;
  const send = sourceBlock(source, "async function sendCurrentMessage", "async function sendCurrentProviderMessage");
  const capture = send.indexOf("captureTradingExpertAnalysisTarget()");
  const onboardingAwait = send.indexOf("await handleTradingPreferenceOnboardingReply");
  const strategyClassification = send.indexOf("await classifyTradingStrategyForSend");
  const generalClassification = send.indexOf("await classifyTradingGeneralRequestForSend");

  assert.ok(capture >= 0, "the send path must capture its chart target");
  assert.ok(capture < onboardingAwait, "the chart target must be frozen before onboarding can yield");
  assert.ok(capture < strategyClassification, "the chart target must be frozen before strategy classification");
  assert.ok(capture < generalClassification, "the chart target must be frozen before general classification");
  assert.match(send, /tradingStrategyAnalysisTargetByRequest\.set\([\s\S]*?tradingAnalysisTargetAtSend/);
  assert.match(send, /runTradingStrategyChartRequest\(threadId, tradingStrategyAtSend, tradingStrategyRequestAtSend\)/);
  assert.match(send, /runTradingGeneralChartRequest\([\s\S]*?tradingAnalysisTargetAtSend/);
  assert.match(send, /rebindTradingExpertAnalysisTargetStorageSession\([\s\S]*?threadId/);
  assert.match(send, /finally \{[\s\S]*?releaseTradingExpertAnalysisTarget\(tradingAnalysisTargetAtSend\)/);
});

test("the captured target freezes market, interval, visible candles, and conversation storage identity", async () => {
  const source = await marketSource;
  const capture = sourceBlock(
    source,
    "captureAnalysisTaskTarget(): TradingAnalysisTaskTarget | null",
    "personalStrategyCandles()",
  );

  assert.match(capture, /loadedContextMatches = this\.loadedMarketId === this\.selectedMarketId/);
  assert.match(capture, /storageSessionId: this\.drawingStorageSessionId/);
  assert.match(capture, /marketId: market\.id/);
  assert.match(capture, /symbol: market\.symbol/);
  assert.match(capture, /interval: this\.activeInterval/);
  assert.match(capture, /capturedAt: Date\.now\(\)/);
  assert.match(capture, /candles: Object\.freeze\(candles\.map\(freezeCandle\)\)/);
  assert.match(capture, /visibleCandles: Object\.freeze\(visibleCandles\.map\(freezeCandle\)\)/);
  assert.match(capture, /return Object\.freeze\(/);
});

test("price-action execution consumes the send snapshot and persists drawings to its original task", async () => {
  const source = await marketSource;
  const generalRun = sourceBlock(source, "async runGeneralConversation(", "async runChanConversation(");
  const drawingCommit = sourceBlock(
    source,
    "async function commitTradingAnalysisDrawingPatch",
    "async function commitTradingIndicatorAnalysisDrawingPatch",
  );

  assert.match(generalRun, /const capturedTarget = request\.analysisTarget \|\| null/);
  assert.match(generalRun, /capturedTarget!\.candles\.map/);
  assert.match(generalRun, /capturedTarget!\.visibleCandles\.map/);
  assert.match(generalRun, /storageSessionId: capturedTarget\?\.storageSessionId \|\| this\.drawingStorageSessionId/);
  assert.match(generalRun, /marketId: targetMarket\.id/);
  assert.match(generalRun, /interval: targetInterval/);
  assert.match(generalRun, /snapshotTime: capturedTarget\?\.capturedAt \|\| Date\.now\(\)/);
  assert.match(generalRun, /useCapturedTarget[\s\S]*?snapshots: \[\] as TradingSplitPaneAnalysisSnapshot\[\]/);

  assert.match(drawingCommit, /patch\.marketId !== currentJob\.marketId \|\| patch\.interval !== currentJob\.interval/);
  assert.match(drawingCommit, /activeWorkspace\?\.drawingStorageSessionMatches\(currentJob\.storageSessionId\)/);
  assert.match(drawingCommit, /persistTradingAiDrawingPatch\(storageSessionId, patch\)/);
  assert.ok(
    drawingCommit.indexOf("persistTradingAiDrawingPatch(storageSessionId, patch)")
      > drawingCommit.indexOf("if (targetWorkspace)"),
    "background drawing persistence must not depend on the target conversation being visible",
  );
});

test("conversation rows enter a theme-safe running state during submission and strategy thinking", async () => {
  const source = await mainSource;
  const styles = await stylesSource;
  const working = sourceBlock(source, "function isConversationThreadWorking", "function isComposerThreadBusy");
  const spinner = sourceBlock(styles, ".conversation-row-spinner", "@keyframes conversation-row-spin");

  assert.match(working, /submittingComposerThreadIds\.has\(threadId\)/);
  assert.match(working, /tradingExpertThinkingStateByThreadId\.has\(threadId\)/);
  assert.match(spinner, /border: 2px solid rgba\(148, 163, 184, 0\.35\)/);
  assert.match(spinner, /border-top-color: var\(--text-muted\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.conversation-row-wrap\.conversation-row-minimal\.active/);
});

test("a background analysis cannot clear the composer of the conversation the user switched to", async () => {
  const source = await mainSource;
  const clearComposer = sourceBlock(
    source,
    "function clearTradingExpertComposerAfterSend",
    "function tradingExpertThinkingStage",
  );

  assert.match(clearComposer, /const resolvedThreadId = resolveTradingExpertAnalysisThreadId\(threadId\)/);
  assert.match(
    clearComposer,
    /state\.currentThreadId !== threadId && state\.currentThreadId !== resolvedThreadId[\s\S]*?return/,
  );
  assert.ok(
    clearComposer.indexOf("return;") < clearComposer.indexOf('state.composerText = ""'),
    "the ownership guard must run before any active composer state is mutated",
  );
});
