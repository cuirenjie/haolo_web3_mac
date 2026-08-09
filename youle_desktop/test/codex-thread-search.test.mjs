import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  THREAD_SEARCH_FALLBACK_CODE,
  classifyThreadSearchUnavailableError,
  normalizeThreadSearchParams,
  searchThreadsWithFallback,
} from "../src/main/codex-thread-search.mjs";

test("normalizes thread search parameters for the 0.144.1 protocol", () => {
  assert.deepEqual(
    normalizeThreadSearchParams({
      search_term: "  release notes  ",
      limit: "999.8",
      cursor: "  opaque-cursor  ",
      sort_key: "recencyAt",
      sort_direction: "DESCENDING",
      source_kinds: ["appserver", "subAgent", "APP_SERVER", "invalid"],
      archived: "false",
      cwd: "D:/ignored-by-rpc",
    }),
    {
      searchTerm: "release notes",
      limit: 999,
      cursor: "opaque-cursor",
      sortKey: "recency_at",
      sortDirection: "desc",
      sourceKinds: ["appServer", "subAgent"],
      archived: false,
    },
  );
  assert.throws(
    () => normalizeThreadSearchParams({ searchTerm: "   " }),
    (error) => error.code === "THREAD_SEARCH_INVALID_QUERY",
  );
  assert.equal(normalizeThreadSearchParams({ searchTerm: "query", limit: -1 }).limit, 0);
  assert.equal(normalizeThreadSearchParams({ searchTerm: "query", limit: Number.MAX_SAFE_INTEGER }).limit, 0xffffffff);
});

test("calls thread/search with normalized params and preserves a successful response", async () => {
  const response = {
    data: [{ thread: { id: "thread-1" }, snippet: "matching text" }],
    nextCursor: "next",
    backwardsCursor: "previous",
  };
  let call = null;
  const result = await searchThreadsWithFallback({
    params: { searchTerm: "  matching  ", limit: 20, sortKey: "updated_at", sortDirection: "asc" },
    request: async (method, params) => {
      call = { method, params };
      return response;
    },
  });

  assert.deepEqual(call, {
    method: "thread/search",
    params: { searchTerm: "matching", limit: 20, sortKey: "updated_at", sortDirection: "asc" },
  });
  assert.equal(result, response);
});

test("returns a structured fallback signal for method-not-found and unsupported servers", async (t) => {
  const cases = [
    ["rpc -32601", Object.assign(new Error("Method not found"), { data: { code: -32601 } }), "method_not_found", -32601],
    ["unsupported message", new Error("thread/search is not supported yet"), "unsupported", null],
  ];
  for (const [name, failure, reason, rpcCode] of cases) {
    await t.test(name, async () => {
      const result = await searchThreadsWithFallback({
        params: { searchTerm: "query" },
        request: async () => {
          throw failure;
        },
      });
      assert.deepEqual(result, {
        data: [],
        nextCursor: null,
        backwardsCursor: null,
        fallback: {
          required: true,
          code: THREAD_SEARCH_FALLBACK_CODE,
          reason,
          rpcCode,
        },
      });
    });
  }
});

test("does not swallow unrelated thread search errors", async () => {
  const failure = Object.assign(new Error("database is locked"), { data: { code: -32000 } });
  await assert.rejects(
    searchThreadsWithFallback({
      params: { searchTerm: "query" },
      request: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
  assert.equal(classifyThreadSearchUnavailableError(failure), null);
});

test("finds nested JSON-RPC codes even when an outer code is null", () => {
  assert.deepEqual(
    classifyThreadSearchUnavailableError({ code: null, data: { error: { code: -32601, message: "Method not found" } } }),
    { reason: "method_not_found", rpcCode: -32601 },
  );
});

test("wires the thread search bridge through main and preload without replacing list/resume", async () => {
  const [mainSource, preloadSource] = await Promise.all([
    readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/main/preload.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(mainSource, /ipcMain\.handle\("codex:searchThreads"/);
  assert.match(mainSource, /searchThreadsWithFallback\(\{/);
  assert.match(preloadSource, /searchThreads: \(params\) => ipcRenderer\.invoke\("codex:searchThreads", params\)/);
  assert.match(mainSource, /ipcMain\.handle\("codex:listThreads"/);
  assert.match(mainSource, /ipcMain\.handle\("codex:resumeThread"/);
});
