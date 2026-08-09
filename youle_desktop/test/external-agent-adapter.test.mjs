import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReadOnlyInvocationRequest,
  invokeReadOnlyExternalModel,
  parseReadOnlyInvocationResponse,
} from "../src/main/external-agent/adapter.mjs";
import {
  EXTERNAL_MODEL_PROVIDER_IDS,
  getExternalModelProvider,
} from "../src/main/external-agent/provider-registry.mjs";
import { prepareReadOnlyInvocation } from "../src/main/external-agent/read-only-policy.mjs";

const API_KEY = "sk-unit-test-1234567890abcdef";
const OUTPUT_BUDGET = 321;

const EXPECTED_REQUESTS = Object.freeze({
  openai: {
    url: "https://api.openai.com/v1/responses",
    tokenField: "max_output_tokens",
    store: false,
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    tokenField: "max_tokens",
  },
  moonshot: {
    url: "https://api.moonshot.cn/v1/chat/completions",
    tokenField: "max_completion_tokens",
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    tokenField: "max_tokens",
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    tokenField: null,
  },
  perplexity: {
    url: "https://api.perplexity.ai/v1/sonar",
    tokenField: "max_tokens",
  },
  xai: {
    url: "https://api.x.ai/v1/responses",
    tokenField: "max_output_tokens",
    store: false,
  },
  xiaomi: {
    url: "https://api.xiaomimimo.com/v1/responses",
    tokenField: "max_output_tokens",
  },
});

function invocationFor(provider, overrides = {}) {
  return prepareReadOnlyInvocation({
    provider,
    role: "review",
    dataClassification: "public",
    messages: [{ role: "user", content: "Review this public example." }],
    budget: {
      maxInputTokens: 2_000,
      maxOutputTokens: OUTPUT_BUDGET,
      maxTotalTokens: 2_321,
      timeoutMs: 5_000,
    },
    ...overrides,
  });
}

function credentialFor(providerId) {
  const provider = getExternalModelProvider(providerId);
  return {
    provider,
    apiKey: API_KEY,
    model: provider.defaultModel,
    baseUrl: provider.baseUrlOptions[0].baseUrl,
  };
}

function requestFor(providerId, invocationOverrides = {}) {
  const credential = credentialFor(providerId);
  const invocation = invocationFor(providerId, invocationOverrides);
  return {
    credential,
    invocation,
    request: buildReadOnlyInvocationRequest({ credential, invocation }),
  };
}

function allObjectKeys(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) allObjectKeys(item, result);
    return result;
  }
  for (const [key, item] of Object.entries(value)) {
    result.push(key.toLowerCase());
    allObjectKeys(item, result);
  }
  return result;
}

function hasCode(code) {
  return (error) => error?.code === code;
}

test("all eight adapters use exact official URLs, provider auth, and verified output-token fields", () => {
  assert.deepEqual(Object.keys(EXPECTED_REQUESTS), EXTERNAL_MODEL_PROVIDER_IDS);

  for (const providerId of EXTERNAL_MODEL_PROVIDER_IDS) {
    const { request } = requestFor(providerId);
    const expected = EXPECTED_REQUESTS[providerId];
    const url = new URL(request.url);
    const body = JSON.parse(request.init.body);

    assert.equal(request.url, expected.url, `${providerId} endpoint`);
    assert.equal(url.protocol, "https:");
    assert.equal(url.search, "", `${providerId} must not put credentials in the query`);
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.headers["content-type"], "application/json");
    assert.equal(request.url.includes(API_KEY), false);
    assert.equal(request.init.body.includes(API_KEY), false);

    if (providerId === "anthropic") {
      assert.equal(request.init.headers["x-api-key"], API_KEY);
      assert.equal(request.init.headers["anthropic-version"], "2023-06-01");
      assert.equal("Authorization" in request.init.headers, false);
    } else {
      assert.equal(request.init.headers.Authorization, `Bearer ${API_KEY}`);
      assert.equal("x-api-key" in request.init.headers, false);
    }

    const keys = allObjectKeys(body);
    for (const forbidden of ["tools", "tool_choice", "toolchoice", "functions", "function_call", "mcp"]) {
      assert.equal(keys.includes(forbidden), false, `${providerId} request must not include ${forbidden}`);
    }

    for (const tokenField of ["max_output_tokens", "max_completion_tokens", "max_tokens"]) {
      if (tokenField === expected.tokenField) assert.equal(body[tokenField], OUTPUT_BUDGET);
      else assert.equal(Object.hasOwn(body, tokenField), false, `${providerId} must not send ${tokenField}`);
    }

    if (Object.hasOwn(expected, "store")) assert.equal(body.store, expected.store);
    else assert.equal(Object.hasOwn(body, "store"), false, `${providerId} must not send store`);
  }
});

test("OpenAI Responses requests adapt reasoning effort to task difficulty", () => {
  const trivial = JSON.parse(requestFor("openai", {
    messages: [{ role: "user", content: "你好" }],
  }).request.init.body);
  const simple = JSON.parse(requestFor("openai", {
    messages: [{ role: "user", content: "Review this public example." }],
  }).request.init.body);
  const complex = JSON.parse(requestFor("openai", {
    messages: [{
      role: "user",
      content: "Refactor the entire authentication system, run a security audit, and deploy the migration.",
    }],
  }).request.init.body);

  assert.deepEqual(trivial.reasoning, { effort: "low" });
  assert.deepEqual(simple.reasoning, { effort: "medium" });
  assert.deepEqual(complex.reasoning, { effort: "high" });
});

test("adapter rejects forged endpoints and credential header injection", () => {
  const invocation = invocationFor("openai");
  const credential = credentialFor("openai");
  for (const unsafeCredential of [
    { ...credential, baseUrl: "https://api.openai.com.evil.example/v1" },
    { ...credential, baseUrl: "https://api.openai.com/v1?api_key=leak" },
    { ...credential, baseUrl: "http://127.0.0.1:8080/v1" },
    { ...credential, apiKey: `${API_KEY}\r\nx-evil: injected` },
  ]) {
    assert.throws(
      () => buildReadOnlyInvocationRequest({ credential: unsafeCredential, invocation }),
      hasCode("INVALID_CREDENTIAL"),
    );
  }
});

test("Perplexity enables search only for research and preserves citations, search results, and cost", () => {
  const researchBody = JSON.parse(requestFor("perplexity", { role: "research" }).request.init.body);
  const reviewBody = JSON.parse(requestFor("perplexity", { role: "review" }).request.init.body);
  assert.equal(Object.hasOwn(researchBody, "web_search_options"), false);
  assert.deepEqual(reviewBody.web_search_options, { disable_search: true });

  const provider = getExternalModelProvider("perplexity");
  const result = parseReadOnlyInvocationResponse({
    provider,
    payload: {
      id: "pplx-request",
      choices: [{ message: { content: "Sourced answer" }, finish_reason: "stop" }],
      citations: [
        "https://example.com/source-a",
        "javascript:alert(1)",
      ],
      search_results: [
        { url: "https://example.com/source-a", title: "Duplicate" },
        {
          url: "https://example.org/source-b",
          title: "Source B",
          date: "2026-07-20",
          snippet: "Supporting material",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        num_search_queries: 2,
        cost: { total_cost: 0.0042 },
      },
    },
  });

  assert.equal(result.text, "Sourced answer");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(result.usage, {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    reasoningTokens: null,
    cachedInputTokens: null,
    searchQueries: 2,
    totalCost: 0.0042,
  });
  assert.deepEqual(result.citations, [
    { url: "https://example.com/source-a", title: "", date: "", snippet: "" },
    {
      url: "https://example.org/source-b",
      title: "Source B",
      date: "2026-07-20",
      snippet: "Supporting material",
    },
  ]);
});

test("Responses, Chat Completions, and Claude payloads normalize to one safe result shape", () => {
  const responsesResult = parseReadOnlyInvocationResponse({
    provider: getExternalModelProvider("openai"),
    payload: {
      id: "resp_123",
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "Responses answer",
          annotations: [{ type: "url_citation", url: "https://example.com/doc", title: "Doc" }],
        }],
      }],
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        total_tokens: 25,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    },
  });
  assert.equal(responsesResult.text, "Responses answer");
  assert.equal(responsesResult.finishReason, "stop");
  assert.equal(responsesResult.usage.reasoningTokens, 2);
  assert.equal(responsesResult.usage.cachedInputTokens, 3);
  assert.deepEqual(responsesResult.citations, [
    { url: "https://example.com/doc", title: "Doc", date: "", snippet: "" },
  ]);

  const chatResult = parseReadOnlyInvocationResponse({
    provider: getExternalModelProvider("deepseek"),
    payload: {
      id: "chat_123",
      choices: [{ message: { content: "Chat answer" }, finish_reason: "length" }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    },
  });
  assert.equal(chatResult.text, "Chat answer");
  assert.equal(chatResult.finishReason, "length");
  assert.equal(chatResult.usage.totalTokens, 10);

  const claudeResult = parseReadOnlyInvocationResponse({
    provider: getExternalModelProvider("anthropic"),
    payload: {
      id: "msg_123",
      content: [{ type: "text", text: "Claude answer" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 8, output_tokens: 6 },
    },
  });
  assert.equal(claudeResult.text, "Claude answer");
  assert.equal(claudeResult.finishReason, "stop");
  assert.equal(claudeResult.usage.totalTokens, 14);
});

test("tool-call responses are blocked for Responses, Chat, Gemini compatibility, Perplexity, and Claude", () => {
  const cases = [
    ["openai", { output: [{ type: "function_call", name: "shell" }] }],
    ["xai", { output: [{ type: "web_search_call", status: "completed" }] }],
    ["xiaomi", { output: [{ type: "image_generation_call", status: "completed" }] }],
    ["deepseek", {
      choices: [{ message: { content: "", tool_calls: [{ type: "function", function: { name: "write" } }] } }],
    }],
    ["google", {
      choices: [{ message: { content: "", tool_calls: [{ type: "function", function: { name: "write" } }] } }],
    }],
    ["perplexity", {
      choices: [{ message: { content: "", tool_calls: [{ type: "function", function: { name: "search" } }] } }],
    }],
    ["anthropic", { content: [{ type: "tool_use", name: "write" }] }],
  ];

  for (const [providerId, payload] of cases) {
    assert.throws(
      () => parseReadOnlyInvocationResponse({ provider: getExternalModelProvider(providerId), payload }),
      hasCode("UNEXPECTED_TOOL_CALL"),
      `${providerId} tool call must never reach the runtime as text`,
    );
  }
});

test("legacy and Gemini-native function-call shapes are blocked defensively", () => {
  const provider = getExternalModelProvider("google");
  const payloads = [
    {
      choices: [{
        message: { content: "", function_call: { name: "write_file", arguments: "{}" } },
        finish_reason: "function_call",
      }],
    },
    {
      choices: [{
        message: { content: [{ functionCall: { name: "write_file", args: {} } }] },
        finish_reason: "stop",
      }],
    },
  ];

  const observedCodes = payloads.map((payload) => {
    try {
      parseReadOnlyInvocationResponse({ provider, payload });
      return "ACCEPTED";
    } catch (error) {
      return error?.code;
    }
  });
  assert.deepEqual(observedCodes, ["UNEXPECTED_TOOL_CALL", "UNEXPECTED_TOOL_CALL"]);
});

test("provider output is secret-redacted and unsafe citation schemes are discarded", () => {
  const opaqueKey = "opaqueCredentialValueWithoutPrefix123";
  const result = parseReadOnlyInvocationResponse({
    provider: getExternalModelProvider("openai"),
    apiKey: opaqueKey,
    payload: {
      output_text: [
        "Leaked sk-1234567890abcdef1234567890",
        "Authorization: Bearer do-not-expose-this-token",
        `Exact ${opaqueKey}`,
      ].join("\n"),
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: "ignored because output_text is present",
          annotations: [
            { url: "file:///C:/secret.txt", title: "Local" },
            { url: "http://127.0.0.1/admin", title: "Private" },
            { url: "https://localhost/admin", title: "Localhost" },
            { url: "https://safe.example/report?api_key=leak", title: "Query secret" },
            { url: "https://safe.example/report", title: "Safe" },
          ],
        }],
      }],
    },
  });

  assert.equal(result.text.includes("sk-1234567890abcdef1234567890"), false);
  assert.equal(result.text.includes("do-not-expose-this-token"), false);
  assert.equal(result.text.includes(opaqueKey), false);
  assert.match(result.text, /\[REDACTED\]/);
  assert.deepEqual(result.citations, [
    { url: "https://safe.example/report", title: "Safe", date: "", snippet: "" },
  ]);
});

test("an already-aborted invocation never calls fetch", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled by owner"));
  let fetchCalls = 0;
  const { credential, invocation } = requestFor("openai");

  await assert.rejects(
    invokeReadOnlyExternalModel({
      credential,
      invocation,
      signal: controller.signal,
      fetch: async () => {
        fetchCalls += 1;
        throw new Error("must not be called");
      },
    }),
    hasCode("INVOCATION_CANCELLED"),
  );
  assert.equal(fetchCalls, 0);
});

test("invocation applies safe fetch options and distinguishes owner cancellation from timeout", async () => {
  const { credential, invocation } = requestFor("openai");
  let captured;
  const success = await invokeReadOnlyExternalModel({
    credential,
    invocation,
    fetch: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ output_text: "safe answer", status: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(success.text, "safe answer");
  assert.equal(captured.url, EXPECTED_REQUESTS.openai.url);
  assert.equal(captured.init.redirect, "error");
  assert.equal(captured.init.credentials, "omit");
  assert.equal(captured.init.cache, "no-store");
  assert.ok(captured.init.signal instanceof AbortSignal);

  const ownerController = new AbortController();
  const cancelled = invokeReadOnlyExternalModel({
    credential,
    invocation,
    signal: ownerController.signal,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  });
  ownerController.abort();
  await assert.rejects(cancelled, hasCode("INVOCATION_CANCELLED"));

  const timedInvocation = {
    ...invocation,
    budget: { ...invocation.budget, timeoutMs: 10 },
  };
  await assert.rejects(
    invokeReadOnlyExternalModel({
      credential,
      invocation: timedInvocation,
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    }),
    hasCode("INVOCATION_TIMEOUT"),
  );
});

test("invocation rejects oversized responses and successful non-JSON content types", async () => {
  const { credential, invocation } = requestFor("openai");
  const oversizedPayload = JSON.stringify({ output_text: "x".repeat(4 * 1024 * 1024), status: "completed" });

  await assert.rejects(
    invokeReadOnlyExternalModel({
      credential,
      invocation,
      fetch: async () => new Response(oversizedPayload, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    hasCode("PROVIDER_RESPONSE_TOO_LARGE"),
  );

  await assert.rejects(
    invokeReadOnlyExternalModel({
      credential,
      invocation,
      fetch: async () => new Response(JSON.stringify({ output_text: "answer", status: "completed" }), {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    }),
    hasCode("INVALID_PROVIDER_RESPONSE"),
  );
});
