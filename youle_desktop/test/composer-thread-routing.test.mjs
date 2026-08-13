import assert from "node:assert/strict";
import test from "node:test";
import { resolveComposerThreadIdForSend } from "../src/renderer/composer-thread-routing.ts";

function route(candidateThreadId, activeThreadId, aliases = {}, visible = []) {
  const visibleIds = new Set(visible);
  return resolveComposerThreadIdForSend({
    candidateThreadId,
    activeThreadId,
    resolveThreadId: (threadId) => aliases[threadId] || threadId,
    isVisibleThreadId: (threadId) => visibleIds.has(threadId),
  });
}

test("a promoted Trading Expert composer always resolves to the same server task", () => {
  assert.equal(
    route(
      "local-blank-trading",
      "thread-trading-server",
      { "local-blank-trading": "thread-trading-server" },
      ["thread-trading-server"],
    ),
    "thread-trading-server",
  );
});

test("a stale promoted id wins over an unrelated active blank when its alias is visible", () => {
  assert.equal(
    route(
      "local-blank-trading",
      "local-blank-unrelated",
      { "local-blank-trading": "thread-trading-server" },
      ["thread-trading-server", "local-blank-unrelated"],
    ),
    "thread-trading-server",
  );
});

test("a retired id without a visible alias falls back to the current task", () => {
  assert.equal(
    route("local-blank-retired", "thread-current", {}, ["thread-current"]),
    "thread-current",
  );
});

test("a valid visible composer keeps its own task identity", () => {
  assert.equal(
    route("thread-visible", "thread-other", {}, ["thread-visible", "thread-other"]),
    "thread-visible",
  );
  assert.equal(route(null, "thread-other", {}, ["thread-other"]), "thread-other");
});
