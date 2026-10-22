import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createModelProgressWatchdog, meaningfulModelProgress } from "../src/main/model-progress-watchdog.mjs";
import { ModelRequestRelay } from "../src/main/model-request-relay.mjs";

const frame = (type, fields = {}) => `data: ${JSON.stringify({ type, ...fields })}\n\n`;

test("only content, reasoning and tool progress reset the exact 20 second idle deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const watch = createModelProgressWatchdog(controller);
  watch.stream.resume();
  t.after(() => watch.dispose());
  for (const wire of [": keep-alive\n\n", frame("response.created"), frame("response.output_text.delta", { delta: " " })]) {
    t.mock.timers.tick(5_000);
    watch.stream.write(Buffer.from(wire));
  }
  t.mock.timers.tick(4_999);
  assert.equal(controller.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(controller.signal.reason.code, "MODEL_NO_PROGRESS_TIMEOUT");
});

for (const type of ["response.output_text.delta", "response.reasoning_text.delta", "response.function_call_arguments.delta"]) {
  test(`${type} resets idle but cannot extend the absolute deadline`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const controller = new AbortController();
    const watch = createModelProgressWatchdog(controller);
    watch.stream.resume();
    t.after(() => watch.dispose());
    for (let i = 0; i < 8; i++) {
      t.mock.timers.tick(10_000);
      const bytes = Buffer.from(frame(type, { delta: "有效进展" }));
      // UTF-8 and SSE frames may arrive split across arbitrary network chunks.
      watch.stream.write(bytes.subarray(0, bytes.length - 4));
      watch.stream.write(bytes.subarray(bytes.length - 4));
      assert.equal(controller.signal.aborted, false);
    }
    t.mock.timers.tick(10_000);
    assert.equal(controller.signal.reason.code, "MODEL_GENERATION_TIMEOUT");
  });
}

test("completed inference releases timers while local tools continue", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const watch = createModelProgressWatchdog(controller);
  assert.equal(meaningfulModelProgress({ type: "response.output_item.added", item: { type: "function_call", name: "read_file" } }), true);
  watch.dispose();
  t.mock.timers.tick(300_000);
  assert.equal(controller.signal.aborted, false);
});

async function relayFixture(t, options) {
  const relay = new ModelRequestRelay({ upstreamBaseUrl: "https://fixture.invalid/v1", deepSeekBilling: { keyId: 101 }, ...options });
  await relay.start();
  t.after(() => relay.stop());
  return relay;
}

test("compressed default requests preserve GPT billing and enforce the gateway acknowledgement", async (t) => {
  const seen = [];
  let acknowledged = true;
  const relay = await relayFixture(t, { fetch: async (url, options) => {
    seen.push({ url, headers: options.headers });
    return new Response(frame("response.completed"), { headers: { "content-type": "text/event-stream", ...(acknowledged ? { "x-haolo-recovery-billing": "gpt-v1" } : {}) } });
  } });
  const request = () => fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip" }, body: gzipSync(JSON.stringify({ model: "deepseek-flash", input: "fixture" })) });
  const response = await request();
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(seen[0].url, "https://fixture.invalid/v1/mobile-analysis/responses");
  assert.equal(seen[0].headers.get("x-haolo-billing-model"), "gpt-5.6-sol");
  assert.equal(seen[0].headers.get("x-haolo-billing-key-id"), "101");
  acknowledged = false;
  const denied = await request();
  assert.equal(denied.status, 502);
  assert.equal((await denied.json()).error.code, "MODEL_BILLING_UNSUPPORTED");
  assert.equal(seen.length, 2, "a missing billing acknowledgement cannot trigger an unbilled retry");
});

test("missing billing metadata and unsupported routes never dispatch a paid request", async (t) => {
  let calls = 0;
  const relay = await relayFixture(t, { deepSeekBilling: {}, fetch: async () => { calls++; return new Response("{}"); } });
  for (const path of ["responses", "responses/compact"]) {
    const response = await fetch(`${relay.localBaseUrl()}/${path}`, { method: "POST", body: JSON.stringify({ model: "deepseek-flash" }) });
    assert.equal(response.status, 502);
    await response.text();
    relay.deepSeekBilling = { keyId: 101 };
  }
  assert.equal(calls, 0);
});

test("heartbeat-only SSE is aborted upstream and surfaced as a recoverable transport failure", async (t) => {
  let aborted = false;
  const errors = [];
  const relay = await relayFixture(t, { progressTimeouts: { idleMs: 150, totalMs: 1500 }, fetch: async (_url, { signal }) => {
    return new Response(new ReadableStream({ start(controller) {
      const timer = setInterval(() => controller.enqueue(new TextEncoder().encode(": ping\n\n")), 20);
      signal.addEventListener("abort", () => { aborted = true; clearInterval(timer); controller.error(signal.reason); }, { once: true });
    } }), { headers: { "content-type": "text/event-stream", "x-haolo-recovery-billing": "gpt-v1" } });
  } });
  const finished = new Promise(resolve => relay.once("request-error", error => { errors.push(error); resolve(); }));
  await assert.rejects(async () => {
    const response = await fetch(`${relay.localBaseUrl()}/responses`, { method: "POST", body: JSON.stringify({ model: "deepseek-flash" }) });
    await response.text();
  });
  assert.equal(aborted, true);
  await finished;
  assert.equal(errors[0].code, "MODEL_NO_PROGRESS_TIMEOUT");
});
