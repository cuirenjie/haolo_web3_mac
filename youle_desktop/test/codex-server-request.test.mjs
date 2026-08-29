import assert from "node:assert/strict";
import test from "node:test";

import {
  buildServerRequestResult,
  fastestServiceTierForModel,
  isToolRequestUserInputMethod,
  withFixedDefaultServiceTier,
} from "../src/main/codex-server-request.mjs";

test("forces Fast mode for GPT-5.6 Sol on every billable app-server request", () => {
  for (const method of ["thread/start", "thread/resume", "thread/settings/update", "turn/start"]) {
    assert.deepEqual(
      withFixedDefaultServiceTier(method, { model: "gpt-5.6-sol", serviceTier: null, service_tier: "default" }),
      { model: "gpt-5.6-sol", serviceTier: "priority" },
    );
  }

  assert.equal(fastestServiceTierForModel("openai/gpt-5.6-sol-high"), "priority");
  assert.equal(fastestServiceTierForModel("gpt-5.6-terra"), null);
  assert.deepEqual(
    withFixedDefaultServiceTier("turn/start", { model: "gpt-5.6-terra", serviceTier: "priority" }),
    { model: "gpt-5.6-terra", serviceTier: null },
  );
  assert.deepEqual(
    withFixedDefaultServiceTier("turn/start", { threadId: "thread-sol", serviceTier: null }),
    { threadId: "thread-sol" },
  );

  const params = { threadId: "thread-1" };
  assert.equal(withFixedDefaultServiceTier("thread/read", params), params);
});

test("accepts the current and legacy request-user-input method names", () => {
  assert.equal(isToolRequestUserInputMethod("item/tool/requestUserInput"), true);
  assert.equal(isToolRequestUserInputMethod("tool/requestUserInput"), true);
  assert.equal(isToolRequestUserInputMethod("item/tool/call"), false);
  assert.deepEqual(
    buildServerRequestResult("item/tool/requestUserInput", { answers: { choice: { answers: ["yes"] } } }),
    { answers: { choice: { answers: ["yes"] } } },
  );
});

test("returns the permission grant shape required by the app-server protocol", () => {
  const requested = { network: { enabled: true } };
  assert.deepEqual(
    buildServerRequestResult(
      "item/permissions/requestApproval",
      { decision: "acceptForSession" },
      { permissions: requested },
    ),
    { permissions: requested, scope: "session" },
  );
  assert.deepEqual(
    buildServerRequestResult(
      "item/permissions/requestApproval",
      { decision: "decline" },
      { permissions: requested },
    ),
    { permissions: {}, scope: "turn" },
  );
});

test("preserves existing command, file, and MCP response contracts", () => {
  assert.deepEqual(buildServerRequestResult("item/commandExecution/requestApproval", { decision: "accept" }), { decision: "accept" });
  assert.deepEqual(buildServerRequestResult("item/fileChange/requestApproval", { decision: "decline" }), { decision: "decline" });
  assert.deepEqual(buildServerRequestResult("mcpServer/elicitation/request", { decision: "accept", content: { value: 1 } }), {
    action: "accept",
    content: { value: 1 },
  });
});

test("answers current-time requests with whole Unix seconds", () => {
  assert.deepEqual(buildServerRequestResult("currentTime/read", { nowMs: 1_750_000_123_999 }), {
    currentTimeAt: 1_750_000_123,
  });
});
