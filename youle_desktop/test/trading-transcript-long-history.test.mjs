import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTradingTranscriptItems,
  tradingTranscriptInjectionItems,
  withTradingTranscriptItems,
} from "../src/main/trading-expert-transcript.mjs";
import { createTradingTranscriptHost, longTradingTranscript } from "./helpers/trading-transcript-host.mjs";

const emptyThread = () => ({ thread: { id: "origin", turns: [] } });
const visibleItems = result => result.thread.turns.flatMap(turn => turn.items);

for (const count of [64, 65, 256]) {
  test(`restore all ${count} history records without truncation or metadata loss`, () => {
    const history = longTradingTranscript(count);
    const restored = visibleItems(withTradingTranscriptItems(emptyThread(), history));
    assert.deepEqual(restored.map(item => item.id), history.map(item => item.id));
    assert.deepEqual(restored.map(item => item.text), history.map(item => item.text));
    for (const item of restored.filter(item => item.role === "assistant")) {
      assert.equal(item.__youleExecutionPlanPresentation, "plain");
      assert.equal(item.__youleNativeResponseComplete, true);
      assert.equal(item.__youleTurnStatus, "completed");
    }
  });
}

test("history may exceed the 4 MiB write budget while each item remains valid", () => {
  const history = longTradingTranscript(5).map(item => ({ ...item, text: "a".repeat(900 * 1024) }));
  assert.throws(() => normalizeTradingTranscriptItems(history), /batch is too large/);
  const restored = visibleItems(withTradingTranscriptItems(emptyThread(), history));
  assert.deepEqual(restored.map(item => item.text), history.map(item => item.text));
});

test("single writes still enforce item count, batch bytes and item validity", () => {
  assert.equal(normalizeTradingTranscriptItems(longTradingTranscript(64)).length, 64);
  for (const invalid of [undefined, {}, [], longTradingTranscript(65)]) {
    assert.throws(() => normalizeTradingTranscriptItems(invalid), /items are required/);
    assert.throws(() => tradingTranscriptInjectionItems(invalid), /items are required/);
  }
  const item = longTradingTranscript(1)[0];
  for (const [invalid, expected] of [
    [{ ...item, text: "a".repeat(1024 * 1024 + 1) }, /item is too large/],
    [{ ...item, text: " " }, /text is required/],
    [{ ...item, id: "" }, /id is invalid/],
    [{ ...item, role: "system" }, /role is invalid/],
    [{ ...item, createdAt: "invalid" }, /createdAt is required/],
  ]) {
    assert.throws(() => normalizeTradingTranscriptItems([invalid]), expected);
    assert.throws(() => withTradingTranscriptItems(emptyThread(), [...longTradingTranscript(65), invalid]), expected);
  }
});

test("long history deduplicates identical IDs and rejects conflicting content across the write boundary", () => {
  const history = longTradingTranscript(65);
  const restored = visibleItems(withTradingTranscriptItems(emptyThread(), [...history, { ...history[0] }]));
  assert.deepEqual(restored.map(item => item.id), history.map(item => item.id));
  assert.throws(() => withTradingTranscriptItems(emptyThread(), [
    ...history, { ...history[0], text: "conflicting content" },
  ]), /id was reused with different content/);
});

for (const initialCount of [64, 65, 256]) {
  test(`real persistence handler continues a ${initialCount}-record chat, retries once and reloads after restart`, async t => {
    const history = longTradingTranscript(initialCount);
    const host = createTradingTranscriptHost(t, history);
    const request = { ...history[0], id: "next-request", text: "@策略:谐波形态", createdAt: "2026-10-22T00:00:00.000Z" };
    const answer = { ...history[1], id: "next-answer", text: "新的分析结果", createdAt: "2026-10-22T00:00:02.000Z" };
    const saved = await host.persist({ items: [request] });
    assert.equal(saved.ok, true);
    assert.equal(saved.threadId, host.threadId);
    assert.equal(saved.replacementThread, undefined);
    assert.equal(visibleItems(saved).length, initialCount + 1);
    assert.deepEqual(Array.from(saved.persistedItemIds), [request.id]);

    host.restart();
    assert.equal(visibleItems(await host.restore()).length, initialCount + 1);
    const retried = await host.persist({ items: [request] });
    assert.equal(retried.ok, true);
    assert.equal(retried.injectedItemIds.length, 0);
    const completed = await host.persist({ items: [answer] });
    assert.equal(completed.ok, true);
    assert.deepEqual(visibleItems(completed).slice(-2).map(item => item.text), [request.text, answer.text]);
    assert.deepEqual((await host.readItems()).map(item => item.id), [...history, request, answer].map(item => item.id));
    assert.deepEqual(host.calls.filter(call => call.method === "thread/inject_items").map(call => call.itemCount), [1, 1]);
    assert.equal(host.events.filter(event => event.stage === "persist.failed").length, 0);
  });
}
