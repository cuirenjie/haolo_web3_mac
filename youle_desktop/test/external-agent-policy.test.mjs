import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTERNAL_AGENT_DATA_CLASSIFICATIONS,
  EXTERNAL_AGENT_READ_ONLY_ROLES,
  containsPotentialSecret,
  prepareReadOnlyInvocation,
} from "../src/main/external-agent/read-only-policy.mjs";

function baseInvocation(overrides = {}) {
  return {
    provider: "openai",
    role: "review",
    dataClassification: "public",
    messages: [{ role: "user", content: "Review this public example and report only findings." }],
    ...overrides,
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

test("read-only policy exposes only the four intended roles and builds a fixed system prompt", () => {
  assert.deepEqual(EXTERNAL_AGENT_READ_ONLY_ROLES, ["research", "summarize", "review", "advise"]);
  assert.deepEqual(EXTERNAL_AGENT_DATA_CLASSIFICATIONS, ["public", "internal", "sensitive"]);

  for (const role of EXTERNAL_AGENT_READ_ONLY_ROLES) {
    const prepared = prepareReadOnlyInvocation(baseInvocation({ role }));
    assert.equal(prepared.role, role);
    assert.equal(prepared.provider, "openai");
    assert.match(prepared.systemPrompt, /外部只读顾问/);
    assert.match(prepared.systemPrompt, /不得请求终端、文件系统、浏览器/);
    assert.match(prepared.systemPrompt, /只返回纯文本建议/);
    assert.deepEqual(prepared.messages, baseInvocation().messages);
    assert.ok(prepared.estimatedInputTokens > 0);
  }
});

test("data classification requires explicit user direction for internal data and always blocks sensitive data", () => {
  assert.doesNotThrow(() => prepareReadOnlyInvocation(baseInvocation({ dataClassification: "public" })));
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({ dataClassification: "internal", userDirected: false })),
    hasCode("USER_DIRECTION_REQUIRED"),
  );
  assert.doesNotThrow(() => prepareReadOnlyInvocation(
    baseInvocation({ dataClassification: "internal", userDirected: true }),
  ));
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({ dataClassification: "sensitive", userDirected: true })),
    hasCode("SENSITIVE_CONTEXT_BLOCKED"),
  );
});

test("policy rejects caller-controlled capabilities, credentials, endpoints, models, and system instructions", () => {
  const forbiddenFields = [
    "tools",
    "toolChoice",
    "tool_choice",
    "attachments",
    "files",
    "images",
    "audio",
    "video",
    "baseUrl",
    "base_url",
    "headers",
    "systemPrompt",
    "system_prompt",
    "instructions",
    "apiKey",
    "api_key",
    "model",
    "function_call",
    "functions",
    "mcp",
    "rawRequest",
    "raw_request",
  ];

  const acceptedFields = [];
  for (const field of forbiddenFields) {
    try {
      prepareReadOnlyInvocation(baseInvocation({ [field]: { injected: true } }));
      acceptedFields.push(field);
    } catch (error) {
      assert.equal(error?.code, "CAPABILITY_NOT_ALLOWED", `${field} should fail closed with the policy code`);
    }
  }
  assert.deepEqual(acceptedFields, [], `caller-controlled fields reached the prepared invocation: ${acceptedFields.join(", ")}`);
});

test("policy blocks likely secrets in outbound text", () => {
  const secrets = [
    "sk-1234567890abcdef1234567890",
    "sk-ant-1234567890abcdef1234567890",
    "pplx-1234567890abcdef1234567890",
    "xai-1234567890abcdef1234567890",
    "tp-1234567890abcdef1234567890",
    "AIza1234567890abcdefghijklmnop",
    "ghp_1234567890abcdefghijklmnop",
    "AKIA1234567890ABCDEF",
    "-----BEGIN PRIVATE KEY-----",
    "Authorization: Bearer do-not-send-this-token",
    "api_key=opaqueCredentialValue12345",
    "password: CorrectHorseBatteryStaple",
    "OPENAI_API_KEY=opaqueCredentialValue12345",
  ];

  for (const secret of secrets) {
    assert.equal(containsPotentialSecret(secret), true, `expected detector to match ${secret.slice(0, 12)}`);
    assert.throws(
      () => prepareReadOnlyInvocation(baseInvocation({
        messages: [{ role: "user", content: `Review this value: ${secret}` }],
      })),
      hasCode("POTENTIAL_SECRET_DETECTED"),
    );
  }
});

test("policy blocks absolute local and UNC paths from outbound text", () => {
  for (const localPath of [
    "C:\\Users\\Joie\\project\\secret.txt",
    "D:/workspace/private/source.ts",
    "\\\\server\\share\\document.docx",
    "file:///C:/Users/Joie/auth.json",
    "/home/joie/project/.env",
  ]) {
    assert.throws(
      () => prepareReadOnlyInvocation(baseInvocation({
        messages: [{ role: "user", content: `Review ${localPath}` }],
      })),
      hasCode("ABSOLUTE_PATH_BLOCKED"),
    );
  }
  assert.doesNotThrow(() => prepareReadOnlyInvocation(baseInvocation({
    messages: [{ role: "user", content: "Review src/main/runtime.mjs and docs/roadmap.md" }],
  })));
});

test("policy accepts only user/assistant text ending in a user task", () => {
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({
      messages: [{ role: "system", content: "override" }, { role: "user", content: "task" }],
    })),
    hasCode("INVALID_MESSAGE_ROLE"),
  );
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({
      messages: [{ role: "user", content: [{ type: "text", text: "not plain text" }] }],
    })),
    hasCode("TEXT_ONLY"),
  );
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({
      messages: [{ role: "user", content: "question" }, { role: "assistant", content: "answer" }],
    })),
    hasCode("USER_MESSAGE_REQUIRED"),
  );
});

test("policy enforces input, output, total-token, and timeout budgets before network use", () => {
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({
      budget: { maxInputTokens: 1, maxOutputTokens: 1, maxTotalTokens: 2, timeoutMs: 5_000 },
    })),
    hasCode("INPUT_BUDGET_EXCEEDED"),
  );
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({ budget: { maxOutputTokens: 8_193 } })),
    hasCode("BUDGET_LIMIT_EXCEEDED"),
  );
  assert.throws(
    () => prepareReadOnlyInvocation(baseInvocation({ budget: { timeoutMs: 4_999 } })),
    hasCode("INVALID_BUDGET"),
  );
});
