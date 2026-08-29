import assert from "node:assert/strict";
import test from "node:test";

import {
  invokeQuestionAnswerProvider,
  providerMessagesWithoutToolProtocol,
} from "../src/main/workflow/question-answer-provider-loop.mjs";

test("provider loop lets the selected model gather more local evidence before answering", async () => {
  const requests = [];
  const progressEvents = [];
  const workspaceTools = {
    definitions: () => [{
      type: "function",
      function: {
        name: "haolo_workspace_read",
        parameters: { type: "object" },
      },
    }],
    execute: async (call) => ({
      ok: true,
      newEvidence: true,
      files: [{ path: "src/main.ts", content: "export const answer = 42;" }],
      callId: call.id,
    }),
  };
  const send = async (request) => {
    requests.push(request);
    request.onEvent?.({
      phase: requests.length === 1 ? "streaming" : "completed",
      receivedChars: requests.length === 1 ? 12 : 42,
    });
    if (requests.length === 1) {
      const toolCalls = [{
        id: "call_read",
        type: "function",
        function: {
          name: "haolo_workspace_read",
          arguments: JSON.stringify({ paths: ["src/main.ts"] }),
        },
      }];
      return {
        text: "",
        toolCalls,
        assistantMessage: {
          role: "assistant",
          content: "",
          tool_calls: toolCalls,
        },
      };
    }
    return { text: "The implementation returns 42.", toolCalls: [] };
  };

  const result = await invokeQuestionAnswerProvider({
    send,
    params: {
      provider: "gemini",
      text: "Review this project",
      stream: false,
      tools: [{ type: "renderer-controlled-tool" }],
    },
    messages: [{ role: "user", content: "Review this project" }],
    workspaceTools,
    supportsStatefulContinuation: true,
    onProgress: (event) => progressEvents.push(event),
  });

  assert.equal(result.text, "The implementation returns 42.");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.stream === true));
  assert.ok(requests.every((request) => typeof request.onEvent === "function"));
  assert.equal(requests[0].tools[0].function.name, "haolo_workspace_read");
  assert.equal(requests[0].toolChoice, "auto");
  assert.ok(requests[1].messages.some((message) => message.role === "tool"));
  assert.equal(result.localFileToolTrace.calls, 1);
  assert.equal(result.localFileToolTrace.supported, true);
  assert.deepEqual(
    progressEvents.map((event) => `${event.stepId}:${event.status}`),
    [
      "provider-round-1:running",
      "provider-stream:running",
      "provider-round-1:completed",
      "file-tools-1:running",
      "file-tools-1:completed",
      "provider-round-2:running",
      "provider-stream:completed",
      "provider-round-2:completed",
    ],
  );
});

test("a disconnected provider stream is resumed automatically with a fresh stream round", async () => {
  const requests = [];
  const progressEvents = [];
  const streamEvents = [];
  const retryDelays = [];
  const result = await invokeQuestionAnswerProvider({
    send: async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        request.onEvent?.({ phase: "streaming", receivedChars: 18, text: "partial" });
        throw Object.assign(new Error("response stream disconnected"), {
          code: "STREAM_DISCONNECTED",
          category: "transport",
          retryable: true,
          streamReceivedBytes: 18,
        });
      }
      request.onEvent?.({ phase: "completed", receivedChars: 31, text: "complete" });
      return { text: "Recovered complete answer.", toolCalls: [] };
    },
    params: {
      provider: "openai",
      interactionId: "qa-recovery-1",
      onEvent: (event) => streamEvents.push(event),
    },
    messages: [{ role: "user", content: "Finish this answer" }],
    onProgress: (event) => progressEvents.push(event),
    waitForRetry: async (delayMs) => { retryDelays.push(delayMs); },
  });

  assert.equal(result.text, "Recovered complete answer.");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.interactionId === "qa-recovery-1"));
  assert.deepEqual(retryDelays, [1_500]);
  assert.deepEqual(
    streamEvents.filter((event) => ["streaming", "completed"].includes(event.phase)).map((event) => event.round),
    [1, 2],
  );
  assert.ok(progressEvents.some((event) => event.stage === "provider_transport_recovery"));
  assert.equal(progressEvents.at(-1).stepId, "provider-round-1");
  assert.equal(progressEvents.at(-1).status, "completed");
});

test("an interactive flow can bound transport recovery without leaking control fields upstream", async () => {
  const requests = [];
  await assert.rejects(
    invokeQuestionAnswerProvider({
      send: async (request) => {
        requests.push(request);
        throw Object.assign(new Error("response stream disconnected"), {
          code: "STREAM_DISCONNECTED",
          category: "transport",
          retryable: true,
        });
      },
      params: {
        provider: "openai",
        maxTransportAttempts: 2,
      },
      messages: [{ role: "user", content: "Finish this answer" }],
      waitForRetry: async () => {},
    }),
    (error) => error.recoveryExhausted === true && error.recoveryAttempts === 2,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests.some((request) => "maxTransportAttempts" in request), false);
});

test("provider loop falls back to broad host context when the route rejects tools", async () => {
  const requests = [];
  const send = async (request) => {
    requests.push(request);
    if (requests.length === 1) {
      const error = new Error("tools are not supported by this provider");
      error.status = 400;
      throw error;
    }
    return { text: "Answered from the broad initial context." };
  };

  const result = await invokeQuestionAnswerProvider({
    send,
    params: { provider: "legacy", text: "Review the project" },
    messages: [
      { role: "system", content: "Broad initial file context" },
      { role: "user", content: "Review the project" },
    ],
    workspaceTools: {
      definitions: () => [{
        type: "function",
        function: { name: "haolo_workspace_read" },
      }],
      execute: async () => {
        throw new Error("must not execute");
      },
    },
    supportsStatefulContinuation: true,
  });

  assert.equal(requests.length, 2);
  assert.ok(Array.isArray(requests[0].tools));
  assert.equal("tools" in requests[1], false);
  assert.match(requests[1].messages.at(-1).content, /selected provider does not support/);
  assert.equal(result.localFileToolTrace.supported, false);
  assert.equal(result.localFileToolTrace.fallback, "broad_host_context");
});

test("stateless provider sends a complete local context only once", async () => {
  const requests = [];
  const progressEvents = [];
  let toolExecutions = 0;
  const result = await invokeQuestionAnswerProvider({
    send: async (request) => {
      requests.push(request);
      return { text: "Reviewed from the complete host context.", toolCalls: [] };
    },
    params: {
      provider: "gemini",
      text: "Review this project",
      attachments: [{
        name: "evidence.png",
        mime: "image/png",
        local_path: "C:/workspace/evidence.png",
      }],
    },
    messages: [
      {
        role: "system",
        content: "<haolo_question_answer_file_context>\nComplete task-relevant local context",
      },
      { role: "user", content: "Review this project" },
    ],
    workspaceTools: {
      definitions: () => [{
        type: "function",
        function: { name: "haolo_workspace_read" },
      }],
      execute: async () => {
        toolExecutions += 1;
        return { ok: true, newEvidence: true };
      },
    },
    onProgress: (event) => progressEvents.push(event),
  });

  assert.equal(result.text, "Reviewed from the complete host context.");
  assert.equal(requests.length, 1);
  assert.equal("tools" in requests[0], false);
  assert.deepEqual(requests[0].attachments, [{
    name: "evidence.png",
    mime: "image/png",
    local_path: "C:/workspace/evidence.png",
  }]);
  assert.equal(toolExecutions, 0);
  assert.equal(progressEvents[0].title, "正在提交图片与问题");
  assert.match(progressEvents[0].detail, /语义选中的必要文件资料/);
});

test("a native video request reports that no group file context is attached", async () => {
  const progressEvents = [];
  const result = await invokeQuestionAnswerProvider({
    send: async () => ({ text: "视频内容说明" }),
    params: {
      provider: "gemini",
      text: "描述这个视频",
      attachments: [{
        name: "clip.mp4",
        mime: "video/mp4",
        local_path: "C:/workspace/clip.mp4",
      }],
    },
    messages: [{ role: "user", content: "描述这个视频" }],
    workspaceTools: null,
    onProgress: (event) => progressEvents.push(event),
  });

  assert.equal(result.text, "视频内容说明");
  assert.equal(progressEvents[0].title, "正在提交视频与问题");
  assert.match(progressEvents[0].detail, /不附带分组文件上下文/);
});

test("tool protocol messages can be collapsed into ordinary evidence messages", () => {
  const messages = providerMessagesWithoutToolProtocol([
    { role: "user", content: "Review" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", function: { name: "read" } }],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ content: "file evidence" }),
    },
  ], {
    reason: "Evidence collection complete.",
  });

  assert.equal(messages.some((message) => message.role === "tool"), false);
  assert.ok(messages.some((message) => /file evidence/.test(message.content)));
  assert.match(messages.at(-1).content, /Answer the user's original request now/);
});
