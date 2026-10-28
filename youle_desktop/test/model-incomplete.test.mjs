import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import http from "node:http";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";
import { modelIncompleteFacts, incompleteErrorMessage, incompleteResponseCopy, incompleteNoticeItem, preserveIncompletePartial } from "../src/shared/model-incomplete.mjs";
import { createDeepSeekResponseStream } from "../src/main/deepseek-responses-adapter.mjs";
import { modelFailureFacts } from "../src/main/model-failure-policy.mjs";
import { failureDiagnosticsFromNotification } from "../src/main/turn-diagnostics.mjs";
import { isRecoverableAnalysisModelFailure } from "../src/main/analysis-model-recovery.mjs";

for (const chunked of [false, true]) {
  for (const type of ["response.incomplete", "response.completed"]) {
    test(`${type} is terminal even with malformed trailing data (chunked=${chunked})`, async () => {
      const terminal = `data: ${JSON.stringify({type, response: {id: "resp_tail", status: type.split(".")[1], output: []}})}\n\n`;
      const tail = 'data: {invalid json}\n\n';
      let received = "";
      for await (const chunk of Readable.from(chunked ? [terminal, tail] : [terminal + tail]).pipe(createDeepSeekResponseStream(new Map()))) received += chunk;
      const events = received.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)));
      assert.equal(events.length, 1);
      assert.equal(events[0].type, type === "response.incomplete" ? "response.failed" : type);
      assert.ok(!received.includes("MODEL_TOOL_PROTOCOL_ERROR"));
      if (type === "response.incomplete") assert.equal(events[0].response.error.code, "MODEL_RESPONSE_INCOMPLETE");
    });
  }
}

test("malformed data before a terminal event remains a protocol failure", async () => {
  let received = "";
  for await (const chunk of Readable.from(['data: {invalid json}\n\n']).pipe(createDeepSeekResponseStream(new Map()))) received += chunk;
  assert.match(received, /MODEL_TOOL_PROTOCOL_ERROR/);
});

for (const reason of ["max_output_tokens", "content_filter", "", "provider_specific"]) {
  test(`incomplete ${reason || "unknown"} retains partial answer and metadata and never succeeds or retries`, async () => {
    const output = [
      { type: "message", id: "msg", content: [{ type: "output_text", text: "received answer" }] },
      { type: "function_call", id: "fc", call_id: "call_unfinished", name: "unrecognized", arguments: '{"partial":', status: "incomplete" },
    ];
    const terminal = { type: "response.incomplete", response: { id: "resp_partial", status: "incomplete", incomplete_details: {reason}, output, usage: {input_tokens: 10, output_tokens: 48581} } };
    const frames = [
      { type: "response.output_text.delta", item_id: "msg", delta: "received answer" }, terminal,
      { type: "response.completed", response: { id: "late", status: "completed" } },
    ];
    const bytes = Buffer.from(frames.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
    let received = "";
    for await (const chunk of Readable.from([...bytes].map(b => Buffer.from([b]))).pipe(createDeepSeekResponseStream(new Map()))) received += chunk;
    const events = received.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)));
    assert.equal(events.length, 2);
    assert.equal(events[0].delta, "received answer");
    const failed = events[1];
    assert.equal(failed.type, "response.failed");
    assert.equal(failed.response.status, "incomplete");
    assert.deepEqual(failed.response.incomplete_details, {reason});
    assert.equal(failed.response.usage.output_tokens, 48581);
    assert.deepEqual(failed.response.output, [output[0]]);
    assert.ok(!received.includes("haolo_unavailable"));
    assert.equal(failed.response.error.retryable, false);
    const error = {message: "stream disconnected", codexErrorInfo: {additionalDetails: failed.response.error.message}, retryable: true};
    const facts = modelFailureFacts(error);
    assert.equal(facts.hardFailure, true);
    assert.equal(facts.retryable, false);
    assert.equal(isRecoverableAnalysisModelFailure(error, {allowUnknownTerminal: true}), false);
    const diagnostics = failureDiagnosticsFromNotification({method: "turn/completed", params: {turn: {error, status: "failed"}}});
    assert.equal(diagnostics.errorClass, "response_incomplete");
    assert.deepEqual(diagnostics.incomplete, {reason: reason || "unknown", responseId: "resp_partial", inputTokens: 10, outputTokens: 48581, outputItems: 2});
    assert.equal(diagnostics.retryable, false);
    assert.ok(!JSON.stringify(diagnostics).includes("received answer"));
  });
}

test("incomplete markers are read only from error protocol fields", () => {
  assert.equal(modelIncompleteFacts({type: "response.completed", response: {status: "completed", output: [{text: "response.incomplete"}]}}), null);
  assert.equal(modelIncompleteFacts("stream disconnected before completion"), null);
  assert.equal(modelIncompleteFacts("request timeout"), null);
  const marker = incompleteErrorMessage({reason: "max_output_tokens", responseId: "resp_1", inputTokens: 1, outputTokens: 2, outputItems: 1});
  assert.equal(modelIncompleteFacts({code: "MODEL_RESPONSE_INCOMPLETE", message: marker}).reason, "max_output_tokens");
  assert.equal(modelIncompleteFacts({type: "response.incomplete", response: {incomplete_details: {reason: "sk secret\n"}, id: "Bearer secret"}}).reason, "unknown");
});

test("manual continuation is an idempotent local notice and a new draft, with no replay or model switch", () => {
  for (const language of ["zh-CN", "zh-TW", "zh-Hant", "en", "ja", "ko", "vi"]) {
    const notice = incompleteNoticeItem("thread_1", "turn_1", "max_output_tokens", language, "\nH-test");
    assert.equal(notice.id, incompleteNoticeItem("thread_1", "turn_1", "unknown", language).id);
    assert.equal(notice.actions[0].conversation_id, "thread_1");
    assert.equal(notice.actions[0].kind, "continue-incomplete");
    assert.ok(notice.actions[0].text.length > 20);
    assert.ok(notice.text.endsWith("H-test"));
    assert.equal(notice.actions[0].model, undefined);
    assert.equal(incompleteResponseCopy("content_filter", language).canContinue, false);
    assert.deepEqual(incompleteNoticeItem("thread_1", "turn_1", "content_filter", language).actions, []);
  }
});

test("late sparse history cannot erase the received incomplete answer", () => {
  const partial = {id: "msg", type: "agentMessage", text: "already received partial answer", __youleIncompletePartial: true};
  assert.equal(preserveIncompletePartial(partial, {id: "msg", type: "agentMessage", text: "already"}).text, partial.text);
  assert.equal(preserveIncompletePartial(partial, {id: "msg", type: "agentMessage"}).text, partial.text);
  const final = {id: "msg", type: "agentMessage", text: "authoritative different answer"};
  assert.equal(preserveIncompletePartial(partial, final), final);
  const other = {id: "other", type: "agentMessage", text: ""};
  assert.equal(preserveIncompletePartial(partial, other), other);
});

test("HTTP relay delivers one terminal incomplete failure without retrying the upstream", async () => {
  const requests = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200, {"content-type": "text/event-stream"});
    response.end('data: {"type":"response.output_text.delta","item_id":"msg","delta":"partial answer"}\n\n'
      + 'data: {"type":"response.incomplete","response":{"id":"resp_http","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[],"usage":{"input_tokens":8,"output_tokens":9}}}\n\n');
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const relay = new ModelRequestRelay({upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, minCompressBytes: 1e9});
  try {
    await relay.start();
    const response = await fetch(`${relay.localBaseUrl()}/responses`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({model: "deepseek-flash", stream: true, input: "fixture"})});
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /partial answer/);
    assert.match(text, /MODEL_RESPONSE_INCOMPLETE reason=max_output_tokens response_id=resp_http/);
    assert.equal((text.match(/"type":"response.failed"/g) || []).length, 1);
    assert.ok(!text.includes('"type":"response.completed"'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "deepseek-flash");
  } finally {
    await relay.stop();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});
