import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { ChromeEffectStore, ChromeGrantStore, authorizeChromeToolCall, sanitizePageSnapshot } from "../src/main/chrome/policy.mjs";

test("Chrome local authorization p95 stays below 200ms", () => {
  const durations = [];
  for (let index = 0; index < 500; index += 1) {
    const store = new ChromeGrantStore();
    const grant = store.issue({ threadId: "thread", turnId: "turn", taskId: "task", profileId: "profile", tabIds: [7], origins: ["https://example.test"], tools: ["click"] });
    const started = performance.now();
    authorizeChromeToolCall({ grantStore: store, grantId: grant.id, tool: "click", arguments: { tab_id: 7, target: { element_id: "hf_0_1" } }, context: { threadId: "thread", turnId: "turn", taskId: "task", profileId: "profile", url: "https://example.test/page" } });
    durations.push(performance.now() - started);
  }
  assert.ok(percentile(durations, 0.95) < 200);
});

test("typical structured snapshot sanitization p95 stays below 500ms", () => {
  const snapshot = {
    url: "https://example.test/report",
    text: "Visible report text ".repeat(1_000),
    elements: Array.from({ length: 500 }, (_, index) => ({ element_id: `hf_0_${index}`, role: "button", name: `Action ${index}`, rect: { x: 1, y: index * 2, width: 100, height: 30 } })),
    links: Array.from({ length: 200 }, (_, index) => ({ element_id: `hf_0_l${index}`, text: `Link ${index}`, href: `https://example.test/${index}` })),
  };
  const durations = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    sanitizePageSnapshot(snapshot, { maxChars: 24_000 });
    durations.push(performance.now() - started);
  }
  assert.ok(percentile(durations, 0.95) < 500);
});

test("prepared effects reject token guessing and execute idempotently", () => {
  const effects = new ChromeEffectStore();
  const prepared = effects.prepare({ grantId: "grant", tool: "download", arguments: { tab_id: 7, url: "https://example.test/file" }, summary: "Download file", tabId: 7, origin: "https://example.test" });
  const approved = effects.approve(prepared.id);
  assert.throws(() => effects.commit(prepared.id, "guessed"), { code: "CHROME_APPROVAL_TOKEN_INVALID" });
  effects.commit(prepared.id, approved.approvalToken);
  effects.complete(prepared.id, { downloadId: 1 });
  assert.equal(effects.commit(prepared.id, approved.approvalToken).replayed, true);
  assert.throws(() => effects.commit(prepared.id, "different"), { code: "CHROME_APPROVAL_TOKEN_INVALID" });
});

function percentile(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * quantile))];
}
