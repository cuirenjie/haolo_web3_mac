import assert from "node:assert/strict";
import test from "node:test";
import {
  GPT_PLAN_FINAL_END,
  GPT_PLAN_FINAL_START,
  GPT_PLAN_MODE_PROMPT_START,
  GPT_PLAN_PROCESS_END,
  GPT_PLAN_PROCESS_START,
  createGptPlanModeStreamAdapter,
  isGptPlanModeProviderRequest,
  parseGptPlanModePresentation,
  providerMessagesWithGptPlanModePrompt,
} from "../src/main/gpt-plan-mode-prompt.mjs";
import {
  YouleApiClient,
  normalizeBusinessModelPools,
} from "../src/main/youle-api-client.mjs";

const PLAN_MODE_REQUEST = {
  provider: "codex",
  modelPool: "question_answer",
  modelCapability: "question_answer",
  gptPlanMode: true,
};

test("explicit GPT plan mode applies default execution planning guidance", () => {
  for (const model of [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-7-future",
  ]) {
    assert.equal(
      isGptPlanModeProviderRequest({ ...PLAN_MODE_REQUEST, model }),
      true,
    );
    const messages = providerMessagesWithGptPlanModePrompt(
      [{ role: "user", content: "制定实施计划" }],
      { ...PLAN_MODE_REQUEST, model },
    );
    assert.equal(messages[0].role, "system");
    assert.match(messages[0].content, new RegExp(GPT_PLAN_MODE_PROMPT_START));
    assert.match(messages[0].content, /meaningful, logically ordered steps/);
    assert.match(messages[0].content, new RegExp(GPT_PLAN_PROCESS_START));
    assert.match(messages[0].content, new RegExp(GPT_PLAN_FINAL_START));
    assert.match(messages[0].content, /not private chain-of-thought/i);
    assert.deepEqual(messages[1], {
      role: "user",
      content: "制定实施计划",
    });
  }
});

test("ordinary GPT question-answer requests answer directly by default", () => {
  const original = [{ role: "user", content: "当前的仓位是否安全？" }];
  const request = {
    provider: "codex",
    modelPool: "question_answer",
    modelCapability: "question_answer",
    model: "gpt-5.6-sol",
  };

  assert.equal(isGptPlanModeProviderRequest(request), false);
  assert.equal(providerMessagesWithGptPlanModePrompt(original, request), original);
});

test("GPT plan presentation survives marker splits and separates public progress from the final answer", () => {
  const raw = [
    GPT_PLAN_PROCESS_START,
    "先确认目标与范围。",
    GPT_PLAN_PROCESS_END,
    GPT_PLAN_PROCESS_START,
    "再核对关键约束。",
    GPT_PLAN_PROCESS_END,
    GPT_PLAN_FINAL_START,
    "这是完整的最终方案。",
    GPT_PLAN_FINAL_END,
  ].join("");
  const events = [];
  const adapter = createGptPlanModeStreamAdapter((event) => events.push(event));

  for (let offset = 0; offset < raw.length; offset += 7) {
    adapter.onEvent({
      phase: "delta",
      delta: raw.slice(offset, offset + 7),
    });
  }
  adapter.onEvent({ phase: "completed", receivedChars: raw.length });
  const parsed = adapter.reconcile(raw);

  assert.equal(parsed.structured, true);
  assert.deepEqual(parsed.processSegments, [
    "先确认目标与范围。",
    "再核对关键约束。",
  ]);
  assert.equal(parsed.finalText, "这是完整的最终方案。");
  assert.equal(
    events
      .filter((event) => event.phase === "plan_process_delta")
      .map((event) => event.delta)
      .join(""),
    "先确认目标与范围。再核对关键约束。",
  );
  assert.equal(
    events
      .filter((event) => event.phase === "delta")
      .map((event) => event.delta)
      .join(""),
    "这是完整的最终方案。",
  );
  assert.doesNotMatch(JSON.stringify(events), /haolo_plan_(?:process|final)/);
});

test("GPT plan presentation falls back losslessly when a model ignores the tagged protocol", () => {
  const text = "普通的流式回答，不包含任何展示标记。";
  const events = [];
  const adapter = createGptPlanModeStreamAdapter((event) => events.push(event));
  for (const delta of ["普通的", "流式回答，", "不包含任何展示标记。"]) {
    adapter.onEvent({ phase: "delta", delta });
  }
  adapter.onEvent({ phase: "completed" });

  assert.equal(
    events
      .filter((event) => event.phase === "delta")
      .map((event) => event.delta)
      .join(""),
    text,
  );
  assert.deepEqual(parseGptPlanModePresentation(text), {
    structured: false,
    processSegments: [],
    finalText: text,
  });
});

test("plan mode leaves every non-GPT model unchanged", () => {
  const original = [{ role: "user", content: "制定实施计划" }];
  for (const [provider, model] of [
    ["kimi", "kimi-k3"],
    ["grok", "grok-4.5"],
    ["deepseek", "deepseek-v4-pro"],
    ["claude", "claude-sonnet-5"],
    ["gemini", "gemini-3.5-pro"],
    ["doubao", "doubao-seed-2-1-pro-260628"],
    ["qwen", "qwen3.7-max"],
  ]) {
    assert.equal(
      providerMessagesWithGptPlanModePrompt(original, {
        ...PLAN_MODE_REQUEST,
        provider,
        model,
      }),
      original,
    );
  }
});

test("GPT planning guidance stays isolated from execution and group chat requests", () => {
  const original = [{ role: "user", content: "制定实施计划" }];
  const excludedRequests = [
    { provider: "codex", model: "gpt-5.6-sol" },
    {
      ...PLAN_MODE_REQUEST,
      model: "gpt-5.6-sol",
      modelPool: "execution",
      modelCapability: "root_execution",
    },
    {
      ...PLAN_MODE_REQUEST,
      model: "gpt-5.6-sol",
      groupChatThreadId: "group-1",
    },
  ];
  for (const request of excludedRequests) {
    assert.equal(
      providerMessagesWithGptPlanModePrompt(original, request),
      original,
    );
  }
});

test("GPT planning guidance is idempotent across prepared message reuse", () => {
  const request = { ...PLAN_MODE_REQUEST, model: "gpt-5.6-terra" };
  const first = providerMessagesWithGptPlanModePrompt(
    [{ role: "user", content: "制定实施计划" }],
    request,
  );
  const second = providerMessagesWithGptPlanModePrompt(first, request);
  assert.equal(second, first);
  assert.equal(
    second.filter(
      (message) =>
        String(message.content || "").includes(GPT_PLAN_MODE_PROMPT_START),
    ).length,
    1,
  );
});

test("explicit GPT plan mode sends the planning guidance for configured GPT models", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: "计划已生成" } }],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const models = [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ];
    const client = new YouleApiClient({ businessModelPoolsTtlMs: 60_000 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [
      {
        provider: "codex",
        groupId: 12,
        apiKey: "sk-codex-user",
        baseUrl: "https://transit.example/v1",
      },
    ];
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        pools: [{
          id: "question_answer",
          enabled: true,
          capabilities: ["question_answer"],
          models: models.map((model) => ({
            id: model,
            display_name: model,
            provider: "codex",
            route_group_id: 12,
            capabilities: ["question_answer"],
            enabled: true,
          })),
        }],
      }),
    };

    for (const model of models) {
      await client.sendProviderChat({
        ...PLAN_MODE_REQUEST,
        model,
        text: "制定实施计划",
      });
    }
    await client.sendProviderChat({
      provider: "codex",
      modelPool: "question_answer",
      modelCapability: "question_answer",
      model: "gpt-5.6-sol",
      text: "当前的仓位是否安全？",
    });

    assert.equal(requests.length, models.length + 1);
    for (const [index, request] of requests.slice(0, models.length).entries()) {
      assert.equal(request.model, models[index]);
      assert.equal(request.stream, true);
      assert.equal(request.messages[0].role, "system");
      assert.match(
        request.messages[0].content,
        new RegExp(GPT_PLAN_MODE_PROMPT_START),
      );
      assert.deepEqual(request.messages[1], {
        role: "user",
        content: "制定实施计划",
      });
    }
    const ordinaryRequest = requests.at(-1);
    assert.equal(ordinaryRequest.model, "gpt-5.6-sol");
    assert.deepEqual(ordinaryRequest.messages[0], {
      role: "user",
      content: "当前的仓位是否安全？",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("configured GPT SSE strips presentation tags while streaming process and final channels separately", async () => {
  const originalFetch = globalThis.fetch;
  const raw = [
    GPT_PLAN_PROCESS_START,
    "正在确认目标。",
    GPT_PLAN_PROCESS_END,
    GPT_PLAN_PROCESS_START,
    "正在整理步骤。",
    GPT_PLAN_PROCESS_END,
    GPT_PLAN_FINAL_START,
    "可执行的最终计划。",
    GPT_PLAN_FINAL_END,
  ].join("");
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < raw.length; offset += 9) {
          const delta = raw.slice(offset, offset + 9);
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({
              model: "gpt-5.6-sol",
              choices: [{ delta: { content: delta }, finish_reason: null }],
            })}\n\n`,
          ));
        }
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            model: "gpt-5.6-sol",
            choices: [{ delta: {}, finish_reason: "stop" }],
          })}\n\n`,
        ));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  try {
    const client = new YouleApiClient({ businessModelPoolsTtlMs: 60_000 });
    client.loaded = true;
    client.baseUrl = "https://haolo.example";
    client.token = "haolo-session-token";
    client.modelKeys = [{
      provider: "codex",
      groupId: 12,
      apiKey: "sk-codex-user",
      baseUrl: "https://transit.example/v1",
    }];
    client.businessModelPoolsCache = {
      cachedAt: Date.now(),
      result: normalizeBusinessModelPools({
        configured: true,
        pools: [{
          id: "question_answer",
          enabled: true,
          capabilities: ["question_answer"],
          models: [{
            id: "gpt-5.6-sol",
            display_name: "gpt-5.6-sol",
            provider: "codex",
            route_group_id: 12,
            capabilities: ["question_answer"],
            enabled: true,
          }],
        }],
      }),
    };
    const events = [];
    const result = await client.sendProviderChat({
      ...PLAN_MODE_REQUEST,
      model: "gpt-5.6-sol",
      text: "制定实施计划",
      stream: true,
      emitTextDeltas: true,
      onEvent: (event) => events.push(event),
    });

    assert.equal(result.text, "可执行的最终计划。");
    assert.deepEqual(result.planProcessSegments, [
      "正在确认目标。",
      "正在整理步骤。",
    ]);
    assert.equal(
      events
        .filter((event) => event.phase === "plan_process_delta")
        .map((event) => event.delta)
        .join(""),
      "正在确认目标。正在整理步骤。",
    );
    assert.equal(
      events
        .filter((event) => event.phase === "delta")
        .map((event) => event.delta)
        .join(""),
      "可执行的最终计划。",
    );
    assert.doesNotMatch(result.text, /haolo_plan_(?:process|final)/);
    assert.doesNotMatch(JSON.stringify(events), /haolo_plan_(?:process|final)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
