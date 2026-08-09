import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyThreadRecordVisibility,
  collectVisibleThreadPage,
  createInternalSubagentThreadRegistry,
} from "../src/main/codex-thread-visibility.mjs";

const includeVisibleThread = (_entry, thread) =>
  classifyThreadRecordVisibility(thread) !== "internal-subagent";

test("authoritative parent metadata classifies a thread as an internal subagent", () => {
  assert.equal(
    classifyThreadRecordVisibility({
      id: "child-conflict",
      parentThreadId: "root",
      source: "vscode",
      threadSource: "user",
    }),
    "internal-subagent",
  );

  assert.equal(
    classifyThreadRecordVisibility({
      id: "nested-child",
      source: {
        subAgent: {
          threadSpawn: { parentThreadId: "root" },
        },
      },
    }),
    "internal-subagent",
  );

  assert.equal(
    classifyThreadRecordVisibility({
      id: "runtime-hybrid-child",
      threadSource: null,
      source: {
        subAgent: {
          thread_spawn: { parent_thread_id: "root" },
        },
      },
    }),
    "internal-subagent",
  );
});

test("unknown thread records fail open when collecting visible rows", async () => {
  assert.equal(classifyThreadRecordVisibility({ id: "legacy-unknown" }), "unknown");

  const result = await collectVisibleThreadPage({
    params: { limit: 2 },
    includeEntry: includeVisibleThread,
    requestPage: async () => ({
      data: [
        { id: "legacy-unknown" },
        { id: "known-child", source: "subAgent" },
      ],
      nextCursor: null,
      backwardsCursor: "back-start",
    }),
  });

  assert.deepEqual(result.data.map((thread) => thread.id), ["legacy-unknown"]);
});

test("internal subagent registry is scoped per client and can clear one client", () => {
  const registry = createInternalSubagentThreadRegistry();
  const clientA = {};
  const clientB = {};

  assert.equal(registry.remember(clientA, { id: "same-id", parentThreadId: "root-a" }), "internal-subagent");
  assert.equal(registry.remember(clientB, { id: "same-id", source: "vscode" }), "visible");
  assert.equal(registry.has(clientA, "same-id"), true);
  assert.equal(registry.has(clientB, "same-id"), false);

  assert.equal(
    registry.remember(clientA, { id: "same-id", source: "vscode" }),
    "internal-subagent",
    "a later parent-derived snapshot cannot promote a confirmed child",
  );
  assert.equal(registry.has(clientA, "same-id"), true);
  assert.equal(
    registry.remember(clientA, { id: "same-id" }),
    "internal-subagent",
    "a sparse completion snapshot cannot forget a confirmed child",
  );

  registry.clear(clientA);
  assert.equal(registry.has(clientA, "same-id"), false);
  assert.equal(registry.has(clientB, "same-id"), false);

  registry.remember(clientB, { id: "child-b", source: "subAgent" });
  assert.equal(registry.has(clientB, "child-b"), true);
  registry.clear(clientA);
  assert.equal(registry.has(clientB, "child-b"), true);
});

test("an authoritative parent activity can register a child before thread/started", () => {
  const registry = createInternalSubagentThreadRegistry();
  const client = {};

  assert.equal(registry.rememberInternal(client, "child-from-parent-activity"), true);
  assert.equal(registry.has(client, "child-from-parent-activity"), true);
  assert.equal(
    registry.remember(client, { id: "child-from-parent-activity", source: "vscode" }),
    "internal-subagent",
  );
});

test("a completed child stays hidden when a later page reports a top-level source", async () => {
  const registry = createInternalSubagentThreadRegistry();
  const client = {};
  const collect = (data) => collectVisibleThreadPage({
    params: { limit: 4 },
    requestPage: async () => ({ data, nextCursor: null }),
    onThread: (thread) => registry.remember(client, thread),
    includeEntry: (_entry, thread) =>
      classifyThreadRecordVisibility(thread) !== "internal-subagent" && !registry.has(client, thread.id),
  });

  const running = await collect([
    { id: "parent", source: "vscode" },
    {
      id: "child",
      source: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: "parent" } } }),
    },
  ]);
  assert.deepEqual(running.data.map((thread) => thread.id), ["parent"]);

  const completed = await collect([
    { id: "child", source: "vscode" },
    { id: "parent", source: "vscode" },
  ]);
  assert.deepEqual(completed.data.map((thread) => thread.id), ["parent"]);
});

test("collectVisibleThreadPage follows pagination when the first page is all children", async () => {
  const calls = [];
  const pages = new Map([
    [
      null,
      {
        data: [
          { id: "child-1", source: "subAgent" },
          { id: "child-2", parentThreadId: "root" },
        ],
        nextCursor: "after-children",
        backwardsCursor: "before-first-page",
      },
    ],
    [
      "after-children",
      {
        data: [
          { id: "root-1", source: "vscode" },
          { id: "root-2", source: "vscode" },
        ],
        nextCursor: "after-visible",
        backwardsCursor: "before-second-page",
      },
    ],
  ]);

  const result = await collectVisibleThreadPage({
    params: { limit: 2, sortKey: "updated_at" },
    includeEntry: includeVisibleThread,
    requestPage: async (params) => {
      calls.push(params);
      return pages.get(params.cursor) ?? { data: [], nextCursor: null };
    },
  });

  assert.deepEqual(result.data.map((thread) => thread.id), ["root-1", "root-2"]);
  assert.deepEqual(
    calls.map(({ cursor, limit }) => ({ cursor, limit })),
    [
      { cursor: null, limit: 2 },
      { cursor: "after-children", limit: 2 },
    ],
  );
  assert.equal(result.backwardsCursor, "before-first-page");
  assert.equal(result.nextCursor, "after-visible");
});

test("serialized subagent sources keep three children out of a one-parent conversation list", async () => {
  const childSource = (parentThreadId) => JSON.stringify({
    subagent: { thread_spawn: { parent_thread_id: parentThreadId } },
  });
  const result = await collectVisibleThreadPage({
    params: { limit: 4 },
    requestPage: async () => ({
      data: [
        { id: "parent", source: "vscode" },
        { id: "child-a", source: childSource("parent") },
        { id: "child-b", source: childSource("parent") },
        { id: "child-c", source: childSource("parent") },
      ],
      nextCursor: null,
    }),
    includeEntry: includeVisibleThread,
  });

  assert.deepEqual(result.data.map((thread) => thread.id), ["parent"]);
});

test("collectVisibleThreadPage supports search result wrappers", async () => {
  const observed = [];
  const result = await collectVisibleThreadPage({
    params: { limit: 2 },
    threadFromEntry: (entry) => entry.thread,
    includeEntry: includeVisibleThread,
    onThread: (thread, entry) => observed.push([thread.id, entry.snippet]),
    requestPage: async () => ({
      data: [
        { thread: { id: "search-child", source: "subAgent" }, snippet: "hidden" },
        { thread: { id: "search-root", source: "vscode" }, snippet: "visible" },
      ],
      nextCursor: null,
      backwardsCursor: null,
    }),
  });

  assert.deepEqual(result.data, [
    { thread: { id: "search-root", source: "vscode" }, snippet: "visible" },
  ]);
  assert.deepEqual(observed, [
    ["search-child", "hidden"],
    ["search-root", "visible"],
  ]);
});

test("collectVisibleThreadPage stops a repeated cursor and preserves composite cursors", async () => {
  const calls = [];
  const result = await collectVisibleThreadPage({
    params: { limit: 3 },
    includeEntry: includeVisibleThread,
    requestPage: async ({ cursor }) => {
      calls.push(cursor);
      if (cursor === null) {
        return {
          data: [{ id: "root-first", source: "vscode" }],
          nextCursor: "loop",
          backwardsCursor: "before-composite-page",
        };
      }
      return {
        data: [{ id: "root-second", source: "vscode" }],
        nextCursor: "loop",
        backwardsCursor: "before-last-page",
      };
    },
  });

  assert.deepEqual(calls, [null, "loop"]);
  assert.deepEqual(result.data.map((thread) => thread.id), ["root-first", "root-second"]);
  assert.equal(result.backwardsCursor, "before-composite-page");
  assert.equal(result.nextCursor, "loop");
});
