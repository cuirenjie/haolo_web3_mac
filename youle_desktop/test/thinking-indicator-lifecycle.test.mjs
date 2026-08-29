import assert from "node:assert/strict";
import test from "node:test";

import {
  activeThinkingResponseId,
  isFinalAnswerForThinkingResponse,
} from "../src/renderer/thinking-indicator.ts";

test("provider fast chat owns the thinking lifecycle even when a previous Codex turn remains", () => {
  const responseId = activeThinkingResponseId({
    providerBusy: true,
    providerInteractionId: "trading-fast-chat-current",
    codexBusy: true,
    codexTurnId: "chart-analysis-previous",
  });

  assert.equal(responseId, "trading-fast-chat-current");
  assert.equal(isFinalAnswerForThinkingResponse(responseId, {
    responseId: "chart-analysis-previous",
    isFinalAnswer: true,
    hasRenderableContent: true,
  }), false);
  assert.equal(isFinalAnswerForThinkingResponse(responseId, {
    responseId: "trading-fast-chat-current",
    isFinalAnswer: true,
    hasRenderableContent: true,
  }), true);
});

test("a provider request without an interaction id keeps thinking visible instead of using stale work", () => {
  assert.equal(activeThinkingResponseId({
    providerBusy: true,
    providerInteractionId: null,
    codexBusy: true,
    codexTurnId: "chart-analysis-previous",
    workflowRunId: "workflow-previous",
  }), null);
});

test("Codex and workflow responses retain their own exact identities", () => {
  assert.equal(activeThinkingResponseId({
    providerBusy: false,
    codexBusy: true,
    codexTurnId: "turn-current",
    workflowRunId: "workflow-current",
  }), "turn-current");
  assert.equal(activeThinkingResponseId({
    providerBusy: false,
    codexBusy: false,
    workflowRunId: "workflow-current",
  }), "workflow-current");
});

test("unscoped, commentary, and empty items cannot dismiss the thinking bubble", () => {
  const responseId = "turn-current";
  assert.equal(isFinalAnswerForThinkingResponse(responseId, {
    responseId: null,
    isFinalAnswer: true,
    hasRenderableContent: true,
  }), false);
  assert.equal(isFinalAnswerForThinkingResponse(responseId, {
    responseId,
    isFinalAnswer: false,
    hasRenderableContent: true,
  }), false);
  assert.equal(isFinalAnswerForThinkingResponse(responseId, {
    responseId,
    isFinalAnswer: true,
    hasRenderableContent: false,
  }), false);
});
